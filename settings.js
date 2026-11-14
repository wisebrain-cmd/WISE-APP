(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const schema = window.WseSettingsSchema;
  const csrfToken = { value: "" };
  const icons = {
    account: "◉", map: "⌖", navigation: "↗", location: "◎", discovery: "✧",
    notifications: "♧", appearance: "◐", privacy: "◇", savedPlaces: "♡",
    offlineMaps: "▣", accessibility: "⊙", about: "ⓘ", agents: "✳"
  };
  const labels = {
    map: {
      defaultType: ["Default map type", "Choose the map style used when exploring."],
      showTraffic: ["Traffic", "Show traffic information when available."],
      showTransit: ["Transit", "Show public transit information when available."],
      showBicycleRoutes: ["Bicycle routes", "Show bicycle route information when available."],
      showWalkingRoutes: ["Walking routes", "Show walking route information when available."],
      showLandmarks: ["Landmarks", "Show notable places and attractions."],
      showBusinesses: ["Businesses", "Show businesses when available."],
      buildings3d: ["3D buildings", "Show building detail in supported map views."],
      labels: ["Map labels", "Show names and labels on the map."],
      autoRotate: ["Auto-rotate map", "Rotate the 3D globe while exploring."]
    },
    navigation: {
      travelMode: ["Travel mode", "Your preferred way to get around."],
      routePreference: ["Route preference", "Balance travel time and scenic routes."],
      avoidTolls: ["Avoid toll roads", "Prefer routes that do not use toll roads."],
      avoidHighways: ["Avoid highways", "Prefer routes that avoid highways."],
      avoidFerries: ["Avoid ferries", "Prefer routes that avoid ferries."],
      preferFaster: ["Prefer faster routes", "Prioritize shorter estimated travel time."],
      voiceNavigation: ["Voice navigation", "Use spoken directions when navigation is available."],
      voiceVolume: ["Voice volume", "Preferred level for spoken directions."],
      navigationNotifications: ["Navigation notifications", "Receive navigation-related alerts."],
      autoStart: ["Automatically start navigation", "Start guidance when a route is selected."]
    },
    location: {
      locationAccess: ["Location access", "Allow WSE Adventures to request your location when you choose a location feature."],
      useCurrentLocation: ["Use current location", "Use your device location for nearby suggestions."],
      locationAccuracy: ["Location accuracy", "Choose the preferred location precision."],
      locationHistory: ["Location history", "Remember location activity in this account. No coordinates are stored by this preference."],
      savedLocationsEnabled: ["Saved locations", "Use saved places for quick access."]
    },
    discovery: {
      nearbyPlaces: ["Nearby places", "Show places near your current location."],
      restaurantPreferences: ["Restaurant preferences", "Choose the kinds of restaurants you prefer."],
      hotelPreferences: ["Hotel preferences", "Choose the kinds of stays you prefer."],
      shoppingPreferences: ["Shopping preferences", "Choose the kinds of shopping you prefer."],
      attractions: ["Attractions", "Include attractions in place discovery."],
      recommendedPlaces: ["Recommended places", "Show editorial and popular suggestions."],
      personalizedRecommendations: ["Personalized recommendations", "Use your saved preferences to tailor suggestions."],
      searchHistory: ["Search history", "Save map searches to your account when signed in."]
    },
    notifications: {
      agentNotifications: ["AI agent notifications", "Get updates when agent tasks need approval, finish, or encounter errors."],
      navigationNotifications: ["Navigation notifications", "Your preference is saved; navigation alerts are not delivered in this version."],
      trafficAlerts: ["Traffic alerts", "Get notified about traffic when alerts are supported."],
      routeChanges: ["Route changes", "Get notified when a route changes."],
      nearbyPlaces: ["Nearby places", "Receive nearby place suggestions."],
      travelRecommendations: ["Travel recommendations", "Receive ideas for your next trip."],
      promotions: ["Promotions", "Receive occasional product updates."],
      accountNotifications: ["Account notifications", "Keep important account notices enabled."],
      emailNotifications: ["Email notifications", "Your preference is saved; email delivery is not configured yet."],
      pushNotifications: ["Push notifications", "Your preference is saved; browser push is not configured yet."]
    },
    appearance: {
      theme: ["Theme", "Choose light, dark, or follow your device."],
      accent: ["Accent color", "Choose the WSE Adventures highlight color."],
      mapAppearance: ["Map appearance", "Choose how the map responds to the time of day."],
      language: ["Language", "Language used for the WSE Adventures interface."],
      units: ["Distance units", "Choose kilometers or miles."],
      temperatureUnits: ["Temperature units", "Choose Celsius or Fahrenheit."],
      fontSize: ["Text size", "Adjust the size of interface text."],
      timeZone: ["Time zone", "Used to display dates and activity times."],
      dateFormat: ["Date format", "Choose how dates are displayed."],
      timeFormat: ["Time format", "Choose 12-hour or 24-hour time."]
    },
    privacy: {
      privacyControls: ["Privacy controls", "Choose a balanced or minimal data preference."],
      locationSharing: ["Location sharing", "Allow location features to use your current position only when requested."],
      locationHistory: ["Location history", "Save this preference for future location features."],
      searchHistory: ["Search history", "Save map searches in your account."]
    },
    savedPlaces: {
      homeLocation: ["Home", "Add a place name or address for your home location."],
      workLocation: ["Work", "Add a place name or address for your work location."],
      favorites: ["Favorites", "Keep a short list of favorite places, one per line."],
      savedTrips: ["Saved trips", "Keep trip notes or saved trip names, one per line."],
      customPlaces: ["Custom saved places", "Add your own places, one per line."]
    },
    accessibility: {
      largerText: ["Larger text", "Increase text size across WSE Adventures."],
      highContrast: ["High contrast", "Increase contrast on the settings interface."],
      reducedMotion: ["Reduced motion", "Reduce non-essential motion and transitions."],
      screenReaderSupport: ["Screen reader support", "Keep accessible labels and announcements enabled."],
      voiceGuidance: ["Voice guidance", "Preferred spoken guidance setting."],
      accessibleRoutes: ["Accessible route preferences", "Prefer accessible routes when route planning is available."]
    }
  };
  const options = {
    "map.defaultType": [["standard", "Standard"], ["satellite", "Satellite"], ["terrain", "Terrain"]],
    "navigation.travelMode": [["driving", "Driving"], ["walking", "Walking"], ["cycling", "Cycling"], ["transit", "Public transit"]],
    "navigation.routePreference": [["balanced", "Balanced"], ["scenic", "Scenic"], ["fastest", "Fastest"]],
    "navigation.voiceVolume": [["0", "0%"], ["25", "25%"], ["50", "50%"], ["70", "70%"], ["100", "100%"]],
    "location.locationAccuracy": [["precise", "Precise"], ["approximate", "Approximate"]],
    "discovery.restaurantPreferences": [["any", "Any"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["gluten-free", "Gluten-free"], ["family-friendly", "Family-friendly"]],
    "discovery.hotelPreferences": [["any", "Any"], ["budget", "Budget"], ["midrange", "Mid-range"], ["luxury", "Luxury"], ["accessible", "Accessible"]],
    "discovery.shoppingPreferences": [["any", "Any"], ["local", "Local shops"], ["markets", "Markets"], ["malls", "Malls"], ["outlets", "Outlets"]],
    "appearance.theme": [["light", "Light"], ["dark", "Dark"], ["system", "System default"]],
    "appearance.accent": [["sage", "Sage"], ["terracotta", "Terracotta"], ["ocean", "Ocean"], ["plum", "Plum"]],
    "appearance.mapAppearance": [["automatic", "Automatic"], ["day", "Day"], ["night", "Night"]],
    "appearance.language": [["en", "English"]],
    "appearance.units": [["kilometers", "Kilometers"], ["miles", "Miles"]],
    "appearance.temperatureUnits": [["celsius", "Celsius"], ["fahrenheit", "Fahrenheit"]],
    "appearance.fontSize": [["compact", "Compact"], ["standard", "Standard"], ["large", "Large"]],
    "appearance.timeZone": [["UTC", "UTC"], ["Atlantic/Reykjavik", "Reykjavik"], ["Europe/London", "London"], ["Europe/Paris", "Paris"], ["America/New_York", "New York"], ["America/Los_Angeles", "Los Angeles"], ["Asia/Tokyo", "Tokyo"], ["Australia/Sydney", "Sydney"]],
    "appearance.dateFormat": [["iso", "YYYY-MM-DD"], ["dmy", "DD/MM/YYYY"], ["mdy", "MM/DD/YYYY"]],
    "appearance.timeFormat": [["24h", "24-hour"], ["12h", "12-hour"]],
    "privacy.privacyControls": [["balanced", "Balanced"], ["minimal", "Minimal data"]]
  };
  const categories = [
    { id: "account", title: "Account", subtitle: "Your profile, sign-in and connected accounts.", kind: "account" },
    { id: "map", title: "Map settings", subtitle: "Choose what your map shows and how it looks." },
    { id: "navigation", title: "Navigation", subtitle: "Set your preferred travel and guidance options." },
    { id: "location", title: "Location", subtitle: "Manage location access and saved location preferences.", kind: "location" },
    { id: "discovery", title: "Places & discovery", subtitle: "Shape nearby place and travel suggestions.", kind: "discovery" },
    { id: "notifications", title: "Notifications", subtitle: "Choose which updates you would like to receive." },
    { id: "appearance", title: "Appearance", subtitle: "Make the app comfortable to read and use." },
    { id: "privacy", title: "Privacy & security", subtitle: "Control account data and privacy preferences.", kind: "privacy" },
    { id: "savedPlaces", title: "Saved places", subtitle: "Keep favorite places and trip notes together." },
    { id: "offlineMaps", title: "Offline maps", subtitle: "Offline map downloads are not available in this version.", kind: "offline" },
    { id: "accessibility", title: "Accessibility", subtitle: "Adjust settings for a more accessible experience." },
    { id: "about", title: "About WSE Adventures", subtitle: "App details, help and feedback.", kind: "about" },
    { id: "agents", title: "AI agents", subtitle: "Manage supervised AI-agent preferences.", kind: "agents" }
  ];

  let account = null;
  let preferences = null;
  let settings = null;
  let version = "—";
  let activeCategory = "account";
  let profileImage = null;
  let pendingImage = false;
  let agentCatalog = [];
  let saveQueue = Promise.resolve();

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.method && options.method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrfToken.value;
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign("/login.html?next=%2Fsettings");
      throw new Error("Please sign in again to manage your settings.");
    }
    if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
    return payload;
  }

  async function deleteAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!window.confirm("Delete your WSE Adventures account and associated data? This cannot be undone.")) return;
    const submit = form.querySelector("button[type='submit']"); setBusy(submit, true, "Deleting…");
    try {
      const result = await api("/api/me/delete", { method: "POST", body: JSON.stringify({ password: form.elements.password.value, confirmation: form.elements.confirmation.value }) });
      say("#delete-status", result.message); window.location.assign("/");
    } catch (error) { say("#delete-status", error.message, true); setBusy(submit, false); }
  }

  function say(target, message, isError = false) {
    const element = typeof target === "string" ? $(target) : target;
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function button(text, className, action) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = text;
    if (action) element.addEventListener("click", action);
    return element;
  }

  function setBusy(element, busy, text) {
    if (busy) {
      element.dataset.originalText = element.textContent;
      element.textContent = text || "Saving…";
    } else if (element.dataset.originalText) {
      element.textContent = element.dataset.originalText;
      delete element.dataset.originalText;
    }
    element.disabled = busy;
  }

  function currentAppearance() {
    const current = settings?.appearance || {};
    return {
      theme: current.theme || preferences.theme,
      accent: current.accent || preferences.accent,
      fontSize: current.fontSize || preferences.fontSize,
      timeZone: current.timeZone || preferences.timeZone,
      dateFormat: current.dateFormat || preferences.dateFormat,
      timeFormat: current.timeFormat || preferences.timeFormat
    };
  }

  function applyVisualSettings() {
    if (!settings) return;
    const appearance = settings.appearance;
    preferences = { ...preferences, theme: appearance.theme, accent: appearance.accent, fontSize: appearance.fontSize, timeZone: appearance.timeZone, dateFormat: appearance.dateFormat, timeFormat: appearance.timeFormat };
    window.WsePreferences?.apply(preferences, true);
    document.documentElement.dataset.highContrast = String(settings.accessibility.highContrast);
    document.documentElement.dataset.reducedMotion = String(settings.accessibility.reducedMotion);
    const fontScales = { compact: 0.94, standard: 1, large: 1.08 };
    const fontScale = fontScales[appearance.fontSize] || 1;
    document.documentElement.style.setProperty("--user-font-scale", String(fontScale * (settings.accessibility.largerText ? 1.12 : 1)));
  }

  function renderAvatar(element, image, name) {
    element.replaceChildren();
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      element.append(img);
    } else element.textContent = (name || "W").trim().charAt(0).toUpperCase() || "W";
  }

  function renderHeaderAccount() {
    $("#profile-chip-name").textContent = account.name;
    $("#profile-chip-email").textContent = account.email;
    $("#profile-chip").setAttribute("aria-label", `Signed in as ${account.name}`);
    renderAvatar($("#profile-chip-avatar"), account.profileImage, account.name);
  }

  function renderNav(query = "") {
    const nav = $("#settings-nav");
    nav.replaceChildren();
    const term = query.trim().toLocaleLowerCase();
    const matches = categories.filter(category => {
      if (!term) return true;
      const fieldMatches = Object.entries(labels[category.id] || {}).some(([key, [label, hint]]) =>
        `${label} ${hint} ${key}`.toLocaleLowerCase().includes(term));
      return `${category.title} ${category.subtitle}`.toLocaleLowerCase().includes(term) || fieldMatches;
    });
    if (!matches.some(item => item.id === activeCategory) && matches.length) activeCategory = matches[0].id;
    for (const category of matches) {
      const item = button("", "settings-nav-item", () => selectCategory(category.id));
      item.dataset.category = category.id;
      item.setAttribute("aria-current", String(category.id === activeCategory));
      const icon = document.createElement("span"); icon.className = "category-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icons[category.id] || "•";
      const title = document.createElement("span"); title.className = "category-title"; title.textContent = category.title;
      const arrow = document.createElement("span"); arrow.className = "category-arrow"; arrow.setAttribute("aria-hidden", "true"); arrow.textContent = "›";
      item.append(icon, title, arrow);
      nav.append(item);
    }
    if (!matches.length) {
      const empty = document.createElement("p"); empty.className = "nav-empty"; empty.textContent = "No matching settings."; nav.append(empty);
    }
    renderActiveCategory(term);
  }

  function selectCategory(id) {
    activeCategory = id;
    renderNav($("#settings-search-input").value);
    if (window.matchMedia("(max-width: 760px)").matches) document.body.classList.add("mobile-category-open");
    $("#settings-panel").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderActiveCategory(term = "") {
    const category = categories.find(item => item.id === activeCategory) || categories[0];
    const panel = $("#settings-panel");
    panel.replaceChildren();
    const heading = document.createElement("header"); heading.className = "panel-heading";
    const icon = document.createElement("span"); icon.className = "panel-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icons[category.id];
    const copy = document.createElement("div");
    const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = "WSE ADVENTURES";
    const title = document.createElement("h2"); title.textContent = category.title;
    const subtitle = document.createElement("p"); subtitle.className = "panel-subtitle"; subtitle.textContent = category.subtitle;
    copy.append(eyebrow, title, subtitle); heading.append(icon, copy); panel.append(heading);

    const card = document.createElement("div"); card.className = "settings-card";
    panel.append(card);
    if (category.kind === "account") renderAccount(card);
    else if (category.kind === "location") renderLocation(card);
    else if (category.kind === "discovery") renderDiscovery(card);
    else if (category.kind === "privacy") renderPrivacy(card);
    else if (category.kind === "offline") renderOffline(card);
    else if (category.kind === "about") renderAbout(card);
    else if (category.kind === "agents") renderAgents(card);
    else renderControls(card, category.id, term);
  }

  function appendSubheading(parent, title, detail) {
    const heading = document.createElement("div"); heading.className = "subheading";
    const name = document.createElement("h3"); name.textContent = title;
    heading.append(name);
    if (detail) { const text = document.createElement("p"); text.className = "card-copy"; text.textContent = detail; heading.append(text); }
    parent.append(heading);
  }

  function renderControls(parent, group, term = "") {
    const rows = document.createElement("div"); rows.className = "settings-rows";
    for (const [key, [title, description]] of Object.entries(labels[group] || {})) {
      const normalized = term.toLocaleLowerCase();
      if (normalized && !`${title} ${description} ${key}`.toLocaleLowerCase().includes(normalized)
        && !categories.find(item => item.id === group)?.title.toLocaleLowerCase().includes(normalized)) continue;
      const row = document.createElement("div"); row.className = "setting-row";
      const text = document.createElement("div"); text.className = "setting-copy";
      const name = document.createElement("label"); name.className = "setting-name"; name.htmlFor = `setting-${group}-${key}`; name.textContent = title;
      const hint = document.createElement("p"); hint.className = "setting-description"; hint.textContent = description;
      text.append(name, hint);
      const control = makeControl(group, key);
      row.append(text, control); rows.append(row);
    }
    parent.append(rows);
    if (group === "savedPlaces") {
      const addPlace = button("Create a new saved location", "secondary-button", () => $("#setting-savedPlaces-customPlaces")?.focus());
      addPlace.classList.add("create-place-button");
      parent.append(addPlace);
    }
  }

  function makeControl(group, key) {
    const value = settings[group][key];
    const id = `setting-${group}-${key}`;
    if (typeof schema.defaults[group][key] === "boolean") {
      const label = document.createElement("label"); label.className = "switch";
      const input = document.createElement("input"); input.id = id; input.type = "checkbox"; input.checked = value;
      input.setAttribute("aria-label", labels[group][key][0]);
      input.addEventListener("change", () => saveSetting(group, key, input.checked));
      const track = document.createElement("span"); track.className = "switch-track"; track.setAttribute("aria-hidden", "true");
      label.append(input, track); return label;
    }
    if (typeof schema.defaults[group][key] === "number" || options[`${group}.${key}`]) {
      const select = document.createElement("select"); select.className = "setting-select"; select.id = id; select.setAttribute("aria-label", labels[group][key][0]);
      const choices = options[`${group}.${key}`] || [["0", "0"], ["25", "25"], ["50", "50"], ["70", "70"], ["100", "100"]];
      for (const [optionValue, optionLabel] of choices) {
        const option = document.createElement("option"); option.value = optionValue; option.textContent = optionLabel;
        select.append(option);
      }
      select.value = String(value);
      select.addEventListener("change", () => saveSetting(group, key, typeof schema.defaults[group][key] === "number" ? Number(select.value) : select.value));
      return select;
    }
    const multiline = ["favorites", "savedTrips", "customPlaces"].includes(key);
    const input = document.createElement(multiline ? "textarea" : "input");
    input.className = "setting-text"; input.id = id; input.value = value; input.maxLength = key === "customPlaces" ? 2000 : 500;
    input.placeholder = multiline ? "Add one item per line" : "Add a place name or address";
    input.setAttribute("aria-label", labels[group][key][0]);
    input.addEventListener("change", () => saveSetting(group, key, input.value.trim()));
    return input;
  }

  function renderAccount(parent) {
    appendSubheading(parent, "Profile information", "Update the name, email and photo associated with your account.");
    const form = document.createElement("form"); form.id = "profile-form"; form.className = "profile-form";
    form.innerHTML = `<div class="avatar-editor"><div class="profile-avatar" id="profile-avatar" aria-hidden="true">W</div><div><label class="file-button" for="profile-image">Change photo</label><input class="visually-hidden" id="profile-image" type="file" accept="image/png,image/jpeg,image/webp"><p class="field-hint">PNG, JPEG or WebP, up to 256 KB.</p><button class="text-button" id="remove-profile-image" type="button" hidden>Remove photo</button></div></div><div class="form-grid"><label class="field" for="profile-name"><span>Name</span><input id="profile-name" name="name" type="text" autocomplete="name" minlength="2" maxlength="80" required></label><label class="field" for="profile-email"><span>Email</span><input id="profile-email" name="email" type="email" autocomplete="email" maxlength="254" required><small>Email changes apply immediately.</small></label><label class="field full-row" id="email-confirm-field" for="email-confirm-password" hidden><span>Current password to confirm email change</span><input id="email-confirm-password" name="currentPassword" type="password" autocomplete="current-password"></label></div><div class="form-footer"><span class="form-status" id="profile-status" role="status" aria-live="polite"></span><button class="primary-button" type="submit">Save profile</button></div>`;
    parent.append(form);
    $("#profile-name").value = account.name;
    $("#profile-email").value = account.email;
    profileImage = account.profileImage || null;
    renderAvatar($("#profile-avatar"), profileImage, account.name);
    $("#remove-profile-image").hidden = !profileImage;
    $("#profile-email").addEventListener("input", updateEmailConfirmation);
    $("#profile-image").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        profileImage = await resizeProfileImage(file); pendingImage = true;
        renderAvatar($("#profile-avatar"), profileImage, account.name);
        $("#remove-profile-image").hidden = false;
        say("#profile-status", "Photo ready. Save your profile to upload it.");
      } catch (error) { say("#profile-status", error.message, true); }
    });
    $("#remove-profile-image").addEventListener("click", () => {
      profileImage = null; pendingImage = true; renderAvatar($("#profile-avatar"), null, account.name);
      $("#remove-profile-image").hidden = true; say("#profile-status", "Photo will be removed when you save.");
    });
    form.addEventListener("submit", saveProfile);

    const security = document.createElement("div"); security.className = "account-subsection";
    appendSubheading(security, "Password and security", "Use at least 12 characters. Updating your password signs out other active sessions.");
    security.insertAdjacentHTML("beforeend", `<form id="password-form" class="form-grid"><label class="field" for="current-password"><span>Current password</span><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></label><label class="field" for="new-password"><span>New password</span><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><div class="form-footer full-row"><span class="form-status" id="password-status" role="status" aria-live="polite"></span><button class="primary-button" type="submit">Update password</button></div></form><div class="subheading session-heading"><div><h3>Active sessions</h3><p class="card-copy">Browsers currently signed in to your account.</p></div><button class="secondary-button" id="refresh-sessions" type="button">Refresh</button></div><ul class="session-list" id="session-list"><li class="empty-row">Loading sessions…</li></ul><div class="form-footer"><span class="form-status" id="sessions-status" role="status" aria-live="polite"></span><button class="secondary-button" id="logout-other-sessions" type="button">Sign out of other devices</button></div>`);
    parent.append(security);
    $("#password-form").addEventListener("submit", changePassword);
    $("#refresh-sessions").addEventListener("click", refreshSessions);
    $("#logout-other-sessions").addEventListener("click", logoutOtherSessions);

    const connections = document.createElement("div"); connections.className = "account-subsection";
    appendSubheading(connections, "Connected accounts", "Personal OAuth connections are not available yet. The GitHub integration is managed by the WSE server.");
    const github = document.createElement("div"); github.className = "connection-row";
    const githubName = document.createElement("strong"); githubName.textContent = "GitHub workspace";
    const githubState = document.createElement("span"); githubState.className = "status-pill neutral"; githubState.id = "github-status"; githubState.textContent = "Checking";
    const githubDetails = document.createElement("p"); githubDetails.id = "github-details"; githubDetails.className = "setting-description";
    github.append(githubName, githubState); connections.append(github, githubDetails);
    const status = document.createElement("p"); status.className = "form-status"; status.id = "github-message"; connections.append(status);
    parent.append(connections);
    loadGitHubStatus();

    const signOut = document.createElement("div"); signOut.className = "account-signout";
    const signOutText = document.createElement("div"); signOutText.innerHTML = "<strong>Sign out</strong><p class=\"setting-description\">End this signed-in session on this device.</p>";
    signOut.append(signOutText, button("Sign out", "secondary-button", signOutCurrent)); parent.append(signOut);
    loadSessions().catch(error => say("#sessions-status", error.message, true));
  }

  function renderLocation(parent) {
    renderControls(parent, "location", $("#settings-search-input").value);
    const current = document.createElement("div"); current.className = "location-card";
    const text = document.createElement("div"); text.innerHTML = "<strong>Use my current location</strong><p class=\"setting-description\">Your browser will ask for permission. Coordinates are used for this request and are not saved here.</p>";
    const status = document.createElement("p"); status.id = "location-status"; status.className = "form-status";
    current.append(text, button("Manage location permissions", "secondary-button", checkLocation), status); parent.append(current);
    const permission = document.createElement("p"); permission.className = "field-hint"; permission.textContent = "Location permission is controlled by your browser. Use the site permissions in your browser settings to change it.";
    parent.append(permission);
    const savedLink = document.createElement("button"); savedLink.type = "button"; savedLink.className = "inline-link-button"; savedLink.textContent = "Manage saved locations";
    savedLink.addEventListener("click", () => selectCategory("savedPlaces")); parent.append(savedLink);
  }

  function renderDiscovery(parent) {
    renderControls(parent, "discovery", $("#settings-search-input").value);
    const history = document.createElement("div"); history.className = "history-controls";
    const title = document.createElement("div"); title.innerHTML = "<strong>Search history</strong><p class=\"setting-description\">Clear searches associated with your account.</p>";
    const status = document.createElement("span"); status.id = "history-status"; status.className = "form-status";
    history.append(title, button("Clear search history", "secondary-button", clearSearchHistory), status); parent.append(history);
  }

  function renderPrivacy(parent) {
    renderControls(parent, "privacy", $("#settings-search-input").value);
    const privacyNote = document.createElement("p"); privacyNote.className = "privacy-note"; privacyNote.textContent = "WSE Adventures requests device location only when you choose a location feature. This dashboard saves preferences to your signed-in account; it does not store precise location coordinates.";
    parent.append(privacyNote);
    const actions = document.createElement("div"); actions.className = "privacy-actions";
    appendSubheading(actions, "Account data", "Download and account management tools are limited in this version.");
    const signOut = button("Sign out of all devices", "secondary-button", async event => {
      if (!window.confirm("Sign out this device and every other device? You will need to sign in again.")) return;
      const target = event.currentTarget; setBusy(target, true, "Signing out…");
      try {
        await api("/api/me/sessions/logout-others", { method: "POST", body: "{}" });
        await api("/api/logout", { method: "POST", body: "{}" });
        window.location.assign("/");
      } catch (error) { say("#settings-message", error.message, true); setBusy(target, false); }
    });
    const danger = document.createElement("div"); danger.className = "danger-zone";
    const dangerTitle = document.createElement("h3"); dangerTitle.textContent = "Delete account";
    const dangerCopy = document.createElement("p"); dangerCopy.className = "setting-description"; dangerCopy.textContent = "Permanently remove your account, profile, saved preferences, reviews and active sessions.";
    const form = document.createElement("form"); form.id = "delete-form"; form.className = "form-grid";
    form.innerHTML = `<label class="field" for="delete-password"><span>Password</span><input id="delete-password" name="password" type="password" autocomplete="current-password" required></label><label class="field" for="delete-confirmation"><span>Type DELETE to confirm</span><input id="delete-confirmation" name="confirmation" type="text" autocomplete="off" required pattern="DELETE"></label><div class="form-footer full-row"><span class="form-status" id="delete-status" role="status" aria-live="polite"></span><button class="danger-button" type="submit">Delete my account</button></div>`;
    form.addEventListener("submit", deleteAccount);
    danger.append(dangerTitle, dangerCopy, form);
    actions.append(signOut, danger); parent.append(actions);
  }

  function renderOffline(parent) {
    const note = document.createElement("div"); note.className = "feature-notice";
    const title = document.createElement("strong"); title.textContent = "Offline maps are coming later";
    const detail = document.createElement("p"); detail.textContent = "The current map uses live online map tiles. There are no downloaded maps or offline storage to manage yet.";
    const usage = document.createElement("div"); usage.className = "storage-usage"; usage.innerHTML = "<span>Storage used</span><strong>0 MB</strong>";
    const actions = document.createElement("div"); actions.className = "offline-actions";
    const download = button("Download maps", "secondary-button", null); download.disabled = true;
    const manage = button("Manage downloaded maps", "secondary-button", null); manage.disabled = true;
    actions.append(download, manage);
    const updates = document.createElement("div"); updates.className = "setting-row disabled-row";
    const updateCopy = document.createElement("div"); updateCopy.innerHTML = "<strong class=\"setting-name\">Automatic map updates</strong><p class=\"setting-description\">Available when offline maps are supported.</p>";
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.disabled = true; toggle.setAttribute("aria-label", "Automatic map updates unavailable");
    updates.append(updateCopy, toggle);
    const remove = button("Delete downloaded maps", "secondary-button", null); remove.disabled = true;
    note.append(title, detail, actions, usage, updates, remove); parent.append(note);
  }

  function renderAbout(parent) {
    const rows = document.createElement("dl"); rows.className = "about-list";
    for (const [term, description] of [["App version", version], ["Terms of Service", "Not published yet"], ["Privacy Policy", "Not published yet"], ["Help Center", "Not available yet"], ["Report a problem", "Use the feedback option below"]]) {
      const row = document.createElement("div"); const label = document.createElement("dt"); const value = document.createElement("dd");
      label.textContent = term; value.textContent = description; row.append(label, value); rows.append(row);
    }
    const feedback = document.createElement("label"); feedback.className = "field feedback-field"; feedback.htmlFor = "settings-feedback";
    const label = document.createElement("span"); label.textContent = "Send feedback";
    const area = document.createElement("textarea"); area.id = "settings-feedback"; area.maxLength = 1000; area.placeholder = "Tell us what would make your next adventure better.";
    const send = button("Prepare feedback email", "secondary-button", () => {
      const subject = encodeURIComponent("WSE Adventures feedback");
      const body = encodeURIComponent(area.value.trim());
      if (!area.value.trim()) { say("#feedback-status", "Add a few details before preparing feedback.", true); return; }
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      say("#feedback-status", "Your email app should open with the feedback ready to send.");
    });
    const status = document.createElement("p"); status.id = "feedback-status"; status.className = "form-status"; status.setAttribute("role", "status");
    feedback.append(label, area);     const health = document.createElement("div"); health.id = "system-status"; health.className = "system-status"; health.textContent = "Checking service status…";
    const note = document.createElement("p"); note.className = "field-hint"; note.textContent = "Administrative error logs are not exposed because this app does not have administrator roles or an authorized log viewer.";
    parent.append(rows, health, note, feedback, send, status);
    loadSystemStatus();
  }

  async function loadSystemStatus() {
    const region = $("#system-status");
    if (!region) return;
    try {
      const status = await api("/api/system/status");
      if (!region.isConnected) return;
      region.replaceChildren();
      const list = document.createElement("dl"); list.className = "system-list";
      const rows = [
        ["Application", status.server === "online" ? "Online" : "Unavailable"],
        ["Server health", status.server === "online" ? "Healthy" : "Unavailable"],
        ["API connection", "Available"],
        ["Database", status.database === "available" ? "Available" : "Unavailable"],
        ["Background agents", status.backgroundAgents?.running ? `Running · ${status.backgroundAgents.active} active` : "Stopped"],
        ["Version", status.version || version]
      ];
      for (const [label, value] of rows) {
        const row = document.createElement("div"); const term = document.createElement("dt"); const description = document.createElement("dd");
        term.textContent = label; description.textContent = value; row.append(term, description); list.append(row);
      }
      region.append(list);
    } catch (error) {
      if (region.isConnected) region.textContent = `Service status unavailable: ${error.message}`;
    }
  }

  async function renderAgents(parent) {
    appendSubheading(parent, "Supervised automation", "Choose which specialists run for your tasks. Credentials remain on the server.");
    const description = document.createElement("p"); description.className = "field-hint"; description.innerHTML = `Manage agent tasks and approvals in the <a href="/agents">AI agent workspace</a>.`;
    const provider = document.createElement("div"); provider.id = "agent-provider-status"; provider.className = "provider-grid"; provider.textContent = "Checking provider configuration…";
    const providerField = document.createElement("label"); providerField.className = "field"; providerField.htmlFor = "agent-provider";
    const providerLabel = document.createElement("span"); providerLabel.textContent = "Provider preference";
    const select = document.createElement("select"); select.id = "agent-provider";
    for (const [value, label] of [["hybrid", "Hybrid · try configured providers"], ["openai", "OpenAI only"], ["huggingface", "Hugging Face only"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option);
    }
    providerField.append(providerLabel, select);
    const agentList = document.createElement("div"); agentList.id = "agent-settings-list"; agentList.className = "agent-settings-list";
    const approval = document.createElement("label"); approval.className = "approval-setting";
    const checkbox = document.createElement("input"); checkbox.id = "approval-required"; checkbox.type = "checkbox";
    const approvalCopy = document.createElement("span"); approvalCopy.innerHTML = "<strong>Require human approval before agents run</strong><small>Background tasks still require explicit selection when created.</small>";
    approval.append(checkbox, approvalCopy);
    const status = document.createElement("p"); status.id = "agents-status"; status.className = "form-status"; status.setAttribute("role", "status");
    const save = button("Save agent settings", "primary-button", saveAgentSettings); save.id = "save-agents";
    const footer = document.createElement("div"); footer.className = "form-footer"; footer.append(status, save);
    const recent = document.createElement("div"); recent.className = "subsection";
    const recentHeading = document.createElement("div"); recentHeading.className = "subheading";
    const recentTitle = document.createElement("h3"); recentTitle.textContent = "Recent activity";
    const refresh = button("Refresh", "secondary-button", refreshAgentActivity); refresh.id = "refresh-agent-activity";
    recentHeading.append(recentTitle, refresh);
    const activity = document.createElement("ul"); activity.id = "agent-activity"; activity.className = "activity-list";
    recent.append(recentHeading, activity);
    parent.append(description, provider, providerField, agentList, approval, footer, recent);
    select.value = preferences.provider || "hybrid";
    checkbox.checked = preferences.approvalRequired;
    try { await loadAgentInformation(); }
    catch (error) { say(status, error.message, true); }
  }

  async function saveSetting(group, key, value) {
    const previous = settings[group][key];
    settings[group][key] = value;
    applyVisualSettings();
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      say("#save-status", "Saving…");
      try {
        const result = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ settings: { [group]: { [key]: value } } }) });
        settings = result.settings;
        if (result.preferences) preferences = { ...preferences, ...result.preferences };
        let warning = "";
        if ((group === "discovery" && key === "searchHistory" && !value)
          || (group === "privacy" && key === "searchHistory" && !value)) {
          try { await api("/api/me/search-history", { method: "DELETE", body: "{}" }); }
          catch (error) { warning = `Preference saved, but existing search history could not be cleared: ${error.message}`; }
        }
        applyVisualSettings();
        try { localStorage.setItem("wise.settings", JSON.stringify(settings)); } catch { /* Server settings remain authoritative. */ }
        say("#save-status", warning || "All changes saved", Boolean(warning));
      } catch (error) {
        settings[group][key] = previous;
        applyVisualSettings();
        renderActiveCategory($("#settings-search-input").value);
        say("#save-status", error.message, true);
      }
    });
    return saveQueue;
  }

  async function updateEmailConfirmation() {
    const changed = $("#profile-email").value.trim().toLowerCase() !== account.email.toLowerCase();
    $("#email-confirm-field").hidden = !changed;
    $("#email-confirm-password").required = changed;
  }

  async function resizeProfileImage(file) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image smaller than 10 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read that image.")); reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Choose a valid image file.")); element.src = source;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process that image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.82);
    if (result.length > 360000) throw new Error("That image could not be compressed below 256 KB. Choose another picture.");
    return result;
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget; const submit = form.querySelector("button[type='submit']");
    const body = { name: $("#profile-name").value.trim(), email: $("#profile-email").value.trim() };
    if (body.email.toLowerCase() !== account.email.toLowerCase()) body.currentPassword = $("#email-confirm-password").value;
    if (pendingImage) body.profileImage = profileImage;
    setBusy(submit, true);
    try {
      account = (await api("/api/me", { method: "PATCH", body: JSON.stringify(body) })).user;
      window.dispatchEvent(new Event("wse-notifications-refresh"));
      pendingImage = false; renderHeaderAccount(); renderActiveCategory($("#settings-search-input").value);
      say("#settings-message", "Profile updated.");
    } catch (error) { say("#profile-status", error.message, true); }
    finally { setBusy(submit, false); }
  }

  function renderSessions(sessions) {
    const list = $("#session-list"); if (!list) return;
    list.replaceChildren();
    if (!sessions.length) { const item = document.createElement("li"); item.className = "empty-row"; item.textContent = "No active sessions found."; list.append(item); return; }
    for (const session of sessions) {
      const item = document.createElement("li"); item.className = "session-item";
      const details = document.createElement("div"); details.className = "session-details";
      const title = document.createElement("strong"); title.textContent = session.label;
      const browser = document.createElement("small"); browser.textContent = session.browser || "Browser details unavailable";
      const active = document.createElement("small"); active.textContent = `Last active ${window.WsePreferences?.formatDate(session.lastActive, { time: true }) || session.lastActive}`;
      details.append(title, browser, active); item.append(details);
      if (session.current) { const badge = document.createElement("span"); badge.className = "status-pill"; badge.textContent = "Current"; item.append(badge); }
      list.append(item);
    }
  }

  async function loadSessions() { renderSessions((await api("/api/me/sessions")).sessions || []); }

  async function changePassword(event) {
    event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type='submit']"); setBusy(submit, true);
    try {
      const result = await api("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }) });
      window.dispatchEvent(new Event("wse-notifications-refresh"));
      form.reset(); say("#password-status", result.message); await loadSessions();
    } catch (error) { say("#password-status", error.message, true); }
    finally { setBusy(submit, false); }
  }

  async function refreshSessions(event) {
    const target = event.currentTarget; setBusy(target, true, "Refreshing…");
    try { await loadSessions(); say("#sessions-status", "Sessions refreshed."); }
    catch (error) { say("#sessions-status", error.message, true); }
    finally { setBusy(target, false); }
  }

  async function logoutOtherSessions() {
    if (!window.confirm("Sign out every other browser currently signed in to this account?")) return;
    const target = $("#logout-other-sessions"); setBusy(target, true, "Signing out…");
    try {
      const result = await api("/api/me/sessions/logout-others", { method: "POST", body: "{}" });
      say("#sessions-status", result.message); await loadSessions();
    } catch (error) { say("#sessions-status", error.message, true); }
    finally { setBusy(target, false); }
  }

  async function signOutCurrent(event) {
    const target = event.currentTarget; setBusy(target, true, "Signing out…");
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
      window.location.assign("/");
    } catch (error) { say("#settings-message", error.message, true); setBusy(target, false); }
  }

  async function checkLocation(event) {
    const target = event.currentTarget;
    if (!navigator.geolocation) { say("#location-status", "Location is not supported by this browser.", true); return; }
    setBusy(target, true, "Checking…");
    navigator.geolocation.getCurrentPosition(
      position => {
        const accuracy = Math.round(position.coords.accuracy);
        say("#location-status", `Location permission is available (accuracy about ${accuracy} m). Coordinates were not saved.`);
        setBusy(target, false);
      },
      error => {
        const message = error.code === error.PERMISSION_DENIED ? "Location permission was denied. Change it in your browser site settings."
          : error.code === error.TIMEOUT ? "Location request timed out. Try again."
            : "Your location is currently unavailable.";
        say("#location-status", message, true); setBusy(target, false);
      },
      { enableHighAccuracy: settings.location.locationAccuracy === "precise", timeout: 10000, maximumAge: 60000 }
    );
  }

  async function clearSearchHistory() {
    const target = $("#history-status"); say(target, "Clearing…");
    try {
      await api("/api/me/search-history", { method: "DELETE", body: "{}" });
      say(target, "Search history cleared.");
    } catch (error) { say(target, error.message, true); }
  }

  async function loadGitHubStatus() {
    const status = $("#github-status");
    const detail = $("#github-details");
    if (!status || !detail) return;
    try {
      const result = await api("/api/agents/github/status");
      if (!status.isConnected) return;
      if (!result.configured) {
        status.textContent = "Not configured"; status.className = "status-pill neutral";
        detail.textContent = result.detail || "GitHub integration is not configured.";
      } else {
        status.textContent = result.connected ? "Connected" : "Unavailable";
        status.className = `status-pill${result.connected ? "" : " neutral"}`;
        detail.textContent = result.connected
          ? `${result.account} · ${result.repository} · ${result.permissions?.contents || "read"} access`
          : result.detail || "GitHub integration is unavailable.";
      }
    } catch (error) {
      if (!status.isConnected) return;
      status.textContent = "Unavailable"; status.className = "status-pill neutral";
      detail.textContent = error.message;
    }
  }

  function renderProviders(providers) {
    const list = $("#agent-provider-status"); if (!list) return; list.replaceChildren();
    for (const [name, provider] of [["OpenAI", providers?.openai], ["Hugging Face", providers?.huggingFace]]) {
      const card = document.createElement("div"); card.className = "provider-card";
      const label = document.createElement("strong"); label.textContent = name;
      const state = document.createElement("span"); state.className = `status-pill${provider?.configured ? "" : " neutral"}`; state.textContent = provider?.configured ? "Configured" : "Not configured";
      card.append(label, state); list.append(card);
    }
    const openAiOption = $("#agent-provider option[value='openai']");
    const huggingFaceOption = $("#agent-provider option[value='huggingface']");
    if (openAiOption) openAiOption.disabled = !providers?.openai?.configured;
    if (huggingFaceOption) huggingFaceOption.disabled = !providers?.huggingFace?.configured;
  }

  function renderAgentList() {
    const list = $("#agent-settings-list"); if (!list) return; list.replaceChildren();
    const enabled = new Set(preferences.enabledAgents || []);
    for (const agent of agentCatalog) {
      const label = document.createElement("label"); label.className = "agent-toggle";
      const input = document.createElement("input"); input.type = "checkbox"; input.name = "enabledAgents"; input.value = agent.id; input.checked = enabled.has(agent.id);
      const text = document.createElement("span"); const name = document.createElement("strong"); name.textContent = agent.name;
      const focus = document.createElement("small"); focus.textContent = agent.focus; text.append(name, focus); label.append(input, text); list.append(label);
    }
  }

  function renderActivity(runs) {
    const list = $("#agent-activity"); if (!list) return; list.replaceChildren();
    if (!runs.length) { const empty = document.createElement("li"); empty.className = "empty-row"; empty.textContent = "No agent activity yet."; list.append(empty); return; }
    for (const run of runs.slice(0, 4)) {
      const item = document.createElement("li"); item.className = "activity-item";
      const title = document.createElement("strong"); title.textContent = run.task;
      const meta = document.createElement("small"); meta.textContent = `${String(run.status).replaceAll("_", " ")} · ${window.WsePreferences?.formatDate(run.updatedAt || run.createdAt, { time: true }) || ""}`;
      item.append(title, meta); list.append(item);
    }
  }

  async function loadAgentInformation() {
    const [roles, activity] = await Promise.all([api("/api/agents/roles"), api("/api/agents/runs")]);
    agentCatalog = roles.agents || []; renderProviders(roles.providers); renderAgentList(); renderActivity(activity.runs || []);
  }

  async function saveAgentSettings(event) {
    const target = event.currentTarget;
    const enabledAgents = [...document.querySelectorAll("input[name='enabledAgents']:checked")].map(input => input.value);
    if (!enabledAgents.length) { say("#agents-status", "Keep at least one agent enabled.", true); return; }
    setBusy(target, true);
    try {
      const result = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ enabledAgents, approvalRequired: $("#approval-required").checked, provider: $("#agent-provider").value }) });
      preferences = { ...preferences, ...result.preferences }; say("#agents-status", "Agent preferences saved.");
    } catch (error) { say("#agents-status", error.message, true); }
    finally { setBusy(target, false); }
  }

  async function refreshAgentActivity(event) {
    const target = event.currentTarget; setBusy(target, true, "Refreshing…");
    try { renderActivity((await api("/api/agents/runs")).runs || []); }
    catch (error) { say("#settings-message", error.message, true); }
    finally { setBusy(target, false); }
  }

  function wireSearch() {
    $("#settings-search-input").addEventListener("input", event => renderNav(event.target.value));
    $("#mobile-back").addEventListener("click", () => {
      document.body.classList.remove("mobile-category-open");
      $("#settings-nav").querySelector(".settings-nav-item[aria-current='true']")?.focus();
    });
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); $("#settings-search-input").focus();
      }
      if (event.key === "Escape" && document.body.classList.contains("mobile-category-open")) {
        document.body.classList.remove("mobile-category-open");
      }
    });
  }

  async function start() {
    try {
      const csrf = await api("/api/csrf"); csrfToken.value = csrf.csrfToken;
      const data = await api("/api/me/settings");
      account = { ...data.user, ...(await api("/api/me")).user };
      preferences = await window.WsePreferences.sync(data.preferences, csrfToken.value);
      settings = data.settings || structuredClone(schema.defaults);
      version = data.version || "—";
      for (const key of ["theme", "accent", "fontSize", "timeZone", "dateFormat", "timeFormat"]) {
        settings.appearance[key] = preferences[key];
      }
      renderHeaderAccount(); applyVisualSettings(); wireSearch(); renderNav();
    } catch (error) { say("#settings-message", error.message, true); }
  }

  start();
})();
