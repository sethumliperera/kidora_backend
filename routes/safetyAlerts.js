const express = require("express");
const router = express.Router();
const db = require("../db");
const firebaseAdmin = require("../firebaseAdmin");
const { sendParentNotificationPush } = require("../fcmReminders");
const { resolveSmtpUser, sendConfiguredSmtpMail, sendSafetyRelaySmtpMail, getSmtpPingDiagnostics, getSafetyRelaySmtpDiagnostics } = require("../smtpEnv");

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

/**
 * Accept if the full query matches the server blocklist, or the child device
 * sends matched_keyword (phrase from its list) that the server also lists and
 * that appears inside the normalized query (prevents arbitrary keyword injection).
 */
function serverAcceptsFlaggedSearch(normalized, body) {
  if (queryMatchesBlocklist(normalized)) return true;
  const mkRaw =
    body && typeof body.matched_keyword === "string" ? body.matched_keyword : "";
  const mk = normalizeQuery(mkRaw);
  if (!mk || mk.length < 2) return false;
  if (!normalized.includes(mk)) return false;
  const phrases = loadBlockedPhrases();
  return phrases.some((p) => p.length >= 2 && normalizeQuery(p) === mk);
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

/** Plain-text body for clients that hide HTML or for inbox previews. */
function buildFlaggedSearchEmailPlain({
  childName,
  query,
  sourcePackage,
  deviceLocalDate,
  deviceLocalTime,
  deviceTimezone,
  serverReceivedUtc,
}) {
  const child = childName || "Your child";
  const q = String(query || "").slice(0, 500);
  const pkg = sourcePackage || "unknown app/browser";
  return [
    "KIDORA — URGENT: flagged search",
    "",
    `Child: ${child}`,
    `What they searched: ${q}`,
    `App / browser (package): ${pkg}`,
    `Device date: ${deviceLocalDate || "—"}`,
    `Device time: ${deviceLocalTime || "—"}`,
    `Time zone: ${deviceTimezone || "—"}`,
    `Server received (UTC): ${serverReceivedUtc || new Date().toISOString()}`,
    "",
    "Open the Kidora parent app on your phone for more context.",
  ].join("\n");
}

/**
 * Flagged-search parent emails (try order controlled by SAFETY_MAIL_SMTP_FIRST):
 * Default: optional Resend → optional SAFETY_RELAY_SMTP_* (Brevo/SendGrid/SES relay) → primary SMTP_* (often Gmail).
 * SAFETY_MAIL_SMTP_FIRST=1: primary SMTP first, then Resend, then relay.
 * Lastly: SAFETY_EMAIL_WEBHOOK_URL if all skips/fail.
 */
const MAIL_TRANSPORT_TIMEOUT_MS = Math.min(
  120000,
  Math.max(
    10000,
    parseInt(process.env.SAFETY_MAIL_TRANSPORT_TIMEOUT_MS || "35000", 10) || 35000
  )
);

/** Avoid one slow/hung SMTP connection blocking webhook fallback timing. */
function promiseWithMailTimeout(label, promise) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: timed out after ${MAIL_TRANSPORT_TIMEOUT_MS}ms`)),
      MAIL_TRANSPORT_TIMEOUT_MS
    );
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

function describeSafetyMailOrder(resendConfigured, relayConfigured, smtpFirst) {
  if (smtpFirst) {
    const steps = ["primary_smtp"];
    if (resendConfigured) steps.push("resend");
    if (relayConfigured) steps.push("safety_relay_smtp");
    steps.push("webhook_if_needed");
    return steps.join("_then_");
  }
  const steps = [];
  if (resendConfigured) steps.push("resend");
  if (relayConfigured) steps.push("safety_relay_smtp");
  steps.push("primary_smtp", "webhook_if_needed");
  return steps.join("_then_");
}

function describeSafetyMailTransport(resendConfigured, relayConfigured) {
  if (resendConfigured || relayConfigured) return "tiered_resend_relay_smtp_webhook";
  return "smtp_webhook_only";
}

/**
 * Optional Zapier/Make/n8n relay: POST JSON payload when SMTP fails or is skipped.
 */
async function attemptSafetyEmailWebhook(recipientNorm, subject, html, textPlain) {
  const url = String(process.env.SAFETY_EMAIL_WEBHOOK_URL || "").trim();
  if (!url) {
    return { skipped: true, reason: "no_webhook_url" };
  }

  try {
    await promiseWithMailTimeout(
      "safety_webhook",
      (async () => {
        const headers = { "Content-Type": "application/json" };
        const sec = String(process.env.SAFETY_EMAIL_WEBHOOK_SECRET || "").trim();
        if (sec) headers.Authorization = `Bearer ${sec}`;
        const ac =
          typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(MAIL_TRANSPORT_TIMEOUT_MS)
            : undefined;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            kind: "kidora_safety_parent_email",
            to: recipientNorm,
            subject,
            html,
            text: textPlain ? String(textPlain) : "",
          }),
          signal: ac,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Webhook HTTP ${res.status}: ${body.slice(0, 400)}`);
        }
      })()
    );
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn("[safety] SAFETY_EMAIL_WEBHOOK_URL failed:", msg.slice(0, 300));
    return { skipped: true, reason: `webhook:${msg.slice(0, 200)}` };
  }

  console.log("[safety] SAFETY_EMAIL_WEBHOOK_URL accepted POST (relay may send inbox mail separately)");
  return { skipped: false, via: "webhook" };
}

/** Readable hint for admins / Logcat debugging when email_sent is false. */
function deliveryHintWhenEmailSkipped(parentEmailNorm, emailSent, emailErrorRaw) {
  if (emailSent) return null;
  if (!parentEmailNorm) {
    return "Open Kidora parent app while signed in to sync Firebase email into MySQL, or ensure firebase_uid matches the Firebase project.";
  }
  let diag = null;
  try {
    diag = getSmtpPingDiagnostics();
  } catch (_e) {
    // ignore
  }
  if (diag?.smtp_identity_warning) {
    return diag.smtp_identity_warning;
  }
  const err = String(emailErrorRaw || "").toLowerCase();
  if (
    err.includes("username and password") ||
    err.includes("invalid login") ||
    err.includes("eauth") ||
    err.includes("blocked") ||
    err.includes("timed out") ||
    err.includes("econn refused") ||
    err.includes("connection closed") ||
    err.includes("smtp")
  ) {
    return "SMTP reported an error above; verify SMTP_* env vars on the Web Service and check Render logs for [smtpEnv] SMTP attempt lines.";
  }
  if (err.includes("resend http") || err.includes("resend")) {
    return "Resend API error — verify RESEND_API_KEY, Resend dashboard, and that RESEND_FROM is a verified sender/domain.";
  }
  if (err.includes("webhook:http") || err.includes("webhook:")) {
    return "SAFETY_EMAIL_WEBHOOK_URL relay failed — fix the Zapier/Make/n8n URL or SMTP settings.";
  }
  if (diag?.on_render && diag?.gmail_mode && diag?.smtp_ready) {
    const hasResend =
      !!String(process.env.RESEND_API_KEY || "").trim() &&
      !!String(process.env.RESEND_FROM || "").trim();
    const hasRelay = !!getSafetyRelaySmtpDiagnostics().safety_relay_smtp_configured;
    if (!hasResend && !hasRelay) {
      return "Hosted on Render with Google SMTP: mail often never arrives even when SMTP accepts it. Fixes: add SAFETY_RELAY_SMTP_HOST + SAFETY_RELAY_SMTP_USER + SAFETY_RELAY_SMTP_PASS (transactional SMTP, e.g. Brevo smtp-relay.brevo.com) — safety mails use it before Gmail. Or RESEND_API_KEY + RESEND_FROM. Or SES/SendGrid SMTP as relay.";
    }
    return "Transactional path (Resend and/or SAFETY_RELAY_SMTP) is set — if mail still does not arrive, check that provider's dashboard (bounces, suppression) and that the From address is verified.";
  }
  return "See Render logs under [safety]/[smtpEnv] and email_error in this JSON.";
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
function resolveResendConfig() {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM || "").trim();
  return { configured: !!(key && from), apiKey: key, fromRaw: from };
}

/** transactional API — better inbox reliability from PaaS than raw Gmail SMTP. */
async function sendViaResend(to, subject, html, textPlain) {
  const { configured, apiKey, fromRaw } = resolveResendConfig();
  if (!configured) {
    return { skipped: true, reason: "no_RESEND_API_KEY_or_RESEND_FROM" };
  }

  const fromHeader = fromRaw.includes("<") ? fromRaw : `"Kidora" <${fromRaw}>`;
  const body = {
    from: fromHeader,
    to: [to],
    subject,
    html,
  };
  if (textPlain && String(textPlain).trim()) {
    body.text = String(textPlain);
  }

  try {
    const ac =
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(MAIL_TRANSPORT_TIMEOUT_MS)
        : undefined;
    const res = await promiseWithMailTimeout(
      "resend_send",
      (async () => {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: ac,
        });
        const raw = await r.text();
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_e) {
          // ignore
        }
        if (!r.ok) {
          const msg = parsed?.message || raw || r.statusText;
          throw new Error(`Resend HTTP ${r.status}: ${String(msg).slice(0, 300)}`);
        }
        return parsed;
      })()
    );
    const id = res?.id ? String(res.id) : null;
    return { skipped: false, via: "resend", messageId: id };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 400);
    console.warn("[safety] Resend send failed:", msg);
    return { skipped: true, reason: msg };
  }
}

/** Transactional relay (SAFETY_RELAY_SMTP_*) — use this from Render instead of Gmail-only SMTP when inbox delivery matters. */
async function sendViaSafetyRelaySmtp(to, subject, html, textPlain) {
  const diag = getSafetyRelaySmtpDiagnostics();
  if (!diag.safety_relay_smtp_configured) {
    return { skipped: true, reason: "safety_relay_smtp_not_configured" };
  }

  const fromRaw =
    process.env.SAFETY_RELAY_SMTP_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    resolveSmtpUser() ||
    "";
  if (!fromRaw) {
    return {
      skipped: true,
      reason: "no_SAFETY_RELAY_SMTP_FROM_or_SMTP_FROM",
    };
  }

  const fromHeader = fromRaw.includes("<") ? fromRaw : `"Kidora" <${fromRaw}>`;
  const mail = {
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
  };
  if (textPlain && String(textPlain).trim()) {
    mail.text = String(textPlain);
  }
  try {
    const info = await promiseWithMailTimeout(
      "safety_relay_smtp_send",
      sendSafetyRelaySmtpMail(mail)
    );
    return { skipped: false, via: "safety_relay_smtp", messageId: info.messageId };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 400);
    console.warn("[safety] SAFETY_RELAY SMTP send failed:", msg);
    return { skipped: true, reason: msg };
  }
}

async function sendViaConfiguredSmtp(to, subject, html, textPlain) {
  const fromRaw = process.env.SMTP_FROM?.trim() || resolveSmtpUser() || "";
  if (!fromRaw) {
    return { skipped: true, reason: "no_smtp_from_set_SMTP_FROM_or_SMTP_USER" };
  }

  const fromHeader = fromRaw.includes("<") ? fromRaw : `"Kidora" <${fromRaw}>`;
  const mail = {
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
  };
  if (textPlain && String(textPlain).trim()) {
    mail.text = String(textPlain);
  }
  try {
    const info = await promiseWithMailTimeout(
      "smtp_send",
      sendConfiguredSmtpMail(mail)
    );
    return { skipped: false, via: "smtp", messageId: info.messageId };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 400);
    console.warn("[safety] SMTP send failed:", msg);
    return { skipped: true, reason: msg };
  }
}

/**
 * Flagged-search parent mail: Resend, SAFETY_RELAY SMTP, primary SMTP, webhook — see SAFETY_MAIL_SMTP_FIRST.
 */
async function sendParentEmail(to, subject, html, textPlain) {
  const recipient = normalizeParentEmail(to);
  if (!recipient) {
    console.warn("[safety] invalid parent email, skip send");
    return { skipped: true, reason: "invalid_email" };
  }

  async function attemptResend() {
    const r = await sendViaResend(recipient, subject, html, textPlain);
    if (!r.skipped) {
      return { skipped: false, via: r.via || "resend", messageId: r.messageId };
    }
    return { skipped: true, reason: r.reason || "resend_skipped" };
  }

  async function attemptRelay() {
    const r = await sendViaSafetyRelaySmtp(recipient, subject, html, textPlain);
    if (!r.skipped) {
      return { skipped: false, via: r.via || "safety_relay_smtp", messageId: r.messageId };
    }
    return { skipped: true, reason: r.reason || "relay_skipped" };
  }

  async function attemptSmtp() {
    const smtp = await sendViaConfiguredSmtp(recipient, subject, html, textPlain);
    if (!smtp.skipped) {
      return { skipped: false, via: smtp.via || "smtp", messageId: smtp.messageId };
    }
    return { skipped: true, reason: smtp.reason || "smtp_not_configured" };
  }

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
      "[safety] all mail transports failed or skipped for",
      recipient,
      errors.join(" | ").slice(0, 400)
    );
    return {
      skipped: true,
      reason: errors.length ? errors.join(" | ").slice(0, 500) : "no_mailer_config",
    };
  }

  async function runMailChain(fns) {
    const inner = await tryChain(fns);
    if (!inner.skipped) return inner;
    const hook = await attemptSafetyEmailWebhook(recipient, subject, html, textPlain);
    if (!hook.skipped) return hook;
    if (hook.reason === "no_webhook_url") return inner;
    return {
      skipped: true,
      reason:
        `${inner.reason || "no_mailer_config"} | ${hook.reason}`.slice(0, 500),
    };
  }

  const resendCfg = resolveResendConfig();
  const relayDiag = getSafetyRelaySmtpDiagnostics();
  const smtpFirst = String(process.env.SAFETY_MAIL_SMTP_FIRST || "").trim() === "1";

  const attempts = [];
  if (smtpFirst) {
    attempts.push(attemptSmtp);
    if (resendCfg.configured) attempts.push(attemptResend);
    if (relayDiag.safety_relay_smtp_configured) attempts.push(attemptRelay);
  } else {
    if (resendCfg.configured) attempts.push(attemptResend);
    if (relayDiag.safety_relay_smtp_configured) attempts.push(attemptRelay);
    attempts.push(attemptSmtp);
  }

  return runMailChain(attempts);
}

// GET /api/safety/ping — verify DB + mail config (no auth; for deploy checks only)
router.get("/ping", async (_req, res) => {
  try {
    await db.query("SELECT 1 AS ok");
    const mail = getSmtpPingDiagnostics();
    let safety_stats = null;
    try {
      const [sx] = await db.query(
        "SELECT MAX(id) AS last_id, COUNT(*) AS total FROM safety_search_alerts"
      );
      safety_stats = {
        safety_search_alerts_last_id: sx[0]?.last_id ?? null,
        safety_search_alerts_total: Number(sx[0]?.total ?? 0),
      };
    } catch (e) {
      safety_stats = { error: String(e?.message || e).slice(0, 200) };
    }
    const rc = resolveResendConfig();
    const relayDiag = getSafetyRelaySmtpDiagnostics();
    const smtpFirst = String(process.env.SAFETY_MAIL_SMTP_FIRST || "").trim() === "1";
    const safety_mail_order = describeSafetyMailOrder(
      rc.configured,
      relayDiag.safety_relay_smtp_configured,
      smtpFirst
    );
    const transport = describeSafetyMailTransport(
      rc.configured,
      relayDiag.safety_relay_smtp_configured
    );

    return res.json({
      ok: true,
      db: true,
      ...safety_stats,
      ...mail,
      resend_configured: rc.configured,
      safety_mail_smtp_first: smtpFirst,
      safety_mail_order,
      safety_email_webhook_set: !!String(process.env.SAFETY_EMAIL_WEBHOOK_URL || "").trim(),
      email_provider: String(process.env.EMAIL_PROVIDER || "auto").trim() || "auto",
      safety_mail_transport: transport,
      mail_timeout_ms_default: MAIL_TRANSPORT_TIMEOUT_MS,
      auto_mail_order_hint:
        "Default tries: configured Resend → configured SAFETY_RELAY_SMTP → primary SMTP_* (e.g. Gmail), then SAFETY_EMAIL_WEBHOOK_URL. SAFETY_MAIL_SMTP_FIRST=1 reverses order to start with primary SMTP. See safety_relay_smtp_quickstart when relay is unset.",
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

    if (!serverAcceptsFlaggedSearch(normalized, req.body)) {
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
    const displayName =
      typeof req.body.child_display_name === "string" && req.body.child_display_name.trim()
        ? String(req.body.child_display_name).trim().slice(0, 160)
        : null;
    const labelForParent = (displayName && displayName.trim()) || childName || "Your child";

    const [dupRecent] = await db.query(
      `SELECT query_text FROM safety_search_alerts
       WHERE child_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE)
       ORDER BY id DESC LIMIT 80`,
      [childId]
    );
    const isDup =
      Array.isArray(dupRecent) &&
      dupRecent.some((row) => normalizeQuery(row.query_text) === normalized);
    if (isDup) {
      return res.json({
        ok: true,
        logged: false,
        deduped: true,
        message:
          "Same normalized search was already stored within the last few minutes — no duplicate row/email.",
        hint: "Wait 3+ minutes or test with different wording so the alert pipeline runs again.",
      });
    }

    const [recent] = await db.query(
      `SELECT COUNT(*) AS n FROM safety_search_alerts WHERE child_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [childId]
    );
    const n = recent[0]?.n ?? 0;
    const hourlyCap = Math.max(12, parseInt(process.env.SAFETY_ALERTS_PER_CHILD_HOUR || "60", 10) || 60);
    if (n >= hourlyCap) {
      console.warn("[safety] rate_limited", { childId, n, hourlyCap });
      return res.status(429).json({ ok: false, error: "rate_limited", hourly_cap: hourlyCap });
    }

    const [insertResult] = await db.query(
      `INSERT INTO safety_search_alerts (child_id, query_text, source_package) VALUES (?, ?, ?)`,
      [childId, query.slice(0, 2000), sourcePackage.slice(0, 255)]
    );
    const alertId = insertResult?.insertId ?? null;
    console.log("[safety] INSERT safety_search_alerts ok (before email)", { childId, alertId });

    const resolvedRecipient = await resolveParentRecipientEmail(rows[0]);
    const parentEmailNorm = resolvedRecipient.email;
    if (!parentEmailNorm) {
      console.warn("[safety] parent email missing — row saved; push still attempted", {
        childId,
        alertId,
        detail: resolvedRecipient.detail,
      });
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

    const kw = query.length > 42 ? `${query.slice(0, 42)}…` : query;
    const subject = `[URGENT] Kidora: "${kw}" — ${labelForParent}`;

    let emailSent = false;
    let emailError = null;
    let emailVia = null;
    if (parentEmailNorm) {
      const html = buildFlaggedSearchEmailHtml({
        childName: labelForParent,
        query: query.slice(0, 500),
        sourcePackage,
        deviceLocalDate,
        deviceLocalTime,
        deviceTimezone,
        serverReceivedUtc,
      });

      const plain = buildFlaggedSearchEmailPlain({
        childName: labelForParent,
        query: query.slice(0, 500),
        sourcePackage,
        deviceLocalDate,
        deviceLocalTime,
        deviceTimezone,
        serverReceivedUtc,
      });

      try {
        const mailResult = await sendParentEmail(parentEmailNorm, subject, html, plain);
        emailSent = !mailResult.skipped;
        if (!mailResult.skipped) emailVia = mailResult.via || null;
        if (mailResult.skipped) {
          emailError = mailResult.reason || "skipped";
        }
      } catch (mailErr) {
        console.error("[safety] send mail error", mailErr?.message || mailErr);
        emailError = String(mailErr?.message || "email_failed").slice(0, 200);
      }
    } else {
      emailError = resolvedRecipient.detail || "no_parent_email";
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

    const queryPush =
      query.length > 120 ? `${query.slice(0, 120)}…` : query;
    const pushBody = `${labelForParent} searched: "${queryPush}" — open Kidora.`.slice(
      0,
      2000
    );

    let pushResult = { sent: false, skipped: "not_attempted" };
    try {
      pushResult = await sendParentNotificationPush(db, rows[0].parent_id, {
        title: "Kidora — safety alert",
        body: pushBody,
        type: "safety_search",
        childId,
        query: query.slice(0, 300),
      });
    } catch (pushErr) {
      console.warn("[safety] parent FCM", pushErr?.message || pushErr);
      pushResult = { sent: false, error: String(pushErr?.message || pushErr).slice(0, 400) };
    }

    let mailDiag = null;
    try {
      mailDiag = getSmtpPingDiagnostics();
    } catch (_e) {
      mailDiag = {};
    }

    const rcPost = resolveResendConfig();
    const relayPost = getSafetyRelaySmtpDiagnostics();
    const smtpFirstPost = String(process.env.SAFETY_MAIL_SMTP_FIRST || "").trim() === "1";
    const safetyMailOrder = describeSafetyMailOrder(
      rcPost.configured,
      relayPost.safety_relay_smtp_configured,
      smtpFirstPost
    );
    const transportPost = describeSafetyMailTransport(
      rcPost.configured,
      relayPost.safety_relay_smtp_configured
    );

    return res.json({
      ok: true,
      logged: true,
      alert_id: alertId,
      email_sent: emailSent,
      email_via: emailVia,
      email_error: emailError,
      email_skipped: !parentEmailNorm,
      parent_email_source: resolvedRecipient.source,
      parent_email_masked: parentEmailNorm
        ? (() => {
            const [loc, dom] = parentEmailNorm.split("@");
            if (!dom) return "***";
            return `${(loc || "?").slice(0, 1)}***@${dom}`;
          })()
        : null,
      mail_env: {
        smtp_ready: !!mailDiag.smtp_ready,
        resend_configured: rcPost.configured,
        safety_relay_smtp_configured: relayPost.safety_relay_smtp_configured,
        safety_mail_order: safetyMailOrder,
        safety_mail_transport: transportPost,
        safety_email_webhook_set: !!String(process.env.SAFETY_EMAIL_WEBHOOK_URL || "").trim(),
        email_provider: String(process.env.EMAIL_PROVIDER || "auto").trim() || "auto",
        delivery_hint:
          deliveryHintWhenEmailSkipped(parentEmailNorm, emailSent, emailError) || undefined,
      },
      push_sent: !!pushResult.sent,
      push_skipped: pushResult.skipped || null,
      push_error: pushResult.error || null,
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
