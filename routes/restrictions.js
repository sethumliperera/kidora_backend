const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

// ===============================
// CREATE RESTRICTION
// ===============================
router.post("/", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;

        const {
            child_id,
            type,
            start_time,
            end_time,
            days,
            blocked_apps,
            enabled = true
        } = req.body;

        if (!child_id || !type) {
            return res.status(400).json({
                message: "child_id and type are required"
            });
        }

        // Verify parent owns child
        const [childRows] = await db.query(
            "SELECT parent_id FROM children WHERE id = ?",
            [child_id]
        );

        if (childRows.length === 0) {
            return res.status(404).json({ message: "Child not found" });
        }

        if (childRows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const [result] = await db.query(
            `INSERT INTO restrictions 
            (parent_id, child_id, type, start_time, end_time, days, blocked_apps, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                parent_id,
                child_id,
                type,
                start_time || null,
                end_time || null,
                JSON.stringify(days || []),
                JSON.stringify(blocked_apps || []),
                enabled ? 1 : 0
            ]
        );

        res.status(201).json({
            message: "Restriction created",
            restriction_id: result.insertId
        });

    } catch (err) {
        console.error("CREATE RESTRICTION ERROR:", err);
        res.status(500).json({ error: "Failed to create restriction" });
    }
});


// ===============================
// GET ALL RESTRICTIONS (PARENT)
// ===============================
router.get("/", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;

        const [results] = await db.query(
            `SELECT r.*, c.name AS child_name
             FROM restrictions r
             JOIN children c ON r.child_id = c.id
             WHERE r.parent_id = ?
             ORDER BY r.created_at DESC`,
            [parent_id]
        );

        // Parse JSON fields
        const parsed = results.map(r => ({
            ...r,
            days: JSON.parse(r.days || "[]"),
            blocked_apps: JSON.parse(r.blocked_apps || "[]"),
            enabled: !!r.enabled
        }));

        res.json(parsed);

    } catch (err) {
        console.error("GET RESTRICTIONS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch restrictions" });
    }
});


// ===============================
// GET RESTRICTIONS FOR ONE CHILD
// ===============================
router.get("/child/:child_id", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;
        const { child_id } = req.params;

        const [childRows] = await db.query(
            "SELECT parent_id FROM children WHERE id = ?",
            [child_id]
        );

        if (childRows.length === 0) {
            return res.status(404).json({ message: "Child not found" });
        }

        if (childRows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const [results] = await db.query(
            `SELECT * FROM restrictions
             WHERE child_id = ? AND parent_id = ?
             ORDER BY created_at DESC`,
            [child_id, parent_id]
        );

        const parsed = results.map(r => ({
            ...r,
            days: JSON.parse(r.days || "[]"),
            blocked_apps: JSON.parse(r.blocked_apps || "[]"),
            enabled: !!r.enabled
        }));

        res.json(parsed);

    } catch (err) {
        console.error("GET CHILD RESTRICTIONS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch restrictions" });
    }
});


// ===============================
// UPDATE RESTRICTION
// ===============================
router.put("/:id", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            "SELECT parent_id FROM restrictions WHERE id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (rows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const {
            type,
            start_time,
            end_time,
            days,
            blocked_apps,
            enabled
        } = req.body;

        await db.query(
            `UPDATE restrictions SET
                type = ?,
                start_time = ?,
                end_time = ?,
                days = ?,
                blocked_apps = ?,
                enabled = ?
             WHERE id = ?`,
            [
                type,
                start_time || null,
                end_time || null,
                JSON.stringify(days || []),
                JSON.stringify(blocked_apps || []),
                enabled ? 1 : 0,
                id
            ]
        );

        res.json({ message: "Updated successfully" });

    } catch (err) {
        console.error("UPDATE ERROR:", err);
        res.status(500).json({ error: "Failed to update restriction" });
    }
});


// ===============================
// TOGGLE ENABLE / DISABLE
// ===============================
router.patch("/:id/toggle", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            "SELECT parent_id, enabled FROM restrictions WHERE id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (rows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const newStatus = rows[0].enabled ? 0 : 1;

        await db.query(
            "UPDATE restrictions SET enabled = ? WHERE id = ?",
            [newStatus, id]
        );

        res.json({
            message: "Toggled successfully",
            enabled: !!newStatus
        });

    } catch (err) {
        console.error("TOGGLE ERROR:", err);
        res.status(500).json({ error: "Failed to toggle restriction" });
    }
});


// ===============================
// DELETE RESTRICTION
// ===============================
router.delete("/:id", verifyToken, async (req, res) => {
    try {
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            "SELECT parent_id FROM restrictions WHERE id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (rows[0].parent_id !== parent_id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await db.query(
            "DELETE FROM restrictions WHERE id = ?",
            [id]
        );

        res.json({ message: "Deleted successfully" });

    } catch (err) {
        console.error("DELETE ERROR:", err);
        res.status(500).json({ error: "Failed to delete restriction" });
    }
});


// ===============================
// CHILD SIDE - GET ACTIVE RESTRICTIONS
// ===============================
router.get("/active/:child_id", async (req, res) => {
    try {
        const { child_id } = req.params;

        const [results] = await db.query(
            `SELECT * FROM restrictions
             WHERE child_id = ? AND enabled = 1`,
            [child_id]
        );

        const parsed = results.map(r => ({
            ...r,
            days: JSON.parse(r.days || "[]"),
            blocked_apps: JSON.parse(r.blocked_apps || "[]")
        }));

        res.json(parsed);

    } catch (err) {
        console.error("ACTIVE ERROR:", err);
        res.status(500).json({ error: "Failed to fetch active restrictions" });
    }
});

module.exports = router;
