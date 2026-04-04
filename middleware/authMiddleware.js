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
    const sql = "SELECT id FROM users WHERE firebase_uid = ?";
    db.query(sql, [decodedToken.uid], (err, results) => {
      if (err) {
        console.error("Database error in middleware:", err);
        return res.status(500).json({ message: "Database error during authentication" });
      }

      if (results.length === 0) {
        console.warn(`User not found in MySQL for UID: ${decodedToken.uid}`);
        return res.status(404).json({ message: "User not found in database" });
      }

      // ✅ FIX: explicitly map fields
      req.user = {
        id: results[0].id,                // MySQL parent_id
        firebase_uid: decodedToken.uid,  // 🔥 IMPORTANT FIX
        email: decodedToken.email
      };

      console.log("Middleware user object:", req.user);

      next();
    });

  } catch (error) {
    console.error("Auth Error details:", error);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = verifyToken;
