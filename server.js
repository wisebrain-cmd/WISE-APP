require("dotenv").config();
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const initSqlJs = require("sql.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleOAuth = googleClientId && googleClientSecret
  ? new OAuth2Client(googleClientId, googleClientSecret, `${appUrl}/auth/google/callback`)
  : null;
const emailDelivery = process.env.EMAIL_DELIVERY || "smtp";
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
let mailTransport;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");
}
if (isProduction) app.set("trust proxy", 1);

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "wise.db");
let db;
const adventureIds = new Set(["adv-001", "adv-002", "adv-003"]);

const dbReady = initSqlJs().then((SQL) => {
  const existing = fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined;
  db = new SQL.Database(existing);
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const userColumns = db.exec("PRAGMA table_info(users)")[0]?.values.map(row => row[1]) || [];
  if (!userColumns.includes("email_verified")) {
    db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1");
  }
  if (!userColumns.includes("google_sub")) {
    db.run("ALTER TABLE users ADD COLUMN google_sub TEXT");
  }
  if (!userColumns.includes("auth_version")) {
    db.run("ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0");
  }
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL");
  db.run(`CREATE TABLE IF NOT EXISTS adventure_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    adventure_id TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, adventure_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS email_action_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  persistDatabase();
  return db;
});

function persistDatabase() {
  if (!db) return;
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

async function ensureDatabase() {
  await dbReady;
  return db;
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(session({
  name: "wise.sid",
  secret: sessionSecret,
  store: new FileStore({ path: dataDir, ttl: 60 * 60 * 24, logFn: () => {} }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
    path: "/"
  }
}));

async function dbGet(sql, params = []) {
  const database = await ensureDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    if (!stmt.step()) return null;
    return stmt.getAsObject();
  } finally {
    stmt.free();
  }
}
async function dbAll(sql, params = []) {
  const database = await ensureDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}
async function dbRun(sql, params = []) {
  const database = await ensureDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    const row = database.exec("SELECT last_insert_rowid() AS lastID");
    persistDatabase();
    return {
      lastID: Number(row[0]?.values?.[0]?.[0] ?? 0),
      changes: typeof database.getRowsModified === "function" ? database.getRowsModified() : 1
    };
  } finally {
    stmt.free();
  }
}
async function dbDeleteUser(userId) {
  const database = await ensureDatabase();
  database.run("BEGIN TRANSACTION");
  try {
    database.run("DELETE FROM users WHERE id = ?", [userId]);
    const changes = database.getRowsModified();
    if (changes !== 1) {
      database.run("ROLLBACK");
      return false;
    }
    database.run("COMMIT");
    persistDatabase();
    return true;
  } catch (err) {
    database.run("ROLLBACK");
    throw err;
  }
}
function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function requireCsrf(req, res, next) {
  if (!safeEqual(req.get("X-CSRF-Token"), req.session.csrfToken)) {
    return res.status(403).json({ error: "Security token expired. Refresh and try again." });
  }
  next();
}
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  dbGet("SELECT auth_version FROM users WHERE id = ?", [req.session.userId])
    .then(user => {
      const sessionVersionMismatch = req.session.authVersion === undefined
        ? user && user.auth_version !== 0
        : user && req.session.authVersion !== user.auth_version;
      if (!user || sessionVersionMismatch) {
        return req.session.destroy(err => {
          if (err) console.error("Expired session cleanup error:", err.message);
          res.status(401).json({ error: "Your session has expired. Please sign in again." });
        });
      }
      req.session.authVersion = user.auth_version;
      next();
    })
    .catch(err => {
      console.error("Session validation error:", err.message);
      res.status(500).json({ error: "Could not validate your session." });
    });
}
function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}
function getMailTransport() {
  if (emailDelivery === "console" && !isProduction) return null;
  if (!smtpConfigured) throw new Error("Configure SMTP_HOST and SMTP_FROM to send account emails.");
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
        : undefined
    });
  }
  return mailTransport;
}
async function sendAccountEmail(to, subject, text) {
  const transport = getMailTransport();
  if (!transport) {
    console.info(`[development email] to=${to} subject=${subject}\n${text}`);
    return;
  }
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
async function createEmailActionToken(userId, purpose) {
  const database = await ensureDatabase();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const ttl = purpose === "verify" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  database.run("DELETE FROM email_action_tokens WHERE expires_at <= ?", [now]);
  database.run("DELETE FROM email_action_tokens WHERE user_id = ? AND purpose = ?", [userId, purpose]);
  database.run(
    "INSERT INTO email_action_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [hashToken(token), userId, purpose, now + ttl, now]
  );
  persistDatabase();
  return token;
}
async function consumeEmailActionToken(token, purpose) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const database = await ensureDatabase();
  const row = await dbGet(
    "SELECT user_id FROM email_action_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?",
    [hashToken(token), purpose, Date.now()]
  );
  if (!row) return null;
  database.run("BEGIN TRANSACTION");
  try {
    database.run("DELETE FROM email_action_tokens WHERE token_hash = ?", [hashToken(token)]);
    if (database.getRowsModified() !== 1) {
      database.run("ROLLBACK");
      return null;
    }
    if (purpose === "verify") {
      database.run("UPDATE users SET email_verified = 1 WHERE id = ?", [row.user_id]);
    } else {
      database.run("DELETE FROM email_action_tokens WHERE user_id = ? AND purpose = 'reset'", [row.user_id]);
    }
    database.run("COMMIT");
    persistDatabase();
    return { userId: row.user_id };
  } catch (err) {
    database.run("ROLLBACK");
    throw err;
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." }
});
const accountDeletionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many deletion attempts. Please wait 15 minutes and try again." }
});
const emailActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before trying again." }
});

// Serve only public site files. Database, source and environment files are never static assets.
const publicFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/script.js": "script.js",
  "/login.html": "login.html",
  "/auth.css": "auth.css",
  "/auth.js": "auth.js"
};
for (const [route, file] of Object.entries(publicFiles)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
}

app.get("/api/csrf", (req, res) => {
  res.set("Cache-Control", "no-store");
  const csrfToken = req.session.csrfToken || createCsrfToken(req);
  res.json({ csrfToken });
});

app.get("/api/auth/providers", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ google: Boolean(googleOAuth) });
});

app.get("/auth/google", async (req, res, next) => {
  if (!googleOAuth) return res.status(503).send("Google sign-in is not configured.");
  try {
    const state = crypto.randomBytes(32).toString("hex");
    req.session.googleOAuthState = state;
    req.session.googleOAuthStateCreatedAt = Date.now();
    await saveSession(req);
    const url = googleOAuth.generateAuthUrl({
      access_type: "online",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
      state
    });
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

app.get("/auth/google/callback", async (req, res, next) => {
  if (!googleOAuth) return res.redirect("/login.html?error=google");
  const expectedState = req.session.googleOAuthState;
  const stateCreatedAt = req.session.googleOAuthStateCreatedAt;
  delete req.session.googleOAuthState;
  delete req.session.googleOAuthStateCreatedAt;
  if (
    !safeEqual(req.query.state, expectedState) ||
    typeof stateCreatedAt !== "number" ||
    Date.now() - stateCreatedAt > 10 * 60 * 1000 ||
    typeof req.query.code !== "string"
  ) {
    return res.redirect("/login.html?error=oauth_state");
  }
  try {
    const { tokens } = await googleOAuth.getToken(req.query.code);
    if (!tokens.id_token) return res.redirect("/login.html?error=google");
    const ticket = await googleOAuth.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId
    });
    const profile = ticket.getPayload();
    if (!profile || profile.email_verified !== true || !profile.email || !profile.sub) {
      return res.redirect("/login.html?error=google_email");
    }
    const email = profile.email.trim().toLowerCase();
    let user = await dbGet("SELECT id, name, email, google_sub, auth_version FROM users WHERE google_sub = ?", [profile.sub]);
    if (!user) {
      const matchingUser = await dbGet("SELECT id, name, email, google_sub, auth_version FROM users WHERE email = ?", [email]);
      if (matchingUser && matchingUser.google_sub && matchingUser.google_sub !== profile.sub) {
        return res.redirect("/login.html?error=google_link");
      }
      if (matchingUser) {
        await dbRun("UPDATE users SET google_sub = ?, email_verified = 1 WHERE id = ?", [profile.sub, matchingUser.id]);
        user = { ...matchingUser, google_sub: profile.sub };
      } else {
        const created = await dbRun(
          "INSERT INTO users (name, email, password_hash, email_verified, google_sub) VALUES (?, ?, '', 1, ?)",
          [(profile.name || email.split("@")[0]).trim().slice(0, 80) || "Adventurer", email, profile.sub]
        );
        user = { id: created.lastID, name: profile.name || email.split("@")[0], email, auth_version: 0 };
      }
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.authVersion = user.auth_version || 0;
    createCsrfToken(req);
    await saveSession(req);
    res.redirect("/");
  } catch (err) {
    console.error("Google sign-in error:", err.message);
    res.redirect("/login.html?error=google");
  }
});

app.post("/api/resend-verification", emailActionLimiter, requireCsrf, async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = await dbGet("SELECT id, name, email FROM users WHERE email = ? AND email_verified = 0", [email]);
      if (user) {
        const token = await createEmailActionToken(user.id, "verify");
        const link = `${appUrl}/login.html?mode=verify&token=${encodeURIComponent(token)}`;
        await sendAccountEmail(user.email, "Verify your WSE Adventures email", `Hi ${user.name},\n\nVerify your email address:\n${link}\n\nThis link expires in 24 hours.`);
      }
    }
    res.json({ message: "If an unverified account exists for that address, a verification email has been sent." });
  } catch (err) {
    console.error("Verification email error:", err.message);
    res.status(503).json({ error: "Could not send the verification email. Please try again later." });
  }
});

app.post("/api/verify-email", emailActionLimiter, requireCsrf, async (req, res) => {
  try {
    const result = await consumeEmailActionToken(req.body?.token, "verify");
    if (!result) return res.status(400).json({ error: "This verification link is invalid or has expired. Request a new one." });
    res.json({ message: "Email verified. You can now sign in." });
  } catch (err) {
    console.error("Email verification error:", err.message);
    res.status(500).json({ error: "Could not verify your email." });
  }
});

app.post("/api/forgot-password", emailActionLimiter, requireCsrf, async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = await dbGet("SELECT id, name, email FROM users WHERE email = ? AND email_verified = 1", [email]);
      if (user) {
        const token = await createEmailActionToken(user.id, "reset");
        const link = `${appUrl}/login.html?mode=reset&token=${encodeURIComponent(token)}`;
        await sendAccountEmail(user.email, "Reset your WSE Adventures password", `Hi ${user.name},\n\nReset your password:\n${link}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`);
      }
    }
    res.json({ message: "If a verified account exists for that address, a password-reset email has been sent." });
  } catch (err) {
    console.error("Password reset email error:", err.message);
    res.status(503).json({ error: "Could not send the password-reset email. Please try again later." });
  }
});

app.post("/api/reset-password", emailActionLimiter, requireCsrf, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 12 and 128 characters." });
    }
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({ error: "This password-reset link is invalid or has expired." });
    }
    const database = await ensureDatabase();
    const row = await dbGet(
      "SELECT user_id FROM email_action_tokens WHERE token_hash = ? AND purpose = 'reset' AND expires_at > ?",
      [hashToken(token), Date.now()]
    );
    if (!row) return res.status(400).json({ error: "This password-reset link is invalid or has expired." });
    const passwordHash = await bcrypt.hash(password, 12);
    database.run("BEGIN TRANSACTION");
    try {
      database.run("DELETE FROM email_action_tokens WHERE token_hash = ? AND purpose = 'reset'", [hashToken(token)]);
      if (database.getRowsModified() !== 1) {
        database.run("ROLLBACK");
        return res.status(400).json({ error: "This password-reset link is invalid or has expired." });
      }
      database.run("UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?", [passwordHash, row.user_id]);
      database.run("DELETE FROM email_action_tokens WHERE user_id = ? AND purpose = 'reset'", [row.user_id]);
      database.run("COMMIT");
      persistDatabase();
    } catch (err) {
      database.run("ROLLBACK");
      throw err;
    }
    res.json({ message: "Password reset successfully. Sign in with your new password." });
  } catch (err) {
    console.error("Password reset error:", err.message);
    res.status(500).json({ error: "Could not reset your password." });
  }
});

app.post("/api/register", authLimiter, requireCsrf, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Enter your name, email and password." });
    }
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ error: "Name must be between 2 and 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 12 and 128 characters." });
    }
    if (!smtpConfigured && (isProduction || emailDelivery !== "console")) {
      return res.status(503).json({ error: "Email verification is not configured. Please contact the site administrator." });
    }
    const existing = await dbGet("SELECT id FROM users WHERE email = ?", [cleanEmail]);
    if (existing) return res.status(409).json({ error: "An account with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await dbRun(
      "INSERT INTO users (name, email, password_hash, email_verified) VALUES (?, ?, ?, 0)",
      [cleanName, cleanEmail, passwordHash]
    );
    const token = await createEmailActionToken(created.lastID, "verify");
    const link = `${appUrl}/login.html?mode=verify&token=${encodeURIComponent(token)}`;
    try {
      await sendAccountEmail(cleanEmail, "Verify your WSE Adventures email", `Hi ${cleanName},\n\nVerify your email address:\n${link}\n\nThis link expires in 24 hours.`);
    } catch (err) {
      console.error("Verification email delivery error:", err.message);
      return res.status(503).json({ error: "Account created, but the verification email could not be sent. Try resending it or contact support." });
    }
    res.status(201).json({ message: "Account created. Check your email to verify your address before signing in." });
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    console.error("Registration error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/api/login", authLimiter, requireCsrf, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: "Enter a valid email and password." });
    }
    const user = await dbGet(
      "SELECT id, name, email, password_hash, email_verified, auth_version FROM users WHERE email = ?",
      [email.trim().toLowerCase()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: "Verify your email address before signing in. You can request another verification email." });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.authVersion = user.auth_version || 0;
    const csrfToken = createCsrfToken(req);
    await saveSession(req);
    res.json({ user: cleanUser(user), csrfToken });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.get("/api/me", requireLogin, async (req, res) => {
  try {
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Account not found. Please sign in again." });
    }
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    console.error("Account lookup error:", err.message);
    res.status(500).json({ error: "Could not load account details." });
  }
});

app.patch("/api/me", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== "string") {
      return res.status(400).json({ error: "Enter a valid display name." });
    }
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ error: "Display name must be between 2 and 80 characters." });
    }
    await dbRun(
      "UPDATE users SET name = ? WHERE id = ?",
      [cleanName, req.session.userId]
    );
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    res.json({ user });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ error: "Could not update your profile." });
  }
});

app.delete("/api/me", accountDeletionLimiter, requireLogin, requireCsrf, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 1 || password.length > 128) {
      return res.status(400).json({ error: "Enter your current password to delete your account." });
    }
    const user = await dbGet(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.session.userId]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (!(await dbDeleteUser(req.session.userId))) {
      return res.status(401).json({ error: "Account not found. Please sign in again." });
    }
    req.session.destroy(err => {
      if (err) {
        console.error("Account deletion session error:", err.message);
        return res.status(500).json({ error: "Account deleted, but the session could not be cleared. Please close this browser." });
      }
      res.clearCookie("wise.sid", {
        httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
      });
      res.json({ message: "Account deleted successfully." });
    });
  } catch (err) {
    console.error("Account deletion error:", err.message);
    res.status(500).json({ error: "Could not delete your account." });
  }
});

app.get("/api/progress", requireLogin, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT adventure_id FROM adventure_progress WHERE user_id = ? AND completed = 1",
      [req.session.userId]
    );
    res.set("Cache-Control", "no-store");
    res.json({ completedAdventureIds: rows.map(row => row.adventure_id) });
  } catch (err) {
    console.error("Progress lookup error:", err.message);
    res.status(500).json({ error: "Could not load adventure progress." });
  }
});

app.put("/api/progress/:adventureId", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { adventureId } = req.params;
    const { completed } = req.body || {};
    if (!adventureIds.has(adventureId) || typeof completed !== "boolean") {
      return res.status(400).json({ error: "Choose a valid adventure and completion status." });
    }
    await dbRun(
      `INSERT INTO adventure_progress (user_id, adventure_id, completed)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, adventure_id) DO UPDATE SET
         completed = excluded.completed,
         updated_at = CURRENT_TIMESTAMP`,
      [req.session.userId, adventureId, completed ? 1 : 0]
    );
    res.json({ adventureId, completed });
  } catch (err) {
    console.error("Progress update error:", err.message);
    res.status(500).json({ error: "Could not save adventure progress." });
  }
});

app.post("/api/logout", requireLogin, requireCsrf, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Could not log out. Please try again." });
    res.clearCookie("wise.sid", {
      httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
    });
    res.json({ message: "Logged out successfully." });
  });
});

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
app.use((req, res) => res.status(404).send("Page not found."));
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("Wse Adventures running on port " + port));
