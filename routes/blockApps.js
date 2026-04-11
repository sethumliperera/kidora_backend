const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// ================= CREATE TABLE (AUTO) =================
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS blocked_apps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      package_name VARCHAR(255) NOT NULL,
      UNIQUE KEY unique_child_pkg (child_id, package_name)
    )
  `);
}

// ================= BLOCK APP =================
router.post("/block", verifyToken, async (req, res) => {
  try {
    await ensureTable();

    const { child_id, package_name } = req.body;

    if (!child_id || !package_name) {
      return res.status(400).json({ error: "child_id and package_name required" });
    }

    await db.query(
      "INSERT IGNORE INTO blocked_apps (child_id, package_name) VALUES (?, ?)",
      [child_id, package_name]
    );

    console.log("🚫 BLOCKED:", child_id, package_name);

    res.json({ message: "App blocked successfully" });

  } catch (err) {
    console.error("Error blocking app:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ================= GET BLOCKED APPS =================
// ⚠️ Child app uses this (NO auth)
router.get("/:child_id", async (req, res) => {
  try {
    await ensureTable();

    const { child_id } = req.params;

    if (!child_id) {
      return res.status(400).json({ error: "child_id required" });
    }

    const [results] = await db.query(
      "SELECT package_name FROM blocked_apps WHERE child_id = ?",
      [child_id]
    );

    // ✅ IMPORTANT: return as list of strings
    const apps = results.map(row => row.package_name);

    console.log("📥 FETCH BLOCKED APPS:", child_id, apps);

    res.json(apps);

  } catch (err) {
    console.error("Error fetching blocked apps:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// ================= UNBLOCK APP =================
router.delete("/unblock", verifyToken, async (req, res) => {
  try {
    await ensureTable();

    const { child_id, package_name } = req.body;

    if (!child_id || !package_name) {
      return res.status(400).json({ error: "child_id and package_name required" });
    }

    await db.query(
      "DELETE FROM blocked_apps WHERE child_id = ? AND package_name = ?",
      [child_id, package_name]
    );

    console.log("✅ UNBLOCKED:", child_id, package_name);

    res.json({ message: "App unblocked successfully" });

  } catch (err) {
    console.error("Error unblocking app:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

module.exports = router;
