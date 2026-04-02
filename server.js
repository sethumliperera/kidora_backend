const express = require("express");
const cors = require("cors");

const app = express();

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

// Test route
app.get("/", (req, res) => {
  res.send("Kidora Backend Running 🚀");
});

// ================= SERVER =================

// 🔥 IMPORTANT FIX FOR RENDER
const PORT = process.env.PORT || 3000;

// Listen on all network interfaces
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});