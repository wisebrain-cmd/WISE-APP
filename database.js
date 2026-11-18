const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { Pool, types } = require("pg");

function postgresSql(sql) {
  let parameter = 0;
  return sql
    .replace(/\bAS\s+([A-Za-z_][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/g, 'AS "$1"')
    .replace(/\?/g, () => `$${++parameter}`);
}

types.setTypeParser(20, value => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
});

const postgresSchema = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    profile_image TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    email_verified_at TIMESTAMPTZ,
    pending_email TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system', accent TEXT NOT NULL DEFAULT 'sage',
    font_size TEXT NOT NULL DEFAULT 'standard', time_zone TEXT NOT NULL DEFAULT 'UTC',
    date_format TEXT NOT NULL DEFAULT 'iso', time_format TEXT NOT NULL DEFAULT '24h',
    provider TEXT NOT NULL DEFAULT 'hybrid', enabled_agents TEXT NOT NULL DEFAULT '[]',
    approval_required INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS active_sessions (
    session_id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS user_app_settings (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS user_search_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS place_reviews (
    id BIGSERIAL PRIMARY KEY,
    location_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (location_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS place_photos (
    location_id TEXT PRIMARY KEY,
    image_data TEXT NOT NULL,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('security', 'account', 'agents', 'admin', 'system', 'general')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    href TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS activity_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS account_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'email_change', 'password_reset')),
    target_email TEXT NOT NULL,
    expires_at_ms BIGINT NOT NULL,
    created_at_ms BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS account_tokens_user_purpose ON account_tokens(user_id, purpose)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_unique ON users(LOWER(pending_email)) WHERE pending_email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS agent_runs_queue ON agent_runs(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_worker_control (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    desired_status TEXT NOT NULL DEFAULT 'running' CHECK (desired_status IN ('running', 'paused', 'offline')),
    started_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    concurrency INTEGER NOT NULL DEFAULT 2,
    poll_ms INTEGER NOT NULL DEFAULT 5000
  )`,
  `CREATE TABLE IF NOT EXISTS wise_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS wise_sessions_expire_idx ON wise_sessions(expire)`,
  `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    hit_count INTEGER NOT NULL CHECK (hit_count >= 0),
    reset_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry ON rate_limit_buckets(reset_at)`
];

function createDatabase({ databaseUrl = process.env.DATABASE_URL, dataDir, adminUserIds = [], production = process.env.NODE_ENV === "production", syncAdminRoles = true } = {}) {
  if (production && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production. Use the shared Render Postgres database.");
  }

  const pool = databaseUrl ? new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  }) : null;
  let sqlite;
  let sqliteFile;

  if (pool) {
    pool.on("error", error => console.error("Postgres pool error:", error.message));
  }

  async function initializePostgres() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of postgresSchema) await client.query(statement);
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT");
      await client.query("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'hybrid'");
      await client.query("ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL");
      await client.query("ALTER TABLE account_tokens ADD COLUMN IF NOT EXISTS target_email TEXT");
      await client.query("INSERT INTO agent_worker_control (id, desired_status) VALUES (1, 'running') ON CONFLICT (id) DO NOTHING");

      if (syncAdminRoles) {
        const ids = [...adminUserIds];
        await client.query("UPDATE users SET role = 'user' WHERE role = 'admin' AND NOT (id = ANY($1::bigint[]))", [ids]);
        if (ids.length) await client.query("UPDATE users SET role = 'admin' WHERE id = ANY($1::bigint[])", [ids]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function initializeSqlite() {
    await fs.promises.mkdir(dataDir, { recursive: true });
    sqliteFile = path.join(dataDir, "wise.db");
    const SQL = await initSqlJs();
    const existing = fs.existsSync(sqliteFile) ? fs.readFileSync(sqliteFile) : undefined;
    sqlite = new SQL.Database(existing);
    sqlite.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, profile_image TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
      email_verified_at TEXT, pending_email TEXT
    )`);
    const userColumns = sqlite.exec("PRAGMA table_info(users)")[0]?.values.map(row => row[1]) || [];
    if (!userColumns.includes("profile_image")) sqlite.run("ALTER TABLE users ADD COLUMN profile_image TEXT");
    if (!userColumns.includes("role")) sqlite.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    if (!userColumns.includes("status")) sqlite.run("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    if (!userColumns.includes("email_verified_at")) sqlite.run("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    if (!userColumns.includes("pending_email")) sqlite.run("ALTER TABLE users ADD COLUMN pending_email TEXT");
    sqlite.run(`CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'system', accent TEXT NOT NULL DEFAULT 'sage',
      font_size TEXT NOT NULL DEFAULT 'standard', time_zone TEXT NOT NULL DEFAULT 'UTC',
      date_format TEXT NOT NULL DEFAULT 'iso', time_format TEXT NOT NULL DEFAULT '24h',
      provider TEXT NOT NULL DEFAULT 'hybrid', enabled_agents TEXT NOT NULL DEFAULT '[]',
      approval_required INTEGER NOT NULL DEFAULT 1
    )`);
    const preferenceColumns = sqlite.exec("PRAGMA table_info(user_preferences)")[0]?.values.map(row => row[1]) || [];
    if (!preferenceColumns.includes("provider")) sqlite.run("ALTER TABLE user_preferences ADD COLUMN provider TEXT NOT NULL DEFAULT 'hybrid'");
    sqlite.run(`CREATE TABLE IF NOT EXISTS active_sessions (
      session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_agent TEXT NOT NULL DEFAULT ''
    )`);
    sqlite.run(`CREATE TABLE IF NOT EXISTS user_app_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    sqlite.run(`CREATE TABLE IF NOT EXISTS user_search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    sqlite.run(`CREATE TABLE IF NOT EXISTS place_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (location_id, user_id)
    )`);
    sqlite.run(`CREATE TABLE IF NOT EXISTS place_photos (
      location_id TEXT PRIMARY KEY, image_data TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const placePhotoColumns = sqlite.exec("PRAGMA table_info(place_photos)")[0]?.values.map(row => row[1]) || [];
    if (!placePhotoColumns.includes("owner_user_id")) sqlite.run("ALTER TABLE place_photos ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
    sqlite.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('security', 'account', 'agents', 'admin', 'system', 'general')),
      title TEXT NOT NULL, message TEXT NOT NULL, href TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT
    )`);
    sqlite.run("CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id, id DESC)");
    sqlite.run("CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications(user_id, read_at)");
    sqlite.run(`CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success', description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    sqlite.run("CREATE INDEX IF NOT EXISTS activity_user_created ON activity_events(user_id, id DESC)");
    sqlite.run("CREATE INDEX IF NOT EXISTS activity_created ON activity_events(id DESC)");
    sqlite.run(`CREATE TABLE IF NOT EXISTS account_tokens (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'email_change', 'password_reset')),
      target_email TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL
    )`);
    const tokenColumns = sqlite.exec("PRAGMA table_info(account_tokens)")[0]?.values.map(row => row[1]) || [];
    if (!tokenColumns.includes("target_email")) sqlite.run("ALTER TABLE account_tokens ADD COLUMN target_email TEXT");
    sqlite.run("CREATE INDEX IF NOT EXISTS account_tokens_user_purpose ON account_tokens(user_id, purpose)");
    sqlite.run("CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_unique ON users(LOWER(pending_email)) WHERE pending_email IS NOT NULL");

    for (const userId of adminUserIds) sqlite.run("UPDATE users SET role = 'admin' WHERE id = ?", [userId]);
    sqlite.run("UPDATE users SET role = 'user' WHERE role = 'admin' AND id NOT IN (" + (adminUserIds.length ? adminUserIds.map(() => "?").join(",") : "-1") + ")", adminUserIds);
    persistSqlite();
  }

  function persistSqlite() {
    if (!sqlite || !sqliteFile) return;
    fs.writeFileSync(sqliteFile, Buffer.from(sqlite.export()));
  }

  const ready = pool ? initializePostgres() : initializeSqlite();

  async function get(sql, params = []) {
    await ready;
    if (pool) return (await pool.query(postgresSql(sql), params)).rows[0] || null;
    const statement = sqlite.prepare(sql);
    try {
      statement.bind(params);
      return statement.step() ? statement.getAsObject() : null;
    } finally {
      statement.free();
    }
  }

  async function all(sql, params = []) {
    await ready;
    if (pool) return (await pool.query(postgresSql(sql), params)).rows;
    const statement = sqlite.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  async function run(sql, params = []) {
    await ready;
    if (pool) {
      const result = await pool.query(postgresSql(sql), params);
      return { lastID: Number(result.rows[0]?.id || 0), changes: result.rowCount || 0, rows: result.rows };
    }
    const statement = sqlite.prepare(sql);
    try {
      statement.bind(params);
      const hasRow = statement.step();
      const returnedRow = hasRow ? statement.getAsObject() : null;
      const changes = sqlite.getRowsModified();
      const row = sqlite.exec("SELECT last_insert_rowid() AS lastID");
      persistSqlite();
      return {
        lastID: Number(returnedRow?.id ?? row[0]?.values?.[0]?.[0] ?? 0),
        changes,
        rows: returnedRow ? [returnedRow] : []
      };
    } finally {
      statement.free();
    }
  }

  async function close() {
    await ready.catch(() => {});
    if (pool) await pool.end();
    else sqlite?.close();
  }

  return { pool, isPostgres: Boolean(pool), ready, get, all, run, close, persist: persistSqlite, sqliteFile };
}

module.exports = { createDatabase };
