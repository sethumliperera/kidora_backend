const express = require("express");
const router = express.Router();
const db = require("../db");
const firebaseAdmin = require("../firebaseAdmin");
const { sendParentNotificationPush } = require("../fcmReminders");
const { resolveSmtpUser, getTransporter, getSmtpPingDiagnostics } = require("../smtpEnv");

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
 * Parent email: URGENT banner + child name/date/time/timezone + a browser mockup
 * whose search box contains the keyword the child typed.
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
  <div style="max-width:620px;margin:24px auto;padding:0 12px;">

    <div style="background:#c62828;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:17px;font-weight:800;letter-spacing:.3px;">
      URGENT — Kidora flagged search
    </div>

    <div style="background:#fff;padding:22px;border:1px solid #d1c4e9;border-top:none;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(94,53,177,0.12);">

      <p style="margin:0 0 18px;color:#263238;font-size:15px;line-height:1.55;">
        <strong>${safeChild}</strong> typed a flagged search in <strong>${safePkg}</strong>. Details below.
      </p>

      <!-- Google-style strip (like the in-app search bar) -->
      <div style="background:#fff;border:1px solid #dfe1e5;border-radius:12px;padding:14px 16px;margin:0 0 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:22px;font-weight:500;margin-bottom:10px;letter-spacing:-0.5px;">
          <span style="color:#4285f4;">G</span><span style="color:#ea4335;">o</span><span style="color:#fbbc04;">o</span><span style="color:#4285f4;">g</span><span style="color:#34a853;">l</span><span style="color:#ea4335;">e</span>
        </div>
        <div style="border:1px solid #dfe1e5;border-radius:24px;padding:10px 16px;font-size:16px;color:#202124;background:#fff;">
          <span style="color:#c62828;font-weight:700;">${safeQuery}</span>
        </div>
      </div>

      <!-- Browser mockup with the typed keyword in the search box -->
      <div style="border:1px solid #b0bec5;border-radius:10px;overflow:hidden;background:#f5f7fa;margin:0 0 22px;box-shadow:0 4px 14px rgba(55,71,79,0.12);">
        <!-- tab bar -->
        <div style="background:#cfd8dc;padding:8px 12px;display:flex;align-items:center;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#e53935;margin-right:6px;"></span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fbc02d;margin-right:6px;"></span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#43a047;margin-right:12px;"></span>
          <span style="background:#eceff1;color:#37474f;font-size:12px;padding:5px 14px;border-radius:6px 6px 0 0;border:1px solid #b0bec5;border-bottom:none;">New Tab</span>
        </div>
        <!-- url bar -->
        <div style="background:#eceff1;padding:10px 12px;border-top:1px solid #b0bec5;border-bottom:1px solid #b0bec5;font-size:12px;color:#546e7a;">
          <span style="background:#fff;border:1px solid #b0bec5;border-radius:20px;padding:6px 12px;display:inline-block;min-width:70%;color:#90a4ae;">http://</span>
        </div>
        <!-- page body -->
        <div style="padding:26px 20px 30px;text-align:center;background:#f5f7fa;">
          <div style="font-size:34px;font-weight:800;letter-spacing:-1px;margin:0 0 18px;">
            <span style="color:#1a73e8;">S</span><span style="color:#ea4335;">e</span><span style="color:#fbbc04;">a</span><span style="color:#1a73e8;">r</span><span style="color:#34a853;">c</span><span style="color:#ea4335;">h</span>
          </div>
          <div style="background:#fff;border:1px solid #b0bec5;border-radius:24px;padding:12px 18px;max-width:420px;margin:0 auto;text-align:left;font-size:15px;color:#263238;box-shadow:0 1px 2px rgba(0,0,0,0.06);">
            <strong style="color:#c62828;">${safeQuery}</strong>
          </div>
          <div style="margin-top:14px;">
            <span style="display:inline-block;background:#eceff1;color:#546e7a;font-size:13px;padding:6px 16px;border-radius:18px;">Go</span>
          </div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px;color:#263238;">
        <tr style="background:#f3e5f5;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;width:38%;">Child</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeChild}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Date</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeDate}</td></tr>
        <tr style="background:#f3e5f5;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Time</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeTime}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Time zone</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safeTz}</td></tr>
        <tr style="background:#f3e5f5;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;vertical-align:top;">Searched keyword</td><td style="padding:10px 12px;border:1px solid #e1bee7;font-size:16px;font-weight:800;color:#6a1b9a;">${safeQuery}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">App / browser</td><td style="padding:10px 12px;border:1px solid #e1bee7;">${safePkg}</td></tr>
        <tr style="background:#fafafa;"><td style="padding:10px 12px;border:1px solid #e1bee7;font-weight:700;">Server received (UTC)</td><td style="padding:10px 12px;border:1px solid #e1bee7;font-size:12px;color:#546e7a;">${safeServerUtc}</td></tr>
      </table>

      <p style="margin:14px 0 0;font-size:12px;color:#90a4ae;line-height:1.5;">
        Detected on-device by Kidora across Google, Chrome, YouTube, Bing, DuckDuckGo and other common search engines. Open the Kidora parent app to review and follow up with your child.
      </p>

    </div>
  </div>
</body></html>`;
}

/**
 * Resend — optional alternative to Gmail SMTP (https://resend.com).
 * Only used if RESEND_API_KEY is set and EMAIL_PROVIDER != gmail/smtp.
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
    resolveSmtpUser();
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

/**
 * MySQL `users.email` is often empty for Google-sign-in parents who never hit POST /users.
 * Firebase Auth is the source of truth; we persist back to MySQL for the next alert.
 *
 * @param {{ parent_id: number, parent_email?: string|null, parent_firebase_uid?: string|null }} row
 */
async function resolveParentRecipientEmail(row) {
  const parentId = row.parent_id;
  const fromDb = normalizeParentEmail(row.parent_email);
  if (fromDb) {
    return { email: fromDb, source: "mysql" };
  }

  const uid = row.parent_firebase_uid ? String(row.parent_firebase_uid).trim() : "";
  if (!uid) {
    return {
      email: null,
      source: "none",
      detail: "users.email_empty_and_no_firebase_uid",
    };
  }

  try {
    const rec = await firebaseAdmin.auth().getUser(uid);
    const fromFb = normalizeParentEmail(rec.email);
    if (!fromFb) {
      return { email: null, source: "none", detail: "firebase_user_has_no_email" };
    }
    try {
      await db.query("UPDATE users SET email = ? WHERE id = ?", [fromFb, parentId]);
    } catch (persistErr) {
      console.warn("[safety] could not persist Firebase email to users:", persistErr?.message);
    }
    return { email: fromFb, source: "firebase" };
  } catch (e) {
    const code = e?.code || e?.errorInfo?.code;
    console.warn("[safety] Firebase auth().getUser failed:", code || e?.message);
    return {
      email: null,
      source: "none",
      detail: String(code || e?.message || "firebase_getUser_failed").slice(0, 160),
    };
  }
}

/** Gmail / SMTP: From address is SMTP_FROM (or SMTP_USER). Parents see "Kidora <kidoraapp06@gmail.com>" when using defaults. */
async function sendViaConfiguredSmtp(to, subject, html) {
  const tx = getTransporter();
  const fromRaw = process.env.SMTP_FROM?.trim() || resolveSmtpUser() || "";
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

  async function attemptSmtp() {
    const smtp = await sendViaConfiguredSmtp(recipient, subject, html);
    if (!smtp.skipped) {
      return { skipped: false, via: smtp.via || "smtp", messageId: smtp.messageId };
    }
    return { skipped: true, reason: smtp.reason || "smtp_not_configured" };
  }

  async function attemptResend() {
    if (!process.env.RESEND_API_KEY?.trim()) {
      return { skipped: true, reason: "no_resend_api_key" };
    }
    await sendViaResend(recipient, subject, html);
    return { skipped: false, via: "resend" };
  }

  async function attemptSendGrid() {
    if (!process.env.SENDGRID_API_KEY) {
      return { skipped: true, reason: "no_sendgrid_api_key" };
    }
    await sendViaSendGrid(recipient, subject, html);
    return { skipped: false, via: "sendgrid" };
  }

  /**
   * Try transports in order until one succeeds. Previously EMAIL_PROVIDER=gmail
   * returned immediately when SMTP was misconfigured, never trying Resend/SendGrid.
   */
  async function tryChain(fns) {
    const errors = [];
    for (const fn of fns) {
      try {
        const r = await fn();
        if (r && !r.skipped) {
          console.log(
            `[safety] email sent (${r.via}) to`,
            recipient,
            r.messageId || ""
          );
          return r;
        }
        if (r?.reason) errors.push(r.reason);
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn("[safety] mail transport error:", msg.slice(0, 300));
        errors.push(msg.slice(0, 160));
      }
    }
    console.warn(
      "[safety] all mail transports failed or unconfigured for",
      recipient,
      errors.join(" | ").slice(0, 400)
    );
    return {
      skipped: true,
      reason: errors.length ? errors.join(" | ").slice(0, 500) : "no_mailer_config",
    };
  }

  if (prefer === "smtp" || prefer === "gmail") {
    return tryChain([attemptSmtp, attemptResend, attemptSendGrid]);
  }
  if (prefer === "resend") {
    return tryChain([attemptResend, attemptSendGrid, attemptSmtp]);
  }
  if (prefer === "sendgrid") {
    return tryChain([attemptSendGrid, attemptResend, attemptSmtp]);
  }

  // auto: prefer SMTP when credentials exist — Resend "onboarding@resend.dev" cannot deliver
  // to arbitrary parent inboxes; Gmail/SMTP sends to the real parent address.
  let smtpReady = false;
  try {
    smtpReady = !!getSmtpPingDiagnostics().smtp_ready;
  } catch (_e) {
    smtpReady = false;
  }
  const fns = smtpReady
    ? [attemptSmtp, attemptResend, attemptSendGrid]
    : [attemptResend, attemptSendGrid, attemptSmtp];
  return tryChain(fns);
}

// GET /api/safety/ping — verify DB + mail config (no auth; for deploy checks only)
router.get("/ping", async (_req, res) => {
  try {
    await db.query("SELECT 1 AS ok");
    const mail = getSmtpPingDiagnostics();
    return res.json({
      ok: true,
      db: true,
      ...mail,
      resend_api_key_set: !!String(process.env.RESEND_API_KEY || "").trim(),
      sendgrid_api_key_set: !!String(process.env.SENDGRID_API_KEY || "").trim(),
      email_provider: String(process.env.EMAIL_PROVIDER || "auto").trim() || "auto",
    });
  } catch (err) {
    console.error("[safety] ping", err);
    return res.status(500).json({ ok: false, db: false, error: String(err?.message || err) });
  }
});

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
      `SELECT c.id, c.name, c.parent_id, u.email AS parent_email, u.firebase_uid AS parent_firebase_uid
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
      return res.status(404).json({
        ok: false,
        error: "child not found",
        hint:
          "This API uses DATABASE_URL on the host (e.g. Render). Point it at the same MySQL as Railway if you expect rows there.",
      });
    }

    const childName = rows[0].name;
    const resolvedRecipient = await resolveParentRecipientEmail(rows[0]);
    const parentEmailNorm = resolvedRecipient.email;
    if (!parentEmailNorm) {
      return res.status(400).json({
        ok: false,
        error: "parent email missing or invalid",
        hint:
          "Open the parent Kidora app once while signed in (syncs email), or ensure Firebase Auth has an email on this parent account. Service account project must match Firebase Auth.",
        detail: resolvedRecipient.detail,
      });
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

    try {
      await sendParentNotificationPush(db, rows[0].parent_id, {
        title: "Kidora — safety alert",
        body: `${childName || "Child"}: flagged search detected. Open Kidora for details.`,
        type: "safety_search",
        childId,
      });
    } catch (pushErr) {
      console.warn("[safety] parent FCM", pushErr?.message || pushErr);
    }

    return res.json({
      ok: true,
      logged: true,
      email_sent: emailSent,
      email_error: emailError,
      parent_email_source: resolvedRecipient.source,
      parent_email_masked: (() => {
        const [loc, dom] = parentEmailNorm.split("@");
        if (!dom) return "***";
        return `${(loc || "?").slice(0, 1)}***@${dom}`;
      })(),
    });
  } catch (err) {
    console.error("[safety] report-flagged-search", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      detail: String(err?.message || err).slice(0, 300),
    });
  }
});

module.exports = router;
