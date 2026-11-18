const requestForm = document.getElementById("request-form");
const resetForm = document.getElementById("reset-form");
const description = document.getElementById("auth-description");
const message = document.getElementById("auth-message");
const token = new URLSearchParams(window.location.search).get("token") || "";
let csrfToken = "";

if (token) {
  resetForm.hidden = false;
  description.textContent = "Choose a new password. This link can only be used once.";
} else {
  requestForm.hidden = false;
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

requestForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = requestForm.querySelector("button[type='submit']");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await post("/api/password/forgot", { email: requestForm.elements.email.value.trim() });
    message.textContent = result.message;
    requestForm.reset();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

resetForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = resetForm.querySelector("button[type='submit']");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await post("/api/password/reset", { token, newPassword: resetForm.elements.newPassword.value });
    message.textContent = result.message;
    resetForm.reset();
    window.history.replaceState(null, "", "/password-reset.html");
    window.setTimeout(() => window.location.assign("/login.html"), 1200);
  } catch (error) {
    message.textContent = error.message;
    submit.disabled = false;
  }
});

getCsrfToken().catch(error => { message.textContent = error.message; });
