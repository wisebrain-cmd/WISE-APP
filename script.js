const adventures = [
  { id: "adv-001", title: "Sunrise Rooftop Sketch", description: "Pack a small sketchbook and catch the first light from a nearby rooftop.", category: "Creative", effortLevel: "Low", location: { name: "Northbridge Rooftop", latitude: 47.6062, longitude: -122.3321 }, completed: false },
  { id: "adv-002", title: "Hidden Alley Coffee Loop", description: "Walk a short loop of alley cafes and journal one new detail in each.", category: "Food & Drink", effortLevel: "Medium", location: { name: "Old Town Alleyways", latitude: 45.5234, longitude: -122.6762 }, completed: true },
  { id: "adv-003", title: "Pocket Park Picnic", description: "Grab a snack and find a tucked-away park bench to reset your day.", category: "Nature", effortLevel: "Low", location: { name: "Willow Pocket Park", latitude: 40.7128, longitude: -74.006 }, completed: false }
];

const featuredDestinations = [
  { id: "geonames-1857910", name: "Kyoto", country: "Japan", mood: "Quiet temples & gardens", description: "Find stillness in garden paths, lantern-lit lanes, and centuries of craft.", image: "photo-1493976040374-85c8e12f0c0e", alt: "Traditional Kyoto streets framed by autumn leaves" },
  { id: "geonames-2267057", name: "Lisbon", country: "Portugal", mood: "Coastal city days", description: "Wander tiled streets, ride the hills, and let the Atlantic set the pace.", image: "photo-1555881400-74d7acaacd8b", alt: "Warm evening light over Lisbon rooftops" },
  { id: "geonames-3369157", name: "Cape Town", country: "South Africa", mood: "Mountain & ocean", description: "Pair ocean air with dramatic mountain views and colorful neighborhoods.", image: "photo-1580060839134-75a5edca2e99", alt: "Cape Town and Table Mountain beside the sea" },
  { id: "geonames-3128760", name: "Barcelona", country: "Spain", mood: "Art & sunshine", description: "Take the scenic route through bold architecture, markets, and seaside walks.", image: "photo-1539037116277-4db20889f2d4", alt: "Barcelona architecture in golden sunlight" },
  { id: "geonames-3176959", name: "Florence", country: "Italy", mood: "Artful slow travel", description: "Make time for riverside strolls, Renaissance treasures, and a long lunch.", image: "photo-1516483638261-f4dbaf036963", alt: "Florence rooftops and historic architecture" },
  { id: "geonames-6173331", name: "Vancouver", country: "Canada", mood: "City meets nature", description: "Trade the lively waterfront for forest trails without leaving the city.", image: "photo-1517935706615-2717063c2225", alt: "Vancouver skyline backed by mountains" }
];

const grid = document.getElementById("adventures-grid");
const featuredGrid = document.getElementById("featured-grid");
const nearbyGrid = document.getElementById("nearby-grid");
const nearbyStatus = document.getElementById("nearby-status");
const nearbyButton = document.getElementById("find-nearby");
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

function renderFeaturedDestinations() {
  for (const destination of featuredDestinations) {
    const card = document.createElement("article");
    card.className = "featured-card";
    const image = document.createElement("img");
    image.className = "featured-image";
    image.src = `https://images.unsplash.com/${destination.image}?auto=format&fit=crop&w=900&q=82`;
    image.alt = destination.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });

    const content = document.createElement("div");
    content.className = "featured-content";
    const mood = document.createElement("span");
    mood.className = "featured-mood";
    mood.textContent = destination.mood;
    const title = document.createElement("h3");
    title.textContent = destination.name;
    const country = document.createElement("span");
    country.className = "featured-country";
    country.textContent = destination.country;
    const description = document.createElement("p");
    description.textContent = destination.description;
    const link = document.createElement("button");
    link.className = "featured-link";
    link.type = "button";
    link.textContent = "Explore on the map";
    link.addEventListener("click", () => window.openMapForPlace(destination.id));
    content.append(mood, title, country, description, link);
    card.append(image, content);
    featuredGrid.appendChild(card);
  }
}

function distanceBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function recommendationCategory(place) {
  const category = String(place.category || "").toLowerCase().replaceAll("_", " ");
  if (/park|garden|nature reserve|beach|picnic|hot spring/.test(category)) return "Relax & recharge";
  if (/zoo|aquarium|theme park/.test(category)) return "Family fun";
  if (/museum|gallery|viewpoint|historic|attraction|artwork|fort|monument|castle|place of worship/.test(category)) return "Sightseeing";
  return "Local discovery";
}

function formatDistance(distance) {
  return distance < 10 ? `${distance.toFixed(1)} km away` : `${Math.round(distance)} km away`;
}

function renderNearbyPlaces(places, latitude, longitude) {
  const withDistances = places
    .filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .map(place => ({
      ...place,
      distance: distanceBetween(latitude, longitude, place.latitude, place.longitude),
      suggestionCategory: recommendationCategory(place)
    }))
    .sort((left, right) => left.distance - right.distance);
  const selected = [];
  const selectedIds = new Set();
  for (const category of ["Sightseeing", "Relax & recharge", "Family fun", "Local discovery"]) {
    const place = withDistances.find(candidate => candidate.suggestionCategory === category);
    if (place) {
      selected.push(place);
      selectedIds.add(place.id);
    }
  }
  for (const place of withDistances) {
    if (selected.length >= 6) break;
    if (!selectedIds.has(place.id)) {
      selected.push(place);
      selectedIds.add(place.id);
    }
  }

  nearbyGrid.replaceChildren();
  for (const place of selected) {
    const card = document.createElement("article");
    card.className = "nearby-card";
    const art = document.createElement("div");
    art.className = "nearby-card-art";
    art.dataset.category = place.suggestionCategory;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = place.suggestionCategory === "Relax & recharge" ? "☘"
      : place.suggestionCategory === "Family fun" ? "✦"
        : place.suggestionCategory === "Sightseeing" ? "⌖" : "✧";
    art.appendChild(icon);

    const content = document.createElement("div");
    content.className = "nearby-card-content";
    const category = document.createElement("span");
    category.className = "nearby-category";
    category.textContent = place.suggestionCategory;
    const title = document.createElement("h3");
    title.textContent = place.name;
    const distance = document.createElement("p");
    distance.textContent = formatDistance(place.distance);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nearby-map-link";
    button.textContent = "See on map";
    button.addEventListener("click", () => window.openMapForPlace(place));
    content.append(category, title, distance, button);
    card.append(art, content);
    nearbyGrid.appendChild(card);
  }
  return selected.length;
}

async function findNearbyDestinations(latitude, longitude) {
  const roundedLatitude = Number(latitude.toFixed(3));
  const roundedLongitude = Number(longitude.toFixed(3));
  const wrapLongitude = value => ((value + 180) % 360 + 360) % 360 - 180;
  const searchLatitude = Math.min(84.9, Math.max(-84.9, roundedLatitude));
  const south = searchLatitude - 0.06;
  const north = searchLatitude + 0.06;
  const west = wrapLongitude(roundedLongitude - 0.06);
  const east = wrapLongitude(roundedLongitude + 0.06);
  let attractionError;
  let attractionSearchSucceeded = false;

  try {
    const bbox = [south, west, north, east].map(value => value.toFixed(3)).join(",");
    const response = await fetch(`/api/locations/nearby?bbox=${encodeURIComponent(bbox)}`, {
      credentials: "same-origin"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nearby place search is temporarily unavailable.");
    attractionSearchSucceeded = true;
    if (Array.isArray(result.locations) && result.locations.length) {
      const count = renderNearbyPlaces(result.locations, latitude, longitude);
      if (count) {
        nearbyStatus.textContent = `${count} nearby ideas for sightseeing, time outdoors, and local discovery. Distances are approximate.`;
        return;
      }
    }
  } catch (error) {
    attractionError = error;
  }

  try {
    const response = await fetch("/locations.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the destination catalog.");
    const catalog = await response.json();
    const nearbyCities = catalog
      .filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
      .map(place => ({
        ...place,
        category: "Nearby town",
        source: "GeoNames",
        distance: distanceBetween(latitude, longitude, place.latitude, place.longitude)
      }))
      .filter(place => place.distance <= 120)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 6);
    const count = renderNearbyPlaces(nearbyCities, latitude, longitude);
    nearbyStatus.textContent = count
      ? attractionSearchSucceeded
        ? "No mapped attractions were found close by, so these nearby towns and cities may be a good starting point."
        : "Showing nearby towns and cities from our global catalog; individual attractions are temporarily unavailable."
      : "No nearby places were found in our catalog. Try the global map to explore further afield.";
  } catch (error) {
    nearbyStatus.textContent = attractionError
      ? "Nearby attractions are temporarily unavailable. Please try again or explore the global map."
      : error.message || "Could not load nearby places. Please try again.";
  }
}

nearbyButton.addEventListener("click", () => {
  nearbyGrid.replaceChildren();
  if (!window.isSecureContext || !navigator.geolocation) {
    nearbyStatus.textContent = "Location suggestions require a secure connection (HTTPS) and a browser that supports location.";
    return;
  }
  nearbyButton.disabled = true;
  nearbyStatus.textContent = "Requesting your location…";
  navigator.geolocation.getCurrentPosition(async position => {
    nearbyStatus.textContent = "Finding nearby sights, quiet outdoor spots, and places to explore…";
    try {
      await findNearbyDestinations(position.coords.latitude, position.coords.longitude);
    } finally {
      nearbyButton.disabled = false;
    }
  }, error => {
    nearbyButton.disabled = false;
    nearbyStatus.textContent = error.code === error.PERMISSION_DENIED
      ? "Location access was not allowed. You can enable it in your browser settings, or explore the global map."
      : error.code === error.TIMEOUT
        ? "We could not get your location in time. Please try again."
        : "Your location is unavailable right now. Please try again or explore the global map.";
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 });
});

document.getElementById("featured-open-map").addEventListener("click", () => {
  document.getElementById("open-map-dialog").click();
});

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
renderFeaturedDestinations();
refreshAccount();
