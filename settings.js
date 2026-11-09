(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const csrfToken = { value: "" };
  let account = null;
  let preferences = null;
  let profileImage = null;
  let pendingImage = false;
  let agentCatalog = [];

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

  function say(target, message, isError = false) {
    const element = typeof target === "string" ? $(target) : target;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function setBusy(button, busy, busyText) {
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText || "Saving…";
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.disabled = busy;
  }

  function renderAvatar(element, image, name) {
    element.replaceChildren();
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      element.append(img);
    } else {
      element.textContent = (name || "W").trim().charAt(0).toUpperCase() || "W";
    }
  }

  function renderAccount() {
    $("#profile-name").value = account.name;
    $("#profile-email").value = account.email;
    $("#profile-chip-name").textContent = account.name;
    $("#profile-chip-email").textContent = account.email;
    profileImage = account.profileImage || null;
    renderAvatar($("#profile-avatar"), profileImage, account.name);
    renderAvatar($("#profile-chip-avatar"), profileImage, account.name);
    $("#remove-profile-image").hidden = !profileImage;
    $("#profile-chip").setAttribute("aria-label", `Signed in as ${account.name}`);
  }

  function currentAppearance() {
    return {
      theme: $("input[name='theme']:checked")?.value || preferences.theme,
      accent: $("input[name='accent']:checked")?.value || preferences.accent,
      fontSize: $("#font-size").value
    };
  }

  function currentRegion() {
    return {
      timeZone: $("#time-zone").value,
      dateFormat: $("#date-format").value,
      timeFormat: $("#time-format").value
    };
  }

  function formatDate(value, opts = {}) {
    const date = new Date(String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z");
    if (Number.isNaN(date.getTime())) return String(value);
    const settings = preferences || {};
    const format = settings.dateFormat || "iso";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const dateText = format === "mdy" ? `${map.month}/${map.day}/${map.year}`
      : format === "dmy" ? `${map.day}/${map.month}/${map.year}`
        : `${map.year}-${map.month}-${map.day}`;
    if (!opts.time) return dateText;
    const timeText = new Intl.DateTimeFormat("en", {
      timeZone: settings.timeZone || "UTC", hour: "2-digit", minute: "2-digit",
      hour12: (settings.timeFormat || "24h") === "12h"
    }).format(date);
    return `${dateText} · ${timeText}`;
  }

  function renderRegionPreview() {
    const region = currentRegion();
    preferences = { ...preferences, ...region };
    $("#region-preview").textContent = `Preview: ${formatDate(new Date().toISOString(), { time: true })} · ${region.timeZone}`;
  }

  function renderAppearance() {
    for (const input of document.querySelectorAll("input[name='theme']")) input.checked = input.value === preferences.theme;
    for (const input of document.querySelectorAll("input[name='accent']")) input.checked = input.value === preferences.accent;
    $("#font-size").value = preferences.fontSize;
    window.WsePreferences?.apply(preferences);
  }

  function renderRegion() {
    $("#time-zone").value = preferences.timeZone;
    $("#date-format").value = preferences.dateFormat;
    $("#time-format").value = preferences.timeFormat;
    renderRegionPreview();
  }

  function renderSessions(sessions) {
    const list = $("#session-list");
    list.replaceChildren();
    if (!sessions.length) {
      const item = document.createElement("li"); item.className = "empty-row"; item.textContent = "No active sessions found."; list.append(item); return;
    }
    for (const session of sessions) {
      const item = document.createElement("li"); item.className = "session-item";
      const details = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = session.label;
      const browser = document.createElement("small"); browser.textContent = session.browser || "Browser details unavailable";
      const active = document.createElement("small"); active.textContent = `Last active ${formatDate(session.lastActive, { time: true })}`;
      details.append(title, browser, active); item.append(details);
      if (session.current) { const badge = document.createElement("span"); badge.className = "session-current"; badge.textContent = "Current"; item.append(badge); }
      list.append(item);
    }
  }

  async function loadSessions() {
    const result = await api("/api/me/sessions");
    renderSessions(result.sessions || []);
  }

  function renderAgents() {
    const list = $("#agent-settings-list");
    list.replaceChildren();
    const enabled = new Set(preferences.enabledAgents || []);
    for (const agent of agentCatalog) {
      const label = document.createElement("label"); label.className = "agent-toggle";
      const input = document.createElement("input"); input.type = "checkbox"; input.name = "enabledAgents"; input.value = agent.id; input.checked = enabled.has(agent.id);
      const copy = document.createElement("span");
      const name = document.createElement("strong"); name.textContent = agent.name;
      const focus = document.createElement("small"); focus.textContent = agent.focus;
      copy.append(name, focus); label.append(input, copy); list.append(label);
    }
    $("#approval-required").checked = preferences.approvalRequired;
  }

  function renderProviders(providers) {
    const list = $("#provider-status"); list.replaceChildren();
    const entries = [["OpenAI", providers?.openai], ["Hugging Face", providers?.huggingFace]];
    for (const [name, provider] of entries) {
      const card = document.createElement("div"); card.className = "provider-card";
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = name;
      const detail = document.createElement("small"); detail.textContent = "Credentials configured on server";
      copy.append(title, detail);
      const status = document.createElement("span"); status.className = `status-pill${provider?.configured ? "" : " neutral"}`; status.textContent = provider?.configured ? "Configured" : "Not configured";
      card.append(copy, status); list.append(card);
    }
  }

  function renderActivity(runs) {
    const list = $("#agent-activity"); list.replaceChildren();
    if (!runs.length) { const empty = document.createElement("li"); empty.className = "empty-row"; empty.textContent = "No agent activity yet."; list.append(empty); return; }
    for (const run of runs.slice(0, 4)) {
      const item = document.createElement("li"); item.className = "activity-item";
      const copy = document.createElement("div"); copy.className = "activity-copy";
      const title = document.createElement("strong"); title.textContent = run.task;
      const meta = document.createElement("small"); meta.textContent = `${run.status.replaceAll("_", " ")} · ${formatDate(run.updatedAt || run.createdAt, { time: true })}`;
      copy.append(title, meta);
      if (run.error) { const error = document.createElement("small"); error.textContent = run.error; error.className = "error"; copy.append(error); }
      const status = document.createElement("span"); status.className = "status-pill activity-state" + (run.status.includes("error") ? " error" : ""); status.textContent = run.status.replaceAll("_", " ");
      item.append(copy, status); list.append(item);
    }
  }

  async function loadAgentInformation() {
    const [roleResult, runResult] = await Promise.all([
      api("/api/agents/roles"), api("/api/agents/runs")
    ]);
    agentCatalog = roleResult.agents || [];
    renderProviders(roleResult.providers);
    renderAgents();
    renderActivity(runResult.runs || []);
  }

  async function loadGitHubStatus() {
    const status = $("#github-status"); const detail = $("#github-details");
    try {
      const result = await api("/api/agents/github/status");
      status.textContent = "Connected"; status.className = "status-pill";
      detail.textContent = `${result.account} · ${result.repository} · ${result.permissions?.contents || "read"} access`;
    } catch (error) {
      status.textContent = "Unavailable"; status.className = "status-pill neutral";
      detail.textContent = error.message;
    }
  }

  function renderSystem(status) {
    const list = $("#system-status"); list.replaceChildren();
    const rows = [
      ["Application", status.server === "online" ? "Online" : "Unavailable"],
      ["Server health", status.server === "online" ? "Healthy" : "Unavailable"],
      ["API connection", "Available"],
      ["Database", status.database === "available" ? "Available" : "Unavailable"],
      ["Background agents", status.backgroundAgents?.running ? `Running · ${status.backgroundAgents.active} active` : "Stopped"],
      ["Version", status.version || "Unknown"]
    ];
    for (const [label, value] of rows) {
      const row = document.createElement("div"); const term = document.createElement("dt"); const description = document.createElement("dd");
      term.textContent = label; description.textContent = value; row.append(term, description); list.append(row);
    }
  }

  async function loadSystemStatus() {
    try {
      const result = await api("/api/system/status");
      renderSystem(result);
    } catch (error) {
      renderSystem({ server: "online", database: "unavailable", version: "Unknown", backgroundAgents: { running: false, active: 0 } });
      say("#settings-message", error.message, true);
    }
  }

  async function resizeProfileImage(file) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error("Choose a PNG, JPEG or WebP image smaller than 10 MB.");
    }
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Choose a valid image file."));
      element.src = source;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.82);
    if (result.length > 360000) throw new Error("That image could not be compressed below 256 KB. Choose another picture.");
    return result;
  }

  $("#profile-image").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      profileImage = await resizeProfileImage(file);
      pendingImage = true;
      renderAvatar($("#profile-avatar"), profileImage, account.name);
      $("#remove-profile-image").hidden = false;
      say("#profile-status", "Picture ready. Save your profile to upload it.");
    } catch (error) { say("#profile-status", error.message, true); }
  });

  $("#remove-profile-image").addEventListener("click", () => {
    profileImage = null; pendingImage = true;
    renderAvatar($("#profile-avatar"), null, account.name);
    $("#remove-profile-image").hidden = true;
    say("#profile-status", "Picture will be removed when you save your profile.");
  });

  $("#profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const body = { name: $("#profile-name").value.trim(), email: $("#profile-email").value.trim() };
    if (pendingImage) body.profileImage = profileImage;
    setBusy(button, true);
    try {
      const result = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      account = result.user; pendingImage = false; renderAccount();
      say("#profile-status", "Profile saved."); say("#settings-message", "Your account details were updated.");
    } catch (error) { say("#profile-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  document.querySelectorAll("input[name='theme'], input[name='accent']").forEach(input => input.addEventListener("change", () => {
    window.WsePreferences?.apply({ ...preferences, ...currentAppearance() });
  }));
  $("#font-size").addEventListener("change", () => window.WsePreferences?.apply({ ...preferences, ...currentAppearance() }));
  $("#appearance-form").addEventListener("submit", async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button[type='submit']"); setBusy(button, true);
    try {
      const result = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(currentAppearance()) });
      preferences = { ...preferences, ...result.preferences }; window.WsePreferences?.apply(preferences, true);
      say("#appearance-status", "Appearance preferences saved."); say("#settings-message", "Your appearance is saved to your account.");
    } catch (error) { window.WsePreferences?.apply(preferences); say("#appearance-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#password-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button[type='submit']"); setBusy(button, true);
    try {
      const result = await api("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }) });
      form.reset(); say("#password-status", result.message); await loadSessions();
    } catch (error) { say("#password-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#refresh-sessions").addEventListener("click", async event => {
    const button = event.currentTarget; setBusy(button, true, "Refreshing…");
    try { await loadSessions(); say("#sessions-status", "Sessions refreshed."); }
    catch (error) { say("#sessions-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#logout-other-sessions").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!window.confirm("Log out every other browser currently signed in to this account?")) return;
    setBusy(button, true, "Signing out…");
    try { const result = await api("/api/me/sessions/logout-others", { method: "POST", body: "{}" }); say("#sessions-status", result.message); await loadSessions(); }
    catch (error) { say("#sessions-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#delete-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget;
    if (!window.confirm("Delete your WSE Adventures account and associated data? This cannot be undone.")) return;
    const button = form.querySelector("button[type='submit']"); setBusy(button, true, "Deleting…");
    try {
      const result = await api("/api/me/delete", { method: "POST", body: JSON.stringify({ password: form.elements.password.value, confirmation: form.elements.confirmation.value }) });
      say("#delete-status", result.message); window.location.assign("/");
    } catch (error) { say("#delete-status", error.message, true); setBusy(button, false); }
  });

  document.querySelectorAll("#time-zone, #date-format, #time-format").forEach(select => select.addEventListener("change", renderRegionPreview));
  $("#region-form").addEventListener("submit", async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button[type='submit']"); setBusy(button, true);
    try {
      const result = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(currentRegion()) });
      preferences = { ...preferences, ...result.preferences }; renderRegionPreview();
      say("#region-status", "Language and region preferences saved.");
    } catch (error) { say("#region-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#save-agents").addEventListener("click", async event => {
    const button = event.currentTarget;
    const enabledAgents = [...document.querySelectorAll("input[name='enabledAgents']:checked")].map(input => input.value);
    if (!enabledAgents.length) { say("#agents-status", "Keep at least one agent enabled.", true); return; }
    setBusy(button, true);
    try {
      const result = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ enabledAgents, approvalRequired: $("#approval-required").checked }) });
      preferences = { ...preferences, ...result.preferences }; renderAgents();
      say("#agents-status", "Agent preferences saved.");
    } catch (error) { say("#agents-status", error.message, true); }
    finally { setBusy(button, false); }
  });

  $("#refresh-agent-activity").addEventListener("click", async event => {
    const button = event.currentTarget; setBusy(button, true, "Refreshing…");
    try { const result = await api("/api/agents/runs"); renderActivity(result.runs || []); }
    catch (error) { say("#settings-message", error.message, true); }
    finally { setBusy(button, false); }
  });

  async function start() {
    try {
      const csrf = await api("/api/csrf"); csrfToken.value = csrf.csrfToken;
      const data = await api("/api/me/settings");
      account = data.user; preferences = data.preferences;
      renderAccount(); renderAppearance(); renderRegion();
      await Promise.allSettled([
        loadSessions().catch(error => say("#sessions-status", error.message, true)),
        loadAgentInformation().catch(error => say("#agents-status", error.message, true)),
        loadGitHubStatus(), loadSystemStatus()
      ]);
    } catch (error) { say("#settings-message", error.message, true); }
  }

  start();
})();
