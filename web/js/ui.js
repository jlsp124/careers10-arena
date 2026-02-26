export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function escapeHtml(text) {
  return String(text ?? "")
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

export function formatClockMs(ms) {
  return formatTime(Math.ceil((Number(ms) || 0) / 1000));
}

export function tsToLocal(ts) {
  if (!ts) return "";
  try {
    return new Date(Number(ts) * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function createEl(tag, { cls, html, text, attrs } = {}) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  if (text !== undefined) el.textContent = text;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

export function setText(el, value) {
  if (el) el.textContent = value;
}

export function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", !!hidden);
}

export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function storageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function cortisolTier(cortisol) {
  const n = Number(cortisol ?? 1000);
  if (n <= 300) return "Zen";
  if (n <= 700) return "Calm";
  if (n <= 1200) return "Stable";
  return "Cooked";
}

export function tierClass(tier) {
  const t = String(tier || "").toLowerCase();
  if (t === "zen") return "tier-zen";
  if (t === "calm") return "tier-calm";
  if (t === "stable") return "tier-stable";
  return "tier-cooked";
}

export function cortisolBadge(cortisol) {
  const tier = cortisolTier(cortisol);
  return `<span class="badge-tier ${tierClass(tier)}">${tier} ${Number(cortisol ?? 0)}</span>`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

