const db = require("./db");
const { getTransporter, resolveSmtpUser } = require("./smtpEnv");
const { buildWeeklyInsights } = require("./weeklyInsightAnalysis");

async function ensureScreenTimeTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_screen_time (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      duration_seconds INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_child_app_date (child_id, app_name, date),
      INDEX idx_child_date (child_id, date)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_screen_time_totals (
      child_id INT NOT NULL,
      date DATE NOT NULL,
      total_seconds INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (child_id, date),
      INDEX idx_child_totals_date (child_id, date)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS installed_apps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      package_name VARCHAR(255) NOT NULL,
      app_name VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_child_pkg (child_id, package_name)
    )
  `);
}

function getYearWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Creates weekly_insight_email_log. Safe to run on every deploy / server start. */
async function ensureLogTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS weekly_insight_email_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      child_id INT NOT NULL,
      year_week VARCHAR(12) NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_child_week (child_id, year_week),
      INDEX idx_child (child_id)
    )
  `);
}

/** Run once when the API boots so the table exists before Sunday (not only when the job fires). */
async function ensureWeeklyReportSchema() {
  await ensureLogTable();
}

async function fetchWeeklyAppRows(childId) {
  await ensureScreenTimeTables();
  const lookback = 6;
  const [rows] = await db.query(
    `SELECT d.app_name AS package_name,
            MAX(COALESCE(i.app_name, d.app_name)) AS app_name,
            SUM(d.duration_seconds) AS duration
     FROM daily_screen_time d
     LEFT JOIN installed_apps i
       ON i.child_id = d.child_id AND i.package_name = d.app_name
     WHERE d.child_id = ? AND d.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY d.app_name
     ORDER BY duration DESC
     LIMIT 50`,
    [childId, lookback]
  );
  return rows.map((row) => ({
    package_name: row.package_name,
    app_name: row.app_name,
    duration: parseInt(row.duration, 10) || 0
  }));
}

async function weeklyTotalSeconds(childId) {
  await ensureScreenTimeTables();
  const [totalsWeek] = await db.query(
    `SELECT COALESCE(SUM(total_seconds), 0) AS t
     FROM daily_screen_time_totals
     WHERE child_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)`,
    [childId]
  );
  const t = parseInt(totalsWeek[0]?.t, 10) || 0;
  if (t > 0) return t;
  const [sumQ] = await db.query(
    `SELECT COALESCE(SUM(duration_seconds), 0) AS s
     FROM daily_screen_time
     WHERE child_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)`,
    [childId]
  );
  return parseInt(sumQ[0]?.s, 10) || 0;
}

/** Resolves to Buffer, or null if the optional `pdfkit` package is not installed. */
function buildPdfBuffer(childName, parentEmail, apps, totalSec, insight) {
  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
  } catch (e) {
    console.warn(
      "[weeklyReport] pdfkit not available (add to package.json and run npm install):",
      e.message
    );
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const today = new Date().toISOString().slice(0, 10);
    doc.fontSize(20).fillColor("#4A148C").text("Kidora — Weekly report", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text(`Child: ${childName}  ·  To: ${parentEmail}  ·  ${today}`);

    doc.moveDown();
    doc.fontSize(12).fillColor("#000").text("Screen time (last 7 days)", { underline: true });
    const hours = (totalSec / 3600).toFixed(1);
    doc.fontSize(10).text(`Total (tracked): about ${hours} hours.`);

    doc.moveDown();
    doc.fontSize(12).text("App mix (top apps)", { underline: true });
    for (const a of apps.slice(0, 12)) {
      const m = (a.duration / 60).toFixed(0);
      doc
        .fontSize(9)
        .text(`• ${a.app_name} (${a.package_name}): ${m} min`, { width: 500 });
    }

    doc.moveDown();
    doc.fontSize(12).text("What stood out", { underline: true });
    doc.moveDown(0.3);
    for (const c of insight.concerns) {
      doc.fontSize(10).fillColor("#B71C1C").text("• " + c.title, { continued: false });
      doc.fillColor("#333").fontSize(9).text("  " + c.body, { width: 480 });
      if (c.measures && c.measures.length) {
        doc.fontSize(8).fillColor("#555").text("  Parent ideas:", { width: 480 });
        for (const m of c.measures) {
          doc.text("    - " + m, { width: 460 });
        }
      }
    }

    for (const p of insight.positives) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#1B5E20").text("• " + p.title);
      doc.fillColor("#333").fontSize(9).text("  " + p.body, { width: 480 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#888").text("Generated by Kidora · same summary as the Weekly insights screen in the app.", { align: "center" });
    doc.end();
  });
}

function buildHtmlBody(childName, apps, totalSec, insight, pdfAttached) {
  const hours = (totalSec / 3600).toFixed(1);
  const appRows = apps
    .slice(0, 12)
    .map(
      (a) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(a.app_name)}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${(a.duration / 60).toFixed(0)} min</td></tr>`
    )
    .join("");

  const concernHtml = insight.concerns
    .map(
      (c) =>
        `<div style="margin:10px 0;padding:10px;border-left:4px solid #c62828;background:#ffebee">
  <strong>${escapeHtml(c.title)}</strong><p style="margin:6px 0">${escapeHtml(c.body)}</p>
  <ul style="margin:0;padding-left:20px;font-size:13px">
  ${(c.measures || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("")}
  </ul>
</div>`
    )
    .join("");

  const posHtml = insight.positives
    .map(
      (p) =>
        `<div style="margin:8px 0;padding:8px;border-left:4px solid #2e7d32;background:#e8f5e9">
  <strong>${escapeHtml(p.title)}</strong><p style="margin:4px 0 0 0;font-size:14px">${escapeHtml(p.body)}</p>
</div>`
    )
    .join("");

  return `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:600px">
    <h2 style="color:#4A148C">Kidora — Weekly report for ${escapeHtml(childName)}</h2>
    <p>Total screen time (last 7 days, as tracked in Kidora): <strong>~${hours} hours</strong></p>
    <h3>Top apps</h3>
    <table style="border-collapse:collapse;width:100%">${appRows || "<tr><td>No per-app data</td></tr>"}</table>
    <h3>Observations &amp; support ideas</h3>
    ${concernHtml || ""}
    <h3>Positive notes</h3>
    ${posHtml}
    <p style="color:#888;font-size:12px;margin-top:24px">${
      pdfAttached
        ? "A PDF is attached for your records. You can also open <strong>Weekly insights</strong> in the app anytime."
        : "PDF attachment is unavailable on the server (install the <code>pdfkit</code> npm package). The report above is complete in email form; open <strong>Weekly insights</strong> in the app for charts."
    }</p>
  </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendWeeklyReportsForAllChildren() {
  if (String(process.env.WEEKLY_REPORT_EMAILS_DISABLED || "") === "1") {
    return;
  }

  const yw = getYearWeek();
  const hUtc = parseInt(String(process.env.WEEKLY_REPORT_UTC_HOUR || "7"), 10);
  const now = new Date();
  if (now.getUTCDay() !== 0) {
    return;
  }
  if (now.getUTCHours() !== hUtc) {
    return;
  }
  if (now.getUTCMinutes() > 12) {
    return;
  }

  const transporter = getTransporter();
  const from = resolveSmtpUser();
  if (!transporter || !from) {
    console.warn("[weeklyReport] SMTP not configured — skip");
    return;
  }

  await ensureLogTable();

  const [rows] = await db.query(
    `SELECT c.id AS child_id, c.name AS child_name, u.email AS parent_email, u.id AS parent_id
     FROM children c
     INNER JOIN users u ON u.id = c.parent_id
     WHERE u.email IS NOT NULL AND TRIM(u.email) <> ""`
  );

  for (const row of rows) {
    const childId = row.child_id;
    const email = String(row.parent_email).trim();
    if (!email) continue;

    const [already] = await db.query(
      "SELECT 1 FROM weekly_insight_email_log WHERE child_id = ? AND year_week = ?",
      [childId, yw]
    );
    if (already.length > 0) {
      continue;
    }

    try {
      const apps = await fetchWeeklyAppRows(childId);
      const total = await weeklyTotalSeconds(childId);
      const ins = buildWeeklyInsights(apps, total);
      const childName = row.child_name || "Child";
      const pdf = await buildPdfBuffer(childName, email, apps, total, ins);
      const html = buildHtmlBody(childName, apps, total, ins, !!(pdf && pdf.length));

      const mail = {
        from: `"Kidora" <${from}>`,
        to: email,
        subject: `Kidora weekly report — ${childName} (${yw})`,
        html
      };
      if (pdf && pdf.length) {
        mail.attachments = [
          {
            filename: `Kidora_Weekly_${childName.replace(/[^\w-]+/g, "_")}_${yw}.pdf`,
            content: pdf
          }
        ];
      }
      await transporter.sendMail(mail);

      await db.query("INSERT INTO weekly_insight_email_log (child_id, year_week) VALUES (?, ?)", [
        childId,
        yw
      ]);
      console.log("[weeklyReport] sent", { childId, email, yw });
    } catch (e) {
      console.error("[weeklyReport] failed for child", childId, e.message);
    }
  }
}

function startWeeklyReportJob() {
  ensureWeeklyReportSchema()
    .then(() => console.log("[weeklyReport] DB table weekly_insight_email_log ready (if DB connected)"))
    .catch((e) => console.error("[weeklyReport] could not ensure SQL table:", e.message));

  const interval = parseInt(String(process.env.WEEKLY_REPORT_CHECK_MS || "300000"), 10);
  setInterval(() => {
    sendWeeklyReportsForAllChildren().catch((e) => console.error("[weeklyReport]", e));
  }, interval);
  console.log(
    "[weeklyReport] scheduler on (Sundays at UTC " +
      (process.env.WEEKLY_REPORT_UTC_HOUR || "7") +
      ":00, every " +
      Math.round(interval / 60000) +
      " min check)"
  );
}

module.exports = {
  startWeeklyReportJob,
  sendWeeklyReportsForAllChildren,
  ensureWeeklyReportSchema,
};
