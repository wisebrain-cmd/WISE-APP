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

function createRun({ filePath, task, userId, autonomous = false }) {
  const normalizedTask = typeof task === "string" ? task.trim() : "";
  if (!normalizedTask || normalizedTask.length > 4000) {
    const error = new Error("Task must contain between 1 and 4000 characters.");
    error.statusCode = 400;
    throw error;
  }

  const runs = readRuns(filePath);
  const run = {
    id: crypto.randomUUID(),
    userId,
    task: normalizedTask,
    status: autonomous ? "queued" : "awaiting_approval",
    approvalRequired: !autonomous,
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

function updateRun(filePath, runId, userId, patch) {
  const runs = readRuns(filePath);
  const index = runs.findIndex(run => run.id === runId && run.userId === userId);
  if (index < 0) return null;
  runs[index] = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  writeRuns(filePath, runs);
  return runs[index];
}

function listRuns(filePath, userId) {
  return readRuns(filePath)
    .filter(run => run.userId === userId)
    .slice(0, 20)
    .map(publicRun);
}

async function requestOpenAI(messages) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
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
  if (!response.ok) throw new Error(data.error?.message || "OpenAI request failed with status " + response.status);
  const result = data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim()) throw new Error("OpenAI returned an empty response.");
  return { text: result.trim(), provider: "openai" };
}

async function requestHuggingFace(messages) {
  if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is not configured.");
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
  if (!response.ok) throw new Error(data.error?.message || "Hugging Face request failed with status " + response.status);
  const result = data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim()) throw new Error("Hugging Face returned an empty response.");
  return { text: result.trim(), provider: "huggingface" };
}

async function callHybrid(messages) {
  const failures = [];
  if (process.env.OPENAI_API_KEY) {
    try {
      return await requestOpenAI(messages);
    } catch (error) {
      failures.push("OpenAI: " + error.message);
    }
  }
  if (process.env.HF_TOKEN) {
    try {
      return await requestHuggingFace(messages);
    } catch (error) {
      failures.push("Hugging Face: " + error.message);
    }
  }
  const error = new Error(
    failures.length
      ? "Both configured AI providers failed. " + failures.join(" | ")
      : "Configure OPENAI_API_KEY and/or HF_TOKEN to enable the hybrid agent team."
  );
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

  updateRun(filePath, runId, userId, { status: "running", error: null });
  const settled = await Promise.allSettled(AGENTS.map(async agent => {
    const result = await callHybrid([
      {
        role: "system",
        content: "You are the independent " + agent.name + " Agent for WSE Adventures. Your specialist focus: " + agent.focus + " Work independently from the other agents. Analyze the user's task directly and return concrete findings, risks, and proposed next steps. Do not claim to have edited files, run tests, pushed commits, merged pull requests, or deployed anything. Flag actions requiring human approval."
      },
      { role: "user", content: current.task }
    ]);
    return { agentId: agent.id, agentName: agent.name, output: result.text, provider: result.provider };
  }));

  const outputs = settled.map((item, index) => item.status === "fulfilled"
    ? item.value
    : {
        agentId: AGENTS[index].id,
        agentName: AGENTS[index].name,
        output: "Agent failed: " + item.reason.message,
        provider: "unavailable",
        failed: true
      });
  const providers = [...new Set(outputs.filter(item => !item.failed).map(item => item.provider))];
  const providerUsed = providers.length > 1 ? "hybrid" : (providers[0] || "unavailable");
  const failures = outputs.filter(item => item.failed);
  const completed = updateRun(filePath, runId, userId, {
    status: failures.length ? "completed_with_errors" : "completed",
    provider: providerUsed,
    results: outputs,
    error: failures.length ? failures.length + " agent(s) could not complete their independent review." : null
  });
  return publicRun(completed);
}

module.exports = { AGENTS, createRun, getRun, listRuns, runAgentTeam };
