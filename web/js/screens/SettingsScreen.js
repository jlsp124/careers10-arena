import { api, clearToken } from "../net.js";
import { $, createEl, escapeHtml, storageGet, storageSet } from "../ui.js";

export class SettingsScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "settings";
    this.title = "Settings";
    this.root = null;
    this.configLoaded = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><h2 class="screen-title">Settings</h2></div>
          <div class="card-body col">
            <div id="settingsUserRow" class="list-row"></div>
            <label class="row">
              <input id="debugToggle" type="checkbox" style="width:auto">
              <span>Debug overlay</span>
            </label>
            <label class="row">
              <input id="soundToggle" type="checkbox" style="width:auto">
              <span>Enable sound</span>
            </label>
            <label>Sound volume
              <input id="soundVolume" type="range" min="0" max="0.3" step="0.01">
            </label>
            <button id="logoutBtn" class="btn danger" type="button">Logout</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="section-title">Connection</h3></div>
          <div class="card-body col">
            <div class="status info"><strong>WS:</strong> <span id="wsStateVal">-</span></div>
            <div class="status info"><strong>Ping:</strong> <span id="pingVal">-</span></div>
            <div class="status info"><strong>Last Event:</strong> <span id="lastEventVal">-</span></div>
            <div id="serverCfgBox" class="status info">Loading config…</div>
          </div>
        </div>
      </div>
    `;

    $("#debugToggle", this.root).addEventListener("change", (e) => {
      this.ctx.setDebugEnabled(!!e.target.checked);
    });
    $("#soundToggle", this.root).addEventListener("change", (e) => {
      this.ctx.setSoundEnabled(!!e.target.checked);
    });
    $("#soundVolume", this.root).addEventListener("input", (e) => {
      this.ctx.setSoundVolume(Number(e.target.value));
    });
    $("#logoutBtn", this.root).addEventListener("click", async () => {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      clearToken();
      this.ctx.onLoggedOut();
    });

    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    this.renderUser();
    this.renderConnection();
    $("#debugToggle", this.root).checked = !!this.ctx.debugEnabled;
    $("#soundToggle", this.root).checked = !!this.ctx.soundEnabled;
    $("#soundVolume", this.root).value = String(this.ctx.soundVolume ?? 0.08);
    if (!this.configLoaded) await this.loadConfig();
  }

  hide() {}

  renderUser() {
    const me = this.ctx.me;
    const roleBadge = me?.is_admin ? `<span class="badge role">Role: Admin</span>` : `<span class="badge">Role: Player</span>`;
    $("#settingsUserRow", this.root).innerHTML = `
      <div class="stretch">
        <div><strong>${escapeHtml(me?.display_name || "-")}</strong></div>
        <div class="tiny muted">@${escapeHtml(me?.username || "-")}</div>
      </div>
      ${roleBadge}
    `;
  }

  renderConnection() {
    $("#wsStateVal", this.root).textContent = this.ctx.debugState.wsState || "idle";
    $("#pingVal", this.root).textContent = this.ctx.debugState.pingMs != null ? `${this.ctx.debugState.pingMs} ms` : "-";
    $("#lastEventVal", this.root).textContent = this.ctx.debugState.lastEventType || "-";
  }

  async loadConfig() {
    try {
      const res = await api("/api/config");
      const c = res.config || {};
      $("#serverCfgBox", this.root).className = "status success";
      $("#serverCfgBox", this.root).textContent = `Uploads: ${c.max_upload_mb} MB · Retention: ${c.retention_hours}h · Storage: ${c.max_total_storage_gb} GB`;
      this.configLoaded = true;
    } catch (e) {
      $("#serverCfgBox", this.root).className = "status error";
      $("#serverCfgBox", this.root).textContent = `Config failed: ${e.message}`;
    }
  }

  onEvent(msg) {
    if (msg.type === "_ws_status") this.renderConnection();
  }
}

