# WSE Adventures

Responsive adventure-map application with account authentication, user and administrator dashboards, persistent settings and notifications, place discovery, and a task-oriented AI agent team.

## Run locally

Requirements: Node.js 20+ and npm.

1. Run `npm install`.
2. Set `SESSION_SECRET` to a random secret of at least 32 characters. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Optionally configure AI/GitHub credentials and an administrator account as described below.
4. Start with `npm start`.
5. Open <http://localhost:3000>.

On Windows PowerShell, set the secret for the current terminal with:
`$env:SESSION_SECRET = "paste-your-generated-secret-here"`

## Included

- Account creation and sign-in with bcrypt password hashing.
- File-backed users and server-side sessions with pure JavaScript storage, avoiding native SQLite build requirements.
- HttpOnly, SameSite=Lax session cookie; Secure cookies in production.
- CSRF tokens for state-changing requests, rate-limited authentication, and Helmet security headers.
- Homepage account greeting and logout.
- A protected user dashboard with profile status, real recent account activity, notifications, session count, and AI task history.
- A protected administrator dashboard with account metrics, user search/details/status controls, system/service configuration state, agent activity, approval queue, and audit history. Administrator IDs come from the server-only `ADMIN_USER_IDS` setting; every protected request checks the role in the database.
- An administrator-only Agent Control Center at `/admin/agents` with worker and queue observability, agent participation, task ownership/history filters, approval and error queues, and pause/resume/start/stop/restart controls for the shared background queue. Agents are task-scoped roles—not independent daemons—so they cannot be started or stopped individually. Retry is limited to one attempt for transiently failed agents.
- Provider status derived from configuration and recent real requests. The application does not send automatic health probes, avoiding unintended usage or credit charges. Configured but unobserved providers remain unknown; provider credentials never go to the browser.
- Server-persisted in-app notifications with unread counts, category filters, pagination, mark-read/mark-all-read, and delete controls. Notifications are generated for real account, sign-in, profile, administrator, and AI-agent events.
- A single authenticated, responsive settings dashboard for account security, maps, navigation, location, discovery, notifications, appearance, privacy, saved places, accessibility, and supervised AI agents.
- Server-persisted, validated per-account settings and search history, alongside theme, accent, text size, region, enabled agent roles, provider preference, and approval policy.
- Per-account AI-agent notification preferences are honored for task, approval, completion, and failure notifications.
- Profile image uploads are resized in the browser and limited to PNG, JPEG, or WebP images under 256 KB. Account changes and destructive actions use CSRF tokens; password changes and account deletion require the current password.
- Email and browser push delivery, two-factor authentication, personal OAuth connections, and multiple language packs are unavailable until their corresponding services are configured. AI provider and GitHub indicators report server credential configuration; they do not claim live external service health.
- A welcome-screen collection of map-linked destinations, plus optional location-based suggestions for nearby attractions and places to relax.
- Public-file allowlist so server files and database files are not served.
- A searchable, zoomable world map with 3,000 real populated places from GeoNames, plus mapped attractions loaded for the visible area.
- A searchable, paginated place directory with same-tab details, current weather, credited Wikimedia Commons photos, and authenticated shared photo uploads stored in the app database.
- Public visitor ratings and feedback, with one editable review per signed-in account and location.

## Architecture

- `server.js` is the Express application and owns authentication, sessions, CSRF checks, authorization, APIs, and server-side integrations.
- User, settings, notification, and activity data is persisted in the `sql.js` database at `data/wise.db`. Sessions and agent task runs use files in the configured data directory.
- Static pages use focused browser scripts, including `dashboard.js`, `admin-dashboard.js`, `notifications-center.js`, and `agent-control.js`; authenticated and administrator pages are served through protected routes.
- Agent roles and provider calls are implemented in `agent-team.js`. `agent-worker.js` dispatches queued runs in the background. Approval and task control routes are protected in `server.js`.
- The map uses Leaflet and MapLibre GL; nearby attractions use OpenStreetMap Overpass, photos use Wikimedia Commons, and weather uses Open-Meteo.

## Administrator provisioning

Email addresses are not proof of identity. Matching an email address cannot grant administrator access. A registration only receives administrator access if its exact numeric account ID was explicitly configured by the operator.

1. Register the trusted administrator account without preconfiguring an account ID.
2. While signed in as that account, get its numeric ID from `/api/me`.
3. Set that ID in the server-only `ADMIN_USER_IDS` environment variable (comma-separated for multiple administrators).
4. Restart the application. Startup resets stored administrator roles, then grants them only to the configured IDs.

Keep this configuration under operator control. Do not preconfigure an ID before its trusted account is created, or choose an ID based on an unverified email address. Existing deployments that used `ADMIN_EMAILS` must migrate to trusted account IDs; old stored administrator roles are intentionally removed at startup.

## AI provider configuration

Set `OPENAI_API_KEY` and/or `HF_TOKEN` on the server. Optional model names are `OPENAI_MODEL` and `HF_MODEL`. `GITHUB_TOKEN` and `GITHUB_REPOSITORY` configure the server-side GitHub integration. Never place these credentials in frontend files or expose them through API responses.

Provider health is based on the latest recorded actual request. There are no scheduled or manual probe requests. Authentication, invalid configuration, rate limiting, credit/quota, and transient service errors are reported without returning provider response bodies or credentials.

## Agent and worker behavior

The configured agent roles collaborate independently on each user task; they are not long-running independent processes. A single shared worker dispatches approved queued tasks up to the configured concurrency. Worker pause/stop prevents new tasks from starting but does not interrupt active provider calls. `AGENT_POLL_MS` and `AGENT_CONCURRENCY` configure the dispatch interval and parallel run limit.

New tasks normally wait for administrator approval. A retry creates a new queued task containing only transiently failed agents from the prior task, and a task can be retried at most once. Authentication, invalid configuration, quota, and validation failures are not retried. Task history and derived observability retain at most 50 recent runs.

## Configuration and security

Required: `SESSION_SECRET` (at least 32 characters). Common optional values: `NODE_ENV`, `PORT`, `DATA_DIR`, `ADMIN_USER_IDS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `HF_TOKEN`, `HF_MODEL`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `AGENT_POLL_MS`, and `AGENT_CONCURRENCY`.

Protected endpoints verify the server-side session and, for administrator operations, the stored administrator role. State-changing requests use CSRF protection. Passwords are bcrypt-hashed, authentication and agent-control requests are rate limited, user-specific data is scoped to the signed-in account, and provider credentials remain server-side.

## Checks and smoke testing

- `npm run check` — JavaScript syntax checks.
- `npm test` — unit and regression tests.
- `npm run smoke` — end-to-end HTTP checks against a running instance.
- `git diff --check` — whitespace/conflict-marker check.

Run smoke tests against an isolated test instance and data directory. Configure a test administrator ID that matches the first test account (often ID `1` for a fresh database), set `APP_URL` to the test server, and do not point smoke tests at production data.

## World map and data sources

The map uses Leaflet for a clustered 2D map and MapLibre GL for an interactive 3D globe, both with OpenStreetMap tiles and no Google Maps key. Use the view switch to change between them, or expand the map to fill the screen. The responsive full-screen layout supports desktop and mobile browsers, including a CSS full-screen fallback where the Fullscreen API is unavailable. Its bundled catalog contains 3,000 real populated places, selected from the GeoNames `cities15000` dataset. GeoNames data is available under a Creative Commons Attribution (CC BY) license; place coordinates, names, population figures, and country codes are supplied as source data, not endorsements or visitor recommendations. GeoNames attribution is shown in each destination's details.

When the map is zoomed in, named attractions and places of interest in the visible area are requested from OpenStreetMap's Overpass API. Results are cached in memory for 10 minutes; deployments can set `OVERPASS_API_URL` to use a different compatible endpoint. Mapped attraction details can also be fetched by ID, so their detail pages continue to work after refresh or when opened directly. Map tiles and live attraction lookup require an internet connection. OpenStreetMap data is available under the Open Database License (ODbL), with attribution on the map. The place directory includes every bundled GeoNames city and attractions discovered during the current browser session. Visitor feedback and visitor-added place photos are stored in the app's persistent SQL database; viewing them is public, while adding, updating, or removing them requires an account. Place photos are shared across visitors, validated as PNG, JPEG, or WebP under 256 KB, and can only be replaced or removed by the account that uploaded them.

Place details search Wikimedia Commons for a matching photograph and display its license and source link. Current weather is fetched server-side from Open-Meteo and cached for 10 minutes; neither service requires an API key. Both need an internet connection, and weather can be unavailable for an individual request.

The homepage requests browser location only after a visitor chooses **Find places near me**. Location suggestions require HTTPS (except on localhost) and browser permission. Visitors can filter suggestions by sightseeing, nature, family activities, or nearby towns, and choose a 5–50 km radius. The browser sends a location rounded to three decimal places to the app's nearby-place endpoint; coordinates are not saved. If live attractions are unavailable, the page can suggest nearby populated places from the bundled GeoNames catalog instead. The interactive map includes the same category filters and an optional current-location control.

## Deploy with Render

A `render.yaml` Blueprint is included. In Render, choose **New + → Blueprint** and connect this repository. The configuration uses a Node.js web service, generates `SESSION_SECRET`, sets production mode, and mounts persistent storage for SQLite at `data/`. The persistent disk requires a paid Render service; review the current price in Render before confirming. Do not deploy without persistent storage, or SQLite accounts may disappear on restart/redeploy. After deployment, test `/health`, registration, login, and logout over HTTPS.

GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, email/browser push notification delivery, two-factor authentication, personal OAuth connections, multiple language packs, and saved user-specific adventure progress are not implemented yet. Email address changes apply immediately because no verification service is configured. The bundled database and file-backed sessions are intended for a single application instance; multi-instance deployments need shared managed storage and sessions. Review deployment backups, TLS, retention, rate limits, and monitoring before production use.
