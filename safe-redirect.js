(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WseSafeRedirect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function resolveInternalRedirect(requestedPath, origin) {
    if (typeof requestedPath !== "string" || requestedPath.length > 2048
      || !requestedPath.startsWith("/") || requestedPath.startsWith("//")
      || requestedPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(requestedPath)) {
      return "/";
    }

    try {
      const target = new URL(requestedPath, origin);
      if (target.origin !== origin || !["http:", "https:"].includes(target.protocol)) return "/";
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return "/";
    }
  }

  return { resolveInternalRedirect };
});
