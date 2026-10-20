const adventures = [
  { id: "adv-001", title: "Sunrise Rooftop Sketch", description: "Pack a small sketchbook and catch the first light from a nearby rooftop.", category: "Creative", effortLevel: "Low", location: { name: "Northbridge Rooftop", latitude: 47.6062, longitude: -122.3321 } },
  { id: "adv-002", title: "Hidden Alley Coffee Loop", description: "Walk a short loop of alley cafes and journal one new detail in each.", category: "Food & Drink", effortLevel: "Medium", location: { name: "Old Town Alleyways", latitude: 45.5234, longitude: -122.6762 } },
  { id: "adv-003", title: "Pocket Park Picnic", description: "Grab a snack and find a tucked-away park bench to reset your day.", category: "Nature", effortLevel: "Low", location: { name: "Willow Pocket Park", latitude: 40.7128, longitude: -74.006 } }
];
const grid = document.getElementById("adventures-grid");
const accountActions = document.getElementById("account-actions");
const heroHint = document.getElementById("hero-hint");
const settingsDialog = document.getElementById("settings-dialog");
const settingsButton = document.getElementById("settings-button");
const settingsStatus = document.getElementById("settings-status");
const completedAdventureIds = new Set();
let isSignedIn = false;

function applyTheme(theme) {
  const useSystemTheme = theme === "system";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = useSystemTheme
    ? (prefersDark ? "dark" : "light")
    : theme;
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === theme;
  });
}

function loadTheme() {
  try {
    return localStorage.getItem("wise.theme") || "light";
  } catch {
    return "light";
  }
}

settingsButton.addEventListener("click", () => settingsDialog.showModal());
document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    applyTheme(input.value);
    try {
      localStorage.setItem("wise.theme", input.value);
      settingsStatus.textContent = "Your choice is saved in this browser.";
    } catch {
      settingsStatus.textContent = "Your choice applies until you close this page.";
    }
  });
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (loadTheme() === "system") applyTheme("system");
});
applyTheme(loadTheme());

function renderAdventures(items) {
  grid.replaceChildren();
  items.forEach((adventure) => {
    const completed = isSignedIn && completedAdventureIds.has(adventure.id);
    const card = document.createElement("article");
    card.className = "adventure-card";
    const top = document.createElement("div"); top.className = "adventure-top";
    const heading = document.createElement("h3"); heading.textContent = adventure.title;
    const status = document.createElement("span"); status.className = "adventure-status";
    status.dataset.completed = String(completed);
    status.textContent = completed ? "Completed" : "In progress";
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
    const progressAction = isSignedIn
      ? document.createElement("button")
      : document.createElement("a");
    progressAction.className = "adventure-progress-action";
    if (isSignedIn) {
      progressAction.type = "button";
      progressAction.textContent = completed ? "Mark in progress" : "Mark complete";
      progressAction.addEventListener("click", () => updateAdventureProgress(adventure, !completed, progressAction));
    } else {
      progressAction.href = "/login.html";
      progressAction.textContent = "Sign in to track";
    }
    card.append(top, description, meta, location, progressAction);
    grid.appendChild(card);
  });
}
async function updateAdventureProgress(adventure, completed, button) {
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const csrfResponse = await fetch("/api/csrf", { credentials: "same-origin" });
    if (!csrfResponse.ok) throw new Error("Security token unavailable");
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch(`/api/progress/${encodeURIComponent(adventure.id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ completed })
    });
    if (!response.ok) throw new Error("Progress update failed");
    if (completed) completedAdventureIds.add(adventure.id);
    else completedAdventureIds.delete(adventure.id);
    renderAdventures(adventures);
    heroHint.textContent = completed
      ? `${adventure.title} marked complete.`
      : `${adventure.title} marked in progress.`;
  } catch {
    heroHint.textContent = "Could not save progress. Please try again.";
    button.disabled = false;
    button.textContent = completed ? "Mark complete" : "Mark in progress";
  }
}
function showLoggedOut() {
  accountActions.replaceChildren();
  const login = document.createElement("a"); login.className = "nav-link"; login.href = "/login.html"; login.textContent = "Sign in";
  const signup = document.createElement("a"); signup.className = "nav-cta"; signup.href = "/login.html?mode=register"; signup.textContent = "Create account";
  accountActions.append(login, signup);
}
async function refreshAccount() {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) {
      isSignedIn = false;
      completedAdventureIds.clear();
      showLoggedOut();
      renderAdventures(adventures);
      return;
    }
    const { user } = await response.json();
    const progressResponse = await fetch("/api/progress", { credentials: "same-origin" });
    if (!progressResponse.ok) throw new Error("Could not load adventure progress");
    const progress = await progressResponse.json();
    isSignedIn = true;
    completedAdventureIds.clear();
    progress.completedAdventureIds.forEach(id => completedAdventureIds.add(id));
    accountActions.replaceChildren();
    const welcome = document.createElement("span"); welcome.className = "account-welcome"; welcome.textContent = "Hi, " + user.name;
    const logout = document.createElement("button"); logout.className = "logout-button"; logout.type = "button"; logout.textContent = "Log out";
    logout.addEventListener("click", logoutUser);
    accountActions.append(welcome, logout);
    renderAdventures(adventures);
  } catch {
    isSignedIn = false;
    completedAdventureIds.clear();
    showLoggedOut();
    renderAdventures(adventures);
  }
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
    isSignedIn = false;
    completedAdventureIds.clear();
    showLoggedOut();
    renderAdventures(adventures);
    heroHint.textContent = "You have been logged out safely.";
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
