const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// BLOCK APP
router.post("/block", verifyToken, async (req, res) => {
  try {
    const { child_id, app_name } = req.body;

    const sql = `
      INSERT INTO blocked_apps (child_id, app_name)
      VALUES (?, ?)
    `;

    await db.query(sql, [child_id, app_name]);
    res.json({ message: "App blocked successfully" });
  } catch (err) {
    console.error("Error blocking app:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// GET BLOCKED APPS
router.get("/:child_id", verifyToken, async (req, res) => {
  try {
    const { child_id } = req.params;

    const sql = "SELECT * FROM blocked_apps WHERE child_id = ?";
    const [results] = await db.query(sql, [child_id]);
    res.json(results);
  } catch (err) {
    console.error("Error fetching blocked apps:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// UNBLOCK APP
router.delete("/unblock", verifyToken, async (req, res) => {
  try {
    const { child_id, app_name } = req.body;

    const sql = `
      DELETE FROM blocked_apps
      WHERE child_id = ? AND app_name = ?
    `;

    await db.query(sql, [child_id, app_name]);
    res.json({ message: "App unblocked successfully" });
  } catch (err) {
    console.error("Error unblocking app:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

module.exports = router;
