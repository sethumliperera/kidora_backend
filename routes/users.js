const express = require("express");
const router = express.Router();
const db = require("../db");
const crypto = require("crypto");
const verifyToken = require("../middleware/authMiddleware");

let uninstallPinColumnChecked = false;
const ensureUninstallPinColumn = async () => {
  if (uninstallPinColumnChecked) return;
  try {
    await db.query(
      "ALTER TABLE users ADD COLUMN uninstall_pin_hash VARCHAR(255) NULL"
    );
    console.log("✅ Added users.uninstall_pin_hash column");
  } catch (err) {
    if (!String(err.message || "").toLowerCase().includes("duplicate column")) {
      throw err;
    }
  } finally {
    uninstallPinColumnChecked = true;
  }
};

const hashPin = (pin) =>
  crypto.createHash("sha256").update(String(pin)).digest("hex");


// ===============================
// ✅ SAVE FIREBASE USER
// ===============================
// ===============================
// ✅ SAVE FIREBASE USER
// ===============================
router.post("/", async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const { uid, email, uninstall_pin } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: "Missing uid or email" });
    }

    if (
      uninstall_pin !== undefined &&
      !/^\d{4}$/.test(String(uninstall_pin).trim())
    ) {
      return res.status(400).json({ error: "uninstall_pin must be exactly 4 digits" });
    }

    console.log("Saving user:", uid, email);

    const uninstallPinHash =
      uninstall_pin !== undefined ? hashPin(String(uninstall_pin).trim()) : null;

    const sql = `
      INSERT INTO users (firebase_uid, email, uninstall_pin_hash)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        email = VALUES(email),
        firebase_uid = VALUES(firebase_uid),
        uninstall_pin_hash = COALESCE(VALUES(uninstall_pin_hash), uninstall_pin_hash)
    `;

    await db.query(sql, [uid, email, uninstallPinHash]);

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
// ✅ DELETE USER + RELATED DATA
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

    // 🔥 STEP 2: Delete child data FIRST
    const deleteChildrenSql = "DELETE FROM children WHERE parent_id = ?";
    await db.query(deleteChildrenSql, [userId]);

    console.log("Children deleted for user:", userId);

    // 🔥 STEP 3: Delete user
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

// ===============================
// ✅ UNINSTALL PIN STATUS (AUTH)
// ===============================
router.get("/me/uninstall-pin-status", verifyToken, async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const [rows] = await db.query(
      "SELECT uninstall_pin_hash FROM users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ has_pin: !!rows[0].uninstall_pin_hash });
  } catch (err) {
    console.error("UNINSTALL PIN STATUS ERROR:", err);
    res.status(500).json({ message: "Failed to load uninstall pin status" });
  }
});

// ===============================
// ✅ SET/UPDATE UNINSTALL PIN (AUTH)
// ===============================
router.post("/me/uninstall-pin", verifyToken, async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const pin = String(req.body?.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: "pin must be exactly 4 digits" });
    }
    await db.query(
      "UPDATE users SET uninstall_pin_hash = ? WHERE id = ?",
      [hashPin(pin), req.user.id]
    );
    res.json({ message: "Uninstall PIN saved" });
  } catch (err) {
    console.error("SET UNINSTALL PIN ERROR:", err);
    res.status(500).json({ message: "Failed to save uninstall pin" });
  }
});


module.exports = router;
