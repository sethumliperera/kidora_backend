require("dotenv").config();
const mysql = require("mysql2/promise");

async function migratePresence() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  try {
    const db = await mysql.createConnection(url);
    console.log("Connected to DB.");

    try {
      await db.query("ALTER TABLE children ADD COLUMN app_status VARCHAR(20) DEFAULT 'offline'");
      console.log("Added app_status column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log("app_status already exists");
      else throw e;
    }

    try {
      await db.query("ALTER TABLE children ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL");
      console.log("Added last_active_at column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log("last_active_at already exists");
      else throw e;
    }

    console.log("Migration complete!");
    db.end();
  } catch (error) {
    console.error("Migration Failed:", error);
  }
}

migratePresence();
