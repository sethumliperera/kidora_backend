const admin = require("firebase-admin");

let serviceAccount = null;

// Prefer env-based credentials in production (e.g., Render):
// FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (err) {
    console.error(" Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", err.message);
    throw err;
  }
} else {
  // Local fallback
  serviceAccount = require("./serviceAccountKey.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
