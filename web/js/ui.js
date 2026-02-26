import { api, clearToken, getConfig, getToken } from "./net.js";

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatClockMs(ms) { return formatTime(Math.ceil((Number(ms) || 0) / 1000)); }
export function tsToLocal(ts) { try { return new Date(Number(ts) * 1000).toLocaleString(); } catch { return String(ts); } }

export function cortisolTier(cortisol) {
  const n = Number(cortisol ?? 1000);
  if (n <= 300) return "Zen";
  if (n <= 700) return "Calm";
  if (n <= 1200) return "Stable";
  return "Cooked";
}
export function tierClass(tier) {
  const t = String(tier || "").toLowerCase();
  return t === "zen" ? "tier-zen" : t === "calm" ? "tier-calm" : t === "stable" ? "tier-stable" : "tier-cooked";
}
export function cortisolBadge(cortisol) {
  const tier = cortisolTier(cortisol);
  return `<span class="cortisol-tag ${tierClass(tier)}">${tier} · ${Number(cortisol ?? 0)}</span>`;
}

export function setStatus(el, text, kind = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ""}`;
}

export function toast(text, kind = "") {
  const div = document.createElement("div");
  div.className = "toast";
  if (kind === "err") div.style.borderColor = "rgba(255,107,122,.35)";
  if (kind === "ok") div.style.borderColor = "rgba(74,222,128,.35)";
  div.textContent = text;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

export function installTopbar({ pageTitle = "", showAuth = true } = {}) {
  const page = document.querySelector(".page") || document.body;
  const host = document.createElement("div");
  host.className = "topbar";
  host.innerHTML = `
    <div class="row">
      <div class="brand">Careers10 Collaboration Tool</div>
      ${pageTitle ? `<span class="pill">${escapeHtml(pageTitle)}</span>` : ""}
    </div>
    <div class="navlinks">
      <a href="/index.html">Home</a>
      <a href="/lobby.html">Lobby</a>
      <a href="/hub.html">Careers Hub</a>
      <a href="/dm.html">DMs</a>
      <a href="/arena.html">Engagement Simulator</a>
      <a href="/minigames.html">Mini-Games</a>
      ${showAuth ? `<button class="ghost" id="logoutBtn" type="button">Logout</button>` : ""}
    </div>
  `;
  page.prepend(host);
  const logoutBtn = host.querySelector("#logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      clearToken();
      location.href = "/login.html";
    });
  }
}

export async function requireAuth({ redirect = "/login.html" } = {}) {
  if (!getToken()) {
    location.href = redirect;
    throw new Error("redirect");
  }
  try {
    const payload = await api("/api/me");
    return payload.me;
  } catch (e) {
    clearToken();
    location.href = redirect;
    throw e;
  }
}

export async function hydrateFooterConfig(el) {
  if (!el) return;
  try {
    const { config } = await getConfig();
    el.textContent = `Uploads: ${config.max_upload_mb} MB max · Retention: ${config.retention_hours}h · Storage cap: ${config.max_total_storage_gb} GB`;
  } catch {
    el.textContent = "Server config unavailable.";
  }
}

export function renderLeaderboardTable(rows, tbody) {
  if (!tbody) return;
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.display_name || r.username)}</td>
      <td>${escapeHtml(r.username)}</td>
      <td>${cortisolBadge(r.cortisol)}</td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td>${r.kos}</td>
      <td>${r.deaths}</td>
      <td>${r.streak}</td>
    </tr>
  `).join("");
}

export function keyboardCombo(listener) {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "g" || e.key === "G")) listener(e);
  });
}

