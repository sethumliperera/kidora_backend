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
    const uniqueSuffix = Date.now() + "-" + Math.random() * 1e9;
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ===============================
// 🛠 HELPERS
// ===============================
const generateUniqueCodes = () => {
  const childId = "KID-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  return { childId };
};

const generateLinkingCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ===============================
// 📷 UPLOAD PHOTO
// ===============================
router.post("/upload-photo", verifyToken, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ photo_url: `/uploads/${req.file.filename}` });
});

// ===============================
// 👶 ADD CHILD + GENERATE LINK CODE
// ===============================
router.post("/add", async (req, res) => {
  try {
    const { firebase_uid, name, age, gender, interests, photo_url, email } = req.body;

    if (!firebase_uid || !name || age === undefined || !email) {
      return res.status(400).json({
        message: "firebase_uid, name, age and email are required"
      });
    }

    // 1️⃣ Find parent
    const [parentResults] = await db.query(
      "SELECT id FROM users WHERE firebase_uid = ? OR email = ?",
      [firebase_uid, email]
    );

    let parent_id;

    if (parentResults.length > 0) {
      parent_id = parentResults[0].id;
    } else {
      const [insertParent] = await db.query(
        "INSERT INTO users (firebase_uid, email, role) VALUES (?, ?, 'parent')",
        [firebase_uid, email] // ✅ FIXED HERE
      );
      parent_id = insertParent.insertId;
    }

    // 2️⃣ Create child
    const { childId } = generateUniqueCodes();

    const [childResult] = await db.query(
      `INSERT INTO children 
      (name, age, gender, interests, photo_url, child_id, parent_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, parseInt(age), gender || null, interests || null, photo_url || null, childId, parent_id]
    );

    const child_id = childResult.insertId;

    // 3️⃣ Generate linking code (NEW SYSTEM)
    const code = generateLinkingCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      "INSERT INTO linking_codes (parent_id, child_id, code, expires_at, is_used) VALUES (?, ?, ?, ?, 0)",
      [parent_id, child_id, code, expiresAt]
    );

    res.json({
      message: "Child added successfully",
      child_id: childId,
      linking_code: code
    });

  } catch (err) {
    console.error("ADD CHILD ERROR:", err);
    res.status(500).json({
      message: "Failed to add child",
      error: err.message
    });
  }
});

// ===============================
// 🔗 VERIFY LINK CODE (UPDATED)
// ===============================
router.post("/link", async (req, res) => {
  try {
    const { linking_code, device_id } = req.body;

    if (!linking_code) {
      return res.status(400).json({ message: "Linking code is required" });
    }

    const [rows] = await db.query(
      "SELECT * FROM linking_codes WHERE code = ? AND is_used = 0",
      [linking_code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid or already used code" });
    }

    const link = rows[0];

    if (new Date() > new Date(link.expires_at)) {
      return res.status(400).json({ message: "Code expired" });
    }

    // Link device to child
    await db.query(
      "UPDATE children SET device_id = ?, parent_id = ? WHERE id = ?",
      [device_id || null, link.parent_id, link.child_id]
    );

    // Mark code used
    await db.query(
      "UPDATE linking_codes SET is_used = 1 WHERE id = ?",
      [link.id]
    );

    // Return child data
    const [childRows] = await db.query(
      "SELECT * FROM children WHERE id = ?",
      [link.child_id]
    );

    res.json({
      message: "Device linked successfully ✅",
      child: childRows[0]
    });

  } catch (err) {
    console.error("LINK ERROR:", err);
    res.status(500).json({ message: "Linking failed", error: err.message });
  }
});

// ===============================
// 📥 GET CHILDREN
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
    res.status(500).json(err);
  }
});

// ===============================
// 🗑 DELETE CHILD
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
      return res.status(404).json({ message: "Child not found or unauthorized" });
    }

    res.json({ message: "Child deleted successfully" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ===============================
// (KEEP REST OF YOUR CODE SAME)
// ===============================

module.exports = router;
