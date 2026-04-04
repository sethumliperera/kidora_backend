const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

// ===============================
// 📁 MULTER CONFIG
// ===============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// ===============================
// 🛠 HELPERS
// ===============================
const generateUniqueCodes = () => {
  const childId = "KID-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();
  return { childId, linkingCode };
};

// ===============================
// 📷 UPLOAD PHOTO
// ===============================
router.post("/upload-photo", verifyToken, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ photo_url: `/uploads/${req.file.filename}` });
});

// ===============================
// 👶 ADD CHILD
// ===============================
router.post("/add", (req, res) => {
  const { firebase_uid, name, age, gender, interests, photo_url } = req.body;

  if (!firebase_uid || !name || age === undefined) {
    return res.status(400).json({ message: "firebase_uid, name and age are required" });
  }

  // 1. Find or create parent
  const findParentSql = "SELECT id FROM users WHERE firebase_uid = ?";
  db.query(findParentSql, [firebase_uid], (err, parentResults) => {
    if (err) {
      console.error("LOOKUP ERROR FULL:", err); // 🔥 IMPORTANT

      return res.status(500).json({
        message: "Database lookup error",
        error: err.sqlMessage || err.message
      });
    }

    const handleChildInsert = (parent_id) => {
      const { childId, linkingCode } = generateUniqueCodes();
      const insertSql = `
        INSERT INTO children 
        (name, age, gender, interests, photo_url, child_id, linking_code, parent_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(
        insertSql,
        [name, parseInt(age), gender || null, interests || null, photo_url || null, childId, linkingCode, parent_id],
        (err, result) => {
          if (err) return res.status(500).json({ message: "Failed to add child", error: err });
          res.json({
            id: result.insertId,
            message: "Child added successfully",
            child_id: childId,
            linking_code: linkingCode
          });
        }
      );
    };

    if (parentResults.length > 0) {
      handleChildInsert(parentResults[0].id);
    } else {
      // Create user if not exists (auto-signup flow for backend consistency)
      const insertParentSql = "INSERT INTO users (firebase_uid, email, role) VALUES (?, ?, 'parent')";
      db.query(insertParentSql, [firebase_uid, null], (err, insertResult) => {
        if (err) return res.status(500).json({ message: "Failed to create parent user", error: err });
        handleChildInsert(insertResult.insertId);
      });
    }
  });
});

// ===============================
// 📥 GET CHILDREN
// ===============================
router.get("/", verifyToken, (req, res) => {
  const parent_id = req.user.id;
  db.query("SELECT * FROM children WHERE parent_id = ?", [parent_id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// ===============================
// 🗑 DELETE CHILD
// ===============================
router.delete("/:id", verifyToken, (req, res) => {
  const child_id = req.params.id;
  const parent_id = req.user.id;

  db.query(
    "DELETE FROM children WHERE id = ? AND parent_id = ?",
    [child_id, parent_id],
    (err, result) => {
      if (err) return res.status(500).json(err);
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Child not found or unauthorized" });
      }
      res.json({ message: "Child deleted successfully" });
    }
  );
});

// ===============================
// 🔗 LINK CHILD DEVICE
// ===============================
router.post("/link", (req, res) => {
  const { linking_code } = req.body;
  if (!linking_code) return res.status(400).json({ message: "Linking code is required" });

  db.query("SELECT * FROM children WHERE linking_code = ?", [linking_code], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0) return res.status(404).json({ message: "Invalid linking code" });

    const child = results[0];
    res.json({
      message: "Linked successfully",
      child: {
        id: child.id,
        child_id: child.child_id,
        name: child.name,
        parent_id: child.parent_id,
        photo_url: child.photo_url,
        gender: child.gender,
        screen_time_limit: child.screen_time_limit
      }
    });
  });
});

// ===============================
// ⏱ UPDATE SCREEN TIME LIMIT
// ===============================
router.patch("/:id/screen-time-limit", verifyToken, (req, res) => {
  const { id } = req.params;
  const { screen_time_limit } = req.body;
  const parent_id = req.user.id;

  db.query(
    "UPDATE children SET screen_time_limit = ? WHERE id = ? AND parent_id = ?",
    [screen_time_limit, id, parent_id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Limit updated successfully" });
    }
  );
});

// ===============================
// 🚫 UPDATE APP CONTROL
// ===============================
router.post("/:id/apps", verifyToken, (req, res) => {
  const { id } = req.params;
  const { app_name, time_limit, is_blocked } = req.body;
  const limit = time_limit !== undefined ? time_limit : 60;
  const blocked = is_blocked !== undefined ? (is_blocked ? 1 : 0) : 0;

  const sql = `
    INSERT INTO app_controls (child_id, app_name, time_limit, is_blocked) 
    VALUES (?, ?, ?, ?) 
    ON DUPLICATE KEY UPDATE 
    time_limit = IF(VALUES(time_limit) IS NOT NULL, VALUES(time_limit), time_limit),
    is_blocked = IF(VALUES(is_blocked) IS NOT NULL, VALUES(is_blocked), is_blocked)
  `;
  db.query(sql, [id, app_name, limit, blocked], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "App control updated" });
  });
});

// ===============================
// 📱 GET APPS (with auto-provisioning)
// ===============================
router.get("/:id/apps", verifyToken, (req, res) => {
  const { id } = req.params;
  const insertDefaults = `
    INSERT IGNORE INTO app_controls (child_id, app_name, time_limit, is_blocked)
    VALUES (?, 'YouTube', 60, 0), (?, 'Chrome', 60, 0), (?, 'Google', 60, 0)
  `;

  db.query(insertDefaults, [id, id, id], (err) => {
    if (err) console.error("Error provisioning defaults:", err);
    db.query("SELECT * FROM app_controls WHERE child_id = ?", [id], (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results);
    });
  });
});

// ===============================
// 📅 SCHEDULES
// ===============================
router.get("/:id/schedules", verifyToken, (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM schedules WHERE child_id = ?", [id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

router.post("/:id/schedules", verifyToken, (req, res) => {
  const { id } = req.params;
  const { title, start_time, end_time, days, is_active } = req.body;
  const sql = "INSERT INTO schedules (child_id, title, start_time, end_time, days, is_active) VALUES (?, ?, ?, ?, ?, ?)";
  db.query(sql, [id, title, start_time, end_time, JSON.stringify(days), is_active], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Schedule added" });
  });
});

// ===============================
// 🔔 REMINDERS
// ===============================
router.get("/:id/reminders", verifyToken, (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM reminders WHERE child_id = ?", [id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

router.post("/:id/reminders", verifyToken, (req, res) => {
  const { id } = req.params;
  const { message, time, type, priority } = req.body;
  const sql = "INSERT INTO reminders (child_id, message, time, type, priority) VALUES (?, ?, ?, ?, ?)";
  db.query(sql, [id, message, time, type, priority], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Reminder sent" });
  });
});

// ===============================
// 📊 RECORD USAGE
// ===============================
router.post("/:id/usage", (req, res) => {
  const { id } = req.params;
  const { app_name, additional_minutes } = req.body;
  const sql = `UPDATE app_controls SET time_used = time_used + ? WHERE child_id = ? AND app_name = ?`;
  db.query(sql, [additional_minutes || 1, id, app_name], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Usage recorded" });
  });
});

module.exports = router;
