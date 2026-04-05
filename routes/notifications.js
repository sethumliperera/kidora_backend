const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");


// 🔔 CREATE NOTIFICATION
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { parent_id, child_id, message, type } = req.body;

    if (!parent_id || !child_id || !message || !type) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const sql = `
      INSERT INTO notifications (parent_id, child_id, message, type)
      VALUES (?, ?, ?, ?)
    `;

    await db.query(sql, [parent_id, child_id, message, type]);
    res.json({ message: "Notification created" });
  } catch (err) {
    console.error("Error creating notification:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


// 📥 GET NOTIFICATIONS BY CHILD
router.get("/:child_id", verifyToken, async (req, res) => {
  try {
    const { child_id } = req.params;

    const sql = `
      SELECT * FROM notifications
      WHERE child_id = ?
      ORDER BY created_at DESC
    `;

    const [results] = await db.query(sql, [child_id]);
    res.json(results);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


// 🗑️ DELETE NOTIFICATION (optional feature)
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `DELETE FROM notifications WHERE id = ?`;

    await db.query(sql, [id]);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    console.error("Error deleting notification:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


module.exports = router;
