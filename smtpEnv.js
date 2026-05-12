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

function normalizeSecret(value) {
  let v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/\s+/g, "");
}

function resolveSmtpPass() {
  return normalizeSecret(pickFirstEnv(SMTP_PASS_ENV_KEYS).value);
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

function createGmailTransport(user, pass) {
  const host = resolveSmtpHostRaw().toLowerCase() || "smtp.gmail.com";
  const port = parseInt(readEnvKey("SMTP_PORT").value || "587", 10);
  const secureRaw = readEnvKey("SMTP_SECURE").value;
  const secure =
    secureRaw === "1" ||
    String(secureRaw).toLowerCase() === "true" ||
    port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
  });
}

function clearTransporter() {
  transporter = null;
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

  if (shouldUseGmailServiceTransport()) {
    transporter = createGmailTransport(user, pass);
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
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
  });
  return transporter;
}

async function verifySmtpConnection() {
  const user = resolveSmtpUser();
  const pass = resolveSmtpPass();
  if (!user || !pass) {
    return { ok: false, error: "missing_smtp_credentials" };
  }

  const attempts = [];
  if (shouldUseGmailServiceTransport()) {
    attempts.push(createGmailTransport(user, pass));
    attempts.push(
      nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
      })
    );
  } else {
    const tx = getTransporter();
    if (tx) attempts.push(tx);
  }

  let lastError = null;
  for (const tx of attempts) {
    try {
      await tx.verify();
      transporter = tx;
      return { ok: true };
    } catch (err) {
      lastError = err;
    }
  }

  clearTransporter();
  return {
    ok: false,
    error: String(lastError?.message || lastError || "smtp_verify_failed").slice(0, 300),
  };
}

async function sendMailWithConfiguredTransport(mailOptions) {
  const user = resolveSmtpUser();
  const pass = resolveSmtpPass();
  if (!user || !pass) {
    return { skipped: true, reason: "missing_smtp_credentials" };
  }

  const attempts = [];
  if (shouldUseGmailServiceTransport()) {
    attempts.push(createGmailTransport(user, pass));
    attempts.push(
      nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
      })
    );
  } else {
    const tx = getTransporter();
    if (tx) attempts.push(tx);
  }

  if (!attempts.length) {
    return { skipped: true, reason: "no_smtp_transport" };
  }

  let lastError = null;
  for (const tx of attempts) {
    try {
      const info = await tx.sendMail(mailOptions);
      transporter = tx;
      return { skipped: false, via: "smtp", messageId: info.messageId };
    } catch (err) {
      lastError = err;
    }
  }

  clearTransporter();
  throw lastError || new Error("smtp_send_failed");
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

  return {
    smtp_ready: smtpReady,
    gmail_mode: gmailMode,
    has_smtp_user: hasUser,
    has_smtp_pass: hasPass,
    smtp_user_env_key: userPick.matchedKey,
    smtp_pass_env_key: passPick.matchedKey,
    smtp_host_set: hostSet,
    email_provider: emailProvider || "auto",
    hint,
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
  clearTransporter,
  verifySmtpConnection,
  sendMailWithConfiguredTransport,
  getSmtpPingDiagnostics,
  logSmtpStartup,
};
