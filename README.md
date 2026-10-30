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
- A welcome-screen collection of map-linked destinations, plus optional location-based suggestions for nearby attractions and places to relax.
- Public-file allowlist so server files and database files are not served.
- A searchable, zoomable world map with 3,000 real populated places from GeoNames, plus mapped attractions loaded for the visible area.
- Public visitor ratings and feedback, with one editable review per signed-in account and location.

## World map and data sources

The map uses Leaflet with OpenStreetMap tiles and needs no Google Maps key. Its bundled catalog contains 3,000 real populated places, selected from the GeoNames `cities15000` dataset. GeoNames data is available under a Creative Commons Attribution (CC BY) license; place coordinates, names, population figures, and country codes are supplied as source data, not endorsements or visitor recommendations. GeoNames attribution is shown in each destination's details.

When the map is zoomed in, named attractions and places of interest in the visible area are requested from OpenStreetMap's Overpass API. Results are cached in memory for 10 minutes; deployments can set `OVERPASS_API_URL` to use a different compatible endpoint. Map tiles and live attraction lookup require an internet connection. OpenStreetMap data is available under the Open Database License (ODbL), with attribution on the map. Visitor feedback is written to the app's persistent SQL database; viewing feedback is public, while posting or updating feedback requires an account.

The homepage requests browser location only after a visitor chooses **Find places near me**. Location suggestions require HTTPS (except on localhost) and browser permission. The browser sends a rounded, small-area search to the app's nearby-place endpoint; coordinates are not saved. If live attractions are unavailable, the page can suggest nearby populated places from the bundled GeoNames catalog instead.

## Deploy with Render
A `render.yaml` Blueprint is included. In Render, choose **New + → Blueprint** and connect this repository. The configuration uses a Node.js web service, generates `SESSION_SECRET`, sets production mode, and mounts persistent storage for SQLite at `data/`. The persistent disk requires a paid Render service; review the current price in Render before confirming. Do not deploy without persistent storage, or SQLite accounts may disappear on restart/redeploy. After deployment, test `/health`, registration, login, and logout over HTTPS.

GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, OAuth, account deletion, and saved user-specific adventure progress are not implemented yet. Do not treat this starter as fully production-ready without testing and deployment review.
