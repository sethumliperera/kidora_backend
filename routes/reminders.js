const express = require("express");
const router = express.Router();
const db = require("../db");

// ===============================
//  GET REMINDERS
// ===============================
router.get("/:id/reminders", async (req, res) => {
  try {
    const child_id = req.params.id;

    const [results] = await db.query(
      "SELECT * FROM reminders WHERE child_id = ? ORDER BY id DESC",
      [child_id]
    );

    res.json(results);
  } catch (err) {
    console.error("GET REMINDERS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch reminders", error: err.message });
  }
});

// ===============================
//  SEND REMINDER (DB + SOCKET)
// ===============================
router.post("/:id/reminders", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { message, time, type, priority } = req.body;

    if (!message) {
      return res.status(400).json({ message: "message is required" });
    }

    //  Create table if missing
    await db.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        message TEXT NOT NULL,
        time VARCHAR(50),
        type VARCHAR(50) DEFAULT 'Alert',
        priority VARCHAR(20) DEFAULT 'Normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    //  Save to database
    const [result] = await db.query(
      "INSERT INTO reminders (child_id, message, time, type, priority) VALUES (?, ?, ?, ?, ?)",
      [child_id, message, time || new Date().toISOString(), type || "Alert", priority || "Normal"]
    );

    const reminder = {
      id: result.insertId,
      child_id,
      message,
      time,
      type,
      priority
    };

    //  SOCKET PUSH (REAL-TIME)
    const io = req.app.get("io");

    if (io) {
      io.to("child_" + child_id).emit("reminder", reminder);
      console.log("Reminder sent via socket to child_" + child_id);
    }

    res.json({
      message: "Reminder sent successfully",
      reminder
    });

  } catch (err) {
    console.error("SEND REMINDER ERROR:", err);
    res.status(500).json({ message: "Failed to send reminder", error: err.message });
  }
});

module.exports = router;
