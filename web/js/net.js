const TOKEN_KEY = "cortisol_arcade_token";

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
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(payload?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export async function uploadFile(file, { signal } = {}) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("X-Session-Token", token);
  const res = await fetch("/api/upload", { method: "POST", body: fd, headers, signal });
  const payload = await res.json();
  if (!res.ok) {
    const err = new Error(payload?.error || "upload_failed");
    err.payload = payload;
    throw err;
  }
  return payload;
}

export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  return Promise.resolve();
}

export function buildHashUrl(route, params = {}) {
  const u = new URL(location.href);
  u.search = "";
  const hashUrl = new URL("http://x/" + route.replace(/^#?\/?/, ""));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") hashUrl.searchParams.set(k, String(v));
  }
  return `${u.origin}${u.pathname}#/${hashUrl.pathname.replace(/^\//, "")}${hashUrl.search}`;
}

class Emitter {
  constructor() {
    this.map = new Map();
    this.any = new Set();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type)?.delete(fn);
  }
  onAny(fn) {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }
  emit(msg) {
    const set = this.map.get(msg.type);
    if (set) for (const fn of [...set]) fn(msg);
    for (const fn of [...this.any]) fn(msg);
  }
}

export class WSClient {
  constructor(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`) {
    this.url = url;
    this.ws = null;
    this.emitter = new Emitter();
    this.shouldReconnect = true;
    this.reconnectDelayMs = 500;
    this.reconnectTimer = null;
    this.helloReady = false;
    this.wsState = "idle";
    this.lastEventType = "";
    this.pingMs = null;
    this.lastPongTs = 0;
    this._pingTimer = null;
    this._helloWaiters = [];
  }

  on(type, fn) { return this.emitter.on(type, fn); }
  onAny(fn) { return this.emitter.onAny(fn); }

  _setState(state) {
    this.wsState = state;
    this.emitter.emit({ type: "_ws_status", state, ping_ms: this.pingMs, hello_ready: this.helloReady });
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(5000, Math.floor(this.reconnectDelayMs * 1.6));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this._setState("reconnecting");
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const ts = Date.now();
      this.send({ type: "ping", ts });
    }, 5000);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.ws.readyState)) {
      return;
    }
    this.helloReady = false;
    this._setState("connecting");
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      this.reconnectDelayMs = 500;
      this._setState("open");
      const token = getToken();
      if (token) this.send({ type: "hello", token });
      this._startPing();
      this.emitter.emit({ type: "_socket_open" });
    });
    this.ws.addEventListener("message", (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.lastEventType = msg.type || "";
      if (msg.type === "hello_ok") {
        this.helloReady = true;
        this._helloWaiters.splice(0).forEach((resolve) => resolve(true));
      }
      if (msg.type === "pong" && msg.ts) {
        this.pingMs = Math.max(0, Date.now() - Number(msg.ts));
        this.lastPongTs = Date.now();
      }
      this.emitter.emit(msg);
      if (msg.type !== "_ws_status") {
        this.emitter.emit({ type: "_ws_status", state: this.wsState, ping_ms: this.pingMs, hello_ready: this.helloReady });
      }
    });
    this.ws.addEventListener("close", () => {
      this.helloReady = false;
      this._stopPing();
      this._setState("closed");
      this.emitter.emit({ type: "_socket_close" });
      this._scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      this.emitter.emit({ type: "_socket_error" });
    });
  }

  disconnect({ reconnect = false } = {}) {
    this.shouldReconnect = !!reconnect;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();
    try { this.ws?.close(); } catch {}
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  async waitForHello(timeoutMs = 5000) {
    if (this.helloReady) return true;
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      this._helloWaiters.push((ok) => {
        clearTimeout(t);
        resolve(ok);
      });
    });
  }
}

let shared = null;
export function getWS() {
  if (!shared) shared = new WSClient();
  return shared;
}
