/**
 * Send reminder pushes via FCM so the child device gets notified when the app is
 * backgrounded or closed (Socket.IO alone cannot reach a disconnected client).
 */
const admin = require("firebase-admin");

let _messaging = null;
let _initAttempted = false;

function getMessaging() {
  if (_messaging) return _messaging;
  // If another module (e.g. firebaseAdmin.js) already initialized the default app,
  // always attach messaging — do NOT bail out just because an earlier init attempt failed.
  try {
    if (admin.apps && admin.apps.length) {
      _messaging = admin.messaging();
      return _messaging;
    }
  } catch (e) {
    console.warn("[fcm] messaging from existing Firebase app:", e?.message || e);
  }
  if (_initAttempted) return null;
  _initAttempted = true;

  try {
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

let _usersFcmColumnEnsured = false;

/**
 * Adds users.fcm_token when missing (idempotent).
 * @param {import("mysql2/promise").Pool} db
 */
async function ensureUsersFcmTokenColumn(db) {
  if (_usersFcmColumnEnsured) return;
  try {
    await db.query("ALTER TABLE users ADD COLUMN fcm_token TEXT NULL");
  } catch (e) {
    const dup =
      e.code === "ER_DUP_FIELDNAME" ||
      String(e.message || "").toLowerCase().includes("duplicate column");
    if (!dup) {
      console.warn("ensureUsersFcmTokenColumn:", e.message || e);
    }
  }
  _usersFcmColumnEnsured = true;
}

/**
 * Push to the parent's device (FCM) when the app is killed or in background.
 * @returns {Promise<{ sent: boolean, skipped?: string, error?: string }>}
 */
async function sendParentNotificationPush(db, parentId, payload) {
  const messaging = getMessaging();
  if (!messaging) {
    return { sent: false, skipped: "no_messaging_sdk" };
  }

  await ensureUsersFcmTokenColumn(db);

  const [rows] = await db.query(
    "SELECT fcm_token FROM users WHERE id = ? LIMIT 1",
    [parentId]
  );
  if (!rows.length) {
    return { sent: false, skipped: "no_user_row" };
  }
  const token = rows[0].fcm_token;
  if (!token || String(token).trim() === "") {
    console.log(`No parent FCM token for user id=${parentId}, skipping push`);
    return { sent: false, skipped: "no_parent_fcm_token" };
  }

  const title = String(payload.title || "Kidora").slice(0, 200);
  const body = String(payload.body || "").slice(0, 2000);
  const type = String(payload.type || "parent_alert");
  const childId = payload.childId != null ? String(payload.childId) : "";
  const querySnip =
    payload.query != null ? String(payload.query).slice(0, 300) : "";

  const data = {
    type,
    child_id: childId,
    title,
    message: body,
    query: querySnip,
  };

  try {
    await messaging.send({
      token: String(token).trim(),
      notification: { title, body },
      data,
      android: {
        priority: "high",
        ttl: 86400 * 1000,
        notification: {
          channelId: "kidora_channel",
          sound: "default",
          defaultVibrateTimings: true,
          visibility: "PUBLIC",
          priority: "max",
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
            alert: { title, body },
          },
        },
      },
    });
    console.log(`FCM parent alert sent parent_id=${parentId} type=${type}`);
    return { sent: true };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`FCM parent send failed (parent_id=${parentId}):`, msg);
    return { sent: false, error: msg.slice(0, 400) };
  }
}

module.exports = {
  sendReminderPush,
  sendParentNotificationPush,
  ensureUsersFcmTokenColumn,
  getMessaging,
};
