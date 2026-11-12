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
    "/", "/login.html", "/favicon.svg", "/styles.css", "/script.js", "/map-ui.js", "/maplibre-loader.mjs", "/locations.json",
    "/vendor/leaflet.css", "/vendor/leaflet.js", "/vendor/markercluster.css",
    "/vendor/markercluster-default.css", "/vendor/markercluster.js", "/vendor/maplibre-gl.css",
    "/vendor/maplibre-gl.mjs", "/vendor/maplibre-gl-worker.mjs",
    "/auth.css", "/auth.js", "/agents.css", "/agents.js", "/preferences.js", "/settings-schema.js", "/settings.css", "/settings.js"
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
  console.log('HEALTH', health.status, health.body);

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

  const csrf = await request('GET', `${baseUrl}/api/csrf`);
  console.log('CSRF', csrf.status, csrf.body);

  if (csrf.status !== 200) {
    throw new Error('CSRF endpoint failed');
  }

  const csrfToken = JSON.parse(csrf.body).csrfToken;
  const email = `smoke-${Date.now()}@example.com`;

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

  console.log('REGISTER', register.status, register.body);
  if (register.status !== 201) {
    throw new Error('Registration failed');
  }

  const authenticatedSession = await request('GET', `${baseUrl}/api/session`);
  if (authenticatedSession.status !== 200
    || JSON.parse(authenticatedSession.body).user?.email !== email) {
    throw new Error(`Authenticated session status failed: ${authenticatedSession.body}`);
  }

  const me = await request('GET', `${baseUrl}/api/me`);
  console.log('ME', me.status, me.body);

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
      notifications: { trafficAlerts: false },
      appearance: { units: "miles", theme: "dark", accent: "terracotta", timeFormat: "12h" },
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
    || persistedAppSettings.appearance.units !== "miles" || persistedAppSettings.appearance.accent !== "terracotta"
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
  console.log('CSRF-POST-LOGIN', currentCsrf.status, currentCsrf.body);

  const currentToken = JSON.parse(currentCsrf.body).csrfToken;
  const currentTokenForAgents = currentToken;

  const catalog = await request("GET", `${baseUrl}/locations.json`);
  const destination = JSON.parse(catalog.body)[0];
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

  const agentHistory = await request('GET', `${baseUrl}/api/agents/runs`);
  if (agentHistory.status !== 200 || JSON.parse(agentHistory.body).runs.length !== 1) {
    throw new Error('Agent run history failed');
  }

  const wrongPassword = await request("POST", `${baseUrl}/api/me/password`, {
    currentPassword: "incorrect-password", newPassword: "new-smoke-password-123"
  }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": currentToken } });
  if (wrongPassword.status !== 403) throw new Error("Password change did not verify the current password");
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
  console.log('LOGOUT', logout.status, logout.body);

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
  const invalidDeletion = await request("POST", `${baseUrl}/api/me/delete`, {
    password: "delete-password-123", confirmation: "no"
  }, { cookieJar: deletionCookies, headers: { "Content-Type": "application/json", "X-CSRF-Token": deletionTokenAfterRegister } });
  if (invalidDeletion.status !== 400) throw new Error("Account deletion confirmation was not enforced");
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
