# WSE Adventures

Micro-adventure website with account registration, login, server-side sessions, and logout.

## Run locally
Requirements: Node.js 20+ and npm.

1. Run `npm install`.
2. Set `SESSION_SECRET` to a random secret of at least 32 characters. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Start with `npm start`.
4. Open http://localhost:3000.

On Windows PowerShell, set the secret for the current terminal with:
`$env:SESSION_SECRET = "paste-your-generated-secret-here"`

## Included
- Account creation and sign-in with bcrypt password hashing.
- File-backed users and server-side sessions with pure JavaScript storage, avoiding native SQLite build requirements.
- HttpOnly, SameSite=Lax session cookie; Secure cookies in production.
- CSRF tokens for state-changing requests, rate-limited authentication, and Helmet security headers.
- Homepage account greeting and logout.
- Per-account adventure completion tracking that persists between visits.
- Light, dark, and device-matched appearance settings saved in the browser.
- Public-file allowlist so server files and database files are not served.

## Deploy with Render
A `render.yaml` Blueprint is included. In Render, choose **New + → Blueprint** and connect this repository. The configuration uses a Node.js web service, generates `SESSION_SECRET`, sets production mode, and mounts persistent storage for SQLite at `data/`. The persistent disk requires a paid Render service; review the current price in Render before confirming. Do not deploy without persistent storage, or SQLite accounts may disappear on restart/redeploy. After deployment, test `/health`, registration, login, and logout over HTTPS.

GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, OAuth, and account deletion are not implemented yet. Do not treat this starter as fully production-ready without testing and deployment review.
