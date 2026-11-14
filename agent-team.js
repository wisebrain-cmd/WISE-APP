const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AGENTS = [
  {
    id: "project-manager",
    name: "Project Manager",
    focus: "Break the request into a safe, ordered plan, identify dependencies, and define acceptance criteria."
  },
  {
    id: "frontend",
    name: "Frontend Developer",
    focus: "Review frontend implications, user experience, accessibility, responsive layout, and browser-side implementation."
  },
  {
    id: "backend",
    name: "Backend Developer",
    focus: "Review server routes, data models, integrations, validation, and backend implementation."
  },
  {
    id: "security",
    name: "Security Reviewer",
    focus: "Identify authentication, authorization, input validation, secret handling, privacy, and dependency risks."
  },
  {
    id: "qa",
    name: "QA Tester",
    focus: "Design practical tests, edge cases, regression checks, and clear acceptance criteria."
  }
];

function readRuns(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function writeRuns(filePath, runs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + ".tmp";
  fs.writeFileSync(temporaryPath, JSON.stringify(runs, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function createRun({ filePath, task, userId, autonomous = false, approvalRequired = false, enabledAgents = AGENTS.map(agent => agent.id), providerPreference = "hybrid" }) {
  const normalizedTask = typeof task === "string" ? task.trim() : "";
  if (!normalizedTask || normalizedTask.length > 4000) {
    const error = new Error("Task must contain between 1 and 4000 characters.");
    error.statusCode = 400;
    throw error;
  }

  const runs = readRuns(filePath);
  const allowedAgents = AGENTS.map(agent => agent.id).filter(id => enabledAgents.includes(id));
  if (!allowedAgents.length) {
    const error = new Error("Enable at least one AI agent before creating a task.");
    error.statusCode = 400;
    throw error;
  }
  if (!["hybrid", "openai", "huggingface"].includes(providerPreference)) {
    const error = new Error("Choose a supported AI provider preference.");
    error.statusCode = 400;
    throw error;
  }
  const runAutomatically = autonomous && !approvalRequired;
  const run = {
    id: crypto.randomUUID(),
    userId,
    task: normalizedTask,
    status: runAutomatically ? "queued" : "awaiting_approval",
    approvalRequired: !runAutomatically,
    enabledAgents: allowedAgents,
    providerPreference,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: null,
    results: [],
    error: null
  };
  runs.unshift(run);
  writeRuns(filePath, runs.slice(0, 50));
  return publicRun(run);
}

function publicRun(run) {
  const { userId, ...safeRun } = run;
  return safeRun;
}

function getRun(filePath, runId, userId) {
  return readRuns(filePath).find(run => run.id === runId && run.userId === userId) || null;
}

function getAnyRun(filePath, runId) {
  return readRuns(filePath).find(run => run.id === runId) || null;
}

function listAllRuns(filePath) {
  return readRuns(filePath);
}

function updateRun(filePath, runId, userId, patch) {
  const runs = readRuns(filePath);
  const index = runs.findIndex(run => run.id === runId && run.userId === userId);
  if (index < 0) return null;
  runs[index] = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  writeRuns(filePath, runs);
  return runs[index];
}

function transitionRun(filePath, runId, expectedStatuses, patch) {
  const runs = readRuns(filePath);
  const index = runs.findIndex(run => run.id === runId);
  if (index < 0) return null;
  if (!expectedStatuses.includes(runs[index].status)) {
    const error = new Error("This agent task can no longer be changed in its current state.");
    error.statusCode = 409;
    throw error;
  }
  runs[index] = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  writeRuns(filePath, runs);
  return publicRun(runs[index]);
}

function approveRun(filePath, runId, actorUserId) {
  return transitionRun(filePath, runId, ["awaiting_approval"], {
    status: "queued",
    approvedAt: new Date().toISOString(),
    approvedBy: actorUserId
  });
}

function rejectRun(filePath, runId, actorUserId) {
  return transitionRun(filePath, runId, ["awaiting_approval"], {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    rejectedBy: actorUserId
  });
}

function cancelRun(filePath, runId, actorUserId) {
  return transitionRun(filePath, runId, ["awaiting_approval", "queued"], {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    cancelledBy: actorUserId
  });
}

function canRetryRun(run) {
  const failedResults = (run.results || []).filter(result => result.failed);
  return ["failed", "completed_with_errors"].includes(run.status)
    && Number(run.retryCount || 0) < 1
    && failedResults.length > 0
    && failedResults.every(result => result.retryable);
}

function retryRun(filePath, runId, actorUserId) {
  const original = getAnyRun(filePath, runId);
  if (!original) {
    const error = new Error("Agent task not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!canRetryRun(original)) {
    const error = new Error("This task cannot be retried because it did not fail temporarily or has already been retried.");
    error.statusCode = 409;
    throw error;
  }
  const failedAgents = original.results.filter(result => result.failed).map(result => result.agentId);
  const retried = createRun({
    filePath,
    task: original.task,
    userId: original.userId,
    autonomous: true,
    enabledAgents: failedAgents,
    providerPreference: original.providerPreference
  });
  const runs = readRuns(filePath);
  const index = runs.findIndex(run => run.id === retried.id);
  runs[index] = {
    ...runs[index],
    retryOf: original.id,
    retryCount: Number(original.retryCount || 0) + 1,
    approvedBy: actorUserId,
    approvedAt: new Date().toISOString()
  };
  writeRuns(filePath, runs);
  return publicRun(runs[index]);
}

function listRuns(filePath, userId) {
  return readRuns(filePath)
    .filter(run => run.userId === userId)
    .slice(0, 20)
    .map(publicRun);
}

function providerFailure(provider, status, body, cause) {
  const responseText = typeof body === "string" ? body : JSON.stringify(body || {});
  const isCreditFailure = status === 402 || /credit|billing|quota exceeded/i.test(responseText);
  const isInvalidConfiguration = status === 400 || status === 404;
  const category = isCreditFailure
    ? "credits_unavailable"
    : isInvalidConfiguration
      ? "configuration_invalid"
    : status === 401 || status === 403
      ? "authentication_failure"
      : status === 429
        ? "rate_limited"
        : status === 503 && /not configured/i.test(cause?.message || "")
          ? "configuration_missing"
          : "unavailable";
  const name = provider === "openai" ? "OpenAI" : "Hugging Face";
  const message = category === "credits_unavailable"
    ? `${name} credits or quota are unavailable.`
    : category === "authentication_failure"
      ? `${name} could not authenticate the configured credentials.`
      : category === "configuration_invalid"
        ? `${name} rejected the configured model or request configuration.`
      : category === "rate_limited"
        ? `${name} rate limit reached. Try again later.`
        : category === "configuration_missing"
          ? `${name} is not configured on the server.`
          : `${name} could not complete the request. Try again later.`;
  const error = new Error(message);
  error.provider = provider;
  error.category = category;
  error.httpStatus = Number.isInteger(status) ? status : null;
  error.retryable = category === "rate_limited" || category === "unavailable";
  error.statusCode = status === 401 || status === 403 ? 502 : 503;
  return error;
}

async function requestOpenAI(messages) {
  if (!process.env.OPENAI_API_KEY) throw providerFailure("openai", 503, {}, new Error("not configured"));
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerFailure("openai", response.status, data);
    const result = data.choices?.[0]?.message?.content;
    if (typeof result !== "string" || !result.trim()) throw providerFailure("openai", 502);
    return { text: result.trim(), provider: "openai" };
  } catch (error) {
    if (error.provider) throw error;
    throw providerFailure("openai", null, null, error);
  }
}

async function requestHuggingFace(messages) {
  if (!process.env.HF_TOKEN) throw providerFailure("huggingface", 503, {}, new Error("not configured"));
  try {
    const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.HF_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.HF_MODEL || "Qwen/Qwen2.5-72B-Instruct",
        messages,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerFailure("huggingface", response.status, data);
    const result = data.choices?.[0]?.message?.content;
    if (typeof result !== "string" || !result.trim()) throw providerFailure("huggingface", 502);
    return { text: result.trim(), provider: "huggingface" };
  } catch (error) {
    if (error.provider) throw error;
    throw providerFailure("huggingface", null, null, error);
  }
}

async function callHybrid(messages, providerPreference = "hybrid") {
  const attempts = [];
  if (providerPreference === "openai") {
    try {
      const result = await requestOpenAI(messages);
      return { ...result, providerAttempts: [{ provider: result.provider, status: "available", checkedAt: new Date().toISOString() }] };
    } catch (error) {
      attempts.push({ provider: error.provider, status: error.category, httpStatus: error.httpStatus, retryable: error.retryable, checkedAt: new Date().toISOString() });
      error.providerAttempts = attempts;
      throw error;
    }
  }
  if (providerPreference === "huggingface") {
    try {
      const result = await requestHuggingFace(messages);
      return { ...result, providerAttempts: [{ provider: result.provider, status: "available", checkedAt: new Date().toISOString() }] };
    } catch (error) {
      attempts.push({ provider: error.provider, status: error.category, httpStatus: error.httpStatus, retryable: error.retryable, checkedAt: new Date().toISOString() });
      error.providerAttempts = attempts;
      throw error;
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await requestOpenAI(messages);
      attempts.push({ provider: result.provider, status: "available", checkedAt: new Date().toISOString() });
      return { ...result, providerAttempts: attempts };
    } catch (error) {
      attempts.push({ provider: error.provider, status: error.category, httpStatus: error.httpStatus, retryable: error.retryable, checkedAt: new Date().toISOString() });
    }
  }
  if (process.env.HF_TOKEN) {
    try {
      const result = await requestHuggingFace(messages);
      attempts.push({ provider: result.provider, status: "available", checkedAt: new Date().toISOString() });
      return { ...result, providerAttempts: attempts };
    } catch (error) {
      attempts.push({ provider: error.provider, status: error.category, httpStatus: error.httpStatus, retryable: error.retryable, checkedAt: new Date().toISOString() });
    }
  }
  const error = new Error(attempts.length
    ? "All configured AI providers are unavailable."
    : "No AI provider is configured on the server.");
  error.provider = attempts.length ? "hybrid" : "hybrid";
  error.category = attempts.length ? "unavailable" : "configuration_missing";
  error.retryable = attempts.some(attempt => attempt.retryable);
  error.providerAttempts = attempts;
  error.statusCode = 503;
  throw error;
}

async function runAgentTeam({ filePath, runId, userId }) {
  const current = getRun(filePath, runId, userId);
  if (!current) {
    const error = new Error("Agent task not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!["awaiting_approval", "queued"].includes(current.status)) {
    const error = new Error("This task is not ready to run.");
    error.statusCode = 409;
    throw error;
  }

  const selectedAgents = AGENTS.filter(agent => !Array.isArray(current.enabledAgents) || current.enabledAgents.includes(agent.id));
  updateRun(filePath, runId, userId, { status: "running", error: null, startedAt: new Date().toISOString() });
  const settled = await Promise.allSettled(selectedAgents.map(async agent => {
    const result = await callHybrid([
      {
        role: "system",
        content: "You are the independent " + agent.name + " Agent for WSE Adventures. Your specialist focus: " + agent.focus + " Work independently from the other agents. Analyze the user's task directly and return concrete findings, risks, and proposed next steps. Do not claim to have edited files, run tests, pushed commits, merged pull requests, or deployed anything. Flag actions requiring human approval."
      },
      { role: "user", content: current.task }
    ], current.providerPreference || "hybrid");
    return { agentId: agent.id, agentName: agent.name, output: result.text, provider: result.provider, providerAttempts: result.providerAttempts };
  }));

  const outputs = settled.map((item, index) => item.status === "fulfilled"
    ? item.value
    : {
        agentId: selectedAgents[index].id,
        agentName: selectedAgents[index].name,
        output: item.reason.message || "The agent could not complete its task.",
        provider: item.reason.provider || "unavailable",
        providerAttempts: item.reason.providerAttempts || [],
        errorCategory: item.reason.category || "unavailable",
        retryable: Boolean(item.reason.retryable),
        failed: true
      });
  const providers = [...new Set(outputs.filter(item => !item.failed).map(item => item.provider))];
  const providerUsed = providers.length > 1 ? "hybrid" : (providers[0] || "unavailable");
  const failures = outputs.filter(item => item.failed);
  const completed = updateRun(filePath, runId, userId, {
    status: failures.length === outputs.length ? "failed" : failures.length ? "completed_with_errors" : "completed",
    provider: providerUsed,
    results: outputs,
    error: failures.length ? failures.length + " agent(s) could not complete their independent review." : null,
    finishedAt: new Date().toISOString()
  });
  return publicRun(completed);
}

module.exports = {
  AGENTS, approveRun, canRetryRun, cancelRun, createRun, getAnyRun, getRun, listAllRuns,
  listRuns, rejectRun, retryRun, runAgentTeam
};
