const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");

const TABLE = "app_restrictions";

const sameId = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
};

const parseListField = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch (_) {}
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
};

const safeDuration = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.floor(n));
};

const normalizeRestrictionRow = (r) => ({
  ...r,
  type: r.type ?? r.name,
  enabled: !!(r.enabled ?? r.is_enabled),
  days: parseListField(r.days),
  blocked_apps: parseListField(r.blocked_apps),
});

async function assertParentOwnsChild(childId, parentId) {
  const [childRows] = await db.query(
    "SELECT parent_id FROM children WHERE id = ?",
    [childId]
  );

  if (childRows.length === 0) {
    return { ok: false, status: 404, message: "Child not found" };
  }

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
    const parent_id = req.user.id;
    const {
      child_id,
      type,
      start_time,
      end_time,
      days,
      blocked_apps,
      enabled = true,
      duration_minutes,
    } = req.body;

    if (!child_id || !type) {
      return res.status(400).json({
        message: "child_id and type are required",
      });
    }

    const ownCheck = await assertParentOwnsChild(child_id, parent_id);
    if (!ownCheck.ok) {
      return res.status(ownCheck.status).json({ message: ownCheck.message });
    }

    const duration = safeDuration(duration_minutes);
    const [result] = await db.query(
      `INSERT INTO ${TABLE}
      (child_id, name, start_time, end_time, days, blocked_apps, duration_minutes, activated_at, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        child_id,
        type,
        start_time || null,
        end_time || null,
        JSON.stringify(days || []),
        JSON.stringify(blocked_apps || []),
        duration,
        enabled ? new Date() : null,
        enabled ? 1 : 0,
      ]
    );

    res.status(201).json({
      message: "Restriction created",
      restriction_id: result.insertId,
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
      `SELECT r.*, r.name AS type, r.is_enabled AS enabled, c.name AS child_name
       FROM ${TABLE} r
       JOIN children c ON r.child_id = c.id
       WHERE c.parent_id = ?
       ORDER BY r.created_at DESC`,
      [parent_id]
    );

    res.json(results.map(normalizeRestrictionRow));
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

    const ownCheck = await assertParentOwnsChild(child_id, parent_id);
    if (!ownCheck.ok) {
      return res.status(ownCheck.status).json({ message: ownCheck.message });
    }

    const [results] = await db.query(
      `SELECT r.*, r.name AS type, r.is_enabled AS enabled
       FROM ${TABLE} r
       JOIN children c ON r.child_id = c.id
       WHERE r.child_id = ? AND c.parent_id = ?
       ORDER BY created_at DESC`,
      [child_id, parent_id]
    );

    res.json(results.map(normalizeRestrictionRow));
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
      `SELECT c.parent_id
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
      enabled,
      duration_minutes,
    } = req.body;

    const duration = safeDuration(duration_minutes);
    await db.query(
      `UPDATE ${TABLE} SET
        name = ?,
        start_time = ?,
        end_time = ?,
        days = ?,
        blocked_apps = ?,
        duration_minutes = ?,
        activated_at = ?,
        is_enabled = ?
      WHERE id = ?`,
      [
        type,
        start_time || null,
        end_time || null,
        JSON.stringify(days || []),
        JSON.stringify(blocked_apps || []),
        duration,
        enabled ? new Date() : null,
        enabled ? 1 : 0,
        id,
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
      `SELECT c.parent_id, r.is_enabled AS enabled
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

    const newStatus = rows[0].enabled ? 0 : 1;
    await db.query(
      `UPDATE ${TABLE} SET is_enabled = ?, activated_at = ? WHERE id = ?`,
      [newStatus, newStatus ? new Date() : null, id]
    );

    res.json({
      message: "Toggled successfully",
      enabled: !!newStatus,
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
      `SELECT c.parent_id
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
    const { child_id } = req.params;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = days[now.getDay()];
    const yesterday = days[(now.getDay() + 6) % 7];

    const [rows] = await db.query(
      `SELECT *, name AS type, is_enabled AS enabled
       FROM ${TABLE}
       WHERE child_id = ? AND is_enabled = 1`,
      [child_id]
    );

    const activeRestrictions = rows.filter((r) => {
      const hasSchedule =
        String(r.start_time || "").trim().length > 0 &&
        String(r.end_time || "").trim().length > 0;

      // Scheduled rules are activated ONLY when current day/time is inside the window.
      if (hasSchedule) {
        const start = parseTime(r.start_time);
        const end = parseTime(r.end_time);
        if (start === null || end === null) return false;

        const restrictionDays = parseListField(r.days);
        if (start <= end) {
          return (
            restrictionDays.includes(today) &&
            currentMinutes >= start &&
            currentMinutes <= end
          );
        }

        // Overnight window: e.g. 22:00 -> 06:00
        const inLateWindow =
          restrictionDays.includes(today) && currentMinutes >= start;
        const inEarlyWindow =
          restrictionDays.includes(yesterday) && currentMinutes <= end;
        return inLateWindow || inEarlyWindow;
      }

      // Duration-only rules (no start/end schedule)
      const duration = safeDuration(r.duration_minutes);
      if (!duration || !r.activated_at) return false;
      const activatedAt = new Date(r.activated_at);
      if (Number.isNaN(activatedAt.getTime())) return false;
      const activeUntil = new Date(activatedAt.getTime() + duration * 60 * 1000);
      return now <= activeUntil;
    });

    res.json(activeRestrictions.map(normalizeRestrictionRow));
  } catch (err) {
    console.error("ACTIVE RESTRICTIONS ERROR:", err);
    res.status(500).json({ error: "Failed to get active restrictions" });
  }
});


// helper
function parseTime(timeStr) {
  const raw = String(timeStr || "").trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
    return null;
  }

  match = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (match) {
    let h = Number(match[1]);
    const m = Number(match[2]);
    const meridian = match[3].toLowerCase();
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (meridian === "pm" && h !== 12) h += 12;
    if (meridian === "am" && h === 12) h = 0;
    return h * 60 + m;
  }

  return null;
}

module.exports = router;
