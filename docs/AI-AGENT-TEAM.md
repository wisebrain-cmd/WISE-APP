# WSE Adventures AI Agent Team

The project includes a supervised, hybrid AI team with five roles:

1. Project Manager
2. Frontend Developer
3. Backend Developer
4. Security Reviewer
5. QA Tester

## Provider strategy

The server tries OpenAI first. If the OpenAI request fails, it tries Hugging Face Inference Router. Configure one or both providers in the server environment:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-4o-mini`)
- `HF_TOKEN`
- `HF_MODEL` (defaults to `Qwen/Qwen2.5-72B-Instruct`)

Provider keys must remain in the server-side `.env` file or deployment secret manager. Never add them to HTML or browser JavaScript. If neither provider key is configured, agent execution returns HTTP 503 with setup guidance.

## Approval workflow

1. Sign in to WSE Adventures and open `/agents` for the dashboard, or use the API directly.
2. Fetch a CSRF token from `GET /api/csrf`.
3. Submit a task with `POST /api/agents/runs` and JSON body `{"task":"Describe the work" }`.
4. Review the returned task. It remains `awaiting_approval`.
5. Explicitly approve it with `POST /api/agents/runs/:runId/approve`.
6. Read task history from `GET /api/agents/runs`.

All agent endpoints require an authenticated session. POST requests also require the `X-CSRF-Token` header. Each account sees only its own agent runs. Task creation and approval have rate limits.

## Important operating limits

- The manager plans first. The four specialist agents then review the manager's plan.
- Agents return analysis and proposed changes. They do not write to GitHub, edit project files, merge pull requests, or deploy.
- Human approval is still required before any repository change or deployment.
- Run history is stored in `data/agent-runs.json`, which is excluded from Git.
- The agent service runs only while the Node.js application is running. It does not run while the server is stopped.
- Each provider request has a 60-second timeout. A complete run makes five model requests.
- For production, use a persistent private data volume for `data/` and configure provider keys as deployment secrets.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET` to a random value of at least 32 characters.
3. Add at least one AI provider key.
4. Run `npm install`.
5. Run `npm start`.
6. Open the app and sign in before calling the agent API.
