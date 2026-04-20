const cron = require("node-cron");
const db = require("./db");

let ioInstance;

/**
 * Initialize the scheduler and load existing reminders
 * @param {Object} io Socket.io instance
 */
const init = async (io) => {
  ioInstance = io;
  console.log("⏰ [Scheduler] Initializing...");
  await loadSchedulesFromDB();
};

/**
 * Load all active repeating or future reminders from the database
 */
const loadSchedulesFromDB = async () => {
  try {
    // We only load reminders that are active and either repeat or are scheduled for the future
    const [reminders] = await db.query(
      "SELECT * FROM reminders WHERE is_active = 1"
    );

    console.log(`📡 [Scheduler] Found ${reminders.length} potential active reminders.`);

    reminders.forEach(reminder => {
      // Check if it's a one-time reminder in the past; if so, skip (or mark inactive)
      if (reminder.frequency === "once" && reminder.scheduled_at) {
        if (new Date(reminder.scheduled_at) < new Date()) {
          // Already passed, let's mark it inactive just in case
          db.query("UPDATE reminders SET is_active = 0 WHERE id = ?", [reminder.id]);
          return;
        }
      }
      
      scheduleReminder(reminder);
    });
  } catch (err) {
    console.error("❌ [Scheduler] Failed to load schedules from DB:", err.message);
  }
};

/**
 * Schedule a single reminder in node-cron
 * @param {Object} reminder Reminder database object
 */
const scheduleReminder = (reminder) => {
  const { id, child_id, message, priority, scheduled_at, frequency } = reminder;
  
  if (!scheduled_at) return; // Cannot schedule without a time

  const date = new Date(scheduled_at);
  const room = "child_" + child_id;

  let cronTime = "";

  if (frequency === "daily") {
    // Every day at HH:MM
    cronTime = `${date.getMinutes()} ${date.getHours()} * * *`;
  } else if (frequency === "weekly") {
    // Every week on dayNum at HH:MM
    cronTime = `${date.getMinutes()} ${date.getHours()} * * ${date.getDay()}`;
  } else if (frequency === "once") {
    // One specific time
    // cron format: minute hour day month dayOfWeek
    cronTime = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
  }

  if (cronTime) {
    cron.schedule(cronTime, () => {
      console.log(`🔔 [Scheduler] Triggering reminder ${id} for room ${room}`);
      emitReminder(room, {
        id,
        title: reminder.title || "Reminder",
        message,
        priority
      });

      // If it was a one-time reminder, mark it inactive in DB after triggering
      if (frequency === "once") {
        db.query("UPDATE reminders SET is_active = 0 WHERE id = ?", [id])
          .catch(err => console.error(`Error deactivating reminder ${id}:`, err));
      }
    });

    console.log(`✅ [Scheduler] Scheduled: [ID: ${id}] [Freq: ${frequency}] [Cron: ${cronTime}]`);
  }
};

/**
 * Emit the reminder via Socket.io
 */
const emitReminder = (room, data) => {
  if (ioInstance) {
    const payload = {
      title: data.priority === "urgent" ? `🚨 Urgent: ${data.title}` : `📢 ${data.title}`,
      message: data.message,
      reminder_id: data.id,
      priority: data.priority || "normal",
      time: new Date().toISOString()
    };
    ioInstance.to(room).emit("new_notification", payload);
    ioInstance.to(room).emit("reminder", payload);
    console.log(`✅ [Scheduler] Socket emitted to ${room}`);
  } else {
    console.warn("⚠️ [Scheduler] Cannot emit: Socket.io instance not set");
  }
};

module.exports = { init, scheduleReminder };
