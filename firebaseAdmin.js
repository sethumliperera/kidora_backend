const admin = require("firebase-admin");

function loadServiceAccount() {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (e) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is set but invalid JSON: ${e?.message || e}`
      );
    }
  }

  const b64 = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "").trim();
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch (e) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_BASE64 is set but invalid: ${e?.message || e}`
      );
    }
  }

  try {
    return require("./serviceAccountKey.json");
  } catch (_e) {
    throw new Error(
      "Firebase Admin: set FIREBASE_SERVICE_ACCOUNT_JSON (or BASE64) on the API host, or add kidora_backend/serviceAccountKey.json for local dev."
    );
  }
}

const serviceAccount = loadServiceAccount();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = admin;
