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
    const match = value.match(/^([^=;]+)=([^;]*)/);
    if (!match) continue;
    if (!match[2] || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(value)) delete cookies[match[1]];
    else cookies[match[1]] = match[2];
  }

  const text = await response.text();
  return {
    status: response.status,
    body: text,
    headers: response.headers
  };
}

async function main() {
  const health = await request('GET', `${baseUrl}/health`);
  console.log('HEALTH', health.status, health.body);
  if (health.status !== 200) {
    throw new Error('Health check failed');
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

  const me = await request('GET', `${baseUrl}/api/me`);
  console.log('ME', me.status, me.body);

  if (me.status !== 200) {
    throw new Error('Authenticated user lookup failed');
  }

  const currentCsrf = await request('GET', `${baseUrl}/api/csrf`);
  if (currentCsrf.status !== 200) {
    throw new Error('Could not refresh the CSRF token');
  }

  const currentToken = JSON.parse(currentCsrf.body).csrfToken;
  const initialProgress = await request('GET', `${baseUrl}/api/progress`);
  if (initialProgress.status !== 200 || JSON.parse(initialProgress.body).completedAdventureIds.length !== 0) {
    throw new Error('New account should start with no completed adventures');
  }

  const markComplete = await request('PUT', `${baseUrl}/api/progress/adv-001`, {
    completed: true
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentToken
    }
  });
  if (markComplete.status !== 200) {
    throw new Error(`Could not mark adventure complete: ${markComplete.body}`);
  }

  const savedProgress = await request('GET', `${baseUrl}/api/progress`);
  const completedIds = JSON.parse(savedProgress.body).completedAdventureIds;
  if (savedProgress.status !== 200 || !completedIds.includes('adv-001')) {
    throw new Error('Saved progress was not returned');
  }

  const markInProgress = await request('PUT', `${baseUrl}/api/progress/adv-001`, {
    completed: false
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentToken
    }
  });
  if (markInProgress.status !== 200) {
    throw new Error(`Could not clear adventure completion: ${markInProgress.body}`);
  }

  const clearedProgress = await request('GET', `${baseUrl}/api/progress`);
  if (clearedProgress.status !== 200 || JSON.parse(clearedProgress.body).completedAdventureIds.includes('adv-001')) {
    throw new Error('Cleared progress was not removed');
  }

  const markCompleteAgain = await request('PUT', `${baseUrl}/api/progress/adv-001`, {
    completed: true
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': currentToken
    }
  });
  if (markCompleteAgain.status !== 200) {
    throw new Error(`Could not save progress before signing out: ${markCompleteAgain.body}`);
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

  const unauthorizedProgress = await request('GET', `${baseUrl}/api/progress`);
  if (unauthorizedProgress.status !== 401) {
    throw new Error('Progress endpoint should require authentication');
  }

  const loginCsrf = await request('GET', `${baseUrl}/api/csrf`);
  if (loginCsrf.status !== 200) {
    throw new Error('Could not initialize a session for login');
  }
  const login = await request('POST', `${baseUrl}/api/login`, {
    email,
    password: 'password123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(loginCsrf.body).csrfToken
    }
  });
  if (login.status !== 200) {
    throw new Error(`Could not log back in: ${login.body}`);
  }

  const restoredProgress = await request('GET', `${baseUrl}/api/progress`);
  if (restoredProgress.status !== 200 || !JSON.parse(restoredProgress.body).completedAdventureIds.includes('adv-001')) {
    throw new Error('Saved progress did not persist after logging back in');
  }

  const finalCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const finalLogout = await request('POST', `${baseUrl}/api/logout`, {}, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(finalCsrf.body).csrfToken
    }
  });
  if (finalLogout.status !== 200) {
    throw new Error('Could not log out after verifying persisted progress');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
