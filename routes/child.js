const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

let uninstallPinColumnChecked = false;
const ensureUninstallPinColumn = async () => {
  if (uninstallPinColumnChecked) return;
  try {
    await db.query(
      "ALTER TABLE users ADD COLUMN uninstall_pin_hash VARCHAR(255) NULL"
    );
  } catch (err) {
    if (!String(err.message || "").toLowerCase().includes("duplicate column")) {
      throw err;
    }
  } finally {
    uninstallPinColumnChecked = true;
  }
};

const hashPin = (pin) =>
  crypto.createHash("sha256").update(String(pin)).digest("hex");

// ===============================
//  MULTER CONFIG
// ===============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage });

// ===============================
//  HELPERS
// ===============================
const generateUniqueCodes = () => {
  const childId =
    "KID-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  return { childId };
};

const generateLinkingCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ===============================
//  UPLOAD PHOTO
// ===============================
router.post(
  "/upload-photo",
  verifyToken,
  upload.single("photo"),
  (req, res) => {
    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    res.json({ photo_url: `/uploads/${req.file.filename}` });
  }
);

// ===============================
//  ADD CHILD
// ===============================
router.post("/add", async (req, res) => {
  try {
    const {
      firebase_uid,
      name,
      age,
      gender,
      interests,
      photo_url,
      email,
    } = req.body;

    if (!firebase_uid || !name || age === undefined || !email) {
      return res.status(400).json({
        message: "firebase_uid, name, age and email are required",
      });
    }

    const [parentResults] = await db.query(
      "SELECT id, firebase_uid FROM users WHERE firebase_uid = ? OR email = ?",
      [firebase_uid, email]
    );

    let parent_id;

    if (parentResults.length > 0) {
      parent_id = parentResults[0].id;
    } else {
      const [insertParent] = await db.query(
        "INSERT INTO users (firebase_uid, email, role) VALUES (?, ?, 'parent')",
        [firebase_uid, email]
      );
      parent_id = insertParent.insertId;
    }

    const { childId } = generateUniqueCodes();

    const [childResult] = await db.query(
      `INSERT INTO children 
      (name, age, gender, interests, photo_url, child_id, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        parseInt(age),
        gender || null,
        interests || null,
        photo_url || null,
        childId,
        parent_id,
      ]
    );

    const child_db_id = childResult.insertId;

    const [newChildRows] = await db.query(
      "SELECT * FROM children WHERE id = ?",
      [child_db_id]
    );

    const code = generateLinkingCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.query(
      "INSERT INTO linking_codes (parent_id, child_id, code, expires_at, is_used) VALUES (?, ?, ?, ?, 0)",
      [parent_id, child_db_id, code, expiresAt]
    );

    res.json({
      message: "Child added successfully",
      child: newChildRows[0],
      linking_code: code,
    });
  } catch (err) {
    console.error("ADD CHILD ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  LINK CHILD
// ===============================
router.post("/link", async (req, res) => {
  try {
    const { linking_code } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM linking_codes WHERE code = ? AND is_used = 0",
      [linking_code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid code" });
    }

    const link = rows[0];

    if (new Date() > new Date(link.expires_at)) {
      return res.status(400).json({ message: "Code expired" });
    }

    await db.query(
      "UPDATE children SET parent_id = ? WHERE id = ?",
      [link.parent_id, link.child_id]
    );

    await db.query(
      "UPDATE linking_codes SET is_used = 1 WHERE id = ?",
      [link.id]
    );

    const [childRows] = await db.query(
      "SELECT * FROM children WHERE id = ?",
      [link.child_id]
    );

    res.json({
      message: "Linked successfully",
      child: childRows[0],
    });
  } catch (err) {
    console.error("LINK ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  GET CHILDREN
// ===============================
router.get("/", verifyToken, async (req, res) => {
  try {
    const parent_id = req.user.id;

    const [results] = await db.query(
      "SELECT * FROM children WHERE parent_id = ?",
      [parent_id]
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  DELETE CHILD
// ===============================
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const child_id = req.params.id;
    const parent_id = req.user.id;

    const [result] = await db.query(
      "DELETE FROM children WHERE id = ? AND parent_id = ?",
      [child_id, parent_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  GET APPS
// ===============================
router.get("/:id/apps", async (req, res) => {
  try {
    const child_id = req.params.id;

    const [controls] = await db.query(
      "SELECT * FROM app_controls WHERE child_id = ?",
      [child_id]
    );

    const [blocked] = await db.query(
      "SELECT package_name FROM blocked_apps WHERE child_id = ?",
      [child_id]
    );

    res.json({
      controls,
      blocked_packages: blocked.map((b) => b.package_name),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  UPDATE APP CONTROL (FIXED)
// ===============================
router.post("/:id/apps", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { app_name, time_limit, is_blocked } = req.body;

    const fields = ["child_id", "app_name"];
    const values = [child_id, app_name];

    if (time_limit !== undefined) {
      fields.push("time_limit");
      values.push(time_limit);
    }

    if (is_blocked !== undefined) {
      fields.push("is_blocked");
      values.push(is_blocked ? 1 : 0);
    }

    const placeholders = fields.map(() => "?").join(",");

    const updates = [];
    if (time_limit !== undefined) updates.push("time_limit = VALUES(time_limit)");
    if (is_blocked !== undefined) updates.push("is_blocked = VALUES(is_blocked)");

    await db.query(
      `INSERT INTO app_controls (${fields.join(",")})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updates.join(", ") || "child_id = child_id"}`,
      values
    );

    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
// ⏱ GET DAILY LIMIT
// GET /api/children/:id/limit
// ===============================
router.get("/:id/limit", async (req, res) => {
  try {
    const child_id = req.params.id;

    const [rows] = await db.query(
      "SELECT screen_time_limit FROM children WHERE id = ?",
      [child_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Child not found" });
    }

    const limitMinutes = rows[0].screen_time_limit || 120;
    res.json({
      daily_limit: limitMinutes * 60,  // Return in seconds for the background service
      daily_limit_minutes: limitMinutes
    });
  } catch (err) {
    console.error("GET LIMIT ERROR:", err);
    res.status(500).json({ message: "Failed to get limit", error: err.message });
  }
});

// ===============================
// ⏱ SET DAILY LIMIT (from parent dashboard)
// POST /api/children/:id/set-limit
// ===============================
router.post("/:id/set-limit", verifyToken, async (req, res) => {
  try {
    const child_id = req.params.id;
    const { daily_limit } = req.body;

    if (daily_limit === undefined) {
      return res.status(400).json({ message: "daily_limit is required (in seconds)" });
    }

    // Convert seconds to minutes for storage
    const limitMinutes = Math.round(daily_limit / 60);

    await db.query(
      "UPDATE children SET screen_time_limit = ? WHERE id = ?",
      [limitMinutes, child_id]
    );

    res.json({ message: "Limit updated successfully", daily_limit_minutes: limitMinutes });
  } catch (err) {
    console.error("SET LIMIT ERROR:", err);
    res.status(500).json({ message: "Failed to set limit", error: err.message });
  }
});


// ===============================
//  PRESENCE (FIXED)
// ===============================
router.post("/presence", async (req, res) => {
  try {
    const { child_id, status, current_app } = req.body;

    const updates = ["app_status = ?", "last_active_at = NOW()"];
    const values = [status];

    if (current_app !== undefined) {
      updates.push("current_app = ?");
      values.push(current_app);
    }

    await db.query(
      `UPDATE children SET ${updates.join(", ")} WHERE child_id = ?`,
      [...values, child_id]
    );

    res.json({ message: "OK" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  USAGE
// ===============================
router.post("/:id/usage", async (req, res) => {
  try {
    const { app_name, additional_minutes } = req.body;
    const child_id = req.params.id;

    await db.query(
      `INSERT INTO app_controls (child_id, app_name, time_used)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE time_used = time_used + ?`,
      [child_id, app_name, additional_minutes, additional_minutes]
    );

    await db.query(
      `INSERT INTO app_usage (child_id, app_name, start_time, end_time, duration_seconds)
       VALUES (?, ?, NOW(), NOW(), ?)`,
      [child_id, app_name, additional_minutes * 60]
    );

    res.json({ message: "Recorded" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===============================
//  REMINDERS
// ===============================
router.get("/:id/reminders", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM reminders WHERE child_id = ?",
    [req.params.id]
  );

  res.json(rows);
});

router.post("/:id/reminders", async (req, res) => {
  const { message } = req.body;

  const [result] = await db.query(
    "INSERT INTO reminders (child_id, message) VALUES (?, ?)",
    [req.params.id, message]
  );

  res.json({ id: result.insertId });
});

// ===============================
//  FCM TOKEN
// ===============================
router.post("/save-fcm-token", async (req, res) => {
  try {
    const { child_id, child_public_id, fcm_token } = req.body;
    if (!fcm_token || String(fcm_token).trim() === "") {
      return res.status(400).json({ message: "fcm_token is required" });
    }

    let result;
    if (child_id !== undefined && child_id !== null && String(child_id).trim() !== "") {
      [result] = await db.query(
        "UPDATE children SET fcm_token = ? WHERE id = ?",
        [fcm_token, child_id]
      );
    } else if (
      child_public_id !== undefined &&
      child_public_id !== null &&
      String(child_public_id).trim() !== ""
    ) {
      [result] = await db.query(
        "UPDATE children SET fcm_token = ? WHERE child_id = ?",
        [fcm_token, String(child_public_id).trim()]
      );
    } else {
      return res.status(400).json({ message: "child_id or child_public_id is required" });
    }

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ message: "Child not found for token save" });
    }

    res.json({ message: "Saved" });
  } catch (err) {
    console.error("SAVE FCM TOKEN ERROR:", err);
    res.status(500).json({ message: "Failed to save FCM token", error: err.message });
  }
});

// ===============================
//  VERIFY UNINSTALL PIN (CHILD SIDE)
// ===============================
router.post("/verify-uninstall-pin", async (req, res) => {
  try {
    await ensureUninstallPinColumn();
    const { child_id, child_public_id, pin } = req.body;

    if (!/^\d{4}$/.test(String(pin || "").trim())) {
      return res.status(400).json({ message: "pin must be exactly 4 digits" });
    }

    let childRows = [];
    if (child_id !== undefined && child_id !== null && String(child_id).trim() !== "") {
      const [rowsById] = await db.query(
        "SELECT id, parent_id FROM children WHERE id = ? LIMIT 1",
        [child_id]
      );
      childRows = rowsById;
    } else if (
      child_public_id !== undefined &&
      child_public_id !== null &&
      String(child_public_id).trim() !== ""
    ) {
      const [rowsByPublicId] = await db.query(
        "SELECT id, parent_id FROM children WHERE child_id = ? LIMIT 1",
        [String(child_public_id).trim()]
      );
      childRows = rowsByPublicId;
    } else {
      return res.status(400).json({ message: "child_id or child_public_id is required" });
    }

    if (childRows.length === 0) {
      return res.status(404).json({ message: "Child not found" });
    }

    const parentId = childRows[0].parent_id;
    const [userRows] = await db.query(
      "SELECT uninstall_pin_hash FROM users WHERE id = ? LIMIT 1",
      [parentId]
    );
    if (userRows.length === 0 || !userRows[0].uninstall_pin_hash) {
      return res.status(404).json({ message: "Parent uninstall PIN is not set" });
    }

    const submittedPin = String(pin).trim();
    const storedRaw = String(userRows[0].uninstall_pin_hash || "").trim();
    const storedLower = storedRaw.toLowerCase();

    // Support legacy formats to avoid locking out existing users:
    // 1) SHA-256 from older code paths that may have stripped leading zeros.
    // 2) Plain 4-digit values accidentally stored before hashing was enforced.
    const legacyNoLeadingZero = String(parseInt(submittedPin, 10));
    const currentHash = hashPin(submittedPin).toLowerCase();
    const legacyHash = hashPin(legacyNoLeadingZero).toLowerCase();

    let valid = storedLower === currentHash || storedLower === legacyHash;

    if (!valid && /^\d{4}$/.test(storedRaw)) {
      valid = storedRaw === submittedPin;
      if (valid) {
        await db.query(
          "UPDATE users SET uninstall_pin_hash = ? WHERE id = ?",
          [currentHash, parentId]
        );
      }
    }

    return res.json({ valid });
  } catch (err) {
    console.error("VERIFY UNINSTALL PIN ERROR:", err);
    res.status(500).json({ message: "Failed to verify uninstall PIN", error: err.message });
  }
});
// ===============================
// 📅 APP RESTRICTION SCHEDULES
// ===============================

// 1. GET ALL SCHEDULES
router.get("/:id/schedules", async (req, res) => {
  try {
    const child_id = req.params.id;
    const [rows] = await db.query(
      "SELECT * FROM app_restriction_schedules WHERE child_id = ?",
      [child_id]
    );

    // Format for frontend (Parse JSON strings)
    const formatted = rows.map(r => ({
      ...r,
      days: JSON.parse(r.days || "[]"),
      blocked_packages: JSON.parse(r.blocked_apps || "[]"),
      start_time: r.start_time,
      end_time: r.end_time,
      is_enabled: r.is_enabled === 1
    }));

    res.json(formatted);
  } catch (err) {
    console.error("GET SCHEDULES ERROR:", err);
    res.status(500).json({ message: "Failed to fetch schedules", error: err.message });
  }
});

// 2. CREATE or UPDATE SCHEDULE (Standardized POST)
router.post("/:id/schedules", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { id, name, start_time, end_time, days, blocked_packages, is_enabled } = req.body;

    // Auto-create table if missing (consistent with child.js pattern)
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_restriction_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        start_time VARCHAR(10) NOT NULL,
        end_time VARCHAR(10) NOT NULL,
        days TEXT NOT NULL,
        blocked_apps TEXT NOT NULL,
        is_enabled TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
      )
    `);

    const daysJson = JSON.stringify(days || []);
    const blockedAppsJson = JSON.stringify(blocked_packages || []);
    const enabled = is_enabled ? 1 : 0;

    if (id && isNaN(id) === false) {
      // Update existing
      await db.query(
        `UPDATE app_restriction_schedules 
         SET name = ?, start_time = ?, end_time = ?, days = ?, blocked_apps = ?, is_enabled = ?
         WHERE id = ? AND child_id = ?`,
        [name, start_time, end_time, daysJson, blockedAppsJson, enabled, id, child_id]
      );
      res.json({ message: "Schedule updated successfully" });
    } else {
      // Create new
      const [result] = await db.query(
        `INSERT INTO app_restriction_schedules 
         (child_id, name, start_time, end_time, days, blocked_apps, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [child_id, name, start_time, end_time, daysJson, blockedAppsJson, enabled]
      );
      res.json({ message: "Schedule created successfully", id: result.insertId });
    }
  } catch (err) {
    console.error("SAVE SCHEDULE ERROR:", err);
    res.status(500).json({ message: "Failed to save schedule", error: err.message });
  }
});

// 3. DELETE SCHEDULE
router.delete("/:id/schedules/:scheduleId", async (req, res) => {
  try {
    const { id, scheduleId } = req.params;
    const [result] = await db.query(
      "DELETE FROM app_restriction_schedules WHERE id = ? AND child_id = ?",
      [scheduleId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Schedule not found or unauthorized" });
    }

    res.json({ message: "Schedule deleted successfully" });
  } catch (err) {
    console.error("DELETE SCHEDULE ERROR:", err);
    res.status(500).json({ message: "Failed to delete schedule", error: err.message });
  }
});


module.exports = router;
