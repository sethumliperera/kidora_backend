const { resolveSmtpUser, sendMailWithConfiguredTransport } = require("./smtpEnv");

const DEFAULT_RESEND_FROM = "Kidora <onboarding@resend.dev>";

function isOnRender() {
  return !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);
}

function isRenderFree() {
  if (!isOnRender()) return false;
  const instanceType = String(process.env.RENDER_INSTANCE_TYPE || "free").toLowerCase();
  return !instanceType || instanceType.includes("free");
}

function hasResendApiKey() {
  return !!process.env.RESEND_API_KEY?.trim();
}

function hasSendgridApiKey() {
  return !!process.env.SENDGRID_API_KEY?.trim();
}

function resolveMailTransport() {
  const prefer = (process.env.EMAIL_PROVIDER || "resend").toLowerCase().trim();

  if (prefer === "sendgrid") return "sendgrid";
  if (prefer === "resend") return "resend";
  if (prefer === "smtp" || prefer === "gmail") {
    if (isRenderFree() && hasResendApiKey()) return "resend";
    return "smtp";
  }

  if (hasResendApiKey()) return "resend";
  if (hasSendgridApiKey()) return "sendgrid";
  if (isOnRender()) return "resend";
  return "smtp";
}

function getMailPingDiagnostics() {
  const transport = resolveMailTransport();
  const resendFrom = process.env.RESEND_FROM?.trim() || DEFAULT_RESEND_FROM;
  let hint = null;

  if (transport === "resend" && !hasResendApiKey()) {
    hint =
      "Set RESEND_API_KEY on kidora-api (Render Environment), keep EMAIL_PROVIDER=resend, optional RESEND_FROM=Kidora <onboarding@resend.dev>, then redeploy.";
  } else if (transport === "sendgrid" && !hasSendgridApiKey()) {
    hint = "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on kidora-api, then redeploy.";
  } else if (transport === "smtp" && isRenderFree()) {
    hint =
      "Render free blocks Gmail SMTP. Set EMAIL_PROVIDER=resend and RESEND_API_KEY, or upgrade kidora-api to a paid Render instance for Gmail SMTP.";
  }

  return {
    email_provider: (process.env.EMAIL_PROVIDER || "resend").toLowerCase().trim() || "resend",
    mail_transport: transport,
    mail_ready:
      (transport === "resend" && hasResendApiKey()) ||
      (transport === "sendgrid" && hasSendgridApiKey()) ||
      transport === "smtp",
    has_resend_api_key: hasResendApiKey(),
    has_sendgrid_api_key: hasSendgridApiKey(),
    resend_from: resendFrom,
    on_render: isOnRender(),
    render_instance_type: process.env.RENDER_INSTANCE_TYPE || null,
    hint,
  };
}

function logMailStartup() {
  const d = getMailPingDiagnostics();
  if (d.mail_transport === "resend") {
    if (d.has_resend_api_key) {
      console.log("[Kidora] Parent safety email via Resend HTTPS (" + d.resend_from + ")");
    } else {
      console.warn("[Kidora] Resend selected but RESEND_API_KEY is missing:", d.hint);
    }
    return;
  }
  if (d.mail_transport === "sendgrid") {
    console.log("[Kidora] Parent safety email via SendGrid HTTPS");
    return;
  }
  console.log("[Kidora] Parent safety email via SMTP");
}

async function sendViaResend(to, subject, html) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_RESEND_FROM;
  if (!key) {
    return { skipped: true, reason: "resend_api_key_missing" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
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
    throw new Error("Resend HTTP " + res.status + ": " + body.slice(0, 500));
  }

  const data = await res.json().catch(() => ({}));
  return { skipped: false, via: "resend", messageId: data?.id || null };
}

async function sendViaSendGrid(to, subject, html) {
  const key = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail =
    process.env.SENDGRID_FROM_EMAIL?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    resolveSmtpUser();
  if (!key) {
    return { skipped: true, reason: "sendgrid_api_key_missing" };
  }
  if (!fromEmail) {
    return { skipped: true, reason: "sendgrid_from_missing" };
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
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
    throw new Error("SendGrid HTTP " + res.status + ": " + body.slice(0, 500));
  }

  return { skipped: false, via: "sendgrid" };
}

async function sendViaConfiguredSmtp(to, subject, html) {
  const fromRaw = process.env.SMTP_FROM?.trim() || resolveSmtpUser() || "";
  if (!fromRaw) {
    return { skipped: true, reason: "no_smtp_from_set_SMTP_FROM_or_SMTP_USER" };
  }

  const fromHeader = fromRaw.includes("<") ? fromRaw : '"Kidora" <' + fromRaw + ">";
  return sendMailWithConfiguredTransport({
    from: fromHeader,
    to,
    subject,
    html,
    text: "Kidora flagged search alert. Open the HTML version of this email for full details.",
    headers: {
      "X-Priority": "1",
      Importance: "high",
      Priority: "urgent",
      "X-MSMail-Priority": "High",
    },
  });
}

async function sendParentEmail(to, subject, html) {
  const recipient = String(to || "").trim();
  if (!recipient || !recipient.includes("@") || recipient.includes(",") || recipient.includes(";")) {
    return { skipped: true, reason: "invalid_email" };
  }

  const transport = resolveMailTransport();

  if (transport === "resend") {
    const result = await sendViaResend(recipient, subject, html);
    if (!result.skipped) {
      console.log("[safety] email sent via Resend to", recipient, result.messageId || "");
    }
    return result;
  }

  if (transport === "sendgrid") {
    const result = await sendViaSendGrid(recipient, subject, html);
    if (!result.skipped) {
      console.log("[safety] email sent via SendGrid to", recipient);
    }
    return result;
  }

  const smtp = await sendViaConfiguredSmtp(recipient, subject, html);
  if (!smtp.skipped) {
    console.log("[safety] email sent via SMTP to", recipient, smtp.messageId || "");
    return smtp;
  }

  if (isRenderFree() && hasResendApiKey()) {
    const fallback = await sendViaResend(recipient, subject, html);
    if (!fallback.skipped) {
      console.log("[safety] email sent via Resend fallback to", recipient, fallback.messageId || "");
    }
    return fallback;
  }

  return smtp;
}

module.exports = {
  DEFAULT_RESEND_FROM,
  getMailPingDiagnostics,
  logMailStartup,
  resolveMailTransport,
  sendParentEmail,
};
