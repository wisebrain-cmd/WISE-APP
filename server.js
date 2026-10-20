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

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");
}
if (isProduction) app.set("trust proxy", 1);

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "wise.db");
let db;

const dbReady = initSqlJs().then((SQL) => {
  const existing = fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined;
  db = new SQL.Database(existing);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
async function dbRun(sql, params = []) {
  const database = await ensureDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    const row = database.exec("SELECT last_insert_rowid() AS lastID");
    persistDatabase();
    return { lastID: Number(row[0]?.values?.[0]?.[0] ?? 0) };
  } finally {
    stmt.free();
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
