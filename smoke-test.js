const fs = require('fs');
const path = require('path');

const baseUrl = process.env.APP_URL || 'http://localhost:3000';
const cookies = {};

async function request(method, url, body, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  const cookieJar = extra.cookieJar || cookies;
  const cookieHeader = Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  if (cookieHeader) headers.Cookie = cookieHeader;

  if (body && typeof body !== 'string') {
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual'
  });

  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const value of setCookie) {
    const match = value.match(/^([^=;]+)=([^;]+)/);
    if (match) cookieJar[match[1]] = match[2];
  }

  const text = await response.text();
  return {
    status: response.status,
    body: text,
    headers: response.headers
  };
}

async function main() {
  for (const route of [
    "/", "/login.html", "/favicon.ico", "/favicon.svg", "/styles.css", "/script.js", "/map-ui.js", "/places", "/places.css", "/places.js",
    "/location.css", "/location.js", "/safe-redirect.js", "/maplibre-loader.mjs", "/locations.json",
    "/vendor/leaflet.css", "/vendor/leaflet.js", "/vendor/markercluster.css",
    "/vendor/markercluster-default.css", "/vendor/markercluster.js", "/vendor/maplibre-gl.css",
    "/vendor/maplibre-gl.mjs", "/vendor/maplibre-gl-worker.mjs",
    "/auth.css", "/auth.js", "/agents.css", "/agents.js", "/preferences.js", "/settings-schema.js", "/settings.css", "/settings.js",
    "/platform.css", "/dashboard.js", "/admin-dashboard.js", "/agent-control.js", "/notifications-center.js", "/notifications-widget.js"
  ]) {
    const page = await request("GET", `${baseUrl}${route}`);
    if (page.status !== 200) {
      throw new Error(`Public asset ${route} returned HTTP ${page.status}`);
    }
    if (route === "/locations.json" && JSON.parse(page.body).length <= 1000) {
      throw new Error("Global destination catalog does not contain over 1,000 places");
    }
  }

  const health = await request('GET', `${baseUrl}/health`);

  const anonymousSession = await request('GET', `${baseUrl}/api/session`);
  if (anonymousSession.status !== 200 || JSON.parse(anonymousSession.body).user !== null) {
    throw new Error(`Anonymous session status failed: ${anonymousSession.body}`);
  }
  const anonymousProfile = await request('GET', `${baseUrl}/api/me`);
  if (anonymousProfile.status !== 401) {
    throw new Error(`Protected account endpoint returned HTTP ${anonymousProfile.status} while signed out`);
  }
  const anonymousSettings = await request("GET", `${baseUrl}/api/me/settings`);
  if (anonymousSettings.status !== 401) throw new Error("Settings API was available while signed out");
  const anonymousSearchHistory = await request("GET", `${baseUrl}/api/me/search-history`);
  if (anonymousSearchHistory.status !== 401) throw new Error("Search history was available while signed out");
  const settingsRedirect = await request("GET", `${baseUrl}/settings`);
  if (settingsRedirect.status !== 302 || !settingsRedirect.headers.get("location")?.includes("/login.html?next=")) {
    throw new Error("Settings dashboard did not require sign-in");
  }
  for (const route of ["/dashboard", "/notifications", "/admin", "/admin/agents"]) {
    const protectedPage = await request("GET", `${baseUrl}${route}`);
    if (protectedPage.status !== 302 || !protectedPage.headers.get("location")?.includes("/login.html?next=")) {
      throw new Error(`${route} did not redirect signed-out visitors to sign in`);
    }
  }
  for (const route of ["/api/me/dashboard", "/api/me/notifications", "/api/me/notifications/unread-count", "/api/admin/overview", "/api/admin/users", "/api/admin/agents"]) {
    const protectedApi = await request("GET", `${baseUrl}${route}`);
    if (protectedApi.status !== 401) throw new Error(`${route} was available while signed out`);
  }

  const csrf = await request('GET', `${baseUrl}/api/csrf`);

  if (csrf.status !== 200) {
    throw new Error('CSRF endpoint failed');
  }

  const csrfToken = JSON.parse(csrf.body).csrfToken;
  const anonymousPlacePhoto = await request("PUT", `${baseUrl}/api/locations/geonames-1/photo`, {
    imageData: "data:image/png;base64,iVBORw0KGgo="
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken } });
  if (anonymousPlacePhoto.status !== 401) throw new Error("Place photos could be updated while signed out");
  const anonymousPhotoRead = await request("GET", `${baseUrl}/api/locations/geonames-1/photo`);
  if (anonymousPhotoRead.status !== 200 || JSON.parse(anonymousPhotoRead.body).photo !== null) {
    throw new Error("Public place photo lookup failed while signed out");
  }
  const invalidWeather = await request("GET", `${baseUrl}/api/weather?latitude=90.1&longitude=0`);
  if (invalidWeather.status !== 400) throw new Error("Invalid weather coordinates were not rejected");
  const invalidWeatherUnit = await request("GET", `${baseUrl}/api/weather?latitude=35&longitude=139&temperatureUnit=kelvin`);
  if (invalidWeatherUnit.status !== 400) throw new Error("Unsupported weather units were not rejected");
  const email = "smoke-admin@example.com";

  const register = await request('POST', `${baseUrl}/api/register`, {
    name: 'Smoke Test User',
    email,
    password: 'password123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  });

  if (register.status !== 201) {
    throw new Error('Registration failed');
  }

  const authenticatedSession = await request('GET', `${baseUrl}/api/session`);
  if (authenticatedSession.status !== 200
    || JSON.parse(authenticatedSession.body).user?.email !== email) {
    throw new Error(`Authenticated session status failed: ${authenticatedSession.body}`);
  }
  if (JSON.parse(authenticatedSession.body).user.role !== "admin") throw new Error("Configured administrator account ID was not granted its server-side role");
  for (const route of ["/dashboard", "/notifications"]) {
    const page = await request("GET", `${baseUrl}${route}`);
    if (page.status !== 200) throw new Error(`${route} did not load for a signed-in user`);
  }
  const normalAdminPage = await request("GET", `${baseUrl}/admin`);
  if (normalAdminPage.status !== 200 || !normalAdminPage.body.includes('id="admin-root"')) throw new Error("Configured administrator could not access the administrator page");
  const adminOverview = await request("GET", `${baseUrl}/api/admin/overview`);
  const adminUsers = await request("GET", `${baseUrl}/api/admin/users`);
  const adminActivity = await request("GET", `${baseUrl}/api/admin/activity`);
  if (adminOverview.status !== 200 || JSON.parse(adminOverview.body).users.total !== 1
    || adminUsers.status !== 200 || JSON.parse(adminUsers.body).users[0]?.role !== "admin"
    || adminActivity.status !== 200 || !JSON.parse(adminActivity.body).activity.some(item => item.eventType === "account.registered")) {
    throw new Error("Administrator overview, user list or audit activity did not return real data");
  }
  const dashboardData = await request("GET", `${baseUrl}/api/me/dashboard`);
  if (dashboardData.status !== 200 || JSON.parse(dashboardData.body).user.email !== email) {
    throw new Error(`Authenticated dashboard data failed: ${dashboardData.body}`);
  }
  const githubStatus = await request("GET", `${baseUrl}/api/agents/github/status`);
  if (githubStatus.status !== 200 || JSON.parse(githubStatus.body).configured !== false
    || JSON.parse(githubStatus.body).connected !== false) {
    throw new Error(`Unconfigured GitHub integration was not reported as a normal service state: ${githubStatus.body}`);
  }
  const initialNotifications = await request("GET", `${baseUrl}/api/me/notifications`);
  if (initialNotifications.status !== 200 || JSON.parse(initialNotifications.body).notifications[0]?.category !== "account") {
    throw new Error(`Persistent account notifications were not created: ${initialNotifications.body}`);
  }
  const initialUnread = await request("GET", `${baseUrl}/api/me/notifications/unread-count`);
  if (initialUnread.status !== 200 || JSON.parse(initialUnread.body).unreadCount !== 1) {
    throw new Error(`Unread notification count failed: ${initialUnread.body}`);
  }
  const individualRead = await request("PATCH", `${baseUrl}/api/me/notifications/${JSON.parse(initialNotifications.body).notifications[0].id}/read`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(register.body).csrfToken }
  });
  if (individualRead.status !== 200 || JSON.parse(individualRead.body).unreadCount !== 0) {
    throw new Error(`Mark notification read failed: ${individualRead.body}`);
  }
  const missingCsrf = await request("PATCH", `${baseUrl}/api/me`, { name: "Rejected without CSRF" }, {
    headers: { "Content-Type": "application/json" }
  });
  if (missingCsrf.status !== 403) throw new Error("Profile API accepted a request without a CSRF token");

  const me = await request('GET', `${baseUrl}/api/me`);
  if (me.status !== 200) {
    throw new Error('Authenticated user lookup failed');
  }

  const profileCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const profileUpdate = await request('PATCH', `${baseUrl}/api/me`, {
    name: 'Settings Smoke Test User'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(profileCsrf.body).csrfToken
    }
  });
  if (profileUpdate.status !== 200 || JSON.parse(profileUpdate.body).user.name !== 'Settings Smoke Test User') {
    throw new Error(`Profile settings update failed: ${profileUpdate.body}`);
  }
  const picture = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DfcAAAAASUVORK5CYII=";
  const accountUpdateCsrf = await request("GET", `${baseUrl}/api/csrf`);
  const changedEmail = email.replace("smoke-", "settings-");
  const unconfirmedEmail = await request("PATCH", `${baseUrl}/api/me`, {
    name: "Settings Smoke Test User", email: changedEmail
  }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(accountUpdateCsrf.body).csrfToken }
  });
  if (unconfirmedEmail.status !== 403) throw new Error("Email change did not require password confirmation");
  const accountUpdate = await request("PATCH", `${baseUrl}/api/me`, {
    name: "Settings Smoke Test User", email: changedEmail, currentPassword: "password123456", profileImage: picture
  }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(accountUpdateCsrf.body).csrfToken }
  });
  if (accountUpdate.status !== 200 || JSON.parse(accountUpdate.body).user.email !== changedEmail
    || JSON.parse(accountUpdate.body).user.profileImage !== picture) {
    throw new Error(`Email or profile picture update failed: ${accountUpdate.body}`);
  }
  const updatedProfile = await request('GET', `${baseUrl}/api/me`);
  if (updatedProfile.status !== 200 || JSON.parse(updatedProfile.body).user.name !== 'Settings Smoke Test User') {
    throw new Error('Updated display name was not persisted');
  }
  const notificationsCsrf = await request("GET", `${baseUrl}/api/csrf`);
  const notificationsToken = JSON.parse(notificationsCsrf.body).csrfToken;
  const markAllRead = await request("POST", `${baseUrl}/api/me/notifications/read-all`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": notificationsToken }
  });
  if (markAllRead.status !== 200 || JSON.parse(markAllRead.body).unreadCount !== 0) {
    throw new Error(`Mark all notifications read failed: ${markAllRead.body}`);
  }
  const readNotifications = await request("GET", `${baseUrl}/api/me/notifications`);
  const firstNotification = JSON.parse(readNotifications.body).notifications[0];
  if (!firstNotification?.isRead) throw new Error("Mark all did not update notification read state");
  const deletedNotification = await request("DELETE", `${baseUrl}/api/me/notifications/${firstNotification.id}`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": notificationsToken }
  });
  if (deletedNotification.status !== 200 || !JSON.parse(deletedNotification.body).deleted) {
    throw new Error(`Notification deletion failed: ${deletedNotification.body}`);
  }
  const settingsPage = await request("GET", `${baseUrl}/settings`);
  if (settingsPage.status !== 200 || !settingsPage.body.includes("settings-nav") || !settingsPage.body.includes("settings-schema.js")) {
    throw new Error("Authenticated settings dashboard did not load its sections");
  }
  const saveSettingsCsrf = await request("GET", `${baseUrl}/api/csrf`);
  const settingsToken = JSON.parse(saveSettingsCsrf.body).csrfToken;
  const savedSettings = await request("PATCH", `${baseUrl}/api/me/settings`, {
    theme: "dark", accent: "ocean", fontSize: "large", timeZone: "Atlantic/Reykjavik",
    dateFormat: "dmy", timeFormat: "12h", enabledAgents: ["security", "qa"], approvalRequired: true, provider: "hybrid"
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken } });
  if (savedSettings.status !== 200 || JSON.parse(savedSettings.body).preferences.enabledAgents.length !== 2) {
    throw new Error(`Settings save failed: ${savedSettings.body}`);
  }
  const savedSettingsReload = await request("GET", `${baseUrl}/api/me/settings`);
  const reloadedPreferences = JSON.parse(savedSettingsReload.body).preferences;
  if (savedSettingsReload.status !== 200 || reloadedPreferences.theme !== "dark" || reloadedPreferences.timeZone !== "Atlantic/Reykjavik"
    || reloadedPreferences.approvalRequired !== true || reloadedPreferences.enabledAgents.length !== 2) {
    throw new Error(`Settings were not persisted: ${savedSettingsReload.body}`);
  }
  const savedAppSettings = await request("PATCH", `${baseUrl}/api/me/settings`, {
    settings: {
      map: { defaultType: "satellite", showTraffic: true },
      navigation: { travelMode: "cycling", avoidTolls: true },
      location: { locationAccuracy: "approximate", savedLocationsEnabled: false },
      discovery: { restaurantPreferences: "vegan", searchHistory: true },
      notifications: { trafficAlerts: false, agentNotifications: true },
      appearance: { units: "miles", temperatureUnits: "fahrenheit", theme: "dark", accent: "terracotta", timeFormat: "12h" },
      privacy: { dataCollection: false },
      savedPlaces: { homeLocation: "Example home" },
      offlineMaps: { automaticUpdates: true },
      accessibility: { highContrast: true }
    }
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken } });
  if (savedAppSettings.status !== 200) throw new Error(`App settings save failed: ${savedAppSettings.body}`);
  const appSettingsReload = await request("GET", `${baseUrl}/api/me/settings`);
  const persistedAppSettings = JSON.parse(appSettingsReload.body).settings;
  if (appSettingsReload.status !== 200 || persistedAppSettings.map.defaultType !== "satellite"
    || persistedAppSettings.navigation.travelMode !== "cycling" || persistedAppSettings.location.locationAccuracy !== "approximate"
    || persistedAppSettings.discovery.restaurantPreferences !== "vegan" || persistedAppSettings.notifications.trafficAlerts !== false
    || persistedAppSettings.notifications.agentNotifications !== true
    || persistedAppSettings.appearance.units !== "miles" || persistedAppSettings.appearance.temperatureUnits !== "fahrenheit"
    || persistedAppSettings.appearance.accent !== "terracotta"
    || persistedAppSettings.privacy.dataCollection !== false || persistedAppSettings.savedPlaces.homeLocation !== "Example home"
    || persistedAppSettings.offlineMaps.automaticUpdates !== true || persistedAppSettings.accessibility.highContrast !== true) {
    throw new Error(`App settings were not persisted: ${appSettingsReload.body}`);
  }
  const invalidAppSettings = await request("PATCH", `${baseUrl}/api/me/settings`, {
    settings: { map: { defaultType: "unsupported" } }
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken } });
  if (invalidAppSettings.status !== 400) throw new Error("Invalid app settings were not rejected");
  const searchSaved = await request("POST", `${baseUrl}/api/me/search-history`, { query: "quiet gardens" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken }
  });
  if (searchSaved.status !== 201) throw new Error(`Search history save failed: ${searchSaved.body}`);
  const searchHistory = await request("GET", `${baseUrl}/api/me/search-history`);
  if (searchHistory.status !== 200 || !JSON.parse(searchHistory.body).history.some(item => item.query === "quiet gardens")) {
    throw new Error("Search history was not saved for the signed-in user");
  }
  const clearedHistory = await request("DELETE", `${baseUrl}/api/me/search-history`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken }
  });
  if (clearedHistory.status !== 200 || JSON.parse((await request("GET", `${baseUrl}/api/me/search-history`)).body).history.length) {
    throw new Error("Search history was not cleared");
  }
  const invalidSettings = await request("PATCH", `${baseUrl}/api/me/settings`, { enabledAgents: [] }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": settingsToken }
  });
  if (invalidSettings.status !== 400) throw new Error("Invalid settings were not rejected");
  const activeSessions = await request("GET", `${baseUrl}/api/me/sessions`);
  if (activeSessions.status !== 200 || !JSON.parse(activeSessions.body).sessions.some(item => item.current)) {
    throw new Error("Current session was not listed in account settings");
  }

  const agentDashboard = await request("GET", `${baseUrl}/agents`);
  if (agentDashboard.status !== 200 || !agentDashboard.body.includes("Your AI Agent Team")) {
    throw new Error(`Authenticated agent dashboard route failed: HTTP ${agentDashboard.status}`);
  }

  const currentCsrf = await request('GET', `${baseUrl}/api/csrf`);

  const currentToken = JSON.parse(currentCsrf.body).csrfToken;
  const currentTokenForAgents = currentToken;

  const catalog = await request("GET", `${baseUrl}/locations.json`);
  const destination = JSON.parse(catalog.body)[0];
  const directoryPage = await request("GET", `${baseUrl}/places`);
  const placeDetailPage = await request("GET", `${baseUrl}/places/${destination.id}`);
  const invalidPlacePage = await request("GET", `${baseUrl}/places/not-a-place`);
  const invalidOsmLookup = await request("GET", `${baseUrl}/api/locations/osm-invalid`);
  if (directoryPage.status !== 200 || !directoryPage.body.includes("places-list")
    || placeDetailPage.status !== 200 || !placeDetailPage.body.includes("weather-content")
    || invalidPlacePage.status !== 404 || invalidOsmLookup.status !== 400) {
    throw new Error("Place directory or same-tab detail page did not load");
  }
  const emptyPhoto = await request("GET", `${baseUrl}/api/locations/${destination.id}/photo`);
  if (emptyPhoto.status !== 200 || JSON.parse(emptyPhoto.body).photo !== null) {
    throw new Error(`Public place photo lookup failed: ${emptyPhoto.body}`);
  }
  const placePhoto = await request("PUT", `${baseUrl}/api/locations/${destination.id}/photo`, {
    imageData: picture
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  if (placePhoto.status !== 200 || !JSON.parse(placePhoto.body).saved) {
    throw new Error(`Authenticated place photo upload failed: ${placePhoto.body}`);
  }
  const savedPhoto = await request("GET", `${baseUrl}/api/locations/${destination.id}/photo`);
  if (savedPhoto.status !== 200 || JSON.parse(savedPhoto.body).photo?.imageData !== picture
    || JSON.parse(savedPhoto.body).photo?.canManage !== true) {
    throw new Error("Place photo was not persisted");
  }
  const invalidPlacePhoto = await request("PUT", `${baseUrl}/api/locations/${destination.id}/photo`, {
    imageData: "data:image/png;base64,not-a-real-image"
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  if (invalidPlacePhoto.status !== 400) throw new Error("Invalid place photos were not rejected");
  const otherUserCookies = {};
  const otherUserCsrf = await request("GET", `${baseUrl}/api/csrf`, undefined, { cookieJar: otherUserCookies });
  const otherUserRegister = await request("POST", `${baseUrl}/api/register`, {
    name: "Other Photo User",
    email: "smoke-user@example.com",
    password: "photo-owner-password-123"
  }, { cookieJar: otherUserCookies, headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": JSON.parse(otherUserCsrf.body).csrfToken
  } });
  if (otherUserRegister.status !== 201) throw new Error("Could not create independent photo ownership test account");
  if (JSON.parse(otherUserRegister.body).user.role !== "user") {
    throw new Error("A configured email address incorrectly granted administrator privileges");
  }
  const normalUserAdminPage = await request("GET", `${baseUrl}/admin`, undefined, { cookieJar: otherUserCookies });
  const normalUserAgentPage = await request("GET", `${baseUrl}/admin/agents`, undefined, { cookieJar: otherUserCookies });
  const normalUserAdminApi = await request("GET", `${baseUrl}/api/admin/overview`, undefined, { cookieJar: otherUserCookies });
  const normalUserAgentApi = await request("GET", `${baseUrl}/api/admin/agents`, undefined, { cookieJar: otherUserCookies });
  const normalUserWorkerControl = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "pause" }, {
    cookieJar: otherUserCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(otherUserRegister.body).csrfToken }
  });
  const normalDashboard = await request("GET", `${baseUrl}/api/me/dashboard`, undefined, { cookieJar: otherUserCookies });
  const privateNotifications = await request("GET", `${baseUrl}/api/me/notifications`, undefined, { cookieJar: otherUserCookies });
  if (normalUserAdminPage.status !== 403 || normalUserAgentPage.status !== 403 || normalUserAdminApi.status !== 403
    || normalUserAgentApi.status !== 403 || normalUserWorkerControl.status !== 403
    || normalDashboard.status !== 200 || JSON.parse(normalDashboard.body).user.role !== "user"
    || privateNotifications.status !== 200 || JSON.parse(privateNotifications.body).notifications.length !== 1) {
    throw new Error("Normal-user dashboard, notification privacy or admin authorization failed");
  }
  const otherEmail = JSON.parse(otherUserRegister.body).user.email;
  const agentPreference = await request("PATCH", `${baseUrl}/api/me/settings`, {
    settings: { notifications: { agentNotifications: false } }
  }, { cookieJar: otherUserCookies, headers: {
    "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(otherUserRegister.body).csrfToken
  } });
  if (agentPreference.status !== 200 || JSON.parse(agentPreference.body).settings.notifications.agentNotifications !== false) {
    throw new Error("AI agent notification preference could not be disabled");
  }
  const privateAgentTask = await request("POST", `${baseUrl}/api/agents/runs`, {
    task: "Review settings with password=private-agent-test-secret",
    autonomous: false
  }, { cookieJar: otherUserCookies, headers: {
    "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(otherUserRegister.body).csrfToken
  } });
  if (privateAgentTask.status !== 202 || JSON.parse(privateAgentTask.body).run.status !== "awaiting_approval") {
    throw new Error(`User agent approval request failed: ${privateAgentTask.body}`);
  }
  const privateTaskId = JSON.parse(privateAgentTask.body).run.id;
  const normalUserAgentApproval = await request("POST", `${baseUrl}/api/admin/agents/runs/${JSON.parse(privateAgentTask.body).run.id}/approve`, {}, {
    cookieJar: otherUserCookies,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(otherUserRegister.body).csrfToken }
  });
  if (normalUserAgentApproval.status !== 403) throw new Error("A regular account could approve tasks through the admin API");
  const normalUserAgentRetry = await request("POST", `${baseUrl}/api/admin/agents/runs/${privateTaskId}/retry`, {}, {
    cookieJar: otherUserCookies,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(otherUserRegister.body).csrfToken }
  });
  if (normalUserAgentRetry.status !== 403) throw new Error("A regular account could retry tasks through the admin API");
  const adminAgentPage = await request("GET", `${baseUrl}/admin/agents`);
  const adminAgentCenter = await request("GET", `${baseUrl}/api/admin/agents`);
  const centerData = JSON.parse(adminAgentCenter.body);
  const queuedTask = centerData.approvalQueue.find(item => item.id === privateTaskId);
  if (adminAgentPage.status !== 200 || !adminAgentPage.body.includes("Agent Control Center")
    || adminAgentCenter.status !== 200 || !queuedTask
    || JSON.stringify(centerData).includes("private-agent-test-secret")
    || !JSON.stringify(centerData).includes("[redacted]")) {
    throw new Error(`Admin agent center status, queue, or secret redaction failed: ${adminAgentCenter.body}`);
  }
  if (centerData.providers.some(provider => provider.status !== "not_configured")) {
    throw new Error(`Provider configuration was not reported accurately: ${centerData.providers.map(provider => `${provider.id}=${provider.status}`).join(", ")}`);
  }
  if (!centerData.observability || !Array.isArray(centerData.taskHistory)
    || centerData.observability.approvalQueueSize < 1
    || !centerData.taskHistory.some(item => item.id === privateTaskId
      && item.owner === "Other Photo User" && item.approvalStatus === "pending")) {
    throw new Error("Agent observability, task history, approval state, or task ownership was missing");
  }
  const agentControlNoCsrf = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "pause" }, {
    headers: { "Content-Type": "application/json" }
  });
  if (agentControlNoCsrf.status !== 403) throw new Error("Agent worker control accepted a request without CSRF");
  const approvedTask = await request("POST", `${baseUrl}/api/admin/agents/runs/${privateTaskId}/approve`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (approvedTask.status !== 202 || JSON.parse(approvedTask.body).run.status !== "queued") {
    throw new Error(`Admin approval did not queue the task: ${approvedTask.body}`);
  }
  const approvalResult = await Promise.race([
    (async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const snapshot = await request("GET", `${baseUrl}/api/admin/agents`);
        const run = JSON.parse(snapshot.body).activity.find(item => item.id.startsWith(`${privateTaskId}:`));
        if (run?.status === "failed" || run?.status === "completed") return run.status;
      }
      return "timeout";
    })(),
    new Promise(resolve => setTimeout(() => resolve("timeout"), 14000))
  ]);
  if (approvalResult !== "failed") throw new Error(`No-provider task should visibly fail, got ${approvalResult}`);
  const afterAgentRun = await request("GET", `${baseUrl}/api/me/notifications`, undefined, { cookieJar: otherUserCookies });
  if (JSON.parse(afterAgentRun.body).notifications.some(item => item.category === "agents")) {
    throw new Error("AI agent notifications ignored the user's disabled preference");
  }
  const rejectedTaskCreate = await request("POST", `${baseUrl}/api/agents/runs`, {
    task: "Review an unapproved change",
    autonomous: false
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  if (rejectedTaskCreate.status !== 202) throw new Error("Could not create task for rejection test");
  const rejectedTask = await request("POST", `${baseUrl}/api/admin/agents/runs/${JSON.parse(rejectedTaskCreate.body).run.id}/reject`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (rejectedTask.status !== 200 || JSON.parse(rejectedTask.body).run.status !== "rejected") {
    throw new Error(`Admin rejection did not report a rejected task: ${rejectedTask.body}`);
  }
  const pausedWorker = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "pause" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  const resumedWorker = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "resume" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (pausedWorker.status !== 200 || JSON.parse(pausedWorker.body).worker.status !== "paused"
    || resumedWorker.status !== 200 || JSON.parse(resumedWorker.body).worker.status !== "running") {
    throw new Error("Administrator worker pause/resume controls did not reflect actual queue state");
  }
  const stoppedWorker = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "stop" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  const startedWorker = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "start" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  const restartedWorker = await request("POST", `${baseUrl}/api/admin/agents/worker`, { action: "restart" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (stoppedWorker.status !== 200 || JSON.parse(stoppedWorker.body).worker.status !== "offline"
    || startedWorker.status !== 200 || JSON.parse(startedWorker.body).worker.status !== "running"
    || restartedWorker.status !== 200 || JSON.parse(restartedWorker.body).worker.status !== "running") {
    throw new Error("Administrator worker start/stop/restart controls did not report the resulting state");
  }
  const agentNotifications = await request("GET", `${baseUrl}/api/me/notifications`);
  if (!JSON.parse(agentNotifications.body).notifications.some(item => item.category === "agents")) {
    throw new Error("Agent task lifecycle notifications were not created for a user with notifications enabled");
  }
  const cancellableTask = await request("POST", `${baseUrl}/api/agents/runs`, {
    task: "Cancel a queued review before processing",
    autonomous: false
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  const cancelledTask = await request("POST", `${baseUrl}/api/admin/agents/runs/${JSON.parse(cancellableTask.body).run.id}/cancel`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (cancellableTask.status !== 202 || cancelledTask.status !== 200 || JSON.parse(cancelledTask.body).run.status !== "cancelled") {
    throw new Error(`Pending task cancellation did not report a cancelled state: ${cancelledTask.body}`);
  }
  const adminUserSearch = await request("GET", `${baseUrl}/api/admin/users?q=${encodeURIComponent(otherEmail)}`);
  const adminUserDetail = await request("GET", `${baseUrl}/api/admin/users/${JSON.parse(otherUserRegister.body).user.id}`);
  if (adminUserSearch.status !== 200 || JSON.parse(adminUserSearch.body).users.length !== 1
    || adminUserDetail.status !== 200 || JSON.parse(adminUserDetail.body).user.email !== otherEmail) {
    throw new Error("Administrator user search or account details failed");
  }
  const statusTestCookies = {};
  const statusTestCsrf = await request("GET", `${baseUrl}/api/csrf`, undefined, { cookieJar: statusTestCookies });
  const statusTestRegister = await request("POST", `${baseUrl}/api/register`, {
    name: "Status Test User", email: `status-test-${Date.now()}@example.com`, password: "status-test-password-123"
  }, { cookieJar: statusTestCookies, headers: {
    "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(statusTestCsrf.body).csrfToken
  } });
  if (statusTestRegister.status !== 201) throw new Error("Could not create account status test user");
  const statusUserId = JSON.parse(statusTestRegister.body).user.id;
  const deactivateUser = await request("PATCH", `${baseUrl}/api/admin/users/${statusUserId}/status`, { status: "inactive" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  const inactiveSession = await request("GET", `${baseUrl}/api/me`, undefined, { cookieJar: statusTestCookies });
  if (deactivateUser.status !== 200 || inactiveSession.status !== 401) {
    throw new Error(`Account deactivation did not revoke access: ${deactivateUser.body} / ${inactiveSession.body}`);
  }
  const inactiveLoginCookies = {};
  const inactiveLoginCsrf = await request("GET", `${baseUrl}/api/csrf`, undefined, { cookieJar: inactiveLoginCookies });
  const inactiveLogin = await request("POST", `${baseUrl}/api/login`, {
    email: JSON.parse(statusTestRegister.body).user.email, password: "status-test-password-123"
  }, { cookieJar: inactiveLoginCookies, headers: {
    "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(inactiveLoginCsrf.body).csrfToken
  } });
  if (inactiveLogin.status !== 403) throw new Error("Inactive accounts were allowed to sign in");
  const selfDeactivation = await request("PATCH", `${baseUrl}/api/admin/users/${JSON.parse(register.body).user.id}/status`, { status: "inactive" }, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (selfDeactivation.status !== 400) throw new Error("Administrators were allowed to deactivate their own account");
  const adminWithoutCsrf = await request("PATCH", `${baseUrl}/api/admin/users/${statusUserId}/status`, { status: "active" }, {
    headers: { "Content-Type": "application/json" }
  });
  if (adminWithoutCsrf.status !== 403) throw new Error("Administrator account changes accepted a request without CSRF");
  const otherUserPhoto = await request("GET", `${baseUrl}/api/locations/${destination.id}/photo`, undefined, { cookieJar: otherUserCookies });
  if (otherUserPhoto.status !== 200 || JSON.parse(otherUserPhoto.body).photo?.canManage !== false) {
    throw new Error("Another account was incorrectly granted photo management");
  }
  const otherUserToken = JSON.parse(otherUserRegister.body).csrfToken;
  const unauthorizedReplacement = await request("PUT", `${baseUrl}/api/locations/${destination.id}/photo`, {
    imageData: picture
  }, { cookieJar: otherUserCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": otherUserToken } });
  const unauthorizedRemoval = await request("DELETE", `${baseUrl}/api/locations/${destination.id}/photo`, {}, {
    cookieJar: otherUserCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": otherUserToken }
  });
  if (unauthorizedReplacement.status !== 403 || unauthorizedRemoval.status !== 403) {
    throw new Error("A different account could replace or remove a visitor photo");
  }
  const secondDestination = JSON.parse(catalog.body)[1];
  const otherUserUpload = await request("PUT", `${baseUrl}/api/locations/${secondDestination.id}/photo`, {
    imageData: picture
  }, { cookieJar: otherUserCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": otherUserToken } });
  if (otherUserUpload.status !== 200) throw new Error("Photo owner could not upload a second place photo");
  const otherUserOwnedPhoto = await request("GET", `${baseUrl}/api/locations/${secondDestination.id}/photo`);
  if (otherUserOwnedPhoto.status !== 200 || JSON.parse(otherUserOwnedPhoto.body).photo?.canManage !== false) {
    throw new Error("A different account was incorrectly granted management of another shared photo");
  }
  const deleteOtherUser = await request("POST", `${baseUrl}/api/me/delete`, {
    password: "photo-owner-password-123",
    confirmation: "DELETE"
  }, { cookieJar: otherUserCookies, headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": otherUserToken
  } });
  if (deleteOtherUser.status !== 200) throw new Error(`Photo owner's account could not be deleted: ${deleteOtherUser.body}`);
  const orphanedPhoto = await request("GET", `${baseUrl}/api/locations/${secondDestination.id}/photo`);
  if (orphanedPhoto.status !== 200 || JSON.parse(orphanedPhoto.body).photo?.canManage !== true) {
    throw new Error("Deleting a photo owner's account did not release their shared photo");
  }
  const removeOrphanedPhoto = await request("DELETE", `${baseUrl}/api/locations/${secondDestination.id}/photo`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (removeOrphanedPhoto.status !== 200) throw new Error("Released shared photo could not be managed");
  const removedPhoto = await request("DELETE", `${baseUrl}/api/locations/${destination.id}/photo`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (removedPhoto.status !== 200 || JSON.parse(removedPhoto.body).deleted !== true
    || JSON.parse((await request("GET", `${baseUrl}/api/locations/${destination.id}/photo`)).body).photo !== null) {
    throw new Error("Place photo was not removed");
  }
  const initialReviews = await request("GET", `${baseUrl}/api/locations/${destination.id}/reviews`);
  if (initialReviews.status !== 200) {
    throw new Error(`Public location feedback lookup failed: ${initialReviews.body}`);
  }
  const expectedReviewCount = JSON.parse(initialReviews.body).reviewCount + 1;
  const feedback = await request("POST", `${baseUrl}/api/locations/${destination.id}/reviews`, {
    rating: 5,
    comment: "The location details were useful for planning a visit."
  }, {
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": currentToken
    }
  });
  if (feedback.status !== 200 || JSON.parse(feedback.body).reviewCount !== expectedReviewCount) {
    throw new Error(`Location feedback submission failed: ${feedback.body}`);
  }
  const feedbackUpdate = await request("POST", `${baseUrl}/api/locations/${destination.id}/reviews`, {
    rating: 4,
    comment: "Updated feedback confirms one review per account."
  }, {
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": currentToken
    }
  });
  const updatedReviewResult = JSON.parse(feedbackUpdate.body);
  if (feedbackUpdate.status !== 200 || updatedReviewResult.reviewCount !== expectedReviewCount
    || updatedReviewResult.myReview?.rating !== 4) {
    throw new Error(`Location feedback update failed: ${feedbackUpdate.body}`);
  }
  const invalidReview = await request("POST", `${baseUrl}/api/locations/${destination.id}/reviews`, {
    rating: 6,
    comment: "This rating should be rejected."
  }, {
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": currentToken
    }
  });
  if (invalidReview.status !== 400) {
    throw new Error(`Invalid location rating was not rejected: HTTP ${invalidReview.status}`);
  }
  const invalidBounds = await request("GET", `${baseUrl}/api/locations/nearby?bbox=not-bounds`);
  if (invalidBounds.status !== 400) {
    throw new Error(`Invalid map bounds were not rejected: HTTP ${invalidBounds.status}`);
  }

  const dashboard = await request('GET', `${baseUrl}/agents`);
  if (dashboard.status !== 200) throw new Error('Agent dashboard route failed');

  const roles = await request('GET', `${baseUrl}/api/agents/roles`);
  const roleData = JSON.parse(roles.body);
  if (roles.status !== 200 || roleData.agents.length !== 5 || roleData.enabledAgents.length !== 2
    || roleData.providerPreference !== "hybrid"
    || Object.values(roleData.providers).some(provider => Object.hasOwn(provider, "apiKey"))) {
    throw new Error('Agent roles endpoint failed');
  }
  const systemStatus = await request("GET", `${baseUrl}/api/system/status`);
  if (systemStatus.status !== 200 || JSON.parse(systemStatus.body).database !== "available") {
    throw new Error(`Authorized system status failed: ${systemStatus.body}`);
  }

  const agentTask = await request('POST', `${baseUrl}/api/agents/runs`, {
    task: 'Review the registration flow', autonomous: true
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentTokenForAgents
    }
  });

  if (agentTask.status !== 202 || JSON.parse(agentTask.body).run.status !== 'awaiting_approval') {
    throw new Error('Agent task approval workflow failed');
  }
  if (JSON.parse(agentTask.body).run.enabledAgents.length !== 2) throw new Error("Agent enablement preferences were not enforced");
  const taskCreatedNotifications = await request("GET", `${baseUrl}/api/me/notifications`);
  if (!JSON.parse(taskCreatedNotifications.body).notifications.some(item => item.title === "Approval requested")) {
    throw new Error("New pending agent tasks did not create an owner notification");
  }

  const agentHistory = await request('GET', `${baseUrl}/api/agents/runs`);
  if (agentHistory.status !== 200 || !JSON.parse(agentHistory.body).runs.some(run => run.id === JSON.parse(agentTask.body).run.id)) {
    throw new Error('Agent run history failed');
  }

  const passwordChange = await request("POST", `${baseUrl}/api/me/password`, {
    currentPassword: "password123456", newPassword: "new-smoke-password-123"
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  if (passwordChange.status !== 200) throw new Error(`Password change failed: ${passwordChange.body}`);
  const secondaryCookies = {};
  const secondaryCsrf = await request("GET", `${baseUrl}/api/csrf`, undefined, { cookieJar: secondaryCookies });
  const secondaryLogin = await request("POST", `${baseUrl}/api/login`, {
    email: email.replace("smoke-", "settings-"), password: "new-smoke-password-123"
  }, { cookieJar: secondaryCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": JSON.parse(secondaryCsrf.body).csrfToken } });
  if (secondaryLogin.status !== 200) throw new Error("New password could not sign in on another browser");
  const sessionsAfterLogin = await request("GET", `${baseUrl}/api/me/sessions`);
  if (sessionsAfterLogin.status !== 200 || JSON.parse(sessionsAfterLogin.body).sessions.length < 2) throw new Error("Other signed-in session was not listed");
  const logoutOtherSessions = await request("POST", `${baseUrl}/api/me/sessions/logout-others`, {}, {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken }
  });
  if (logoutOtherSessions.status !== 200 || JSON.parse(logoutOtherSessions.body).revoked < 1) {
    throw new Error("Other signed-in sessions were not revoked");
  }
  const revokedSession = await request("GET", `${baseUrl}/api/me`, undefined, { cookieJar: secondaryCookies });
  if (revokedSession.status !== 401) throw new Error("Revoked session remained authenticated");


  const logout = await request('POST', `${baseUrl}/api/logout`, {}, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentToken
    }
  });
  if (logout.status !== 200) {
    throw new Error('Logout failed');
  }
  const loggedOutSession = await request('GET', `${baseUrl}/api/session`);
  if (loggedOutSession.status !== 200 || JSON.parse(loggedOutSession.body).user !== null) {
    throw new Error(`Logged-out session status failed: ${loggedOutSession.body}`);
  }

  const deletionCookies = {};
  const deletionCsrf = await request("GET", `${baseUrl}/api/csrf`, undefined, { cookieJar: deletionCookies });
  const deletionToken = JSON.parse(deletionCsrf.body).csrfToken;
  const deletionEmail = `delete-${Date.now()}@example.com`;
  const deletionRegister = await request("POST", `${baseUrl}/api/register`, {
    name: "Delete Test User", email: deletionEmail, password: "delete-password-123"
  }, { cookieJar: deletionCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": deletionToken } });
  if (deletionRegister.status !== 201) throw new Error("Could not create account deletion test user");
  const deletionTokenAfterRegister = JSON.parse(deletionRegister.body).csrfToken;
  const wrongDeletionPassword = await request("POST", `${baseUrl}/api/me/delete`, {
    password: "wrong-delete-password", confirmation: "DELETE"
  }, { cookieJar: deletionCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": deletionTokenAfterRegister } });
  if (wrongDeletionPassword.status !== 403) throw new Error("Account deletion did not verify the current password");
  const deleted = await request("POST", `${baseUrl}/api/me/delete`, {
    password: "delete-password-123", confirmation: "DELETE"
  }, { cookieJar: deletionCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": deletionTokenAfterRegister } });
  const deletedProfile = await request("GET", `${baseUrl}/api/me`, undefined, { cookieJar: deletionCookies });
  if (deleted.status !== 200 || deletedProfile.status !== 401) throw new Error(`Account deletion failed: ${deleted.body}`);
}

main().then(() => {
  console.log("Smoke tests passed.");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
