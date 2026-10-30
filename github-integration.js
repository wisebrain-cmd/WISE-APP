"use strict";

const API = "https://api.github.com";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function configuration() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY || "wisebrain-cmd/WISE-APP";
  if (!token) {
    const error = new Error("GITHUB_TOKEN is not configured on the server.");
    error.statusCode = 503;
    throw error;
  }
  if (!REPOSITORY_PATTERN.test(repository)) {
    const error = new Error("GITHUB_REPOSITORY must use owner/repository format.");
    error.statusCode = 500;
    throw error;
  }
  return { token, repository };
}

async function githubRequest(endpoint) {
  const { token } = configuration();
  const response = await fetch(API + endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WSE-Adventures-Agent-Team"
    },
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "GitHub request failed with status " + response.status);
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw error;
  }
  return body;
}

async function getConnectionStatus() {
  const { repository } = configuration();
  const [user, repo] = await Promise.all([
    githubRequest("/user"),
    githubRequest("/repos/" + repository.split("/").map(encodeURIComponent).join("/"))
  ]);
  return {
    connected: true,
    account: user.login,
    repository: repo.full_name,
    defaultBranch: repo.default_branch,
    permissions: {
      contents: repo.permissions?.push ? "write" : "read",
      pullRequests: repo.permissions?.push ? "write" : "unknown"
    }
  };
}

async function listRepositoryFiles({ ref, limit = 150 } = {}) {
  const { repository } = configuration();
  const safeLimit = Math.min(Math.max(Number(limit) || 150, 1), 300);
  const repoPath = repository.split("/").map(encodeURIComponent).join("/");
  const repo = await githubRequest("/repos/" + repoPath);
  const branch = typeof ref === "string" && /^[A-Za-z0-9._/-]{1,120}$/.test(ref)
    ? ref : repo.default_branch;
  const tree = await githubRequest("/repos/" + repoPath + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1");
  if (tree.truncated) {
    return { repository: repo.full_name, branch, truncated: true, files: tree.tree.filter(item => item.type === "blob").slice(0, safeLimit).map(item => item.path) };
  }
  const blocked = /(^|\/)(\.env|\.git|node_modules|data|secrets?)(\/|$)|(^|\/)(package-lock\.json|.*\.pem)$/i;
  const files = tree.tree
    .filter(item => item.type === "blob" && !blocked.test(item.path))
    .slice(0, safeLimit)
    .map(item => item.path);
  return { repository: repo.full_name, branch, truncated: false, files };
}

module.exports = { getConnectionStatus, listRepositoryFiles };
