const db = require("./db");

const tables = {
  app_usage: `
    CREATE TABLE IF NOT EXISTS app_usage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      duration_seconds INT NOT NULL,
      UNIQUE KEY unique_session (child_id, app_name, start_time),
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
    )
  `,
  app_controls: `
    CREATE TABLE IF NOT EXISTS app_controls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      time_limit INT DEFAULT 60,
      time_used INT DEFAULT 0,
      is_blocked BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_child_app (child_id, app_name),
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
    )
  `,
  schedules: `
    CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      title VARCHAR(255),
      start_time TIME,
      end_time TIME,
      days JSON,
      is_active BOOLEAN DEFAULT TRUE,
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
    )
  `,
  reminders: `
    CREATE TABLE IF NOT EXISTS reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      message TEXT,
      time TIME,
      type VARCHAR(50),
      priority VARCHAR(50),
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
    )
  `
};

const setup = async () => {
  try {
    for (const [name, sql] of Object.entries(tables)) {
      await new Promise((resolve, reject) => {
        db.query(sql, (err) => {
          if (err) {
            console.error(`Error creating table ${name}:`, err);
            reject(err);
          } else {
            console.log(`Table ${name} is ready.`);
            resolve();
          }
        });
      });
    }

    // Check for screen_time_limit column
    db.query("SHOW COLUMNS FROM children LIKE 'screen_time_limit'", (err, results) => {
      if (err) {
        console.error("Error checking columns:", err);
        process.exit(1);
      }
      if (results.length === 0) {
        db.query("ALTER TABLE children ADD COLUMN screen_time_limit INT DEFAULT 120", (err) => {
          if (err) console.error("Error adding column:", err);
          else console.log("screen_time_limit column added.");
          process.exit();
        });
      } else {
        console.log("screen_time_limit column already exists.");
        process.exit();
      }
    });
  } catch (e) {
    console.error("Setup failed:", e);
    process.exit(1);
  }
};

setup();
