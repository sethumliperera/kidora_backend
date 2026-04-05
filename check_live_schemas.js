require("dotenv").config({ path: "./.env" });
const mysql = require("mysql2/promise");

async function check() {
  const url = process.env.DATABASE_URL;
  try {
    const db = await mysql.createConnection(url);
    const [cols] = await db.query("SHOW COLUMNS FROM children");
    console.log("Children columns:", cols.map(c => c.Field));
    db.end();
  } catch (e) {
    console.error("Error:", e.message);
  }
}
check();
