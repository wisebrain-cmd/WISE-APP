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

function startAgentWorker({ filePath, pollMs = 5000, concurrency = 2 } = {}) {
  if (!filePath) throw new Error("A persistent agent run file path is required.");
  const active = new Set();
  let stopped = false;
  let polling = false;

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
    if (stopped || polling) return;
    polling = true;
    try {
      const available = Math.max(0, concurrency - active.size);
      const pending = readRuns(filePath).filter(run => run.status === "queued").slice(0, available);
      for (const run of pending) {
        if (active.has(run.id)) continue;
        active.add(run.id);
        runAgentTeam({ filePath, runId: run.id, userId: run.userId })
          .catch(error => console.error("Background agent task failed:", error.message))
          .finally(() => active.delete(run.id));
      }
    } catch (error) {
      console.error("Background agent worker poll failed:", error.message);
    } finally {
      polling = false;
    }
  }

  const timer = setInterval(poll, pollMs);
  timer.unref?.();
  setImmediate(poll);
  return {
    stop() { stopped = true; clearInterval(timer); },
    getStatus() { return { running: !stopped, active: active.size, concurrency, pollMs }; }
  };
}

module.exports = { startAgentWorker };
