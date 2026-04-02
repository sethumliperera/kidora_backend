const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Terminal890/",
  database: "kidora_db"
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }
  
  db.query("DESCRIBE children", (err, results) => {
    if (err) {
      console.error("Query failed:", err);
      process.exit(1);
    }
    console.log(JSON.stringify(results, null, 2));
    db.end();
  });
});
