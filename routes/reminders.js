const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const { sendReminderPush } = require("../fcmReminders");

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
      return res.status(400).json({ message: "child_id and message are required" });
    }

    // 1. VERIFY CHILD OWNERSHIP
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

    // 2. INSERT REMINDER
    const [result] = await db.query(
      `INSERT INTO reminders 
      (parent_id, child_id, title, message, priority, scheduled_at, frequency, is_sent, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [parent_id, child_id, title, message, priority, scheduled_at, frequency]
    );

    const reminder_id = result.insertId;

    // 3. SOCKET EMIT
    const io = req.app.get("io");

    const isImmediate =
      !scheduled_at ||
      new Date(scheduled_at).getTime() <= Date.now() + 5000;

    const room = `child_${child_id}`;

    console.log("📡 Target room:", room);

    if (io && isImmediate) {
      const payload = {
        title: priority === "urgent" ? "🚨 Urgent Reminder" : "📢 Reminder",
        message,
        reminder_id,
        priority,
        time: new Date().toISOString()
      };

      console.log("📤 Emitting reminder:", payload);

      io.to(room).emit("reminder", payload);

      await sendReminderPush(db, child_id, {
        id: reminder_id,
        title,
        message,
        priority,
      });

      await db.query(
        "UPDATE reminders SET is_sent = 1, sent_at = NOW() WHERE id = ?",
        [reminder_id]
      );
    } else {
      console.log("⏳ Not emitted (scheduled or io missing)");
    }

    // 4. OPTIONAL SCHEDULER
    try {
      const scheduler = require("../scheduler");

      if (frequency !== "once" || !isImmediate) {
        scheduler.scheduleReminder({
          id: reminder_id,
          child_id,
          title,
          message,
          priority,
          scheduled_at,
          frequency
        });
      }
    } catch (err) {
      console.log("⚠ Scheduler not active:", err.message);
    }

    return res.json({
      message: isImmediate ? "Reminder sent" : "Reminder scheduled",
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

    const [rows] = await db.query(
      "SELECT parent_id FROM children WHERE id = ?",
      [child_id]
    );

    if (!rows.length) return res.status(404).json({ message: "Child not found" });

    if (Number(rows[0].parent_id) !== Number(parent_id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const [results] = await db.query(
      `SELECT * FROM reminders
       WHERE child_id = ? AND parent_id = ?
       ORDER BY created_at DESC`,
      [child_id, parent_id]
    );

    res.json({ data: results });

  } catch (err) {
    console.error("GET ERROR:", err);
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

    res.json({ data: results });

  } catch (err) {
    console.error("RECEIVED ERROR:", err);
    res.status(500).json({ error: "Failed to fetch reminders" });
  }
});


// ===============================
// ✔ MARK AS READ
// ===============================
router.put("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      "UPDATE reminders SET is_read = 1, read_at = NOW() WHERE id = ?",
      [id]
    );

    res.json({ message: "Marked as read" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update" });
  }
});


// ===============================
// 🗑 DELETE
// ===============================
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;
    const { id } = req.params;

    const [rows] = await db.query(
      "SELECT parent_id FROM reminders WHERE id = ?",
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: "Not found" });

    if (rows[0].parent_id !== parent_id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await db.query("DELETE FROM reminders WHERE id = ?", [id]);

    res.json({ message: "Deleted" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
