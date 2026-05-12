const nodemailer = require("nodemailer");

const SMTP_USER_ENV_KEYS = [
  "SMTP_USER",
  "GMAIL_USER",
  "GMAIL_ADDRESS",
  "EMAIL_USER",
  "MAIL_USERNAME",
  "MAIL_USER",
];
const SMTP_PASS_ENV_KEYS = [
  "SMTP_PASS",
  "SMTP_PASSWORD",
  "GMAIL_APP_PASSWORD",
  "GMAIL_PASSWORD",
  "EMAIL_PASSWORD",
  "MAIL_PASSWORD",
];

let transporter = null;

function readEnvKey(canonicalKey) {
  const candidates = [canonicalKey, canonicalKey.toLowerCase(), canonicalKey.toUpperCase()];
  for (const c of candidates) {
    const raw = process.env[c];
    if (raw == null) continue;
    const v = String(raw).trim();
    if (v !== "") return { matchedKey: c, value: v };
  }
  return { matchedKey: null, value: "" };
}

function pickFirstEnv(keys) {
  for (const k of keys) {
    const r = readEnvKey(k);
    if (r.value) return { canonicalKey: k, matchedKey: r.matchedKey, value: r.value };
  }
  return { canonicalKey: null, matchedKey: null, value: "" };
}

function resolveSmtpUser() {
  return pickFirstEnv(SMTP_USER_ENV_KEYS).value;
}

function resolveSmtpPass() {
  return pickFirstEnv(SMTP_PASS_ENV_KEYS).value;
}

function resolveSmtpHostRaw() {
  return readEnvKey("SMTP_HOST").value;
}

function hasConfiguredSmtpHost() {
  return !!String(resolveSmtpHostRaw() || "").trim();
}

function smtpHostLooksLikeGoogle(hostRaw) {
  const h = String(hostRaw || "")
    .trim()
    .toLowerCase();
  return h === "smtp.gmail.com" || h === "smtp.googlemail.com";
}

/**
 * Nodemailer `service: "gmail"` — only when no SMTP_HOST is set (legacy / minimal env).
 */
function useNodemailerGmailService() {
  const provider = readEnvKey("EMAIL_PROVIDER").value.toLowerCase().trim();
  const svc = readEnvKey("SMTP_SERVICE").value.toLowerCase().trim();
  const user = resolveSmtpUser();

  if (provider === "gmail" || svc === "gmail") return true;
  if (isLikelyGmailAccount(user)) return true;
  return false;
}

/**
 * Outbound path hits Google's SMTP — used for diagnostics (Render + Google often flaky).
 */
function transportUsesGoogleSmtpServers() {
  if (hasConfiguredSmtpHost()) {
    return smtpHostLooksLikeGoogle(resolveSmtpHostRaw());
  }
  return useNodemailerGmailService();
}

function isLikelyGmailAccount(userRaw) {
  const u = String(userRaw || "")
    .trim()
    .toLowerCase();
  return u.endsWith("@gmail.com") || u.endsWith("@googlemail.com");
}

/** Extract bare email from "Name <a@b.com>" or "a@b.com". */
function extractEmailAddr(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/<([^<>]+@[^<>]+)>/);
  const inner = (m ? m[1] : s).trim();
  return inner.toLowerCase();
}

/** When From domain does not match the authenticated mailbox Gmail often drops or rejects. */
function computeSmtpFromIdentityWarning(opts) {
  const { gmailMode, smtpReady } = opts;
  const user = resolveSmtpUser().trim().toLowerCase();
  const fromRaw = String(process.env.SMTP_FROM || "").trim();
  if (!smtpReady || !user || !gmailMode || !fromRaw) return null;
  const fromAddr = extractEmailAddr(fromRaw);
  if (!fromAddr.includes("@")) return null;
  if (fromAddr !== user.toLowerCase()) {
    return (
      `SMTP_FROM (${fromAddr}) should match SMTP_USER (${user}) when using Gmail/Google SMTP — mismatched identities often fail or never reach the inbox.`
    );
  }
  return null;
}

/**
 * Back-compat export: true when nodemailer's built-in Gmail service would be chosen
 * (no explicit SMTP_HOST on the host env).
 */
function shouldUseGmailServiceTransport() {
  return !hasConfiguredSmtpHost() && useNodemailerGmailService();
}

function getTransporter() {
  if (transporter) return transporter;
  const user = resolveSmtpUser();
  const pass = resolveSmtpPass();
  if (!user || !pass) {
    console.warn(
      "[smtpEnv] No credentials - set SMTP_USER + SMTP_PASS (or GMAIL_USER + GMAIL_APP_PASSWORD) on the Web Service."
    );
    return null;
  }
  const auth = { user, pass };

  // Explicit SMTP_HOST (+ port / TLS) always wins — matches Render env groups named "SMTP_*".
  if (hasConfiguredSmtpHost()) {
    const host = String(resolveSmtpHostRaw()).trim().toLowerCase();
    const port = parseInt(readEnvKey("SMTP_PORT").value || "587", 10);
    const secureRaw = readEnvKey("SMTP_SECURE").value;
    const secure = parseSmtpSecureRaw(secureRaw);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      requireTLS: !secure && port === 587,
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 45000,
    });
    console.log(
      `[smtpEnv] SMTP transport: explicit host ${host}:${port} (secure=${secure}, requireTLS=${!secure && port === 587})`
    );
    return transporter;
  }

  if (useNodemailerGmailService()) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth,
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 45000,
    });
    console.log("[smtpEnv] SMTP transport: Nodemailer Gmail service (no SMTP_HOST set)");
    return transporter;
  }

  console.warn(
    "[smtpEnv] SMTP_HOST missing - set SMTP_HOST (+ SMTP_PORT, SMTP_SECURE) on the Web Service, or use @gmail.com SMTP_USER + EMAIL_PROVIDER=gmail for implicit Gmail."
  );
  return null;
}

function parseSmtpSecureRaw(secureRaw) {
  return (
    secureRaw === "1" ||
    String(secureRaw).toLowerCase() === "true" ||
    String(secureRaw).toLowerCase() === "yes"
  );
}

/** After transient failure from cloud → Gmail SMTP, retry the alternate port/TLS combo. */
function shouldTryAlternateGmailSmtpProfile(err) {
  const m = `${err?.code || ""} ${err?.responseCode || ""} ${String(
    err?.message || err?.response || err?.command || ""
  )}`.toLowerCase();
  if (
    /invalid user|invalid login|authentication(?:d)? failure|credentials|password|bad.*password|eauth|534|535|denied/i.test(m)
  ) {
    return false;
  }
  return true;
}

/**
 * Sends with env SMTP. For explicit smtp.gmail.com, retries 465 SMTPS if env used 587 (and vice‑versa),
 * unless `GMAIL_SMTP_ALT_RETRY=0`.
 */
async function sendConfiguredSmtpMail(mailOptions) {
  const user = resolveSmtpUser();
  const pass = resolveSmtpPass();
  if (!user || !pass) {
    throw new Error("SMTP_USER and SMTP_PASS are required to send mail.");
  }
  const auth = { user, pass };

  if (!hasConfiguredSmtpHost()) {
    const tx = getTransporter();
    if (!tx) throw new Error("SMTP transport not configured (SMTP_HOST / Gmail implicit).");
    return tx.sendMail(mailOptions);
  }

  const host = String(resolveSmtpHostRaw()).trim().toLowerCase();
  const envPort = parseInt(readEnvKey("SMTP_PORT").value || "587", 10);
  const envSecure = parseSmtpSecureRaw(readEnvKey("SMTP_SECURE").value);

  const profiles = [];
  const keySeen = new Set();
  const add = (port, secure, tag) => {
    const k = `${port}|${secure}`;
    if (keySeen.has(k)) return;
    keySeen.add(k);
    profiles.push({ host, port, secure, tag });
  };

  add(envPort, envSecure, "smtp_env");

  const altOk =
    process.env.GMAIL_SMTP_ALT_RETRY !== "0" &&
    smtpHostLooksLikeGoogle(resolveSmtpHostRaw());

  if (altOk) {
    if (envPort === 587 && !envSecure) {
      add(465, true, "gmail_alt_465_smtps");
    } else if (envPort === 465 && envSecure === true) {
      add(587, false, "gmail_alt_587_starttls");
    }
  }

  let lastErr = null;
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const tx = nodemailer.createTransport({
      host: p.host,
      port: p.port,
      secure: p.secure,
      auth,
      requireTLS: !p.secure && p.port === 587,
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 22000,
      greetingTimeout: 22000,
      socketTimeout: 50000,
    });
    try {
      const info = await tx.sendMail(mailOptions);
      if (profiles.length > 1 && p.tag !== "smtp_env") {
        console.log(
          `[smtpEnv] Gmail SMTP succeeded on fallback (${p.tag} → ${p.host}:${p.port} secure=${p.secure}).`
        );
      }
      return info;
    } catch (e) {
      lastErr = e;
      const brief = String(e?.message || e).slice(0, 260);
      console.warn(`[smtpEnv] SMTP attempt ${p.tag} ${p.host}:${p.port} failed: ${brief}`);
      if (profiles[i + 1] && shouldTryAlternateGmailSmtpProfile(e)) continue;
      break;
    }
  }
  throw lastErr || new Error("SMTP send failed");
}

function getSmtpPingDiagnostics() {
  const userPick = pickFirstEnv(SMTP_USER_ENV_KEYS);
  const passPick = pickFirstEnv(SMTP_PASS_ENV_KEYS);
  const hasUser = !!userPick.value;
  const hasPass = !!passPick.value;
  const hostSet = hasConfiguredSmtpHost();
  const gmailServiceFallback = shouldUseGmailServiceTransport();
  /** Google SMTP endpoints (explicit host or nodemailer gmail service). */
  const gmailMode = transportUsesGoogleSmtpServers();
  const gmailReady = gmailServiceFallback && hasUser && hasPass && !hostSet;
  const genericSmtpReady = hostSet && hasUser && hasPass;
  const smtpReady = gmailReady || genericSmtpReady;
  let smtp_transport = "none";
  if (genericSmtpReady) smtp_transport = "explicit_host";
  else if (gmailReady) smtp_transport = "gmail_service";
  const emailProvider = readEnvKey("EMAIL_PROVIDER").value || "auto";
  const onRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);

  let hint = null;
  if (!smtpReady) {
    hint =
      "This Node process has no SMTP_USER/SMTP_PASS (or aliases). Add them on the SAME Render Web Service that serves this URL (not only inside an Environment Group). " +
      "Dashboard: Services -> select kidora-api (or your API service) -> Environment -> add variables OR link your Environment Group here -> Save -> Manual Deploy. " +
      "Checked keys: " +
      SMTP_USER_ENV_KEYS.join(", ") +
      " / " +
      SMTP_PASS_ENV_KEYS.join(", ") +
      ".";
    if (onRender) {
      hint +=
        " If you edited an Environment Group only: open the Web Service -> Environment -> link that group to this service.";
    }
  }

  /** When SMTP looks configured but Gmail from cloud may never deliver inbox. */
  let safety_email_note = null;

  const gmailExplicitHostFallback =
    gmailMode &&
    hasConfiguredSmtpHost() &&
    smtpHostLooksLikeGoogle(resolveSmtpHostRaw()) &&
    process.env.GMAIL_SMTP_ALT_RETRY !== "0";

  const smtpFromIdentityWarning = computeSmtpFromIdentityWarning({ gmailMode, smtpReady });

  if (onRender && smtpReady && gmailMode) {
    safety_email_note =
      "Render + Google SMTP (smtp.gmail.com): Google often blocks or silently drops mail from cloud hosts even when SMTP login succeeds. Use the same mailbox in SMTP_FROM and SMTP_USER; this build retries port 465 if 587 fails (GMAIL_SMTP_ALT_RETRY=0 disables). Prefer an SMTP relay for your own domain instead of Google's SMTP when sending from PaaS.";
  }

  return {
    smtp_ready: smtpReady,
    smtp_transport,
    gmail_mode: gmailMode,
    gmail_smtp_dual_port_fallback: gmailExplicitHostFallback,
    smtp_identity_warning: smtpFromIdentityWarning,
    has_smtp_user: hasUser,
    has_smtp_pass: hasPass,
    smtp_user_env_key: userPick.matchedKey,
    smtp_pass_env_key: passPick.matchedKey,
    smtp_host_set: hostSet,
    email_provider: emailProvider || "auto",
    hint,
    safety_email_note,
    on_render: onRender,
    render_service_name: process.env.RENDER_SERVICE_NAME || null,
    render_external_url: process.env.RENDER_EXTERNAL_URL || null,
    render_service_id: process.env.RENDER_SERVICE_ID || null,
  };
}

function logSmtpStartup() {
  const d = getSmtpPingDiagnostics();
  if (!d.smtp_ready) {
    console.warn("[Kidora] Safety alert email disabled:", d.hint);
  } else {
    const kind =
      d.smtp_transport === "explicit_host"
        ? `explicit SMTP_HOST (${String(resolveSmtpHostRaw()).trim()}:${readEnvKey("SMTP_PORT").value || "587"})`
        : "Gmail service (implicit, no SMTP_HOST)";
    console.log("[Kidora] SMTP configured:", kind);
  }
}

module.exports = {
  SMTP_USER_ENV_KEYS,
  SMTP_PASS_ENV_KEYS,
  resolveSmtpUser,
  resolveSmtpPass,
  hasConfiguredSmtpHost,
  shouldUseGmailServiceTransport,
  getTransporter,
  sendConfiguredSmtpMail,
  getSmtpPingDiagnostics,
  logSmtpStartup,
};
