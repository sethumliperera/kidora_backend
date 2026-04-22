const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

const GAMING_KEYWORDS = [
  "game",
  "roblox",
  "free fire",
  "pubg",
  "call of duty",
  "minecraft",
  "clash",
  "brawl stars",
  "subway surfers",
];

const HARMFUL_CONTENT_KEYWORDS = [
  "adult",
  "xxx",
  "porn",
  "casino",
  "bet",
  "gambling",
  "drugs",
];

const EXCESSIVE_GAMING_SECONDS = 60 * 60;
const LATE_NIGHT_START_HOUR = 23;
const LATE_NIGHT_END_HOUR = 5;
const NOTIFICATION_COOLDOWN_MINUTES = 60;

function createSassyMessage(type, childName, appName, totalScreenTimeSeconds) {
  if (type === "excessive_screen_time") {
    const hours = (totalScreenTimeSeconds / 3600).toFixed(1);
    return `${childName} is in full screen-marathon mode (${hours}h today). Maybe eyes need a tiny vacation?`;
  }

  if (type === "harmful_content_detected") {
    return `${childName} just opened ${appName} and it looks sketchy. Red flag energy activated.`;
  }

  if (type === "excessive_gaming") {
    return `${childName} is seriously grinding ${appName}. Gamer era is strong right now.`;
  }

  if (type === "late_night_device_usage") {
    return `${childName} is still on ${appName} at night. Sleep schedule said "no thanks".`;
  }

  return `${childName} opened ${appName}.`;
}

function buildAlertTypes({
  appName,
  durationSeconds,
  totalScreenTimeSeconds,
  screenTimeLimitMinutes,
  now,
}) {
  const normalized = String(appName || "").toLowerCase();
  const alerts = [];

  if (
    screenTimeLimitMinutes > 0 &&
    totalScreenTimeSeconds >= screenTimeLimitMinutes * 60
  ) {
    alerts.push("excessive_screen_time");
  }

  if (
    GAMING_KEYWORDS.some((keyword) => normalized.includes(keyword)) &&
    durationSeconds >= EXCESSIVE_GAMING_SECONDS
  ) {
    alerts.push("excessive_gaming");
  }

  if (HARMFUL_CONTENT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    alerts.push("harmful_content_detected");
  }

  const hour = now.getHours();
  const isLateNight = hour >= LATE_NIGHT_START_HOUR || hour < LATE_NIGHT_END_HOUR;
  if (isLateNight) {
    alerts.push("late_night_device_usage");
  }

  return alerts;
}

function maybeCreateParentNotification(childId, appName, durationSeconds) {
  const parsedDuration = Number(durationSeconds) || 0;
  if (parsedDuration <= 0) return;

  const findChildSql =
    "SELECT id, name, parent_id, screen_time_limit FROM children WHERE id = ? LIMIT 1";

  db.query(findChildSql, [childId], (childErr, childRows) => {
    if (childErr) {
      console.error("Notification child lookup failed:", childErr);
      return;
    }

    if (!childRows || childRows.length === 0) return;

    const child = childRows[0];
    const childName = child.name || "Your child";
    const usageSql = `
      SELECT COALESCE(SUM(duration_seconds), 0) AS total_screen_time_seconds
      FROM app_usage
      WHERE child_id = ? AND DATE(start_time) = CURDATE()
    `;

    db.query(usageSql, [child.id], (usageErr, usageRows) => {
      if (usageErr) {
        console.error("Notification usage lookup failed:", usageErr);
        return;
      }

      const totalScreenTimeSeconds =
        Number(usageRows?.[0]?.total_screen_time_seconds) || 0;

      const alertTypes = buildAlertTypes({
        appName,
        durationSeconds: parsedDuration,
        totalScreenTimeSeconds,
        screenTimeLimitMinutes: Number(child.screen_time_limit) || 0,
        now: new Date(),
      });

      if (alertTypes.length === 0) return;

      alertTypes.forEach((alertType) => {
        const message = createSassyMessage(
          alertType,
          childName,
          appName,
          totalScreenTimeSeconds
        );

        const cooldownSql = `
          SELECT id
          FROM notifications
          WHERE parent_id = ?
            AND child_id = ?
            AND type = ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          LIMIT 1
        `;

        db.query(
          cooldownSql,
          [child.parent_id, child.id, alertType, NOTIFICATION_COOLDOWN_MINUTES],
          (cooldownErr, existingRows) => {
            if (cooldownErr) {
              console.error("Notification cooldown check failed:", cooldownErr);
              return;
            }

            if (existingRows && existingRows.length > 0) return;

            const insertSql = `
              INSERT INTO notifications (parent_id, child_id, message, type)
              VALUES (?, ?, ?, ?)
            `;

            db.query(
              insertSql,
              [child.parent_id, child.id, message, alertType],
              (insertErr) => {
                if (insertErr) {
                  console.error("Notification insert failed:", insertErr);
                }
              }
            );
          }
        );
      });
    });
  });
}

// ADD APP USAGE (SESSION TRACKING)
router.post("/track", verifyToken, (req, res) => {
  const { child_id, app_name, start_time, end_time, duration_seconds } = req.body;

  if (!child_id || !app_name || !start_time || !end_time || duration_seconds === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const sql = `
    INSERT INTO app_usage (child_id, app_name, start_time, end_time, duration_seconds)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    end_time = VALUES(end_time),
    duration_seconds = VALUES(duration_seconds)
  `;

  db.query(sql, [child_id, app_name, start_time, end_time, duration_seconds], (err) => {
    if (err) {
      console.error("Error inserting app usage:", err);
      return res.status(500).json({ error: "Database error" });
    }

    maybeCreateParentNotification(child_id, app_name, duration_seconds);
    res.json({ message: "App usage session recorded" });
  });
});

// GET TODAY'S APP USAGE SUMMARY
router.get("/get-usage/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  const sql = `
    SELECT
      app_name,
      SUM(duration_seconds) as total_duration
    FROM app_usage
    WHERE child_id = ? AND DATE(start_time) = CURDATE()
    GROUP BY app_name
    ORDER BY total_duration DESC
  `;

  db.query(sql, [child_id], (err, results) => {
    if (err) {
      console.error("Error fetching usage summary:", err);
      return res.status(500).json({ error: "Database error" });
    }

    let total_screen_time = 0;
    const apps = results.map((row) => {
      const duration = parseInt(row.total_duration, 10) || 0;
      total_screen_time += duration;
      return {
        app_name: row.app_name,
        duration: duration,
      };
    });

    res.json({
      total_screen_time: total_screen_time,
      apps: apps,
    });
  });
});

// GET WEEKLY USAGE (Historical)
router.get("/get-weekly-usage/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  const sql = `
    SELECT
      DATE(start_time) as date,
      SUM(duration_seconds) as total_duration
    FROM app_usage
    WHERE child_id = ? AND start_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(start_time)
    ORDER BY date ASC
  `;

  db.query(sql, [child_id], (err, results) => {
    if (err) {
      console.error("Error fetching weekly usage:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

module.exports = router;
