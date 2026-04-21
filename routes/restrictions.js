const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

const sameId = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
    return String(a) === String(b);
};

let resolvedTable = null;

async function getRestrictionsTable() {
    if (resolvedTable) return resolvedTable;

    const candidates = [
        "app_restriction",
        "app_restrictions",
        "app_restriction_schedules",
    ];

    for (const name of candidates) {
        const [rows] = await db.query("SHOW TABLES LIKE ?", [name]);
        if (Array.isArray(rows) && rows.length > 0) {
            resolvedTable = name;
            console.log(`[Restrictions] Using table: ${resolvedTable}`);
            return resolvedTable;
        }
    }

    const [allTables] = await db.query("SHOW TABLES");
    const discovered = Array.isArray(allTables)
        ? allTables
              .map((r) => {
                  const v = Object.values(r || {});
                  return v.length > 0 ? String(v[0]) : "";
              })
              .filter(Boolean)
        : [];

    console.error(
        `[Restrictions] No matching table found. Candidates=${candidates.join(", ")}. Existing tables=${discovered.join(", ")}`
    );
    throw new Error(
        `No restrictions table found. Expected one of: ${candidates.join(", ")}`
    );
}

const parseListField = (value) => {
    if (Array.isArray(value)) return value.map(v => String(v));
    if (value === null || value === undefined) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(v => String(v));
    } catch (_) {
        // Fallback for comma-separated legacy values.
    }
    return raw
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
};

async function assertParentOwnsChild(childId, parentId) {
    const [childRows] = await db.query(
        "SELECT parent_id FROM children WHERE id = ?",
        [childId]
    );
    if (childRows.length === 0) return { ok: false, status: 404, message: "Child not found" };
    if (!sameId(childRows[0].parent_id, parentId)) {
        return { ok: false, status: 403, message: "Unauthorized" };
    }
    return { ok: true };
}

// ===============================
// CREATE RESTRICTION
// ===============================
router.post("/", verifyToken, async (req, res) => {
    try {
        const TABLE = await getRestrictionsTable();
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

        const ownCheck = await assertParentOwnsChild(child_id, parent_id);
        if (!ownCheck.ok) {
            return res.status(ownCheck.status).json({ message: ownCheck.message });
        }

        const [result] = await db.query(
            `INSERT INTO ${TABLE}
            (child_id, name, start_time, end_time, days, blocked_apps, is_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
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
        const TABLE = await getRestrictionsTable();
        const parent_id = req.user.id;

        const [results] = await db.query(
            `SELECT r.id, r.child_id, r.name AS type, r.start_time, r.end_time, r.days, r.blocked_apps, r.is_enabled AS enabled, r.created_at, r.updated_at, c.name AS child_name
             FROM ${TABLE} r
             JOIN children c ON r.child_id = c.id
             WHERE c.parent_id = ?
             ORDER BY r.created_at DESC`,
            [parent_id]
        );

        // Parse JSON fields
        const parsed = results.map(r => ({
            ...r,
            days: parseListField(r.days),
            blocked_apps: parseListField(r.blocked_apps),
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
        const TABLE = await getRestrictionsTable();
        const parent_id = req.user.id;
        const { child_id } = req.params;

        const ownCheck = await assertParentOwnsChild(child_id, parent_id);
        if (!ownCheck.ok) {
            return res.status(ownCheck.status).json({ message: ownCheck.message });
        }

        const [results] = await db.query(
            `SELECT id, child_id, name AS type, start_time, end_time, days, blocked_apps, is_enabled AS enabled, created_at, updated_at
             FROM ${TABLE}
             WHERE child_id = ?
             ORDER BY created_at DESC`,
            [child_id]
        );

        const parsed = results.map(r => ({
            ...r,
            days: parseListField(r.days),
            blocked_apps: parseListField(r.blocked_apps),
            enabled: !!r.enabled
        }));

        res.json(parsed);

    } catch (err) {
        console.error("GET CHILD RESTRICTIONS ERROR:", err);
        res.status(500).json({
            error: "Failed to fetch restrictions",
            details: err.message
        });
    }
});


// ===============================
// UPDATE RESTRICTION
// ===============================
router.put("/:id", verifyToken, async (req, res) => {
    try {
        const TABLE = await getRestrictionsTable();
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            `SELECT r.child_id, c.parent_id
             FROM ${TABLE} r
             JOIN children c ON c.id = r.child_id
             WHERE r.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (!sameId(rows[0].parent_id, parent_id)) {
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
            `UPDATE ${TABLE} SET
                name = ?,
                start_time = ?,
                end_time = ?,
                days = ?,
                blocked_apps = ?,
                is_enabled = ?
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
        const TABLE = await getRestrictionsTable();
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            `SELECT r.child_id, r.is_enabled, c.parent_id
             FROM ${TABLE} r
             JOIN children c ON c.id = r.child_id
             WHERE r.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (!sameId(rows[0].parent_id, parent_id)) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const newStatus = rows[0].is_enabled ? 0 : 1;

        await db.query(
            `UPDATE ${TABLE} SET is_enabled = ? WHERE id = ?`,
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
        const TABLE = await getRestrictionsTable();
        const parent_id = req.user.id;
        const { id } = req.params;

        const [rows] = await db.query(
            `SELECT r.child_id, c.parent_id
             FROM ${TABLE} r
             JOIN children c ON c.id = r.child_id
             WHERE r.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Restriction not found" });
        }

        if (!sameId(rows[0].parent_id, parent_id)) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await db.query(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);

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
        const TABLE = await getRestrictionsTable();
        const { child_id } = req.params;

        const now = new Date();

        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const today = days[now.getDay()];
        const yesterday = days[(now.getDay() + 6) % 7];

        const [rows] = await db.query(
            `SELECT id, child_id, name AS type, start_time, end_time, days, blocked_apps, is_enabled AS enabled, created_at, updated_at
             FROM ${TABLE}
             WHERE child_id = ? AND is_enabled = 1`,
            [child_id]
        );

        const activeRestrictions = rows.filter(r => {
            if (!r.start_time || !r.end_time) return false;

            const start = parseTime(r.start_time);
            const end = parseTime(r.end_time);

            const restrictionDays = parseListField(r.days);
            // Normal same-day window (e.g. 14:00 -> 18:00)
            if (start <= end) {
                if (!restrictionDays.includes(today)) return false;
                return currentMinutes >= start && currentMinutes <= end;
            }

            // Overnight window (e.g. 22:00 -> 06:00)
            const inLateWindow =
                restrictionDays.includes(today) && currentMinutes >= start;
            const inEarlyWindow =
                restrictionDays.includes(yesterday) && currentMinutes <= end;
            return inLateWindow || inEarlyWindow;
        });

        res.json(activeRestrictions);

    } catch (err) {
        console.error("ACTIVE RESTRICTIONS ERROR:", err);
        res.status(500).json({ error: "Failed to get active restrictions" });
    }
});


// helper
function parseTime(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
}

module.exports = router;
