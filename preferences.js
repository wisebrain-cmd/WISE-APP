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

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem("wise.preferences") || "{}");
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }

  function apply(preferences, saveCache = false) {
    const safe = { ...defaults, ...preferences };
    activeTheme = ["light", "dark", "system"].includes(safe.theme) ? safe.theme : "system";
    const theme = activeTheme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : activeTheme;
    root.dataset.theme = theme;
    root.style.setProperty("--user-accent", accents[safe.accent] || accents.sage);
    root.style.setProperty("--user-font-scale", sizes[safe.fontSize] || sizes.standard);
    if (saveCache) {
      try { localStorage.setItem("wise.preferences", JSON.stringify(safe)); } catch { /* Preferences remain available from the server. */ }
    }
  }

  window.WsePreferences = { apply, readCache };
  apply(readCache());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (activeTheme === "system") apply({ ...readCache(), theme: "system" });
  });
})();
