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
- A Google Maps map dialog that highlights hundreds of locations with map insights and category summaries.

## Map configuration
To enable the full Google Maps interaction, set a real API key before the app script loads:

```html
<script>
  window.WISE_MAPS_CONFIG = {
    apiKey: "YOUR_GOOGLE_MAPS_API_KEY",
    center: { lat: 39.5, lng: -98.35 },
    zoom: 4
  };
</script>
<script src="/script.js"></script>
```

Without a key, the site loads a graceful fallback map view so the UI still shows the location highlights and insight cards.

## Deploy with Render
A `render.yaml` Blueprint is included. In Render, choose **New + → Blueprint** and connect this repository. The configuration uses a Node.js web service, generates `SESSION_SECRET`, sets production mode, and mounts persistent storage for SQLite at `data/`. The persistent disk requires a paid Render service; review the current price in Render before confirming. Do not deploy without persistent storage, or SQLite accounts may disappear on restart/redeploy. After deployment, test `/health`, registration, login, and logout over HTTPS.

GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, OAuth, account deletion, and saved user-specific adventure progress are not implemented yet. Do not treat this starter as fully production-ready without testing and deployment review.
