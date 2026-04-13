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
// 📱 GET APP CONTROLS FOR CHILD
// ===============================
router.get("/:id/apps", async (req, res) => {
  try {
    const child_id = req.params.id;

    // 1️⃣ Fetch time-limited app controls
    const [controls] = await db.query(
      "SELECT * FROM app_controls WHERE child_id = ?",
      [child_id]
    );

    // 2️⃣ Fetch strictly blocked package names
    // No verifyToken needed here as this is for the child device
    const [blocked] = await db.query(
      "SELECT package_name FROM blocked_apps WHERE child_id = ?",
      [child_id]
    );

    res.json({
      controls,
      blocked_packages: blocked.map(b => b.package_name)
    });
  } catch (err) {
    console.error("GET APP CONTROLS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch app controls", error: err.message });
  }
});

// ===============================
// 🚫 CREATE / UPDATE APP CONTROL
// ===============================
router.post("/:id/apps", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { app_name, time_limit, is_blocked } = req.body;

    if (!app_name) {
      return res.status(400).json({ message: "app_name is required" });
    }

    // Auto-create table if missing
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_controls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        app_name VARCHAR(100) NOT NULL,
        time_limit INT DEFAULT 60,
        time_used INT DEFAULT 0,
        is_blocked TINYINT(1) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_child_app (child_id, app_name)
      )
    `);

    const updateFields = [];
    const values = [];

    if (time_limit !== undefined) {
      updateFields.push("time_limit = ?");
      values.push(time_limit);
    }
    if (is_blocked !== undefined) {
      updateFields.push("is_blocked = ?");
      values.push(is_blocked ? 1 : 0);
    }

    if (updateFields.length === 0) {
      // Just register the app with defaults
      await db.query(
        `INSERT INTO app_controls (child_id, app_name) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE child_id = child_id`,
        [child_id, app_name]
      );
    } else {
      values.push(child_id, app_name);
      await db.query(
        `INSERT INTO app_controls (child_id, app_name, ${updateFields.map(f => f.split(" = ")[0]).join(", ")})
         VALUES (?, ?, ${updateFields.map(() => "?").join(", ")})
         ON DUPLICATE KEY UPDATE ${updateFields.join(", ")}`,
        [child_id, app_name, ...values.slice(0, updateFields.length)]
      );
    }

    res.json({ message: "App control updated successfully" });
  } catch (err) {
    console.error("UPDATE APP CONTROL ERROR:", err);
    res.status(500).json({ message: "Failed to update app control", error: err.message });
  }
});

// ===============================
// 📡 UPDATE PRESENCE (HEARTBEAT)
// ===============================
router.post("/presence", async (req, res) => {
  try {
    const { child_id, status, current_app, rt_day, rt_today_seconds } = req.body;
    
    // Auto-migrate columns if necessary
    try {
      await db.query("ALTER TABLE children ADD COLUMN app_status VARCHAR(20) DEFAULT 'offline'");
      await db.query("ALTER TABLE children ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL");
      await db.query("ALTER TABLE children ADD COLUMN current_app VARCHAR(255) DEFAULT NULL");
      await db.query("ALTER TABLE children ADD COLUMN rt_day VARCHAR(10) DEFAULT NULL");
      await db.query("ALTER TABLE children ADD COLUMN rt_today_seconds INT DEFAULT 0");
    } catch (e) {
      // Ignore dup field errors
    }

    if (!child_id || !status) {
      return res.status(400).json({ message: "child_id and status are required" });
    }

    const updates = ["app_status = ?", "last_active_at = NOW()"];
    const values = [status];

    if (current_app !== undefined) {
      updates.push("current_app = ?");
      values.push(current_app);
    }
    if (rt_day !== undefined) {
      updates.push("rt_day = ?");
      values.push(rt_day);
    }
    if (rt_today_seconds !== undefined) {
      updates.push("rt_today_seconds = ?");
      values.push(Number(rt_today_seconds) || 0);
    }

    const [result] = await db.query(
      `UPDATE children SET ${updates.join(", ")} WHERE child_id = ?`,
      [...values, child_id]
    );

    if (result.affectedRows === 0) {
      // Also try fallback to id
      await db.query(
        `UPDATE children SET ${updates.join(", ")} WHERE id = ?`,
        [...values, child_id]
      );
    }

    res.json({ message: "Presence updated successfully" });
  } catch (err) {
    console.error("PRESENCE ERROR:", err);
    res.status(500).json({ message: "Failed to update presence", error: err.message });
  }
});

// ===============================
// 📊 RECORD APP USAGE (INCREMENTAL)
// ===============================
router.post("/:id/usage", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { app_name, additional_minutes } = req.body;

    if (!app_name || additional_minutes === undefined) {
      return res.status(400).json({ message: "app_name and additional_minutes are required" });
    }

    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_controls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        app_name VARCHAR(100) NOT NULL,
        time_limit INT DEFAULT 60,
        time_used INT DEFAULT 0,
        is_blocked TINYINT(1) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_child_app (child_id, app_name)
      )
    `);

    // Increment time_used for this app
    await db.query(
      `INSERT INTO app_controls (child_id, app_name, time_used) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE time_used = time_used + ?`,
      [child_id, app_name, additional_minutes, additional_minutes]
    );

    // Also record in app_usage table so the parent dashboard sees it!
    // We record this as a 1-minute session (or whatever additional_minutes is) 
    // starting NOW.
    await db.query(
      `INSERT INTO app_usage (child_id, app_name, start_time, end_time, duration_seconds) 
       VALUES (?, ?, NOW(), NOW(), ?)`,
      [child_id, app_name, additional_minutes * 60]
    );

    res.json({ message: "Usage recorded and synced to history" });
  } catch (err) {
    console.error("USAGE RECORD ERROR:", err);
    res.status(500).json({ message: "Failed to record usage", error: err.message });
  }
});

// ===============================
// 🔔 GET REMINDERS
// ===============================
router.get("/:id/reminders", async (req, res) => {
  try {
    const child_id = req.params.id;
    
    // Auto-create table if missing
    await db.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        message TEXT NOT NULL,
        time VARCHAR(50),
        type VARCHAR(50) DEFAULT 'Alert',
        priority VARCHAR(20) DEFAULT 'Normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [results] = await db.query(
      "SELECT * FROM reminders WHERE child_id = ? ORDER BY id DESC",
      [child_id]
    );

    res.json(results);
  } catch (err) {
    console.error("GET REMINDERS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch reminders", error: err.message });
  }
});

// ===============================
// 🔔 SEND REMINDER
// ===============================
router.post("/:id/reminders", async (req, res) => {
  try {
    const child_id = req.params.id;
    const { message, time, type, priority } = req.body;

    if (!message) {
      return res.status(400).json({ message: "message is required" });
    }

    // Auto-create table if missing
    await db.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        message TEXT NOT NULL,
        time VARCHAR(50),
        type VARCHAR(50) DEFAULT 'Alert',
        priority VARCHAR(20) DEFAULT 'Normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [result] = await db.query(
      "INSERT INTO reminders (child_id, message, time, type, priority) VALUES (?, ?, ?, ?, ?)",
      [child_id, message, time || new Date().toISOString(), type || 'Alert', priority || 'Normal']
    );

    res.json({ message: "Reminder sent successfully", id: result.insertId });
  } catch (err) {
    console.error("SEND REMINDER ERROR:", err);
    res.status(500).json({ message: "Failed to send reminder", error: err.message });
  }
});

// ===============================
// 🔔 SAVE FCM TOKEN (CHILD DEVICE)
// ===============================
router.post("/save-fcm-token", async (req, res) => {
  try {
    const { child_id, fcm_token } = req.body;

    if (!child_id || !fcm_token) {
      return res.status(400).json({
        message: "child_id and fcm_token are required",
      });
    }

    const [result] = await db.query(
      "UPDATE children SET fcm_token = ? WHERE id = ?",
      [fcm_token, child_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Child not found",
      });
    }

    console.log(" FCM token saved for child:", child_id);

    res.json({ message: "FCM token saved successfully" });

  } catch (err) {
    console.error("FCM TOKEN ERROR:", err);
    res.status(500).json({
      message: "Failed to save FCM token",
    });
  }
});
module.exports = router;
