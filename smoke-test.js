const fs = require('node:fs');
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

async function readDevelopmentEmailLink(mode) {
  const logPath = process.env.APP_LOG_FILE || 'server.log';
  if (!fs.existsSync(logPath)) {
    throw new Error(`Email log not found at ${logPath}; set APP_LOG_FILE and use EMAIL_DELIVERY=console for this test.`);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rawLog = fs.readFileSync(logPath);
    const log = rawLog.includes(0) ? rawLog.toString('utf16le') : rawLog.toString('utf8');
    const matches = [...log.matchAll(new RegExp(`mode=${mode}&token=([a-f0-9]{64})`, 'g'))];
    if (matches.length > 0) return matches[matches.length - 1][1];
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`No development ${mode} email link was found in ${logPath}`);
}

async function main() {
  for (const route of ['/', '/login.html', '/styles.css', '/auth.css', '/script.js', '/auth.js']) {
    const page = await request('GET', `${baseUrl}${route}`);
    if (page.status !== 200) {
      throw new Error(`Public asset ${route} returned HTTP ${page.status}`);
    }
  }

  const providers = await request('GET', `${baseUrl}/api/auth/providers`);
  if (providers.status !== 200 || typeof JSON.parse(providers.body).google !== 'boolean') {
    throw new Error('Google sign-in should report its configured status');
  }
  const disabledGoogle = await request('GET', `${baseUrl}/auth/google`);
  const googleExpectedStatus = JSON.parse(providers.body).google ? 302 : 503;
  if (disabledGoogle.status !== googleExpectedStatus) {
    throw new Error('Google sign-in route does not match its configured status');
  }
  if (googleExpectedStatus === 302) {
    const authorizationUrl = new URL(disabledGoogle.headers.get('location'));
    if (!authorizationUrl.searchParams.get('state') || !authorizationUrl.searchParams.get('client_id')) {
      throw new Error('Google authorization redirect is missing state or client configuration');
    }
    const invalidCallback = await request(
      'GET',
      `${baseUrl}/auth/google/callback?state=invalid&code=not-a-real-code`
    );
    if (invalidCallback.status !== 302 || !invalidCallback.headers.get('location')?.includes('error=oauth_state')) {
      throw new Error('Google callback should reject an invalid OAuth state');
    }
  }

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

  const unverifiedMe = await request('GET', `${baseUrl}/api/me`);
  if (unverifiedMe.status !== 401) {
    throw new Error('New accounts must verify their email before signing in');
  }
  const unverifiedLoginCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const unverifiedLogin = await request('POST', `${baseUrl}/api/login`, {
    email,
    password: 'password123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(unverifiedLoginCsrf.body).csrfToken
    }
  });
  if (unverifiedLogin.status !== 403) {
    throw new Error('Password sign-in should be blocked until email is verified');
  }
  const resendCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const resendVerification = await request('POST', `${baseUrl}/api/resend-verification`, { email }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(resendCsrf.body).csrfToken
    }
  });
  if (resendVerification.status !== 200) {
    throw new Error(`Could not resend the verification email: ${resendVerification.body}`);
  }
  const verificationToken = await readDevelopmentEmailLink('verify');
  const verifyCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const verification = await request('POST', `${baseUrl}/api/verify-email`, {
    token: verificationToken
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(verifyCsrf.body).csrfToken
    }
  });
  if (verification.status !== 200) {
    throw new Error(`Email verification failed: ${verification.body}`);
  }
  const replayedVerification = await request('POST', `${baseUrl}/api/verify-email`, {
    token: verificationToken
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(verifyCsrf.body).csrfToken
    }
  });
  if (replayedVerification.status !== 400) {
    throw new Error('Email verification links should be single-use');
  }

  const loginCsrf = await request('GET', `${baseUrl}/api/csrf`);
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
    throw new Error(`Could not sign in after verifying email: ${login.body}`);
  }

  const me = await request('GET', `${baseUrl}/api/me`);
  console.log('ME', me.status, me.body);

  if (me.status !== 200) {
    throw new Error('Authenticated user lookup failed');
  }

  const profileUpdateCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const profileUpdate = await request('PATCH', `${baseUrl}/api/me`, {
    name: 'Updated Smoke Test User'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(profileUpdateCsrf.body).csrfToken
    }
  });
  if (profileUpdate.status !== 200) {
    throw new Error(`Profile update failed: ${profileUpdate.body}`);
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

  const reloginCsrf = await request('GET', `${baseUrl}/api/csrf`);
  if (reloginCsrf.status !== 200) {
    throw new Error('Could not initialize a session for login');
  }
  const relogin = await request('POST', `${baseUrl}/api/login`, {
    email,
    password: 'password123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(reloginCsrf.body).csrfToken
    }
  });
  if (relogin.status !== 200) {
    throw new Error(`Could not log back in: ${relogin.body}`);
  }

  const restoredProgress = await request('GET', `${baseUrl}/api/progress`);
  if (restoredProgress.status !== 200 || !JSON.parse(restoredProgress.body).completedAdventureIds.includes('adv-001')) {
    throw new Error('Saved progress did not persist after logging back in');
  }

  const forgotCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const forgotPassword = await request('POST', `${baseUrl}/api/forgot-password`, { email }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(forgotCsrf.body).csrfToken
    }
  });
  if (forgotPassword.status !== 200) {
    throw new Error(`Password reset request failed: ${forgotPassword.body}`);
  }
  const resetToken = await readDevelopmentEmailLink('reset');
  const resetCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const resetPassword = await request('POST', `${baseUrl}/api/reset-password`, {
    token: resetToken,
    password: 'new-password-123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(resetCsrf.body).csrfToken
    }
  });
  if (resetPassword.status !== 200) {
    throw new Error(`Password reset failed: ${resetPassword.body}`);
  }
  const replayedReset = await request('POST', `${baseUrl}/api/reset-password`, {
    token: resetToken,
    password: 'another-password-123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(resetCsrf.body).csrfToken
    }
  });
  if (replayedReset.status !== 400) {
    throw new Error('Password-reset links should be single-use');
  }
  const revokedSession = await request('GET', `${baseUrl}/api/me`);
  if (revokedSession.status !== 401) {
    throw new Error('Password reset should invalidate existing sessions');
  }
  const newLoginCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const newLogin = await request('POST', `${baseUrl}/api/login`, {
    email,
    password: 'new-password-123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(newLoginCsrf.body).csrfToken
    }
  });
  if (newLogin.status !== 200) {
    throw new Error(`Could not sign in with reset password: ${newLogin.body}`);
  }

  const deleteCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const unprotectedDeletion = await request('DELETE', `${baseUrl}/api/me`, {
    password: 'new-password-123456'
  }, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (unprotectedDeletion.status !== 403) {
    throw new Error('Account deletion should require a CSRF token');
  }

  const failedDeletion = await request('DELETE', `${baseUrl}/api/me`, {
    password: 'wrong-password'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(deleteCsrf.body).csrfToken
    }
  });
  if (failedDeletion.status !== 401) {
    throw new Error('Account deletion should require the current password');
  }

  const confirmedDeletion = await request('DELETE', `${baseUrl}/api/me`, {
    password: 'new-password-123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(deleteCsrf.body).csrfToken
    }
  });
  if (confirmedDeletion.status !== 200) {
    throw new Error(`Account deletion failed: ${confirmedDeletion.body}`);
  }

  const deletedAccountLookup = await request('GET', `${baseUrl}/api/me`);
  if (deletedAccountLookup.status !== 401) {
    throw new Error('Deleted account session should no longer be authenticated');
  }
  const deletedAccountLoginCsrf = await request('GET', `${baseUrl}/api/csrf`);
  const deletedAccountLogin = await request('POST', `${baseUrl}/api/login`, {
    email,
    password: 'new-password-123456'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': JSON.parse(deletedAccountLoginCsrf.body).csrfToken
    }
  });
  if (deletedAccountLogin.status !== 401) {
    throw new Error('Deleted account should no longer be able to sign in');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
