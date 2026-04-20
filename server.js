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

const isNumericChildRef = (value) =>
  typeof value === "number" || /^\d+$/.test(String(value || "").trim());

const resolveChildRooms = async (childRef) => {
  const rooms = new Set();
  if (childRef === undefined || childRef === null || childRef === "") {
    return [];
  }

  const refString = String(childRef).trim();
  rooms.add(`child_${refString}`);

  try {
    let rows = [];
    if (isNumericChildRef(refString)) {
      const [byId] = await db.query(
        "SELECT id, child_id FROM children WHERE id = ? LIMIT 1",
        [Number(refString)]
      );
      rows = byId;
    } else {
      const [byPublicId] = await db.query(
        "SELECT id, child_id FROM children WHERE child_id = ? LIMIT 1",
        [refString]
      );
      rows = byPublicId;
    }

    if (rows.length > 0) {
      rooms.add(`child_${rows[0].id}`);
      if (rows[0].child_id) {
        rooms.add(`child_${rows[0].child_id}`);
      }
    }
  } catch (err) {
    console.error("⚠ Failed to resolve child rooms:", err.message);
  }

  return [...rooms];
};

// ===============================
// REMINDER SCHEDULER 🔥
// ===============================
setInterval(async () => {
  try {
    const now = new Date();

    const [reminders] = await db.query(
      `
      SELECT * FROM reminders
      WHERE scheduled_at <= ? AND is_sent = 0
      `,
      [now]
    );

    if (reminders.length > 0) {
      console.log(`⏰ Found ${reminders.length} reminders to send`);
    }

    for (const reminder of reminders) {
      const payload = {
        id: reminder.id,
        title: reminder.title,
        message: reminder.message,
        type: "reminder",
        priority: reminder.priority,
      };

      // ✅ SEND TO CHILD VIA SOCKET
      const rooms = await resolveChildRooms(reminder.child_id);
      rooms.forEach((room) => io.to(room).emit("new_notification", payload));

      console.log(`📤 Sent reminder to child_${reminder.child_id}`);

      // ✅ MARK AS SENT
      await db.query(
        `UPDATE reminders SET is_sent = 1, sent_at = NOW() WHERE id = ?`,
        [reminder.id]
      );
    }
  } catch (err) {
    console.error("❌ Reminder scheduler error:", err);
  }
}, 5000); // runs every 5 seconds

// ===============================
// SOCKET HELPERS
// ===============================
const sendToChild = async (childId, event, data) => {
  const rooms = await resolveChildRooms(childId);
  rooms.forEach((room) => io.to(room).emit(event, data));
};

const sendToParent = (parentId, event, data) => {
  io.to(`parent_${parentId}`).emit(event, data);
};

// ===============================
// SOCKET EVENTS
// ===============================
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("join_child", async (childId) => {
    if (!childId) return;
    const rooms = await resolveChildRooms(childId);
    rooms.forEach((room) => socket.join(room));
    console.log(`👶 Joined child rooms for ${childId}: ${rooms.join(", ")}`);
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
