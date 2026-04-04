const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

// MULTER CONFIG FOR PHOTO UPLOADS
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// HELPER: GENERATE UNIQUE CHILD ID & LINKING CODE
const generateUniqueCodes = () => {
  const childId = "KID-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();
  return { childId, linkingCode };
};

// 1. UPLOAD PHOTO
router.post("/upload-photo", verifyToken, upload.single("photo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  const photoUrl = `/uploads/${req.file.filename}`;
  res.json({ photo_url: photoUrl });
});

// 2. ADD CHILD (UPDATED)
router.post("/add", (req, res) => {
  const { firebase_uid, name, age, gender, interests, photo_url } = req.body;

  // validation
  if (!firebase_uid || !name || !age) {
    return res.status(400).json({ message: "firebase_uid, name and age are required" });
  }

  // 1. Find parent using firebase_uid
  const findParentSql = "SELECT id FROM users WHERE firebase_uid = ?";

  db.query(findParentSql, [firebase_uid], (err, parentResults) => {
    if (err) {
      console.error("Parent lookup error:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    if (parentResults.length === 0) {
      return res.status(404).json({ message: "Parent not found" });
    }

    const parent_id = parentResults[0].id;

    // 2. Generate child codes
    const { childId, linkingCode } = generateUniqueCodes();

    // 3. Insert child
    const insertSql = `
      INSERT INTO children 
      (name, age, gender, interests, photo_url, child_id, linking_code, parent_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
      insertSql,
      [name, age, gender, interests, photo_url, childId, linkingCode, parent_id],
      (err, result) => {
        if (err) {
          console.error("Insert child error:", err);
          return res.status(500).json({
            message: "Failed to add child",
            error: err
          });
        }

        res.json({
          id: result.insertId,
          message: "Child added successfully",
          child_id: childId,
          linking_code: linkingCode
        });
      }
    );
  });
});

// 3. GET CHILDREN
router.get("/", verifyToken, (req, res) => {
  const parent_id = req.user.id;

  const sql = "SELECT * FROM children WHERE parent_id = ?";

  db.query(sql, [parent_id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 4. DELETE CHILD
router.delete("/:id", verifyToken, (req, res) => {
  const child_id = req.params.id;
  const parent_id = req.user.id;

  const sql = "DELETE FROM children WHERE id = ? AND parent_id = ?";

  db.query(sql, [child_id, parent_id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Child not found or unauthorized" });
    }
    res.json({ message: "Child deleted successfully" });
  });
});

// 5. LINK CHILD DEVICE (NEW)
router.post("/link", (req, res) => {
  const { linking_code } = req.body;

  if (!linking_code) {
    return res.status(400).json({ message: "Linking code is required" });
  }

  const sql = "SELECT * FROM children WHERE linking_code = ?";

  db.query(sql, [linking_code], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Invalid linking code" });
    }

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

// 6. UPDATE SCREEN TIME LIMIT (GLOBAL)
router.patch("/:id/screen-time-limit", verifyToken, (req, res) => {
  const { id } = req.params;
  const { screen_time_limit } = req.body;
  const parent_id = req.user.id;

  const sql = "UPDATE children SET screen_time_limit = ? WHERE id = ? AND parent_id = ?";
  db.query(sql, [screen_time_limit, id, parent_id], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Limit updated successfully" });
  });
});

// 7. REMOVED OLD ROUTE - USING OPTIMIZED ONE BELOW

// 8. UPDATE APP CONTROL (BLOCK/LIMIT)
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
  db.query(sql, [id, app_name, limit, blocked], (err, result) => {
    if (err) {
      console.error("Error updating app control:", err);
      return res.status(500).json(err);
    }
    res.json({ message: "App control updated" });
  });
});

// 8. GET APPS (with auto-provisioning of defaults)
router.get("/:id/apps", verifyToken, (req, res) => {
  const { id } = req.params;
  const defaultApps = ["YouTube", "Chrome", "Google"];

  // 1. Ensure defaults exist
  const insertDefaults = `
    INSERT IGNORE INTO app_controls (child_id, app_name, time_limit, is_blocked)
    VALUES (?, 'YouTube', 60, 0), (?, 'Chrome', 60, 0), (?, 'Google', 60, 0)
  `;

  db.query(insertDefaults, [id, id, id], (err) => {
    if (err) {
      console.error("Error provisioning defaults:", err);
      // Continue anyway to show what we have
    }

    // 2. Fetch all apps
    db.query("SELECT * FROM app_controls WHERE child_id = ?", [id], (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results);
    });
  });
});

// 9. SCHEDULES
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

// 10. REMINDERS
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

// 11. RECORD USAGE (ACTIVITY TRACKING)
router.post("/:id/usage", (req, res) => {
  const { id } = req.params;
  const { app_name, additional_minutes } = req.body;

  const sql = `
    UPDATE app_controls 
    SET time_used = time_used + ? 
    WHERE child_id = ? AND app_name = ?
  `;

  db.query(sql, [additional_minutes || 1, id, app_name], (err, result) => {
    if (err) {
      console.error("Error recording usage:", err);
      return res.status(500).json(err);
    }
    res.json({ message: "Usage recorded" });
  });
});

module.exports = router;
