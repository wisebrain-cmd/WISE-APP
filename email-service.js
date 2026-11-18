const fs = require("node:fs");
const path = require("node:path");

function createEmailSender({ env = process.env, logger = console } = {}) {
  const production = env.NODE_ENV === "production";
  const provider = env.EMAIL_PROVIDER || (production ? "resend" : "console");

  function getBaseUrl() {
    const configured = env.APP_BASE_URL || (!production ? `http://localhost:${Number(env.PORT) || 3000}` : "");
    if (!configured) throw new Error("APP_BASE_URL is required for account email links.");
    let parsed;
    try { parsed = new URL(configured); }
    catch { throw new Error("APP_BASE_URL must be an absolute HTTP(S) URL."); }
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password
      || parsed.search || parsed.hash || (production && parsed.protocol !== "https:")) {
      throw new Error("APP_BASE_URL must be a public HTTPS origin in production.");
    }
    return parsed.origin;
  }

  function isConfigured() {
    if (provider === "console" && !production) return true;
    if (provider !== "resend" || !env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
    try { getBaseUrl(); return true; }
    catch { return false; }
  }

  async function send({ to, subject, text }) {
    if (provider === "console" && !production) {
      const preview = `[WSE email preview]\nTo: ${to}\nSubject: ${subject}\n\n${text}`;
      logger.info(preview);
      if (env.EMAIL_LOG_PATH) {
        const logPath = path.resolve(env.EMAIL_LOG_PATH);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `${preview}\n\n`, { mode: 0o600 });
        try { fs.chmodSync(logPath, 0o600); } catch { }
      }
      return;
    }
    if (provider !== "resend") throw new Error("Set EMAIL_PROVIDER to resend for email delivery.");
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new Error("RESEND_API_KEY and EMAIL_FROM are required for email delivery.");
    }
    if (/[\r\n]/.test(env.EMAIL_FROM) || env.EMAIL_FROM.length > 200) {
      throw new Error("EMAIL_FROM is invalid.");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  }

  function makeLink(page, token) {
    const url = new URL(page, getBaseUrl());
    url.searchParams.set("token", token);
    return url.toString();
  }

  return {
    isConfigured,
    sendVerification(to, token) {
      const link = makeLink("/email-confirmation.html", token);
      return send({
        to,
        subject: "Verify your WSE Adventures email",
        text: `Confirm your email address by opening this link:\n\n${link}\n\nThis link expires in 24 hours. If you did not create or update this account, you can ignore this message.`
      });
    },
    sendPasswordReset(to, token) {
      const link = makeLink("/password-reset.html", token);
      return send({
        to,
        subject: "Reset your WSE Adventures password",
        text: `Choose a new password by opening this link:\n\n${link}\n\nThis link expires in 30 minutes. If you did not request a password reset, you can ignore this message.`
      });
    },
    sendEmailChangeNotice(to, newAddress) {
      return send({
        to,
        subject: "Your WSE Adventures email address changed",
        text: `The email address on your WSE Adventures account was changed to ${newAddress}. If you did not make this change, reset your password immediately and contact support.`
      });
    }
  };
}

module.exports = { createEmailSender };
