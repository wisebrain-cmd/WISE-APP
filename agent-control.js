(() => {
  "use strict";

  const root = document.getElementById("agent-control-root");
  let csrfToken = "";
  let loading = false;
  let actionBusy = false;
  let lastSnapshot;
  const historyFilters = { agent: "all", status: "all", approval: "all" };

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

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "Not finished";
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }

  function badge(text, state) {
    const node = make("span", "platform-badge", String(text || "unknown").replaceAll("_", " "));
    node.dataset.status = String(state || "unknown").toLowerCase();
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
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.location.assign("/login.html?next=%2Fadmin%2Fagents");
      if (response.status === 403 && options.method) csrfToken = "";
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  function section(title, eyebrow) {
    const card = make("section", "platform-card platform-span-12 agent-control-section");
    if (eyebrow) card.append(make("p", "platform-eyebrow", eyebrow));
    card.append(make("h2", "", title));
    return card;
  }

  function showMessage(message, isError = false) {
    const alert = root.querySelector("[data-agent-message]");
    if (!alert) return;
    alert.hidden = !message;
    alert.className = isError ? "platform-error" : "platform-success";
    alert.textContent = message || "";
    alert.setAttribute("role", isError ? "alert" : "status");
  }

  function button(label, action, className = "platform-button secondary") {
    const item = make("button", className, label);
    item.type = "button";
    item.addEventListener("click", async () => {
      if (actionBusy) return;
      actionBusy = true;
      item.disabled = true;
      try {
        const result = await action();
        window.dispatchEvent(new Event("wse-notifications-refresh"));
        actionBusy = false;
        await load();
        showMessage(result.message || "Agent center updated.");
      } catch (error) {
        actionBusy = false;
        showMessage(error.message || "The action could not be completed.", true);
        item.disabled = false;
      }
    });
    return item;
  }

  function runAction(runId, action) {
    return api(`/api/admin/agents/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST", body: "{}" });
  }

  function renderWorker(worker, observability) {
    const panel = section("Shared queue worker", "Execution controls");
    const copy = make("p", "agent-control-copy",
      `${worker.status === "running" ? "Accepting queued work" : worker.status === "paused" ? "Queue dispatch is paused" : "Queue dispatch is stopped"} · ${worker.active} active of ${worker.concurrency} concurrent slots. Pausing or stopping prevents new tasks from starting; already-running requests are allowed to finish.`);
    const metrics = make("dl", "agent-observability");
    [
      ["Worker uptime", worker.startedAt ? formatDuration(worker.uptimeMs) : "Stopped"],
      ["Queue depth", observability.queueDepth],
      ["Running tasks", observability.runningTaskCount],
      ["Completed tasks", observability.completedTaskCount],
      ["Failed tasks", observability.failedTaskCount],
      ["Partial failures", observability.completedWithErrorsCount],
      ["Approval queue", observability.approvalQueueSize],
      ["Last successful task", formatDate(observability.lastSuccessfulTask)],
      ["Last failed task", formatDate(observability.lastFailedTask)],
      ["Last worker activity", formatDate(observability.lastWorkerActivity)]
    ].forEach(([label, value]) => {
      const metric = make("div");
      metric.append(make("dt", "", label), make("dd", "", String(value)));
      metrics.append(metric);
    });
    const controls = make("div", "platform-quick-actions");
    if (!worker.started) controls.append(button("Start queue", () => api("/api/admin/agents/worker", { method: "POST", body: JSON.stringify({ action: "start" }) })));
    else if (worker.paused) controls.append(button("Resume queue", () => api("/api/admin/agents/worker", { method: "POST", body: JSON.stringify({ action: "resume" }) })));
    else controls.append(button("Pause queue", () => api("/api/admin/agents/worker", { method: "POST", body: JSON.stringify({ action: "pause" }) })));
    if (worker.started) controls.append(button("Stop queue", () => api("/api/admin/agents/worker", { method: "POST", body: JSON.stringify({ action: "stop" }) }), "platform-button danger"));
    controls.append(button("Restart worker", () => api("/api/admin/agents/worker", { method: "POST", body: JSON.stringify({ action: "restart" }) })));
    panel.append(copy, metrics, controls);
    return panel;
  }

  function renderAgents(agents) {
    const panel = section("Configured agents", "Live status");
    const grid = make("div", "agent-control-grid");
    for (const agent of agents) {
      const card = make("article", "agent-control-card");
      const heading = make("div", "agent-control-card-heading");
      heading.append(make("h3", "", agent.name), badge(agent.status, agent.status));
      card.append(heading, make("p", "agent-control-purpose", agent.purpose));
      const health = make("p", "agent-control-meta");
      health.append(make("strong", "", "Health: "), badge(agent.health, agent.health));
      card.append(health);
      const details = make("dl", "agent-control-details");
      [
        ["Current task", agent.currentTask || "None"],
        ["Provider", agent.provider],
        ["Last activity", formatDate(agent.lastActivity)],
        ["Last successful operation", formatDate(agent.lastSuccessfulOperation)],
        ["Last run", formatDate(agent.lastRunAt)],
        ["Last error", agent.lastError || "None recorded"]
      ].forEach(([label, value]) => {
        const group = make("div");
        group.append(make("dt", "", label), make("dd", "", value));
        details.append(group);
      });
      card.append(details);
      grid.append(card);
    }
    panel.append(grid);
    return panel;
  }

  function renderProviders(providers) {
    const panel = section("AI provider health", "Observed provider state");
    panel.append(make("p", "agent-control-copy", "Provider status uses configuration and recent real requests only. No automatic health probes are sent, avoiding unnecessary provider usage or credit charges."));
    const grid = make("div", "agent-provider-grid");
    for (const provider of providers) {
      const item = make("article", "agent-provider-card");
      const heading = make("div", "agent-control-card-heading");
      heading.append(make("h3", "", provider.name), badge(provider.status, provider.status));
      item.append(heading, make("p", "agent-control-purpose", provider.detail));
      item.append(make("small", "", `Last checked: ${formatDate(provider.checkedAt)}${provider.retryable ? " · Retry may succeed" : ""}`));
      grid.append(item);
    }
    panel.append(grid);
    return panel;
  }

  function renderTaskHistory(items) {
    const panel = section("Task history", "Recent retained tasks");
    panel.dataset.taskHistory = "";
    panel.append(make("p", "agent-control-copy", "History and counts cover up to 50 recently retained tasks. Retries run only the temporarily failed agents, at most once per task."));
    const filters = make("div", "platform-toolbar agent-history-filters");
    const filterDefinitions = [
      ["agent", "All agents", [...new Set(items.flatMap(item => item.agentNames))].sort()],
      ["status", "All statuses", [...new Set(items.map(item => item.status))].sort()],
      ["approval", "All approval states", [...new Set(items.map(item => item.approvalStatus))].sort()]
    ];
    for (const [key, placeholder, values] of filterDefinitions) {
      const select = document.createElement("select");
      select.setAttribute("aria-label", placeholder);
      const all = document.createElement("option");
      all.value = "all";
      all.textContent = placeholder;
      select.append(all);
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value.replaceAll("_", " ");
        select.append(option);
      }
      select.value = historyFilters[key];
      select.addEventListener("change", () => {
        historyFilters[key] = select.value;
        const nextPanel = renderTaskHistory(lastSnapshot.taskHistory || []);
        panel.replaceWith(nextPanel);
      });
      filters.append(select);
    }
    panel.append(filters);
    const filtered = items.filter(item =>
      (historyFilters.agent === "all" || item.agentNames.includes(historyFilters.agent))
      && (historyFilters.status === "all" || item.status === historyFilters.status)
      && (historyFilters.approval === "all" || item.approvalStatus === historyFilters.approval)
    );
    if (!filtered.length) {
      panel.append(make("p", "platform-empty", items.length ? "No tasks match these filters." : "No tasks have been recorded."));
      return panel;
    }
    const list = make("div", "agent-control-list");
    for (const task of filtered) {
      const card = make("article", "agent-approval-card");
      const header = make("div", "agent-control-card-heading");
      header.append(make("h3", "", task.task), badge(task.status, task.status));
      card.append(header);
      card.append(make("p", "agent-control-meta", `${task.owner} · ${task.agentNames.join(", ") || "No agents"} · Approval: ${task.approvalStatus.replaceAll("_", " ")}`));
      card.append(make("p", "agent-control-meta", `Submitted ${formatDate(task.createdAt)} · Started ${formatDate(task.startedAt)} · Finished ${formatDate(task.finishedAt)} · Duration ${formatDuration(task.durationMs)}`));
      const details = document.createElement("details");
      details.append(make("summary", "", "View task results and errors"));
      for (const result of task.results) {
        const entry = make("p", "agent-control-meta", `${result.agent} · ${result.status}${result.result ? ` — ${result.result}` : ""}${result.error ? ` — ${result.error}` : ""}`);
        details.append(entry);
      }
      if (task.error) details.append(make("p", "agent-control-meta", task.error));
      card.append(details);
      if (task.canRetry) card.append(button("Retry temporary failures", () => runAction(task.id, "retry")));
      list.append(card);
    }
    panel.append(list);
    return panel;
  }

  function renderApprovals(approvals) {
    const panel = section("Approval queue", "Review before execution");
    panel.dataset.approvalQueue = "";
    if (!approvals.length) {
      panel.append(make("p", "platform-empty", "No tasks are waiting for approval."));
      return panel;
    }
    const list = make("div", "agent-control-list");
    for (const approval of approvals) {
      const item = make("article", "agent-approval-card");
      const header = make("div", "agent-control-card-heading");
      header.append(make("h3", "", approval.requestedAction), badge(approval.risk, "warning"));
      item.append(header, make("p", "agent-control-copy", approval.description));
      item.append(make("p", "agent-control-meta", `${approval.owner} · ${approval.agentNames.join(", ") || "No specialists"} · Submitted ${formatDate(approval.createdAt)}`));
      const disclosure = document.createElement("details");
      disclosure.append(make("summary", "", "Review full task details"), make("p", "", approval.description));
      item.append(disclosure);
      const controls = make("div", "platform-quick-actions");
      controls.append(
        button("Approve and queue", () => runAction(approval.id, "approve")),
        button("Reject", () => runAction(approval.id, "reject"), "platform-button danger")
      );
      item.append(controls);
      list.append(item);
    }
    panel.append(list);
    return panel;
  }

  function renderList(title, eyebrow, items, emptyText, kind) {
    const panel = section(title, eyebrow);
    if (!items.length) {
      panel.append(make("p", "platform-empty", emptyText));
      return panel;
    }
    const list = make("ul", "platform-list agent-timeline");
    for (const item of items) {
      const row = make("li", "platform-list-item");
      const content = make("div", "agent-timeline-content");
      const agent = item.agent || item.provider || "Agent";
      content.append(make("strong", "", `${agent} · ${item.task || item.category || "Agent event"}`));
      content.append(make("small", "", `${item.owner ? `${item.owner} · ` : ""}${formatDate(item.timestamp || item.createdAt)}${item.provider ? ` · ${item.provider}` : ""}`));
      const detail = item.error || item.result || item.detail;
      if (detail) content.append(make("p", "", detail));
      if (item.errorCategory || Number.isInteger(item.httpStatus) || item.retryable) {
        const technical = [
          item.errorCategory ? item.errorCategory.replaceAll("_", " ") : "",
          Number.isInteger(item.httpStatus) ? `HTTP ${item.httpStatus}` : "",
          item.retryable ? "Retry may succeed" : ""
        ].filter(Boolean).join(" · ");
        content.append(make("small", "", technical));
      }
      if (kind === "activity" && item.status === "queued") {
        content.append(button("Cancel pending task", () => runAction(item.id.split(":")[0], "cancel"), "platform-button danger"));
      }
      row.append(content, badge(item.status || "unknown", item.status));
      list.append(row);
    }
    panel.append(list);
    return panel;
  }

  function render(snapshot) {
    root.replaceChildren();
    const heading = make("section", "platform-heading");
    const intro = make("div");
    intro.append(make("p", "platform-eyebrow", "WSE ADVENTURES · ADMIN"));
    intro.append(make("h1", "platform-title", "Agent Control Center"));
    intro.append(make("p", "platform-lead", "Monitor actual agent activity, review approvals, and manage the shared queue. Individual agents run as task-scoped workers and cannot be started or stopped separately."));
    const refresh = button("Refresh now", async () => ({ message: "Agent status refreshed." }));
    heading.append(intro, refresh);
    root.append(heading);
    const message = make("p", "platform-success");
    message.dataset.agentMessage = "";
    message.hidden = true;
    message.setAttribute("role", "status");
    root.append(message);
    const grid = make("div", "platform-grid");
    grid.append(
      renderWorker(snapshot.worker, snapshot.observability),
      renderApprovals(snapshot.approvalQueue),
      renderAgents(snapshot.agents),
      renderProviders(snapshot.providers),
      renderTaskHistory(snapshot.taskHistory || []),
      renderList("Recent activity", "Task timeline", snapshot.activity, "No agent activity has been recorded.", "activity"),
      renderList("Agent error center", "Recent failures", snapshot.recentErrors, "No agent failures have been recorded.", "errors")
    );
    root.append(grid);
    root.append(make("p", "agent-control-refresh-note", "Status refreshes every 15 seconds while this page is visible."));
  }

  async function load() {
    if (loading || actionBusy || document.hidden) return;
    loading = true;
    try {
      lastSnapshot = await api("/api/admin/agents");
      render(lastSnapshot);
    } catch (error) {
      if (!lastSnapshot) root.replaceChildren(make("p", "platform-error", error.message || "Could not load agent status."));
      else showMessage(error.message || "Could not refresh agent status.", true);
    } finally {
      loading = false;
    }
  }

  load();
  window.setInterval(load, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
})();
