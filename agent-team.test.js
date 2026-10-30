const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRun, getRun, listRuns, runAgentTeam, providerErrorMessage } = require("./agent-team");

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
  const automatic = createRun({ filePath, task: "Check broken links", userId: 101, autonomous: true });
  assert.equal(automatic.status, "queued");
  assert.equal(automatic.approvalRequired, false);
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

  const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.results.length, 5);
  assert.ok(result.results.every(item => item.failed));
});


test("Hugging Face 403 errors explain the required inference permission", () => {
  const message = providerErrorMessage(
    { error: { message: "Forbidden" } },
    403,
    "Hugging Face"
  );
  assert.match(message, /HTTP 403/);
  assert.match(message, /Make calls to Inference Providers/);
});

test("provider error parser handles string error bodies", () => {
  const message = providerErrorMessage(
    { error: "Model is not available through an inference provider" },
    400,
    "Hugging Face"
  );
  assert.match(message, /Model is not available/);
  assert.match(message, /HF_MODEL/);
});
