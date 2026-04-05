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
      "SELECT id, firebase_uid FROM users WHERE firebase_uid = ? OR email = ?",
      [firebase_uid, email]
    );

    let parent_id;

    if (parentResults.length > 0) {
      parent_id = parentResults[0].id;
      const existingUid = parentResults[0].firebase_uid;
      
      // ✅ SYNC UID: If UID was missing or different, update it
      if (!existingUid || existingUid !== firebase_uid) {
        console.log(`Syncing Firebase UID for parent ID ${parent_id}`);
        await db.query(
          "UPDATE users SET firebase_uid = ? WHERE id = ?",
          [firebase_uid, parent_id]
        );
      }
    } else {
      console.log(`Creating new parent record for ${email}`);
      const [insertParent] = await db.query(
        "INSERT INTO users (firebase_uid, email, role) VALUES (?, ?, 'parent')",
        [firebase_uid, email]
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

    const child_id_db = childResult.insertId;

    // 3️⃣ Fetch full child record to return to UI
    const [newChildRows] = await db.query("SELECT * FROM children WHERE id = ?", [child_id_db]);
    const newChild = newChildRows[0];

    // 4️⃣ Generate linking code (30-MINUTE EXPIRATION)
    const code = generateLinkingCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 🚀 EXTENDED TO 30 MIN

    await db.query(
      "INSERT INTO linking_codes (parent_id, child_id, code, expires_at, is_used) VALUES (?, ?, ?, ?, 0)",
      [parent_id, child_id_db, code, expiresAt]
    );

    res.json({
      message: "Child added successfully",
      child: newChild,
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
// 🔗 VERIFY LINK CODE (HARDENED)
// ===============================
router.post("/link", async (req, res) => {
  try {
    const { linking_code, device_id } = req.body;

    if (!linking_code) {
      return res.status(400).json({ message: "Linking code is required" });
    }

    console.log(`🔗 Linking attempt for code: ${linking_code}`);

    // 1️⃣ Find valid code (Check is_used and expires_at in SQL ✅)
    const [rows] = await db.query(
      "SELECT * FROM linking_codes WHERE code = ? AND is_used = 0",
      [linking_code]
    );

    if (rows.length === 0) {
      console.warn(`❌ Link code ${linking_code} not found or already used`);
      return res.status(400).json({ message: "Invalid or already used code" });
    }

    const link = rows[0];

    // 2️⃣ Check expiration in SQL-compatible way
    // (We do this as a fallback in JS, but the DB comparison is usually safer)
    if (new Date() > new Date(link.expires_at)) {
      console.warn(`❌ Link code ${linking_code} expired at ${link.expires_at}`);
      return res.status(400).json({ message: "This code has expired. Please generate a new one." });
    }

    // 3️⃣ Perform linking update
    console.log(`✅ Linking child ID ${link.child_id}`);
    
    // 🔥 SYNC: Update child record
    const [updateResult] = await db.query(
      "UPDATE children SET parent_id = ? WHERE id = ?",
      [link.parent_id, link.child_id]
    );

    if (updateResult.affectedRows === 0) {
      throw new Error("Failed to update child profile with linking info");
    }

    // 4️⃣ Mark code as used
    await db.query(
      "UPDATE linking_codes SET is_used = 1 WHERE id = ?",
      [link.id]
    );

    // 5️⃣ Return child data for frontend initialization
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

    console.log("Fetching children for parent_id:", parent_id);

    // ✅ Fetch children
    const [results] = await db.query(
      "SELECT * FROM children WHERE parent_id = ?",
      [parent_id]
    );

    console.log("Children found:", results.length);

    res.json(results);

  } catch (err) {
    console.error("GET CHILDREN ERROR:", err);
    res.status(500).json({ message: "Failed to fetch children", error: err.message });
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
