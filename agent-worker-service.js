require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });
const path = require("node:path");
const { createDatabase } = require("./database");
const { createPostgresAgentRunStore } = require("./agent-run-store");
const { startAgentWorker } = require("./agent-worker");

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const db = createDatabase({ dataDir, adminUserIds: [], production: true, syncAdminRoles: false });

async function recordActivity({ userId, actorUserId, eventType, status = "success", description }) {
  await db.run("INSERT INTO activity_events (user_id, actor_user_id, event_type, status, description) VALUES (?, ?, ?, ?, ?)", [
    userId, actorUserId, eventType, status, description
  ]);
}

async function notify(userId, { title, message }) {
  const row = await db.get("SELECT settings_json AS settingsJson FROM user_app_settings WHERE user_id = ?", [userId]);
  let settings = {};
  try { settings = JSON.parse(row?.settingsJson || "{}"); } catch { }
  if (settings.notifications?.agentNotifications === false) return;
  await db.run("INSERT INTO notifications (user_id, category, title, message, href) VALUES (?, 'agents', ?, ?, '/agents')", [userId, title, message]);
}

async function notifyAdmins({ title, message }) {
  const admins = await db.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  await Promise.all(admins.map(admin => notify(admin.id, { title, message })));
}

async function onRunStart(run) {
  if (!run?.userId) return;
  await recordActivity({
    userId: run.userId,
    actorUserId: run.approvedBy || run.userId,
    eventType: "agent.run.started",
    description: "An AI agent task started processing."
  });
  await notify(run.userId, { title: "Agent task started", message: "Your approved agent task is now being processed." });
}

async function onRunComplete(run) {
  if (!run?.userId) return;
  const failed = run.status === "failed" || run.status === "completed_with_errors";
  await recordActivity({
    userId: run.userId,
    actorUserId: run.approvedBy || run.userId,
    eventType: failed ? "agent.run.failed" : "agent.run.completed",
    status: run.status === "failed" ? "error" : failed ? "warning" : "success",
    description: failed ? "An AI agent run finished with provider errors." : "An AI agent run completed."
  });
  await notify(run.userId, {
    title: failed ? "Agent run needs attention" : "Agent run completed",
    message: failed ? `${(run.results || []).filter(result => result.failed).length} agent(s) could not complete. Review the task for details.` : "Your agent task has finished."
  });
  if (failed) await notifyAdmins({ title: "Agent run failed", message: "An agent task encountered provider or execution errors. Review the control center." });
}

async function main() {
  await db.ready;
  const store = createPostgresAgentRunStore(db.pool);
  const worker = startAgentWorker({
    store,
    pollMs: Number(process.env.AGENT_POLL_MS) || 5000,
    concurrency: Number(process.env.AGENT_CONCURRENCY) || 2,
    onRunStart,
    onRunComplete
  });
  const keepAlive = setInterval(() => {}, 60_000);
  console.log("WSE Adventures shared agent worker started.");

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`WSE Adventures agent worker received ${signal}; shutting down.`);
    clearInterval(keepAlive);
    worker.stop();
    await db.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(async error => {
  console.error("WSE Adventures agent worker failed to start:", error);
  await db.close();
  process.exitCode = 1;
});
