const fs = require('fs');
const path = require('path');

const baseUrl = process.env.APP_URL || 'http://localhost:3000';
const cookies = {};

async function request(method, url, body, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  const cookieHeader = Object.entries(cookies)
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
    if (match) cookies[match[1]] = match[2];
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
    "/", "/login.html", "/favicon.svg", "/styles.css", "/script.js", "/map-ui.js", "/locations.json",
    "/vendor/leaflet.css", "/vendor/leaflet.js", "/vendor/markercluster.css",
    "/vendor/markercluster-default.css", "/vendor/markercluster.js",
    "/auth.css", "/auth.js", "/agents.css", "/agents.js"
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
  const updatedProfile = await request('GET', `${baseUrl}/api/me`);
  if (updatedProfile.status !== 200 || JSON.parse(updatedProfile.body).user.name !== 'Settings Smoke Test User') {
    throw new Error('Updated display name was not persisted');
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
  if (roles.status !== 200 || JSON.parse(roles.body).agents.length !== 5) {
    throw new Error('Agent roles endpoint failed');
  }

  const agentTask = await request('POST', `${baseUrl}/api/agents/runs`, {
    task: 'Review the registration flow'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentTokenForAgents
    }
  });

  if (agentTask.status !== 202 || JSON.parse(agentTask.body).run.status !== 'awaiting_approval') {
    throw new Error('Agent task approval workflow failed');
  }

  const agentHistory = await request('GET', `${baseUrl}/api/agents/runs`);
  if (agentHistory.status !== 200 || JSON.parse(agentHistory.body).runs.length !== 1) {
    throw new Error('Agent run history failed');
  }


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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
