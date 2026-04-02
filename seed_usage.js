const db = require("./db");

// Get the first child and add sample usage for today
db.query("SELECT id, name FROM children LIMIT 1", (err, children) => {
  if (err || children.length === 0) {
    console.error("No children found or DB error:", err);
    process.exit(1);
  }

  const child = children[0];
  console.log(`Seeding usage for child: ${child.name} (ID: ${child.id})`);

  const todayStr = new Date().toISOString().split('T')[0];
  const apps = [
    { name: "YouTube", duration: 3600 }, // 1 hour
    { name: "Instagram", duration: 1800 }, // 30 mins
    { name: "TikTok", duration: 900 }, // 15 mins
    { name: "Snake Game", duration: 450 } // 7.5 mins
  ];

  let completed = 0;
  apps.forEach(app => {
    const startTime = `${todayStr} 10:00:00`;
    const endTime = `${todayStr} 11:00:00`; // Just dummy times

    const sql = "INSERT INTO app_usage (child_id, app_name, start_time, end_time, duration_seconds) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [child.id, app.name, startTime, endTime, app.duration], (err) => {
      if (err) console.error(`Error seeding ${app.name}:`, err);
      else console.log(`Seeded ${app.name} with ${app.duration}s`);
      
      completed++;
      if (completed === apps.length) {
        console.log("Seeding complete!");
        process.exit(0);
      }
    });
  });
});
