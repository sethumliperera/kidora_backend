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
      title = "Reminder",
      priority = "normal",
      scheduled_at = null,
      frequency = "once"
    } = req.body;

    if (!child_id || !message) {
      return res.status(400).json({
        message: "child_id and message are required"
      });
    }

    // ===============================
    // 1. VERIFY CHILD OWNERSHIP
    // ===============================
    const [childRows] = await db.query(
      "SELECT id, parent_id FROM children WHERE id = ?",
      [child_id]
    );

    if (!childRows.length) {
      return res.status(404).json({ message: "Child not found" });
    }

    if (Number(childRows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // ===============================
    // 2. SAVE REMINDER
    // ===============================
    const [result] = await db.query(
      `INSERT INTO reminders 
      (parent_id, child_id, title, message, priority, scheduled_at, frequency, is_sent, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        parent_id,
        child_id,
        title,
        message,
        priority,
        scheduled_at,
        frequency
      ]
    );

    const reminder_id = result.insertId;

    const reminderData = {
      id: reminder_id,
      child_id,
      title,
      message,
      priority,
      scheduled_at,
      frequency
    };

    // ===============================
    // 3. SOCKET EMIT
    // ===============================
    const io = req.app.get("io");

    const isImmediate =
      !scheduled_at ||
      new Date(scheduled_at) <= new Date(Date.now() + 5000);

    const room = `child_${child_id}`;

    if (isImmediate && io) {
      console.log("📡 Emitting reminder to room:", room);

      io.to(room).emit("reminder", {
        title: priority === "urgent"
          ? "🚨 Urgent Reminder"
          : "📢 Reminder",
        message,
        reminder_id,
        priority,
        time: new Date().toISOString()
      });

      // mark as sent
      await db.query(
        "UPDATE reminders SET is_sent = 1, sent_at = NOW() WHERE id = ?",
        [reminder_id]
      );
    } else {
      console.log("⏳ Reminder scheduled for later:", room);
    }

    // ===============================
    // 4. OPTIONAL SCHEDULER
    // ===============================
    try {
      const scheduler = require("../scheduler");

      if (frequency !== "once" || !isImmediate) {
        scheduler.scheduleReminder(reminderData);
      }
    } catch (err) {
      console.log("⚠ Scheduler not available:", err.message);
    }

    // ===============================
    // RESPONSE
    // ===============================
    return res.json({
      message: isImmediate
        ? "Reminder sent successfully"
        : "Reminder scheduled successfully",
      reminder_id
    });

  } catch (err) {
    console.error("🔥 SEND REMINDER ERROR:", err);

    return res.status(500).json({
      error: err.sqlMessage || err.message || "Failed to process reminder"
    });
  }
});


// ===============================
// 📥 GET REMINDERS (PARENT VIEW)
// ===============================
router.get("/child/:child_id", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;
    const { child_id } = req.params;

    const [childRows] = await db.query(
      "SELECT parent_id FROM children WHERE id = ?",
      [child_id]
    );

    if (!childRows.length) {
      return res.status(404).json({ message: "Child not found" });
    }

    if (Number(childRows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const [results] = await db.query(
      `SELECT * FROM reminders
       WHERE child_id = ? AND parent_id = ?
       ORDER BY created_at DESC`,
      [child_id, parent_id]
    );

    res.json({
      message: "Reminders fetched successfully",
      data: results
    });

  } catch (err) {
    console.error("GET CHILD REMINDERS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch reminders" });
  }
});


// ===============================
// 📥 CHILD VIEW
// ===============================
router.get("/received/:child_id", async (req, res) => {
  try {
    const { child_id } = req.params;

    const [results] = await db.query(
      `SELECT * FROM reminders
       WHERE child_id = ?
       ORDER BY created_at DESC`,
      [child_id]
    );

    res.json({
      message: "Received reminders fetched successfully",
      data: results
    });

  } catch (err) {
    console.error("GET RECEIVED ERROR:", err);
    res.status(500).json({ error: "Failed to fetch reminders" });
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

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    res.json({ message: "Reminder marked as read" });

  } catch (err) {
    console.error("READ ERROR:", err);
    res.status(500).json({ error: "Failed to update reminder" });
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

    if (!rows.length) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    if (Number(rows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await db.query("DELETE FROM reminders WHERE id = ?", [id]);

    res.json({ message: "Reminder deleted successfully" });

  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ error: "Failed to delete reminder" });
  }
});

module.exports = router;
