const form = document.getElementById("auth-form");
const actionForm = document.getElementById("email-action-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const tabs = document.querySelector(".auth-tabs");
const nameField = document.getElementById("name-field");
const nameInput = document.getElementById("name");
const passwordInput = document.getElementById("password");
const title = document.getElementById("auth-title");
const description = document.getElementById("auth-description");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("auth-message");
const actionMessage = document.getElementById("action-message");
const actionSubmit = document.getElementById("action-submit");
const actionEmailField = document.getElementById("action-email-field");
const actionEmail = document.getElementById("action-email");
const actionPasswordField = document.getElementById("action-password-field");
const newPassword = document.getElementById("new-password");
const forgotPasswordLink = document.getElementById("forgot-password-link");
const resendVerification = document.getElementById("resend-verification");
const googleSignIn = document.getElementById("google-sign-in");
const query = new URLSearchParams(window.location.search);
const token = query.get("token") || "";
const requestedMode = query.get("mode") || "login";
let mode = ["login", "register", "forgot", "reset", "verify"].includes(requestedMode)
  ? requestedMode
  : "login";
let csrfToken = "";

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  const actionMode = ["forgot", "reset", "verify"].includes(mode);
  const titleText = {
    login: "Welcome back.",
    register: "Start exploring.",
    forgot: "Reset your password.",
    reset: "Choose a new password.",
    verify: "Verify your email."
  };
  const descriptionText = {
    login: "Sign in and find your next little escape.",
    register: "Create an account for your next little escape.",
    forgot: "We’ll email you a secure link if a verified account matches.",
    reset: "Choose a new password for your account.",
    verify: "Confirm your email address to finish creating your account."
  };
  title.textContent = titleText[mode] || titleText.login;
  description.textContent = descriptionText[mode] || descriptionText.login;
  tabs.hidden = actionMode;
  form.hidden = actionMode;
  actionForm.hidden = !actionMode;
  nameField.hidden = !registering;
  nameInput.required = registering;
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  loginTab.classList.toggle("active", mode === "login");
  registerTab.classList.toggle("active", registering);
  forgotPasswordLink.hidden = mode !== "login";
  resendVerification.hidden = mode !== "login";
  actionEmailField.hidden = !["forgot"].includes(mode);
  actionEmail.required = mode === "forgot";
  actionPasswordField.hidden = mode !== "reset";
  newPassword.required = mode === "reset";
  actionSubmit.hidden = mode === "verify";
  actionSubmit.textContent = mode === "forgot" ? "Send reset link" : "Set new password";
  message.textContent = "";
  actionMessage.textContent = "";
}
loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
forgotPasswordLink.addEventListener("click", () => setMode("forgot"));

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not start a secure session.");
  const result = await response.json();
  csrfToken = result.csrfToken;
}

async function postJson(url, body) {
  if (!csrfToken) await getCsrfToken();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (response.status === 403) csrfToken = "";
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  submitButton.disabled = true;
  try {
    const body = { email: form.elements.email.value.trim(), password: passwordInput.value };
    if (mode === "register") body.name = nameInput.value.trim();
    const result = await postJson(mode === "register" ? "/api/register" : "/api/login", body);
    if (mode === "register") {
      message.textContent = result.message;
      resendVerification.hidden = false;
      return;
    }
    window.location.assign("/");
  } catch (error) {
    if (mode === "register") resendVerification.hidden = false;
    message.textContent = error.message || "Could not connect. Make sure the WSE server is running.";
  } finally {
    submitButton.disabled = false;
  }
});

resendVerification.addEventListener("click", async () => {
  message.textContent = "";
  try {
    const result = await postJson("/api/resend-verification", { email: form.elements.email.value.trim() });
    message.textContent = result.message;
  } catch (error) {
    message.textContent = error.message || "Could not send a verification email.";
  }
});

actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  actionMessage.textContent = "";
  actionSubmit.disabled = true;
  try {
    if (mode === "forgot") {
      const result = await postJson("/api/forgot-password", { email: actionEmail.value.trim() });
      actionMessage.textContent = result.message;
    } else if (mode === "reset") {
      const result = await postJson("/api/reset-password", { token, password: newPassword.value });
      window.history.replaceState(null, "", "/login.html");
      setMode("login");
      message.textContent = result.message;
      form.elements.email.focus();
    }
  } catch (error) {
    actionMessage.textContent = error.message || "Could not complete this request.";
  } finally {
    actionSubmit.disabled = false;
  }
});

async function verifyEmail() {
  const verifyButton = document.createElement("button");
  verifyButton.className = "hero-button";
  verifyButton.type = "button";
  verifyButton.textContent = "Verify email";
  actionForm.append(verifyButton);
  verifyButton.addEventListener("click", async () => {
    verifyButton.disabled = true;
    try {
      const result = await postJson("/api/verify-email", { token });
      window.history.replaceState(null, "", "/login.html");
      setMode("login");
      message.textContent = result.message;
      form.elements.email.focus();
    } catch (error) {
      actionMessage.textContent = error.message || "Could not verify your email.";
      verifyButton.disabled = false;
    }
  });
}

async function initializeAuthPage() {
  setMode(mode);
  try {
    const response = await fetch("/api/auth/providers", { credentials: "same-origin" });
    if (response.ok) {
      const providers = await response.json();
      googleSignIn.hidden = !providers.google;
    }
  } catch {
    googleSignIn.hidden = true;
  }
  if (mode === "verify") verifyEmail();
  if (query.has("error")) {
    const errors = {
      google: "Google sign-in could not be completed. Please try again.",
      google_email: "Google must confirm your email address before sign-in.",
      google_link: "That email is linked to a different Google account.",
      oauth_state: "Sign-in expired or could not be verified. Please try again."
    };
    message.textContent = errors[query.get("error")] || errors.google;
    setMode("login");
    message.textContent = errors[query.get("error")] || errors.google;
  }
}

initializeAuthPage();
