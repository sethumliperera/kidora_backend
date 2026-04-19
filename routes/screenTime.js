const express = require("express");
const router = express.Router();
const db = require("../db");

// ==========================
// SET SCREEN TIME LIMIT
// ==========================
router.post("/set", async (req, res) => {
  try {
    const { child_id, daily_limit } = req.body;

    const sql = `
      INSERT INTO screen_time_limits (child_id, daily_limit_seconds)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE daily_limit_seconds = VALUES(daily_limit_seconds)
    `;

    await db.query(sql, [child_id, daily_limit]);

    console.log("Limit set for child:", child_id);

    res.json({ message: "Limit set successfully" });
  } catch (err) {
    console.error("Error setting screen time limit:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


// ==========================
// CHECK SCREEN TIME
// ==========================
router.get("/check/:child_id", async (req, res) => {
  try {
    const { child_id } = req.params;

    console.log("🔍 CHECK API HIT for child:", child_id);

    const usageSql = `
      SELECT SUM(duration_seconds) as total_usage
      FROM app_usage
      WHERE child_id = ? AND DATE(start_time) = CURDATE()
    `;

    const [usageResult] = await db.query(usageSql, [child_id]);
    const totalUsage = usageResult[0].total_usage || 0;

    const limitSql = `
      SELECT daily_limit_seconds
      FROM screen_time_limits
      WHERE child_id = ?
    `;

    const [limitResult] = await db.query(limitSql, [child_id]);
    const limit = limitResult[0]?.daily_limit_seconds || 0;

    let status = "OK";

    if (limit > 0) {
      if (totalUsage >= limit) {
        status = "BLOCK";
      } else if (totalUsage >= limit * 0.8) {
        status = "WARNING";
      }
    }

    res.json({
      total_usage: totalUsage,
      limit: limit,
      status: status
    });

  } catch (err) {
    console.error("Error checking screen time:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


// ==========================
// SAVE USAGE (FIXED)
// ==========================
router.post("/save-usage", async (req, res) => {
  try {
    const { child_id, usage } = req.body;

    console.log("📥 Incoming usage:", req.body);

    if (!child_id || !usage || !Array.isArray(usage)) {
      return res.status(400).json({ error: "Invalid request format" });
    }

    for (const app of usage) {
      const appName = app.package || "unknown";
      const time = app.time || 0;

      if (time <= 0) continue;

      await db.query(
        `INSERT INTO app_usage (child_id, app_name, duration_seconds, start_time)
         VALUES (?, ?, ?, NOW())`,
        [child_id, appName, time]
      );

      console.log(`Inserted: ${appName} - ${time}s`);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Error saving usage:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});


// ==========================
// GET USAGE (PARENT DASHBOARD)
// ==========================
router.get("/usage/:child_id", async (req, res) => {
  try {
    const { child_id } = req.params;

    const sql = `
      SELECT app_name, SUM(duration_seconds) as total
      FROM app_usage
      WHERE child_id = ? AND DATE(start_time) = CURDATE()
      GROUP BY app_name
    `;

    const [rows] = await db.query(sql, [child_id]);

    res.json(rows);

  } catch (err) {
    console.error(" Error getting usage:", err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
