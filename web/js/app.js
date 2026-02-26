import { audio } from "./audio.js";
import { api, clearToken, getToken, getWS, setToken } from "./net.js";
import { NotifyCenter } from "./notify.js";
import { ArenaScreen } from "./screens/ArenaScreen.js";
import { HubScreen } from "./screens/HubScreen.js";
import { LeaderboardScreen } from "./screens/LeaderboardScreen.js";
import { MessagesScreen } from "./screens/MessagesScreen.js";
import { MiniGamesScreen } from "./screens/MiniGamesScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { $, $$, escapeHtml, storageGet, storageSet } from "./ui.js";

const PREFS_KEY = "cortisol_arcade_prefs";

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "play";
  const url = new URL(`http://x/${raw}`);
  const name = (url.pathname.replace(/^\//, "") || "play").toLowerCase();
  const params = Object.fromEntries(url.searchParams.entries());
  return { name, params };
}

function routeGroup(name) {
  if (["chess", "pong", "reaction", "typing", "minigames"].includes(name)) return "minigames";
  if (["play", "arena", "messages", "hub", "leaderboard", "settings"].includes(name)) return name;
  return "play";
}

class App {
  constructor() {
    this.root = $("#appRoot");
    this.screenHost = $("#screenHost");
    this.screenLoading = $("#screenLoading");
    this.screenLoadingText = $("#screenLoadingText");
    this.authOverlay = $("#authOverlay");
    this.authStatus = $("#authStatus");
    this.wsDot = $("#wsDot");
    this.wsStatusText = $("#wsStatusText");
    this.serverHintText = $("#serverHintText");
    this.userChipLabel = $("#userChipLabel");
    this.debugOverlay = $("#debugOverlay");

    this.ws = getWS();
    this.notify = new NotifyCenter({ root: document });
    this.state = { lobby: { rooms: [], online: [], queues: {} }, queue: null };
    this.route = { name: "play", params: {} };
    this.activeScreen = null;
    this.screens = new Map();
    this.me = null;
    this.lastMatchFound = null;
    this.prefs = storageGet(PREFS_KEY, {
      sidebarCollapsed: false,
      debugEnabled: false,
      soundEnabled: false,
      soundVolume: 0.08,
    });
    this.debugState = { wsState: "idle", pingMs: null, lastEventType: "" };

    this.ctx = {
      ws: this.ws,
      notify: this.notify,
      state: this.state,
      get me() { return app.me; },
      get route() { return app.route; },
      get lastMatchFound() { return app.lastMatchFound; },
      get debugEnabled() { return app.prefs.debugEnabled; },
      get debugState() { return app.debugState; },
      get soundEnabled() { return app.prefs.soundEnabled; },
      get soundVolume() { return app.prefs.soundVolume; },
      setTopbar: (title, subtitle) => this.setTopbar(title, subtitle),
      setScreenLoading: (text, show) => this.setScreenLoading(text, show),
      navigate: (route, params) => this.navigate(route, params),
      onLoggedOut: () => this.handleLogout(),
      isScreenActive: (screen) => this.activeScreen === screen,
      setDebugEnabled: (enabled) => this.setDebugEnabled(enabled),
      setSoundEnabled: (enabled) => this.setSoundEnabled(enabled),
      setSoundVolume: (volume) => this.setSoundVolume(volume),
    };

    // `ctx` getter closures reference `app`; bind once after construction.
    window.app = this; // local debugging
  }

  async init() {
    this.applyPrefs();
    this.wireShell();
    this.mountScreens();
    this.bindWS();
    this.bindAuthForms();
    this.notify.subscribe(() => this.updateSidebarBadges());
    this.updateSidebarBadges();
    this.updateDebugOverlay();

    window.addEventListener("hashchange", () => this.onRouteChange());
    this.onRouteChange();

    if (getToken()) {
      await this.bootstrapSession();
    } else {
      this.showAuth("Sign in to continue.");
    }
  }

  applyPrefs() {
    this.root.classList.toggle("sidebar-collapsed", !!this.prefs.sidebarCollapsed);
    this.root.classList.toggle("sidebar-expanded", !this.prefs.sidebarCollapsed);
    this.setDebugEnabled(!!this.prefs.debugEnabled, { persist: false });
    this.setSoundEnabled(!!this.prefs.soundEnabled, { persist: false });
    this.setSoundVolume(Number(this.prefs.soundVolume ?? 0.08), { persist: false });
  }

  savePrefs() {
    storageSet(PREFS_KEY, this.prefs);
  }

  wireShell() {
    $("#sidebarToggle").addEventListener("click", () => {
      this.prefs.sidebarCollapsed = !this.root.classList.contains("sidebar-collapsed");
      this.root.classList.toggle("sidebar-collapsed", this.prefs.sidebarCollapsed);
      this.root.classList.toggle("sidebar-expanded", !this.prefs.sidebarCollapsed);
      this.savePrefs();
    });
    $$("[data-route]", $("#sidebarNav")).forEach((btn) => {
      btn.addEventListener("click", () => this.navigate(btn.dataset.route));
    });
  }

  mountScreens() {
    const registry = [
      new PlayScreen(this.ctx),
      new ArenaScreen(this.ctx),
      new MiniGamesScreen(this.ctx),
      new MessagesScreen(this.ctx),
      new HubScreen(this.ctx),
      new LeaderboardScreen(this.ctx),
      new SettingsScreen(this.ctx),
    ];
    for (const screen of registry) {
      this.screens.set(screen.id, screen);
      const root = screen.mount();
      root.classList.add("hidden");
      this.screenHost.appendChild(root);
    }
  }

  bindWS() {
    this.ws.onAny((msg) => {
      this.debugState.lastEventType = msg.type || this.debugState.lastEventType;
      if (msg.type === "_ws_status") {
        this.debugState.wsState = msg.state;
        this.debugState.pingMs = msg.ping_ms ?? this.debugState.pingMs;
        this.renderWSStatus();
        this.updateDebugOverlay();
        if (!this.me) return;
        if (msg.state === "connecting" || msg.state === "reconnecting") this.setScreenLoading("Connecting…", true);
        if (msg.hello_ready) this.setScreenLoading("", false);
      }
      if (msg.type && msg.type !== "_ws_status") this.updateDebugOverlay();

      // Fan out to screens (lets background screens keep caches in sync).
      for (const screen of this.screens.values()) {
        if (typeof screen.onEvent === "function") {
          try { screen.onEvent(msg); } catch (e) { console.error("Screen onEvent error", screen.id, e); }
        }
      }
    });

    this.ws.on("hello_ok", (m) => {
      this.me = m.me;
      this.updateUserChip();
      this.hideAuth();
      this.setScreenLoading("", false);
      if (m.server?.boss_enabled !== undefined) {
        this.serverHintText.textContent = `Boss ${m.server.boss_enabled ? "on" : "off"}`;
      }
    });
    this.ws.on("presence", (m) => {
      this.state.lobby.online = m.online || [];
    });
    this.ws.on("lobby_state", (m) => {
      this.state.lobby = m;
      const ips = (m.server?.local_ips || []).join(", ");
      this.serverHintText.textContent = ips ? `LAN ${ips}` : "Cortisol Arcade";
    });
    this.ws.on("queue_status", (m) => {
      this.state.queue = m.active ? m : null;
    });
    this.ws.on("match_found", (m) => {
      this.lastMatchFound = m;
      this.notify.pushMatchFound(m);
      this.setScreenLoading("Match found", true);
      const target = m.kind === "arena" ? "arena" : m.kind;
      setTimeout(() => {
        this.navigate(target, { room: m.room_id });
        this.setScreenLoading("", false);
      }, 650);
    });
    this.ws.on("dm_new", (m) => {
      if (!this.me) return;
      const activeMessages = this.activeScreen?.id === "messages";
      const activeThread = this.screens.get("messages")?.activeThreadId || null;
      this.notify.pushDM(m.message, {
        myUserId: this.me.id,
        activeMessagesOpen: activeMessages,
        activeThreadId: activeThread,
      });
    });
    this.ws.on("hub_new_post", (m) => {
      if (!this.me) return;
      const hubOpen = this.activeScreen?.id === "hub";
      const own = Number(m.post?.user_id) === Number(this.me.id);
      this.notify.pushHubPost(m.post, { hubOpen, ownPost: own });
    });
    this.ws.on("announcement", (m) => this.notify.pushAnnouncement(m.text || "Announcement"));
    this.ws.on("room_error", () => this.notify.toast("Room error", { tone: "error" }));
    this.ws.on("error", (m) => {
      const err = m.error || "error";
      if (err === "unknown_message_type") return;
      this.notify.toast(`Error: ${err}`, { tone: "error" });
      if (err === "bad_token" || err === "hello_first") {
        // Try to re-bootstrap once if token exists.
        if (getToken()) this.bootstrapSession();
      }
    });
    this.ws.on("kicked", () => {
      this.notify.toast("Disconnected by moderator", { tone: "error" });
      this.navigate("play");
    });
    this.ws.on("moderation", (m) => {
      if (m.kind === "mute") this.notify.toast("Muted", { tone: "error" });
      if (m.kind === "ban") this.notify.toast("Banned", { tone: "error" });
    });
  }

  renderWSStatus() {
    const state = this.debugState.wsState;
    this.wsStatusText.textContent = state;
    if (state === "open") this.wsDot.style.background = "var(--warn)";
    if (state === "connecting" || state === "reconnecting") this.wsDot.style.background = "var(--warn)";
    if (this.ws.helloReady) this.wsDot.style.background = "var(--success)";
    if (state === "closed" || state === "idle") this.wsDot.style.background = "var(--danger)";
  }

  updateUserChip() {
    if (!this.me) {
      this.userChipLabel.textContent = "Guest";
      return;
    }
    this.userChipLabel.textContent = `${this.me.display_name} · @${this.me.username}`;
  }

  setTopbar(title, subtitle = "") {
    $("#screenTitle").textContent = title;
    $("#screenSubtitle").textContent = subtitle || "";
  }

  setScreenLoading(text, show) {
    if (text) this.screenLoadingText.textContent = text;
    this.screenLoading.classList.toggle("show", !!show);
  }

  updateSidebarBadges() {
    this.notify.render();
  }

  updateSidebarActive() {
    const active = routeGroup(this.route.name);
    $$("[data-route]", $("#sidebarNav")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.route === active);
    });
  }

  async bootstrapSession() {
    this.setScreenLoading("Connecting…", true);
    try {
      const meRes = await api("/api/me");
      this.me = meRes.me;
      this.updateUserChip();
      this.hideAuth();
      this.ws.connect();
      const helloOk = await this.ws.waitForHello(5000);
      if (!helloOk) {
        this.setScreenLoading("Connecting…", true);
      } else {
        this.setScreenLoading("", false);
      }
    } catch (e) {
      console.warn("bootstrapSession failed", e);
      this.handleLogout({ silent: true });
      this.showAuth("Sign in to continue.");
      this.setScreenLoading("", false);
    }
  }

  bindAuthForms() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      this.setAuthStatus("Signing in…", "info");
      try {
        const res = await api("/api/login", {
          method: "POST",
          json: {
            username: $("#loginUsername").value,
            password: $("#loginPassword").value,
          },
        });
        setToken(res.token);
        this.setAuthStatus("Signed in", "success");
        await this.bootstrapSession();
      } catch (err) {
        this.setAuthStatus(`Login failed: ${err.payload?.error || err.message}`, "error");
      }
    });

    $("#registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      this.setAuthStatus("Creating account…", "info");
      try {
        const res = await api("/api/register", {
          method: "POST",
          json: {
            username: $("#regUsername").value,
            display_name: $("#regDisplayName").value,
            password: $("#regPassword").value,
            bootstrap_secret: $("#regSecret").value,
          },
        });
        setToken(res.token);
        this.setAuthStatus("Account created", "success");
        await this.bootstrapSession();
      } catch (err) {
        this.setAuthStatus(`Register failed: ${err.payload?.error || err.message}`, "error");
      }
    });
  }

  setAuthStatus(text, tone = "info") {
    this.authStatus.className = `status ${tone}`;
    this.authStatus.textContent = text;
  }

  showAuth(text) {
    this.authOverlay.classList.remove("hidden");
    this.setAuthStatus(text || "Sign in to continue.", "info");
  }

  hideAuth() {
    this.authOverlay.classList.add("hidden");
  }

  handleLogout({ silent = false } = {}) {
    clearToken();
    this.me = null;
    this.lastMatchFound = null;
    this.updateUserChip();
    this.ws.disconnect({ reconnect: false });
    this.showAuth("Sign in to continue.");
    if (!silent) this.notify.toast("Logged out", { tone: "info" });
  }

  navigate(route, params = {}) {
    const name = route.replace(/^#?\/?/, "");
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
    });
    const hash = `#/${name}${search.toString() ? `?${search.toString()}` : ""}`;
    if (location.hash === hash) {
      this.onRouteChange();
    } else {
      location.hash = hash;
    }
  }

  onRouteChange() {
    const parsed = parseHash();
    if (!this.screens.has(routeGroup(parsed.name)) && !["arena", "chess", "pong", "reaction", "typing"].includes(parsed.name)) {
      this.navigate("play");
      return;
    }
    this.route = parsed;
    this.updateSidebarActive();
    this.activateScreenForRoute(parsed);
  }

  async activateScreenForRoute(route) {
    let screenId = routeGroup(route.name);
    if (["chess", "pong", "reaction", "typing"].includes(route.name)) screenId = "minigames";
    const next = this.screens.get(screenId);
    if (!next) return;

    if (this.activeScreen && this.activeScreen !== next) {
      try { await this.activeScreen.hide?.(); } catch (e) { console.error(e); }
      this.activeScreen.root.classList.add("hidden");
    }
    this.activeScreen = next;
    next.root.classList.remove("hidden");

    if (this.me && (!this.ws.ws || this.ws.ws.readyState !== WebSocket.OPEN || !this.ws.helloReady)) {
      this.setScreenLoading("Connecting…", true);
      this.ws.connect();
    }
    try {
      await next.show?.(route);
    } catch (e) {
      console.error("Screen show failed", next.id, e);
      this.notify.toast(`Screen error: ${next.id}`, { tone: "error" });
    }
    if (routeGroup(route.name) === "hub") this.notify.markHubRead();
  }

  setDebugEnabled(enabled, { persist = true } = {}) {
    this.prefs.debugEnabled = !!enabled;
    this.debugOverlay.classList.toggle("hidden", !this.prefs.debugEnabled);
    this.updateDebugOverlay();
    if (persist) this.savePrefs();
  }

  setSoundEnabled(enabled, { persist = true } = {}) {
    this.prefs.soundEnabled = !!enabled;
    audio.setEnabled(!!enabled);
    if (persist) this.savePrefs();
  }

  setSoundVolume(volume, { persist = true } = {}) {
    this.prefs.soundVolume = Math.max(0, Math.min(0.3, Number(volume) || 0.08));
    audio.setVolume(this.prefs.soundVolume);
    if (persist) this.savePrefs();
  }

  updateDebugOverlay() {
    if (this.debugOverlay.classList.contains("hidden")) return;
    this.debugOverlay.innerHTML = `
      <div><strong>Debug</strong></div>
      <div>WS: ${escapeHtml(this.debugState.wsState || "-")}</div>
      <div>Hello: ${this.ws.helloReady ? "yes" : "no"}</div>
      <div>Ping: ${this.debugState.pingMs != null ? `${this.debugState.pingMs} ms` : "-"}</div>
      <div>Last: ${escapeHtml(this.debugState.lastEventType || "-")}</div>
      <div>Route: ${escapeHtml(this.route?.name || "-")}</div>
      <div>User: ${escapeHtml(this.me?.username || "-")}</div>
    `;
  }
}

let app = null;
window.addEventListener("DOMContentLoaded", async () => {
  app = new App();
  await app.init();
});
