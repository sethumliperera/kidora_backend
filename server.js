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
// SOCKET HELPERS
// ===============================
const sendToChild = (childId, event, data) => {
  io.to(`child_${childId}`).emit(event, data);
};

const sendToParent = (parentId, event, data) => {
  io.to(`parent_${parentId}`).emit(event, data);
};

// ===============================
// SOCKET EVENTS
// ===============================
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("join_child", (childId) => {
    if (!childId) return;
    socket.join(`child_${childId}`);
    console.log(`👶 Joined child room: child_${childId}`);
  });

  socket.on("join_parent", (parentId) => {
    if (!parentId) return;
    socket.join(`parent_${parentId}`);
    console.log(`👨 Joined parent room: parent_${parentId}`);
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
// EXPORT HELPERS (optional use in routes)
// ===============================
app.set("sendToChild", sendToChild);
app.set("sendToParent", sendToParent);

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
