require("dotenv").config({ path: "./.env" });

// ===============================
// ENV DEBUG
// ===============================
console.log("DB HOST:", process.env.MYSQLHOST);
console.log("DB USER:", process.env.MYSQLUSER);
console.log("DB NAME:", process.env.MYSQLDATABASE);

// ===============================
// IMPORTS
// ===============================
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// ===============================
// APP INIT
// ===============================
const app = express();
const server = http.createServer(app);

// ===============================
// DB
// ===============================
const db = require("./db");

// ===============================
// MIDDLEWARE
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
// SOCKET.IO
// ===============================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set("io", io);

// ===============================
// SOCKET EVENTS (FIXED)
// ===============================
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // 👶 CHILD JOIN
  socket.on("join_child", (childId) => {
    if (!childId) return;

    const room = `child_${childId}`;
    socket.join(room);

    console.log(`👶 Joined room: ${room}`);
  });

  // 👨 PARENT JOIN
  socket.on("join_parent", (parentId) => {
    if (!parentId) return;

    const room = `parent_${parentId}`;
    socket.join(room);

    console.log(`👨 Joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

// ===============================
// ROUTES
// ===============================
app.use("/api/users", require("./routes/users"));
app.use("/api/children", require("./routes/child"));
app.use("/api/app-usage", require("./routes/appUsage"));
app.use("/api/screen-time", require("./routes/screenTime"));
app.use("/api/block-apps", require("./routes/blockApps"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/installed-apps", require("./routes/installedApps"));
app.use("/api/reminders", require("./routes/reminders"));
app.use("/api/restrictions", require("./routes/restrictions"));

// ===============================
// TEST
// ===============================
app.get("/", (req, res) => {
  res.json({ message: "Kidora Backend Running" });
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
