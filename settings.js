const model = window.WSESettingsModel;
const categories = [
  { id: "account", label: "Account", summary: "Your profile and sign-in details.", icon: "user" },
  { id: "map", label: "Map settings", summary: "Choose what you see on the map.", icon: "map" },
  { id: "navigation", label: "Navigation", summary: "Set your route and guidance preferences.", icon: "route" },
  { id: "location", label: "Location", summary: "Manage location access and saved addresses.", icon: "pin" },
  { id: "places", label: "Places & discovery", summary: "Shape nearby places and recommendations.", icon: "compass" },
  { id: "notifications", label: "Notifications", summary: "Choose which updates reach you.", icon: "bell" },
  { id: "appearance", label: "Appearance", summary: "Personalize how WSE Adventures looks.", icon: "sun" },
  { id: "privacy", label: "Privacy & security", summary: "Control your data and account security.", icon: "shield" },
  { id: "savedPlaces", label: "Saved places", summary: "Keep the places you return to close.", icon: "bookmark" },
  { id: "offlineMaps", label: "Offline maps", summary: "Manage offline map availability.", icon: "download" },
  { id: "accessibility", label: "Accessibility", summary: "Make the experience work better for you.", icon: "accessibility" },
  { id: "about", label: "About WSE Adventures", summary: "App details, help, and feedback.", icon: "info" }
];

const iconPaths = {
  user: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.7-3.1 3.1-4.8 7-4.8s6.3 1.7 7 4.8"></path>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"></path><path d="M9 3v15m6-12v15"></path>',
  route: '<circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M8 18h4a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"></path>',
  pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle>',
  compass: '<circle cx="12" cy="12" r="9"></circle><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2z"></path>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path><path d="m9 12 2 2 4-4"></path>',
  bookmark: '<path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z"></path>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"></path><path d="M5 17v4h14v-4"></path>',
  accessibility: '<circle cx="12" cy="4" r="2"></circle><path d="m5 8 7 2 7-2m-7 2v5m0-5-4 9m4-4 4 4"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5m0-9h.01"></path>'
};

const sections = {
  map: [
    { title: "Map display", fields: [
      { key: "mapType", label: "Default map type", type: "select", options: [["standard", "Standard"], ["satellite", "Satellite"], ["terrain", "Terrain"]] },
      { key: "mapLabels", label: "Map labels", type: "toggle" },
      { key: "buildings3D", label: "3D buildings", type: "toggle" },
      { key: "autoRotate", label: "Auto-rotate map", type: "toggle" }
    ] },
    { title: "Places on the map", fields: [
      { key: "showTraffic", label: "Show traffic", type: "toggle" },
      { key: "showTransit", label: "Show transit", type: "toggle" },
      { key: "showBicycleRoutes", label: "Show bicycle routes", type: "toggle" },
      { key: "showWalkingRoutes", label: "Show walking routes", type: "toggle" },
      { key: "showLandmarks", label: "Show landmarks", type: "toggle" },
      { key: "showBusinesses", label: "Show businesses", type: "toggle" }
    ] },
    { title: "Reset", message: "Restore every map option to its original setting.", action: { label: "Reset map settings", handler: "reset-map" } }
  ],
  navigation: [
    { title: "Route preferences", fields: [
      { key: "travelMode", label: "Travel mode", type: "select", options: [["driving", "Driving"], ["walking", "Walking"], ["cycling", "Cycling"], ["transit", "Public transit"]] },
      { key: "preferFasterRoutes", label: "Prefer faster routes", type: "toggle" },
      { key: "avoidTolls", label: "Avoid toll roads", type: "toggle" },
      { key: "avoidHighways", label: "Avoid highways", type: "toggle" },
      { key: "avoidFerries", label: "Avoid ferries", type: "toggle" }
    ] },
    { title: "Guidance", fields: [
      { key: "voiceNavigation", label: "Voice navigation", type: "toggle" },
      { key: "voiceVolume", label: "Voice volume", type: "range", min: 0, max: 100, suffix: "%" },
      { key: "navigationNotifications", label: "Navigation notifications", type: "toggle" },
      { key: "autoStartNavigation", label: "Automatically start navigation", type: "toggle" }
    ] }
  ],
  location: [
    { title: "Location access", fields: [
      { key: "locationAccess", label: "Location access", type: "select", options: [["while-using", "While using the app"], ["ask-every-time", "Ask every time"], ["never", "Never"]] },
      { key: "useCurrentLocation", label: "Use current location", type: "toggle" },
      { key: "locationAccuracy", label: "Location accuracy", type: "select", options: [["precise", "Precise"], ["approximate", "Approximate"]] },
      { key: "locationHistory", label: "Location history", type: "toggle" }
    ] },
    { title: "Your places", fields: [
      { key: "homeLocation", label: "Home location", type: "text", category: "location", placeholder: "Add a home address" },
      { key: "workLocation", label: "Work location", type: "text", category: "location", placeholder: "Add a work address" }
    ] },
    { title: "Permissions", message: "WSE Adventures only accesses your device location when you choose to use it. Browser permissions are managed in your browser settings.", action: { label: "Manage location permissions", message: "Open your browser's site settings to change location permissions." } }
  ],
  places: [
    { title: "Discover nearby", fields: [
      { key: "nearbyPlaces", label: "Nearby places", type: "toggle" },
      { key: "attractions", label: "Attractions", type: "toggle" },
      { key: "recommendedPlaces", label: "Recommended places", type: "toggle" },
      { key: "personalizedRecommendations", label: "Personalized recommendations", type: "toggle" }
    ] },
    { title: "Place preferences", fields: [
      { key: "restaurantPreferences", label: "Restaurant preferences", type: "select", options: [["all", "All restaurants"], ["vegetarian", "Vegetarian-friendly"], ["vegan", "Vegan-friendly"], ["family-friendly", "Family-friendly"]] },
      { key: "hotelPreferences", label: "Hotel preferences", type: "select", options: [["all", "All stays"], ["budget", "Budget"], ["boutique", "Boutique"], ["accessible", "Accessible"]] },
      { key: "shoppingPreferences", label: "Shopping preferences", type: "select", options: [["all", "All shopping"], ["local", "Local shops"], ["markets", "Markets"], ["malls", "Shopping centers"]] }
    ] },
    { title: "Search history", fields: [{ key: "searchHistory", label: "Save search history", type: "toggle" }], action: { label: "Clear search history", message: "Search history is not collected by this version of WSE Adventures." } }
  ],
  notifications: [
    { title: "Travel updates", fields: [
      { key: "navigation", label: "Navigation notifications", type: "toggle" },
      { key: "trafficAlerts", label: "Traffic alerts", type: "toggle" },
      { key: "routeChanges", label: "Route changes", type: "toggle" },
      { key: "nearbyPlaces", label: "Nearby places", type: "toggle" },
      { key: "travelRecommendations", label: "Travel recommendations", type: "toggle" }
    ] },
    { title: "Messages", fields: [
      { key: "promotions", label: "Promotions", type: "toggle" },
      { key: "accountNotifications", label: "Account notifications", type: "toggle" },
      { key: "emailNotifications", label: "Email notifications", type: "toggle" },
      { key: "pushNotifications", label: "Push notifications", type: "toggle" }
    ] },
    { title: "Delivery", message: "These preferences are saved to your account. Push and travel alerts will be delivered when those services are available." }
  ],
  appearance: [
    { title: "Theme", fields: [
      { key: "theme", label: "Appearance", type: "select", options: [["light", "Light mode"], ["dark", "Dark mode"], ["system", "System default"]] },
      { key: "mapAppearance", label: "Map appearance", type: "select", options: [["automatic", "Automatic"], ["light", "Light"], ["dark", "Dark"], ["satellite", "Satellite"]] }
    ] },
    { title: "Regional preferences", fields: [
      { key: "language", label: "Language", type: "select", options: [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"]], help: "Your preference is saved; translated interface text is not available yet." },
      { key: "distanceUnits", label: "Distance units", type: "select", options: [["kilometers", "Kilometers"], ["miles", "Miles"]] },
      { key: "temperatureUnits", label: "Temperature units", type: "select", options: [["celsius", "Celsius"], ["fahrenheit", "Fahrenheit"]] }
    ] }
  ],
  privacy: [
    { title: "Your data", fields: [
      { key: "locationSharing", label: "Location sharing", type: "toggle" },
      { key: "locationHistory", label: "Location history", type: "toggle" },
      { key: "searchHistory", label: "Search history", type: "toggle" },
      { key: "dataCollection", label: "Optional data collection", type: "toggle" },
      { key: "personalization", label: "Personalized recommendations", type: "toggle" }
    ] },
    { title: "Active sessions", message: "Review active sign-ins for this account.", activeSessions: true, action: { label: "Sign out of all devices", destructive: false, handler: "logout-all" } },
    { title: "Account removal", message: "Deleting your account permanently removes your WSE Adventures profile and saved preferences.", action: { label: "Delete account", destructive: true, handler: "delete-account" } }
  ],
  savedPlaces: [
    { title: "Home and work", fields: [
      { key: "home", label: "Home", type: "text", category: "savedPlaces", placeholder: "Add a home address" },
      { key: "work", label: "Work", type: "text", category: "savedPlaces", placeholder: "Add a work address" }
    ] },
    { title: "Your collection", placeCollection: true }
  ],
  offlineMaps: [
    { title: "Download maps", message: "Offline map downloads are not supported by the map provider configured for this WSE Adventures installation. No map data is stored or downloaded.", action: { label: "Download maps", message: "Offline map downloads are not available in this installation." } },
    { title: "Manage downloaded maps", message: "No downloaded maps are available to manage." },
    { title: "Automatic updates", fields: [{ key: "automaticUpdates", label: "Automatic map updates", type: "toggle" }] },
    { title: "Storage", message: "Storage used by downloaded maps: 0 MB.", action: { label: "Delete downloaded maps", message: "There are no downloaded maps to delete." } }
  ],
  accessibility: [
    { title: "Display", fields: [
      { key: "largerText", label: "Larger text", type: "toggle" },
      { key: "highContrast", label: "High contrast", type: "toggle" },
      { key: "reducedMotion", label: "Reduced motion", type: "toggle" }
    ] },
    { title: "Navigation support", fields: [
      { key: "screenReaderSupport", label: "Screen reader support", type: "toggle" },
      { key: "voiceGuidance", label: "Voice guidance", type: "toggle" },
      { key: "accessibleRoutes", label: "Accessible route preferences", type: "toggle" }
    ] }
  ]
};

const nav = document.getElementById("settings-nav");
const panel = document.getElementById("settings-panel");
const status = document.getElementById("settings-status");
const search = document.getElementById("settings-search");
const backButton = document.getElementById("settings-back");
let settings = model.getDefaultSettings();
let user = null;
let csrfToken = "";
let activeCategory = "account";
let query = "";
let saveQueue = Promise.resolve();

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = iconPaths[name];
  return svg;
}

function setStatus(message, failed = false) {
  status.textContent = message;
  status.classList.toggle("is-error", failed);
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign("/login.html?next=%2Fsettings");
    throw new Error("Please sign in to manage your settings.");
  }
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

function categoryText(category) {
  const settingText = (sections[category.id] || []).flatMap((section) =>
    (section.fields || []).map((field) => `${field.label} ${field.help || ""}`)
  ).join(" ");
  const extraText = {
    account: "profile photo password security connected accounts sign out active sessions",
    places: "clear search history",
    offlineMaps: "download maps manage downloaded maps storage usage delete downloaded maps",
    about: "app version terms of service privacy policy help center report a problem send feedback"
  }[category.id] || "";
  return `${category.label} ${category.summary} ${settingText} ${extraText}`.toLowerCase();
}

function renderNavigation() {
  nav.replaceChildren();
  for (const category of categories) {
    if (query && !categoryText(category).includes(query)) continue;
    const button = document.createElement("button");
    button.className = "settings-nav-item";
    button.type = "button";
    button.setAttribute("aria-current", String(category.id === activeCategory));
    button.append(icon(category.icon));
    const label = document.createElement("span");
    label.textContent = category.label;
    button.append(label);
    button.addEventListener("click", () => selectCategory(category.id));
    nav.append(button);
  }
}

function selectCategory(id) {
  activeCategory = id;
  document.body.classList.add("settings-category-open");
  renderNavigation();
  renderCategory();
}

function addFieldRow(container, categoryId, field) {
  const category = field.category || categoryId;
  const row = document.createElement("div");
  row.className = "setting-row";
  row.dataset.settingText = `${field.label} ${field.help || ""}`.toLowerCase();
  const copy = document.createElement("div");
  copy.className = "setting-copy";
  const label = document.createElement("span");
  label.className = "setting-label";
  label.textContent = field.label;
  const id = `${category}-${field.key}`;
  label.id = `${id}-label`;
  copy.append(label);
  if (field.help) {
    const help = document.createElement("span");
    help.className = "setting-help";
    help.textContent = field.help;
    copy.append(help);
  }
  const control = makeControl(field, category, id, label);
  row.append(copy, control);
  container.append(row);
}

function makeControl(field, category, id, label) {
  const value = settings[category][field.key];
  let control;
  if (field.type === "toggle") {
    const wrapper = document.createElement("label");
    wrapper.className = "switch";
    control = document.createElement("input");
    control.type = "checkbox";
    control.role = "switch";
    control.checked = Boolean(value);
    control.setAttribute("aria-labelledby", label.id);
    const track = document.createElement("span");
    track.className = "switch-track";
    wrapper.append(control, track);
    control.addEventListener("change", () => savePreference(category, field.key, control.checked, control));
    return wrapper;
  }
  if (field.type === "select") {
    control = document.createElement("select");
    control.id = id;
    control.setAttribute("aria-labelledby", label.id);
    for (const [optionValue, optionLabel] of field.options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      option.selected = optionValue === value;
      control.append(option);
    }
    control.addEventListener("change", () => savePreference(category, field.key, control.value, control));
    return control;
  }
  if (field.type === "range") {
    const wrapper = document.createElement("label");
    wrapper.className = "range-control";
    control = document.createElement("input");
    control.type = "range";
    control.min = field.min;
    control.max = field.max;
    control.value = value;
    control.id = id;
    control.setAttribute("aria-labelledby", label.id);
    const output = document.createElement("output");
    output.textContent = `${value}${field.suffix || ""}`;
    control.addEventListener("input", () => {
      output.textContent = `${control.value}${field.suffix || ""}`;
      savePreference(category, field.key, Number(control.value), control, true);
    });
    wrapper.append(control, output);
    return wrapper;
  }
  control = document.createElement("input");
  control.type = "text";
  control.id = id;
  control.maxLength = 160;
  control.placeholder = field.placeholder || "";
  control.value = value;
  control.setAttribute("aria-labelledby", label.id);
  control.addEventListener("change", () => savePreference(category, field.key, control.value.trim(), control));
  return control;
}

function addPlaceCollection(container) {
  const card = document.createElement("div");
  card.className = "place-collection";
  const form = document.createElement("form");
  form.className = "saved-place-form";
  form.innerHTML = '<label>Place name<input name="placeName" maxlength="100" required placeholder="e.g. Weekend market"></label><label>Address or note<input name="address" maxlength="180" placeholder="Add an address or short note"></label><label>Save to<select name="collection"><option value="customPlaces">Saved places</option><option value="favorites">Favorites</option><option value="savedTrips">Saved trips</option></select></label><button class="settings-primary-button" type="submit">Add saved place</button>';
  const list = document.createElement("ul");
  list.className = "saved-place-list";
  function drawPlaces() {
    list.replaceChildren();
    const places = [
      ...settings.savedPlaces.favorites.map((place) => ({ ...place, collection: "favorites" })),
      ...settings.savedPlaces.savedTrips.map((place) => ({ ...place, collection: "savedTrips" })),
      ...settings.savedPlaces.customPlaces.map((place) => ({ ...place, collection: "customPlaces" }))
    ];
    if (!places.length) {
      const empty = document.createElement("li");
      empty.className = "saved-place-empty";
      empty.textContent = "Your saved places will appear here.";
      list.append(empty);
      return;
    }
    for (const place of places) {
      const item = document.createElement("li");
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = place.name;
      const address = document.createElement("small");
      address.textContent = `${place.address || "Saved place"} · ${place.collection === "savedTrips" ? "Saved trip" : place.collection === "favorites" ? "Favorite" : "Saved place"}`;
      text.append(name, address);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "place-remove";
      remove.setAttribute("aria-label", `Remove ${place.name}`);
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        const collection = place.collection;
        const next = settings.savedPlaces[collection].filter((candidate) => candidate.id !== place.id);
        if (await savePreference("savedPlaces", collection, next)) drawPlaces();
      });
      item.append(text, remove);
      list.append(item);
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const place = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: String(data.get("placeName")).trim(),
      address: String(data.get("address")).trim()
    };
    const collection = String(data.get("collection"));
    if (await savePreference("savedPlaces", collection, [...settings.savedPlaces[collection], place])) {
      form.reset();
      drawPlaces();
    }
  });
  card.append(form, list);
  container.append(card);
  drawPlaces();
}

function addInfo(container, text) {
  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = text;
  container.append(note);
}

function addAction(container, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action.destructive ? "settings-action-button is-danger" : "settings-action-button";
  button.textContent = action.label;
  button.addEventListener("click", () => {
    if (action.handler === "logout-all") confirmAction("Sign out of all devices?", "This will end every active WSE Adventures session, including this one.", false, signOutAll);
    else if (action.handler === "delete-account") confirmAction("Delete your account?", "Your account and saved settings will be permanently deleted. Enter your password to continue.", true, deleteAccount);
    else if (action.handler === "reset-map") resetMapSettings();
    else setStatus(action.message);
  });
  container.append(button);
}

function renderAccount() {
  const heading = document.createElement("div");
  heading.className = "category-heading";
  heading.innerHTML = '<div><p class="settings-eyebrow">YOUR PROFILE</p><h2 id="category-title">Account</h2><p>Manage your profile and keep your account secure.</p></div>';
  panel.append(heading);

  const profileCard = document.createElement("section");
  profileCard.className = "settings-card";
  profileCard.innerHTML = '<h3>Profile information</h3><p class="card-description">Your details are used to personalize your account.</p>';
  const photoRow = document.createElement("div");
  photoRow.className = "profile-photo-row";
  const avatar = document.createElement("div");
  avatar.className = "profile-avatar";
  avatar.setAttribute("aria-label", `${user.name} profile photo`);
  const photo = settings.account.profilePhoto;
  if (photo) {
    avatar.style.backgroundImage = `url("${photo}")`;
    avatar.classList.add("has-photo");
  } else avatar.textContent = initials(user.name);
  const photoControl = document.createElement("div");
  photoControl.innerHTML = '<strong>Profile photo</strong><span>PNG, JPEG, or WebP up to 50 KB</span>';
  const uploadLabel = document.createElement("label");
  uploadLabel.className = "settings-secondary-button";
  uploadLabel.textContent = photo ? "Change photo" : "Add photo";
  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = "image/png,image/jpeg,image/webp";
  upload.className = "visually-hidden";
  upload.addEventListener("change", () => saveProfilePhoto(upload.files && upload.files[0], avatar));
  uploadLabel.append(upload);
  photoRow.append(avatar, photoControl, uploadLabel);
  profileCard.append(photoRow);

  const profileForm = document.createElement("form");
  profileForm.className = "account-form";
  profileForm.innerHTML = `<label>Full name<input name="name" autocomplete="name" minlength="2" maxlength="80" required value="${escapeHtml(user.name)}"></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required value="${escapeHtml(user.email)}"></label><button class="settings-primary-button" type="submit">Save profile</button>`;
  profileForm.addEventListener("submit", saveProfile);
  profileCard.append(profileForm);

  const securityCard = document.createElement("section");
  securityCard.className = "settings-card";
  securityCard.innerHTML = '<h3>Password &amp; security</h3><p class="card-description">Choose a unique password with at least 12 characters.</p>';
  const passwordForm = document.createElement("form");
  passwordForm.className = "account-form password-form";
  passwordForm.innerHTML = '<label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button class="settings-primary-button" type="submit">Update password</button>';
  passwordForm.addEventListener("submit", updatePassword);
  securityCard.append(passwordForm);
  const connected = document.createElement("div");
  connected.className = "connected-accounts";
  connected.innerHTML = '<h4>Connected accounts</h4><p>No third-party sign-in accounts are connected. WSE Adventures uses your email and password to sign you in.</p>';
  securityCard.append(connected);

  const actions = document.createElement("section");
  actions.className = "settings-card account-actions-card";
  actions.innerHTML = '<h3>Sign out</h3><p class="card-description">Sign out of WSE Adventures on this device.</p>';
  const actionRow = document.createElement("div");
  actionRow.className = "account-action-row";
  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "settings-action-button";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", logout);
  actionRow.append(signOut);
  actions.append(actionRow);
  panel.append(profileCard, securityCard, actions);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderCategory() {
  panel.replaceChildren();
  const category = categories.find((item) => item.id === activeCategory);
  if (!category) return;
  if (activeCategory === "account") {
    renderAccount();
    return;
  }
  if (activeCategory === "about") {
    renderAbout();
    return;
  }
  const heading = document.createElement("div");
  heading.className = "category-heading";
  const headingCopy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "settings-eyebrow";
  eyebrow.textContent = "PREFERENCES";
  const title = document.createElement("h2");
  title.id = "category-title";
  title.textContent = category.label;
  const description = document.createElement("p");
  description.textContent = category.summary;
  headingCopy.append(eyebrow, title, description);
  heading.append(headingCopy);
  panel.append(heading);

  for (const section of sections[activeCategory] || []) {
    const categoryMatchesQuery = `${category.label} ${category.summary}`.toLowerCase().includes(query);
    if (query && !categoryMatchesQuery &&
        !`${section.title || ""} ${section.message || ""} ${(section.fields || []).map((field) => field.label).join(" ")}`.toLowerCase().includes(query) &&
        !(section.fields || []).some((field) => `${field.label} ${field.help || ""}`.toLowerCase().includes(query))) continue;
    const card = document.createElement("section");
    card.className = "settings-card";
    if (section.title) {
      const titleEl = document.createElement("h3");
      titleEl.textContent = section.title;
      card.append(titleEl);
    }
    if (section.message) addInfo(card, section.message);
    if (section.activeSessions) loadActiveSessions(card);
    if (section.fields) {
      const rows = document.createElement("div");
      rows.className = "setting-list";
      for (const field of section.fields) {
        if (query && !categoryMatchesQuery && !`${field.label} ${field.help || ""}`.toLowerCase().includes(query)) continue;
        addFieldRow(rows, activeCategory, field);
      }
      card.append(rows);
    }
    if (section.placeCollection) addPlaceCollection(card);
    if (section.action) addAction(card, section.action);
    panel.append(card);
  }
}

async function loadActiveSessions(container) {
  try {
    const result = await request("/api/sessions");
    const summary = document.createElement("p");
    summary.className = "settings-note";
    summary.textContent = `${result.activeSessions} active ${result.activeSessions === 1 ? "session" : "sessions"} found for this account.`;
    container.insertBefore(summary, container.querySelector(".settings-action-button"));
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderAbout() {
  const heading = document.createElement("div");
  heading.className = "category-heading";
  heading.innerHTML = '<div><p class="settings-eyebrow">MADE FOR THE MOMENT</p><h2 id="category-title">About WSE Adventures</h2><p>A little more room for curiosity, one small adventure at a time.</p></div>';
  const card = document.createElement("section");
  card.className = "settings-card about-card";
  card.innerHTML = '<div class="about-version"><span class="brand-mark">W</span><div><strong>WSE Adventures</strong><span>Version <span id="app-version">Loading…</span></span></div></div><div class="about-links"><button type="button" data-about="Terms of Service">Terms of Service</button><button type="button" data-about="Privacy Policy">Privacy Policy</button><button type="button" data-about="Help Center">Help Center</button><button type="button" data-about="Report a problem">Report a problem</button><button type="button" data-about="Send feedback">Send feedback</button></div><p class="settings-note">Help and policy pages are not configured for this installation yet.</p>';
  card.querySelectorAll("[data-about]").forEach((button) => {
    button.addEventListener("click", () => setStatus(`${button.dataset.about} is not configured for this installation.`));
  });
  panel.append(heading, card);
  request("/api/app-info").then((result) => {
    const version = document.getElementById("app-version");
    if (version) version.textContent = result.version;
  }).catch((error) => setStatus(error.message, true));
}

async function savePreference(category, key, value, control, debounce = false) {
  const previous = settings[category][key];
  settings[category][key] = value;
  applyPreferences();
  if (category === "location" && (key === "homeLocation" || key === "workLocation")) {
    const savedKey = key === "homeLocation" ? "home" : "work";
    settings.savedPlaces[savedKey] = value;
  }
  if (category === "savedPlaces" && (key === "home" || key === "work")) {
    const locationKey = key === "home" ? "homeLocation" : "workLocation";
    settings.location[locationKey] = value;
  }
  if ((category === "location" && key === "locationHistory") ||
      (category === "privacy" && key === "locationHistory")) {
    settings.location.locationHistory = value;
    settings.privacy.locationHistory = value;
  }
  if ((category === "places" && key === "searchHistory") ||
      (category === "privacy" && key === "searchHistory")) {
    settings.places.searchHistory = value;
    settings.privacy.searchHistory = value;
  }
  if ((category === "navigation" && key === "navigationNotifications") ||
      (category === "notifications" && key === "navigation")) {
    settings.navigation.navigationNotifications = value;
    settings.notifications.navigation = value;
  }
  const saves = [[category, key, value]];
  if (category === "location" && (key === "homeLocation" || key === "workLocation")) {
    saves.push(["savedPlaces", key === "homeLocation" ? "home" : "work", value]);
  } else if (category === "savedPlaces" && (key === "home" || key === "work")) {
    saves.push(["location", key === "home" ? "homeLocation" : "workLocation", value]);
  } else if (key === "locationHistory") {
    saves.push([category === "location" ? "privacy" : "location", key, value]);
  } else if (key === "searchHistory") {
    saves.push([category === "places" ? "privacy" : "places", key, value]);
  } else if (key === "navigationNotifications" || (category === "notifications" && key === "navigation")) {
    saves.push([category === "navigation" ? "notifications" : "navigation",
      category === "navigation" ? "navigation" : "navigationNotifications", value]);
  }
  if (debounce) {
    clearTimeout(control._saveTimer);
    control._saveTimer = setTimeout(() => persistPreferences(saves, category, key, previous), 350);
    return;
  }
  const saved = await persistPreferences(saves, category, key, previous, control);
  if (saved && category === "location" && key === "useCurrentLocation" && value) {
    requestCurrentLocation();
  }
  return saved;
}

function persistPreferences(saves, category, key, previous, control) {
  saveQueue = saveQueue.then(async () => {
    setStatus("Saving…");
    for (const [targetCategory, targetKey, value] of saves) {
      await request("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ category: targetCategory, key: targetKey, value })
      });
    }
    setStatus("All changes saved");
    return true;
  }).catch((error) => {
    settings[category][key] = previous;
    if (category === "location" && (key === "homeLocation" || key === "workLocation")) {
      settings.savedPlaces[key === "homeLocation" ? "home" : "work"] = previous;
    }
    if (category === "savedPlaces" && (key === "home" || key === "work")) {
      settings.location[key === "home" ? "homeLocation" : "workLocation"] = previous;
    }
    if (key === "locationHistory") {
      settings.location.locationHistory = previous;
      settings.privacy.locationHistory = previous;
    }
    if (key === "searchHistory") {
      settings.places.searchHistory = previous;
      settings.privacy.searchHistory = previous;
    }
    if (key === "navigationNotifications" || (category === "notifications" && key === "navigation")) {
      settings.navigation.navigationNotifications = previous;
      settings.notifications.navigation = previous;
    }
    applyPreferences();
    renderCategory();
    if (control) {
      if (control.type === "checkbox") control.checked = previous;
      else if (control.type === "range") control.value = previous;
      else if (control.tagName === "SELECT" || control.type === "text") control.value = previous;
    }
    setStatus(error.message, true);
    return false;
  });
  return saveQueue;
}

async function resetMapSettings() {
  const defaults = model.getDefaultSettings().map;
  for (const [key, value] of Object.entries(defaults)) {
    if (settings.map[key] !== value && !(await savePreference("map", key, value))) return;
  }
  renderCategory();
  setStatus("Map settings restored");
}

function requestCurrentLocation() {
  if (settings.location.locationAccess === "never") {
    setStatus("Enable location access before using your current location.", true);
    return;
  }
  if (!navigator.geolocation) {
    setStatus("This browser does not provide location access.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    () => setStatus("Location access is ready for this device."),
    (error) => setStatus(error.code === error.PERMISSION_DENIED
      ? "Allow location access in your browser settings to use your current location."
      : "Could not read your current location.", true),
    { enableHighAccuracy: settings.location.locationAccuracy === "precise", timeout: 10000 }
  );
}

function applyPreferences() {
  const theme = settings.appearance.theme;
  document.body.dataset.theme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.body.classList.toggle("larger-text", settings.accessibility.largerText);
  document.body.classList.toggle("high-contrast", settings.accessibility.highContrast);
  document.body.classList.toggle("reduced-motion", settings.accessibility.reducedMotion);
}

async function getCsrf() {
  const result = await request("/api/csrf");
  csrfToken = result.csrfToken;
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const result = await request("/api/account", {
      method: "PUT",
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim()
      })
    });
    user = result.user;
    document.getElementById("settings-user").textContent = user.name;
    setStatus("Profile updated");
    renderCategory();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveProfilePhoto(file, avatar) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    setStatus("Choose a PNG, JPEG, or WebP image.", true);
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setStatus("Choose an image smaller than 2 MB before compression.", true);
    return;
  }
  try {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    const dataUrl = canvas.toDataURL("image/webp", 0.72);
    if (dataUrl.length > 70000) throw new Error("That image could not be compressed below 50 KB.");
    if (!(await savePreference("account", "profilePhoto", dataUrl))) return;
    avatar.style.backgroundImage = `url("${dataUrl}")`;
    avatar.classList.add("has-photo");
    avatar.textContent = "";
  } catch (error) {
    setStatus(error.message || "Could not load that profile photo.", true);
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const result = await request("/api/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value
      })
    });
    form.reset();
    setStatus(result.message);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  try {
    await request("/api/logout", { method: "POST", body: "{}" });
    window.location.assign("/");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function signOutAllDevices() {
  try {
    await request("/api/logout-all", { method: "POST", body: "{}" });
    window.location.assign("/");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteAccount(password) {
  try {
    await request("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ password })
    });
    window.location.assign("/");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function confirmAction(title, description, needsPassword, onConfirm) {
  const dialog = document.getElementById("settings-confirm-dialog");
  dialog.replaceChildren();
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.id = "settings-confirm-title";
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  form.append(heading, copy);
  let password;
  if (needsPassword) {
    const label = document.createElement("label");
    label.textContent = "Password";
    password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.required = true;
    label.append(password);
    form.append(label);
  }
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "settings-secondary-button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.close());
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.className = needsPassword ? "settings-action-button is-danger" : "settings-primary-button";
  confirm.textContent = needsPassword ? "Delete account" : "Sign out everywhere";
  actions.append(cancel, confirm);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    dialog.close();
    onConfirm(password ? password.value : undefined);
  });
  dialog.append(form);
  dialog.showModal();
  if (password) password.focus();
}

function handleSearch() {
  query = search.value.trim().toLowerCase();
  renderNavigation();
  renderCategory();
}

async function initialize() {
  try {
    const me = await request("/api/me");
    user = me.user;
    document.getElementById("settings-user").textContent = user.name;
    await getCsrf();
    const result = await request("/api/settings");
    settings = model.mergeSettings(result.settings);
    renderNavigation();
    renderCategory();
    applyPreferences();
    setStatus("All changes saved");
  } catch (error) {
    if (!window.location.pathname.includes("login.html")) setStatus(error.message, true);
  }
}

search.addEventListener("input", handleSearch);
search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    search.value = "";
    handleSearch();
    search.blur();
  }
  if (event.key === "Enter") {
    const first = nav.querySelector("button");
    if (first) first.click();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    search.focus();
  }
});
backButton.addEventListener("click", () => {
  document.body.classList.remove("settings-category-open");
  search.value = "";
  handleSearch();
});
initialize();
