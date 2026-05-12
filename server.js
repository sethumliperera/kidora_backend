require("dotenv").config({ path: "./.env" });

// ===============================
// ENV DEBUG
// ===============================
console.log("DB HOST:", process.env.MYSQLHOST);
console.log("DB USER:", process.env.MYSQLUSER);
console.log("DB NAME:", process.env.MYSQLDATABASE);
// Inserts (e.g. safety_search_alerts) go to THIS database — must match where you look in Railway/Render.
const du = String(process.env.DATABASE_URL || "");
const duHost = du.match(/@([^/?]+)/);
console.log(
  "DATABASE_URL host:",
  duHost ? duHost[1] : du ? "(set, could not parse host)" : "(missing)"
);

const { logSmtpStartup } = require("./smtpEnv");
const { logMailStartup } = require("./mailDelivery");
logSmtpStartup();
logMailStartup();

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
const { sendReminderPush } = require("./fcmReminders");

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

      // ✅ SEND TO CHILD VIA SOCKET (only when app is online)
      io.to(`child_${reminder.child_id}`).emit("new_notification", payload);

      // ✅ PUSH NOTIFICATION (works when app is closed / in background)
      await sendReminderPush(db, reminder.child_id, {
        id: reminder.id,
        title: reminder.title,
        message: reminder.message,
        priority: reminder.priority,
      });

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
app.use("/api/safety", require("./routes/safetyAlerts"));

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
