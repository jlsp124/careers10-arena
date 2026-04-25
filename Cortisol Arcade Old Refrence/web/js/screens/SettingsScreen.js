import { api, clearToken } from "../net.js";
import { $, createEl, escapeHtml } from "../ui.js";

export class SettingsScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "settings";
    this.title = "Settings";
    this.root = null;
    this.configLoaded = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel settings-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Settings</h2>
          <p>Account preferences, audio, debugging, and connection health for the local client.</p>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Account</span>
          <strong id="settingsAccountName" class="stat-value">-</strong>
          <span id="settingsAccountNote" class="stat-note">Signed-out state</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Debug overlay</span>
          <strong id="settingsDebugState" class="stat-value">Off</strong>
          <span class="stat-note">Client diagnostics visibility</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Sound</span>
          <strong id="settingsSoundState" class="stat-value">Off</strong>
          <span id="settingsSoundNote" class="stat-note">Volume 0.08</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">WebSocket</span>
          <strong id="settingsWsState" class="stat-value">idle</strong>
          <span id="settingsWsNote" class="stat-note">Waiting for connection state</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Account</h3>
              <p class="helper">Current profile and local session actions.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="settingsUserRow" class="detail-card"></div>
            <button id="logoutBtn" class="btn danger" type="button">Logout</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Preferences</h3>
              <p class="helper">Audio and debug options stored in local preferences.</p>
            </div>
          </div>
          <div class="panel-body form-stack">
            <label class="row">
              <input id="debugToggle" type="checkbox" style="width:auto">
              <span>Show debug overlay</span>
            </label>
            <label class="row">
              <input id="soundToggle" type="checkbox" style="width:auto">
              <span>Enable sound</span>
            </label>
            <label>Sound volume
              <input id="soundVolume" type="range" min="0" max="0.3" step="0.01">
            </label>
          </div>
        </section>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Connection</h3>
              <p class="helper">Live client state from the current websocket session.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="detail-card">
              <div class="detail-row"><span class="muted">Host</span><strong id="hostUrlVal">-</strong></div>
              <div class="detail-row"><span class="muted">WS state</span><strong id="wsStateVal">-</strong></div>
              <div class="detail-row"><span class="muted">Ping</span><strong id="pingVal">-</strong></div>
              <div class="detail-row"><span class="muted">Last event</span><strong id="lastEventVal">-</strong></div>
            </div>
            <button id="changeHostBtn" class="btn secondary" type="button">Change Host</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Server config</h3>
              <p class="helper">Current upload and retention policy surfaced by the backend.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="serverCfgBox" class="status info">Loading config...</div>
          </div>
        </section>
      </div>
    `;

    $("#debugToggle", this.root).addEventListener("change", (event) => this.ctx.setDebugEnabled(!!event.target.checked));
    $("#soundToggle", this.root).addEventListener("change", (event) => this.ctx.setSoundEnabled(!!event.target.checked));
    $("#soundVolume", this.root).addEventListener("input", (event) => this.ctx.setSoundVolume(Number(event.target.value)));
    $("#changeHostBtn", this.root).addEventListener("click", () => this.ctx.showClientLauncher("Choose a Cortisol Host.", "info"));
    $("#logoutBtn", this.root).addEventListener("click", async () => {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      clearToken();
      this.ctx.onLoggedOut();
    });
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Preferences and diagnostics");
    this.ctx.setGlobalSearchValue("");
    $("#debugToggle", this.root).checked = !!this.ctx.debugEnabled;
    $("#soundToggle", this.root).checked = !!this.ctx.soundEnabled;
    $("#soundVolume", this.root).value = String(this.ctx.soundVolume ?? 0.08);
    this.render();
    if (!this.configLoaded) await this.loadConfig();
  }

  hide() {}

  render() {
    this.renderUser();
    this.renderConnection();
    this.renderSummary();
    this.renderInspector();
  }

  renderSummary() {
    const me = this.ctx.me;
    $("#settingsAccountName", this.root).textContent = me?.display_name || "-";
    $("#settingsAccountNote", this.root).textContent = me ? `@${me.username}` : "Signed-out state";
    $("#settingsDebugState", this.root).textContent = this.ctx.debugEnabled ? "On" : "Off";
    $("#settingsSoundState", this.root).textContent = this.ctx.soundEnabled ? "On" : "Off";
    $("#settingsSoundNote", this.root).textContent = `Volume ${(Number(this.ctx.soundVolume || 0) || 0).toFixed(2)}`;
    $("#settingsWsState", this.root).textContent = this.ctx.debugState.wsState || "idle";
    $("#settingsWsNote", this.root).textContent = this.ctx.debugState.pingMs != null
      ? `${this.ctx.debugState.pingMs} ms`
      : "Waiting for connection state";
  }

  renderUser() {
    const me = this.ctx.me;
    $("#settingsUserRow", this.root).innerHTML = `
      <div class="detail-row"><span class="muted">Display name</span><strong>${escapeHtml(me?.display_name || "-")}</strong></div>
      <div class="detail-row"><span class="muted">Username</span><strong>@${escapeHtml(me?.username || "-")}</strong></div>
      <div class="detail-row"><span class="muted">Wins</span><strong>${escapeHtml(String(me?.stats?.wins || 0))}</strong></div>
      <div class="detail-row"><span class="muted">Cortisol</span><strong>${escapeHtml(String(me?.stats?.cortisol || 0))}</strong></div>
    `;
  }

  renderConnection() {
    $("#hostUrlVal", this.root).textContent = this.ctx.clientProfile?.hostUrl || location.origin + "/";
    $("#wsStateVal", this.root).textContent = this.ctx.debugState.wsState || "idle";
    $("#pingVal", this.root).textContent = this.ctx.debugState.pingMs != null ? `${this.ctx.debugState.pingMs} ms` : "-";
    $("#lastEventVal", this.root).textContent = this.ctx.debugState.lastEventType || "-";
  }

  async loadConfig() {
    try {
      const res = await api("/api/config");
      const cfg = res.config || {};
      $("#serverCfgBox", this.root).className = "status success";
      $("#serverCfgBox", this.root).textContent = `Uploads ${cfg.max_upload_mb} MB | Retention ${cfg.retention_hours}h | Storage ${cfg.max_total_storage_gb} GB`;
      this.configLoaded = true;
    } catch (error) {
      $("#serverCfgBox", this.root).className = "status error";
      $("#serverCfgBox", this.root).textContent = `Config failed: ${error.message}`;
    }
  }

  renderInspector() {
    this.ctx.setInspector({
      title: "Settings detail",
      subtitle: "Preference state and quick links",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Debug overlay</span><strong>${this.ctx.debugEnabled ? "On" : "Off"}</strong></div>
          <div class="detail-row"><span class="muted">Sound</span><strong>${this.ctx.soundEnabled ? "On" : "Off"}</strong></div>
          <div class="detail-row"><span class="muted">Volume</span><strong>${(Number(this.ctx.soundVolume || 0) || 0).toFixed(2)}</strong></div>
        </div>
      `,
    });
  }

  onEvent(msg) {
    if (msg.type === "_ws_status") {
      this.render();
    }
  }
}
