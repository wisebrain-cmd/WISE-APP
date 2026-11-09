# WSE Adventures AI Agent Team

The project has five independent specialist agents: Project Manager, Frontend Developer, Backend Developer, Security Reviewer, and QA Tester.

## Hybrid model providers

The server tries OpenAI first and falls back to Hugging Face Inference Router.

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `HF_TOKEN`
- `HF_MODEL` (default: `Qwen/Qwen2.5-72B-Instruct`)

Keep provider keys in the server-side `.env` file or deployment secret manager. Never expose them in browser JavaScript.

## Independent agents and background queue

Each of the five agents receives the task independently and runs in parallel. They do not wait for the Project Manager's output or depend on another specialist's report.

On the dashboard at `/agents`, enable **Run this task automatically in the background** before submitting. The task is placed in a persistent queue and the worker picks it up automatically. Leave the option off to keep the existing manual approval flow.

The worker polls every 5 seconds by default and processes up to two tasks concurrently. Configure:

- `AGENT_POLL_MS` (default: `5000`)
- `AGENT_CONCURRENCY` (default: `2`)

The dashboard refreshes task history every 10 seconds. If the Node process restarts, interrupted automatic tasks are re-queued. Interrupted manual tasks return to the approval queue.

## Runtime and autonomy limits

- Background work continues only while the Node.js server process is running. For 24/7 operation, deploy the app on an always-on host or process manager with persistent storage.
- This is a single-process worker. For multiple server instances or high-volume production, replace the JSON queue with a shared durable queue and distributed locking (for example Redis + BullMQ).
- Agents currently research, analyze, and return recommendations. They do not directly edit repository files, push commits, merge pull requests, or deploy.
- Human approval remains required for code changes, GitHub writes, merges, and deployments.
- Run history is stored in `data/agent-runs.json`. Use persistent private storage for production.
- Each model call has a 60-second timeout. The five agent calls run concurrently for each task.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET` to a random secret of at least 32 characters.
3. Add at least one model provider key.
4. Run `npm install`.
5. Run `npm start`.
6. Sign in and open `http://localhost:3000/agents`.
