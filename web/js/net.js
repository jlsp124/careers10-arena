const TOKEN_KEY = "careers10arena_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const opts = { method: "GET", ...options };
  const headers = new Headers(opts.headers || {});
  const token = getToken();
  if (token) headers.set("X-Session-Token", token);

  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  opts.headers = headers;

  const res = await fetch(path, opts);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export async function getMe() {
  return api("/api/me");
}

export async function getConfig() {
  return api("/api/config");
}

export async function getLeaderboard(limit = 50) {
  return api(`/api/leaderboard?limit=${encodeURIComponent(limit)}`);
}

export class WSClient {
  constructor(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.anyHandlers = new Set();
    this.isOpen = false;
    this.helloReady = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  onAny(fn) {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  _emit(msg) {
    const set = this.handlers.get(msg.type);
    if (set) for (const fn of [...set]) fn(msg);
    for (const fn of [...this.anyHandlers]) fn(msg);
  }

  async connect() {
    if (this.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws.readyState)) return;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      this.isOpen = true;
      this.helloReady = false;
      const token = getToken();
      if (token) this.send({ type: "hello", token });
      this._emit({ type: "_socket_open" });
    });
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "hello_ok") this.helloReady = true;
      this._emit(msg);
    });
    this.ws.addEventListener("close", () => {
      this.isOpen = false;
      this._emit({ type: "_socket_close" });
    });
    this.ws.addEventListener("error", () => this._emit({ type: "_socket_error" }));
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

let sharedWS = null;
export function getSharedWS() {
  if (!sharedWS) sharedWS = new WSClient();
  return sharedWS;
}

export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

export function joinUrlFor(page, params = {}) {
  const url = new URL(`${location.origin}/${page}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

