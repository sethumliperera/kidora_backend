/**
 * Child reminder pushes via FCM (works when app is closed).
 */
const admin = require("./firebaseAdmin");

/**
 * @param {import("mysql2/promise").Pool} db
 * @param {number} childId - children.id
 * @param {{ id: number, title: string, message: string, priority?: string }} reminder
 */
async function sendReminderPush(db, childId, reminder) {
  const messaging = admin.messaging();

  const [rows] = await db.query(
    "SELECT fcm_token FROM children WHERE id = ? LIMIT 1",
    [childId]
  );
  if (!rows.length) return;
  const token = rows[0].fcm_token;
  if (!token || String(token).trim() === "") {
    console.log(`No FCM token for child_id=${childId}, skipping push`);
    return;
  }

  const title = String(reminder.title || "Reminder").slice(0, 200);
  const body = String(reminder.message || "").slice(0, 2000);
  const idStr = String(reminder.id);
  const priority = String(reminder.priority || "normal").toLowerCase();
  const notifTitle = priority === "urgent" ? "Urgent: " + title : title;

  const data = {
    type: "reminder",
    id: idStr,
    title,
    message: body,
    priority,
  };

  try {
    await messaging.send({
      token: String(token).trim(),
      notification: { title: notifTitle, body },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "kidora_channel",
          sound: "default",
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: { sound: "default", contentAvailable: true },
        },
      },
    });
    console.log(`FCM reminder sent to child_id=${childId} reminder_id=${idStr}`);
  } catch (err) {
    console.error(`FCM send failed (child_id=${childId}):`, err.message || err);
  }
}

module.exports = { sendReminderPush };
