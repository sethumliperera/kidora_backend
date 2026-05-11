const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const { sendParentNotificationPush } = require("../fcmReminders");

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

    if (child_id === undefined || child_id === null || !Array.isArray(apps)) {
      return res.status(400).json({ error: "child_id and apps array are required" });
    }

    const numericChildId = parseInt(String(child_id), 10);
    if (Number.isNaN(numericChildId)) {
      return res.status(400).json({ error: "child_id must be a number" });
    }

    const [childRows] = await db.query(
      "SELECT id, parent_id, name FROM children WHERE id = ?",
      [numericChildId]
    );
    if (childRows.length === 0) {
      return res.status(404).json({ error: "Unknown child_id — link this device again." });
    }

    const parentId = childRows[0].parent_id;
    const childName = childRows[0].name || "Your child";

    // ── Step 1: Remember existing package names (for new-install detection) ──
    const [existingRows] = await db.query(
      "SELECT package_name FROM installed_apps WHERE child_id = ?",
      [numericChildId]
    );
    const existingPackages = new Set(existingRows.map((r) => r.package_name));

    // ── Step 2: Detect newly installed apps ──
    const SOCIAL_GAMING_KEYWORDS = [
      "facebook", "instagram", "tiktok", "musically", "snapchat",
      "twitter", "whatsapp", "telegram", "discord", "reddit",
      "youtube", "netflix", "spotify", "twitch", "pinterest",
      "game", "gaming", "pubg", "roblox", "minecraft", "fortnite",
      "chess", "ludo", "candy", "clash", "angry", "temple",
      "subway", "racing", "shooter", "battle", "arena",
    ];

    const isSocialOrGaming = (pkg, name) => {
      const p = (pkg || "").toLowerCase();
      const n = (name || "").toLowerCase();
      return SOCIAL_GAMING_KEYWORDS.some((kw) => p.includes(kw) || n.includes(kw));
    };

    const newApps = apps.filter(
      (a) => !existingPackages.has(a.package_name)
    );

    // ── Step 3: Create notifications for newly installed apps ──
    if (newApps.length > 0 && parentId) {
      // Ensure notifications table exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          parent_id INT,
          child_id INT NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(100) DEFAULT 'general',
          is_read TINYINT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      for (const app of newApps) {
        const appLabel = app.app_name || app.package_name;
        const category = isSocialOrGaming(app.package_name, app.app_name)
          ? " (Social/Gaming)"
          : "";
        const message = `Your child just installed ${appLabel}${category}`;
        try {
          await db.query(
            "INSERT INTO notifications (parent_id, child_id, message, type) VALUES (?, ?, ?, ?)",
            [parentId, numericChildId, message, "new_app_installed"]
          );
        } catch (e) {
          console.error("Failed to create notification:", e.message);
        }
      }

      const first = newApps[0];
      const firstLabel = first ? first.app_name || first.package_name : "";
      const pushBody =
        newApps.length === 1
          ? `${childName} installed ${firstLabel}`
          : `${childName}: ${newApps.length} new apps (e.g. ${firstLabel})`;
      await sendParentNotificationPush(db, parentId, {
        title: "Kidora — new app",
        body: pushBody,
        type: "new_app_installed",
        childId: numericChildId,
      });
    }

    // ── Step 4: Clear old apps and re-insert ──
    await db.query("DELETE FROM installed_apps WHERE child_id = ?", [numericChildId]);

    for (const app of apps) {
      try {
        await db.query(
          "INSERT INTO installed_apps (child_id, package_name, app_name) VALUES (?, ?, ?)",
          [numericChildId, app.package_name, app.app_name]
        );
      } catch (e) {
        // Skip duplicates
      }
    }

    res.json({
      message: `${apps.length} apps saved successfully`,
      new_installs: newApps.length,
    });
  } catch (err) {
    console.error("Error saving installed apps:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET INSTALLED APPS FOR A CHILD (called by parent — needs auth)
router.get("/:child_id", verifyToken, async (req, res) => {
  try {
    await ensureTable();

    const rawId = req.params.child_id;
    const numericChildId = parseInt(String(rawId), 10);
    if (Number.isNaN(numericChildId)) {
      return res.status(400).json({ error: "Invalid child id" });
    }

    const parentId = Number(req.user.id);

    const [owned] = await db.query(
      "SELECT id FROM children WHERE id = ? AND parent_id = ?",
      [numericChildId, parentId]
    );
    if (owned.length === 0) {
      return res.status(404).json({ error: "Child not found or access denied" });
    }

    // Merge installed apps with block status from blocked_apps table
    const [results] = await db.query(
      `
      SELECT
        ia.package_name,
        ia.app_name,
        (
          SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
          FROM blocked_apps ba
          WHERE ba.child_id = ia.child_id AND ba.package_name = ia.package_name
        ) AS is_blocked
      FROM installed_apps ia
      WHERE ia.child_id = ?
      ORDER BY ia.app_name ASC
    `,
      [numericChildId]
    );

    res.json(results);
  } catch (err) {
    console.error("Error fetching installed apps:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
