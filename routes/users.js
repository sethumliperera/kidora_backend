const express = require("express");
const router = express.Router();
const db = require("../db");


// ===============================
// ✅ SAVE FIREBASE USER
// ===============================
// ===============================
// ✅ SAVE FIREBASE USER
// ===============================
router.post("/", async (req, res) => {
  try {
    const { uid, email } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: "Missing uid or email" });
    }

    console.log("Saving user:", uid, email);

    const sql = `
      INSERT INTO users (firebase_uid, email)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE email = VALUES(email), firebase_uid = VALUES(firebase_uid)
    `;

    await db.query(sql, [uid, email]);

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


module.exports = router;
