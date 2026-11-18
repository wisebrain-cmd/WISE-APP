const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { createRun, getAnyRun } = require("./agent-team");
const { startAgentWorker } = require("./agent-worker");

test("worker pause and resume control queue dispatch and report final results", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wse-agent-worker-"));
  const filePath = path.join(directory, "agent-runs.json");
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousHuggingFace = process.env.HF_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.HF_TOKEN;
  t.after(() => {
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousHuggingFace === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = previousHuggingFace;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let resolveCompletion;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  const worker = startAgentWorker({
    filePath,
    pollMs: 10,
    concurrency: 1,
    onRunComplete: resolveCompletion
  });
  t.after(() => worker.stop());
  assert.equal(worker.getStatus().status, "running");
  assert.ok(worker.getStatus().startedAt);
  assert.ok(worker.getStatus().uptimeMs >= 0);
  assert.equal(worker.pause().status, "paused");
  const run = createRun({
    filePath,
    task: "Check worker transitions",
    userId: 55,
    autonomous: true,
    enabledAgents: ["qa"]
  });
  await delay(35);
  assert.equal(getAnyRun(filePath, run.id).status, "queued");

  assert.equal(worker.resume().status, "running");
  const completed = await Promise.race([
    completion,
    delay(2000).then(() => { throw new Error("Worker did not finish its queued task."); })
  ]);
  assert.equal(completed.status, "failed");
  for (let attempt = 0; worker.getStatus().active && attempt < 20; attempt += 1) await delay(5);
  assert.equal(worker.getStatus().active, 0);
  assert.equal(worker.stop().status, "offline");
  assert.ok(worker.getStatus().lastActivityAt);
  assert.equal(worker.getStatus().uptimeMs, 0);
  assert.equal(worker.start().status, "running");
  assert.equal(worker.restart().status, "running");
});
