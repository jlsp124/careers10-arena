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

export function tsToRelative(ts) {
  if (!ts) return "";
  const delta = Math.floor(Date.now() / 1000) - Number(ts);
  const abs = Math.abs(delta);
  if (abs < 60) return `${abs}s ${delta >= 0 ? "ago" : "from now"}`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m ${delta >= 0 ? "ago" : "from now"}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)}h ${delta >= 0 ? "ago" : "from now"}`;
  return `${Math.floor(abs / 86400)}d ${delta >= 0 ? "ago" : "from now"}`;
}

export function formatCompactNumber(value, digits = 1) {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

export function formatDecimal(value, digits = 2) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function formatCC(value, digits = 2) {
  return `${formatDecimal(value, digits)} CC`;
}

export function formatSigned(value, digits = 2, suffix = "") {
  const n = Number(value || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatDecimal(n, digits)}${suffix}`;
}

export function formatSignedPct(value, digits = 2) {
  const n = Number(value || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function percentClass(value) {
  const n = Number(value || 0);
  if (n > 0.0001) return "positive";
  if (n < -0.0001) return "negative";
  return "neutral";
}

export function sparklineSvg(values, { stroke = "var(--accent-2)", width = 132, height = 42 } = {}) {
  if (!values?.length) return `<div class="mini-chart-empty"></div>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.000001, max - min);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 100;
    const y = 100 - (((v - min) / range) * 100);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:${width}px;height:${height}px;">
      <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
  `;
}

export function priceVolumeChartSvg(chart, { width = 520, height = 240 } = {}) {
  const points = chart?.points || [];
  if (!points.length) return `<div class="mini-chart-empty"></div>`;
  const markers = chart?.markers || [];
  const prices = points.map((point) => Number(point.price || 0));
  const volumes = points.map((point) => Number(point.volume_cc || 0));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = Math.max(0.000001, maxPrice - minPrice);
  const maxVolume = Math.max(1, ...volumes);
  const priceTop = 8;
  const priceHeight = 136;
  const volumeTop = 156;
  const volumeHeight = 46;
  const xAt = (index) => ((index / Math.max(1, points.length - 1)) * 100);
  const yAt = (price) => priceTop + (1 - ((price - minPrice) / priceRange)) * priceHeight;
  const areaPoints = points.map((point, index) => `${xAt(index).toFixed(2)},${yAt(Number(point.price || 0)).toFixed(2)}`).join(" ");
  const volumeBars = points.map((point, index) => {
    const barWidth = 90 / Math.max(1, points.length);
    const x = Math.max(0, xAt(index) - (barWidth / 2));
    const barHeight = (Number(point.volume_cc || 0) / maxVolume) * volumeHeight;
    const y = volumeTop + (volumeHeight - barHeight);
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="1.5"></rect>`;
  }).join("");
  const markerDots = markers.map((marker) => {
    const ts = Number(marker.ts || 0);
    let nearestIndex = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const delta = Math.abs(Number(points[i].ts || 0) - ts);
      if (delta < best) {
        best = delta;
        nearestIndex = i;
      }
    }
    const x = xAt(nearestIndex);
    const y = yAt(Number(points[nearestIndex].price || 0));
    const tone = marker.side === "sell" || /panic|flush|remove/i.test(marker.kind || marker.label || "") ? "chart-marker-negative" : "chart-marker-positive";
    return `
      <g class="chart-marker ${tone}">
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.8"></circle>
        <text x="${x.toFixed(2)}" y="${Math.max(10, y - 8).toFixed(2)}" text-anchor="middle">${escapeHtml(String(marker.label || "").slice(0, 8))}</text>
      </g>
    `;
  }).join("");
  return `
    <svg class="price-volume-chart" viewBox="0 0 100 210" preserveAspectRatio="none" style="width:${width}px;height:${height}px;">
      <line x1="0" y1="${(priceTop + priceHeight).toFixed(2)}" x2="100" y2="${(priceTop + priceHeight).toFixed(2)}" class="chart-baseline"></line>
      <line x1="0" y1="${(volumeTop + volumeHeight).toFixed(2)}" x2="100" y2="${(volumeTop + volumeHeight).toFixed(2)}" class="chart-baseline"></line>
      <g class="chart-volume-bars">${volumeBars}</g>
      <polygon class="chart-line-fill" points="0,${(priceTop + priceHeight).toFixed(2)} ${areaPoints} 100,${(priceTop + priceHeight).toFixed(2)}"></polygon>
      <polyline class="chart-line" points="${areaPoints}"></polyline>
      ${markerDots}
    </svg>
  `;
}

export function initials(text, fallback = "CA") {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  return words.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || fallback;
}

export function tokenAccent(seed, fallback = "#8ec5ff") {
  const str = String(seed || "");
  if (!str) return fallback;
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 62%)`;
}

export function renderTokenAvatar(token, { compact = false } = {}) {
  const label = token?.symbol || token?.name || "CA";
  const accent = token?.theme_color || token?.color || tokenAccent(label);
  const initialsLabel = escapeHtml(initials(label, "CA"));
  const iconSource = token?.icon_data || token?.icon_data_url || token?.icon_url || "";
  if (iconSource) {
    return `<span class="token-avatar ${compact ? "compact" : ""}" style="--token-accent:${accent}; background-image:url('${iconSource.replace(/'/g, "%27")}');"></span>`;
  }
  return `<span class="token-avatar ${compact ? "compact" : ""}" style="--token-accent:${accent};">${initialsLabel}</span>`;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("file_read_failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
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

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
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
