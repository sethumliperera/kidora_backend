const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// BLOCK APP
router.post("/block", verifyToken, (req, res) => {
  const { child_id, app_name } = req.body;

  const sql = `
    INSERT INTO blocked_apps (child_id, app_name)
    VALUES (?, ?)
  `;

  db.query(sql, [child_id, app_name], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "App blocked successfully" });
  });
});

// GET BLOCKED APPS
router.get("/:child_id", verifyToken, (req, res) => {
  const { child_id } = req.params;

  const sql = "SELECT * FROM blocked_apps WHERE child_id = ?";

  db.query(sql, [child_id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// UNBLOCK APP
router.delete("/unblock", verifyToken, (req, res) => {
  const { child_id, app_name } = req.body;

  const sql = `
    DELETE FROM blocked_apps
    WHERE child_id = ? AND app_name = ?
  `;

  db.query(sql, [child_id, app_name], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "App unblocked successfully" });
  });
});

module.exports = router;
