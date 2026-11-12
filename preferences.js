(() => {
  "use strict";

  const defaults = {
    theme: "system",
    accent: "sage",
    fontSize: "standard"
  };
  const accents = {
    sage: "#63805d",
    terracotta: "#a45f45",
    ocean: "#477b83",
    plum: "#80658e"
  };
  const sizes = { compact: "0.94", standard: "1", large: "1.08" };
  const root = document.documentElement;
  let activeTheme = defaults.theme;
  let currentPreferences = { ...defaults };

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem("wise.preferences") || "{}");
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }

  function readAppSettings() {
    try { return JSON.parse(localStorage.getItem("wise.settings") || "null"); }
    catch { return null; }
  }

  function applyAppSettings(settings, saveCache = true) {
    if (!settings || typeof settings !== "object") return null;
    if (saveCache) {
      try { localStorage.setItem("wise.settings", JSON.stringify(settings)); }
      catch { /* The server remains the source of truth when local storage is unavailable. */ }
    }
    root.dataset.highContrast = String(settings.accessibility?.highContrast === true);
    root.dataset.reducedMotion = String(settings.accessibility?.reducedMotion === true);
    return settings;
  }

  function clearAppSettings() {
    try { localStorage.removeItem("wise.settings"); } catch { /* Local storage may be disabled. */ }
    delete root.dataset.highContrast;
    delete root.dataset.reducedMotion;
  }

  function apply(preferences, saveCache = false) {
    const safe = { ...defaults, ...preferences };
    const legacyUnsaved = safe.legacyUnsaved === true;
    delete safe.legacyUnsaved;
    if (!["UTC", "Atlantic/Reykjavik", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"].includes(safe.timeZone)) safe.timeZone = "UTC";
    if (!["iso", "dmy", "mdy"].includes(safe.dateFormat)) safe.dateFormat = "iso";
    if (!["12h", "24h"].includes(safe.timeFormat)) safe.timeFormat = "24h";
    currentPreferences = safe;
    activeTheme = ["light", "dark", "system"].includes(safe.theme) ? safe.theme : "system";
    const theme = activeTheme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : activeTheme;
    root.dataset.theme = theme;
    root.style.setProperty("--user-accent", accents[safe.accent] || accents.sage);
    root.style.setProperty("--user-font-scale", sizes[safe.fontSize] || sizes.standard);
    if (saveCache) {
      try {
        localStorage.setItem("wise.preferences", JSON.stringify(safe));
        if (!legacyUnsaved) localStorage.removeItem("wise.theme");
      } catch { /* Preferences remain available from the server. */ }
    }
  }

  async function sync(preferences, token = "") {
    let saved = { ...preferences };
    let legacyTheme = null;
    try { legacyTheme = localStorage.getItem("wise.theme"); } catch { /* Local storage may be disabled. */ }
    if (saved.theme === "system" && ["light", "dark"].includes(legacyTheme)) {
      try {
        let csrfToken = token;
        if (!csrfToken) {
          const csrfResponse = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
          if (!csrfResponse.ok) throw new Error("Could not load a security token.");
          csrfToken = (await csrfResponse.json()).csrfToken;
        }
        const response = await fetch("/api/me/settings", {
          method: "PATCH", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ theme: legacyTheme })
        });
        if (!response.ok) throw new Error("Could not migrate the saved theme.");
        saved = (await response.json()).preferences;
        apply(saved, true);
        return saved;
      } catch {
        apply({ ...saved, theme: legacyTheme, legacyUnsaved: true });
        return { ...saved, theme: legacyTheme, legacyUnsaved: true };
      }
    }
    apply(saved, true);
    return saved;
  }

  function formatDate(value, options = {}) {
    const date = new Date(String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z");
    if (Number.isNaN(date.getTime())) return String(value);
    const format = currentPreferences.dateFormat || "iso";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: currentPreferences.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const dateText = format === "mdy" ? `${map.month}/${map.day}/${map.year}`
      : format === "dmy" ? `${map.day}/${map.month}/${map.year}`
        : `${map.year}-${map.month}-${map.day}`;
    if (!options.time) return dateText;
    const time = new Intl.DateTimeFormat("en", {
      timeZone: currentPreferences.timeZone || "UTC", hour: "2-digit", minute: "2-digit",
      hour12: (currentPreferences.timeFormat || "24h") === "12h"
    }).format(date);
    return `${dateText} · ${time}`;
  }

  window.WsePreferences = { apply, readCache, sync, formatDate, readAppSettings, applyAppSettings, clearAppSettings };
  apply(readCache());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (activeTheme === "system") apply({ ...currentPreferences, theme: "system" });
  });
})();
