const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");


// 🔔 CREATE NOTIFICATION
router.post("/create", verifyToken, (req, res) => {
  const { parent_id, child_id, message, type } = req.body;

  // validation (good practice)
  if (!parent_id || !child_id || !message || !type) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const sql = `
    INSERT INTO notifications (parent_id, child_id, message, type)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [parent_id, child_id, message, type], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json({ message: "Notification created" });
  });
});


// 📥 GET NOTIFICATIONS BY CHILD
router.get("/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  const sql = `
    SELECT * FROM notifications
    WHERE child_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [child_id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json(results);
  });
});


// 🗑️ DELETE NOTIFICATION (optional feature)
router.delete("/:id", verifyToken, (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM notifications WHERE id = ?`;

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json({ message: "Notification deleted" });
  });
});


module.exports = router;
