const adventures = [
  { id: "adv-001", title: "Sunrise Rooftop Sketch", description: "Pack a small sketchbook and catch the first light from a nearby rooftop.", category: "Creative", effortLevel: "Low", location: { name: "Northbridge Rooftop", latitude: 47.6062, longitude: -122.3321 }, completed: false },
  { id: "adv-002", title: "Hidden Alley Coffee Loop", description: "Walk a short loop of alley cafes and journal one new detail in each.", category: "Food & Drink", effortLevel: "Medium", location: { name: "Old Town Alleyways", latitude: 45.5234, longitude: -122.6762 }, completed: true },
  { id: "adv-003", title: "Pocket Park Picnic", description: "Grab a snack and find a tucked-away park bench to reset your day.", category: "Nature", effortLevel: "Low", location: { name: "Willow Pocket Park", latitude: 40.7128, longitude: -74.006 }, completed: false }
];

const mapConfig = window.WISE_MAPS_CONFIG || {
  apiKey: "",
  center: { lat: 39.5, lng: -98.35 },
  zoom: 4
};

const mapLocations = createMapLocations();
const grid = document.getElementById("adventures-grid");
const accountActions = document.getElementById("account-actions");
const heroHint = document.getElementById("hero-hint");
const mapDialog = document.getElementById("map-dialog");
const mapCanvas = document.getElementById("map-canvas");
const mapSummary = document.getElementById("map-summary");
const insightList = document.getElementById("insight-list");

function createMapLocations() {
  const citySeeds = [
    { name: "Seattle", lat: 47.6062, lng: -122.3321 },
    { name: "Portland", lat: 45.5152, lng: -122.6784 },
    { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
    { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
    { name: "Denver", lat: 39.7392, lng: -104.9903 },
    { name: "Chicago", lat: 41.8781, lng: -87.6298 },
    { name: "New York", lat: 40.7128, lng: -74.006 },
    { name: "Boston", lat: 42.3601, lng: -71.0589 },
    { name: "Austin", lat: 30.2672, lng: -97.7431 },
    { name: "Miami", lat: 25.7617, lng: -80.1918 },
    { name: "Atlanta", lat: 33.749, lng: -84.388 },
    { name: "Nashville", lat: 36.1627, lng: -86.7816 },
    { name: "Toronto", lat: 43.6532, lng: -79.3832 },
    { name: "Mexico City", lat: 19.4326, lng: -99.1332 },
    { name: "Vancouver", lat: 49.2827, lng: -123.1207 },
    { name: "Honolulu", lat: 21.3069, lng: -157.8583 }
  ];

  const categories = ["Creative", "Nature", "Food & Drink", "Wellness", "Nightlife", "Culture", "Discovery", "Outdoors"];
  const highlightNames = ["Rooftop", "Trailhead", "Garden", "Harbor", "Lantern", "Studio", "Lookout", "Market", "Pier"];

  return Array.from({ length: 240 }, (_, index) => {
    const city = citySeeds[index % citySeeds.length];
    const category = categories[index % categories.length];
    const highlight = index % 8 === 0;
    const offsetLat = (Math.random() - 0.5) * 1.8;
    const offsetLng = (Math.random() - 0.5) * 2.4;
    const latitude = Number((city.lat + offsetLat).toFixed(4));
    const longitude = Number((city.lng + offsetLng).toFixed(4));
    const placeName = highlight
      ? `${city.name} ${highlightNames[index % highlightNames.length]}`
      : `${city.name} ${category} ${index % 7 + 1}`;

    return {
      id: `location-${index + 1}`,
      name: placeName,
      category,
      insight: highlight
        ? "High-visibility spot with strong seasonal demand and easy foot traffic."
        : "Promising area for a micro-adventure with walkable access and a clear local vibe.",
      highlight,
      latitude,
      longitude
    };
  });
}

function renderMapSummary() {
  const highlighted = mapLocations.filter((location) => location.highlight).length;
  const uniqueCategories = new Set(mapLocations.map((location) => location.category)).size;

  const summaryItems = [
    { label: "Locations", value: `${mapLocations.length}` },
    { label: "Highlights", value: `${highlighted}` },
    { label: "Categories", value: `${uniqueCategories}` },
    { label: "Coverage", value: `${mapLocations.length > 200 ? "National" : "Regional"}` }
  ];

  mapSummary.replaceChildren();
  summaryItems.forEach((item) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = item.label;
    value.textContent = item.value;
    row.append(label, value);
    mapSummary.appendChild(row);
  });
}

function renderInsights() {
  const featured = [...new Map(
    mapLocations.map((location) => [location.category, location])
  ).values()].slice(0, 5);

  insightList.replaceChildren();
  featured.forEach((location) => {
    const item = document.createElement("li");
    item.className = "insight-item";
    const title = document.createElement("strong");
    title.textContent = location.category;
    const copy = document.createElement("span");
    copy.textContent = location.insight;
    item.append(title, copy);
    insightList.appendChild(item);
  });
}

function renderFallbackMap() {
  mapCanvas.replaceChildren();
  const background = document.createElement("div");
  background.className = "map-fallback-layer";
  mapCanvas.appendChild(background);

  mapLocations.forEach((location) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `map-pin${location.highlight ? " is-highlight" : ""}`;
    marker.title = `${location.name} · ${location.category}`;
    marker.setAttribute("aria-label", `${location.name}. ${location.insight}`);
    marker.style.left = `${((location.longitude + 180) / 360) * 100}%`;
    marker.style.top = `${((90 - location.latitude) / 180) * 100}%`;
    marker.addEventListener("click", () => {
      heroHint.textContent = `${location.name} · ${location.insight}`;
    });
    mapCanvas.appendChild(marker);
  });
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    const existingScript = document.getElementById("google-maps-script");
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google Maps failed to load.")), { once: true });
      return;
    }

    if (!apiKey) {
      reject(new Error("Google Maps API key is not configured."));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=WISE_MAPS_READY`;
    script.async = true;
    script.defer = true;
    window.WISE_MAPS_READY = () => resolve();
    script.addEventListener("error", () => reject(new Error("Google Maps failed to load.")));
    document.head.appendChild(script);
  });
}

function initializeGoogleMap() {
  if (!window.google || !window.google.maps) {
    renderFallbackMap();
    return;
  }

  const position = { lat: mapConfig.center.lat, lng: mapConfig.center.lng };
  const bounds = new google.maps.LatLngBounds();
  const map = new google.maps.Map(mapCanvas, {
    center: position,
    zoom: mapConfig.zoom,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    disableDefaultUI: true
  });

  mapLocations.forEach((location) => {
    const markerPosition = { lat: location.latitude, lng: location.longitude };
    const marker = new google.maps.Marker({
      position: markerPosition,
      map,
      title: location.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: location.highlight ? 9 : 7,
        fillColor: location.highlight ? "#f18c51" : "#4d7db8",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2
      }
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="max-width: 220px;"><strong>${location.name}</strong><br><span>${location.category}</span><br><small>${location.insight}</small></div>`
    });

    marker.addListener("click", () => {
      infoWindow.open({ anchor: marker, map });
    });

    bounds.extend(markerPosition);
  });

  if (mapLocations.length > 0) {
    map.fitBounds(bounds);
  }
}

function openMapDialog() {
  if (!mapDialog) return;
  mapDialog.hidden = false;
  renderMapSummary();
  renderInsights();

  if (mapConfig.apiKey) {
    loadGoogleMapsScript(mapConfig.apiKey)
      .then(() => initializeGoogleMap())
      .catch(() => renderFallbackMap());
  } else {
    renderFallbackMap();
  }
}

function closeMapDialog() {
  if (!mapDialog) return;
  mapDialog.hidden = true;
}

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
    accountActions.replaceChildren();
    const welcome = document.createElement("span"); welcome.className = "account-welcome"; welcome.textContent = "Hi, " + user.name;
    const logout = document.createElement("button"); logout.className = "logout-button"; logout.type = "button"; logout.textContent = "Log out";
    logout.addEventListener("click", logoutUser);
    accountActions.append(welcome, logout);
  } catch { showLoggedOut(); }
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

document.getElementById("open-map-dialog").addEventListener("click", openMapDialog);
document.getElementById("close-map-dialog").addEventListener("click", closeMapDialog);
mapDialog.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-map='true']")) {
    closeMapDialog();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mapDialog.hidden) {
    closeMapDialog();
  }
});

renderAdventures(adventures);
renderMapSummary();
renderInsights();
renderFallbackMap();
refreshAccount();
