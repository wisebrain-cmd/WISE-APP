(() => {
  const root = document.getElementById("dashboard-root");

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(label, href, className = "platform-button secondary") {
    const node = make("a", className, label);
    node.href = href;
    return node;
  }

  function badge(text, status) {
    const node = make("span", "platform-badge", text.replaceAll("_", " "));
    node.dataset.status = status;
    return node;
  }

  function formatDate(value) {
    return window.WsePreferences?.formatDate(value, { time: true }) || new Date(value).toLocaleString();
  }

  function addActivity(list, activity) {
    const row = make("li", "platform-list-item");
    const text = make("div");
    text.append(make("strong", "", activity.description));
    text.append(make("small", "", formatDate(activity.createdAt)));
    row.append(text, badge(activity.status, activity.status));
    list.append(row);
  }

  function addNotification(list, notification) {
    const row = make("li", `platform-list-item${notification.isRead ? "" : " unread"}`);
    const content = make("a");
    content.href = notification.href?.startsWith("/") && !notification.href.startsWith("//") ? notification.href : "/notifications";
    content.style.color = "inherit";
    content.style.textDecoration = "none";
    content.append(make("strong", "", notification.title));
    content.append(make("small", "", notification.message));
    content.append(make("small", "", formatDate(notification.createdAt)));
    row.append(content, badge(notification.isRead ? "Read" : "Unread", notification.isRead ? "success" : "warning"));
    list.append(row);
  }

  function card(title, span) {
    const node = make("section", `platform-card platform-span-${span}`);
    node.append(make("h2", "", title));
    return node;
  }

  function render(data) {
    root.replaceChildren();
    const header = make("section", "platform-heading");
    const headingText = make("div");
    headingText.append(make("p", "platform-eyebrow", "YOUR ADVENTURES"));
    headingText.append(make("h1", "platform-title", `Welcome back, ${data.user.name}`));
    headingText.append(make("p", "platform-lead", "Your account, updates and next steps, all in one place."));
    header.append(headingText);
    const actions = make("div", "platform-heading-actions");
    actions.append(link("Explore places", "/places"));
    actions.append(link("Settings", "/settings"));
    header.append(actions);
    root.append(header);

    const error = make("p", "platform-error");
    error.hidden = true;
    error.setAttribute("role", "alert");
    root.append(error);

    const grid = make("div", "platform-grid");
    const profile = card("Your account", 5);
    const profileRow = make("div", "platform-profile");
    const avatar = make("span", "platform-avatar");
    if (data.user.profileImage) {
      const image = document.createElement("img");
      image.src = data.user.profileImage;
      image.alt = "";
      avatar.append(image);
    } else avatar.textContent = data.user.name.slice(0, 1).toUpperCase();
    const details = make("div");
    details.append(make("strong", "", data.user.name));
    details.append(make("span", "", data.user.email));
    profileRow.append(avatar, details);
    profile.append(profileRow);
    const profileMeta = make("ul", "platform-list");
    const statusItem = make("li", "platform-list-item");
    statusItem.append(make("strong", "", "Account status"), badge(data.user.status, data.user.status));
    profileMeta.append(statusItem);
    const joined = make("li", "platform-list-item");
    joined.append(make("strong", "", "Member since"), make("small", "", formatDate(data.user.createdAt)));
    profileMeta.append(joined);
    profile.append(profileMeta);
    grid.append(profile);

    const security = card("Security", 4);
    const sessionRow = make("li", "platform-list-item");
    sessionRow.append(make("div", "", "Active sessions"), badge(String(data.activeSessionCount), "configured"));
    const securityList = make("ul", "platform-list");
    securityList.append(sessionRow);
    const securityItem = make("li", "platform-list-item");
    securityItem.append(make("strong", "", "Password and sign-in controls"), link("Review security", "/settings"));
    securityList.append(securityItem);
    security.append(securityList);
    grid.append(security);

    const quick = card("Quick actions", 3);
    const quickLinks = make("div", "platform-quick-actions");
    quickLinks.append(link("Browse places", "/places"));
    quickLinks.append(link("Your AI agents", "/agents"));
    quickLinks.append(link("Edit settings", "/settings"));
    quick.append(quickLinks);
    grid.append(quick);

    const activityCard = card("Recent activity", 7);
    if (data.activity.length) {
      const activityList = make("ul", "platform-list");
      data.activity.forEach(item => addActivity(activityList, item));
      activityCard.append(activityList);
    } else activityCard.append(make("p", "platform-empty", "Your account activity will appear here as you explore."));
    grid.append(activityCard);

    const notifications = card("Recent notifications", 5);
    const notificationHeading = make("div", "platform-quick-actions");
    notificationHeading.append(badge(`${data.unreadCount} unread`, data.unreadCount ? "warning" : "success"));
    notificationHeading.append(link("Open inbox", "/notifications"));
    notifications.append(notificationHeading);
    if (data.notifications.length) {
      const notificationList = make("ul", "platform-list");
      data.notifications.forEach(item => addNotification(notificationList, item));
      notifications.append(notificationList);
    } else notifications.append(make("p", "platform-empty", "No notifications yet. Important account and agent updates will appear here."));
    grid.append(notifications);

    const agents = card("AI activity", 7);
    if (data.agentRuns.length) {
      const agentList = make("ul", "platform-list");
      for (const run of data.agentRuns) {
        const row = make("li", "platform-list-item");
        const summary = make("div");
        summary.append(make("strong", "", run.task));
        summary.append(make("small", "", `Updated ${formatDate(run.updatedAt || run.createdAt)}`));
        row.append(summary, badge(run.status, run.status === "completed_with_errors" ? "warning" : "configured"));
        agentList.append(row);
      }
      agents.append(agentList);
    } else agents.append(make("p", "platform-empty", "No AI tasks yet. Create a task when you want independent agent feedback."));
    const agentLink = link("Open agent workspace", "/agents");
    agentLink.style.marginTop = "15px";
    agents.append(agentLink);
    grid.append(agents);

    const services = card("Connected services", 5);
    const github = make("li", "platform-list-item");
    github.append(make("div", "", "GitHub server integration"), badge(data.integrations.githubConfigured ? "Configured" : "Not configured", data.integrations.githubConfigured ? "configured" : "unconfigured"));
    const serviceList = make("ul", "platform-list");
    serviceList.append(github);
    services.append(serviceList);
    services.append(make("p", "", "Provider availability depends on server configuration; secrets are never shown in your browser."));
    grid.append(services);

    root.append(grid);
    if (data.user.role === "admin") {
      const nav = document.querySelector(".platform-nav");
      if (nav && !nav.querySelector('a[href="/admin"]')) {
        const admin = link("Administration", "/admin", "");
        nav.insertBefore(admin, nav.firstChild);
      }
    }
  }

  async function load() {
    try {
      const response = await fetch("/api/me/dashboard", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.assign("/login.html?next=%2Fdashboard");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not load your dashboard.");
      render(data);
    } catch (error) {
      root.replaceChildren();
      const alert = make("p", "platform-error", error.message || "Could not load your dashboard. Check your connection and try again.");
      alert.setAttribute("role", "alert");
      const retry = make("button", "platform-button", "Try again");
      retry.type = "button";
      retry.addEventListener("click", load);
      root.append(alert, retry);
    }
  }

  load();
})();
