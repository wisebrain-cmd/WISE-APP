require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });
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
const {
  AGENTS, approveRun, canRetryRun, cancelRun, createRun, getAnyRun, listAllRuns,
  listRuns, rejectRun, retryRun, runAgentTeam
} = require("./agent-team");
const { startAgentWorker } = require("./agent-worker");
const { getConnectionStatus, listRepositoryFiles } = require("./github-integration");
const { buildOverpassQuery, normalizeOverpassElements, parseMapBounds } = require("./map-location-service");
const { defaults: defaultAppSettings, choices: appSettingChoices } = require("./settings-schema");

const app = express();
const appVersion = require("./package.json").version;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");
}
if (isProduction) app.set("trust proxy", 1);

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "wise.db");
const sessionStore = new FileStore({ path: dataDir, ttl: 60 * 60 * 24, logFn: () => { } });
const sessionStoreQueues = new Map();
const configuredAdminUserIds = new Set((process.env.ADMIN_USER_IDS || "")
  .split(",").map(value => Number(value.trim())).filter(id => Number.isSafeInteger(id) && id > 0));
for (const method of ["get", "set", "touch", "destroy"]) {
  const original = sessionStore[method].bind(sessionStore);
  sessionStore[method] = (sessionId, ...args) => {
    const callback = args.pop();
    const previous = sessionStoreQueues.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => new Promise(resolve => {
      try {
        original(sessionId, ...args, (...result) => {
          try { callback?.(...result); }
          finally { resolve(); }
        });
      } catch (error) {
        try { callback?.(error); }
        finally { resolve(); }
      }
    }));
    sessionStoreQueues.set(sessionId, next);
    const release = () => { if (sessionStoreQueues.get(sessionId) === next) sessionStoreQueues.delete(sessionId); };
    next.then(release, release);
  };
}
let db;

const dbReady = initSqlJs().then((SQL) => {
  const existing = fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined;
  db = new SQL.Database(existing);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    profile_image TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active'
  )`);
  const userColumns = db.exec("PRAGMA table_info(users)")[0]?.values.map(row => row[1]) || [];
  if (!userColumns.includes("profile_image")) db.run("ALTER TABLE users ADD COLUMN profile_image TEXT");
  if (!userColumns.includes("role")) db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  if (!userColumns.includes("status")) db.run("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system',
    accent TEXT NOT NULL DEFAULT 'sage',
    font_size TEXT NOT NULL DEFAULT 'standard',
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    date_format TEXT NOT NULL DEFAULT 'iso',
    time_format TEXT NOT NULL DEFAULT '24h',
    provider TEXT NOT NULL DEFAULT 'hybrid',
    enabled_agents TEXT NOT NULL DEFAULT '[]',
    approval_required INTEGER NOT NULL DEFAULT 1
  )`);
  const preferenceColumns = db.exec("PRAGMA table_info(user_preferences)")[0]?.values.map(row => row[1]) || [];
  if (!preferenceColumns.includes("provider")) db.run("ALTER TABLE user_preferences ADD COLUMN provider TEXT NOT NULL DEFAULT 'hybrid'");
  db.run(`CREATE TABLE IF NOT EXISTS active_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT NOT NULL DEFAULT ''
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS user_app_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS user_search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS place_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (location_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS place_photos (
    location_id TEXT PRIMARY KEY,
    image_data TEXT NOT NULL,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const placePhotoColumns = db.exec("PRAGMA table_info(place_photos)")[0]?.values.map(row => row[1]) || [];
  if (!placePhotoColumns.includes("owner_user_id")) {
    db.run("ALTER TABLE place_photos ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  }
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('security', 'account', 'agents', 'admin', 'system', 'general')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    href TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id, id DESC)");
  db.run("CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications(user_id, read_at)");
  db.run(`CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run("CREATE INDEX IF NOT EXISTS activity_user_created ON activity_events(user_id, id DESC)");
  db.run("CREATE INDEX IF NOT EXISTS activity_created ON activity_events(id DESC)");
  db.run("UPDATE users SET role = 'user' WHERE role = 'admin'");
  for (const userId of configuredAdminUserIds) {
    db.run("UPDATE users SET role = 'admin' WHERE id = ?", [userId]);
  }
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "img-src": ["'self'", "data:", "https://tile.openstreetmap.de", "https://server.arcgisonline.com", "https://images.unsplash.com", "https://upload.wikimedia.org", "https://thumb.wikimedia.org"],
      "connect-src": ["'self'", "https://tile.openstreetmap.de", "https://server.arcgisonline.com"],
      "worker-src": ["'self'", "blob:"]
    }
  }
}));
app.use(express.json({ limit: "512kb" }));

app.use(session({
  name: "wise.sid",
  secret: sessionSecret,
  store: sessionStore,
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
  dbGet("SELECT id, name, email, role, status, created_at AS createdAt FROM users WHERE id = ?", [req.session.userId])
    .then(async user => {
      if (!user || user.status !== "active") {
        sessionActivityCache.delete(req.sessionID);
        req.session.destroy(error => {
          if (error) console.error("Inactive session cleanup error:", error.message);
        });
        return res.status(user ? 403 : 401).json({ error: user ? "This account is inactive." : "Account not found. Please sign in again." });
      }
      req.authUser = user;
      await recordActiveSession(req, user.id);
      next();
    })
    .catch(error => {
      console.error("Active session tracking error:", error.message);
      res.status(500).json({ error: "Could not verify your signed-in session." });
    });
}
function requireAdmin(req, res, next) {
  if (req.authUser?.role !== "admin") return res.status(403).json({ error: "Administrator access is required." });
  next();
}
function requireAdminPage(req, res, next) {
  if (req.authUser?.role !== "admin") {
    return res.status(403).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied | WSE Adventures</title><link rel="stylesheet" href="/platform.css"></head><body><main class="platform-shell"><section class="platform-card"><p class="platform-eyebrow">ACCOUNT ACCESS</p><h1 class="platform-title">Administrator access required</h1><p class="platform-lead">This area is only available to authorized WSE Adventures administrators.</p><p><a class="platform-button" href="/dashboard">Return to your dashboard</a></p></section></main></body></html>`);
  }
  next();
}
function requirePageLogin(req, res, next) {
  if (!req.session.userId) return res.redirect(`/login.html?next=${encodeURIComponent(req.path)}`);
  requireLogin(req, res, next);
}
function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function cleanUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    ...(user.profileImage ? { profileImage: user.profileImage } : {}),
    ...(user.role ? { role: user.role } : {}),
    ...(user.status ? { status: user.status } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt } : {})
  };
}

const notificationCategories = new Set(["security", "account", "agents", "admin", "system", "general"]);

async function createNotification({ userId, category, title, message, href = null }) {
  if (!Number.isInteger(Number(userId)) || !notificationCategories.has(category)
    || typeof title !== "string" || !title.trim() || title.length > 120
    || typeof message !== "string" || !message.trim() || message.length > 500) {
    throw new Error("Notification data is invalid.");
  }
  const safeHref = typeof href === "string" && href.startsWith("/") && !href.startsWith("//")
    && !href.includes("\\") && !/[\u0000-\u001f\u007f]/.test(href) ? href.slice(0, 300) : null;
  await dbRun(
    "INSERT INTO notifications (user_id, category, title, message, href) VALUES (?, ?, ?, ?, ?)",
    [Number(userId), category, title.trim(), message.trim(), safeHref]
  );
}

async function recordActivity({ userId = null, actorUserId = null, eventType, status = "success", description }) {
  await dbRun(
    "INSERT INTO activity_events (user_id, actor_user_id, event_type, status, description) VALUES (?, ?, ?, ?, ?)",
    [userId, actorUserId, eventType, status, description]
  );
}

function readAgentRuns() {
  const filePath = path.join(dataDir, "agent-runs.json");
  if (!fs.existsSync(filePath)) return [];
  const runs = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(runs)) throw new Error("Agent activity storage is invalid.");
  return runs;
}

async function agentNotificationsEnabled(userId) {
  try {
    const settings = await getAppSettings(userId);
    return settings.notifications.agentNotifications !== false;
  } catch (error) {
    console.error("Agent notification preference lookup failed:", error.message);
    return false;
  }
}

async function createAgentNotification(userId, notification) {
  if (await agentNotificationsEnabled(userId)) {
    await createNotification({ userId, category: "agents", ...notification });
  }
}

async function notifyAgentAdmins(notification) {
  const admins = await dbAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  await Promise.all(admins.map(admin => createAgentNotification(admin.id, notification)));
}

async function notifyAgentRunStarted(run) {
  if (!run?.userId) return;
  await recordActivity({
    userId: run.userId, actorUserId: run.approvedBy || run.userId,
    eventType: "agent.run.started", description: "An AI agent task started processing."
  });
  await createAgentNotification(run.userId, {
    title: "Agent task started",
    message: "Your approved agent task is now being processed.",
    href: "/agents"
  });
}

async function notifyAgentRun(run, completed = false) {
  if (!run?.userId) return;
  if (!completed) {
    await recordActivity({
      userId: run.userId, actorUserId: run.userId, eventType: "agent.run.created",
      description: "An AI agent task was created."
    });
    await createAgentNotification(run.userId, {
      title: run.status === "awaiting_approval" ? "Approval requested" : "Agent task queued",
      message: run.status === "awaiting_approval" ? "Review and approve your agent task to begin." : "Your agent task has been queued.",
      href: "/agents"
    });
    if (run.status === "awaiting_approval") {
      await notifyAgentAdmins({
        title: "Agent approval requested",
        message: "A user submitted an agent task for approval.",
        href: "/admin/agents"
      });
    }
    return;
  }
  const failed = run.status === "failed" || run.status === "completed_with_errors";
  await recordActivity({
    userId: run.userId, actorUserId: run.approvedBy || run.userId,
    eventType: failed ? "agent.run.failed" : "agent.run.completed",
    status: run.status === "failed" ? "error" : failed ? "warning" : "success",
    description: failed ? "An AI agent run finished with provider errors." : "An AI agent run completed."
  });
  await createAgentNotification(run.userId, {
    title: failed ? "Agent run needs attention" : "Agent run completed",
    message: failed ? `${run.results.filter(result => result.failed).length} agent(s) could not complete. Review the task for details.` : "Your agent task has finished.",
    href: "/agents"
  });
  if (failed) {
    await notifyAgentAdmins({
      title: "Agent run failed",
      message: "An agent task encountered provider or execution errors. Review the control center.",
      href: "/admin/agents"
    });
  }
}

function redactAgentText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{12,})\b/g, "[redacted]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*(['"]?)[^\s,;'"`]+/gi, "$1=[redacted]");
}

const DEFAULT_ENABLED_AGENTS = AGENTS.map(agent => agent.id);
const sessionActivityCache = new Map();
const allowedTimeZones = new Set([
  "UTC", "Atlantic/Reykjavik", "Europe/London", "Europe/Paris",
  "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"
]);
const allowedThemes = new Set(["light", "dark", "system"]);
const allowedAccents = new Set(["sage", "terracotta", "ocean", "plum"]);
const allowedFontSizes = new Set(["compact", "standard", "large"]);
const allowedDateFormats = new Set(["iso", "dmy", "mdy"]);
const allowedTimeFormats = new Set(["12h", "24h"]);
const allowedAgentProviders = new Set(["hybrid", "openai", "huggingface"]);

async function getPreferences(userId) {
  let preferences = await dbGet("SELECT * FROM user_preferences WHERE user_id = ?", [userId]);
  if (!preferences) {
    await dbRun("INSERT OR IGNORE INTO user_preferences (user_id, enabled_agents) VALUES (?, ?)", [userId, JSON.stringify(DEFAULT_ENABLED_AGENTS)]);
    preferences = await dbGet("SELECT * FROM user_preferences WHERE user_id = ?", [userId]);
  }
  let enabledAgents = DEFAULT_ENABLED_AGENTS;
  try {
    const parsed = JSON.parse(preferences.enabled_agents);
    if (Array.isArray(parsed)) {
      const selected = DEFAULT_ENABLED_AGENTS.filter(id => parsed.includes(id));
      if (selected.length) enabledAgents = selected;
    }
  } catch { /* Migrate malformed legacy preference values to defaults in memory. */ }
  return {
    theme: preferences.theme,
    accent: preferences.accent,
    fontSize: preferences.font_size,
    timeZone: preferences.time_zone,
    dateFormat: preferences.date_format,
    timeFormat: preferences.time_format,
    provider: preferences.provider || "hybrid",
    enabledAgents,
    approvalRequired: Boolean(preferences.approval_required)
  };
}

function mergeAppSettings(current, patch) {
  const next = structuredClone(current);
  for (const [section, values] of Object.entries(patch)) {
    for (const [key, value] of Object.entries(values)) next[section][key] = value;
  }
  return next;
}

function validateAppSettingsPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) {
    return "Settings must be a non-empty object.";
  }
  for (const [section, values] of Object.entries(input)) {
    if (!Object.hasOwn(defaultAppSettings, section) || !values || typeof values !== "object" || Array.isArray(values)) {
      return "Choose a supported settings category.";
    }
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(defaultAppSettings[section], key)) return "Choose a supported setting.";
      const pathKey = `${section}.${key}`;
      const allowed = appSettingChoices[pathKey];
      if (allowed && (typeof value !== "string" || !allowed.includes(value))) return `Choose a supported value for ${key}.`;
      if (typeof defaultAppSettings[section][key] === "boolean" && typeof value !== "boolean") return `${key} must be on or off.`;
      if (typeof defaultAppSettings[section][key] === "number"
        && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
        return `${key} must be between 0 and 100.`;
      }
      if (typeof defaultAppSettings[section][key] === "string" && !allowed
        && (typeof value !== "string" || value.length > (key.endsWith("Location") || key === "customPlaces" ? 2000 : 200))) {
        return `${key} must be valid text within the allowed length.`;
      }
    }
  }
  return null;
}

async function getAppSettings(userId) {
  const row = await dbGet("SELECT settings_json AS settingsJson FROM user_app_settings WHERE user_id = ?", [userId]);
  if (!row) {
    const settings = structuredClone(defaultAppSettings);
    const legacy = await getPreferences(userId);
    settings.appearance.theme = legacy.theme;
    settings.appearance.accent = legacy.accent;
    settings.appearance.fontSize = legacy.fontSize;
    settings.appearance.timeZone = legacy.timeZone;
    settings.appearance.dateFormat = legacy.dateFormat;
    settings.appearance.timeFormat = legacy.timeFormat;
    return settings;
  }
  let stored;
  try {
    stored = JSON.parse(row.settingsJson);
  } catch {
    throw new Error("Saved settings could not be read.");
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Saved settings have an invalid format.");
  const merged = structuredClone(defaultAppSettings);
  for (const [section, values] of Object.entries(stored)) {
    if (!Object.hasOwn(merged, section) || !values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (Object.hasOwn(merged[section], key) && !validateAppSettingsPatch({ [section]: { [key]: value } })) merged[section][key] = value;
    }
  }
  return merged;
}

async function recordActiveSession(req, userId, force = false) {
  const lastRecorded = sessionActivityCache.get(req.sessionID) || 0;
  if (!force && Date.now() - lastRecorded < 5 * 60 * 1000) return;
  await dbRun(`INSERT INTO active_sessions (session_id, user_id, user_agent)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id, last_active = CURRENT_TIMESTAMP,
    user_agent = CASE WHEN active_sessions.user_agent = '' THEN excluded.user_agent ELSE active_sessions.user_agent END`,
  [req.sessionID, userId, String(req.get("User-Agent") || "").slice(0, 200)]);
  sessionActivityCache.set(req.sessionID, Date.now());
}

function listStoredSessionFiles() {
  return new Promise((resolve, reject) => sessionStore.list((error, files) => error ? reject(error) : resolve(files)));
}

function readStoredSession(sessionId) {
  return new Promise(resolve => sessionStore.get(sessionId, (error, value) => resolve(error ? null : value)));
}

async function discoverUserSessions(userId) {
  const files = await listStoredSessionFiles();
  const extension = sessionStore.options.fileExtension;
  for (const file of files) {
    const sessionId = file.endsWith(extension) ? file.slice(0, -extension.length) : file;
    const stored = await readStoredSession(sessionId);
    if (!stored || stored.userId !== userId) continue;
    const activeAt = Number.isFinite(stored.__lastAccess) ? new Date(stored.__lastAccess).toISOString().replace("T", " ").slice(0, 19) : new Date().toISOString().replace("T", " ").slice(0, 19);
    await dbRun(`INSERT OR IGNORE INTO active_sessions
      (session_id, user_id, created_at, last_active, user_agent)
      VALUES (?, ?, ?, ?, ?)`, [sessionId, userId, activeAt, activeAt, "Existing signed-in session"]);
  }
}

function destroyStoredSession(sessionId) {
  return new Promise((resolve, reject) => sessionStore.destroy(sessionId, error => {
    if (error) return reject(error);
    sessionActivityCache.delete(sessionId);
    resolve();
  }));
}

function removeUserAgentRuns(userId) {
  const filePath = path.join(dataDir, "agent-runs.json");
  if (!fs.existsSync(filePath)) return;
  const runs = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(runs)) throw new Error("Agent activity storage is invalid.");
  const remaining = runs.filter(run => run.userId !== userId);
  if (remaining.length === runs.length) return;
  const temporaryPath = filePath + ".settings-tmp";
  fs.writeFileSync(temporaryPath, JSON.stringify(remaining, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function validateProfileImage(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 360000) return undefined;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 256 * 1024) return undefined;
  const isPng = match[1] === "png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === "jpeg" && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = match[1] === "webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return isPng || isJpeg || isWebp ? value : undefined;
}

const agentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many agent requests. Please wait before trying again." }
});

const agentControlLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many agent control requests. Please wait before trying again." }
});

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
  "/favicon.ico": "favicon.svg",
  "/favicon.svg": "favicon.svg",
  "/styles.css": "styles.css",
  "/script.js": "script.js",
  "/preferences.js": "preferences.js",
  "/settings.css": "settings.css",
  "/settings.js": "settings.js",
  "/settings-schema.js": "settings-schema.js",
  "/platform.css": "platform.css",
  "/dashboard.js": "dashboard.js",
  "/admin-dashboard.js": "admin-dashboard.js",
  "/agent-control.js": "agent-control.js",
  "/notifications-center.js": "notifications-center.js",
  "/notifications-widget.js": "notifications-widget.js",
  "/map-ui.js": "map-ui.js",
  "/places.css": "places.css",
  "/places.js": "places.js",
  "/location.css": "location.css",
  "/location.js": "location.js",
  "/maplibre-loader.mjs": "maplibre-loader.mjs",
  "/locations.json": "locations.json",
  "/login.html": "login.html",
  "/auth.css": "auth.css",
  "/auth.js": "auth.js",
  "/safe-redirect.js": "safe-redirect.js",
  "/agents.css": "agents.css",
  "/agents.js": "agents.js"
};
const vendorFiles = {
  "/vendor/leaflet.css": ["leaflet", "dist/leaflet.css"],
  "/vendor/leaflet.js": ["leaflet", "dist/leaflet.js"],
  "/vendor/markercluster.css": ["leaflet.markercluster", "dist/MarkerCluster.css"],
  "/vendor/markercluster-default.css": ["leaflet.markercluster", "dist/MarkerCluster.Default.css"],
  "/vendor/markercluster.js": ["leaflet.markercluster", "dist/leaflet.markercluster.js"],
  "/vendor/maplibre-gl.css": ["maplibre-gl", "dist/maplibre-gl.css"],
  "/vendor/maplibre-gl.mjs": ["maplibre-gl", "dist/maplibre-gl.mjs"],
  "/vendor/maplibre-gl-worker.mjs": ["maplibre-gl", "dist/maplibre-gl-worker.mjs"]
};
for (const [route, [packageName, file]] of Object.entries(vendorFiles)) {
  app.get(route, (req, res) => res.sendFile(file, {
    root: path.join(__dirname, "node_modules", packageName)
  }));
}
app.get("/agents", requireLogin, (req, res) => res.sendFile("agents.html", { root: __dirname }));
app.get("/dashboard", requirePageLogin, (req, res) => res.sendFile("dashboard.html", { root: __dirname }));
app.get("/notifications", requirePageLogin, (req, res) => res.sendFile("notifications.html", { root: __dirname }));
app.get("/admin", requirePageLogin, requireAdminPage, (req, res) => res.sendFile("admin.html", { root: __dirname }));
app.get("/admin/agents", requirePageLogin, requireAdminPage, (req, res) => res.sendFile("agent-control.html", { root: __dirname }));
app.get("/settings", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html?next=%2Fsettings");
  res.sendFile("settings.html", { root: __dirname });
});
app.get("/places", (req, res) => res.sendFile("places.html", { root: __dirname }));
app.get("/places/:locationId", (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) return res.status(404).send("Place not found.");
  res.sendFile("location.html", { root: __dirname });
});

for (const [route, file] of Object.entries(publicFiles)) {
  app.get(route, (req, res) => res.sendFile(file, { root: __dirname }));
}

const mapDataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Map data is being requested too often. Please wait and try again." }
});

const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many review updates. Please wait before trying again." }
});

const nearbyLocationsCache = new Map();
const osmPlaceCache = new Map();
const weatherCache = new Map();
const photoSearchCache = new Map();
const locationIdPattern = /^(?:geonames-\d+|osm-(?:node|way|relation)-\d+)$/;
const overpassUrl = process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";
const photoUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many place photo updates. Please wait before trying again." }
});
const photoSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many photo searches. Please wait before trying again." }
});

app.get("/api/locations/nearby", mapDataLimiter, async (req, res) => {
  let boxes;
  try {
    boxes = parseMapBounds(req.query.bbox);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  const cacheKey = JSON.stringify(boxes.map(box => box.map(value => Math.round(value * 100) / 100)));
  const cached = nearbyLocationsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ locations: cached.locations, source: "OpenStreetMap" });
  }
  nearbyLocationsCache.delete(cacheKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(overpassUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "WSE-Adventures/1.0 (OpenStreetMap tourism map)"
      },
      body: new URLSearchParams({ data: buildOverpassQuery(boxes) }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenStreetMap query returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result.elements)) throw new Error("OpenStreetMap returned an invalid place list.");
    const locations = normalizeOverpassElements(result.elements);
    nearbyLocationsCache.set(cacheKey, { locations, expiresAt: Date.now() + 10 * 60 * 1000 });
    if (nearbyLocationsCache.size > 100) {
      const oldestKey = nearbyLocationsCache.keys().next().value;
      nearbyLocationsCache.delete(oldestKey);
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json({ locations, source: "OpenStreetMap" });
  } catch (error) {
    console.error("Nearby map data error:", error.message);
    const timedOut = error.name === "AbortError";
    res.status(timedOut ? 504 : 503).json({
      error: timedOut
        ? "Nearby attraction search timed out. Try again in a moment."
        : "Nearby attraction data is temporarily unavailable. Try again later."
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/api/locations/:locationId/photo", async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) {
    return res.status(400).json({ error: "Invalid location identifier." });
  }
  try {
    const photo = await dbGet(
      "SELECT image_data AS imageData, updated_at AS updatedAt, owner_user_id AS ownerUserId FROM place_photos WHERE location_id = ?",
      [req.params.locationId]
    );
    res.set("Cache-Control", "no-store");
    res.json({
      photo: photo && {
        imageData: photo.imageData,
        updatedAt: photo.updatedAt,
        canManage: Boolean(req.session.userId)
          && (photo.ownerUserId === null || photo.ownerUserId === req.session.userId)
      }
    });
  } catch (error) {
    console.error("Place photo lookup error:", error.message);
    res.status(500).json({ error: "Could not load the place photo." });
  }
});

app.get("/api/locations/:locationId", mapDataLimiter, async (req, res) => {
  const match = req.params.locationId.match(/^osm-(node|way|relation)-(\d+)$/);
  if (!match) return res.status(400).json({ error: "This lookup is only for mapped OpenStreetMap places." });

  const locationId = req.params.locationId;
  const cached = osmPlaceCache.get(locationId);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("Cache-Control", "public, max-age=300");
    return res.json({ place: cached.place });
  }
  osmPlaceCache.delete(locationId);

  const query = `[out:json][timeout:15];${match[1]}(${match[2]});out center tags;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(overpassUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "WSE-Adventures/1.0 (OpenStreetMap place details)"
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenStreetMap returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result.elements)) throw new Error("OpenStreetMap returned invalid place details.");
    const place = normalizeOverpassElements(result.elements).find(item => item.id === locationId);
    if (!place) return res.status(404).json({ error: "This attraction could not be found in OpenStreetMap." });

    osmPlaceCache.set(locationId, { place, expiresAt: Date.now() + 10 * 60 * 1000 });
    if (osmPlaceCache.size > 500) osmPlaceCache.delete(osmPlaceCache.keys().next().value);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ place });
  } catch (error) {
    const timedOut = error.name === "AbortError";
    console.error("OpenStreetMap place lookup error:", error.message);
    res.status(timedOut ? 504 : 503).json({
      error: timedOut ? "Place lookup timed out. Try again shortly." : "Mapped place details are temporarily unavailable."
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.put("/api/locations/:locationId/photo", requireLogin, requireCsrf, photoUploadLimiter, async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) {
    return res.status(400).json({ error: "Invalid location identifier." });
  }
  const imageData = validateProfileImage(req.body?.imageData);
  if (!imageData) {
    return res.status(400).json({ error: "Choose a valid PNG, JPEG or WebP image under 256 KB." });
  }
  try {
    await dbRun(`INSERT INTO place_photos (location_id, image_data, owner_user_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(location_id) DO UPDATE SET image_data = excluded.image_data,
        owner_user_id = excluded.owner_user_id, updated_at = CURRENT_TIMESTAMP
      WHERE place_photos.owner_user_id = excluded.owner_user_id OR place_photos.owner_user_id IS NULL`,
    [req.params.locationId, imageData, req.session.userId]);
    const savedPhoto = await dbGet("SELECT owner_user_id AS ownerUserId FROM place_photos WHERE location_id = ?", [req.params.locationId]);
    if (savedPhoto?.ownerUserId !== req.session.userId) {
      return res.status(403).json({ error: "Only the visitor who added this photo can replace it." });
    }
    res.set("Cache-Control", "no-store");
    res.json({ saved: true });
  } catch (error) {
    console.error("Place photo save error:", error.message);
    res.status(500).json({ error: "Could not save the place photo." });
  }
});

app.delete("/api/locations/:locationId/photo", requireLogin, requireCsrf, photoUploadLimiter, async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) {
    return res.status(400).json({ error: "Invalid location identifier." });
  }
  try {
    const photo = await dbGet("SELECT owner_user_id AS ownerUserId FROM place_photos WHERE location_id = ?", [req.params.locationId]);
    if (photo && photo.ownerUserId !== null && photo.ownerUserId !== req.session.userId) {
      return res.status(403).json({ error: "Only the visitor who added this photo can remove it." });
    }
    await dbRun("DELETE FROM place_photos WHERE location_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)",
      [req.params.locationId, req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ deleted: true });
  } catch (error) {
    console.error("Place photo removal error:", error.message);
    res.status(500).json({ error: "Could not remove the place photo." });
  }
});

app.get("/api/locations/:locationId/photo-search", photoSearchLimiter, async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)
    || typeof req.query.name !== "string"
    || req.query.name.trim().length < 1
    || req.query.name.trim().length > 120) {
    return res.status(400).json({ error: "A valid location and place name are required." });
  }
  const name = req.query.name.trim();
  const countryCode = typeof req.query.countryCode === "string" && /^[A-Z]{2}$/.test(req.query.countryCode)
    ? req.query.countryCode : "";
  const cacheKey = `${name.toLocaleLowerCase()}|${countryCode}`;
  const cached = photoSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ photo: cached.photo });

  const search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${name} ${countryCode}`,
    gsrnamespace: "6",
    gsrlimit: "1",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1400"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${search}`, {
      headers: { "User-Agent": "WSE-Adventures/1.0 (place photo lookup)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Wikimedia Commons returned HTTP ${response.status}.`);
    const result = await response.json();
    const page = Object.values(result.query?.pages || {})[0];
    const image = page?.imageinfo?.[0];
    const imageUrl = image?.thumburl || image?.url;
    let licenseUrl = null;
    try {
      const parsedLicenseUrl = new URL(image?.extmetadata?.LicenseUrl?.value || "");
      if (parsedLicenseUrl.protocol === "https:") licenseUrl = parsedLicenseUrl.href;
    } catch { }
    const photo = imageUrl && /^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(imageUrl)
      ? {
        url: imageUrl,
        title: String(page.title || "").replace(/^File:/, ""),
        license: String(image.extmetadata?.LicenseShortName?.value || "Wikimedia Commons"),
        licenseUrl,
        artist: String(image.extmetadata?.Artist?.value || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").slice(0, 240),
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`
      }
      : null;
    photoSearchCache.set(cacheKey, { photo, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    if (photoSearchCache.size > 300) photoSearchCache.delete(photoSearchCache.keys().next().value);
    res.set("Cache-Control", "public, max-age=21600");
    res.json({ photo });
  } catch (error) {
    const timedOut = error.name === "AbortError";
    console.error("Place photo search error:", error.message);
    res.status(timedOut ? 504 : 503).json({
      error: timedOut ? "Place photo search timed out. Try again shortly." : "Place photo search is temporarily unavailable."
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/api/weather", mapDataLimiter, async (req, res) => {
  const latitude = typeof req.query.latitude === "string" && req.query.latitude.trim() ? Number(req.query.latitude) : NaN;
  const longitude = typeof req.query.longitude === "string" && req.query.longitude.trim() ? Number(req.query.longitude) : NaN;
  const temperatureUnit = req.query.temperatureUnit === undefined ? "celsius" : req.query.temperatureUnit;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || !["celsius", "fahrenheit"].includes(temperatureUnit)) {
    return res.status(400).json({ error: "Enter valid coordinates and a supported temperature unit." });
  }
  const roundedLatitude = Math.round(latitude * 1000) / 1000;
  const roundedLongitude = Math.round(longitude * 1000) / 1000;
  const cacheKey = `${roundedLatitude},${roundedLongitude},${temperatureUnit}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("Cache-Control", "public, max-age=600");
    return res.json(cached.data);
  }

  const query = new URLSearchParams({
    latitude: String(roundedLatitude),
    longitude: String(roundedLongitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    temperature_unit: temperatureUnit,
    wind_speed_unit: temperatureUnit === "fahrenheit" ? "mph" : "kmh",
    timezone: "auto"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result.current || !Number.isFinite(result.current.temperature_2m)) {
      throw new Error("Open-Meteo returned incomplete current conditions.");
    }
    const data = { current: result.current, units: result.current_units, timezone: result.timezone };
    weatherCache.set(cacheKey, { data, expiresAt: Date.now() + 10 * 60 * 1000 });
    if (weatherCache.size > 500) weatherCache.delete(weatherCache.keys().next().value);
    res.set("Cache-Control", "public, max-age=600");
    res.json(data);
  } catch (error) {
    const timedOut = error.name === "AbortError";
    console.error("Current weather lookup error:", error.message);
    res.status(timedOut ? 504 : 503).json({
      error: timedOut ? "Current weather lookup timed out. Try again shortly." : "Current weather is temporarily unavailable."
    });
  } finally {
    clearTimeout(timeout);
  }
});

async function getLocationReviews(locationId, userId) {
  const summary = await dbGet(
    "SELECT COUNT(*) AS reviewCount, ROUND(AVG(rating), 1) AS averageRating FROM place_reviews WHERE location_id = ?",
    [locationId]
  );
  const reviews = await dbAll(
    `SELECT place_reviews.rating, place_reviews.comment, place_reviews.created_at AS createdAt, users.name AS author
      FROM place_reviews JOIN users ON users.id = place_reviews.user_id
      WHERE place_reviews.location_id = ? ORDER BY place_reviews.created_at DESC, place_reviews.id DESC LIMIT 20`,
    [locationId]
  );
  const myReview = userId
    ? await dbGet("SELECT rating, comment FROM place_reviews WHERE location_id = ? AND user_id = ?", [locationId, userId])
    : null;
  return {
    reviewCount: Number(summary.reviewCount),
    averageRating: summary.averageRating === null ? null : Number(summary.averageRating),
    reviews,
    myReview
  };
}

app.get("/api/locations/:locationId/reviews", async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) {
    return res.status(400).json({ error: "Invalid location identifier." });
  }
  try {
    res.set("Cache-Control", "no-store");
    res.json(await getLocationReviews(req.params.locationId, req.session.userId));
  } catch (error) {
    console.error("Location review lookup error:", error.message);
    res.status(500).json({ error: "Could not load location feedback." });
  }
});

app.post("/api/locations/:locationId/reviews", requireLogin, requireCsrf, reviewLimiter, async (req, res) => {
  if (!locationIdPattern.test(req.params.locationId)) {
    return res.status(400).json({ error: "Invalid location identifier." });
  }
  const { rating, comment } = req.body || {};
  const cleanComment = typeof comment === "string" ? comment.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Choose a rating from 1 to 5." });
  }
  if (cleanComment.length < 10 || cleanComment.length > 1000) {
    return res.status(400).json({ error: "Feedback must be between 10 and 1,000 characters." });
  }
  try {
    await dbRun(
      `INSERT INTO place_reviews (location_id, user_id, rating, comment) VALUES (?, ?, ?, ?)
       ON CONFLICT(location_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = CURRENT_TIMESTAMP`,
      [req.params.locationId, req.session.userId, rating, cleanComment]
    );
    res.set("Cache-Control", "no-store");
    res.json(await getLocationReviews(req.params.locationId, req.session.userId));
  } catch (error) {
    console.error("Location review save error:", error.message);
    res.status(500).json({ error: "Could not save your feedback." });
  }
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
    const role = configuredAdminUserIds.has(created.lastID) ? "admin" : "user";
    if (role === "admin") await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [created.lastID]);
    await recordActivity({
      userId: created.lastID, actorUserId: created.lastID, eventType: "account.registered",
      description: "An account was created."
    });
    await createNotification({
      userId: created.lastID, category: "account", title: "Welcome to WSE Adventures",
      message: "Your account is ready. Set your preferences and start exploring.",
      href: "/dashboard"
    });
    await regenerateSession(req);
    req.session.userId = created.lastID;
    const csrfToken = createCsrfToken(req);
    await saveSession(req);
    await recordActiveSession(req, created.lastID);
    res.status(201).json({ user: { id: created.lastID, name: cleanName, email: cleanEmail, role, status: "active" }, csrfToken });
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
      "SELECT id, name, email, password_hash, role, status, created_at AS createdAt FROM users WHERE email = ?",
      [email.trim().toLowerCase()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await recordActivity({
        eventType: "auth.login.failed", status: "warning",
        description: "A sign-in attempt failed."
      });
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (user.status !== "active") {
      await recordActivity({
        userId: user.id, eventType: "auth.login.blocked", status: "warning",
        description: "A sign-in attempt was blocked for an inactive account."
      });
      return res.status(403).json({ error: "This account is inactive. Contact an administrator." });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    const csrfToken = createCsrfToken(req);
    await saveSession(req);
    await recordActiveSession(req, user.id);
    await recordActivity({
      userId: user.id, actorUserId: user.id, eventType: "auth.login",
      description: "Signed in successfully."
    });
    await createNotification({
      userId: user.id, category: "security", title: "New sign-in",
      message: "Your WSE Adventures account was just signed in to.",
      href: "/settings"
    });
    res.json({ user: cleanUser(user), csrfToken });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.get("/api/me", requireLogin, async (req, res) => {
  try {
    const user = await dbGet("SELECT id, name, email, profile_image AS profileImage, role, status, created_at AS createdAt FROM users WHERE id = ?", [req.session.userId]);
    if (!user) {
      req.session.destroy(() => { });
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
  res.set("Cache-Control", "no-store");
  if (!req.session.userId) return res.json({ user: null });
  try {
    const user = await dbGet("SELECT id, name, email, role, status FROM users WHERE id = ?", [req.session.userId]);
    if (!user || user.status !== "active") {
      req.session.destroy(error => {
        if (error) console.error("Expired session cleanup error:", error.message);
      });
      return res.json({ user: null });
    }
    await recordActiveSession(req, user.id);
    res.json({ user: cleanUser(user) });
  } catch (error) {
    console.error("Session status error:", error.message);
    res.status(500).json({ error: "Could not load session status." });
  }
});

app.patch("/api/me", requireLogin, requireCsrf, async (req, res) => {
  try {
    const input = req.body || {};
    const current = await dbGet("SELECT id, name, email, password_hash AS passwordHash, profile_image AS profileImage FROM users WHERE id = ?", [req.session.userId]);
    if (!current) return res.status(401).json({ error: "Account not found. Please sign in again." });
    const cleanName = input.name === undefined ? current.name : (typeof input.name === "string" ? input.name.trim() : "");
    const cleanEmail = input.email === undefined ? current.email : (typeof input.email === "string" ? input.email.trim().toLowerCase() : "");
    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ error: "Display name must be between 2 and 80 characters." });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (cleanEmail !== current.email
      && (typeof input.currentPassword !== "string" || !(await bcrypt.compare(input.currentPassword, current.passwordHash)))) {
      return res.status(403).json({ error: "Enter your current password to change your email address." });
    }
    if (cleanEmail !== current.email && await dbGet("SELECT id FROM users WHERE email = ? AND id <> ?", [cleanEmail, req.session.userId])) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    let profileImage = current.profileImage;
    if (Object.hasOwn(input, "profileImage")) {
      profileImage = validateProfileImage(input.profileImage);
      if (profileImage === undefined) return res.status(400).json({ error: "Choose a valid PNG, JPEG or WebP image under 256 KB." });
    }
    await dbRun("UPDATE users SET name = ?, email = ?, profile_image = ? WHERE id = ?", [cleanName, cleanEmail, profileImage, req.session.userId]);
    const user = await dbGet("SELECT id, name, email, profile_image AS profileImage, role, status, created_at AS createdAt FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(401).json({ error: "Account not found. Please sign in again." });
    if (cleanName !== current.name || cleanEmail !== current.email || profileImage !== current.profileImage) {
      await recordActivity({
        userId: user.id, actorUserId: user.id, eventType: "account.profile.updated",
        description: "Account profile information was updated."
      });
      await createNotification({
        userId: user.id, category: "account", title: "Profile updated",
        message: "Your account profile information was updated.",
        href: "/settings"
      });
    }
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ error: "Could not update your profile." });
  }
});

app.get("/api/me/settings", requireLogin, async (req, res) => {
  try {
    const [user, preferences, settings] = await Promise.all([
      dbGet("SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?", [req.session.userId]),
      getPreferences(req.session.userId),
      getAppSettings(req.session.userId)
    ]);
    if (!user) return res.status(401).json({ error: "Account not found. Please sign in again." });
    res.set("Cache-Control", "no-store");
    res.json({ user, preferences, settings, version: appVersion, availability: { emailNotifications: false, webNotifications: false, twoFactor: false, accountEmailVerification: false } });
  } catch (error) {
    console.error("Settings load error:", error.message);
    res.status(500).json({ error: "Could not load your settings." });
  }
});

app.patch("/api/me/settings", requireLogin, requireCsrf, async (req, res) => {
  const input = req.body || {};
  try {
    if (Object.hasOwn(input, "settings")) {
      const validationError = validateAppSettingsPatch(input.settings);
      if (validationError) return res.status(400).json({ error: validationError });
      const currentSettings = await getAppSettings(req.session.userId);
      const nextSettings = mergeAppSettings(currentSettings, input.settings);
      await dbRun(`INSERT INTO user_app_settings (user_id, settings_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP`,
      [req.session.userId, JSON.stringify(nextSettings)]);
      if (Object.hasOwn(input.settings, "appearance")) {
        await dbRun(`UPDATE user_preferences SET theme = ?, accent = ?, font_size = ?, time_zone = ?,
          date_format = ?, time_format = ? WHERE user_id = ?`,
        [nextSettings.appearance.theme, nextSettings.appearance.accent, nextSettings.appearance.fontSize,
          nextSettings.appearance.timeZone, nextSettings.appearance.dateFormat, nextSettings.appearance.timeFormat,
          req.session.userId]);
      }
      await recordActivity({
        userId: req.session.userId, actorUserId: req.session.userId,
        eventType: "account.settings.updated", description: "Account settings were updated."
      });
      res.set("Cache-Control", "no-store");
      return res.json({ settings: nextSettings, preferences: await getPreferences(req.session.userId) });
    }
    const current = await getPreferences(req.session.userId);
    const next = { ...current };
    const choices = [
      ["theme", allowedThemes], ["accent", allowedAccents], ["fontSize", allowedFontSizes],
      ["timeZone", allowedTimeZones], ["dateFormat", allowedDateFormats], ["timeFormat", allowedTimeFormats],
      ["provider", allowedAgentProviders]
    ];
    for (const [key, allowed] of choices) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== "string" || !allowed.has(input[key])) {
        return res.status(400).json({ error: `Choose a supported ${key === "timeZone" ? "time zone" : key.replace(/[A-Z]/g, letter => " " + letter.toLowerCase())}.` });
      }
      next[key] = input[key];
    }
    if (input.provider === "openai" && !process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "OpenAI credentials are not configured on the server." });
    }
    if (input.provider === "huggingface" && !process.env.HF_TOKEN) {
      return res.status(400).json({ error: "Hugging Face credentials are not configured on the server." });
    }
    if (input.enabledAgents !== undefined) {
      if (!Array.isArray(input.enabledAgents)
        || input.enabledAgents.length < 1
        || input.enabledAgents.length > AGENTS.length
        || input.enabledAgents.some(id => typeof id !== "string" || !DEFAULT_ENABLED_AGENTS.includes(id))
        || new Set(input.enabledAgents).size !== input.enabledAgents.length) {
        return res.status(400).json({ error: "Keep at least one supported AI agent enabled." });
      }
      next.enabledAgents = DEFAULT_ENABLED_AGENTS.filter(id => input.enabledAgents.includes(id));
    }
    if (input.approvalRequired !== undefined) {
      if (typeof input.approvalRequired !== "boolean") return res.status(400).json({ error: "Approval preference must be on or off." });
      next.approvalRequired = input.approvalRequired;
    }
    await dbRun(`INSERT INTO user_preferences
      (user_id, theme, accent, font_size, time_zone, date_format, time_format, provider, enabled_agents, approval_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, accent = excluded.accent,
      font_size = excluded.font_size, time_zone = excluded.time_zone, date_format = excluded.date_format,
      time_format = excluded.time_format, provider = excluded.provider, enabled_agents = excluded.enabled_agents,
      approval_required = excluded.approval_required`,
    [req.session.userId, next.theme, next.accent, next.fontSize, next.timeZone, next.dateFormat,
      next.timeFormat, next.provider, JSON.stringify(next.enabledAgents), next.approvalRequired ? 1 : 0]);
    await recordActivity({
      userId: req.session.userId, actorUserId: req.session.userId,
      eventType: "account.settings.updated", description: "Account settings were updated."
    });
    res.set("Cache-Control", "no-store");
    res.json({ preferences: next });
  } catch (error) {
    console.error("Settings save error:", error.message);
    res.status(500).json({ error: "Could not save your settings." });
  }
});

app.get("/api/me/dashboard", requireLogin, async (req, res) => {
  try {
    const user = await dbGet(`SELECT id, name, email, profile_image AS profileImage, role, status,
      created_at AS createdAt FROM users WHERE id = ?`, [req.session.userId]);
    const [activity, unreadCount, sessionCount] = await Promise.all([
      dbAll(`SELECT event_type AS eventType, status, description, created_at AS createdAt
        FROM activity_events WHERE user_id = ? ORDER BY id DESC LIMIT 8`, [req.session.userId]),
      dbGet("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.session.userId]),
      dbGet("SELECT COUNT(*) AS count FROM active_sessions WHERE user_id = ?", [req.session.userId])
    ]);
    const runs = listRuns(path.join(dataDir, "agent-runs.json"), req.session.userId).slice(0, 5)
      .map(run => ({ id: run.id, task: run.task, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt }));
    const notifications = await dbAll(`SELECT id, category, title, message, href, created_at AS createdAt, read_at AS readAt
      FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5`, [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({
      user: cleanUser(user),
      activity,
      notifications: notifications.map(item => ({ ...item, isRead: Boolean(item.readAt) })),
      unreadCount: Number(unreadCount?.count || 0),
      activeSessionCount: Number(sessionCount?.count || 0),
      agentRuns: runs,
      integrations: { githubConfigured: Boolean(process.env.GITHUB_TOKEN) }
    });
  } catch (error) {
    console.error("User dashboard load error:", error.message);
    res.status(500).json({ error: "Could not load your dashboard." });
  }
});

app.get("/api/me/notifications", requireLogin, async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 50);
  const beforeId = req.query.before;
  if (beforeId !== undefined && (!/^\d+$/.test(String(beforeId)) || Number(beforeId) < 1)) {
    return res.status(400).json({ error: "Notification cursor is invalid." });
  }
  try {
    const conditions = beforeId ? "AND id < ?" : "";
    const params = beforeId ? [req.session.userId, Number(beforeId), limit] : [req.session.userId, limit];
    const notifications = await dbAll(`SELECT id, category, title, message, href, created_at AS createdAt, read_at AS readAt
      FROM notifications WHERE user_id = ? ${conditions} ORDER BY id DESC LIMIT ?`, params);
    res.set("Cache-Control", "no-store");
    res.json({
      notifications: notifications.map(item => ({ ...item, isRead: Boolean(item.readAt) })),
      nextBeforeId: notifications.length === limit ? notifications[notifications.length - 1].id : null
    });
  } catch (error) {
    console.error("Notification list error:", error.message);
    res.status(500).json({ error: "Could not load notifications." });
  }
});

app.get("/api/me/notifications/unread-count", requireLogin, async (req, res) => {
  try {
    const row = await dbGet("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ unreadCount: Number(row?.count || 0) });
  } catch (error) {
    console.error("Notification count error:", error.message);
    res.status(500).json({ error: "Could not load unread notifications." });
  }
});

app.patch("/api/me/notifications/:notificationId/read", requireLogin, requireCsrf, async (req, res) => {
  if (!/^\d+$/.test(req.params.notificationId) || Number(req.params.notificationId) < 1) {
    return res.status(400).json({ error: "Notification identifier is invalid." });
  }
  try {
    const result = await dbGet("SELECT id, read_at AS readAt FROM notifications WHERE id = ? AND user_id = ?", [Number(req.params.notificationId), req.session.userId]);
    if (!result) return res.status(404).json({ error: "Notification not found." });
    if (!result.readAt) await dbRun("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", [result.id, req.session.userId]);
    const count = await dbGet("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ notification: { id: result.id, isRead: true }, unreadCount: Number(count?.count || 0) });
  } catch (error) {
    console.error("Notification update error:", error.message);
    res.status(500).json({ error: "Could not update notification." });
  }
});

app.post("/api/me/notifications/read-all", requireLogin, requireCsrf, async (req, res) => {
  try {
    const result = await dbGet("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.session.userId]);
    await dbRun("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ updated: Number(result?.count || 0), unreadCount: 0 });
  } catch (error) {
    console.error("Mark all notifications read error:", error.message);
    res.status(500).json({ error: "Could not mark notifications as read." });
  }
});

app.delete("/api/me/notifications/:notificationId", requireLogin, requireCsrf, async (req, res) => {
  if (!/^\d+$/.test(req.params.notificationId) || Number(req.params.notificationId) < 1) {
    return res.status(400).json({ error: "Notification identifier is invalid." });
  }
  try {
    const found = await dbGet("SELECT id FROM notifications WHERE id = ? AND user_id = ?", [Number(req.params.notificationId), req.session.userId]);
    if (!found) return res.status(404).json({ error: "Notification not found." });
    await dbRun("DELETE FROM notifications WHERE id = ? AND user_id = ?", [found.id, req.session.userId]);
    const count = await dbGet("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ deleted: true, unreadCount: Number(count?.count || 0) });
  } catch (error) {
    console.error("Notification delete error:", error.message);
    res.status(500).json({ error: "Could not delete notification." });
  }
});

app.get("/api/me/search-history", requireLogin, async (req, res) => {
  try {
    const history = await dbAll("SELECT query, created_at AS createdAt FROM user_search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ history });
  } catch (error) {
    console.error("Search history load error:", error.message);
    res.status(500).json({ error: "Could not load search history." });
  }
});

app.post("/api/me/search-history", requireLogin, requireCsrf, async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query || query.length > 160) return res.status(400).json({ error: "Search text must be between 1 and 160 characters." });
    const settings = await getAppSettings(req.session.userId);
    if (!settings.discovery.searchHistory || !settings.privacy.searchHistory) {
      return res.status(200).json({ saved: false });
    }
    await dbRun("INSERT INTO user_search_history (user_id, query) VALUES (?, ?)", [req.session.userId, query]);
    await dbRun(`DELETE FROM user_search_history WHERE user_id = ? AND id NOT IN
      (SELECT id FROM user_search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50)`,
    [req.session.userId, req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.status(201).json({ saved: true });
  } catch (error) {
    console.error("Search history save error:", error.message);
    res.status(500).json({ error: "Could not save search history." });
  }
});

app.delete("/api/me/search-history", requireLogin, requireCsrf, async (req, res) => {
  try {
    await dbRun("DELETE FROM user_search_history WHERE user_id = ?", [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ message: "Search history cleared." });
  } catch (error) {
    console.error("Search history clear error:", error.message);
    res.status(500).json({ error: "Could not clear search history." });
  }
});

app.post("/api/me/password", requireLogin, requireCsrf, authLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({ error: "Enter your current password and a new password between 12 and 128 characters." });
    }
    const user = await dbGet("SELECT password_hash AS passwordHash FROM users WHERE id = ?", [req.session.userId]);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(403).json({ error: "Your current password is incorrect." });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return res.status(400).json({ error: "Choose a new password that differs from your current one." });
    }
    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(newPassword, 12), req.session.userId]);
    await discoverUserSessions(req.session.userId);
    const others = await dbAll("SELECT session_id AS sessionId FROM active_sessions WHERE user_id = ? AND session_id <> ?", [req.session.userId, req.sessionID]);
    for (const other of others) await destroyStoredSession(other.sessionId);
    await dbRun("DELETE FROM active_sessions WHERE user_id = ? AND session_id <> ?", [req.session.userId, req.sessionID]);
    await recordActiveSession(req, req.session.userId, true);
    await recordActivity({
      userId: req.session.userId, actorUserId: req.session.userId,
      eventType: "security.password.changed", description: "Account password was changed."
    });
    await createNotification({
      userId: req.session.userId, category: "security", title: "Password changed",
      message: "Your account password was updated. Other sessions were signed out.",
      href: "/settings"
    });
    res.set("Cache-Control", "no-store");
    res.json({ message: "Password changed. Other signed-in sessions have been logged out." });
  } catch (error) {
    console.error("Password update error:", error.message);
    res.status(500).json({ error: "Could not change your password." });
  }
});

app.get("/api/me/sessions", requireLogin, async (req, res) => {
  try {
    await recordActiveSession(req, req.session.userId, true);
    await discoverUserSessions(req.session.userId);
    await dbRun("DELETE FROM active_sessions WHERE last_active < datetime('now', '-1 day')");
    const sessions = await dbAll(`SELECT session_id AS sessionId, created_at AS createdAt,
      last_active AS lastActive, user_agent AS userAgent FROM active_sessions
      WHERE user_id = ? ORDER BY last_active DESC`, [req.session.userId]);
    res.set("Cache-Control", "no-store");
    res.json({ sessions: sessions.map(item => ({
      current: item.sessionId === req.sessionID,
      label: item.sessionId === req.sessionID ? "This browser" : "Other signed-in browser",
      createdAt: item.createdAt,
      lastActive: item.lastActive,
      browser: item.userAgent
    })) });
  } catch (error) {
    console.error("Session list error:", error.message);
    res.status(500).json({ error: "Could not load active sessions." });
  }
});

app.post("/api/me/sessions/logout-others", requireLogin, requireCsrf, async (req, res) => {
  try {
    await discoverUserSessions(req.session.userId);
    const others = await dbAll("SELECT session_id AS sessionId FROM active_sessions WHERE user_id = ? AND session_id <> ?", [req.session.userId, req.sessionID]);
    for (const other of others) await destroyStoredSession(other.sessionId);
    await dbRun("DELETE FROM active_sessions WHERE user_id = ? AND session_id <> ?", [req.session.userId, req.sessionID]);
    res.set("Cache-Control", "no-store");
    res.json({ message: `Signed out ${others.length} other session${others.length === 1 ? "" : "s"}.`, revoked: others.length });
  } catch (error) {
    console.error("Other-session logout error:", error.message);
    res.status(500).json({ error: "Could not log out other sessions." });
  }
});

app.post("/api/me/delete", requireLogin, requireCsrf, authLimiter, async (req, res) => {
  try {
    const { password, confirmation } = req.body || {};
    if (confirmation !== "DELETE" || typeof password !== "string") {
      return res.status(400).json({ error: "Enter DELETE and your password to confirm account deletion." });
    }
    const user = await dbGet("SELECT password_hash AS passwordHash FROM users WHERE id = ?", [req.session.userId]);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(403).json({ error: "Your password is incorrect." });
    }
    const userId = req.session.userId;
    await discoverUserSessions(userId);
    const sessions = await dbAll("SELECT session_id AS sessionId FROM active_sessions WHERE user_id = ?", [userId]);
    for (const item of sessions) if (item.sessionId !== req.sessionID) await destroyStoredSession(item.sessionId);
    removeUserAgentRuns(userId);
    await dbRun("UPDATE place_photos SET owner_user_id = NULL WHERE owner_user_id = ?", [userId]);
    await dbRun("DELETE FROM place_reviews WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM notifications WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM user_preferences WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM user_app_settings WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM user_search_history WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM active_sessions WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM users WHERE id = ?", [userId]);
    req.session.destroy(error => {
      if (error) return res.status(500).json({ error: "Account data was removed, but the current session could not be closed. Please sign out." });
      res.clearCookie("wise.sid", { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" });
      res.set("Cache-Control", "no-store");
      res.json({ message: "Your account and associated profile data have been deleted." });
    });
  } catch (error) {
    console.error("Account deletion error:", error.message);
    res.status(500).json({ error: "Could not delete your account." });
  }
});

app.post("/api/logout", requireLogin, requireCsrf, async (req, res) => {
  try {
    await recordActivity({
      userId: req.session.userId, actorUserId: req.session.userId,
      eventType: "auth.logout", description: "Signed out successfully."
    });
  } catch (error) {
    console.error("Logout activity record error:", error.message);
    return res.status(500).json({ error: "Could not complete logout. Please try again." });
  }
  sessionActivityCache.delete(req.sessionID);
  dbRun("DELETE FROM active_sessions WHERE session_id = ?", [req.sessionID]).catch(error => console.error("Session cleanup error:", error.message));
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Could not log out. Please try again." });
    res.clearCookie("wise.sid", {
      httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
    });
    res.json({ message: "Logged out successfully." });
  });
});

app.get("/api/agents/roles", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const preferences = await getPreferences(req.session.userId);
  res.json({
    mode: preferences.provider,
    approvalRequired: preferences.approvalRequired,
    enabledAgents: preferences.enabledAgents,
    providerPreference: preferences.provider,
    providers: {
      openai: { configured: Boolean(process.env.OPENAI_API_KEY) },
      huggingFace: { configured: Boolean(process.env.HF_TOKEN) }
    },
    agents: AGENTS.map(({ id, name, focus }) => ({ id, name, focus }))
  });
});

app.get("/api/agents/runs", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ runs: listRuns(path.join(dataDir, "agent-runs.json"), req.session.userId) });
});

app.post("/api/agents/runs", requireLogin, requireCsrf, agentLimiter, async (req, res) => {
  try {
    const preferences = await getPreferences(req.session.userId);
    const run = createRun({
      filePath: path.join(dataDir, "agent-runs.json"),
      task: req.body?.task,
      userId: req.session.userId,
      autonomous: req.body?.autonomous === true,
      approvalRequired: preferences.approvalRequired,
      enabledAgents: preferences.enabledAgents,
      providerPreference: preferences.provider
    });
    await notifyAgentRun({ ...run, userId: req.session.userId });
    res.status(202).json({
      message: run.status === "queued" ? "Task queued. Independent agents will start in the background." : "Task saved. Review it and approve it before the agents start.",
      run
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "Could not create agent task." });
  }
});

app.post("/api/agents/runs/:runId/approve", requireLogin, requireCsrf, agentLimiter, async (req, res) => {
  try {
    const execution = runAgentTeam({
      filePath: path.join(dataDir, "agent-runs.json"),
      runId: req.params.runId,
      userId: req.session.userId
    });
    const started = getAnyRun(path.join(dataDir, "agent-runs.json"), req.params.runId);
    if (started?.status === "running") {
      notifyAgentRunStarted(started).catch(error => console.error("Agent task start event failed:", error.message));
    }
    const run = await execution;
    await notifyAgentRun({ ...run, userId: req.session.userId }, true);
    const failedCount = run.results.filter(item => item.failed).length;
    res.json({
      message: run.status === "failed"
        ? `All ${failedCount} agent(s) failed. Review the agent error details. No repository files were changed.`
        : run.status === "completed_with_errors"
          ? `${failedCount} agent(s) could not complete. Review the agent error details. No repository files were changed.`
          : `${run.results.length} agent(s) completed their review. No repository files were changed.`,
      run
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || "Agent execution failed.",
      run: error.agentRun || undefined
    });
  }
});

app.get("/api/agents/github/status", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!process.env.GITHUB_TOKEN) {
    return res.json({
      configured: false,
      connected: false,
      detail: "GitHub integration is not configured on the server."
    });
  }
  try {
    const status = await getConnectionStatus();
    res.json({ configured: true, ...status });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      connected: false,
      error: error.message || "GitHub connection failed."
    });
  }
});

app.get("/api/agents/github/files", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const result = await listRepositoryFiles({
      ref: typeof req.query.ref === "string" ? req.query.ref : undefined,
      limit: req.query.limit
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || "Could not inspect the repository." });
  }
});

app.get("/api/agents/worker", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(agentWorker.getStatus());
});

app.get("/api/admin/agents", requireLogin, requireAdmin, async (req, res) => {
  try {
    const runs = listAllRuns(path.join(dataDir, "agent-runs.json"));
    const userIds = [...new Set(runs.map(run => Number(run.userId)).filter(id => Number.isInteger(id) && id > 0))];
    const users = userIds.length
      ? await dbAll(`SELECT id, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds)
      : [];
    const owners = new Map(users.map(user => [Number(user.id), user.name]));
    const worker = agentWorker.getStatus();
    const attempts = runs.flatMap(run => (run.results || []).flatMap(result => {
      if (Array.isArray(result.providerAttempts) && result.providerAttempts.length) return result.providerAttempts;
      if (["openai", "huggingface"].includes(result.provider)) {
        return [{
          provider: result.provider,
          status: result.failed ? result.errorCategory || "unavailable" : "available",
          checkedAt: run.finishedAt || run.updatedAt,
          retryable: Boolean(result.retryable)
        }];
      }
      return [];
    }));
    const latestAttempt = provider => attempts
      .filter(attempt => attempt.provider === provider)
      .sort((left, right) => (Date.parse(right.checkedAt) || 0) - (Date.parse(left.checkedAt) || 0))[0] || null;
    const providerHealth = (id, name, configured) => {
      const recent = latestAttempt(id);
      const observed = recent?.status;
      const status = !configured ? "not_configured"
        : !observed ? "unknown"
          : observed === "available" ? "healthy"
            : observed === "configuration_missing" ? "configuration_invalid"
              : observed === "unavailable" ? "temporarily_unavailable"
                : observed;
      const details = {
        not_configured: "Server configuration is missing.",
        unknown: "Configured, but no recent real agent request is available to assess provider health.",
        healthy: "Most recent real agent request completed successfully.",
        configuration_invalid: "The most recent request indicates that provider configuration is invalid.",
        authentication_failure: "Provider rejected the configured credentials.",
        rate_limited: "Provider rate limit reached. Retry later.",
        credits_unavailable: "Provider credits or quota are unavailable.",
        temporarily_unavailable: "The most recent provider request failed temporarily. Review server-side diagnostics."
      };
      return { id, name, configured: Boolean(configured), status, checkedAt: recent?.checkedAt || null, retryable: Boolean(recent?.retryable), detail: details[status] || `${name} status is unknown.` };
    };
    const providers = [
      providerHealth("openai", "OpenAI", Boolean(process.env.OPENAI_API_KEY)),
      providerHealth("huggingface", "Hugging Face", Boolean(process.env.HF_TOKEN))
    ];
    const runForAgent = (run, agentId) => Array.isArray(run.results)
      ? run.results.find(result => result.agentId === agentId)
      : null;
    const agents = AGENTS.map(agent => {
      const relevant = runs.filter(run => Array.isArray(run.enabledAgents) && run.enabledAgents.includes(agent.id));
      const latestRun = relevant[0] || null;
      const currentRun = relevant.find(run => ["running", "queued", "awaiting_approval"].includes(run.status)) || null;
      const successful = relevant.find(run => {
        const result = runForAgent(run, agent.id);
        return result && !result.failed;
      }) || null;
      const failedRun = relevant.find(run => {
        const result = runForAgent(run, agent.id);
        return result?.failed;
      }) || null;
      const failure = failedRun ? runForAgent(failedRun, agent.id) : null;
      const successTime = Date.parse(successful?.finishedAt || successful?.updatedAt || "") || 0;
      const failureTime = Date.parse(failedRun?.finishedAt || failedRun?.updatedAt || "") || 0;
      let status = "idle";
      if (currentRun?.status === "running") status = "running";
      else if (currentRun?.status === "awaiting_approval") status = "waiting_for_approval";
      else if (currentRun?.status === "queued") status = worker.paused ? "paused" : worker.started ? "queued" : "offline";
      else if (!worker.started) status = "offline";
      const latestResult = latestRun ? runForAgent(latestRun, agent.id) : null;
      return {
        id: agent.id,
        name: agent.name,
        purpose: agent.focus,
        status,
        health: !successful && !failure ? "unknown" : failureTime > successTime ? "failed" : "healthy",
        currentTask: currentRun ? redactAgentText(currentRun.task).slice(0, 180) : null,
        provider: latestResult?.provider || (latestRun?.providerPreference ? `Preferred: ${latestRun.providerPreference}` : "Not used yet"),
        lastActivity: latestRun?.updatedAt || latestRun?.createdAt || null,
        lastRunAt: latestRun?.createdAt || null,
        lastSuccessfulOperation: successful?.finishedAt || successful?.updatedAt || null,
        lastError: failure && failureTime > successTime ? redactAgentText(failure.errorMessage || failure.output).slice(0, 500) : null
      };
    });
    const approvalQueue = runs.filter(run => run.status === "awaiting_approval").slice(0, 50).map(run => ({
      id: run.id,
      agentNames: AGENTS.filter(agent => run.enabledAgents?.includes(agent.id)).map(agent => agent.name),
      requestedAction: "Run the selected specialists",
      description: redactAgentText(run.task).slice(0, 1000),
      owner: owners.get(Number(run.userId)) || "Deleted account",
      createdAt: run.createdAt,
      risk: "Requires administrator review"
    }));
    const taskHistory = runs.slice(0, 50).map(run => {
      const results = Array.isArray(run.results) ? run.results : [];
      const durationStart = Date.parse(run.startedAt || "");
      const durationEnd = Date.parse(run.finishedAt || "");
      const approvalStatus = run.rejectedAt ? "rejected"
        : run.cancelledAt ? "cancelled"
          : run.approvalRequired && !run.approvedAt ? "pending"
            : run.approvedAt ? "approved"
              : "not_required";
      return {
        id: run.id,
        task: redactAgentText(run.task).slice(0, 500),
        owner: owners.get(Number(run.userId)) || "Deleted account",
        agentNames: AGENTS.filter(agent => run.enabledAgents?.includes(agent.id)).map(agent => agent.name),
        status: run.status,
        approvalStatus,
        createdAt: run.createdAt,
        startedAt: run.startedAt || null,
        finishedAt: run.finishedAt || null,
        durationMs: Number.isFinite(durationStart) && Number.isFinite(durationEnd) ? Math.max(0, durationEnd - durationStart) : null,
        provider: run.provider || "not used",
        results: results.map(result => ({
          agent: AGENTS.find(agent => agent.id === result.agentId)?.name || "Agent",
          status: result.failed ? "failed" : "completed",
          result: result.failed ? null : redactAgentText(result.output).slice(0, 500),
          error: result.failed ? redactAgentText(result.errorMessage || result.output).slice(0, 500) : null,
          errorCategory: result.errorCategory || null,
          retryable: Boolean(result.retryable)
        })),
        error: run.error ? redactAgentText(run.error).slice(0, 500) : null,
        retryOf: run.retryOf || null,
        retryCount: Number(run.retryCount || 0),
        canRetry: canRetryRun(run)
      };
    });
    const observability = {
      retainedTaskCount: runs.length,
      queueDepth: runs.filter(run => run.status === "queued").length,
      runningTaskCount: runs.filter(run => run.status === "running").length,
      completedTaskCount: runs.filter(run => run.status === "completed").length,
      failedTaskCount: runs.filter(run => run.status === "failed").length,
      completedWithErrorsCount: runs.filter(run => run.status === "completed_with_errors").length,
      approvalQueueSize: runs.filter(run => run.status === "awaiting_approval").length,
      lastSuccessfulTask: runs.find(run => run.status === "completed")?.finishedAt || null,
      lastFailedTask: runs.find(run => ["failed", "completed_with_errors"].includes(run.status))?.finishedAt || null,
      lastWorkerActivity: worker.lastActivityAt || runs[0]?.updatedAt || null
    };
    const runActivity = runs.flatMap(run => {
      const happenedAt = run.finishedAt || run.updatedAt || run.createdAt;
      const results = Array.isArray(run.results) ? run.results : [];
      if (!results.length) return [{
        id: `${run.id}:run`,
        agent: "Agent team",
        task: redactAgentText(run.task).slice(0, 180),
        status: run.status,
        timestamp: happenedAt,
        result: run.status === "awaiting_approval" ? "Waiting for approval." : run.status.replaceAll("_", " "),
        error: null,
        owner: owners.get(Number(run.userId)) || "Deleted account"
      }];
      return results.map((result, index) => ({
        id: `${run.id}:${index}`,
        agent: AGENTS.find(agent => agent.id === result.agentId)?.name || "Agent",
        task: redactAgentText(run.task).slice(0, 180),
        status: result.failed ? "failed" : "completed",
        timestamp: happenedAt,
        result: result.failed ? null : redactAgentText(result.output).slice(0, 500),
        error: result.failed ? redactAgentText(result.errorMessage || result.output).slice(0, 500) : null,
        errorCategory: result.errorCategory || null,
        httpStatus: result.providerAttempts?.find(attempt => attempt.status !== "available")?.httpStatus || null,
        retryable: Boolean(result.retryable),
        provider: result.provider || "unknown",
        owner: owners.get(Number(run.userId)) || "Deleted account"
      }));
    });
    const auditEvents = await dbAll(`SELECT e.id, e.event_type AS eventType, e.status, e.description,
      e.created_at AS timestamp, u.name AS owner, actor.name AS actor
      FROM activity_events e LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN users actor ON actor.id = e.actor_user_id
      WHERE e.event_type LIKE 'agent.%' ORDER BY e.id DESC LIMIT 50`);
    const activity = [
      ...runActivity,
      ...auditEvents.map(event => ({
        id: `event:${event.id}`,
        agent: "Agent operations",
        task: redactAgentText(event.description),
        status: event.status,
        timestamp: event.timestamp,
        result: event.eventType,
        error: null,
        owner: event.actor || event.owner || "System"
      }))
    ].sort((left, right) => (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0)).slice(0, 50);
    const recentErrors = activity.filter(item => item.status === "failed").slice(0, 20).map(item => ({
      ...item,
      retryable: Boolean(runs.find(run => run.id === item.id.split(":")[0])?.results?.[Number(item.id.split(":")[1])]?.retryable)
    }));
    res.set("Cache-Control", "no-store");
    res.json({ agents, worker, providers, approvalQueue, activity, recentErrors, observability, taskHistory });
  } catch (error) {
    console.error("Admin agent center error:", error.message);
    res.status(500).json({ error: "Could not load agent control center data." });
  }
});

app.post("/api/admin/agents/worker", requireLogin, requireAdmin, requireCsrf, agentControlLimiter, async (req, res) => {
  const action = req.body?.action;
  const operations = {
    start: () => agentWorker.start(),
    stop: () => agentWorker.stop(),
    pause: () => agentWorker.pause(),
    resume: () => agentWorker.resume(),
    restart: () => agentWorker.restart()
  };
  if (typeof action !== "string" || !Object.hasOwn(operations, action)) {
    return res.status(400).json({ error: "Choose a supported worker action." });
  }
  try {
    const before = agentWorker.getStatus();
    if ((action === "start" && before.started) || (action === "stop" && !before.started)
      || (action === "pause" && before.paused) || (action === "resume" && before.running)) {
      return res.status(409).json({ error: "The agent worker is already in that state.", worker: before });
    }
    const worker = operations[action]();
    const actionPastTense = { start: "started", stop: "stopped", pause: "paused", resume: "resumed", restart: "restarted" }[action];
    await recordActivity({
      actorUserId: req.authUser.id, eventType: `agent.worker.${action}`,
      description: `An administrator ${actionPastTense} the agent queue worker.`
    });
    await notifyAgentAdmins({
      title: `Agent worker ${actionPastTense}`,
      message: `The shared agent queue is now ${worker.status}.`,
      href: "/admin/agents"
    });
    res.json({ message: `Agent queue ${actionPastTense}.`, worker });
  } catch (error) {
    console.error("Agent worker control error:", error.message);
    res.status(500).json({ error: "Could not update the agent worker." });
  }
});

app.post("/api/admin/agents/runs/:runId/approve", requireLogin, requireAdmin, requireCsrf, agentControlLimiter, async (req, res) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(req.params.runId)) {
    return res.status(400).json({ error: "Agent task identifier is invalid." });
  }
  try {
    const current = getAnyRun(path.join(dataDir, "agent-runs.json"), req.params.runId);
    if (!current) return res.status(404).json({ error: "Agent task not found." });
    const run = approveRun(path.join(dataDir, "agent-runs.json"), current.id, req.authUser.id);
    await recordActivity({
      userId: current.userId, actorUserId: req.authUser.id,
      eventType: "agent.approval.approved", description: "An administrator approved an agent task."
    });
    await createAgentNotification(current.userId, {
      title: "Agent task approved",
      message: "An administrator approved your task. It has been added to the agent queue.",
      href: "/agents"
    });
    await notifyAgentAdmins({
      title: "Agent approval completed",
      message: "An administrator approved a pending agent task.",
      href: "/admin/agents"
    });
    res.status(202).json({ message: "Task approved and queued. Results will be reported when processing finishes.", run });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Could not approve this agent task." });
  }
});

app.post("/api/admin/agents/runs/:runId/reject", requireLogin, requireAdmin, requireCsrf, agentControlLimiter, async (req, res) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(req.params.runId)) {
    return res.status(400).json({ error: "Agent task identifier is invalid." });
  }
  try {
    const current = getAnyRun(path.join(dataDir, "agent-runs.json"), req.params.runId);
    if (!current) return res.status(404).json({ error: "Agent task not found." });
    const run = rejectRun(path.join(dataDir, "agent-runs.json"), current.id, req.authUser.id);
    await recordActivity({
      userId: current.userId, actorUserId: req.authUser.id,
      eventType: "agent.approval.rejected", status: "warning",
      description: "An administrator rejected an agent task."
    });
    await createAgentNotification(current.userId, {
      title: "Agent task rejected",
      message: "An administrator reviewed and rejected your agent task. It was not run.",
      href: "/agents"
    });
    await notifyAgentAdmins({
      title: "Agent approval rejected",
      message: "An administrator rejected a pending agent task.",
      href: "/admin/agents"
    });
    res.json({ message: "Agent task rejected and not run.", run });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Could not reject this agent task." });
  }
});

app.post("/api/admin/agents/runs/:runId/retry", requireLogin, requireAdmin, requireCsrf, agentControlLimiter, async (req, res) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(req.params.runId)) {
    return res.status(400).json({ error: "Agent task identifier is invalid." });
  }
  try {
    const original = getAnyRun(path.join(dataDir, "agent-runs.json"), req.params.runId);
    if (!original) return res.status(404).json({ error: "Agent task not found." });
    const run = retryRun(path.join(dataDir, "agent-runs.json"), original.id, req.authUser.id);
    await recordActivity({
      userId: original.userId, actorUserId: req.authUser.id,
      eventType: "agent.task.retried",
      description: "An administrator queued a single retry for transient agent failures."
    });
    await createAgentNotification(original.userId, {
      title: "Agent task retry queued",
      message: "An administrator queued one retry for agents that encountered a temporary failure.",
      href: "/agents"
    });
    await notifyAgentAdmins({
      title: "Agent task retry queued",
      message: "A retry for transient agent failures was added to the shared queue.",
      href: "/admin/agents"
    });
    res.status(202).json({ message: "A single retry was queued for the failed agents.", run });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Could not retry this agent task."
    });
  }
});

app.post("/api/admin/agents/runs/:runId/cancel", requireLogin, requireAdmin, requireCsrf, agentControlLimiter, async (req, res) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(req.params.runId)) {
    return res.status(400).json({ error: "Agent task identifier is invalid." });
  }
  try {
    const current = getAnyRun(path.join(dataDir, "agent-runs.json"), req.params.runId);
    if (!current) return res.status(404).json({ error: "Agent task not found." });
    const run = cancelRun(path.join(dataDir, "agent-runs.json"), current.id, req.authUser.id);
    await recordActivity({
      userId: current.userId, actorUserId: req.authUser.id,
      eventType: "agent.task.cancelled", status: "warning",
      description: "An administrator cancelled a pending agent task."
    });
    await createAgentNotification(current.userId, {
      title: "Agent task cancelled",
      message: "An administrator cancelled this task before it started.",
      href: "/agents"
    });
    res.json({ message: "Pending task cancelled.", run });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Could not cancel this agent task." });
  }
});

app.get("/api/admin/overview", requireLogin, requireAdmin, async (req, res) => {
  try {
    const [userCounts, activeUsers, recentActivity, errorEvents, githubStatus] = await Promise.all([
      dbGet(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
        FROM users`),
      dbGet(`SELECT COUNT(DISTINCT s.user_id) AS count FROM active_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE u.status = 'active' AND s.last_active >= datetime('now', '-30 days')`),
      dbAll(`SELECT e.id, e.event_type AS eventType, e.status, e.description, e.created_at AS createdAt,
        u.name AS userName, u.email AS userEmail, a.name AS actorName
        FROM activity_events e LEFT JOIN users u ON u.id = e.user_id
        LEFT JOIN users a ON a.id = e.actor_user_id ORDER BY e.id DESC LIMIT 10`),
      dbAll(`SELECT event_type AS eventType, description, created_at AS createdAt, status
        FROM activity_events WHERE status = 'error' ORDER BY id DESC LIMIT 5`),
      Promise.resolve({ configured: Boolean(process.env.GITHUB_TOKEN) })
    ]);
    const runs = readAgentRuns();
    const ownerIds = [...new Set(runs.map(run => Number(run.userId)).filter(Number.isInteger))];
    const owners = ownerIds.length
      ? await dbAll(`SELECT id, name, email FROM users WHERE id IN (${ownerIds.map(() => "?").join(",")})`, ownerIds)
      : [];
    const ownersById = new Map(owners.map(user => [user.id, user]));
    const providers = {
      openai: process.env.OPENAI_API_KEY ? "configured" : "unconfigured",
      huggingFace: process.env.HF_TOKEN ? "configured" : "unconfigured"
    };
    const storage = await dbGet("SELECT COUNT(*) AS count FROM users");
    const workers = agentWorker.getStatus();
    const agents = AGENTS.map(agent => {
      const recent = runs.find(run => Array.isArray(run.enabledAgents) && run.enabledAgents.includes(agent.id));
      const current = runs.find(run => ["running", "queued", "awaiting_approval"].includes(run.status)
        && Array.isArray(run.enabledAgents) && run.enabledAgents.includes(agent.id));
      const failed = runs.find(run => ["failed", "completed_with_errors"].includes(run.status)
        && Array.isArray(run.results) && run.results.some(result => result.agentId === agent.id && result.failed));
      return {
        id: agent.id, name: agent.name, purpose: agent.focus,
        status: current
          ? current.status === "awaiting_approval" ? "waiting_for_approval" : current.status
          : workers.paused ? "paused" : workers.started ? "idle" : "offline",
        currentTask: current ? redactAgentText(current.task).slice(0, 180) : null,
        lastActivity: recent?.updatedAt || recent?.createdAt || null,
        provider: recent?.results?.find(result => result.agentId === agent.id)?.provider || "server-configured",
        health: failed ? "warning" : "unknown",
        lastError: redactAgentText(failed?.results?.find(result => result.agentId === agent.id && result.failed)?.errorMessage
          || failed?.results?.find(result => result.agentId === agent.id && result.failed)?.output) || null
      };
    });
    const recentAgentErrors = runs.filter(run => ["failed", "completed_with_errors"].includes(run.status)).slice(0, 5).map(run => ({
      eventType: "agent.run.failed", description: `${run.results.filter(result => result.failed).length} agent(s) failed in a run.`,
      createdAt: run.updatedAt, status: run.status === "failed" ? "error" : "warning"
    }));
    const summarizeRun = run => ({
      id: run.id, task: redactAgentText(run.task).slice(0, 180), status: run.status, provider: run.provider || "pending",
      createdAt: run.createdAt, updatedAt: run.updatedAt,
      owner: ownersById.get(Number(run.userId))?.name || "Deleted account"
    });
    const recentAgentActivity = runs.slice(0, 10).map(summarizeRun);
    const approvalQueue = runs.filter(run => run.status === "awaiting_approval").slice(0, 20).map(summarizeRun);
    const health = [
      { service: "Server", status: "healthy", detail: "Application process is responding." },
      { service: "API", status: "healthy", detail: "Authenticated API routes are available." },
      { service: "Authentication", status: "healthy", detail: "Database-backed sessions and CSRF protection are active." },
      { service: "Storage", status: storage ? "healthy" : "error", detail: storage ? "Application database is responding." : "Application database did not respond." },
      { service: "OpenAI", status: providers.openai, detail: providers.openai === "configured" ? "Server credentials are configured; live provider health is not probed." : "No server credentials are configured." },
      { service: "Hugging Face", status: providers.huggingFace, detail: providers.huggingFace === "configured" ? "Server credentials are configured; live provider health is not probed." : "No server credentials are configured." },
      { service: "GitHub", status: githubStatus.configured ? "configured" : "unconfigured", detail: githubStatus.configured ? "Server integration credentials are configured; live API health is not probed." : "No server credentials are configured." }
    ];
    res.set("Cache-Control", "no-store");
    res.json({
      users: { total: Number(userCounts?.total || 0), active: Number(userCounts?.active || 0), activeLast30Days: Number(activeUsers?.count || 0) },
      newUsersLast7Days: Number((await dbGet("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')"))?.count || 0),
      providers, agents, worker: workers,
      approvalQueue,
      recentAgentActivity,
      health,
      recentErrors: [...errorEvents, ...recentAgentErrors].slice(0, 8),
      recentActivity
    });
  } catch (error) {
    console.error("Admin overview error:", error.message);
    res.status(500).json({ error: "Could not load administrator overview." });
  }
});

app.get("/api/admin/users", requireLogin, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
  const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 10000);
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const role = typeof req.query.role === "string" ? req.query.role : "";
  if ((status && !["active", "inactive"].includes(status)) || (role && !["user", "admin"].includes(role))) {
    return res.status(400).json({ error: "Choose a supported account status or role filter." });
  }
  const clauses = [];
  const params = [];
  if (query) { clauses.push("(name LIKE ? OR email LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
  if (status) { clauses.push("status = ?"); params.push(status); }
  if (role) { clauses.push("role = ?"); params.push(role); }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  try {
    const count = await dbGet(`SELECT COUNT(*) AS count FROM users ${where}`, params);
    const users = await dbAll(`SELECT id, name, email, role, status, created_at AS createdAt
      FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    res.set("Cache-Control", "no-store");
    res.json({ users, total: Number(count?.count || 0), page, limit });
  } catch (error) {
    console.error("Admin user list error:", error.message);
    res.status(500).json({ error: "Could not load user accounts." });
  }
});

app.get("/api/admin/users/:userId", requireLogin, requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.userId) || Number(req.params.userId) < 1) {
    return res.status(400).json({ error: "User identifier is invalid." });
  }
  try {
    const user = await dbGet(`SELECT id, name, email, role, status, created_at AS createdAt
      FROM users WHERE id = ?`, [Number(req.params.userId)]);
    if (!user) return res.status(404).json({ error: "User not found." });
    const [sessions, activity] = await Promise.all([
      dbGet("SELECT COUNT(*) AS count FROM active_sessions WHERE user_id = ?", [user.id]),
      dbAll(`SELECT event_type AS eventType, status, description, created_at AS createdAt
        FROM activity_events WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [user.id])
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ user, activeSessions: Number(sessions?.count || 0), activity });
  } catch (error) {
    console.error("Admin user detail error:", error.message);
    res.status(500).json({ error: "Could not load user details." });
  }
});

app.patch("/api/admin/users/:userId/status", requireLogin, requireAdmin, requireCsrf, async (req, res) => {
  if (!/^\d+$/.test(req.params.userId) || Number(req.params.userId) < 1) {
    return res.status(400).json({ error: "User identifier is invalid." });
  }
  const status = req.body?.status;
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "Choose active or inactive account status." });
  }
  const targetId = Number(req.params.userId);
  if (targetId === req.session.userId) return res.status(400).json({ error: "You cannot change your own account status." });
  try {
    const target = await dbGet("SELECT id, name, email, role, status FROM users WHERE id = ?", [targetId]);
    if (!target) return res.status(404).json({ error: "User not found." });
    if (target.role === "admin") return res.status(403).json({ error: "Administrator accounts cannot be deactivated here." });
    if (target.status === status) return res.json({ user: target, changed: false });
    await dbRun("UPDATE users SET status = ? WHERE id = ?", [status, targetId]);
    await recordActivity({
      userId: targetId, actorUserId: req.session.userId,
      eventType: "admin.account.status_changed", description: `Account status changed to ${status}.`
    });
    await createNotification({
      userId: targetId, category: "admin",
      title: status === "active" ? "Account reactivated" : "Account deactivated",
      message: status === "active" ? "An administrator reactivated your account." : "An administrator deactivated your account.",
      href: "/dashboard"
    });
    if (status === "inactive") {
      await discoverUserSessions(targetId);
      const sessions = await dbAll("SELECT session_id AS sessionId FROM active_sessions WHERE user_id = ?", [targetId]);
      for (const item of sessions) await destroyStoredSession(item.sessionId);
      await dbRun("DELETE FROM active_sessions WHERE user_id = ?", [targetId]);
    }
    res.set("Cache-Control", "no-store");
    res.json({ user: { ...target, status }, changed: true });
  } catch (error) {
    console.error("Admin account status update error:", error.message);
    res.status(500).json({ error: "Could not update account status." });
  }
});

app.get("/api/admin/activity", requireLogin, requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  try {
    const activity = await dbAll(`SELECT e.id, e.event_type AS eventType, e.status, e.description,
      e.created_at AS createdAt, e.user_id AS userId, u.name AS userName, u.email AS userEmail,
      e.actor_user_id AS actorUserId, a.name AS actorName
      FROM activity_events e LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN users a ON a.id = e.actor_user_id ORDER BY e.id DESC LIMIT ?`, [limit]);
    res.set("Cache-Control", "no-store");
    res.json({ activity });
  } catch (error) {
    console.error("Admin activity error:", error.message);
    res.status(500).json({ error: "Could not load system activity." });
  }
});

app.get("/api/system/status", requireLogin, async (req, res) => {
  try {
    await dbGet("SELECT 1 AS available");
    res.set("Cache-Control", "no-store");
    res.json({
      version: appVersion,
      server: "online",
      database: "available",
      backgroundAgents: agentWorker.getStatus()
    });
  } catch (error) {
    console.error("System status check error:", error.message);
    res.status(503).json({ version: appVersion, server: "online", database: "unavailable" });
  }
});

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
app.use((req, res) => res.status(404).send("Page not found."));
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 3000;
const agentWorker = startAgentWorker({
  filePath: path.join(dataDir, "agent-runs.json"),
  pollMs: Number(process.env.AGENT_POLL_MS) || 5000,
  concurrency: Number(process.env.AGENT_CONCURRENCY) || 2,
  onRunStart: run => notifyAgentRunStarted(run),
  onRunComplete: run => notifyAgentRun(run, true)
});
app.listen(port, () => console.log("Wse Adventures running on port " + port + " with background agents enabled"));
