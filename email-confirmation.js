const verifyForm = document.getElementById("verify-form");
const resendForm = document.getElementById("resend-form");
const description = document.getElementById("auth-description");
const message = document.getElementById("auth-message");
const token = new URLSearchParams(window.location.search).get("token") || "";
let csrfToken = "";

if (token) {
  verifyForm.hidden = false;
  description.textContent = "Confirm this address to finish verifying or changing your account email.";
} else {
  resendForm.hidden = false;
  description.textContent = "Enter your account email and we’ll send a fresh confirmation link if needed.";
}

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not start a secure session.");
  csrfToken = (await response.json()).csrfToken;
}

async function post(path, body) {
  if (!csrfToken) await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) csrfToken = "";
    throw new Error(result.error || "Could not complete that request.");
  }
  return result;
}

verifyForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = verifyForm.querySelector("button[type='submit']");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await post("/api/email/verify", { token });
    message.textContent = result.isAuthenticated
      ? `${result.message} Opening your account…`
      : `${result.message} Sign in to continue.`;
    window.setTimeout(() => window.location.assign(result.isAuthenticated ? "/dashboard" : "/login.html"), 900);
  } catch (error) {
    message.textContent = error.message;
    submit.disabled = false;
  }
});

resendForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = resendForm.querySelector("button[type='submit']");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await post("/api/email/verification-request", { email: resendForm.elements.email.value.trim() });
    message.textContent = result.message;
    resendForm.reset();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

getCsrfToken().catch(error => { message.textContent = error.message; });
