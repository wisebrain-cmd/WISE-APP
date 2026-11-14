(() => {
  const root = document.getElementById("notifications-root");
  const categoryNames = {
    all: "All",
    security: "Security",
    account: "Account",
    agents: "AI agents",
    admin: "Admin",
    system: "System",
    general: "General"
  };
  let csrfToken = "";
  let category = "all";
  let notifications = [];
  let before = null;
  let loading = false;
  let hasMore = true;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    return window.WsePreferences?.formatDate(value, { time: true }) || new Date(value).toLocaleString();
  }

  function internalHref(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
    try {
      const target = new URL(value, window.location.origin);
      return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : "/dashboard";
    } catch {
      return "/dashboard";
    }
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
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.location.assign("/login.html?next=%2Fnotifications");
      if (response.status === 403 && options.method) csrfToken = "";
      throw new Error(data.error || "Notification request failed.");
    }
    return data;
  }

  function announceCount(count) {
    window.dispatchEvent(new CustomEvent("wse-notifications-updated", { detail: { unreadCount: count } }));
  }

  function setMessage(message, isError = false) {
    const node = root.querySelector("[data-notification-message]");
    node.textContent = message;
    node.className = isError ? "platform-error" : "platform-success";
    node.hidden = !message;
  }

  function render() {
    const list = root.querySelector("[data-notification-list]");
    list.replaceChildren();
    const filtered = notifications.filter(item => category === "all" || item.category === category);
    if (!filtered.length && !hasMore) {
      list.append(make("p", "platform-empty", category === "all"
        ? "You don’t have any notifications yet. Account and agent updates will appear here as they happen."
        : `There are no ${categoryNames[category].toLowerCase()} notifications in your history.`));
    } else if (!filtered.length && loading) {
      list.append(make("p", "platform-loading", "Loading notifications…"));
    } else if (!filtered.length) {
      list.append(make("p", "platform-empty", `No ${categoryNames[category].toLowerCase()} notifications in this part of your history.`));
    }
    for (const notification of filtered) {
      const item = make("article", `platform-card platform-span-12 notification-center-item${notification.isRead ? "" : " unread"}`);
      const content = make("div");
      const titleRow = make("div", "notification-center-title");
      titleRow.append(make("h2", "", notification.title));
      const categoryBadge = make("span", "platform-badge", categoryNames[notification.category] || "General");
      titleRow.append(categoryBadge);
      if (!notification.isRead) titleRow.append(make("span", "platform-badge", "Unread"));
      content.append(titleRow);
      content.append(make("p", "", notification.message));
      content.append(make("time", "", formatDate(notification.createdAt)));
      const actions = make("div", "notification-center-actions");
      if (notification.href) {
        const open = make("a", "platform-button secondary", "Open");
        open.href = internalHref(notification.href);
        if (!notification.isRead) {
          open.addEventListener("click", async event => {
            event.preventDefault();
            try {
              const result = await api(`/api/me/notifications/${notification.id}/read`, { method: "PATCH" });
              notification.isRead = true;
              announceCount(result.unreadCount);
              window.location.assign(open.href);
            } catch (error) {
              setMessage(error.message, true);
            }
          });
        }
        actions.append(open);
      }
      if (!notification.isRead) {
        const mark = make("button", "platform-button secondary", "Mark read");
        mark.type = "button";
        mark.addEventListener("click", async () => {
          mark.disabled = true;
          try {
            const result = await api(`/api/me/notifications/${notification.id}/read`, { method: "PATCH" });
            notification.isRead = true;
            announceCount(result.unreadCount);
            setMessage("Notification marked as read.");
            render();
          } catch (error) {
            mark.disabled = false;
            setMessage(error.message, true);
          }
        });
        actions.append(mark);
      }
      const remove = make("button", "platform-button danger", "Delete");
      remove.type = "button";
      remove.setAttribute("aria-label", `Delete notification: ${notification.title}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const result = await api(`/api/me/notifications/${notification.id}`, { method: "DELETE" });
          notifications = notifications.filter(item => item.id !== notification.id);
          announceCount(result.unreadCount);
          setMessage("Notification deleted.");
          render();
        } catch (error) {
          remove.disabled = false;
          setMessage(error.message, true);
        }
      });
      actions.append(remove);
      item.append(content, actions);
      list.append(item);
    }
    root.querySelector("[data-load-more]").hidden = !hasMore;
    root.querySelector("[data-load-more]").disabled = loading;
    root.querySelector("[data-load-more]").textContent = loading ? "Loading…" : "Load older notifications";
  }

  async function loadPage(reset = false) {
    if (loading || (!hasMore && !reset)) return;
    if (reset) {
      notifications = [];
      before = null;
      hasMore = true;
    }
    loading = true;
    render();
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (before) query.set("before", before);
      const data = await api(`/api/me/notifications?${query}`);
      notifications = reset ? data.notifications : notifications.concat(data.notifications);
      before = data.nextBeforeId;
      hasMore = Boolean(data.nextBeforeId);
      const count = await api("/api/me/notifications/unread-count");
      announceCount(count.unreadCount);
    } finally {
      loading = false;
      render();
    }
  }

  function renderShell() {
    root.replaceChildren();
    const heading = make("section", "platform-heading");
    const title = make("div");
    title.append(make("p", "platform-eyebrow", "YOUR ACCOUNT"));
    title.append(make("h1", "platform-title", "Notifications"));
    title.append(make("p", "platform-lead", "Account, security and agent updates. Your notification history is private to your account."));
    heading.append(title);
    const markAll = make("button", "platform-button secondary", "Mark all as read");
    markAll.type = "button";
    markAll.addEventListener("click", async () => {
      markAll.disabled = true;
      try {
        const result = await api("/api/me/notifications/read-all", { method: "POST", body: "{}" });
        notifications.forEach(item => { item.isRead = true; });
        announceCount(result.unreadCount);
        setMessage(result.updated ? `${result.updated} notification(s) marked as read.` : "You’re all caught up.");
        render();
      } catch (error) {
        setMessage(error.message, true);
      } finally {
        markAll.disabled = false;
      }
    });
    heading.append(markAll);
    root.append(heading);
    const message = make("p", "platform-success");
    message.dataset.notificationMessage = "";
    message.hidden = true;
    message.setAttribute("role", "status");
    root.append(message);
    const filters = make("div", "platform-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Filter notifications by category");
    for (const [key, label] of Object.entries(categoryNames)) {
      const button = make("button", "platform-filter", label);
      button.type = "button";
      button.dataset.category = key;
      button.setAttribute("aria-pressed", String(key === category));
      button.addEventListener("click", () => {
        category = key;
        filters.querySelectorAll("button").forEach(option => option.setAttribute("aria-pressed", String(option === button)));
        render();
      });
      filters.append(button);
    }
    root.append(filters);
    const list = make("div", "platform-grid");
    list.dataset.notificationList = "";
    root.append(list);
    const loadMore = make("button", "platform-button secondary", "Load older notifications");
    loadMore.type = "button";
    loadMore.dataset.loadMore = "";
    loadMore.addEventListener("click", () => loadPage().catch(error => setMessage(error.message, true)));
    root.append(loadMore);
    render();
  }

  async function initialize() {
    try {
      const token = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
      if (!token.ok) throw new Error("Could not start a secure session.");
      csrfToken = (await token.json()).csrfToken;
      renderShell();
      await loadPage(true);
    } catch (error) {
      root.replaceChildren();
      const alert = make("p", "platform-error", error.message || "Could not load notifications.");
      alert.setAttribute("role", "alert");
      const retry = make("button", "platform-button", "Try again");
      retry.type = "button";
      retry.addEventListener("click", initialize);
      root.append(alert, retry);
    }
  }

  initialize();
})();
