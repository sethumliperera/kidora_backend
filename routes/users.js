const express = require("express");
const router = express.Router();
const db = require("../db");


// ===============================
// ✅ SAVE FIREBASE USER
// ===============================
router.post("/", (req, res) => {
  const { uid, email } = req.body;

  if (!uid || !email) {
    return res.status(400).json({ error: "Missing uid or email" });
  }

  console.log("Saving user:", uid, email);

  const sql = `
    INSERT INTO users (firebase_uid, email)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE email = VALUES(email)
  `;

  db.query(sql, [uid, email], (err, result) => {
    if (err) {
      console.error("Database error saving user:", err);
      return res.status(500).json({
        error: "Database error",
        details: err.message,
      });
    }

    console.log("User saved successfully in DB");
    res.status(200).json({
      message: "User saved successfully",
      uid: uid,
    });
  });
});


// ===============================
// ✅ DELETE USER + RELATED DATA
// ===============================
router.delete("/:uid", (req, res) => {
  const uid = req.params.uid;

  if (!uid) {
    return res.status(400).json({ error: "Missing UID" });
  }

  console.log("Attempting to delete user with UID:", uid);

  // 🔍 STEP 1: Find user by Firebase UID
  const findUserSql = "SELECT id FROM users WHERE firebase_uid = ?";

  db.query(findUserSql, [uid], (err, results) => {
    if (err) {
      console.error("DB Error finding user:", err);
      return res.status(500).json({
        error: "Failed to find user",
        details: err.message,
      });
    }

    if (results.length === 0) {
      console.warn("User not found for UID:", uid);
      return res.status(404).json({ error: "User not found" });
    }

    const userId = results[0].id;
    console.log("Found user ID:", userId);

    // 🔥 STEP 2: Delete child data FIRST
    const deleteChildrenSql = "DELETE FROM children WHERE parent_id = ?";

    db.query(deleteChildrenSql, [userId], (err) => {
      if (err) {
        console.error("Error deleting children:", err);
        return res.status(500).json({
          error: "Failed to delete children data",
        });
      }

      console.log("Children deleted for user:", userId);

      // 🔥 STEP 3: Delete user
      const deleteUserSql = "DELETE FROM users WHERE id = ?";

      db.query(deleteUserSql, [userId], (err, result) => {
        if (err) {
          console.error("Error deleting user:", err);
          return res.status(500).json({
            error: "Failed to delete user",
          });
        }

        console.log("User deleted successfully");

        res.status(200).json({
          message: "User and all related data deleted successfully",
        });
      });
    });
  });
});


module.exports = router;
