/**
 * Send reminder pushes via FCM so the child device gets notified when the app is
 * backgrounded or closed (Socket.IO alone cannot reach a disconnected client).
 */
const admin = require("firebase-admin");

let _messaging = null;
let _initAttempted = false;

function getMessaging() {
  if (_messaging) return _messaging;
  if (_initAttempted) return null;
  _initAttempted = true;

  try {
    if (admin.apps && admin.apps.length) {
      _messaging = admin.messaging();
      return _messaging;
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const cred = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(cred),
      });
    } else {
      admin.initializeApp();
    }
    _messaging = admin.messaging();
    console.log("Firebase Admin initialized (FCM enabled)");
  } catch (err) {
    console.warn(
      "FCM disabled: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS —",
      err.message
    );
    return null;
  }
  return _messaging;
}

/**
 * @param {import("mysql2/promise").Pool} db
 * @param {number} childId - children.id
 * @param {{ id: number, title: string, message: string, priority?: string }} reminder
 */
async function sendReminderPush(db, childId, reminder) {
  const messaging = getMessaging();
  if (!messaging) return;

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

module.exports = { sendReminderPush, getMessaging };
