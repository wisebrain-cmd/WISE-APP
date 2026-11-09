const form = document.getElementById("auth-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const nameField = document.getElementById("name-field");
const nameInput = document.getElementById("name");
const passwordInput = document.getElementById("password");
const title = document.getElementById("auth-title");
const description = document.getElementById("auth-description");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("auth-message");
let mode = new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login";
let csrfToken = "";
let csrfTokenPromise = null;

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  title.textContent = registering ? "Start exploring." : "Welcome back.";
  description.textContent = registering
    ? "Create an account for your next little escape."
    : "Sign in and find your next little escape.";
  submitButton.textContent = registering ? "Create account" : "Sign in";
  nameField.hidden = !registering;
  nameInput.required = registering;
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  message.textContent = "";
}
loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      const response = await fetch("/api/csrf", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not start a secure session.");
      const result = await response.json();
      csrfToken = result.csrfToken;
      return csrfToken;
    })().finally(() => {
      csrfTokenPromise = null;
    });
  }
  return csrfTokenPromise;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  submitButton.disabled = true;
  loginTab.disabled = true;
  registerTab.disabled = true;
  form.elements.email.disabled = true;
  nameInput.disabled = true;
  passwordInput.disabled = true;
  try {
    const submittingMode = mode;
    const body = { email: form.elements.email.value.trim(), password: passwordInput.value };
    if (submittingMode === "register") body.name = nameInput.value.trim();
    const endpoint = submittingMode === "register" ? "/api/register" : "/api/login";
    let response;
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!csrfToken) await getCsrfToken();
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        credentials: "same-origin",
        body: JSON.stringify(body)
      });
      result = await response.json();
      if (response.status !== 403 || attempt === 1) break;
      csrfToken = "";
    }
    if (!response.ok) {
      if (response.status === 403) csrfToken = "";
      message.textContent = result.error || "Something went wrong. Please try again.";
      return;
    }
    window.location.assign("/");
  } catch {
    message.textContent = "Could not connect. Make sure the WSE server is running.";
  } finally {
    submitButton.disabled = false;
    loginTab.disabled = false;
    registerTab.disabled = false;
    form.elements.email.disabled = false;
    nameInput.disabled = false;
    passwordInput.disabled = false;
  }
});

setMode(mode);
getCsrfToken().catch(() => {
  message.textContent = "Could not connect to the server. Try refreshing this page.";
});
