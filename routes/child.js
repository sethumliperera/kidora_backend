const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

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
  const { child_id, fcm_token } = req.body;

  await db.query(
    "UPDATE children SET fcm_token = ? WHERE id = ?",
    [fcm_token, child_id]
  );

  res.json({ message: "Saved" });
});

module.exports = router;
