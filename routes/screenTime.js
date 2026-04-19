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

// ===============================
// 💾 SAVE USAGE (from child background service)
// POST /api/screen-time/save-usage
// Body: { child_id, total_screen_time, usage: [{ app_name, duration }] }
// ===============================
router.post("/save-usage", async (req, res) => {
  try {
    await ensureTable();

    const { child_id, total_screen_time, usage } = req.body;

    if (!child_id || !usage || !Array.isArray(usage)) {
      return res.status(400).json({ error: "child_id and usage[] are required" });
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Upsert each app's usage for today
    for (const app of usage) {
      if (!app.app_name || app.duration === undefined) continue;

      await db.query(
        `INSERT INTO daily_screen_time (child_id, app_name, date, duration_seconds)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE duration_seconds = VALUES(duration_seconds)`,
        [child_id, app.app_name, today, Math.max(0, parseInt(app.duration) || 0)]
      );
    }

    // Also update the children table for live presence polling
    try {
      await db.query(
        `UPDATE children SET rt_day = ?, rt_today_seconds = ? WHERE id = ?`,
        [today, Math.max(0, parseInt(total_screen_time) || 0), child_id]
      );
    } catch (e) {
      // Columns might not exist yet — ignore
      console.warn("Could not update rt_ columns:", e.message);
    }

    res.json({ message: "Usage saved successfully" });
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

    const { child_id } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [results] = await db.query(
      `SELECT app_name, duration_seconds as duration
       FROM daily_screen_time
       WHERE child_id = ? AND date = ?
       ORDER BY duration_seconds DESC`,
      [child_id, date]
    );

    let total_screen_time = 0;
    const apps = results.map(row => {
      const duration = parseInt(row.duration, 10) || 0;
      total_screen_time += duration;
      return {
        app_name: row.app_name,
        duration: duration
      };
    });

    res.json({
      date: date,
      total_screen_time: total_screen_time,
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

    const { child_id } = req.params;
    const days = parseInt(req.query.days) || 7;

    const [results] = await db.query(
      `SELECT date, SUM(duration_seconds) as total_duration
       FROM daily_screen_time
       WHERE child_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY date
       ORDER BY date ASC`,
      [child_id, days]
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

    const { child_id } = req.params;
    const today = new Date().toISOString().slice(0, 10);

    // Get total usage from daily_screen_time
    const [usageResult] = await db.query(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total_usage
       FROM daily_screen_time
       WHERE child_id = ? AND date = ?`,
      [child_id, today]
    );
    const totalUsage = parseInt(usageResult[0].total_usage, 10) || 0;

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
