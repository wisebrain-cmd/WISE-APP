(() => {
  const form = document.getElementById("task-form");
  if (!form) return;
  const taskInput = document.getElementById("task");
  const count = document.getElementById("char-count");
  const notice = document.getElementById("notice");
  const runsContainer = document.getElementById("runs");
  const submitButton = document.getElementById("submit-task");
  const autonomousMode = document.getElementById("autonomous-mode");
  let csrfToken = "";

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.method && options.method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = "/login.html";
      throw new Error("Please sign in to use your agent team.");
    }
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function setNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderRuns(runs) {
    runsContainer.replaceChildren();
    if (!runs.length) {
      runsContainer.append(make("p", "empty-state", "No tasks yet. Submit your first task above."));
      return;
    }
    for (const run of runs) {
      const card = make("article", "run-card");
      const top = make("div", "run-top");
      const title = make("h3", "", run.task);
      const status = make("span", "run-status", run.status.replaceAll("_", " "));
      top.append(title, status);
      card.append(top, make("p", "run-meta", "Created " + new Date(run.createdAt).toLocaleString()));
      if (run.status === "awaiting_approval") {
        const actions = make("div", "run-actions");
        const approve = make("button", "", "Approve and run agents");
        approve.type = "button";
        approve.addEventListener("click", async () => {
          approve.disabled = true;
          approve.textContent = "Agents working...";
          try {
            setNotice("Your approval was received. The five agents are working.");
            await api("/api/agents/runs/" + encodeURIComponent(run.id) + "/approve", { method: "POST", body: "{}" });
            await loadRuns();
            setNotice("The five agent reports are ready. No repository files were changed.");
          } catch (error) {
            setNotice(error.message, true);
            approve.disabled = false;
            approve.textContent = "Try approval again";
          }
        });
        actions.append(approve);
        card.append(actions);
      }
      if (run.error) card.append(make("p", "notice error", run.error));
      if (run.results && run.results.length) {
        const results = make("div", "run-results");
        for (const result of run.results) {
          const details = document.createElement("details");
          const summary = make("summary", "", result.agentName + " · " + result.provider);
          const output = make("p", "", result.output);
          details.append(summary, output);
          results.append(details);
        }
        card.append(results);
      }
      runsContainer.append(card);
    }
  }

  async function loadRuns() {
    const data = await api("/api/agents/runs");
    renderRuns(data.runs || []);
  }

  taskInput.addEventListener("input", () => {
    count.textContent = taskInput.value.length + " / 4000";
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const task = taskInput.value.trim();
    if (!task) return;
    submitButton.disabled = true;
    setNotice("Saving your task for approval...");
    try {
      const autonomous = autonomousMode.checked;
      await api("/api/agents/runs", { method: "POST", body: JSON.stringify({ task, autonomous }) });
      taskInput.value = "";
      count.textContent = "0 / 4000";
      setNotice(autonomous ? "Task queued. The independent agents will work in the background while the server is running." : "Task created. Review it below and approve when ready.");
      await loadRuns();
    } catch (error) {
      setNotice(error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  setInterval(() => {
    loadRuns().catch(error => setNotice(error.message, true));
  }, 10000);

  document.getElementById("refresh-runs").addEventListener("click", () => {
    loadRuns().catch(error => setNotice(error.message, true));
  });

  (async () => {
    try {
      const data = await api("/api/csrf");
      csrfToken = data.csrfToken;
      await loadRuns();
    } catch (error) {
      setNotice(error.message, true);
    }
  })();
})();
