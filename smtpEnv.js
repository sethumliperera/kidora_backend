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

/** Match safety mail Brevo key cleanup so ping agrees with outbound sends. */
function normalizedSecretEnv(raw) {
  if (raw == null) return "";
  let s = String(raw).replace(/^\ufeff/, "").trim();
  s = s.replace(/\u200b/g, "").replace(/\s+$/gm, "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function isLikelyGmailAccount(userRaw) {
  const u = String(userRaw || "")
    .trim()
    .toLowerCase();
  return u.endsWith("@gmail.com") || u.endsWith("@googlemail.com");
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
    const secure =
      secureRaw === "1" ||
      String(secureRaw).toLowerCase() === "true" ||
      String(secureRaw).toLowerCase() === "yes";
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      requireTLS: !secure && port === 587,
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

  const hasResend = !!String(process.env.RESEND_API_KEY || "").trim();
  const hasBrevo =
    !!normalizedSecretEnv(process.env.BREVO_API_KEY) ||
    !!normalizedSecretEnv(process.env.SENDINBLUE_API_KEY);
  const hasSendgrid = !!String(process.env.SENDGRID_API_KEY || "").trim();
  const hasApis = hasResend || hasBrevo || hasSendgrid;
  /** When smtp looks fine but parent mail still fails — common on Render + Gmail. */
  let safety_email_note = null;
  if (!hasApis && onRender && smtpReady && gmailMode) {
    safety_email_note =
      "Render + Gmail SMTP alone is unreliable: Google often blocks or delays logins from datacenter IPs even with an App Password. " +
      "Fix: add RESEND_API_KEY + RESEND_FROM, or BREVO_API_KEY (or SENDINBLUE_API_KEY) + BREVO_SENDER_EMAIL (verified in Brevo), or SENDGRID_API_KEY; redeploy. " +
      "EMAIL_PROVIDER=gmail still uses those APIs before Gmail when keys are present. SAFETY_EMAIL_WEBHOOK_URL is a last-step relay after transports fail.";
  }

  return {
    smtp_ready: smtpReady,
    smtp_transport,
    gmail_mode: gmailMode,
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
  getSmtpPingDiagnostics,
  logSmtpStartup,
};
