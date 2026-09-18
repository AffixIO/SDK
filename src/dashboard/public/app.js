/* AffixIO local ops dashboard. Credit: @paparichens */
(() => {
  const TITLES = {
    live: "Live overview",
    kya: "Know Your Agent",
    proofs: "Proofs",
    queue: "Sync queue",
    config: "Operator config",
  };

  const LEADS = {
    live: "Licence, proofs, queue depth, and Know Your Agent receipts on this machine.",
    kya: "Enrol agents and authorise actions locally. You keep the control plane.",
    proofs: "Proofs stored under this operator directory.",
    queue: "Offline proofs waiting for Affix verify and attestation.",
    config: "Non-secret operator settings for this host.",
  };

  const els = {
    pollHint: document.getElementById("poll-hint"),
    onlinePill: document.getElementById("online-pill"),
    licencePill: document.getElementById("licence-pill"),
    topTitle: document.getElementById("top-title"),
    topEyebrow: document.getElementById("top-eyebrow"),
    pageLead: document.getElementById("page-lead"),
    statGrid: document.getElementById("stat-grid"),
    liveReceipts: document.getElementById("live-receipts"),
    liveProofs: document.getElementById("live-proofs"),
    proofsBody: document.getElementById("proofs-body"),
    queueBody: document.getElementById("queue-body"),
    configKv: document.getElementById("config-kv"),
    configRaw: document.getElementById("config-raw"),
    kyaResult: document.getElementById("kya-result"),
    agent: document.getElementById("kya-agent"),
    caps: document.getElementById("kya-caps"),
    action: document.getElementById("kya-action"),
    resource: document.getElementById("kya-resource"),
    attest: document.getElementById("kya-attest"),
  };

  let live = null;
  let timer = null;

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function setResult(value) {
    if (!els.kyaResult) return;
    els.kyaResult.textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function showView(name) {
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.getAttribute("data-view-panel") === name);
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === name);
    });
    if (els.topTitle) els.topTitle.textContent = TITLES[name] || name;
    if (els.topEyebrow) {
      els.topEyebrow.textContent =
        name === "kya" ? "Agent governance" : "Operator console";
    }
    if (els.pageLead) els.pageLead.textContent = LEADS[name] || "";
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function shortId(id) {
    const s = String(id || "");
    return s.length > 22 ? `${s.slice(0, 18)}…` : s || "—";
  }

  function renderStats(data) {
    const stats = data.stats || {};
    const proofs = stats.proofs || {};
    const cards = [
      {
        label: "Stored proofs",
        value: data.proofs?.stored ?? 0,
        sub: `${proofs.hmac || 0} HMAC · ${proofs.ultrahonk || 0} UltraHonk`,
      },
      {
        label: "Queue pending",
        value: data.queue?.pending ?? 0,
        sub: data.flush?.active ? "Auto-flush active" : "Auto-flush off",
      },
      {
        label: "KYA receipts",
        value: data.kya?.receipts ?? 0,
        sub: data.kya?.last_agent_id
          ? `Last agent ${shortId(data.kya.last_agent_id)}`
          : "No enrol yet",
      },
      {
        label: "Licence checks",
        value: stats.licence?.ok ?? 0,
        sub: `${stats.licence?.unreachable || 0} unreachable · key ${data.api_key?.key_hint || "none"}`,
      },
    ];
    els.statGrid.innerHTML = cards
      .map(
        (c) => `<div class="stat"><p class="label">${esc(c.label)}</p><p class="value">${esc(c.value)}</p><p class="sub">${esc(c.sub)}</p></div>`,
      )
      .join("");
  }

  function renderReceipts(rows, target) {
    if (!target) return;
    if (!rows?.length) {
      target.innerHTML = '<tr><td colspan="4">No KYA receipts yet.</td></tr>';
      return;
    }
    target.innerHTML = rows
      .map(
        (r) => `<tr>
          <td>${esc(shortId(r.agent_id))}</td>
          <td>${esc(r.action)} → ${esc(r.resource)}</td>
          <td>${r.allowed ? "yes" : "no"}</td>
          <td>${esc(r.at || "—")}</td>
        </tr>`,
      )
      .join("");
  }

  function renderProofs(rows, target, emptyCols) {
    if (!target) return;
    if (!rows?.length) {
      target.innerHTML = `<tr><td colspan="${emptyCols}">No stored proofs yet.</td></tr>`;
      return;
    }
    target.innerHTML = rows
      .map(
        (p) => `<tr>
          <td>${esc(shortId(p.proof_id))}</td>
          <td>${esc(p.circuit_id || "—")}</td>
          <td>${esc(p.decision || "—")}</td>
          <td>${esc(p.proof_mode || "—")}</td>
          <td>${esc(p.origin || "—")}</td>
        </tr>`,
      )
      .join("");
  }

  function renderQueue(rows) {
    if (!els.queueBody) return;
    if (!rows?.length) {
      els.queueBody.innerHTML = '<tr><td colspan="4">Queue is empty.</td></tr>';
      return;
    }
    els.queueBody.innerHTML = rows
      .map(
        (j) => `<tr>
          <td>${esc(shortId(j.proof_id))}</td>
          <td>${esc(j.circuit_id || "—")}</td>
          <td>${esc(j.decision || "—")}</td>
          <td>${esc(j.enqueued_at || "—")}</td>
        </tr>`,
      )
      .join("");
  }

  function renderConfig(data) {
    const licence = data.licence || {};
    const pairs = [
      ["API base", data.api_base],
      ["Online", data.online ? "yes" : "no"],
      ["Key hint", data.api_key?.key_hint || "not configured"],
      ["Proof mode", data.config?.proofMode],
      ["Licence only", String(data.config?.licenceOnly)],
      ["Licence valid", String(licence.valid ?? licence.ok ?? "—")],
      ["HSM", data.hsm?.configured ? data.hsm.provider : "not configured"],
      ["Spend head", data.spend?.head?.seq ?? data.spend?.head_seq ?? "—"],
    ];
    els.configKv.innerHTML = pairs
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("");
    els.configRaw.textContent = JSON.stringify(
      {
        api_key: data.api_key,
        licence: data.licence,
        config: data.config,
        hsm: data.hsm,
        spend: data.spend,
        flush: data.flush,
      },
      null,
      2,
    );
  }

  function paint(data) {
    live = data;
    const online = Boolean(data.online);
    els.onlinePill.textContent = online ? "API reachable" : "Offline / local";
    els.onlinePill.className = `pill ${online ? "is-ok" : "is-warn"}`;

    const licOk = Boolean(data.licence?.ok);
    els.licencePill.textContent = licOk ? "Licence ok" : "Licence local";
    els.licencePill.className = `pill ${licOk ? "is-ok" : "pill-quiet"}`;

    renderStats(data);
    renderReceipts(data.kya?.recent_receipts, els.liveReceipts);
    if (els.liveProofs) {
      const rows = data.proofs?.recent || [];
      if (!rows.length) {
        els.liveProofs.innerHTML = '<tr><td colspan="4">No stored proofs yet.</td></tr>';
      } else {
        els.liveProofs.innerHTML = rows
          .map(
            (p) => `<tr>
              <td>${esc(shortId(p.proof_id))}</td>
              <td>${esc(p.decision || "—")}</td>
              <td>${esc(p.proof_mode || "—")}</td>
              <td>${esc(p.origin || "—")}</td>
            </tr>`,
          )
          .join("");
      }
    }
    renderProofs(data.proofs?.recent || [], els.proofsBody, 5);
    renderQueue(data.queue?.items || []);
    renderConfig(data);
    if (els.pollHint) {
      els.pollHint.textContent = `Updated ${new Date(data.at).toLocaleTimeString("en-GB")}`;
    }
  }

  async function refresh() {
    try {
      const data = await api("/api/live");
      paint(data);
    } catch (err) {
      if (els.pollHint) els.pollHint.textContent = String(err.message || err);
      els.onlinePill.textContent = "Dashboard error";
      els.onlinePill.className = "pill is-bad";
    }
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.getAttribute("data-view")));
  });

  document.getElementById("btn-refresh")?.addEventListener("click", () => refresh());

  document.getElementById("btn-enrol")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      let capabilities;
      try {
        capabilities = JSON.parse(els.caps.value || "[]");
      } catch {
        throw new Error("Capabilities must be valid JSON.");
      }
      const data = await api("/api/kya/enrol", {
        method: "POST",
        body: JSON.stringify({
          agentId: els.agent.value.trim(),
          capabilities,
          ttlSeconds: 3600,
        }),
      });
      setResult(data);
      await refresh();
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-verify")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/kya/verify", { method: "POST", body: "{}" });
      setResult(data);
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-authorise")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/kya/authorise", {
        method: "POST",
        body: JSON.stringify({
          action: els.action.value.trim(),
          resource: els.resource.value.trim(),
          attest: Boolean(els.attest?.checked),
        }),
      });
      setResult(data);
      await refresh();
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-audit")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/kya/audit", { method: "POST", body: "{}" });
      setResult(data);
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-flush")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/flush", { method: "POST", body: "{}" });
      setResult(data);
      await refresh();
      showView("queue");
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-licence")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/licence/check", { method: "POST", body: "{}" });
      setResult(data);
      await refresh();
      showView("config");
    } catch (err) {
      setResult(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  refresh();
  timer = setInterval(refresh, 4000);
  window.addEventListener("beforeunload", () => {
    if (timer) clearInterval(timer);
  });
})();
