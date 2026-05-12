const mysql = require("mysql2");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing!");
  process.exit(1);
}

const db = mysql.createPool(process.env.DATABASE_URL).promise();

module.exports = db;
