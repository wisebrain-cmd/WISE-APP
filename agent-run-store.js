const crypto = require("node:crypto");
const { canRetryRun } = require("./agent-team");

function createPostgresAgentRunStore(pool) {
  if (!pool) throw new Error("A Postgres pool is required for shared agent storage.");

  async function withTransaction(operation) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function insertRun(client, run) {
    await client.query(`INSERT INTO agent_runs (id, user_id, status, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)`, [
      run.id, run.userId, run.status, JSON.stringify(run), run.createdAt, run.updatedAt
    ]);
  }

  function notFound() {
    const error = new Error("Agent task not found.");
    error.statusCode = 404;
    return error;
  }

  async function createRun(run) {
    return withTransaction(async client => {
      await insertRun(client, run);
      await client.query(`DELETE FROM agent_runs WHERE id IN (
        SELECT id FROM agent_runs ORDER BY created_at DESC, id DESC OFFSET 50
      )`);
      return run;
    });
  }

  async function getRun(runId, userId) {
    const result = await pool.query("SELECT payload FROM agent_runs WHERE id = $1 AND user_id = $2", [runId, userId]);
    return result.rows[0]?.payload || null;
  }

  async function getAnyRun(runId) {
    const result = await pool.query("SELECT payload FROM agent_runs WHERE id = $1", [runId]);
    return result.rows[0]?.payload || null;
  }

  async function listAllRuns() {
    const result = await pool.query("SELECT payload FROM agent_runs ORDER BY created_at DESC, id DESC LIMIT 50");
    return result.rows.map(row => row.payload);
  }

  async function listRuns(userId) {
    const result = await pool.query("SELECT payload FROM agent_runs WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20", [userId]);
    return result.rows.map(row => row.payload);
  }

  async function updateRun(runId, userId, patch) {
    return withTransaction(async client => {
      const result = await client.query("SELECT payload FROM agent_runs WHERE id = $1 AND user_id = $2 FOR UPDATE", [runId, userId]);
      if (!result.rows[0]) return null;
      const current = result.rows[0].payload;
      const updatedAt = new Date().toISOString();
      const next = { ...current, ...patch, updatedAt };
      await client.query(`UPDATE agent_runs SET status = $2, payload = $3::jsonb,
        updated_at = $4, lease_until = CASE WHEN $2 = 'running' THEN lease_until ELSE NULL END
        WHERE id = $1`, [runId, next.status, JSON.stringify(next), updatedAt]);
      return next;
    });
  }

  async function transitionRun(runId, expectedStatuses, patch) {
    return withTransaction(async client => {
      const result = await client.query("SELECT payload FROM agent_runs WHERE id = $1 FOR UPDATE", [runId]);
      if (!result.rows[0]) return null;
      const current = result.rows[0].payload;
      if (!expectedStatuses.includes(current.status)) {
        const error = new Error("This agent task can no longer be changed in its current state.");
        error.statusCode = 409;
        throw error;
      }
      const updatedAt = new Date().toISOString();
      const next = { ...current, ...patch, updatedAt };
      await client.query(`UPDATE agent_runs SET status = $2, payload = $3::jsonb,
        updated_at = $4, lease_until = CASE WHEN $2 = 'running' THEN lease_until ELSE NULL END
        WHERE id = $1`, [runId, next.status, JSON.stringify(next), updatedAt]);
      return next;
    });
  }

  async function startRun(runId, userId) {
    return withTransaction(async client => {
      const result = await client.query("SELECT payload FROM agent_runs WHERE id = $1 AND user_id = $2 FOR UPDATE", [runId, userId]);
      if (!result.rows[0]) throw notFound();
      const current = result.rows[0].payload;
      if (!["awaiting_approval", "queued"].includes(current.status)) {
        const error = new Error("This task is not ready to run.");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      const next = { ...current, status: "running", error: null, startedAt: now, updatedAt: now };
      await client.query(`UPDATE agent_runs SET status = 'running', payload = $2::jsonb,
        updated_at = $3, lease_until = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [runId, JSON.stringify(next), now]);
      return next;
    });
  }

  async function retryRun(runId, actorUserId) {
    return withTransaction(async client => {
      const result = await client.query("SELECT payload FROM agent_runs WHERE id = $1 FOR UPDATE", [runId]);
      if (!result.rows[0]) throw notFound();
      const original = result.rows[0].payload;
      if (!canRetryRun(original)) {
        const error = new Error("This task cannot be retried because it did not fail temporarily or has already been retried.");
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      const failedAgents = original.results.filter(resultItem => resultItem.failed).map(resultItem => resultItem.agentId);
      const retry = {
        id: crypto.randomUUID(),
        userId: original.userId,
        task: original.task,
        status: "queued",
        approvalRequired: false,
        enabledAgents: failedAgents,
        providerPreference: original.providerPreference,
        createdAt: now,
        updatedAt: now,
        provider: null,
        results: [],
        error: null,
        retryOf: original.id,
        retryCount: Number(original.retryCount || 0) + 1,
        approvedBy: actorUserId,
        approvedAt: now
      };
      const updatedOriginal = { ...original, retryCount: 1, updatedAt: now };
      await client.query("UPDATE agent_runs SET payload = $2::jsonb, updated_at = $3 WHERE id = $1", [runId, JSON.stringify(updatedOriginal), now]);
      await insertRun(client, retry);
      await client.query(`DELETE FROM agent_runs WHERE id IN (
        SELECT id FROM agent_runs ORDER BY created_at DESC, id DESC OFFSET 50
      )`);
      return retry;
    });
  }

  async function removeUserRuns(userId) {
    await pool.query("DELETE FROM agent_runs WHERE user_id = $1", [userId]);
  }

  async function claimQueuedRuns(limit) {
    if (limit <= 0) return [];
    return withTransaction(async client => {
      const result = await client.query(`WITH candidates AS (
          SELECT id FROM agent_runs
          WHERE status = 'queued' OR (status = 'running' AND lease_until < NOW())
          ORDER BY created_at ASC, id ASC
          LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        UPDATE agent_runs AS runs SET status = 'running',
          payload = runs.payload || jsonb_build_object('status', 'running', 'startedAt', NOW(), 'updatedAt', NOW()),
          updated_at = NOW(), lease_until = NOW() + INTERVAL '10 minutes'
        FROM candidates WHERE runs.id = candidates.id
        RETURNING runs.payload`, [limit]);
      if (result.rowCount) await client.query("UPDATE agent_worker_control SET last_activity_at = NOW() WHERE id = 1");
      return result.rows.map(row => row.payload);
    });
  }

  async function renewRunLease(runId) {
    await pool.query("UPDATE agent_runs SET lease_until = NOW() + INTERVAL '10 minutes' WHERE id = $1 AND status = 'running'", [runId]);
  }

  async function removeRunLease(runId) {
    await pool.query("UPDATE agent_runs SET lease_until = NULL WHERE id = $1", [runId]);
  }

  async function getWorkerControl() {
    const result = await pool.query("SELECT desired_status AS \"desiredStatus\", started_at AS \"startedAt\", last_activity_at AS \"lastActivityAt\", last_heartbeat_at AS \"lastHeartbeatAt\", concurrency, poll_ms AS \"pollMs\" FROM agent_worker_control WHERE id = 1");
    return result.rows[0] || { desiredStatus: "offline", concurrency: 2, pollMs: 5000 };
  }

  async function getWorkerStatus() {
    const [control, running] = await Promise.all([
      getWorkerControl(),
      pool.query("SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'running'")
    ]);
    const heartbeatAt = control.lastHeartbeatAt ? Date.parse(control.lastHeartbeatAt) : 0;
    const isLive = Boolean(heartbeatAt && Date.now() - heartbeatAt < Math.max(30000, Number(control.pollMs || 5000) * 3));
    const status = !isLive || control.desiredStatus === "offline" ? "offline" : control.desiredStatus;
    const startedAt = control.startedAt ? new Date(control.startedAt).toISOString() : null;
    return {
      running: status === "running",
      started: status !== "offline",
      paused: status === "paused",
      status,
      active: Number(running.rows[0]?.count || 0),
      concurrency: Number(control.concurrency || 2),
      pollMs: Number(control.pollMs || 5000),
      startedAt,
      uptimeMs: status === "offline" || !startedAt ? 0 : Math.max(0, Date.now() - Date.parse(startedAt)),
      lastActivityAt: control.lastActivityAt ? new Date(control.lastActivityAt).toISOString() : null
    };
  }

  async function setWorkerStatus(action) {
    const desiredStatus = action === "pause" ? "paused" : action === "stop" ? "offline" : "running";
    const result = await pool.query(`UPDATE agent_worker_control SET desired_status = $1,
      started_at = CASE WHEN $1 = 'running' AND $2 THEN NOW() ELSE started_at END,
      last_activity_at = NOW() WHERE id = 1 RETURNING id`, [desiredStatus, action === "start" || action === "restart"]);
    if (!result.rowCount) await pool.query("INSERT INTO agent_worker_control (id, desired_status, started_at, last_activity_at) VALUES (1, $1, CASE WHEN $1 = 'running' THEN NOW() END, NOW()) ON CONFLICT (id) DO NOTHING", [desiredStatus]);
    return getWorkerStatus();
  }

  async function heartbeatWorker({ concurrency, pollMs }) {
    await pool.query(`UPDATE agent_worker_control SET last_heartbeat_at = NOW(),
      concurrency = $1, poll_ms = $2,
      started_at = CASE WHEN desired_status <> 'offline' AND started_at IS NULL THEN NOW() ELSE started_at END
      WHERE id = 1`, [concurrency, pollMs]);
  }

  return {
    createRun, getRun, getAnyRun, listAllRuns, listRuns, updateRun, transitionRun,
    startRun, retryRun, removeUserRuns, claimQueuedRuns, renewRunLease, removeRunLease,
    getWorkerControl, getWorkerStatus, setWorkerStatus, heartbeatWorker
  };
}

module.exports = { createPostgresAgentRunStore };
