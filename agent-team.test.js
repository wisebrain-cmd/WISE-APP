const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRun, getRun, listRuns, runAgentTeam } = require("./agent-team");

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wse-agent-test-"));
  const filePath = path.join(directory, "agent-runs.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return filePath;
}

test("new tasks wait for approval and remain private to their owner", t => {
  const filePath = temporaryStore(t);
  const run = createRun({ filePath, task: "Review the registration flow", userId: 101 });
  assert.equal(run.status, "awaiting_approval");
  assert.equal(run.approvalRequired, true);
  assert.equal(getRun(filePath, run.id, 202), null);
  assert.equal(listRuns(filePath, 101).length, 1);
  assert.equal(listRuns(filePath, 202).length, 0);
});

test("task creation rejects empty and oversized requests", t => {
  const filePath = temporaryStore(t);
  assert.throws(() => createRun({ filePath, task: "  ", userId: 101 }), /between 1 and 4000/);
  assert.throws(() => createRun({ filePath, task: "x".repeat(4001), userId: 101 }), /between 1 and 4000/);
});

test("agent execution fails safely when no provider credentials exist", async t => {
  const filePath = temporaryStore(t);
  const run = createRun({ filePath, task: "Review the homepage", userId: 101 });
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousHF = process.env.HF_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.HF_TOKEN;
  t.after(() => {
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousHF === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = previousHF;
  });

  await assert.rejects(
    runAgentTeam({ filePath, runId: run.id, userId: 101 }),
    error => error.statusCode === 503 && /Configure OPENAI_API_KEY/.test(error.message)
  );
  assert.equal(getRun(filePath, run.id, 101).status, "failed");
});
