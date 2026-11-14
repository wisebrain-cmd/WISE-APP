const fs = require("fs");
const path = require("path");
const { runAgentTeam } = require("./agent-team");

function readRuns(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function writeRuns(filePath, runs) {
  const temp = filePath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(runs, null, 2), { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function startAgentWorker({ filePath, pollMs = 5000, concurrency = 2, onRunStart, onRunComplete } = {}) {
  if (!filePath) throw new Error("A persistent agent run file path is required.");
  const active = new Set();
  let stopped = true;
  let paused = false;
  let polling = false;
  let timer = null;
  let startedAt = null;
  let lastActivityAt = null;

  // Recover jobs interrupted by a server restart. They remain scoped to their original owner.
  const saved = readRuns(filePath);
  let recovered = false;
  for (const run of saved) {
    if (run.status === "running") {
      run.status = run.approvalRequired ? "awaiting_approval" : "queued";
      run.error = "The server restarted before this task finished. It has been re-queued.";
      run.updatedAt = new Date().toISOString();
      recovered = true;
    }
  }
  if (recovered) writeRuns(filePath, saved);

  async function poll() {
    if (stopped || paused || polling) return;
    polling = true;
    try {
      const available = Math.max(0, concurrency - active.size);
      const pending = readRuns(filePath).filter(run => run.status === "queued").slice(0, available);
      for (const run of pending) {
        if (active.has(run.id)) continue;
        active.add(run.id);
        lastActivityAt = new Date().toISOString();
        const execution = runAgentTeam({ filePath, runId: run.id, userId: run.userId });
        Promise.resolve(onRunStart?.(run)).catch(error => console.error("Agent task start notification failed:", error.message));
        execution
          .then(result => {
            lastActivityAt = new Date().toISOString();
            return onRunComplete?.({ ...result, userId: run.userId, approvedBy: result.approvedBy || run.approvedBy });
          })
          .catch(error => console.error("Background agent task failed:", error.message))
          .finally(() => {
            active.delete(run.id);
            lastActivityAt = new Date().toISOString();
          });
      }
    } catch (error) {
      console.error("Background agent worker poll failed:", error.message);
    } finally {
      polling = false;
    }
  }

  function getStatus() {
    return {
      running: !stopped && !paused,
      started: !stopped,
      paused,
      status: stopped ? "offline" : paused ? "paused" : "running",
      active: active.size,
      concurrency,
      pollMs,
      startedAt,
      uptimeMs: startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : 0,
      lastActivityAt
    };
  }

  function start() {
    if (!stopped) return getStatus();
    stopped = false;
    paused = false;
    startedAt = new Date().toISOString();
    lastActivityAt = startedAt;
    timer = setInterval(poll, pollMs);
    timer.unref?.();
    setImmediate(poll);
    return getStatus();
  }

  function pause() {
    if (!stopped) {
      paused = true;
      lastActivityAt = new Date().toISOString();
    }
    return getStatus();
  }

  function resume() {
    if (stopped) return start();
    paused = false;
    lastActivityAt = new Date().toISOString();
    setImmediate(poll);
    return getStatus();
  }

  function restart() {
    stop();
    return start();
  }

  function stop() {
    stopped = true;
    paused = false;
    lastActivityAt = new Date().toISOString();
    if (timer) clearInterval(timer);
    timer = null;
    return getStatus();
  }

  start();
  return {
    start,
    pause,
    resume,
    restart,
    stop,
    getStatus
  };
}

module.exports = { startAgentWorker };
