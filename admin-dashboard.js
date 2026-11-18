(() => {
  const root = document.getElementById("admin-root");
  let csrfToken = "";
  let page = 1;
  let totalUsers = 0;
  let searchTimer;
  let filters = { q: "", status: "", role: "" };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    if (!value) return "Not available";
    return window.WsePreferences?.formatDate(value, { time: true }) || new Date(value).toLocaleString();
  }

  function badge(text, status) {
    const item = make("span", "platform-badge", String(text || "unknown").replaceAll("_", " "));
    item.dataset.status = String(status || "unknown").toLowerCase();
    return item;
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
      if (response.status === 401) window.location.assign("/login.html?next=%2Fadmin");
      if (response.status === 403 && options.method) csrfToken = "";
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  function card(title, span = 12) {
    const section = make("section", `platform-card platform-span-${span}`);
    section.append(make("h2", "", title));
    return section;
  }

  function addActivity(list, activity) {
    const row = make("li", "platform-list-item");
    const details = make("div");
    details.append(make("strong", "", activity.description));
    const actor = activity.actorName || activity.userName || "System";
    details.append(make("small", "", `${actor} · ${formatDate(activity.createdAt)}${activity.userEmail ? ` · ${activity.userEmail}` : ""}`));
    row.append(details, badge(activity.status, activity.status));
    list.append(row);
  }

  function renderHealth(services) {
    const section = card("System health");
    section.dataset.systemHealth = "";
    const list = make("ul", "platform-list");
    for (const service of services) {
      const row = make("li", "platform-list-item");
      const description = make("div");
      description.append(make("strong", "", service.service));
      description.append(make("small", "", service.detail));
      row.append(description, badge(service.status, service.status));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function renderAgents(data) {
    const section = card("AI agent operations");
    section.dataset.agentHealth = "";
    const agentList = make("ul", "platform-list");
    for (const agent of data.agents) {
      const row = make("li", "platform-list-item");
      const details = make("div");
      details.append(make("strong", "", agent.name));
      details.append(make("small", "", agent.purpose));
      details.append(make("small", "", `Current task: ${agent.currentTask || "None"} · Provider: ${agent.provider} · Last activity: ${formatDate(agent.lastActivity)}`));
      if (agent.lastError) details.append(make("small", "", `Last failure: ${agent.lastError}`));
      row.append(details, badge(`${agent.status} · ${agent.health}`, agent.health));
      agentList.append(row);
    }
    section.append(agentList);
    const worker = data.worker;
    section.append(make("p", "", `Background worker: ${worker.running ? "running" : "stopped"} · ${worker.active} active of ${worker.concurrency} slots. Agent controls are not exposed because this service does not provide safe administrative start/stop operations.`));
    return section;
  }

  function renderAgentActivity(data) {
    const section = card("Agent activity and approval queue");
    section.dataset.agentActivity = "";
    const approval = make("p", "");
    approval.append(make("strong", "", `Tasks awaiting owner approval: ${data.approvalQueue.length}`));
    section.append(approval);
    if (data.approvalQueue.length) {
      const approvalList = make("ul", "platform-list");
      for (const run of data.approvalQueue) {
        const row = make("li", "platform-list-item");
        const details = make("div");
        details.append(make("strong", "", run.task));
        details.append(make("small", "", `${run.owner} · Submitted ${formatDate(run.createdAt)}`));
        details.append(make("small", "", "Waiting for the task owner’s approval."));
        row.append(details, badge("awaiting approval", "warning"));
        approvalList.append(row);
      }
      section.append(approvalList);
    }
    section.append(make("h3", "", "Recent agent runs"));
    if (!data.recentAgentActivity.length) {
      section.append(make("p", "platform-empty", "No agent tasks have been recorded."));
      return section;
    }
    const list = make("ul", "platform-list");
    for (const run of data.recentAgentActivity) {
      const row = make("li", "platform-list-item");
      const details = make("div");
      details.append(make("strong", "", run.task));
      details.append(make("small", "", `${run.owner} · ${run.provider} · ${formatDate(run.updatedAt || run.createdAt)}`));
      if (run.status === "awaiting_approval") details.append(make("small", "", "Waiting for the task owner’s approval; administrators cannot run a task on another user’s behalf."));
      row.append(details, badge(run.status, run.status === "completed_with_errors" ? "warning" : run.status));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function renderErrors(items) {
    const section = card("Recent errors and warnings");
    section.dataset.recentErrors = "";
    if (!items.length) {
      section.append(make("p", "platform-empty", "No recorded errors or provider failures."));
      return section;
    }
    const list = make("ul", "platform-list");
    items.forEach(item => addActivity(list, item));
    section.append(list);
    return section;
  }

  function createUsersSection() {
    const section = card("User management");
    const toolbar = make("form", "platform-toolbar");
    toolbar.setAttribute("role", "search");
    const search = make("input");
    search.type = "search";
    search.name = "q";
    search.placeholder = "Search name or email";
    search.setAttribute("aria-label", "Search users by name or email");
    const status = make("select");
    status.setAttribute("aria-label", "Filter by account status");
    [["", "All statuses"], ["active", "Active"], ["inactive", "Inactive"]].forEach(([value, label]) => {
      const option = make("option", "", label);
      option.value = value;
      status.append(option);
    });
    const role = make("select");
    role.setAttribute("aria-label", "Filter by role");
    [["", "All roles"], ["user", "User"], ["admin", "Administrator"]].forEach(([value, label]) => {
      const option = make("option", "", label);
      option.value = value;
      role.append(option);
    });
    const submit = make("button", "platform-button", "Search");
    submit.type = "submit";
    toolbar.append(search, status, role, submit);
    const tableWrap = make("div", "platform-table-wrap");
    const table = make("table", "platform-table");
    table.setAttribute("aria-label", "User accounts");
    const head = make("thead");
    const headRow = make("tr");
    ["User", "Role", "Status", "Joined", "Actions"].forEach(label => headRow.append(make("th", "", label)));
    head.append(headRow);
    const body = make("tbody");
    table.append(head, body);
    tableWrap.append(table);
    const pagination = make("div", "platform-pagination");
    const pageStatus = make("span", "", "Loading users…");
    const previous = make("button", "platform-button secondary", "Previous");
    previous.type = "button";
    const next = make("button", "platform-button secondary", "Next");
    next.type = "button";
    const paginationButtons = make("div", "platform-quick-actions");
    paginationButtons.append(previous, next);
    pagination.append(pageStatus, paginationButtons);
    const details = make("section", "platform-card");
    details.hidden = true;
    details.setAttribute("aria-live", "polite");
    toolbar.addEventListener("submit", event => {
      event.preventDefault();
      filters = { q: search.value.trim(), status: status.value, role: role.value };
      page = 1;
      loadUsers().catch(showError);
    });
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.q = search.value.trim();
        page = 1;
        loadUsers().catch(showError);
      }, 250);
    });
    status.addEventListener("change", () => {
      filters.status = status.value;
      page = 1;
      loadUsers().catch(showError);
    });
    role.addEventListener("change", () => {
      filters.role = role.value;
      page = 1;
      loadUsers().catch(showError);
    });
    previous.addEventListener("click", () => { if (page > 1) { page -= 1; loadUsers().catch(showError); } });
    next.addEventListener("click", () => { if (page * 25 < totalUsers) { page += 1; loadUsers().catch(showError); } });
    section.append(toolbar, tableWrap, pagination, details);

    async function loadUsers() {
      const query = new URLSearchParams({ page: String(page), limit: "25" });
      if (filters.q) query.set("q", filters.q);
      if (filters.status) query.set("status", filters.status);
      if (filters.role) query.set("role", filters.role);
      body.replaceChildren();
      const loadingRow = make("tr");
      const loadingCell = make("td", "", "Loading accounts…");
      loadingCell.colSpan = 5;
      loadingRow.append(loadingCell);
      body.append(loadingRow);
      try {
        const data = await api(`/api/admin/users?${query}`);
        totalUsers = data.total;
        body.replaceChildren();
        if (!data.users.length) {
          const row = make("tr");
          const cell = make("td", "", "No matching accounts.");
          cell.colSpan = 5;
          row.append(cell);
          body.append(row);
        }
        for (const user of data.users) {
          const row = make("tr");
          const identity = make("td");
          identity.append(make("strong", "", user.name), make("br"), make("span", "", user.email));
          const roleCell = make("td");
          roleCell.append(badge(user.role, user.role === "admin" ? "configured" : "unknown"));
          const statusCell = make("td");
          statusCell.append(badge(user.status, user.status));
          const joined = make("td", "", formatDate(user.createdAt));
          const actions = make("td");
          const view = make("button", "platform-button secondary", "Details");
          view.type = "button";
          view.addEventListener("click", () => loadUserDetails(user.id).catch(showError));
          actions.append(view);
          if (user.role !== "admin") {
            const toggle = make("button", `platform-button ${user.status === "active" ? "danger" : "secondary"}`, user.status === "active" ? "Deactivate" : "Activate");
            toggle.type = "button";
            toggle.addEventListener("click", async () => {
              toggle.disabled = true;
              try {
                const nextStatus = user.status === "active" ? "inactive" : "active";
                await api(`/api/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
                await loadUsers();
                await loadOverview();
                showSuccess(`Account ${nextStatus}.`);
              } catch (error) {
                toggle.disabled = false;
                showError(error.message);
              }
            });
            actions.append(toggle);
          }
          row.append(identity, roleCell, statusCell, joined, actions);
          body.append(row);
        }
        const first = totalUsers ? (page - 1) * 25 + 1 : 0;
        pageStatus.textContent = `${first}–${Math.min(page * 25, totalUsers)} of ${totalUsers} accounts`;
        previous.disabled = page <= 1;
        next.disabled = page * 25 >= totalUsers;
      } catch (error) {
        body.replaceChildren();
        const row = make("tr");
        const cell = make("td", "", error.message || "Could not load accounts.");
        cell.colSpan = 5;
        row.append(cell);
        body.append(row);
        throw error;
      }
    }

    async function loadUserDetails(id) {
      details.hidden = false;
      details.replaceChildren(make("p", "platform-loading", "Loading account details…"));
      const data = await api(`/api/admin/users/${id}`);
      const heading = make("div", "platform-heading");
      heading.append(make("h3", "", `${data.user.name} · Account details`));
      const close = make("button", "platform-button secondary", "Close");
      close.type = "button";
      close.addEventListener("click", () => { details.hidden = true; });
      heading.append(close);
      details.replaceChildren(heading);
      details.append(make("p", "", `${data.user.email} · ${data.user.role} · ${data.user.status} · Joined ${formatDate(data.user.createdAt)} · ${data.activeSessions} active sessions`));
      details.append(make("h3", "", "Recent activity"));
      if (data.activity.length) {
        const list = make("ul", "platform-list");
        data.activity.forEach(item => addActivity(list, item));
        details.append(list);
      } else details.append(make("p", "platform-empty", "No account activity has been recorded."));
    }

    return { section, loadUsers };
  }

  function showError(message) {
    const alert = root.querySelector("[data-admin-error]");
    if (alert) {
      alert.hidden = false;
      alert.textContent = message.message || message;
    }
  }

  function showSuccess(message) {
    const alert = root.querySelector("[data-admin-success]");
    if (!alert) return;
    alert.hidden = false;
    alert.textContent = message;
    setTimeout(() => { alert.hidden = true; }, 3500);
  }

  async function loadOverview() {
    const data = await api("/api/admin/overview");
    const summary = root.querySelector(".platform-metric-row");
    summary.replaceChildren();
    [
      ["Total accounts", data.users.total],
      ["Active accounts", data.users.active],
      ["Active in 30 days", data.users.activeLast30Days],
      ["New in 7 days", data.newUsersLast7Days]
    ].forEach(([label, count]) => {
      const metric = make("div", "platform-metric");
      metric.append(make("strong", "", String(count)));
      metric.append(make("span", "", label));
      summary.append(metric);
    });
    const activities = root.querySelector("[data-recent-activity]");
    activities.replaceChildren();
    if (data.recentActivity.length) data.recentActivity.forEach(item => addActivity(activities, item));
    else activities.append(make("p", "platform-empty", "No activity has been recorded yet."));
    const agentActivity = root.querySelector("[data-agent-activity]");
    agentActivity.replaceWith(renderAgentActivity(data));
    const agentSection = root.querySelector("[data-agent-health]");
    agentSection.replaceWith(renderAgents(data));
    const healthSection = root.querySelector("[data-system-health]");
    healthSection.replaceWith(renderHealth(data.health));
    const errors = root.querySelector("[data-recent-errors]");
    errors.replaceWith(renderErrors(data.recentErrors));
  }

  async function load() {
    try {
      const tokenResponse = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
      if (!tokenResponse.ok) throw new Error("Could not start a secure session.");
      csrfToken = (await tokenResponse.json()).csrfToken;
      const profile = await api("/api/me");
      if (profile.user.role !== "admin") throw new Error("Administrator access is required.");
      renderShell();
      await Promise.all([loadOverview(), users.loadUsers()]);
    } catch (error) {
      root.replaceChildren();
      const message = make("p", "platform-error", error.message || "Could not load administrator tools.");
      message.setAttribute("role", "alert");
      const link = make("a", "platform-button secondary", "Go to your dashboard");
      link.href = "/dashboard";
      root.append(message, link);
    }
  }

  let users;
  function renderShell() {
    root.replaceChildren();
    const header = make("section", "platform-heading");
    const title = make("div");
    title.append(make("p", "platform-eyebrow", "WSE ADVENTURES · ADMIN"));
    title.append(make("h1", "platform-title", "Operations dashboard"));
    title.append(make("p", "platform-lead", "Real account, agent and service state. Provider credentials and user passwords are never displayed."));
    header.append(title);
    root.append(header);
    const error = make("p", "platform-error");
    error.dataset.adminError = "";
    error.hidden = true;
    error.setAttribute("role", "alert");
    const success = make("p", "platform-success");
    success.dataset.adminSuccess = "";
    success.hidden = true;
    success.setAttribute("role", "status");
    root.append(error, success);
    const grid = make("div", "platform-grid");
    const summary = card("Account overview");
    summary.append(make("div", "platform-metric-row"));
    grid.append(summary);
    const agents = card("AI agent operations");
    agents.dataset.agentHealth = "";
    grid.append(agents);
    const activityCard = card("Recent activity");
    const activityList = make("ul", "platform-list");
    activityList.dataset.recentActivity = "";
    activityCard.append(activityList);
    grid.append(activityCard);
    const agentActivity = card("Agent activity and approval queue");
    agentActivity.dataset.agentActivity = "";
    agentActivity.append(make("span", "platform-badge", "Pending approvals: "), make("span"));
    agentActivity.lastChild.dataset.approvalCount = "";
    grid.append(agentActivity);
    const health = card("System health");
    health.dataset.systemHealth = "";
    grid.append(health);
    const errorSection = card("Recent errors and warnings");
    errorSection.dataset.recentErrors = "";
    grid.append(errorSection);
    users = createUsersSection();
    grid.append(users.section);
    root.append(grid);
  }

  load();
})();
