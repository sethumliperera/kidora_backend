const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// SAVE INSTALLED APPS
router.post("/", verifyToken, async (req, res) => {
    try {
        const { child_id, apps } = req.body;

        // Clear old apps (important)
        await db.query("DELETE FROM installed_apps WHERE child_id = ?", [child_id]);

        for (let app of apps) {
            await db.query(
                "INSERT INTO installed_apps (child_id, package_name, app_name) VALUES (?, ?, ?)",
                [child_id, app.package_name, app.app_name]
            );
        }

        res.json({ message: "Apps saved successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
