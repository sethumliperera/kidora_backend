const admin = require("../firebaseAdmin");
const db = require("../db");

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    // ❌ No token
    if (!authHeader) {
      return res.status(403).json({ message: "No token provided" });
    }

    // ✅ Extract token (Bearer TOKEN)
    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(403).json({ message: "Invalid token format" });
    }

    // ✅ Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log(`Token verified for Firebase UID: ${decodedToken.uid}`);

    // 🔍 Get user from MySQL using firebase_uid
    let sql = "SELECT id, firebase_uid, email FROM users WHERE firebase_uid = ?";
    let [results] = await db.query(sql, [decodedToken.uid]);

    // 🔄 FALLBACK: Search by email if not found by Firebase UID
    if (results.length === 0 && decodedToken.email) {
      console.log(`User not found by UID, searching by email: ${decodedToken.email}`);
      sql = "SELECT id, firebase_uid, email FROM users WHERE email = ?";
      [results] = await db.query(sql, [decodedToken.email]);

      if (results.length > 0) {
        const userId = results[0].id;
        console.log(`User found by email (ID: ${userId}). Syncing Firebase UID...`);
        
        // 🔥 SYNC: Update record with the missing/new Firebase UID
        await db.query(
          "UPDATE users SET firebase_uid = ? WHERE id = ?",
          [decodedToken.uid, userId]
        );
      }
    }

    if (results.length === 0) {
      console.warn(`No user record found in MySQL for UID ${decodedToken.uid} or email ${decodedToken.email}`);
      return res.status(404).json({ message: "Parent profile not found in database. Please contact support or re-register." });
    }

    // ✅ Map user data to request
    req.user = {
      id: results[0].id,
      firebase_uid: decodedToken.uid,
      email: decodedToken.email
    };

    console.log("Authenticated User ID:", req.user.id);

    next();

  } catch (error) {
    console.error("Auth Error details:", error);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = verifyToken;
