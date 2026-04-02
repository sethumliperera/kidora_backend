const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json"); // download this

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;