const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// Auto-create table helper
async function ensureTable() {
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
}

// SAVE INSTALLED APPS (called by child device — no auth token needed)
router.post("/", async (req, res) => {
  try {
    await ensureTable();

    const { child_id, apps } = req.body;

    if (!child_id || !Array.isArray(apps)) {
      return res.status(400).json({ error: "child_id and apps array are required" });
    }

    // Clear old apps list for this child
    await db.query("DELETE FROM installed_apps WHERE child_id = ?", [child_id]);

    // Batch insert new apps
    for (const app of apps) {
      try {
        await db.query(
          "INSERT INTO installed_apps (child_id, package_name, app_name) VALUES (?, ?, ?)",
          [child_id, app.package_name, app.app_name]
        );
      } catch (e) {
        // Skip duplicates
      }
    }

    res.json({ message: `${apps.length} apps saved successfully` });
  } catch (err) {
    console.error("Error saving installed apps:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET INSTALLED APPS FOR A CHILD (called by parent — needs auth)
router.get("/:child_id", verifyToken, async (req, res) => {
  try {
    await ensureTable();

    const { child_id } = req.params;
    const parentId = req.user.id;

    const [owned] = await db.query(
      "SELECT id FROM children WHERE id = ? AND parent_id = ?",
      [child_id, parentId]
    );
    if (owned.length === 0) {
      return res.status(404).json({ error: "Child not found or access denied" });
    }

    // Merge installed apps with block status from blocked_apps table
    const [results] = await db.query(`
      SELECT DISTINCT
        ia.package_name,
        ia.app_name,
        CASE WHEN ba.id IS NOT NULL THEN 1 ELSE 0 END AS is_blocked
      FROM installed_apps ia
      LEFT JOIN blocked_apps ba 
        ON ia.child_id = ba.child_id AND ia.package_name = ba.package_name
      WHERE ia.child_id = ?
      GROUP BY ia.package_name, ia.app_name
      ORDER BY ia.app_name ASC
    `, [child_id]);

    res.json(results);
  } catch (err) {
    console.error("Error fetching installed apps:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
