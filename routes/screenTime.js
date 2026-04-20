const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// ===============================
// 🛠 AUTO-CREATE daily_screen_time TABLE
// ===============================
const ensureTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_screen_time (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      duration_seconds INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_child_app_date (child_id, app_name, date),
      INDEX idx_child_date (child_id, date)
    )
  `);
};

const ensureTotalsTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_screen_time_totals (
      child_id INT NOT NULL,
      date DATE NOT NULL,
      total_seconds INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (child_id, date),
      INDEX idx_child_totals_date (child_id, date)
    )
  `);
};

const ensureInstalledAppsTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS installed_apps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      package_name VARCHAR(255) NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_child_pkg (child_id, package_name)
    )
  `);
};

// One row per child + app + calendar day (start_time = local midnight) for history + dashboards
const ensureAppUsageTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_usage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      duration_seconds INT NOT NULL DEFAULT 0,
      UNIQUE KEY unique_child_app_day_start (child_id, app_name, start_time)
    )
  `);
};

function parseLocalDate(body, query) {
  const q = query && query.date;
  const raw =
    (body && body.local_date) ||
    (Array.isArray(q) ? q[0] : q) ||
    null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date().toISOString().slice(0, 10);
  }
  return raw;
}

// ===============================
// 💾 SAVE USAGE (child app: foreground + background service)
// POST /api/screen-time/save-usage
// Body: { child_id, local_date?, total_screen_time, usage: [{ app_name, duration }] }
// Writes: daily_screen_time (per app per day), daily_screen_time_totals (per child per day),
//         app_usage (daily rollup row per app), children.rt_day / rt_today_seconds when columns exist
// ===============================
router.post("/save-usage", async (req, res) => {
  try {
    await ensureTable();
    await ensureTotalsTable();
    await ensureAppUsageTable();

    const { child_id, total_screen_time, usage } = req.body;

    if (!child_id || !usage || !Array.isArray(usage)) {
      return res.status(400).json({ error: "child_id and usage[] are required" });
    }

    // Device-local calendar day (must match Android midnight); falls back to UTC date.
    const day = parseLocalDate(req.body, req.query);
    const dayStart = `${day} 00:00:00`;

    // Upsert each app's usage for this local day (app_name = package name from the device)
    for (const app of usage) {
      if (!app.app_name || app.duration === undefined) continue;
      const duration = Math.max(0, parseInt(app.duration) || 0);

      await db.query(
        `INSERT INTO daily_screen_time (child_id, app_name, date, duration_seconds)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE duration_seconds = VALUES(duration_seconds)`,
        [child_id, app.app_name, day, duration]
      );

      // Daily rollup in app_usage (same local day = same start_time → upsert)
      try {
        await db.query(
          `INSERT INTO app_usage (child_id, app_name, start_time, end_time, duration_seconds)
           VALUES (?, ?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE
             end_time = NOW(),
             duration_seconds = VALUES(duration_seconds)`,
          [child_id, app.app_name, dayStart, duration]
        );
      } catch (e) {
        console.warn("Could not log to app_usage:", e.message);
      }
    }

    const totalSecs = Math.max(0, parseInt(total_screen_time, 10) || 0);
    await db.query(
      `INSERT INTO daily_screen_time_totals (child_id, date, total_seconds)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE total_seconds = VALUES(total_seconds), updated_at = CURRENT_TIMESTAMP`,
      [child_id, day, totalSecs]
    );

    // Also update the children table for live presence polling (only when this payload is "today" on the device)
    try {
      await db.query(
        `UPDATE children SET rt_day = ?, rt_today_seconds = ? WHERE id = ?`,
        [day, totalSecs, child_id]
      );
    } catch (e) {
      // Columns might not exist yet — ignore
      console.warn("Could not update rt_ columns:", e.message);
    }

    res.json({ message: "Usage saved successfully", date: day });
  } catch (err) {
    console.error("SAVE USAGE ERROR:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ===============================
// 📊 GET USAGE FOR A SPECIFIC DAY
// GET /api/screen-time/usage/:child_id?date=YYYY-MM-DD
// Returns: { date, total_screen_time, apps: [{ app_name, duration }] }
// ===============================
router.get("/usage/:child_id", async (req, res) => {
  try {
    await ensureTable();
    await ensureTotalsTable();
    await ensureInstalledAppsTable();

    const { child_id } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [totRows] = await db.query(
      `SELECT total_seconds FROM daily_screen_time_totals WHERE child_id = ? AND date = ?`,
      [child_id, date]
    );

    const [results] = await db.query(
      `SELECT d.app_name AS package_name,
              COALESCE(i.app_name, d.app_name) AS app_name,
              d.duration_seconds AS duration
       FROM daily_screen_time d
       LEFT JOIN installed_apps i
         ON i.child_id = d.child_id AND i.package_name = d.app_name
       WHERE d.child_id = ? AND d.date = ?
       ORDER BY d.duration_seconds DESC`,
      [child_id, date]
    );

    let sumApps = 0;
    const apps = results.map((row) => {
      const duration = parseInt(row.duration, 10) || 0;
      sumApps += duration;
      return {
        package_name: row.package_name,
        app_name: row.app_name,
        duration: duration
      };
    });

    const storedTotal =
      totRows.length > 0 ? parseInt(totRows[0].total_seconds, 10) || 0 : 0;
    const total_screen_time = storedTotal > 0 ? storedTotal : sumApps;

    res.json({
      date: date,
      total_screen_time: total_screen_time,
      total_app_sum_seconds: sumApps,
      apps: apps
    });
  } catch (err) {
    console.error("GET USAGE ERROR:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ===============================
// 📅 GET USAGE HISTORY (Last N days)
// GET /api/screen-time/usage/:child_id/history?days=7
// Returns: [{ date, total_duration }]
// ===============================
router.get("/usage/:child_id/history", async (req, res) => {
  try {
    await ensureTable();
    await ensureTotalsTable();

    const { child_id } = req.params;
    const days = parseInt(req.query.days, 10) || 7;

    const [results] = await db.query(
      `SELECT a.date AS date,
              COALESCE(t.total_seconds, a.total_duration) AS total_duration
       FROM (
         SELECT date, SUM(duration_seconds) AS total_duration
         FROM daily_screen_time
         WHERE child_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY date
       ) a
       LEFT JOIN daily_screen_time_totals t
         ON t.child_id = ? AND t.date = a.date
       ORDER BY a.date ASC`,
      [child_id, days, child_id]
    );

    res.json(results);
  } catch (err) {
    console.error("GET HISTORY ERROR:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ===============================
// ⏱ CHECK SCREEN TIME (total vs limit)
// GET /api/screen-time/check/:child_id
// Returns: { total_usage, limit, status }
// ===============================
router.get("/check/:child_id", async (req, res) => {
  try {
    await ensureTable();
    await ensureTotalsTable();

    const { child_id } = req.params;
    const today = parseLocalDate({}, req.query);

    const [totRow] = await db.query(
      `SELECT total_seconds FROM daily_screen_time_totals WHERE child_id = ? AND date = ?`,
      [child_id, today]
    );
    const [usageResult] = await db.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total_usage
       FROM daily_screen_time
       WHERE child_id = ? AND date = ?`,
      [child_id, today]
    );
    const fromTotals =
      totRow.length > 0 ? parseInt(totRow[0].total_seconds, 10) || 0 : 0;
    const fromSum = parseInt(usageResult[0].total_usage, 10) || 0;
    const totalUsage = fromTotals > 0 ? fromTotals : fromSum;

    // Get limit from children table (screen_time_limit is in minutes)
    const [childResult] = await db.query(
      `SELECT screen_time_limit FROM children WHERE id = ?`,
      [child_id]
    );

    // Convert minutes to seconds for comparison
    const limitMinutes = childResult[0]?.screen_time_limit || 120;
    const limitSeconds = limitMinutes * 60;

    let status = "OK";
    if (limitSeconds > 0) {
      if (totalUsage >= limitSeconds) {
        status = "BLOCK";
      } else if (totalUsage >= limitSeconds * 0.8) {
        status = "WARNING";
      }
    }

    res.json({
      total_usage: totalUsage,
      limit: limitSeconds,
      limit_minutes: limitMinutes,
      status: status
    });
  } catch (err) {
    console.error("CHECK SCREEN TIME ERROR:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ===============================
// 🔒 SET DAILY LIMIT
// POST /api/screen-time/set
// ===============================
router.post("/set", verifyToken, async (req, res) => {
  try {
    const { child_id, daily_limit } = req.body;

    // daily_limit here is in minutes
    await db.query(
      `UPDATE children SET screen_time_limit = ? WHERE id = ?`,
      [daily_limit, child_id]
    );

    res.json({ message: "Limit set successfully" });
  } catch (err) {
    console.error("SET LIMIT ERROR:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

module.exports = router;
