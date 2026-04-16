require("dotenv").config({ path: "./.env" });

console.log(process.env.MYSQLHOST);
console.log(process.env.MYSQLUSER);
console.log(process.env.MYSQLPASSWORD);
console.log(process.env.MYSQLDATABASE);
console.log(process.env.MYSQLPORT);

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ================= DB =================
const db = require("./db");

// ================= MIDDLEWARE =================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

// Request logging
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`${req.method} ${req.url} - ${res.statusCode}`);
  });
  next();
});

// ================= SOCKET SETUP =================
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// make io available in routes
app.set("io", io);

// socket events
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // child joins their room
  socket.on("join_child", (childId) => {
    socket.join("child_" + childId);
    console.log("Joined room:", "child_" + childId);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// ================= ROUTES =================
const userRoutes = require("./routes/users");
app.use("/api/users", userRoutes);

const childRoutes = require("./routes/child");
app.use("/api/children", childRoutes);

const appUsageRoutes = require("./routes/appUsage");
app.use("/api/app-usage", appUsageRoutes);

const screenTimeRoutes = require("./routes/screenTime");
app.use("/api/screen-time", screenTimeRoutes);

const blockAppsRoutes = require("./routes/blockApps");
app.use("/api/block-apps", blockAppsRoutes);

const notificationRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationRoutes);

const installedAppsRoutes = require("./routes/installedApps");
app.use("/api/installed-apps", installedAppsRoutes);

const reminderRoutes = require("./routes/reminders");
app.use("/api/reminders", reminderRoutes);

const restrictionRoutes = require("./routes/restrictions");
app.use("/api/restrictions", restrictionRoutes);

// ================= TEST ROUTES =================
app.get("/", (req, res) => {
  res.send("Kidora Backend Running ");
});

app.get("/test-db", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT 1");
    res.json({
      message: "Database connected successfully ",
      result: rows
    });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({
      message: "Database connection failed ",
      error: err.message
    });
  }
});

// ================= SERVER START =================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
