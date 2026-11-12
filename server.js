require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const settingsModel = require("./settings-model");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");
}
if (isProduction) app.set("trust proxy", 1);

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, "wise.db"));
const sessionDb = new sqlite3.Database(path.join(dataDir, "sessions.db"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    settings TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

app.use(session({
  name: "wise.sid",
  secret: sessionSecret,
  store: new SQLiteStore({ db: "sessions.db", dir: dataDir }),
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

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID });
    });
  });
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
  next();
}
function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." }
});

// Serve only public site files. Database, source and environment files are never static assets.
const publicFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/script.js": "script.js",
  "/login.html": "login.html",
  "/auth.css": "auth.css",
  "/auth.js": "auth.js",
  "/settings.css": "settings.css",
  "/settings.js": "settings.js",
  "/settings-model.js": "settings-model.js"
};
for (const [route, file] of Object.entries(publicFiles)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file), { dotfiles: "allow" }));
}
app.get("/settings.html", (req, res) => res.redirect("/settings"));
app.get("/settings", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html?next=%2Fsettings");
  res.sendFile(path.join(__dirname, "settings.html"), { dotfiles: "allow" });
});

app.get("/api/csrf", (req, res) => {
  res.set("Cache-Control", "no-store");
  const csrfToken = req.session.csrfToken || createCsrfToken(req);
  res.json({ csrfToken });
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
    const existing = await dbGet("SELECT id FROM users WHERE email = ?", [cleanEmail]);
    if (existing) return res.status(409).json({ error: "An account with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await dbRun(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [cleanName, cleanEmail, passwordHash]
    );
    await regenerateSession(req);
    req.session.userId = created.lastID;
    const csrfToken = createCsrfToken(req);
    await saveSession(req);
    res.status(201).json({ user: { id: created.lastID, name: cleanName, email: cleanEmail }, csrfToken });
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
      "SELECT id, name, email, password_hash FROM users WHERE email = ?",
      [email.trim().toLowerCase()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
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

app.get("/api/session", async (req, res) => {
  if (!req.session.userId) {
    res.set("Cache-Control", "no-store");
    return res.json({ user: null });
  }
  try {
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    if (!user) {
      req.session.destroy(() => {});
      res.set("Cache-Control", "no-store");
      return res.json({ user: null });
    }
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    console.error("Session account lookup error:", err.message);
    res.status(500).json({ error: "Could not load account details." });
  }
});

app.get("/api/settings", requireLogin, async (req, res) => {
  try {
    const row = await dbGet("SELECT settings FROM user_settings WHERE user_id = ?", [req.session.userId]);
    const saved = row ? JSON.parse(row.settings) : {};
    res.set("Cache-Control", "no-store");
    res.json({ settings: settingsModel.mergeSettings(saved) });
  } catch (err) {
    console.error("Settings load error:", err.message);
    res.status(500).json({ error: "Could not load your settings." });
  }
});

app.put("/api/settings", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { category, key, value } = req.body || {};
    if (typeof category !== "string" || typeof key !== "string") {
      return res.status(400).json({ error: "Choose a valid setting to update." });
    }
    const validationError = settingsModel.validatePreference(category, key, value);
    if (validationError) return res.status(400).json({ error: validationError });

    const settingPath = `$.${category}.${key}`;
    const encodedValue = JSON.stringify(value);
    await dbRun(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES (?, json_set('{}', ?, json(?)), CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         settings = json_set(user_settings.settings, ?, json(?)),
         updated_at = CURRENT_TIMESTAMP`,
      [req.session.userId, settingPath, encodedValue, settingPath, encodedValue]
    );
    const row = await dbGet("SELECT settings FROM user_settings WHERE user_id = ?", [req.session.userId]);
    const settings = settingsModel.mergeSettings(JSON.parse(row.settings));
    res.set("Cache-Control", "no-store");
    res.json({ settings });
  } catch (err) {
    console.error("Settings save error:", err.message);
    res.status(500).json({ error: "Could not save your settings. Please try again." });
  }
});

app.put("/api/account", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (typeof name !== "string" || typeof email !== "string") {
      return res.status(400).json({ error: "Enter your name and email address." });
    }
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ error: "Name must be between 2 and 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    await dbRun("UPDATE users SET name = ?, email = ? WHERE id = ?", [
      cleanName, cleanEmail, req.session.userId
    ]);
    res.json({ user: { id: req.session.userId, name: cleanName, email: cleanEmail } });
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    console.error("Account update error:", err.message);
    res.status(500).json({ error: "Could not update your account." });
  }
});

app.post("/api/password", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" ||
        currentPassword.length > 128 || newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({ error: "Enter your current password and a new password of at least 12 characters." });
    }
    const user = await dbGet("SELECT password_hash FROM users WHERE id = ?", [req.session.userId]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(403).json({ error: "Your current password is incorrect." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.session.userId]);
    res.json({ message: "Your password has been updated." });
  } catch (err) {
    console.error("Password update error:", err.message);
    res.status(500).json({ error: "Could not update your password." });
  }
});

function revokeUserSessions(userId) {
  return new Promise((resolve, reject) => {
    sessionDb.run("DELETE FROM sessions WHERE instr(sess, ?) > 0", [`"userId":${userId}`], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

app.get("/api/sessions", requireLogin, async (req, res) => {
  try {
    const active = await new Promise((resolve, reject) => {
      sessionDb.get(
        "SELECT COUNT(*) AS count FROM sessions WHERE expired > ? AND instr(sess, ?) > 0",
        [Date.now(), `"userId":${req.session.userId}`],
        (err, row) => err ? reject(err) : resolve(row.count)
      );
    });
    res.set("Cache-Control", "no-store");
    res.json({ activeSessions: active });
  } catch (err) {
    console.error("Active sessions lookup error:", err.message);
    res.status(500).json({ error: "Could not load active sessions." });
  }
});

app.post("/api/logout-all", requireLogin, requireCsrf, async (req, res) => {
  try {
    await revokeUserSessions(req.session.userId);
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Could not sign out all devices." });
      res.clearCookie("wise.sid", {
        httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
      });
      res.json({ message: "You have been signed out on all devices." });
    });
  } catch (err) {
    console.error("Sign out all devices error:", err.message);
    res.status(500).json({ error: "Could not sign out all devices." });
  }
});

app.delete("/api/account", requireLogin, requireCsrf, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length > 128) {
      return res.status(400).json({ error: "Enter your password to delete your account." });
    }
    const user = await dbGet("SELECT password_hash FROM users WHERE id = ?", [req.session.userId]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(403).json({ error: "Your password is incorrect." });
    }
    await dbRun("DELETE FROM user_settings WHERE user_id = ?", [req.session.userId]);
    await dbRun("DELETE FROM users WHERE id = ?", [req.session.userId]);
    await revokeUserSessions(req.session.userId);
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Your account was deleted, but sign-out did not complete." });
      res.clearCookie("wise.sid", {
        httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
      });
      res.json({ message: "Your account has been deleted." });
    });
  } catch (err) {
    console.error("Account deletion error:", err.message);
    res.status(500).json({ error: "Could not delete your account." });
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
app.get("/api/app-info", (req, res) => res.json({ version: require("./package.json").version }));

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
app.use((req, res) => res.status(404).send("Page not found."));
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("Wse Adventures running on port " + port));
