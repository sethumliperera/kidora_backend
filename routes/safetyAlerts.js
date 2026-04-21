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
  "vape",
  "weed",
  "weed vape",
  "weed vape pen",
  "weed vape pen battery",
  "weed vape pen cartridge",
  "weed vape pen cartridge battery",
  "ciggarates",
  "cigarettes",
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
 * Parent email: date, time, timezone, searched keywords, child, browser.
 */
function buildFlaggedSearchEmailHtml({
  childName,
  query,
  sourcePackage,
  deviceLocalDate,
  deviceLocalTime,
  deviceTimezone,
  serverReceivedUtc,
}) {
  const safeQuery = escapeHtml(query);
  const safeChild = escapeHtml(childName || "Your child");
  const safePkg = escapeHtml(sourcePackage || "Browser");
  const safeDate = escapeHtml(deviceLocalDate || "—");
  const safeTime = escapeHtml(deviceLocalTime || "—");
  const safeTz = escapeHtml(deviceTimezone || "—");
  const safeServerUtc = escapeHtml(serverReceivedUtc || new Date().toISOString());

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#e8eaf6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:24px auto;padding:0 12px;">
    <div style="background:#c62828;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;font-size:16px;font-weight:800;">
      URGENT — Kidora flagged search
    </div>
    <div style="background:#fff;padding:22px;border:1px solid #d1c4e9;border-top:none;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(94,53,177,0.12);">
      <p style="margin:0 0 16px;color:#37474f;font-size:15px;line-height:1.55;">
        <strong>${safeChild}</strong> searched for something that matched your Kidora safety list using <strong>${safePkg}</strong>.
      </p>

      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;color:#263238;">
        <tr style="background:#f3e5f5;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;width:38%;">Date (child device)</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeDate}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Time (child device)</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeTime}</td></tr>
        <tr style="background:#f3e5f5;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Time zone</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeTz}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;vertical-align:top;">Searched keyword / phrase</td><td style="padding:10px 12px;border:1px solid #e1bee7;font-size:16px;font-weight:800;color:#6a1b9a;">${safeQuery}</td></tr>
        <tr style="background:#fafafa;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Server received (UTC)</td><td style="padding:10px 12px;border:1px solid #e1bee7;font-size:12px;color:#546e7a;">${safeServerUtc}</td></tr>
      </table>

      <div style="border:1px solid #cfd8dc;border-radius:10px;overflow:hidden;background:#fafafa;">
        <div style="padding:16px;text-align:center;">
          <div style="font-size:22px;font-weight:800;letter-spacing:-1px;margin-bottom:12px;">
            <span style="color:#5e35b1;">S</span><span style="color:#e53935;">e</span><span style="color:#fbc02d;">a</span><span style="color:#5e35b1;">r</span><span style="color:#43a047;">c</span><span style="color:#e53935;">h</span>
          </div>
          <div style="background:#fff;border:1px solid #b0bec5;border-radius:16px;padding:14px 18px;text-align:left;font-size:15px;color:#263238;">
            ${safeQuery}
          </div>
        </div>
      </div>

      <p style="margin:18px 0 0;font-size:12px;color:#90a4ae;line-height:1.5;">
        Open the Kidora parent app to follow up with your child. This alert is based on on-device browser monitoring (Google, Bing, DuckDuckGo, Yahoo, and other common engines when the URL is visible to accessibility).
      </p>
    </div>
  </div>
</body></html>`;
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = (process.env.SMTP_HOST || "").trim().toLowerCase();
  if (!host) return null;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn("[safety] SMTP_HOST set but SMTP_USER or SMTP_PASS missing");
    return null;
  }
  const auth = { user, pass };

  // Gmail: built-in transport avoids TLS/host quirks (use App Password, not normal password).
  if (host === "smtp.gmail.com" || (process.env.SMTP_SERVICE || "").toLowerCase() === "gmail") {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth,
    });
    return transporter;
  }

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true";
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    requireTLS: !secure && port === 587,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
  });
  return transporter;
}

/**
 * Firebase "Trigger Email from Firestore" extension: add a doc; the extension delivers mail
 * (SMTP/SendGrid is configured inside the extension in Firebase Console, not in this Node app).
 * @see https://firebase.google.com/docs/extensions/official/firestore-send-email
 */
async function sendViaFirestoreTriggerEmail(to, subject, html) {
  let admin;
  try {
    admin = require("../firebaseAdmin");
  } catch (e) {
    throw new Error(
      `Firebase Admin not loadable (need valid firebaseAdmin + service account on this host): ${e.message}`
    );
  }
  const fs = admin.firestore();
  const col = (process.env.FIRESTORE_MAIL_COLLECTION || "mail").trim() || "mail";
  await fs.collection(col).add({
    to: [to],
    message: {
      subject,
      html,
    },
  });
}

/**
 * Resend — free tier (https://resend.com), one API key, good for Render.
 * Sign up → API Keys → create key. For testing use from: onboarding@resend.dev (Resend default).
 * For production add & verify your domain in Resend, then set RESEND_FROM to e.g. alerts@yourdomain.com
 */
async function sendViaResend(to, subject, html) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.RESEND_FROM?.trim() ||
    "Kidora <onboarding@resend.dev>";
  if (!key) throw new Error("RESEND_API_KEY missing");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      headers: {
        "X-Priority": "1",
        Importance: "high",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
}

/**
 * SendGrid Web API. Free tier ~100 emails/day for new accounts.
 */
async function sendViaSendGrid(to, subject, html) {
  const key = process.env.SENDGRID_API_KEY;
  const fromEmail =
    process.env.SENDGRID_FROM_EMAIL?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim();
  if (!key) throw new Error("SENDGRID_API_KEY missing");
  if (!fromEmail) {
    throw new Error("Set SENDGRID_FROM_EMAIL (verified sender) or SMTP_FROM");
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
          subject,
          headers: {
            "X-Priority": "1",
            Importance: "high",
            Priority: "urgent",
          },
        },
      ],
      from: { email: fromEmail, name: "Kidora" },
      content: [{ type: "text/html", value: html }],
      categories: ["kidora", "safety_alert"],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
}

/** Single recipient: parent of the child only. */
function normalizeParentEmail(raw) {
  const s = String(raw || "").trim();
  if (!s || !s.includes("@")) return null;
  if (s.includes(",") || s.includes(";")) return null;
  return s;
}

/** Gmail / SMTP: From address is SMTP_FROM (or SMTP_USER). Parents see "Kidora <kidoraapp06@gmail.com>" when using defaults. */
async function sendViaConfiguredSmtp(to, subject, html) {
  const tx = getTransporter();
  const fromRaw =
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";
  if (!tx) {
    return { skipped: true, reason: "no_smtp_transport" };
  }
  if (!fromRaw) {
    return { skipped: true, reason: "no_smtp_from_set_SMTP_FROM_or_SMTP_USER" };
  }

  const fromHeader = fromRaw.includes("<") ? fromRaw : `"Kidora" <${fromRaw}>`;
  const info = await tx.sendMail({
    from: fromHeader,
    to,
    subject,
    html,
    headers: {
      "X-Priority": "1",
      Importance: "high",
      Priority: "urgent",
      "X-MSMail-Priority": "High",
    },
  });
  return { skipped: false, via: "smtp", messageId: info.messageId };
}

async function sendParentEmail(to, subject, html) {
  const recipient = normalizeParentEmail(to);
  if (!recipient) {
    console.warn("[safety] invalid parent email, skip send");
    return { skipped: true, reason: "invalid_email" };
  }

  const prefer = (process.env.EMAIL_PROVIDER || "auto").toLowerCase().trim();
  const smtpFirst = prefer === "smtp" || prefer === "gmail";

  if (smtpFirst) {
    const smtp = await sendViaConfiguredSmtp(recipient, subject, html);
    if (!smtp.skipped) {
      console.log("[safety] email sent via SMTP to", recipient, smtp.messageId || "");
      return smtp;
    }
    console.warn("[safety] EMAIL_PROVIDER=gmail/smtp but SMTP send skipped:", smtp.reason);
    return { skipped: true, reason: smtp.reason || "smtp_not_configured" };
  }

  if (process.env.RESEND_API_KEY) {
    await sendViaResend(recipient, subject, html);
    console.log("[safety] email sent via Resend to", recipient);
    return { skipped: false, via: "resend" };
  }

  if (process.env.SENDGRID_API_KEY) {
    await sendViaSendGrid(recipient, subject, html);
    console.log("[safety] email sent via SendGrid to", recipient);
    return { skipped: false, via: "sendgrid" };
  }

  const useFs =
    process.env.USE_FIRESTORE_MAIL === "1" ||
    process.env.USE_FIRESTORE_MAIL === "true";
  if (useFs) {
    await sendViaFirestoreTriggerEmail(recipient, subject, html);
    console.log("[safety] queued email via Firestore collection for", recipient);
    return { skipped: false, via: "firestore_trigger_email" };
  }

  const smtp = await sendViaConfiguredSmtp(recipient, subject, html);
  if (!smtp.skipped) {
    console.log("[safety] email sent via SMTP to", recipient, smtp.messageId || "");
    return smtp;
  }

  console.warn(
    "[safety] No mail transport: set EMAIL_PROVIDER=gmail + SMTP_* for kidoraapp06@gmail.com, or RESEND_API_KEY, or SENDGRID_API_KEY, or USE_FIRESTORE_MAIL=1. Parent:",
    recipient
  );
  return { skipped: true, reason: "no_mailer_config" };
}

// POST /api/safety/report-flagged-search (child device, no parent JWT)
router.post("/report-flagged-search", async (req, res) => {
  try {
    console.log("[safety] POST report-flagged-search", {
      child_id: req.body?.child_id,
      has_query: typeof req.body?.query === "string",
      source_package: req.body?.source_package,
    });

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
      console.warn("[safety] reject: empty query after normalize");
      return res.status(400).json({ ok: false, error: "query required" });
    }

    if (!queryMatchesBlocklist(normalized)) {
      console.warn("[safety] reject: not in blocklist", {
        childId,
        preview: `${normalized.slice(0, 60)}${normalized.length > 60 ? "…" : ""}`,
      });
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
      console.warn(
        "[safety] child not found in THIS server's DB (wrong DATABASE_URL vs dashboard DB?)",
        { childId }
      );
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

    const deviceLocalDate =
      typeof req.body.device_local_date === "string"
        ? req.body.device_local_date.slice(0, 120)
        : "";
    const deviceLocalTime =
      typeof req.body.device_local_time === "string"
        ? req.body.device_local_time.slice(0, 40)
        : "";
    const deviceTimezone =
      typeof req.body.device_timezone === "string"
        ? req.body.device_timezone.slice(0, 120)
        : "";
    const serverReceivedUtc = new Date().toISOString();

    const html = buildFlaggedSearchEmailHtml({
      childName,
      query: query.slice(0, 500),
      sourcePackage,
      deviceLocalDate,
      deviceLocalTime,
      deviceTimezone,
      serverReceivedUtc,
    });

    const kw = query.length > 42 ? `${query.slice(0, 42)}…` : query;
    const subject = `[URGENT] Kidora: "${kw}" — ${childName || "Child"}`;

    // Always persist first (same MySQL as process.env.DATABASE_URL on THIS host).
    await db.query(
      `INSERT INTO safety_search_alerts (child_id, query_text, source_package) VALUES (?, ?, ?)`,
      [childId, query.slice(0, 2000), sourcePackage.slice(0, 255)]
    );
    console.log("[safety] INSERT safety_search_alerts ok", { childId });

    let emailSent = false;
    let emailError = null;
    try {
      const mailResult = await sendParentEmail(parentEmailNorm, subject, html);
      emailSent = !mailResult.skipped;
      if (mailResult.skipped) {
        emailError = mailResult.reason || "skipped";
      }
    } catch (mailErr) {
      console.error("[safety] send mail error (row already saved)", mailErr?.message || mailErr);
      emailError = String(mailErr?.message || "email_failed").slice(0, 200);
    }

    try {
      await db.query(
        `INSERT INTO notifications (parent_id, child_id, message, type) VALUES (?, ?, ?, ?)`,
        [
          rows[0].parent_id,
          childId,
          `Flagged search at ${deviceLocalDate || "?"} ${deviceLocalTime || "?"} (${deviceTimezone || "?"}): "${query.slice(0, 100)}${query.length > 100 ? "…" : ""}"`,
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
      parent_email_masked: (() => {
        const [loc, dom] = parentEmailNorm.split("@");
        if (!dom) return "***";
        return `${(loc || "?").slice(0, 1)}***@${dom}`;
      })(),
    });
  } catch (err) {
    console.error("[safety] report-flagged-search", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
