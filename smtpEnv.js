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

function isLikelyGmailAccount(userRaw) {
  const u = String(userRaw || "")
    .trim()
    .toLowerCase();
  return u.endsWith("@gmail.com") || u.endsWith("@googlemail.com");
}

function shouldUseGmailServiceTransport() {
  const provider = readEnvKey("EMAIL_PROVIDER").value.toLowerCase().trim();
  const svc = readEnvKey("SMTP_SERVICE").value.toLowerCase().trim();
  const hostRaw = resolveSmtpHostRaw();
  const host = hostRaw.toLowerCase();
  const user = resolveSmtpUser();

  if (provider === "gmail" || svc === "gmail" || host === "smtp.gmail.com") return true;
  if (isLikelyGmailAccount(user) && !hostRaw) return true;
  return false;
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

  if (shouldUseGmailServiceTransport()) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth,
    });
    return transporter;
  }

  const host = resolveSmtpHostRaw().toLowerCase();
  if (!host) {
    console.warn(
      "[smtpEnv] SMTP_HOST missing - use @gmail.com SMTP_USER with no host for auto-Gmail, or set SMTP_HOST."
    );
    return null;
  }

  const port = parseInt(readEnvKey("SMTP_PORT").value || "587", 10);
  const secureRaw = readEnvKey("SMTP_SECURE").value;
  const secure = secureRaw === "1" || String(secureRaw).toLowerCase() === "true";
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

function getSmtpPingDiagnostics() {
  const userPick = pickFirstEnv(SMTP_USER_ENV_KEYS);
  const passPick = pickFirstEnv(SMTP_PASS_ENV_KEYS);
  const hasUser = !!userPick.value;
  const hasPass = !!passPick.value;
  const gmailMode = shouldUseGmailServiceTransport();
  const gmailReady = gmailMode && hasUser && hasPass;
  const hostSet = !!resolveSmtpHostRaw();
  const genericSmtpReady = hostSet && hasUser && hasPass;
  const smtpReady = gmailReady || genericSmtpReady;
  const emailProvider = readEnvKey("EMAIL_PROVIDER").value || "auto";

  return {
    smtp_ready: smtpReady,
    gmail_mode: gmailMode,
    has_smtp_user: hasUser,
    has_smtp_pass: hasPass,
    smtp_user_env_key: userPick.matchedKey,
    smtp_pass_env_key: passPick.matchedKey,
    smtp_host_set: hostSet,
    email_provider: emailProvider || "auto",
    hint: smtpReady
      ? null
      : "No mail credentials in this Node process. In Render: open the Web Service that runs kidora-api (not MySQL), Environment, add SMTP_USER and SMTP_PASS (or GMAIL_USER and GMAIL_APP_PASSWORD). Save, then Manual Deploy. Names checked: " +
        SMTP_USER_ENV_KEYS.join(", ") +
        " / " +
        SMTP_PASS_ENV_KEYS.join(", ") +
        ".",
  };
}

function logSmtpStartup() {
  const d = getSmtpPingDiagnostics();
  if (!d.smtp_ready) {
    console.warn("[Kidora] Safety alert email disabled:", d.hint);
  } else {
    console.log("[Kidora] SMTP configured (" + (d.gmail_mode ? "Gmail service" : "custom SMTP host") + ")");
  }
}

module.exports = {
  SMTP_USER_ENV_KEYS,
  SMTP_PASS_ENV_KEYS,
  resolveSmtpUser,
  resolveSmtpPass,
  shouldUseGmailServiceTransport,
  getTransporter,
  getSmtpPingDiagnostics,
  logSmtpStartup,
};
