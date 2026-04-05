const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// SET LIMIT
router.post("/set", verifyToken, async (req, res) => {
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

// CHECK USAGE
router.get("/check/:child_id", verifyToken, async (req, res) => {
  try {
    const { child_id } = req.params;

    // Get total usage
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
    console.error("Error checking screen time limit:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

module.exports = router;
