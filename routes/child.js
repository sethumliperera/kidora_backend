const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

// MULTER CONFIG
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.random();
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// GENERATE IDS
const generateUniqueCodes = () => {
  const childId = "KID-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();
  return { childId, linkingCode };
};

// =========================
// 📷 UPLOAD PHOTO
// =========================
router.post("/upload-photo", verifyToken, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ photo_url: `/uploads/${req.file.filename}` });
});

// =========================
// 👶 ADD CHILD (FINAL FIXED)
// =========================
router.post("/add", (req, res) => {
  const { firebase_uid, name, age, gender, interests, photo_url } = req.body;

  console.log("REQUEST BODY:", req.body);

  if (!firebase_uid || !name || age === undefined || age === null) {
    return res.status(400).json({
      message: "firebase_uid, name and age are required"
    });
  }

  // 🔧 INSERT CHILD FUNCTION
  const insertChild = (parent_id) => {
    const { childId, linkingCode } = generateUniqueCodes();

    const sql = `
      INSERT INTO children 
      (name, age, gender, interests, photo_url, child_id, linking_code, parent_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name,
      parseInt(age),
      gender || null,
      interests || null,
      photo_url || null,
      childId,
      linkingCode,
      parent_id
    ];

    console.log("INSERT VALUES:", values);

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("INSERT CHILD ERROR:", err);
        return res.status(500).json({
          message: "Database error",
          error: err.sqlMessage || err.message
        });
      }

      res.json({
        id: result.insertId,
        message: "Child added successfully",
        child_id: childId,
        linking_code: linkingCode
      });
    });
  };

  // 🔍 FIND USER
  const findUserSql = "SELECT id FROM users WHERE firebase_uid = ?";

  db.query(findUserSql, [firebase_uid], (err, results) => {
    if (err) {
      console.error("User lookup error:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }

    // ✅ USER EXISTS
    if (results.length > 0) {
      const parent_id = results[0].id;
      return insertChild(parent_id);
    }

    // 🔥 USER NOT FOUND → CREATE USER
    console.log("User not found → creating new user");

    const insertUserSql = `
      INSERT INTO users (firebase_uid, email, role) 
      VALUES (?, ?, 'parent')
    `;

    db.query(insertUserSql, [firebase_uid, null], (err, result) => {
      if (err) {
        console.error("User insert error:", err);
        return res.status(500).json({ message: "Database error", error: err });
      }

      const parent_id = result.insertId;
      insertChild(parent_id);
    });
  });
});

// =========================
// 📥 GET CHILDREN
// =========================
router.get("/", verifyToken, (req, res) => {
  const parent_id = req.user.id;
  db.query("SELECT * FROM children WHERE parent_id = ?", [parent_id], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// =========================
// 🗑 DELETE CHILD
// =========================
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

// =========================
// 🔗 LINK CHILD
// =========================
router.post("/link", (req, res) => {
  const { linking_code } = req.body;

  if (!linking_code) {
    return res.status(400).json({ message: "Linking code is required" });
  }

  db.query("SELECT * FROM children WHERE linking_code = ?", [linking_code], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0) {
      return res.status(404).json({ message: "Invalid linking code" });
    }

    const child = results[0];
    res.json({
      message: "Linked successfully",
      child
    });
  });
});

// =========================
// ⏱ UPDATE SCREEN TIME
// =========================
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

// =========================
// 📊 RECORD USAGE
// =========================
router.post("/:id/usage", (req, res) => {
  const { id } = req.params;
  const { app_name, additional_minutes } = req.body;

  db.query(
    `UPDATE app_controls SET time_used = time_used + ? WHERE child_id = ? AND app_name = ?`,
    [additional_minutes || 1, id, app_name],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Usage recorded" });
    }
  );
});

module.exports = router;
