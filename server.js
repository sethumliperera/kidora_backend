require("dotenv").config({ path: "./.env" }); // ✅ Load environment variables FIRST
console.log(process.env.MYSQLHOST);
console.log(process.env.MYSQLUSER);
console.log(process.env.MYSQLPASSWORD);
console.log(process.env.MYSQLDATABASE);
console.log(process.env.MYSQLPORT);

const express = require("express");
const cors = require("cors");
const app = express();

// ✅ Import DB (IMPORTANT)
const db = require("./db");

// ================= MIDDLEWARE =================

// Allow all origins (you can restrict later)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static folder
app.use("/uploads", express.static("uploads"));

// Request logging
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`${req.method} ${req.url} - ${res.statusCode}`);
  });
  next();
});

// ================= ROUTES =================

// User routes
const userRoutes = require("./routes/users");
app.use("/api/users", userRoutes);

// Child routes
const childRoutes = require("./routes/child");
app.use("/api/children", childRoutes);

// App Usage routes
const appUsageRoutes = require("./routes/appUsage");
app.use("/api/app-usage", appUsageRoutes);

// Screen Time routes
const screenTimeRoutes = require("./routes/screenTime");
app.use("/api/screen-time", screenTimeRoutes);

// Blocked Apps routes
const blockAppsRoutes = require("./routes/blockApps");
app.use("/api/block-apps", blockAppsRoutes);

// Notifications routes
const notificationRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationRoutes);

// Installed Apps routes
const installedAppsRoutes = require("./routes/installedApps");
app.use("/api/installed-apps", installedAppsRoutes);

// Reminder routes
const reminderRoutes = require("./routes/reminders");
app.use("/api/reminders", reminderRoutes);

// Restrictions routes
const restrictionRoutes = require("./routes/restrictions");
app.use("/api/restrictions", restrictionRoutes);

// ================= TEST ROUTES =================

// Basic test
app.get("/", (req, res) => {
  res.send("Kidora Backend Running ✅");
});

// 🔥 DATABASE TEST ROUTE (VERY IMPORTANT)
app.get("/test-db", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT 1");
    res.json({
      message: "Database connected successfully ✅",
      result: rows
    });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({
      message: "Database connection failed ❌",
      error: err.message
    });
  }
});

// ================= SERVER =================

const PORT = process.env.PORT || 3000;

// Listen on all network interfaces (important for mobile testing)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
