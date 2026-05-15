const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

async function ensureUninstallPinColumn() {
  try {
    await db.query(
      "ALTER TABLE users ADD COLUMN uninstall_pin_hash VARCHAR(255) NULL DEFAULT NULL"
    );
  } catch (err) {
    if (err.errno !== 1060 && !String(err.message || "").includes("Duplicate column")) {
      console.error("ensureUninstallPinColumn:", err.message);
    }
  }
}

// ===============================
// ✅ SAVE FIREBASE USER (signup sync from app; optional 4-digit parent PIN)
// ===============================
router.post("/", async (req, res) => {
  try {
    await ensureUninstallPinColumn();

    const { uid, email, uninstall_pin } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: "Missing uid or email" });
    }

    let pinHash = null;
    if (uninstall_pin != null && String(uninstall_pin).trim() !== "") {
      const pin = String(uninstall_pin).trim();
      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: "Parent PIN must be exactly 4 digits" });
      }
      pinHash = await bcrypt.hash(pin, 10);
    }

    console.log("Saving user:", uid, email, pinHash ? "(with PIN)" : "");

    const sql = `
      INSERT INTO users (firebase_uid, email, uninstall_pin_hash)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        email = VALUES(email),
        firebase_uid = VALUES(firebase_uid),
        uninstall_pin_hash = COALESCE(VALUES(uninstall_pin_hash), uninstall_pin_hash)
    `;

    await db.query(sql, [uid, email, pinHash]);

    console.log("User saved successfully in DB");
    res.status(200).json({
      message: "User saved successfully",
      uid: uid,
    });
  } catch (err) {
    console.error("Database error saving user:", err);
    res.status(500).json({
      error: "Database error",
      details: err.message,
    });
  }
});

// ===============================
// PARENT: uninstall PIN status / set PIN (Firebase Bearer)
// ===============================
router.get("/me/uninstall-pin-status", verifyToken, async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const [rows] = await db.query(
      "SELECT uninstall_pin_hash FROM users WHERE id = ?",
      [req.user.id]
    );
    const h = rows[0]?.uninstall_pin_hash;
    const has_pin = h != null && String(h).length > 0;
    res.json({ has_pin });
  } catch (err) {
    console.error("uninstall-pin-status:", err);
    res.status(500).json({ message: err.message });
  }
});

router.post("/me/uninstall-pin", verifyToken, async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const pin = String(req.body.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be exactly 4 digits" });
    }
    const pinHash = await bcrypt.hash(pin, 10);
    await db.query("UPDATE users SET uninstall_pin_hash = ? WHERE id = ?", [
      pinHash,
      req.user.id,
    ]);
    res.json({ message: "ok" });
  } catch (err) {
    console.error("uninstall-pin set:", err);
    res.status(500).json({ message: err.message });
  }
});


// ===============================
// DELETE USER + RELATED DATA
// ===============================
router.delete("/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    if (!uid) {
      return res.status(400).json({ error: "Missing UID" });
    }

    console.log("Attempting to delete user with UID:", uid);

    // 🔍 STEP 1: Find user by Firebase UID
    const findUserSql = "SELECT id FROM users WHERE firebase_uid = ?";
    const [results] = await db.query(findUserSql, [uid]);

    if (results.length === 0) {
      console.warn("User not found for UID:", uid);
      return res.status(404).json({ error: "User not found" });
    }

    const userId = results[0].id;
    console.log("Found user ID:", userId);

    // STEP 2: Delete child data FIRST
    const deleteChildrenSql = "DELETE FROM children WHERE parent_id = ?";
    await db.query(deleteChildrenSql, [userId]);

    console.log("Children deleted for user:", userId);

    // STEP 3: Delete user
    const deleteUserSql = "DELETE FROM users WHERE id = ?";
    await db.query(deleteUserSql, [userId]);

    console.log("User deleted successfully");

    res.status(200).json({
      message: "User and all related data deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting user workflow:", err);
    res.status(500).json({
      error: "Failed to delete user and related data",
      details: err.message
    });
  }
});


module.exports = router;
