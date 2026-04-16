const express = require("express");
const router = express.Router();
const db = require("../db");
const admin = require("../firebaseAdmin");
const verifyToken = require("../middleware/authMiddleware");

// ===============================
// SEND REMINDER TO CHILD
// ===============================
router.post("/send", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;
        const { child_id, message } = req.body;

        if (!child_id || !message) {
            return res.status(400).json({
                message: "child_id and message are required"
            });
        }

        const [childRows] = await db.query(
            "SELECT id, parent_id, fcm_token FROM children WHERE id = ?",
            [child_id]
        );

        if (childRows.length === 0) {
            return res.status(404).json({ message: "Child not found" });
        }

        if (childRows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const token = childRows[0].fcm_token;

        const [result] = await db.query(
            `INSERT INTO reminders (parent_id, child_id, message)
             VALUES (?, ?, ?)`,
            [parent_id, child_id, message]
        );

        const reminder_id = result.insertId;

        let notification_sent = false;

        if (token) {
            try {
                await admin.messaging().send({
                    token,
                    notification: {
                        title: "Reminder",
                        body: message,
                    },
                    data: {
                        reminder_id: String(reminder_id),
                        type: "reminder",
                    },
                    android: { priority: "high" },
                });

                notification_sent = true;
            } catch (err) {
                console.warn("FCM failed:", err.message);
            }
        }

        res.json({
            message: "Reminder sent successfully",
            reminder_id,
            notification_sent
        });

    } catch (err) {
        console.error("SEND REMINDER ERROR:", err);
        res.status(500).json({ error: "Failed to send reminder" });
    }
});


// ===============================
// GET ALL REMINDERS (PARENT)
// ===============================
router.get("/", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;

        const [results] = await db.query(
            `SELECT r.*, c.name AS child_name
             FROM reminders r
             JOIN children c ON r.child_id = c.id
             WHERE r.parent_id = ?
             ORDER BY r.sent_at DESC`,
            [parent_id]
        );

        res.json(results);

    } catch (err) {
        console.error("GET ALL REMINDERS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch reminders" });
    }
});


// ===============================
// GET REMINDERS FOR CHILD (PARENT VIEW)
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
            return res.status(404).json({ message: "Child not found" });
        }

        if (childRows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const [results] = await db.query(
            `SELECT * FROM reminders
             WHERE child_id = ? AND parent_id = ?
             ORDER BY sent_at DESC`,
            [child_id, parent_id]
        );

        res.json(results);

    } catch (err) {
        console.error("GET REMINDERS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch reminders" });
    }
});


// ===============================
// CHILD RECEIVES REMINDERS
// ===============================
router.get("/received/:child_id", verifyToken, async (req, res) => {
    try {
        const { child_id } = req.params;

        const [results] = await db.query(
            `SELECT * FROM reminders
             WHERE child_id = ?
             ORDER BY sent_at DESC`,
            [child_id]
        );

        res.json(results);

    } catch (err) {
        console.error("GET RECEIVED ERROR:", err);
        res.status(500).json({ error: "Failed to fetch reminders" });
    }
});


// ===============================
// MARK AS READ
// ===============================
router.put("/:id/read", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            `UPDATE reminders
             SET is_read = 1, read_at = NOW()
             WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Reminder not found" });
        }

        res.json({ message: "Marked as read" });

    } catch (err) {
        console.error("READ ERROR:", err);
        res.status(500).json({ error: "Failed to update reminder" });
    }
});


// ===============================
// DELETE REMINDER
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
            return res.status(404).json({ message: "Reminder not found" });
        }

        if (rows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await db.query("DELETE FROM reminders WHERE id = ?", [id]);

        res.json({ message: "Deleted successfully" });

    } catch (err) {
        console.error("DELETE ERROR:", err);
        res.status(500).json({ error: "Failed to delete reminder" });
    }
});


// ===============================
// STATS
// ===============================
router.get("/stats/all", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;

        const [stats] = await db.query(
            `SELECT 
                COUNT(*) AS total,
                COALESCE(SUM(is_read = 1), 0) AS read_count,
                COALESCE(SUM(is_read = 0), 0) AS unread_count
             FROM reminders
             WHERE parent_id = ?`,
            [parent_id]
        );

        res.json(stats[0]);

    } catch (err) {
        console.error("STATS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

module.exports = router;
