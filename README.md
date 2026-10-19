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
- SQLite-backed users and server-side sessions.
- HttpOnly, SameSite=Lax session cookie; Secure cookies in production.
- CSRF tokens for state-changing requests, rate-limited authentication, and Helmet security headers.
- Homepage account greeting and logout.
- Public-file allowlist so server files and database files are not served.

## Deployment
This requires a Node.js host that can run `npm start` and persist the `data/` directory. Configure `SESSION_SECRET` in the host's environment, set `NODE_ENV=production`, and use HTTPS. GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, OAuth, account deletion, and saved user-specific adventure progress are not implemented yet. Do not treat this starter as fully production-ready without testing and deployment review.
