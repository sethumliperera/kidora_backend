/**
 * Create a parent notification row and send FCM (works when app is closed).
 */
const db = require("./db");
const admin = require("./firebaseAdmin");

async function sendParentPush(parentId, payload) {
  const messaging = admin.messaging();

  const [rows] = await db.query(
    "SELECT fcm_token FROM users WHERE id = ? LIMIT 1",
    [parentId]
  );
  if (!rows.length) return false;

  const token = rows[0].fcm_token;
  if (!token || String(token).trim() === "") {
    console.log(`No parent FCM token for parent_id=${parentId}, skipping push`);
    return false;
  }

  const title = String(payload.title || "Kidora").slice(0, 200);
  const body = String(payload.body || "").slice(0, 2000);
  const data = payload.data || {};
  const badge = Math.max(0, Number(payload.badge) || 0);

  try {
    await messaging.send({
      token: String(token).trim(),
      notification: { title, body },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
        ),
        type: data.type || "parent_alert",
        unread_count: String(badge),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "kidora_channel",
          sound: "default",
          notificationCount: badge > 0 ? badge : undefined,
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "default",
            badge,
            contentAvailable: true,
          },
        },
      },
    });
    console.log(`FCM parent push sent parent_id=${parentId} badge=${badge}`);
    return true;
  } catch (err) {
    console.error(
      `FCM parent push failed (parent_id=${parentId}):`,
      err.message || err
    );
    return false;
  }
}

let _tableReady = false;

async function ensureNotificationsTable() {
  if (_tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      parent_id INT,
      child_id INT NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(100) DEFAULT 'general',
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    await db.query(
      "ALTER TABLE notifications ADD COLUMN is_read TINYINT DEFAULT 0"
    );
  } catch (err) {
    if (err.errno !== 1060 && !String(err.message || "").includes("Duplicate")) {
      console.warn("ensureNotificationsTable is_read:", err.message);
    }
  }
  _tableReady = true;
}

async function getParentUnreadCount(parentId) {
  await ensureNotificationsTable();
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM notifications
     WHERE parent_id = ? AND (is_read = 0 OR is_read IS NULL)`,
    [parentId]
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * @param {{ parentId: number, childId: number, message: string, type: string, title?: string }} opts
 */
async function notifyParent(opts) {
  const { parentId, childId, message, type, title } = opts;
  if (!parentId || !childId || !message) {
    throw new Error("notifyParent: parentId, childId, and message are required");
  }

  await ensureNotificationsTable();

  const [result] = await db.query(
    `INSERT INTO notifications (parent_id, child_id, message, type, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [parentId, childId, message, type || "general"]
  );

  const unreadCount = await getParentUnreadCount(parentId);
  const notifTitle =
    title ||
    (type === "safety_search" || type === "safety_search_private"
      ? "Urgent: Flagged search"
      : type === "new_app_installed"
        ? "New app installed"
        : "Kidora alert");

  await sendParentPush(parentId, {
    title: notifTitle,
    body: String(message).slice(0, 500),
    badge: unreadCount,
    data: {
      type: "parent_alert",
      alert_type: String(type || "general"),
      notification_id: String(result.insertId),
      child_id: String(childId),
      unread_count: String(unreadCount),
    },
  });

  return { id: result.insertId, unreadCount };
}

module.exports = {
  notifyParent,
  getParentUnreadCount,
  ensureNotificationsTable,
};
