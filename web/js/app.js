import { audio } from "./audio.js";
import { api, clearToken, getToken, getWS, setToken } from "./net.js";
import { NotifyCenter } from "./notify.js";
import { ArenaScreen } from "./screens/ArenaScreen.js";
import { ExplorerScreen } from "./screens/ExplorerScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { HubScreen } from "./screens/HubScreen.js";
import { LeaderboardScreen } from "./screens/LeaderboardScreen.js";
import { MarketScreen } from "./screens/MarketScreen.js";
import { MessagesScreen } from "./screens/MessagesScreen.js";
import { MiniGamesScreen } from "./screens/MiniGamesScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { buildHash, isKnownRoute, parseHash, QUICK_ROUTE_LOOKUP, routeGroup, screenIdForRoute } from "./routes.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { TokenCreateScreen } from "./screens/TokenCreateScreen.js";
import { WalletScreen } from "./screens/WalletScreen.js";
import { $, $$, escapeHtml, storageGet, storageSet } from "./ui.js";

const PREFS_KEY = "cortisol_arcade_prefs";

function extractQuickSearch(raw) {
  return raw.replace(/^[^:\s]+[:\s]*/, "").trim();
}

class App {
  constructor() {
    this.root = $("#appRoot");
    this.sidebar = $("#shellSidebar");
    this.screenHost = $("#screenHost");
    this.screenLoading = $("#screenLoading");
    this.screenLoadingText = $("#screenLoadingText");
    this.authOverlay = $("#authOverlay");
    this.authStatus = $("#authStatus");
    this.wsDot = $("#wsDot");
    this.wsStatusText = $("#wsStatusText");
    this.serverHintText = $("#serverHintText");
    this.topbarNetLabel = $("#topbarNetLabel");
    this.userChipLabel = $("#userChipLabel");
    this.debugOverlay = $("#debugOverlay");
    this.globalSearchInput = $("#globalSearchInput");
    this.inspector = {
      root: $("#shellInspector"),
      title: $("#inspectorTitle"),
      subtitle: $("#inspectorSubtitle"),
      content: $("#inspectorContent"),
    };

    this.ws = getWS();
    this.notify = new NotifyCenter({ root: document });
    this.state = { lobby: { rooms: [], online: [], queues: {} }, queue: null };
    this.route = { name: "home", params: {} };
    this.activeScreen = null;
    this.screens = new Map();
    this.me = null;
    this.lastMatchFound = null;
    this.prefs = storageGet(PREFS_KEY, {
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
      refreshMe: async () => this.refreshMe(),
      setTopbar: (title, subtitle) => this.setTopbar(title, subtitle),
      setScreenLoading: (text, show) => this.setScreenLoading(text, show),
      navigate: (route, params) => this.navigate(route, params),
      onLoggedOut: () => this.handleLogout(),
      isScreenActive: (screen) => this.activeScreen === screen,
      setDebugEnabled: (enabled) => this.setDebugEnabled(enabled),
      setSoundEnabled: (enabled) => this.setSoundEnabled(enabled),
      setSoundVolume: (volume) => this.setSoundVolume(volume),
      setInspector: (config) => this.setInspector(config),
      clearInspector: () => this.setInspector(null),
      setGlobalSearchValue: (value) => this.setGlobalSearchValue(value),
    };
    window.app = this;
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
    if (getToken()) await this.bootstrapSession();
    else this.showAuth("Sign in to continue.");
  }

  applyPrefs() {
    this.setDebugEnabled(!!this.prefs.debugEnabled, { persist: false });
    this.setSoundEnabled(!!this.prefs.soundEnabled, { persist: false });
    this.setSoundVolume(Number(this.prefs.soundVolume ?? 0.08), { persist: false });
  }

  savePrefs() {
    storageSet(PREFS_KEY, this.prefs);
  }

  wireShell() {
    $("#sidebarToggle")?.addEventListener("click", () => {
      this.root.classList.toggle("sidebar-open");
    });

    $$("[data-route]", $("#sidebarNav")).forEach((button) => {
      button.addEventListener("click", () => {
        this.root.classList.remove("sidebar-open");
        this.navigate(button.dataset.route);
      });
    });

    $("#globalSearchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleGlobalSearch();
    });

    $("#quickMessageBtn")?.addEventListener("click", () => this.navigate("messages"));
    $("#quickTokenBtn")?.addEventListener("click", () => this.navigate("create-token"));
    $("#inspectorCloseBtn")?.addEventListener("click", () => this.setInspector(null));

    document.addEventListener("click", (event) => {
      if (window.innerWidth > 820 || !this.root.classList.contains("sidebar-open")) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.sidebar?.contains(target) || $("#sidebarToggle")?.contains(target)) return;
      this.root.classList.remove("sidebar-open");
    });
  }

  mountScreens() {
    const registry = [
      new HomeScreen(this.ctx),
      new PlayScreen(this.ctx),
      new ArenaScreen(this.ctx),
      new WalletScreen(this.ctx),
      new MarketScreen(this.ctx),
      new TokenCreateScreen(this.ctx),
      new ExplorerScreen(this.ctx),
      new LeaderboardScreen(this.ctx),
      new SettingsScreen(this.ctx),
      new MiniGamesScreen(this.ctx),
      new MessagesScreen(this.ctx),
      new HubScreen(this.ctx),
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
        if (msg.state === "connecting" || msg.state === "reconnecting") this.setScreenLoading("Connecting...", true);
        if (msg.hello_ready) this.setScreenLoading("", false);
      }
      if (msg.type && msg.type !== "_ws_status") this.updateDebugOverlay();
      for (const screen of this.screens.values()) {
        if (typeof screen.onEvent === "function") {
          try {
            screen.onEvent(msg);
          } catch (error) {
            console.error("Screen onEvent error", screen.id, error);
          }
        }
      }
    });

    this.ws.on("hello_ok", (msg) => {
      this.me = msg.me;
      this.updateUserChip();
      this.hideAuth();
      this.setScreenLoading("", false);
      this.updateServerState(msg.server);
    });
    this.ws.on("presence", (msg) => {
      this.state.lobby.online = msg.online || [];
    });
    this.ws.on("lobby_state", (msg) => {
      this.state.lobby = msg;
      this.updateServerState(msg.server);
    });
    this.ws.on("server_flag", (msg) => this.updateServerState(msg));
    this.ws.on("queue_status", (msg) => {
      this.state.queue = msg.active ? msg : null;
    });
    this.ws.on("match_found", (msg) => {
      this.lastMatchFound = msg;
      this.notify.pushMatchFound(msg);
      this.setScreenLoading("Starting...", true);
      const target = msg.kind === "arena" ? "arena" : msg.kind;
      setTimeout(() => {
        this.navigate(target, { room: msg.room_id });
        this.setScreenLoading("", false);
      }, 650);
    });
    this.ws.on("announcement", (msg) => this.notify.pushAnnouncement(msg.text || "Announcement"));
    this.ws.on("hub_new_post", (msg) => {
      if (!msg.post) return;
      this.notify.pushHubPost(msg.post, {
        hubOpen: routeGroup(this.route.name) === "hub",
        ownPost: Number(msg.post.user_id) === Number(this.me?.id),
      });
    });
    this.ws.on("dm_new", (msg) => {
      if (!msg.message) return;
      this.notify.pushDM(msg.message, {
        myUserId: this.me?.id,
        activeMessagesOpen: this.activeScreen?.id === "messages",
        activeThreadId: this.activeScreen?.activeThreadId || null,
      });
    });
    this.ws.on("room_error", () => this.notify.toast("Room error", { tone: "error" }));
    this.ws.on("error", (msg) => {
      const err = msg.error || "error";
      if (err === "unknown_message_type") return;
      this.notify.toast(`Error: ${err}`, { tone: "error" });
      if ((err === "bad_token" || err === "hello_first") && getToken()) this.bootstrapSession();
    });
    this.ws.on("kicked", () => {
      this.notify.toast("Session ended by the server", { tone: "error" });
      this.navigate("home");
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
    this.userChipLabel.textContent = `${this.me.display_name} | @${this.me.username}`;
  }

  updateServerState(server = {}) {
    let label = "Simulation layer";
    const ips = Array.isArray(server?.local_ips) ? server.local_ips.filter(Boolean) : [];
    if (ips.length) label = `Sim cluster ${ips.join(", ")}`;
    else if (server?.boss_enabled !== undefined) label = `Simnet ${server.boss_enabled ? "elevated" : "stable"}`;
    this.serverHintText.textContent = label;
    this.topbarNetLabel.textContent = label;
  }

  setTopbar(title, subtitle = "") {
    $("#screenTitle").textContent = title;
    $("#screenSubtitle").textContent = subtitle || "";
  }

  setScreenLoading(text, show) {
    if (text) this.screenLoadingText.textContent = text;
    this.screenLoading.classList.toggle("show", !!show);
  }

  setInspector(config = null) {
    if (!config) {
      this.inspector.root.classList.add("hidden");
      this.inspector.title.textContent = "Details";
      this.inspector.subtitle.textContent = "";
      this.inspector.content.innerHTML = "";
      return;
    }
    this.inspector.root.classList.remove("hidden");
    this.inspector.title.textContent = config.title || "Details";
    this.inspector.subtitle.textContent = config.subtitle || "";
    if (config.node instanceof Node) {
      this.inspector.content.replaceChildren(config.node);
    } else {
      this.inspector.content.innerHTML = config.content || "";
    }
  }

  setGlobalSearchValue(value = "") {
    if (this.globalSearchInput) this.globalSearchInput.value = value;
  }

  handleGlobalSearch() {
    const raw = (this.globalSearchInput?.value || "").trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (QUICK_ROUTE_LOOKUP.has(key)) {
      this.navigate(QUICK_ROUTE_LOOKUP.get(key));
      return;
    }
    if (key.startsWith("@")) {
      this.navigate("messages", { q: raw.slice(1) });
      return;
    }
    if (key.startsWith("wallet:") || key.startsWith("wallet ")) {
      this.navigate("explorer", { view: "wallets", q: extractQuickSearch(raw) });
      return;
    }
    if (key.startsWith("tx:") || key.startsWith("tx ")) {
      this.navigate("explorer", { view: "transactions", q: extractQuickSearch(raw) });
      return;
    }
    if (key.startsWith("block:") || key.startsWith("block ")) {
      this.navigate("explorer", { view: "blocks", q: extractQuickSearch(raw) });
      return;
    }
    if (key.startsWith("token:") || key.startsWith("token ")) {
      this.navigate("market", { q: extractQuickSearch(raw) });
      return;
    }
    this.navigate("market", { q: raw });
  }

  updateSidebarBadges() {
    this.notify.render();
  }

  updateSidebarActive() {
    const active = routeGroup(this.route.name);
    $$("[data-route]", $("#sidebarNav")).forEach((button) => {
      button.classList.toggle("active", button.dataset.route === active);
    });
  }

  async bootstrapSession() {
    this.setScreenLoading("Connecting...", true);
    try {
      const meRes = await api("/api/me");
      this.me = meRes.me;
      this.updateUserChip();
      this.hideAuth();
      this.ws.connect();
      const helloOk = await this.ws.waitForHello(5000);
      if (!helloOk) this.setScreenLoading("Connecting...", true);
      else this.setScreenLoading("", false);
    } catch (error) {
      console.warn("bootstrapSession failed", error);
      this.handleLogout({ silent: true });
      this.showAuth("Sign in to continue.");
      this.setScreenLoading("", false);
    }
  }

  async refreshMe() {
    if (!getToken()) return null;
    try {
      const meRes = await api("/api/me");
      this.me = meRes.me;
      this.updateUserChip();
      return this.me;
    } catch {
      return null;
    }
  }

  bindAuthForms() {
    $("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      this.setAuthStatus("Signing in...", "info");
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
      } catch (error) {
        this.setAuthStatus(`Login failed: ${error.payload?.error || error.message}`, "error");
      }
    });

    $("#registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      this.setAuthStatus("Creating account...", "info");
      try {
        const res = await api("/api/register", {
          method: "POST",
          json: {
            username: $("#regUsername").value,
            display_name: $("#regDisplayName").value,
            password: $("#regPassword").value,
          },
        });
        setToken(res.token);
        this.setAuthStatus("Account created", "success");
        await this.bootstrapSession();
      } catch (error) {
        this.setAuthStatus(`Register failed: ${error.payload?.error || error.message}`, "error");
      }
    });
  }

  setAuthStatus(text, tone = "info") {
    this.authStatus.className = `status ${tone}`;
    this.authStatus.textContent = text;
  }

  showAuth(text) {
    this.setScreenLoading("", false);
    this.root.classList.add("auth-locked");
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
    this.authOverlay.classList.remove("hidden");
    this.setAuthStatus(text || "Sign in to continue.", "info");
  }

  hideAuth() {
    this.root.classList.remove("auth-locked");
    this.root.removeAttribute("aria-hidden");
    this.root.inert = false;
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
    const hash = buildHash(route, params);
    if (location.hash === hash) this.onRouteChange();
    else location.hash = hash;
  }

  onRouteChange() {
    const parsed = parseHash();
    const canonicalHash = buildHash(parsed.name, parsed.params);
    if (location.hash !== canonicalHash) {
      location.replace(canonicalHash);
      return;
    }
    if (!isKnownRoute(parsed.name)) return;
    const screenId = screenIdForRoute(parsed.name);
    if (!this.screens.has(screenId)) {
      this.navigate("home");
      return;
    }
    this.route = parsed;
    this.root.classList.remove("sidebar-open");
    this.updateSidebarActive();
    this.activateScreenForRoute(parsed);
  }

  async activateScreenForRoute(route) {
    const next = this.screens.get(screenIdForRoute(route.name));
    if (!next) return;

    if (this.activeScreen && this.activeScreen !== next) {
      try {
        await this.activeScreen.hide?.();
      } catch (error) {
        console.error(error);
      }
      this.activeScreen.root.classList.add("hidden");
    }

    this.setInspector(null);
    this.activeScreen = next;
    next.root.classList.remove("hidden");

    if (this.me && (!this.ws.ws || this.ws.ws.readyState !== WebSocket.OPEN || !this.ws.helloReady)) {
      this.setScreenLoading("Connecting...", true);
      this.ws.connect();
    }
    try {
      await next.show?.(route);
    } catch (error) {
      console.error("Screen show failed", next.id, error);
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
