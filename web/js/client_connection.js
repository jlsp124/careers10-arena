import { storageGet, storageSet } from "./ui.js";

export const CLIENT_CONNECTION_KEY = "cortisol_client_connection_v1";

const DEFAULT_STATE = {
  version: 1,
  activeProfileId: "",
  profiles: [],
  settings: {
    localPort: 8080,
    rememberLast: true,
    skipLauncher: false,
  },
};

export function loadClientConnection() {
  const saved = storageGet(CLIENT_CONNECTION_KEY, null);
  const state = {
    ...DEFAULT_STATE,
    ...(saved && typeof saved === "object" ? saved : {}),
    settings: {
      ...DEFAULT_STATE.settings,
      ...(saved?.settings && typeof saved.settings === "object" ? saved.settings : {}),
    },
  };
  state.profiles = Array.isArray(state.profiles) ? state.profiles.filter((profile) => profile?.hostUrl) : [];
  return state;
}

export function saveClientConnection(state) {
  const next = {
    version: 1,
    activeProfileId: state.activeProfileId || "",
    profiles: Array.isArray(state.profiles) ? state.profiles.slice(0, 8) : [],
    settings: {
      ...DEFAULT_STATE.settings,
      ...(state.settings || {}),
    },
  };
  storageSet(CLIENT_CONNECTION_KEY, next);
  return next;
}

export function getActiveProfile() {
  const state = loadClientConnection();
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

export function getActiveHostUrl() {
  return getActiveProfile()?.hostUrl || location.origin + "/";
}

export function localHostUrl(port = 8080) {
  return `http://127.0.0.1:${Math.max(1, Number(port) || 8080)}/`;
}

export function normalizeHostUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) throw new Error("host_url_required");
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = "/";
  return url.toString();
}

export function sameHostUrl(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function hostUrlToWsUrl(hostUrl) {
  const url = new URL(hostUrl || location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function probeHost(hostUrl, { timeoutMs = 4500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const statusUrl = new URL("/api/client/status", hostUrl).toString();
  try {
    const res = await fetch(statusUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.ok) {
      const error = new Error(payload?.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("host_probe_timeout");
      timeoutError.detail = "The selected Cortisol Host did not answer before the connection timeout.";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function saveConnectionProfile({ mode, hostUrl, label, status, settings = {} }) {
  const normalized = normalizeHostUrl(hostUrl);
  const state = loadClientConnection();
  const cleanMode = mode || "url";
  const id = `${cleanMode}:${new URL(normalized).origin}`;
  const profile = {
    id,
    mode: cleanMode,
    label: label || labelForMode(cleanMode, normalized),
    hostUrl: normalized,
    lastConnectedAt: new Date().toISOString(),
    hostRole: status?.role || status?.host || "Cortisol Host",
    appVersion: status?.app_version || "",
  };
  const existing = state.profiles.filter((item) => item.id !== id);
  state.profiles = [profile, ...existing].slice(0, 8);
  state.activeProfileId = id;
  state.settings = { ...state.settings, ...settings };
  return saveClientConnection(state);
}

export function updateClientSettings(settings = {}) {
  const state = loadClientConnection();
  state.settings = { ...state.settings, ...settings };
  return saveClientConnection(state);
}

export function launchParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has("clientLaunch") && !params.has("clientMode")) return null;
  return {
    mode: params.get("clientMode") || "join-host",
    label: params.get("clientLabel") || "",
  };
}

export function cleanLaunchParams() {
  const url = new URL(location.href);
  url.searchParams.delete("clientLaunch");
  url.searchParams.delete("clientMode");
  url.searchParams.delete("clientLabel");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash || "#/home"}`);
}

export function redirectToHost(hostUrl, { mode = "url", label = "" } = {}) {
  const url = new URL(hostUrl);
  url.searchParams.set("clientLaunch", "1");
  url.searchParams.set("clientMode", mode);
  if (label) url.searchParams.set("clientLabel", label);
  if (!url.hash) url.hash = location.hash || "#/home";
  location.assign(url.toString());
}

function labelForMode(mode, hostUrl) {
  if (mode === "local") return "Local Host";
  if (mode === "join-host") return `LAN Host ${new URL(hostUrl).host}`;
  return `URL Host ${new URL(hostUrl).host}`;
}
