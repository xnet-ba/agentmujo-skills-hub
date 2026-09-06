// AgentMujo Skills Hub — web catalog frontend
// Fetches from the local Node server /api/* endpoints.

const state = {
  q: "",
  category: "All",
  minScore: "",
  minStars: "",
  maxRisk: "All",
  verified: "",
  status: "All",
  tag: "",
  sortBy: "score",   // score | risk | name | recent
  sortDir: "desc",   // asc | desc
  offset: 0,
};

const PAGE_SIZE = 200;

const $ = (id) => document.getElementById(id);

async function init() {
  // Load stats
  try {
    const stats = await (await fetch("/api/stats")).json();
    renderStats(stats);
  } catch {
    /* registry not ready */
  }

  // Load categories
  try {
    const { categories } = await (await fetch("/api/categories")).json();
    const sel = $("category");
    for (const c of categories) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
  } catch {
    /* ignore */
  }

  // Load tag suggestions
  try {
    const { tags } = await (await fetch("/api/tags")).json();
    const dl = $("taglist");
    for (const t of tags.slice(0, 60)) {
      const opt = document.createElement("option");
      opt.value = t.tag;
      dl.appendChild(opt);
    }
  } catch {
    /* ignore */
  }

  // Bind controls
  bind("q", "input", (v) => { state.q = v; debounce(load); });
  bind("tag", "input", (v) => { state.tag = v; debounce(load); });
  bind("category", "change", (v) => { state.category = v; load(); });
  bind("minScore", "change", (v) => { state.minScore = v; load(); });
  bind("minStars", "change", (v) => { state.minStars = v; load(); });
  bind("maxRisk", "change", (v) => { state.maxRisk = v; load(); });
  bind("verified", "change", (v) => { state.verified = v; load(); });
  bind("status", "change", (v) => { state.status = v; load(); });

  // pagination
  const moreBtn = $("load-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => load(false));
  }

  // sort button bindings
  bind("sort-score", "click", () => { state.sortBy = "score"; state.sortDir = "desc"; markActiveSort("sort-score"); load(); });
  bind("sort-risk", "click", () => { state.sortBy = "risk"; state.sortDir = "desc"; markActiveSort("sort-risk"); load(); });
  bind("sort-name", "click", () => { state.sortBy = "name"; state.sortDir = "asc"; markActiveSort("sort-name"); load(); });
  bind("sort-recent", "click", () => { state.sortBy = "recent"; state.sortDir = "desc"; markActiveSort("sort-recent"); load(); });

  // modal
  const modalClose = $("modal-close");
  if (modalClose) modalClose.addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // toast
  let toastTimer = null;
  window.showToast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  };

  await load();
}

function bind(id, evt, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(evt, (e) => fn(e.target.value));
}

let debounceTimer = null;
function debounce(fn, ms = 300) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

function markActiveSort(id) {
  document.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
  const el = $(id);
  if (el) el.classList.add("active");
}

function renderStats(stats) {
  const box = $("stats");
  box.innerHTML = "";
  const items = [
    ["Total", stats.total],
    ["Active", stats.active],
    ["Stale", stats.stale],
    ["Invalid", stats.invalid],
    ["Removed", stats.removed],
    ["Sources", stats.sources],
  ];
  for (const [label, value] of items) {
    const d = document.createElement("div");
    d.className = "stat";
    d.setAttribute("aria-label", `${label} ${value}`);
    d.innerHTML = `<b>${value}</b>${label}`;
    box.appendChild(d);
  }
}

async function load(reset = true) {
  if (reset) state.offset = 0;
  if (state.offset === 0) {
    $("skills").innerHTML = '<div class="loading" aria-live="polite">Loading skills...</div>';
    const more = $("load-more");
    if (more) more.style.display = "none";
  }

  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.tag) params.set("tag", state.tag);
  if (state.category && state.category !== "All") params.set("category", state.category);
  if (state.minScore) params.set("minScore", state.minScore);
  if (state.minStars) params.set("minStars", state.minStars);
  if (state.maxRisk && state.maxRisk !== "All") params.set("maxRisk", state.maxRisk);
  if (state.verified) params.set("verified", state.verified);
  if (state.status && state.status !== "All") params.set("status", state.status);
  params.set("sortBy", state.sortBy);
  params.set("sortDir", state.sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(state.offset));

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    const { total, skills, offset } = await res.json();
    $("result-count").textContent = total > 0
      ? `Showing ${Math.min(offset + skills.length, total)} of ${total} skill(s)`
      : `0 skills`;
    renderSkills(skills, !reset, total);
    state.offset = offset + skills.length;
    const more = $("load-more");
    if (more) {
      more.style.display = state.offset < total ? "inline-block" : "none";
      more.disabled = skills.length === 0;
    }
  } catch (e) {
    $("skills").innerHTML = `<div class="empty" aria-live="polite">Error loading skills: ${e.message}.</div>`;
  }
}

function sortSkills(skills) {
  const dir = state.sortDir === "desc" ? -1 : 1;
  const riskOrder = { high: 3, medium: 2, low: 1 };
  switch (state.sortBy) {
    case "score":
      return [...skills].sort((a, b) => ((b.score || 0) - (a.score || 0)) * dir);
    case "risk":
      return [...skills].sort((a, b) => ((riskOrder[b.risk_level] || 0) - (riskOrder[a.risk_level] || 0)) * dir);
    case "name":
      return [...skills].sort((a, b) => (a.name || "").localeCompare(b.name || "") * dir);
    default:
      return skills;
  }
}

function parseTags(s) {
  try {
    const t = JSON.parse(s.tags);
    return Array.isArray(t) ? t.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function isInstalled(s) {
  return !!(s.meta && (s.meta.installed_at || s.meta.installed_dir || s.install_status === "installed"));
}

function renderSkills(skills, append = false, total = 0) {
  skills = sortSkills(skills);
  const box = $("skills");

  if (!append) box.innerHTML = "";

  if (!skills || skills.length === 0) {
    if (!append) {
      box.innerHTML = '<div class="empty" aria-live="polite">No skills found. Try a different search or install the registry first.</div>';
    }
    return;
  }

  for (const s of skills) {
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Skill: ${s.name}, score ${s.score}, risk ${s.risk_level}, status ${s.status}`);

    card.addEventListener("focus", () => card.classList.add("focused"));
    card.addEventListener("blur", () => card.classList.remove("focused"));

    const scoreClass = s.score >= 90 ? "score-good" : s.score >= 75 ? "score-mid" : "score-low";
    const riskClass = `risk-${s.risk_level}`;
    const statusBadge = s.status === "active"
      ? 'badge-active' : s.status === "stale" ? 'badge-stale' : 'badge-invalid';
    const tags = parseTags(s);
    const installed = isInstalled(s);
    const ghUrl = s.github_url || s.repository_url || "";
    const id = encodeURIComponent(s.id);

    const tagHtml = tags.length
      ? `<div class="tag-row">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
      : "";

    const ghBtn = ghUrl
      ? `<button type="button" class="gh-btn" data-url="${esc(ghUrl)}">GitHub</button>`
      : "";

    card.innerHTML = `
      <div class="top">
        <h3>${esc(s.name)}</h3>
        <span class="pill ${scoreClass}">${s.score}</span>
      </div>
      <div class="desc">${esc(s.description || "No description")}</div>
      <div><span class="category">${esc(s.category || "Other")}</span></div>
      ${tagHtml}
      <div class="meta">
        <span class="pill ${riskClass}">${esc(s.risk_level)}</span>
        <span class="pill">${s.stars}★</span>
        <span class="pill">${s.forks}⑂</span>
        <span class="badge ${statusBadge}">${esc(s.status)}</span>
        <span class="pill">${s.verified === 1 ? "✓ verified" : "unverified"}</span>
        ${installed ? '<span class="pill" style="color:var(--green)">installed</span>' : ""}
      </div>
      <div class="actions">
        <button type="button" class="details-btn" data-id="${id}">Details</button>
        ${ghBtn}
        <button type="button" class="install-btn primary" data-id="${id}" data-installed="${installed ? "1" : "0"}">${installed ? "Uninstall" : "Install"}</button>
      </div>
    `;

    const detailsBtn = card.querySelector(".details-btn");
    if (detailsBtn) detailsBtn.addEventListener("click", () => openModal(s.id));
    const ghBtnEl = card.querySelector(".gh-btn");
    if (ghBtnEl) ghBtnEl.addEventListener("click", () => window.open(ghBtnEl.dataset.url, "_blank", "noopener"));
    const instBtn = card.querySelector(".install-btn");
    if (instBtn) instBtn.addEventListener("click", async () => {
      const isInst = instBtn.dataset.installed === "1";
      instBtn.disabled = true;
      const action = isInst ? "uninstall" : "install";
      const res = await fetch(`/api/${action}/${s.id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      instBtn.disabled = false;
      if (data.ok) {
        if (action === "install") {
          s.meta = s.meta || {};
          s.meta.installed_at = data.installed_at || new Date().toISOString();
          s.meta.installed_dir = data.path;
          instBtn.dataset.installed = "1";
          instBtn.textContent = "Uninstall";
          window.showToast(`Installed ${s.name} → ${data.path}`);
        } else {
          delete s.meta.installed_at;
          delete s.meta.installed_dir;
          instBtn.dataset.installed = "0";
          instBtn.textContent = "Install";
          window.showToast(`Uninstalled ${s.name}`);
        }
      } else {
        window.showToast(data.error || "Operation failed");
      }
    });

    box.appendChild(card);
  }
}

function closeModal() {
  $("modal").classList.remove("open");
  document.body.style.overflow = "";
}

async function openModal(id) {
  const backdrop = $("modal");
  backdrop.classList.add("open");
  document.body.style.overflow = "hidden";
  $("modal-body").innerHTML = '<div class="loading">Loading...</div>';
  $("modal-title").textContent = id;

  let skill, content;
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(id)}`);
    skill = await res.json();
  } catch {
    skill = null;
  }
  try {
    const res = await fetch(`/api/content/${encodeURIComponent(id)}`);
    content = await res.json();
  } catch {
    content = null;
  }

  if (!skill) {
    $("modal-body").innerHTML = '<div class="empty">Skill not found.</div>';
    $("modal-title").textContent = "Not found";
    return;
  }

  $("modal-title").textContent = skill.name;

  const facts = [
    ["Category", skill.category],
    ["Source", skill.repository],
    ["Score", skill.score],
    ["Stars", skill.stars],
    ["Forks", skill.forks],
    ["License", skill.license],
    ["Risk", skill.risk_level],
    ["Status", skill.status],
    ["Verified", skill.verified === 1 ? "yes" : "no"],
    ["Updated", skill.last_update],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  const tags = parseTags(skill);
  const installed = isInstalled(skill);
  const ghUrl = skill.github_url || skill.repository_url || "";
  const ghBtn = ghUrl
    ? `<button type="button" class="sort-btn" onclick="window.open('${escAttr(ghUrl)}','_blank','noopener')">Open on GitHub</button>`
    : "";

  $("modal-body").innerHTML = `
    <div class="actions">
      <button type="button" class="sort-btn primary" id="modal-install" data-installed="${installed ? "1" : "0"}">${installed ? "Uninstall" : "Install"}</button>
      ${ghBtn}
    </div>
    <div class="facts">
      ${facts.map(([k, v]) => `<div class="fact"><b>${esc(k)}</b>${esc(String(v))}</div>`).join("")}
    </div>
    ${tags.length ? `<div class="tag-row">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="preview-label">SKILL.md preview</div>
    <pre>${esc(content && content.content_available ? content.body : "No preview available for this skill.")}</pre>
  `;

  const instBtn = $("modal-install");
  if (instBtn) instBtn.addEventListener("click", async () => {
    const isInst = instBtn.dataset.installed === "1";
    instBtn.disabled = true;
    const action = isInst ? "uninstall" : "install";
    const res = await fetch(`/api/${action}/${id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    instBtn.disabled = false;
    if (data.ok) {
      instBtn.dataset.installed = isInst ? "0" : "1";
      instBtn.textContent = isInst ? "Install" : "Uninstall";
      window.showToast(isInst ? `Uninstalled ${skill.name}` : `Installed ${skill.name} → ${data.path}`);
    } else {
      window.showToast(data.error || "Operation failed");
    }
  });
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s || "";
  return div.innerHTML;
}

function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", init);