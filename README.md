# WSE Adventures

Micro-adventure website with account registration, login, server-side sessions, and logout.

## Run locally

Requirements: Node.js 20+ and npm.

1. Run `npm install`.
2. Set `SESSION_SECRET` to a random secret of at least 32 characters. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Start with `npm start`.
4. Open <http://localhost:3000>.

On Windows PowerShell, set the secret for the current terminal with:
`$env:SESSION_SECRET = "paste-your-generated-secret-here"`

## Included

- Account creation and sign-in with bcrypt password hashing.
- File-backed users and server-side sessions with pure JavaScript storage, avoiding native SQLite build requirements.
- HttpOnly, SameSite=Lax session cookie; Secure cookies in production.
- CSRF tokens for state-changing requests, rate-limited authentication, and Helmet security headers.
- Homepage account greeting and logout.
- A single authenticated settings dashboard for profile details and pictures, account email, password, active sessions, account deletion, appearance, region, and supervised AI-agent preferences.
- Server-persisted per-account theme, accent, font size, time zone, date/time formats, enabled agent roles, provider preference, and approval policy.
- Profile image uploads are resized in the browser and limited to PNG, JPEG, or WebP images under 256 KB. Account changes and destructive actions use CSRF tokens; password changes and account deletion require the current password.
- Notification delivery, two-factor authentication, personal OAuth connections, multiple languages, and administrator log viewing are shown as unavailable until the corresponding services and roles exist.
- A welcome-screen collection of map-linked destinations, plus optional location-based suggestions for nearby attractions and places to relax.
- Public-file allowlist so server files and database files are not served.
- A searchable, zoomable world map with 3,000 real populated places from GeoNames, plus mapped attractions loaded for the visible area.
- Public visitor ratings and feedback, with one editable review per signed-in account and location.

## World map and data sources

The map uses Leaflet for a clustered 2D map and MapLibre GL for an interactive 3D globe, both with OpenStreetMap tiles and no Google Maps key. Use the view switch to change between them, or expand the map to fill the screen. The responsive full-screen layout supports desktop and mobile browsers, including a CSS full-screen fallback where the Fullscreen API is unavailable. Its bundled catalog contains 3,000 real populated places, selected from the GeoNames `cities15000` dataset. GeoNames data is available under a Creative Commons Attribution (CC BY) license; place coordinates, names, population figures, and country codes are supplied as source data, not endorsements or visitor recommendations. GeoNames attribution is shown in each destination's details.

When the map is zoomed in, named attractions and places of interest in the visible area are requested from OpenStreetMap's Overpass API. Results are cached in memory for 10 minutes; deployments can set `OVERPASS_API_URL` to use a different compatible endpoint. Map tiles and live attraction lookup require an internet connection. OpenStreetMap data is available under the Open Database License (ODbL), with attribution on the map. Visitor feedback is written to the app's persistent SQL database; viewing feedback is public, while posting or updating feedback requires an account.

The homepage requests browser location only after a visitor chooses **Find places near me**. Location suggestions require HTTPS (except on localhost) and browser permission. Visitors can filter suggestions by sightseeing, nature, family activities, or nearby towns, and choose a 5–50 km radius. The browser sends a location rounded to three decimal places to the app's nearby-place endpoint; coordinates are not saved. If live attractions are unavailable, the page can suggest nearby populated places from the bundled GeoNames catalog instead. The interactive map includes the same category filters and an optional current-location control.

## Deploy with Render

A `render.yaml` Blueprint is included. In Render, choose **New + → Blueprint** and connect this repository. The configuration uses a Node.js web service, generates `SESSION_SECRET`, sets production mode, and mounts persistent storage for SQLite at `data/`. The persistent disk requires a paid Render service; review the current price in Render before confirming. Do not deploy without persistent storage, or SQLite accounts may disappear on restart/redeploy. After deployment, test `/health`, registration, login, and logout over HTTPS.

GitHub Pages alone cannot run this backend. For multi-instance production deployments, use a managed database and shared session store.

Password reset, email verification, email/browser notification delivery, two-factor authentication, personal OAuth connections, multiple language packs, administrator roles/log viewing, and saved user-specific adventure progress are not implemented yet. Email address changes apply immediately because no verification mail service is configured. Do not treat this starter as fully production-ready without testing and deployment review.
