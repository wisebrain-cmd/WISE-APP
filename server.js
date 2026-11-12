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
const { AGENTS, createRun, listRuns, runAgentTeam } = require("./agent-team");
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const userColumns = db.exec("PRAGMA table_info(users)")[0]?.values.map(row => row[1]) || [];
  if (!userColumns.includes("profile_image")) db.run("ALTER TABLE users ADD COLUMN profile_image TEXT");
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
      "img-src": ["'self'", "data:", "https://tile.openstreetmap.de", "https://server.arcgisonline.com", "https://images.unsplash.com"],
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
  recordActiveSession(req, req.session.userId)
    .then(() => next())
    .catch(error => {
      console.error("Active session tracking error:", error.message);
      res.status(500).json({ error: "Could not verify your signed-in session." });
    });
}
function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email };
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
  "/favicon.svg": "favicon.svg",
  "/styles.css": "styles.css",
  "/script.js": "script.js",
  "/preferences.js": "preferences.js",
  "/settings.css": "settings.css",
  "/settings.js": "settings.js",
  "/settings-schema.js": "settings-schema.js",
  "/map-ui.js": "map-ui.js",
  "/maplibre-loader.mjs": "maplibre-loader.mjs",
  "/locations.json": "locations.json",
  "/login.html": "login.html",
  "/auth.css": "auth.css",
  "/auth.js": "auth.js",
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
app.get("/settings", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html?next=%2Fsettings");
  res.sendFile("settings.html", { root: __dirname });
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
const locationIdPattern = /^(?:geonames-\d+|osm-(?:node|way|relation)-\d+)$/;
const overpassUrl = process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";

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
    await regenerateSession(req);
    req.session.userId = created.lastID;
    const csrfToken = createCsrfToken(req);
    await saveSession(req);
    await recordActiveSession(req, created.lastID);
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
    await recordActiveSession(req, user.id);
    res.json({ user: cleanUser(user), csrfToken });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.get("/api/me", requireLogin, async (req, res) => {
  try {
    const user = await dbGet("SELECT id, name, email, profile_image AS profileImage FROM users WHERE id = ?", [req.session.userId]);
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
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    if (!user) {
      req.session.destroy(error => {
        if (error) console.error("Expired session cleanup error:", error.message);
      });
      return res.json({ user: null });
    }
    await recordActiveSession(req, user.id);
    res.json({ user });
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
    const user = await dbGet("SELECT id, name, email, profile_image AS profileImage FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(401).json({ error: "Account not found. Please sign in again." });
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
    res.set("Cache-Control", "no-store");
    res.json({ preferences: next });
  } catch (error) {
    console.error("Settings save error:", error.message);
    res.status(500).json({ error: "Could not save your settings." });
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
    await dbRun("DELETE FROM place_reviews WHERE user_id = ?", [userId]);
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

app.post("/api/logout", requireLogin, requireCsrf, (req, res) => {
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
    const run = await runAgentTeam({
      filePath: path.join(dataDir, "agent-runs.json"),
      runId: req.params.runId,
      userId: req.session.userId
    });
    res.json({
      message: "The five agents completed their review. No repository files were changed.",
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
  try {
    const status = await getConnectionStatus();
    res.json(status);
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
  concurrency: Number(process.env.AGENT_CONCURRENCY) || 2
});
app.listen(port, () => console.log("Wse Adventures running on port " + port + " with background agents enabled"));
