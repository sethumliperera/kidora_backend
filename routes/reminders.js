const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// ===============================
// 📤 SEND REMINDER (PARENT → CHILD)
// ===============================
router.post("/send", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;
    const { 
      child_id, 
      message, 
      priority = "normal", 
      scheduled_at = null, 
      frequency = "once" 
    } = req.body;

    if (!child_id || !message) {
      return res.status(400).json({
        message: "child_id and message are required"
      });
    }

    // 1️⃣ Verify parent owns child
    const [childRows] = await db.query(
      "SELECT id, parent_id FROM children WHERE id = ?",
      [child_id]
    );

    if (childRows.length === 0) {
      return res.status(404).json({
        message: "Child not found"
      });
    }

    if (Number(childRows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({
        message: "Unauthorized: Not your child"
      });
    }

    // 2️⃣ Save reminder
    const [result] = await db.query(
      `INSERT INTO reminders (child_id, title, message, priority, scheduled_at, frequency, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [child_id, req.body.title || "New Reminder", message, priority, scheduled_at, frequency, 1]
    );

    const reminder_id = result.insertId;

    const reminderData = {
      id: reminder_id,
      child_id,
      title: req.body.title || "New Reminder",
      message,
      priority,
      scheduled_at,
      frequency
    };

    // 3️⃣ Determine if it should be sent immediately or scheduled
    const scheduler = require("../scheduler");
    const io = req.app.get("io");
    
    const isFuture = scheduled_at && new Date(scheduled_at) > new Date(Date.now() + 5000);

    if (!isFuture) {
      // Send immediately if time is now or roughly now
      if (io) {
        const room = "child_" + child_id;
        io.to(room).emit("reminder", {
          title: priority === "urgent" ? "🚨 Urgent Reminder!" : "📢 New Reminder",
          message: message,
          reminder_id: reminder_id,
          priority,
          time: new Date().toISOString()
        });
        console.log(`✅ Immediate reminder emitted to ${room}`);
      }

      // If it was a one-time reminder, mark it as inactive since it's already sent
      if (frequency === "once") {
        await db.query("UPDATE reminders SET is_active = 0 WHERE id = ?", [reminder_id]);
      }
    }

    // If it's a repeating reminder OR a future one-time reminder, add to scheduler
    if (frequency !== "once" || isFuture) {
      scheduler.scheduleReminder(reminderData);
    }

    res.json({
      message: isFuture ? "Reminder scheduled successfully" : "Reminder sent successfully",
      reminder_id,
      scheduled: isFuture || frequency !== "once"
    });

  } catch (err) {
    console.error("SEND REMINDER ERROR:", err);
    res.status(500).json({
      error: "Failed to process reminder"
    });
  }
});

// ===============================
// 📥 GET REMINDERS FOR ONE CHILD (PARENT)
// ===============================
router.get("/child/:child_id", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;
    const { child_id } = req.params;

    const [childRows] = await db.query(
      "SELECT parent_id FROM children WHERE id = ?",
      [child_id]
    );

    if (childRows.length === 0) {
      return res.status(404).json({
        message: "Child not found"
      });
    }

    if (Number(childRows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({
        message: "Unauthorized"
      });
    }

    const [results] = await db.query(
      `SELECT * FROM reminders
       WHERE child_id = ? AND parent_id = ?
       ORDER BY sent_at DESC`,
      [child_id, parent_id]
    );

    res.json({
      message: "Reminders fetched successfully",
      data: results
    });

  } catch (err) {
    console.error("GET CHILD REMINDERS ERROR:", err);
    res.status(500).json({
      error: "Failed to fetch reminders"
    });
  }
});

// ===============================
// 📥 GET REMINDERS FOR CHILD (CHILD SIDE)
// ===============================
router.get("/received/:child_id", async (req, res) => {
  try {
    const { child_id } = req.params;

    const [results] = await db.query(
      `SELECT * FROM reminders
       WHERE child_id = ?
       ORDER BY sent_at DESC`,
      [child_id]
    );

    res.json({
      message: "Received reminders fetched successfully",
      data: results
    });

  } catch (err) {
    console.error("GET RECEIVED ERROR:", err);
    res.status(500).json({
      error: "Failed to fetch reminders"
    });
  }
});

// ===============================
// ✔ MARK AS READ
// ===============================
router.put("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE reminders
       SET is_read = 1, read_at = NOW()
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Reminder not found"
      });
    }

    res.json({
      message: "Reminder marked as read"
    });

  } catch (err) {
    console.error("READ ERROR:", err);
    res.status(500).json({
      error: "Failed to update reminder"
    });
  }
});

// ===============================
// 🗑 DELETE REMINDER
// ===============================
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT parent_id FROM reminders WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "Reminder not found"
      });
    }

    if (Number(rows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({
        message: "Unauthorized"
      });
    }

    await db.query(
      "DELETE FROM reminders WHERE id = ?",
      [id]
    );

    res.json({
      message: "Reminder deleted successfully"
    });

  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({
      error: "Failed to delete reminder"
    });
  }
});

module.exports = router;
