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
      "img-src": ["'self'", "data:", "https://tile.openstreetmap.de", "https://images.unsplash.com"]
    }
  }
}));
app.use(express.json({ limit: "10kb" }));

app.use(session({
  name: "wise.sid",
  secret: sessionSecret,
  store: new FileStore({ path: dataDir, ttl: 60 * 60 * 24, logFn: () => { } }),
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
  next();
}
function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email };
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
  "/map-ui.js": "map-ui.js",
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
  "/vendor/markercluster.js": ["leaflet.markercluster", "dist/leaflet.markercluster.js"]
};
for (const [route, [packageName, file]] of Object.entries(vendorFiles)) {
  app.get(route, (req, res) => res.sendFile(file, {
    root: path.join(__dirname, "node_modules", packageName)
  }));
}
app.get("/agents", requireLogin, (req, res) => res.sendFile("agents.html", { root: __dirname }));

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
    res.json({ user });
  } catch (error) {
    console.error("Session status error:", error.message);
    res.status(500).json({ error: "Could not load session status." });
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
    await dbRun("UPDATE users SET name = ? WHERE id = ?", [cleanName, req.session.userId]);
    const user = await dbGet("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(401).json({ error: "Account not found. Please sign in again." });
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ error: "Could not update your profile." });
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

app.get("/api/agents/roles", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    mode: "hybrid",
    approvalRequired: true,
    agents: AGENTS.map(({ id, name, focus }) => ({ id, name, focus }))
  });
});

app.get("/api/agents/runs", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ runs: listRuns(path.join(dataDir, "agent-runs.json"), req.session.userId) });
});

app.post("/api/agents/runs", requireLogin, requireCsrf, agentLimiter, (req, res) => {
  try {
    const run = createRun({
      filePath: path.join(dataDir, "agent-runs.json"),
      task: req.body?.task,
      userId: req.session.userId,
      autonomous: req.body?.autonomous === true
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
