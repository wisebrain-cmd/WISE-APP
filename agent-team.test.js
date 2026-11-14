const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  approveRun, canRetryRun, cancelRun, createRun, getAnyRun, getRun, listRuns, rejectRun, retryRun, runAgentTeam
} = require("./agent-team");

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
  const supervised = createRun({ filePath, task: "Check account settings", userId: 101, autonomous: true, approvalRequired: true });
  assert.equal(supervised.status, "awaiting_approval");
  assert.equal(supervised.approvalRequired, true);
  assert.deepEqual(supervised.enabledAgents, ["project-manager", "frontend", "backend", "security", "qa"]);
});

test("task creation rejects empty and oversized requests", t => {
  const filePath = temporaryStore(t);
  assert.throws(() => createRun({ filePath, task: "  ", userId: 101 }), /between 1 and 4000/);
  assert.throws(() => createRun({ filePath, task: "x".repeat(4001), userId: 101 }), /between 1 and 4000/);
});

test("approval transitions distinguish approved, rejected, and cancelled tasks", t => {
  const filePath = temporaryStore(t);
  const approved = createRun({ filePath, task: "Review settings", userId: 101 });
  const queued = approveRun(filePath, approved.id, 900);
  assert.equal(queued.status, "queued");
  assert.equal(queued.approvedBy, 900);
  assert.ok(queued.approvedAt);
  assert.equal(getAnyRun(filePath, queued.id).status, "queued");
  assert.throws(() => approveRun(filePath, queued.id, 900), { statusCode: 409 });

  const rejected = createRun({ filePath, task: "Review navigation", userId: 101 });
  assert.equal(rejectRun(filePath, rejected.id, 900).status, "rejected");
  const cancelled = createRun({ filePath, task: "Review map", userId: 101, autonomous: true });
  assert.equal(cancelRun(filePath, cancelled.id, 900).status, "cancelled");
  assert.throws(() => cancelRun(filePath, cancelled.id, 900), { statusCode: 409 });
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
  assert.equal(result.status, "failed");
  assert.equal(result.results.length, 5);
  assert.ok(result.results.every(item => item.failed));
  assert.ok(result.results.every(item => /No AI provider is configured/.test(item.output)));
  assert.ok(result.results.every(item => item.errorCategory === "configuration_missing"));

  const selected = createRun({
    filePath, task: "Review session settings", userId: 101,
    enabledAgents: ["qa"], providerPreference: "openai"
  });
  const selectedResult = await runAgentTeam({ filePath, runId: selected.id, userId: 101 });
  assert.equal(selectedResult.status, "failed");
  assert.equal(selectedResult.results.length, 1);
  assert.equal(selectedResult.results[0].agentId, "qa");
  assert.match(selectedResult.results[0].output, /OpenAI is not configured on the server/);
});

test("provider authentication failures are classified without returning response details", async t => {
  const filePath = temporaryStore(t);
  const run = createRun({
    filePath,
    task: "Check provider handling",
    userId: 101,
    enabledAgents: ["qa"],
    providerPreference: "openai"
  });
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-provider-key";
  global.fetch = async () => new Response(JSON.stringify({
    error: { message: "Authorization failed; api_key=sk-secret-value-that-must-not-leak" }
  }), { status: 401, headers: { "Content-Type": "application/json" } });
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
  assert.equal(result.status, "failed");
  assert.equal(result.results[0].errorCategory, "authentication_failure");
  assert.equal(result.results[0].providerAttempts[0].status, "authentication_failure");
  assert.match(result.results[0].output, /could not authenticate/);
  assert.doesNotMatch(JSON.stringify(result), /sk-secret-value/);
});

test("provider rate limits and credit failures are reported with safe retry guidance", async t => {
  const filePath = temporaryStore(t);
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-provider-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  for (const [status, message, category, retryable] of [
    [429, "rate limit reached", "rate_limited", true],
    [402, "billing credits exhausted", "credits_unavailable", false]
  ]) {
    global.fetch = async () => new Response(JSON.stringify({ error: { message } }), {
      status, headers: { "Content-Type": "application/json" }
    });
    const run = createRun({
      filePath, task: "Test provider status", userId: 101,
      enabledAgents: ["qa"], providerPreference: "openai"
    });
    const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
    assert.equal(result.status, "failed");
    assert.equal(result.results[0].errorCategory, category);
    assert.equal(result.results[0].retryable, retryable);
    assert.equal(result.results[0].providerAttempts[0].httpStatus, status);
    assert.doesNotMatch(JSON.stringify(result), /billing credits exhausted/);
    assert.match(result.results[0].output, status === 429 ? /rate limit reached/ : /credits or quota are unavailable/);
  }
});

test("invalid provider configuration is not marked retryable", async t => {
  const filePath = temporaryStore(t);
  const run = createRun({
    filePath,
    task: "Check invalid provider model configuration",
    userId: 101,
    enabledAgents: ["qa"],
    providerPreference: "openai"
  });
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-provider-key";
  global.fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid model" } }), {
    status: 404, headers: { "Content-Type": "application/json" }
  });
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
  assert.equal(result.status, "failed");
  assert.equal(result.results[0].errorCategory, "configuration_invalid");
  assert.equal(result.results[0].retryable, false);
  assert.match(result.results[0].output, /rejected the configured model or request configuration/);
  assert.equal(canRetryRun(result), false);
});

test("retry queues only transiently failed agents once", async t => {
  const filePath = temporaryStore(t);
  const run = createRun({
    filePath,
    task: "Review transient provider recovery",
    userId: 101,
    enabledAgents: ["frontend", "backend"],
    providerPreference: "openai"
  });
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-provider-key";
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.messages[0].content.includes("Frontend Developer")) {
      return new Response(JSON.stringify({ error: { message: "Temporary provider outage" } }), {
        status: 503, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Review complete." } }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
  assert.equal(result.status, "completed_with_errors");
  assert.equal(canRetryRun(result), true);
  const retried = retryRun(filePath, result.id, 900);
  assert.equal(retried.status, "queued");
  assert.deepEqual(retried.enabledAgents, ["frontend"]);
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.retryOf, result.id);
  assert.equal(retried.approvedBy, 900);

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const retriedRun = persisted.find(item => item.id === retried.id);
  retriedRun.status = "failed";
  retriedRun.results = [{ agentId: "frontend", failed: true, retryable: true }];
  fs.writeFileSync(filePath, JSON.stringify(persisted));
  assert.equal(canRetryRun(retriedRun), false);
  assert.throws(() => retryRun(filePath, retried.id, 900), { statusCode: 409 });
});

test("partial provider failures are reported as completed with errors", async t => {
  const filePath = temporaryStore(t);
  const run = createRun({
    filePath,
    task: "Review deployment",
    userId: 101,
    enabledAgents: ["frontend", "backend"],
    providerPreference: "openai"
  });
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  let callCount = 0;
  process.env.OPENAI_API_KEY = "test-provider-key";
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Review complete." } }] }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: { message: "Internal server failure" } }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  });

  const result = await runAgentTeam({ filePath, runId: run.id, userId: 101 });
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.results.filter(item => item.failed).length, 1);
  assert.equal(result.results.filter(item => !item.failed).length, 1);
  assert.equal(result.results.find(item => item.failed).errorCategory, "unavailable");
});
