const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

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

  db.query(sql, [child_id, app_name, start_time, end_time, duration_seconds], (err, result) => {
    if (err) {
      console.error("Error inserting app usage:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ message: "App usage session recorded" });
  });
});

// GET TODAY'S APP USAGE SUMMARY
router.get("/get-usage/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  // Query to get total screen time and grouped usage for the CURRENT DAY
  // Using SUM(duration_seconds) to account for multiple sessions of the same app
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
    const apps = results.map(row => {
      const duration = parseInt(row.total_duration, 10) || 0;
      total_screen_time += duration;
      return {
        app_name: row.app_name,
        duration: duration
      };
    });

    res.json({
      total_screen_time: total_screen_time,
      apps: apps
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
