require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { createDatabase } = require("./database");

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const sqliteFile = path.join(dataDir, "wise.db");
const importTables = [
  "users", "user_preferences", "user_app_settings", "user_search_history",
  "place_reviews", "place_photos", "notifications", "activity_events"
];

function readTable(database, tableName) {
  const result = database.exec(`SELECT * FROM "${tableName}"`)[0];
  if (!result) return { columns: [], rows: [] };
  return { columns: result.columns, rows: result.values };
}

async function main() {
  if (process.env.CONFIRM_SQLITE_IMPORT !== "YES") {
    throw new Error("Set CONFIRM_SQLITE_IMPORT=YES after backing up the source SQLite files.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to the target Postgres database.");
  if (!fs.existsSync(sqliteFile)) throw new Error(`SQLite database not found at ${sqliteFile}. Set DATA_DIR to its directory.`);

  const db = createDatabase({ databaseUrl: process.env.DATABASE_URL, dataDir, production: false, syncAdminRoles: false });
  let source;
  let client;
  let inTransaction = false;
  try {
    await db.ready;
    const SQL = await initSqlJs();
    source = new SQL.Database(fs.readFileSync(sqliteFile));
    const usersTable = source.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'");
    if (!usersTable.length) throw new Error("The SQLite file does not contain the WSE users table.");

    for (const table of importTables) {
      const existing = await db.pool.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
      if (Number(existing.rows[0].count) > 0) {
        throw new Error(`Target table ${table} is not empty. Import only into a fresh Postgres database.`);
      }
    }
    const existingRuns = await db.pool.query("SELECT COUNT(*)::bigint AS count FROM agent_runs");
    if (Number(existingRuns.rows[0].count) > 0) throw new Error("Target table agent_runs is not empty. Import only into a fresh Postgres database.");

    client = await db.pool.connect();
    await client.query("BEGIN");
    inTransaction = true;
    const counts = {};
    for (const table of importTables) {
      const { columns: sourceColumns, rows } = readTable(source, table);
      const targetResult = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
        [table]
      );
      const targetColumns = new Set(targetResult.rows.map(row => row.column_name));
      const columns = sourceColumns.filter(column => targetColumns.has(column));
      if (!columns.length) continue;
      const names = columns.map(column => `"${column}"`).join(", ");
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const insert = `INSERT INTO "${table}" (${names}) VALUES (${placeholders})`;
      let imported = 0;
      for (const values of rows) {
        const sourceRow = Object.fromEntries(sourceColumns.map((column, index) => [column, values[index]]));
        const rowValues = columns.map(column => sourceRow[column]);
        await client.query(insert, rowValues);
        imported += 1;
      }
      counts[table] = imported;
    }

    for (const table of importTables) {
      const idColumn = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'id'",
        [table]
      );
      if (idColumn.rowCount) {
        await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${table}"), 1), 1), EXISTS(SELECT 1 FROM "${table}"))`);
      }
    }

    const runsFile = path.join(dataDir, "agent-runs.json");
    let importedRuns = 0;
    if (fs.existsSync(runsFile)) {
      const savedRuns = JSON.parse(fs.readFileSync(runsFile, "utf8"));
      if (!Array.isArray(savedRuns)) throw new Error("Agent run file must contain a JSON array.");
      for (const run of savedRuns) {
        if (!run || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(run.id || "")
          || !Number.isSafeInteger(Number(run.userId))) continue;
        const exists = await client.query("SELECT 1 FROM users WHERE id = $1", [run.userId]);
        if (!exists.rowCount) continue;
        const payload = { ...run };
        if (payload.status === "running") {
          payload.status = payload.approvalRequired ? "awaiting_approval" : "queued";
          payload.error = "The task was restored during the SQLite to Postgres import.";
          payload.updatedAt = new Date().toISOString();
        }
        await client.query(`INSERT INTO agent_runs (id, user_id, status, payload, created_at, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)`, [
          payload.id, payload.userId, payload.status, JSON.stringify(payload), payload.createdAt || new Date().toISOString(), payload.updatedAt || payload.createdAt || new Date().toISOString()
        ]);
        importedRuns += 1;
      }
    }
    await client.query("COMMIT");
    inTransaction = false;
    console.log("SQLite import completed:", JSON.stringify({ ...counts, agent_runs: importedRuns }));
    console.log("Existing sign-in sessions and pending email tokens were not imported; users must sign in again.");
  } catch (error) {
    if (inTransaction) await client?.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    source?.close();
    client?.release();
    await db.close();
  }
}

main().catch(error => {
  console.error("SQLite import failed:", error.message);
  process.exitCode = 1;
});
