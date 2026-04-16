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
      INSERT INTO screen_time_limits (child_id, daily_limit)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE daily_limit = VALUES(daily_limit)
    `;

    await db.query(sql, [child_id, daily_limit]);

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

    console.log("CHECK API HIT for child:", child_id);

    // Total usage for today
    const usageSql = `
      SELECT SUM(duration_seconds) as total_usage
      FROM app_usage
      WHERE child_id = ? AND DATE(start_time) = CURDATE()
    `;

    const [usageResult] = await db.query(usageSql, [child_id]);
    const totalUsage = usageResult[0].total_usage || 0;

    // Get limit
    const limitSql = `
      SELECT daily_limit
      FROM screen_time_limits
      WHERE child_id = ?
    `;

    const [limitResult] = await db.query(limitSql, [child_id]);
    const limit = limitResult[0]?.daily_limit || 0;

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
// SAVE USAGE
// ==========================
router.post("/save-usage", async (req, res) => {
  try {
    const { child_id, usage } = req.body;

    for (const app of usage) {
      await db.query(
        `INSERT INTO app_usage (child_id, package_name, duration_seconds, start_time)
         VALUES (?, ?, ?, NOW())`,
        [child_id, app.package, app.time]
      );
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Error saving usage:", err);
    res.status(500).json({ error: "Database error" });
  }
});


// ==========================
// GET USAGE (PARENT DASHBOARD)
// ==========================
router.get("/usage/:child_id", async (req, res) => {
  try {
    const { child_id } = req.params;

    const sql = `
      SELECT package_name, SUM(duration_seconds) as total
      FROM app_usage
      WHERE child_id = ? AND DATE(start_time) = CURDATE()
      GROUP BY package_name
    `;

    const [rows] = await db.query(sql, [child_id]);

    res.json(rows);

  } catch (err) {
    console.error("Error getting usage:", err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
