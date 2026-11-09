(() => {
  const list = document.getElementById("pending-list");
  const notice = document.getElementById("notice");
  const refreshButton = document.getElementById("refresh");
  let csrfToken = "";

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("error", isError);
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.method && options.method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign("/login.html");
      throw new Error("Please sign in.");
    }
    if (response.status === 403) throw new Error("Administrator access is required for this page.");
    if (!response.ok) throw new Error(payload.error || "The request failed.");
    return payload;
  }

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      list.append(element("p", "empty", "There are no pending AI approvals."));
      return;
    }
    for (const item of items) {
      const card = element("article", "request");
      const heading = element("div", "request-head");
      heading.append(element("h3", "", item.task), element("span", "request-meta", "Awaiting approval"));
      const who = item.requester || {};
      card.append(heading);
      card.append(element("p", "request-meta", "Submitted by " + (who.name || "Unknown user") + (who.email ? " · " + who.email : "")));
      card.append(element("p", "request-meta", "Created " + new Date(item.createdAt).toLocaleString()));
      const actions = element("div", "request-actions");
      const approve = element("button", "", "Approve and start AI review");
      approve.type = "button";
      approve.addEventListener("click", async () => {
        if (!window.confirm("Approve this AI review request? The agents will start processing it.")) return;
        approve.disabled = true;
        approve.textContent = "Starting review...";
        try {
          await api("/api/admin/agents/runs/" + encodeURIComponent(item.id) + "/approve", { method: "POST", body: "{}" });
          setNotice("Approval accepted. The AI review has finished or reported an error.");
          await load();
        } catch (error) {
          setNotice(error.message, true);
          approve.disabled = false;
          approve.textContent = "Try approval again";
        }
      });
      actions.append(approve);
      card.append(actions);
      list.append(card);
    }
  }

  async function load() {
    refreshButton.disabled = true;
    try {
      const data = await api("/api/admin/overview");
      document.getElementById("user-count").textContent = data.userCount;
      document.getElementById("pending-count").textContent = data.pendingCount;
      render(data.pending || []);
      if (!data.pendingCount) setNotice("All approval requests are up to date.");
    } catch (error) {
      setNotice(error.message, true);
      list.replaceChildren(element("p", "empty", "Could not load the approval queue."));
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", load);
  (async () => {
    try {
      const data = await api("/api/csrf");
      csrfToken = data.csrfToken;
      await load();
    } catch (error) {
      setNotice(error.message, true);
    }
  })();
})();
