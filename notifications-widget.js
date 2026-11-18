(() => {
  let csrfToken = "";
  let unreadCount = 0;
  let host;
  let signedIn = false;
  let busy = false;
  let observer;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.method && options.method !== "GET") {
      if (!csrfToken) {
        const tokenResponse = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
        if (!tokenResponse.ok) throw new Error("Could not start a secure request.");
        csrfToken = (await tokenResponse.json()).csrfToken;
      }
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403 && options.method) csrfToken = "";
      throw new Error(result.error || "Notification request failed.");
    }
    return result;
  }

  function setCount(value) {
    unreadCount = Number.isFinite(value) ? Math.max(0, value) : 0;
    const badge = host?.querySelector(".notification-count");
    const button = host?.querySelector(".notification-trigger");
    if (badge) {
      badge.hidden = unreadCount === 0;
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    }
    if (button) button.setAttribute("aria-label", unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications");
  }

  function internalHref(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/notifications";
    try {
      const target = new URL(value, window.location.origin);
      return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : "/notifications";
    } catch {
      return "/notifications";
    }
  }

  function renderItems(container, notifications) {
    container.replaceChildren();
    if (!notifications.length) {
      container.append(element("p", "platform-empty", "You’re all caught up. New account and activity updates will appear here."));
      return;
    }
    for (const notification of notifications) {
      const row = element("article", `notification-item${notification.isRead ? "" : " unread"}`);
      const link = element("a");
      link.href = internalHref(notification.href);
      const title = element("strong", "", notification.title);
      const message = element("p", "", notification.message);
      const time = element("time", "", window.WsePreferences?.formatDate(notification.createdAt, { time: true }) || new Date(notification.createdAt).toLocaleString());
      link.append(title, message, time);
      if (!notification.isRead) {
        link.addEventListener("click", async event => {
          event.preventDefault();
          try {
            const result = await api(`/api/me/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
            setCount(result.unreadCount);
            window.location.assign(link.href);
          } catch (error) {
            showError(error.message);
          }
        });
      }
      row.append(link);
      if (!notification.isRead) {
        const mark = element("button", "notification-action", "Mark read");
        mark.type = "button";
        mark.addEventListener("click", async () => {
          mark.disabled = true;
          try {
            const result = await api(`/api/me/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
            setCount(result.unreadCount);
            await loadNotifications();
          } catch (error) {
            mark.disabled = false;
            showError(error.message);
          }
        });
        const actions = element("div", "notification-actions");
        actions.append(mark);
        row.append(actions);
      }
      container.append(row);
    }
  }

  function showError(message) {
    const content = host?.querySelector(".notification-list");
    if (!content) return;
    const error = element("p", "notification-inline-error", message);
    content.prepend(error);
  }

  async function refreshCount() {
    const result = await api("/api/me/notifications/unread-count");
    setCount(result.unreadCount);
  }

  async function loadNotifications() {
    const list = host.querySelector(".notification-list");
    list.replaceChildren(element("p", "platform-loading", "Loading notifications…"));
    try {
      const [result, count] = await Promise.all([
        api("/api/me/notifications?limit=6"),
        api("/api/me/notifications/unread-count")
      ]);
      setCount(count.unreadCount);
      renderItems(list, result.notifications);
    } catch (error) {
      list.replaceChildren(element("p", "notification-inline-error", error.message || "Could not load notifications."));
    }
  }

  function mount(target) {
    if (!signedIn || !target || target.querySelector(".notification-host")) return;
    host = element("div", "notification-host");
    const trigger = element("button", "notification-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-label", "Notifications");
    trigger.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>';
    const badge = element("span", "notification-count");
    badge.hidden = true;
    badge.setAttribute("aria-live", "polite");
    const panel = element("section", "notification-popover");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Recent notifications");
    const heading = element("div", "notification-popover-head");
    heading.append(element("strong", "", "Notifications"));
    const markAll = element("button", "notification-action", "Mark all read");
    markAll.type = "button";
    markAll.addEventListener("click", async () => {
      markAll.disabled = true;
      try {
        const result = await api("/api/me/notifications/read-all", { method: "POST", body: "{}" });
        setCount(result.unreadCount);
        await loadNotifications();
      } catch (error) {
        showError(error.message);
      } finally {
        markAll.disabled = false;
      }
    });
    heading.append(markAll);
    const list = element("div", "notification-list");
    list.append(element("p", "platform-loading", "Open notifications to see updates."));
    const allLink = element("a", "notification-footer", "View notification history");
    allLink.href = "/notifications";
    panel.append(heading, list, allLink);
    trigger.addEventListener("click", async () => {
      const open = panel.hidden;
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) await loadNotifications();
    });
    document.addEventListener("click", event => {
      if (!host.contains(event.target)) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      }
    });
    host.append(trigger, badge, panel);
    target.append(host);
    observer?.disconnect();
    if (!busy) {
      busy = true;
      refreshCount().catch(error => showError(error.message)).finally(() => { busy = false; });
    }
  }

  async function initialize() {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const { user } = await response.json();
      signedIn = Boolean(user);
      if (!signedIn) return;
      observer = new MutationObserver(() => {
        const target = document.getElementById("notification-control");
        const accountActions = target?.closest("#account-actions");
        if (target && (!accountActions || accountActions.querySelector(".account-welcome"))) mount(target);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("wse:account-ready", () => {
        const target = document.getElementById("notification-control");
        if (target) mount(target);
      });
      const target = document.getElementById("notification-control");
      const accountActions = target?.closest("#account-actions");
      if (target && (!accountActions || accountActions.querySelector(".account-welcome"))) mount(target);
    } catch (error) {
      console.error("Notification bell initialization failed:", error.message);
    }
  }

  window.WseNotifications = { mount };
  window.addEventListener("wse-notifications-updated", event => {
    if (Number.isFinite(event.detail?.unreadCount)) setCount(event.detail.unreadCount);
  });
  window.addEventListener("wse-notifications-refresh", () => {
    if (signedIn) refreshCount().catch(error => showError(error.message));
  });
  window.addEventListener("focus", () => {
    if (signedIn) refreshCount().catch(error => showError(error.message));
  });

  initialize();
})();
