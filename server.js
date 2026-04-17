require("dotenv").config({ path: "./.env" });

// ===============================
//  ENV DEBUG 
// ===============================
console.log("DB HOST:", process.env.MYSQLHOST);
console.log("DB USER:", process.env.MYSQLUSER);
console.log("DB NAME:", process.env.MYSQLDATABASE);

// ===============================
//  IMPORTS
// ===============================
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// ===============================
//  APP INIT
// ===============================
const app = express();
const server = http.createServer(app);

// ===============================
// 🗄 DATABASE
// ===============================
const db = require("./db");

// ===============================
//  MIDDLEWARE
// ===============================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

// ===============================
//  REQUEST LOGGER
// ===============================
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode}`);
  });
  next();
});

// ===============================
//  SOCKET.IO SETUP
// ===============================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// make io accessible inside routes
app.set("io", io);

// ===============================
//  SOCKET EVENTS
// ===============================
io.on("connection", (socket) => {
  console.log(" Socket connected:", socket.id);

  //  CHILD JOINS ROOM
  socket.on("join_child", (childId) => {
    const room = "child_" + childId;
    socket.join(room);
    console.log(` Child joined room: ${room}`);
  });

  //  PARENT JOINS ROOM (optional future use)
  socket.on("join_parent", (parentId) => {
    const room = "parent_" + parentId;
    socket.join(room);
    console.log(` Parent joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log(" Socket disconnected:", socket.id);
  });
});

// ===============================
// ROUTES
// ===============================

// Users
const userRoutes = require("./routes/users");
app.use("/api/users", userRoutes);

// Children
const childRoutes = require("./routes/child");
app.use("/api/children", childRoutes);

// App Usage
const appUsageRoutes = require("./routes/appUsage");
app.use("/api/app-usage", appUsageRoutes);

// Screen Time
const screenTimeRoutes = require("./routes/screenTime");
app.use("/api/screen-time", screenTimeRoutes);

// Block Apps
const blockAppsRoutes = require("./routes/blockApps");
app.use("/api/block-apps", blockAppsRoutes);

// Notifications
const notificationRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationRoutes);

// Installed Apps
const installedAppsRoutes = require("./routes/installedApps");
app.use("/api/installed-apps", installedAppsRoutes);

// Reminders 
const reminderRoutes = require("./routes/reminders");
app.use("/api/reminders", reminderRoutes);

// Restrictions
const restrictionRoutes = require("./routes/restrictions");
app.use("/api/restrictions", restrictionRoutes);

// ===============================
//  TEST ROUTES
// ===============================
app.get("/", (req, res) => {
  res.json({
    message: "Kidora Backend Running"
  });
});

app.get("/test-db", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT 1");

    res.json({
      message: "Database connected successfully",
      result: rows
    });

  } catch (err) {
    console.error("DB ERROR:", err);

    res.status(500).json({
      message: "Database connection failed",
      error: err.message
    });
  }
});

// ===============================
//  START SERVER
// ===============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(` Server running on port ${PORT}`);
});
