const mysql = require("mysql2");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing!");
  process.exit(1);
}

try {
  const raw = String(process.env.DATABASE_URL);
  const sanitized = raw.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
  const hostMatch = raw.match(/@([^/?]+)/);
  const dbMatch = raw.match(/\/([^/?]+)(\?|$)/);
  console.log(
    "[db] DATABASE_URL target:",
    hostMatch ? `host=${hostMatch[1]}` : "(unparsed)",
    dbMatch ? `database=${dbMatch[1]}` : "",
    "|",
    sanitized.slice(0, 80) + (sanitized.length > 80 ? "…" : "")
  );
} catch (_e) {
  console.log("[db] DATABASE_URL set (could not log host)");
}

const db = mysql.createPool(process.env.DATABASE_URL).promise();

module.exports = db;
