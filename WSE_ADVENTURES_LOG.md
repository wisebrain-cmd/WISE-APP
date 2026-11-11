# WSE Adventures Project Monitoring Log

This file records monitoring checks, fixes, tests, unresolved issues, and recommended next steps.

## 2026-11-09

### Setup
- Monitoring log created for ongoing project checks.
- Repository: `wisebrain-cmd/WISE-APP`
- Default branch: `main`

### Findings
- The active development branch `agent-github-pr-workflow` contains unresolved Git merge-conflict markers in three frontend files: `styles.css` (30 marker lines), `index.html` (9 marker lines), and `script.js` (9 marker lines).
- These markers are strong candidates for many of the VS Code Problems because they are invalid CSS/HTML/JavaScript syntax.
- The active development branch includes AI-agent and map features that are absent from `main`.
- Open draft PR #8 improves AI provider diagnostics and Hugging Face fallback.
- The development branch defines `npm run check`, `npm test`, and `npm run smoke`, but runtime tests were not run from the connected GitHub environment.

### Changes made
- Added this monitoring log.
- No application source files changed.

### Tests and checks
- Confirmed the repository and default branch.
- Reviewed development-branch source files.
- Scanned the three frontend files for conflict markers.

### Unresolved issues
- Frontend conflicts need careful reconciliation.
- Runtime tests still need local execution.

### Recommended next steps
- Resolve conflicts on a dedicated fix branch.
- Run static checks and tests.
- Pull verified changes into the local VS Code worktree.

## 2026-11-09 Monitoring Run 1

### Findings
- PR #9 adds a dedicated admin approval dashboard. It uses an `ADMIN_USER_IDS` allowlist, session authentication, CSRF protection, and rate limiting.
- PR #9 is not merged and its description states runtime tests have not been executed.
- Admin setup documentation was incomplete on the inspected PR branch.
- No application source fix was made because runtime validation was unavailable.

### Changes made
- No application source changes.
- Monitoring findings recorded here.

### Tests and checks
- Reviewed the open PR list and PR #9 implementation.
- Verified PR #9 was mergeable and unmerged.
- Inspected admin, server, agent, smoke-test, and README changes.

### Unresolved issues
- PR #9 needs local `npm run check`, `npm test`, and `npm run smoke`.
- Keep `ADMIN_USER_IDS` in the private `.env`.
- Earlier frontend conflicts remained a concern.

## 2026-11-10 Monitoring Run 2

### Findings
- Open PR #10, `Debug`, targets `main` from `agents/bug-hunting-and-reporting-guidelines`. GitHub reports it as open, non-draft, and mergeable.
- PR #10 has an unresolved Codex code-review finding on `Dockerfile`. The finding states the container command runs a Python test fixture from `node_modules` instead of starting `server.js`. The Docker build excludes `node_modules`, so the container would exit instead of serving WSE Adventures.
- PR #10's description claims syntax checks and `git diff --check` passed, but the available PR metadata does not provide a successful runtime test result. The PR is therefore not verified as production-ready.
- `main` remains a simpler version of the application and does not contain the newer agent, map, admin, or related work shown in the development PRs.
- The current `main` server still has a generic final error handler returning HTTP 500 for all unhandled errors. PR #10 specifically addresses malformed JSON and oversized request bodies, so merging without reviewing that change would leave the error-handling issue on `main`.
- No application source change was made in this run. The Docker issue is on an unmerged PR, and the exact Dockerfile contents were not safely retrievable through the connected GitHub file interface in this run.

### Changes made
- Updated this persistent monitoring log with the current PR and code-review findings.
- No destructive or unverified source changes.

### Tests and checks
- Queried the current open PR list.
- Fetched PR #10 metadata and its review discussion.
- Confirmed the unresolved Codex finding on `Dockerfile`.
- Fetched current `main` versions of `server.js`, `script.js`, `package.json`, `README.md`, and this log.
- Confirmed `main` still uses the generic 500 error handler and the older application surface.
- No claim of local runtime verification was made.

### Unresolved issues
- PR #10's Dockerfile issue needs correction before using its Docker/VS Code container workflow.
- PR #10 needs runtime validation locally.
- PR #9 admin work and PR #8 AI-provider work remain unmerged.
- The earlier frontend merge-conflict issue on `agent-github-pr-workflow` remains unresolved from the last direct inspection.

### Recommended next steps
- Fix the Docker command in PR #10 so the image installs Node dependencies and starts `server.js`.
- Run `npm run check`, `npm test`, and `npm run smoke` on the relevant branch.
- Review PR #10 before merging.
- Continue resolving and validating the newer agent, admin, and map work on feature branches rather than replacing `main` wholesale.

## 2026-11-11 Monitoring Run 3

### Findings
- PR #10 is still open, non-draft, and unmerged. GitHub reports it as mergeable.
- A new verification issue was found in PR #10: its description refers to `npm run check`, `npm test`, and `npm run smoke`, but the inspected PR head `package.json` exposes only the `start` script. Those three commands therefore are not defined by the inspected package configuration.
- PR #10's Dockerfile issue remains unresolved from the available review evidence. No Docker runtime test was performed.
- PR #9 remains open and unmerged.
- The inspected PR #10 server code enforces a 32-character minimum `SESSION_SECRET`, uses secure production cookies, CSRF protection, rate limiting, and disables Express's `X-Powered-By` header.
- The GitHub Actions smoke workflow uses a fixed test-only session secret in CI. No production secret was found in the inspected repository configuration.
- No new application source change was made because the newly found script mismatch and Docker issue are on an unmerged branch, and runtime verification is unavailable from this environment.

### Changes made
- Updated this persistent monitoring log with the new PR #10 verification finding.
- No application source changes.

### Tests and checks
- Queried the current open pull requests.
- Inspected PR #10 metadata and its head branch.
- Fetched the PR head `package.json` and `server.js`.
- Verified the available npm scripts directly.
- Reviewed configuration searches for `SESSION_SECRET`, `ADMIN_USER_IDS`, `GOOGLE_MAPS_API_KEY`, environment variables, TODO/FIXME markers, and unsafe `innerHTML`/eval usage.
- No local runtime, Docker, or VS Code Problems-panel test was performed.

### Unresolved issues
- PR #10's documented test commands do not match its inspected `package.json`.
- PR #10's Docker configuration still needs correction and runtime validation.
- PR #9 admin dashboard remains unmerged and needs runtime testing.
- Earlier frontend merge conflicts on `agent-github-pr-workflow` remain unresolved from the last direct inspection.

### Recommended next steps
- Align PR #10's `package.json` test scripts with the checks claimed in its PR description, or update the PR description to match the actual available tests.
- Correct and test the Docker workflow so it starts the Node server.
- Run the available test suite locally before merging.
- Continue resolving the frontend conflicts before promoting the newer application work to `main`.
