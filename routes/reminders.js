const express = require("express");
const router = express.Router();
const db = require("../config/db");
const admin = require("../firebaseAdmin");

// Create and send reminder
router.post("/send", async (req, res) => {
    try {
        const { child_id, message } = req.body;

        // 1. Save reminder (for parent history)
        await db.query(
            "INSERT INTO notifications (child_id, message, type) VALUES (?, ?, ?)",
            [child_id, message, "reminder"]
        );

        // 2. Get child's FCM token
        const [rows] = await db.query(
            "SELECT fcm_token FROM users WHERE id = ?",
            [child_id]
        );

        const token = rows[0]?.fcm_token;

        // 3. Send push notification
        if (token) {
            await admin.messaging().send({
                token: token,
                notification: {
                    title: "Reminder",
                    body: message,
                },
            });
        }

        res.json({ message: "Reminder sent successfully" });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
