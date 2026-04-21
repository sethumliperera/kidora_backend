const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");

/** Default substring checks (lowercase). Extend via env BAD_SEARCH_PHRASES=comma,separated */
const DEFAULT_BLOCKED_PHRASES = [
  "porn",
  "xxx",
  "nude",
  "nsfw",
  "sex video",
  "erotic",
  "escort",
  "onlyfans",
  "hentai",
  "cocaine",
  "heroin",
  "meth",
  "buy drugs",
  "suicide",
  "kill myself",
  "how to bomb",
  "make a bomb",
  "terrorist",
  "child abuse",
];

function loadBlockedPhrases() {
  const extra = (process.env.BAD_SEARCH_PHRASES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const set = new Set([...DEFAULT_BLOCKED_PHRASES.map((p) => p.toLowerCase()), ...extra]);
  return Array.from(set);
}

function normalizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function queryMatchesBlocklist(normalized) {
  if (!normalized || normalized.length < 2) return false;
  const phrases = loadBlockedPhrases();
  return phrases.some((p) => p.length >= 2 && normalized.includes(p));
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Browser-style search page template (Kidora branded).
 */
function buildFlaggedSearchEmailHtml({ childName, query, sourcePackage, detectedAt }) {
  const safeQuery = escapeHtml(query);
  const safeChild = escapeHtml(childName || "Your child");
  const safePkg = escapeHtml(sourcePackage || "Browser");
  const when = escapeHtml(detectedAt || new Date().toISOString());

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#e8eaf6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:24px auto;padding:0 12px;">
    <div style="background:#5e35b1;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;font-size:15px;font-weight:700;">
      Kidora - Urgent safety alert
    </div>
    <div style="background:#fff;padding:22px;border:1px solid #d1c4e9;border-top:none;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(94,53,177,0.12);">
      <p style="margin:0 0 12px;color:#37474f;font-size:14px;line-height:1.5;">
        <strong>${safeChild}</strong> ran a flagged web search from <strong>${safePkg}</strong>.
      </p>
      <p style="margin:0 0 16px;color:#78909c;font-size:12px;">Detected (UTC): ${when}</p>

      <div style="border:1px solid #cfd8dc;border-radius:10px;overflow:hidden;background:#fafafa;">
        <div style="background:#eceff1;padding:8px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #cfd8dc;">
          <span style="width:10px;height:10px;border-radius:50%;background:#ef5350;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#ffca28;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#66bb6a;display:inline-block;"></span>
          <div style="flex:1;background:#fff;border-radius:6px;padding:6px 10px;font-size:11px;color:#546e7a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            https://www.google.com/search?q=${encodeURIComponent(query).replace(/'/g, "%27")}
          </div>
        </div>
        <div style="padding:28px 20px;text-align:center;">
          <div style="font-size:28px;font-weight:800;letter-spacing:-1px;margin-bottom:16px;">
            <span style="color:#5e35b1;">S</span><span style="color:#e53935;">e</span><span style="color:#fbc02d;">a</span><span style="color:#5e35b1;">r</span><span style="color:#43a047;">c</span><span style="color:#e53935;">h</span>
          </div>
          <div style="background:#fff;border:1px solid #b0bec5;border-radius:24px;padding:14px 18px;text-align:left;font-size:15px;color:#263238;min-height:22px;">
            ${safeQuery}
          </div>
          <div style="margin-top:14px;display:inline-block;background:#78909c;color:#fff;padding:10px 28px;border-radius:8px;font-size:13px;font-weight:600;">Review in Kidora</div>
        </div>
      </div>

      <p style="margin:18px 0 0;font-size:12px;color:#90a4ae;line-height:1.5;">
        Open the Kidora parent app to follow up. Configure SMTP on the server (SMTP_HOST, SMTP_USER, etc.) to deliver this message; otherwise the alert is logged on the server only.
      </p>
    </div>
  </div>
</body></html>`;
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return transporter;
}

/** Single recipient: parent of the child only. */
function normalizeParentEmail(raw) {
  const s = String(raw || "").trim();
  if (!s || !s.includes("@")) return null;
  if (s.includes(",") || s.includes(";")) return null;
  return s;
}

async function sendParentEmail(to, subject, html) {
  const recipient = normalizeParentEmail(to);
  if (!recipient) {
    console.warn("[safety] invalid parent email, skip send");
    return { skipped: true, reason: "invalid_email" };
  }

  const tx = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@kidora.local";
  if (!tx) {
    console.warn("[safety] SMTP not configured - alert saved in DB, email skipped for", recipient);
    return { skipped: true, reason: "no_smtp" };
  }

  await tx.sendMail({
    from,
    to: recipient,
    subject,
    html,
    headers: {
      "X-Priority": "1",
      Importance: "high",
      Priority: "urgent",
      "X-MSMail-Priority": "High",
    },
  });
  return { skipped: false };
}

// POST /api/safety/report-flagged-search (child device, no parent JWT)
router.post("/report-flagged-search", async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS safety_search_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        child_id INT NOT NULL,
        query_text VARCHAR(2000) NOT NULL,
        source_package VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_child_time (child_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const childId = parseInt(String(req.body.child_id || ""), 10);
    const query = typeof req.body.query === "string" ? req.body.query : "";
    const sourcePackage =
      typeof req.body.source_package === "string" ? req.body.source_package : "";

    if (!childId || Number.isNaN(childId)) {
      return res.status(400).json({ ok: false, error: "child_id required" });
    }

    const normalized = normalizeQuery(query);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "query required" });
    }

    if (!queryMatchesBlocklist(normalized)) {
      return res.status(400).json({ ok: false, error: "query not in safety list" });
    }

    const [rows] = await db.query(
      `SELECT c.id, c.name, c.parent_id, u.email AS parent_email
       FROM children c
       JOIN users u ON u.id = c.parent_id
       WHERE c.id = ?`,
      [childId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "child not found" });
    }

    const { name: childName, parent_email: parentEmail } = rows[0];
    const parentEmailNorm = normalizeParentEmail(parentEmail);
    if (!parentEmailNorm) {
      return res.status(400).json({ ok: false, error: "parent email missing or invalid" });
    }

    const [recent] = await db.query(
      `SELECT COUNT(*) AS n FROM safety_search_alerts WHERE child_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [childId]
    );
    const n = recent[0]?.n ?? 0;
    if (n >= 12) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const html = buildFlaggedSearchEmailHtml({
      childName,
      query: query.slice(0, 500),
      sourcePackage,
      detectedAt: new Date().toISOString(),
    });

    const subject = `[URGENT] Kidora: flagged search — ${childName || "Child"}`;

    // Always persist first so Railway / MySQL shows the row even if SMTP fails or is unset.
    await db.query(
      `INSERT INTO safety_search_alerts (child_id, query_text, source_package) VALUES (?, ?, ?)`,
      [childId, query.slice(0, 2000), sourcePackage.slice(0, 255)]
    );

    let emailSent = false;
    let emailError = null;
    try {
      const mailResult = await sendParentEmail(parentEmailNorm, subject, html);
      emailSent = !mailResult.skipped;
    } catch (mailErr) {
      console.error("[safety] send mail error (row already saved)", mailErr);
      emailError = "email_failed";
    }

    try {
      await db.query(
        `INSERT INTO notifications (parent_id, child_id, message, type) VALUES (?, ?, ?, ?)`,
        [
          rows[0].parent_id,
          childId,
          `Flagged search: "${query.slice(0, 120)}${query.length > 120 ? "..." : ""}"`,
          "safety_search",
        ]
      );
    } catch (notifErr) {
      console.warn("[safety] notification insert", notifErr.message);
    }

    return res.json({
      ok: true,
      logged: true,
      email_sent: emailSent,
      email_error: emailError,
    });
  } catch (err) {
    console.error("[safety] report-flagged-search", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
