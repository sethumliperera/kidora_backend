const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const { sendParentNotificationPush } = require("../fcmReminders");

// 🔔 CREATE NOTIFICATION
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { parent_id, child_id, message, type } = req.body;

    if (!parent_id || !child_id || !message || !type) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (Number(parent_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: "parent_id must match the signed-in account" });
    }

    const sql = `
      INSERT INTO notifications (parent_id, child_id, message, type)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await db.query(sql, [
      parent_id,
      child_id,
      message,
      type,
    ]);

    // ✅ GET SOCKET INSTANCE
    const io = req.app.get("io");

    const payload = {
      id: result.insertId,
      parent_id,
      child_id,
      message,
      type,
      created_at: new Date(),
    };

    io.to(`child_${child_id}`).emit("new_notification", payload);
    io.to(`parent_${parent_id}`).emit("new_notification", payload);

    await sendParentNotificationPush(db, parent_id, {
      title: "Kidora",
      body: String(message).slice(0, 2000),
      type: String(type),
      childId: child_id,
    });

    console.log("📤 Notification emitted to child_%s and parent_%s", child_id, parent_id);

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

// 🗑️ DELETE
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(`DELETE FROM notifications WHERE id = ?`, [id]);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    console.error("Error deleting notification:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

module.exports = router;
