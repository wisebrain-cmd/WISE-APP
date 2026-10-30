const adventures = [
  { id: "adv-001", title: "Sunrise Rooftop Sketch", description: "Pack a small sketchbook and catch the first light from a nearby rooftop.", category: "Creative", effortLevel: "Low", location: { name: "Northbridge Rooftop", latitude: 47.6062, longitude: -122.3321 }, completed: false },
  { id: "adv-002", title: "Hidden Alley Coffee Loop", description: "Walk a short loop of alley cafes and journal one new detail in each.", category: "Food & Drink", effortLevel: "Medium", location: { name: "Old Town Alleyways", latitude: 45.5234, longitude: -122.6762 }, completed: true },
  { id: "adv-003", title: "Pocket Park Picnic", description: "Grab a snack and find a tucked-away park bench to reset your day.", category: "Nature", effortLevel: "Low", location: { name: "Willow Pocket Park", latitude: 40.7128, longitude: -74.006 }, completed: false }
];

const grid = document.getElementById("adventures-grid");
const accountActions = document.getElementById("account-actions");
const heroHint = document.getElementById("hero-hint");
const settingsDialog = document.getElementById("settings-dialog");
const profileNameInput = document.getElementById("profile-name");
const profileSaveButton = document.getElementById("profile-save");
const settingsStatus = document.getElementById("settings-status");
let currentUser = null;

function getSavedTheme() {
  try {
    const savedTheme = localStorage.getItem("wise.theme");
    return ["light", "dark", "system"].includes(savedTheme) ? savedTheme : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme) {
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === theme;
  });
}

function openSettings() {
  if (!currentUser) return;
  profileNameInput.value = currentUser.name;
  settingsStatus.textContent = "Settings are saved to your browser.";
  settingsDialog.showModal();
}

document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    applyTheme(input.value);
    try {
      localStorage.setItem("wise.theme", input.value);
      settingsStatus.textContent = "Appearance preference saved.";
    } catch {
      settingsStatus.textContent = "Appearance changed for this visit, but could not be saved in this browser.";
    }
  });
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getSavedTheme() === "system") applyTheme("system");
});
applyTheme(getSavedTheme());

profileSaveButton.addEventListener("click", async () => {
  if (!currentUser) return;
  const name = profileNameInput.value.trim();
  if (name.length < 2 || name.length > 80) {
    settingsStatus.textContent = "Display name must be between 2 and 80 characters.";
    profileNameInput.focus();
    return;
  }
  profileSaveButton.disabled = true;
  try {
    const csrfResponse = await fetch("/api/csrf", { credentials: "same-origin" });
    if (!csrfResponse.ok) throw new Error("Could not start a secure request.");
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch("/api/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update your profile.");
    currentUser = result.user;
    renderAccount();
    if (typeof updateMapReviewAuth === "function") updateMapReviewAuth();
    settingsStatus.textContent = "Profile updated successfully.";
  } catch (error) {
    settingsStatus.textContent = error.message || "Could not update your profile.";
  } finally {
    profileSaveButton.disabled = false;
  }
});

function renderAdventures(items) {
  grid.replaceChildren();
  items.forEach((adventure) => {
    const card = document.createElement("article");
    card.className = "adventure-card";
    const top = document.createElement("div"); top.className = "adventure-top";
    const heading = document.createElement("h3"); heading.textContent = adventure.title;
    const status = document.createElement("span"); status.className = "adventure-status";
    status.dataset.completed = String(adventure.completed);
    status.textContent = adventure.completed ? "Completed" : "In progress";
    top.append(heading, status);
    const description = document.createElement("p"); description.className = "adventure-description"; description.textContent = adventure.description;
    const meta = document.createElement("div"); meta.className = "adventure-meta";
    const category = document.createElement("span"); category.textContent = adventure.category;
    const effort = document.createElement("span"); effort.textContent = adventure.effortLevel + " effort";
    meta.append(category, effort);
    const location = document.createElement("div"); location.className = "adventure-location";
    const place = document.createElement("strong"); place.textContent = adventure.location.name;
    const coords = document.createElement("span"); coords.textContent = adventure.location.latitude.toFixed(4) + ", " + adventure.location.longitude.toFixed(4);
    location.append(place, coords);
    card.append(top, description, meta, location);
    grid.appendChild(card);
  });
}

function showLoggedOut() {
  currentUser = null;
  if (typeof updateMapReviewAuth === "function") updateMapReviewAuth();
  accountActions.replaceChildren();
  const login = document.createElement("a"); login.className = "nav-link"; login.href = "/login.html"; login.textContent = "Sign in";
  const signup = document.createElement("a"); signup.className = "nav-cta"; signup.href = "/login.html?mode=register"; signup.textContent = "Create account";
  accountActions.append(login, signup);
}

async function refreshAccount() {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) { showLoggedOut(); return; }
    const { user } = await response.json();
    currentUser = user;
    renderAccount();
    if (typeof updateMapReviewAuth === "function") updateMapReviewAuth();
  } catch { showLoggedOut(); }
}

function renderAccount() {
  accountActions.replaceChildren();
  const welcome = document.createElement("span");
  welcome.className = "account-welcome";
  welcome.textContent = "Hi, " + currentUser.name;
  const settings = document.createElement("button");
  settings.className = "settings-button";
  settings.type = "button";
  settings.textContent = "Settings";
  settings.setAttribute("aria-haspopup", "dialog");
  settings.setAttribute("aria-controls", "settings-dialog");
  settings.addEventListener("click", openSettings);
  const logout = document.createElement("button");
  logout.className = "logout-button";
  logout.type = "button";
  logout.textContent = "Log out";
  logout.addEventListener("click", logoutUser);
  accountActions.append(welcome, settings, logout);
}

async function logoutUser() {
  const button = accountActions.querySelector("button");
  if (button) button.disabled = true;
  try {
    const csrfResponse = await fetch("/api/csrf", { credentials: "same-origin" });
    if (!csrfResponse.ok) throw new Error("Security token unavailable");
    const csrf = await csrfResponse.json();
    const response = await fetch("/api/logout", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken }, body: "{}"
    });
    if (!response.ok) throw new Error("Logout failed");
    showLoggedOut(); heroHint.textContent = "You have been logged out safely.";
  } catch { heroHint.textContent = "Could not log out. Please try again."; if (button) button.disabled = false; }
}

let nextIndex = 0;
document.getElementById("next-adventure").addEventListener("click", () => {
  const adventure = adventures[nextIndex % adventures.length]; nextIndex += 1;
  heroHint.textContent = "Try this: " + adventure.title + " · " + adventure.effortLevel + " effort.";
  document.getElementById("adventures-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

renderAdventures(adventures);
refreshAccount();
