const mysql = require("mysql2/promise");
require("dotenv").config();

async function check() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM children");
    console.log("Children columns:", cols.map(c => c.Field));
    const [lcCols] = await db.query("SHOW COLUMNS FROM linking_codes");
    console.log("linking_codes columns:", lcCols.map(c => c.Field));
  } catch (e) {
    console.error(e);
  } finally {
    await db.end();
  }
}
check();
