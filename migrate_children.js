const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Terminal890/",
  database: "kidora_db"
});

const queries = [
  "ALTER TABLE children ADD COLUMN gender VARCHAR(20) AFTER age",
  "ALTER TABLE children ADD COLUMN interests TEXT AFTER gender",
  "ALTER TABLE children ADD COLUMN photo_url VARCHAR(255) AFTER interests",
  "ALTER TABLE children ADD COLUMN child_id VARCHAR(50) UNIQUE AFTER photo_url",
  "ALTER TABLE children ADD COLUMN linking_code VARCHAR(10) UNIQUE AFTER child_id"
];

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }

  let completed = 0;
  queries.forEach((sql) => {
    db.query(sql, (err) => {
      if (err) {
        if (err.code === 'ER_DUP_COLUMN_NAME') {
          console.log("Column already exists, skipping...");
        } else {
          console.error("Query failed:", err);
        }
      } else {
        console.log("Query executed successfully:", sql);
      }
      completed++;
      if (completed === queries.length) {
        db.end();
        console.log("Migration complete.");
      }
    });
  });
});
