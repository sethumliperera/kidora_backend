const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// SET LIMIT
router.post("/set", verifyToken, (req, res) => {
  const { child_id, daily_limit } = req.body;

  const sql = `
    INSERT INTO screen_time_limits (child_id, daily_limit)
    VALUES (?, ?)
  `;

  db.query(sql, [child_id, daily_limit], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Limit set successfully" });
  });
});

// CHECK USAGE
router.get("/check/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  // Get total usage
  const usageSql = `
    SELECT SUM(usage_time) as total_usage
    FROM app_usage
    WHERE child_id = ?
  `;

  db.query(usageSql, [child_id], (err, usageResult) => {
    if (err) return res.status(500).json(err);

    const totalUsage = usageResult[0].total_usage || 0;

    // Get limit
    const limitSql = `
      SELECT daily_limit
      FROM screen_time_limits
      WHERE child_id = ?
    `;

    db.query(limitSql, [child_id], (err, limitResult) => {
      if (err) return res.status(500).json(err);

      const limit = limitResult[0]?.daily_limit || 0;

      let status = "OK";

      if (totalUsage >= limit) {
        status = "BLOCK";
      } else if (totalUsage >= limit * 0.8) {
        status = "WARNING";
      }

      res.json({
        total_usage: totalUsage,
        limit: limit,
        status: status
      });
    });
  });
});

module.exports = router;
