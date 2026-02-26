import { buildHashUrl, copyToClipboard } from "../net.js";
import { $, $$, createEl, escapeHtml } from "../ui.js";

const QUICKS = [
  { key: "arena:duel", label: "Quick Arena Duel", kind: "arena", mode: "duel", route: "arena" },
  { key: "arena:ffa", label: "Quick Arena FFA", kind: "arena", mode: "ffa", route: "arena" },
  { key: "typing:1v1", label: "Quick Typing Duel", kind: "typing", mode: "1v1", route: "typing" },
  { key: "pong:1v1", label: "Quick Pong", kind: "pong", mode: "1v1", route: "pong" },
  { key: "reaction:1v1", label: "Quick Reaction", kind: "reaction", mode: "1v1", route: "reaction" },
  { key: "chess:1v1", label: "Quick Chess", kind: "chess", mode: "1v1", route: "chess" },
];

export class PlayScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "play";
    this.title = "Play";
    this.root = null;
    this.queue = null; // {kind, mode, position, size, active}
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="screen-title">Play</h2>
              <p class="helper">Quick Play</p>
            </div>
          </div>
          <div class="card-body">
            <div id="quickPlayGrid" class="grid"></div>
            <div id="queueBox" class="queue-card hidden" style="margin-top:16px;">
              <div class="row space">
                <strong id="queueLabel">Queue</strong>
                <button id="queueCancelBtn" class="btn ghost" type="button">Cancel</button>
              </div>
              <div class="row wrap" style="margin-top:8px;">
                <span class="badge">Position <span id="queuePos">-</span></span>
                <span class="badge">Size <span id="queueSize">-</span></span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Private Match</h3>
              <p class="helper">Create or join a room</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row wrap">
              <label class="stretch">Game
                <select id="manualKind">
                  <option value="arena">Arena</option>
                  <option value="chess">Chess</option>
                  <option value="pong">Pong</option>
                  <option value="reaction">Reaction</option>
                  <option value="typing">Typing</option>
                </select>
              </label>
              <label class="stretch">Mode
                <select id="manualMode">
                  <option value="duel">Arena Duel</option>
                  <option value="ffa">Arena FFA</option>
                  <option value="teams">Arena Teams</option>
                  <option value="boss">Arena Boss</option>
                  <option value="1v1">Mini-Game 1v1</option>
                </select>
              </label>
            </div>
            <label>Room ID <input id="manualRoomId" value="room"></label>
            <div class="row wrap">
              <button id="manualOpenBtn" class="btn primary" type="button">Open</button>
              <button id="manualCopyBtn" class="btn secondary" type="button">Copy Link</button>
            </div>
            <div id="playStatus" class="status info">Ready</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="section-title">Active Rooms</h3>
            <p class="helper">Live</p>
          </div>
          <button id="playRefreshLobbyBtn" class="btn ghost" type="button">Refresh</button>
        </div>
        <div class="card-body">
          <div id="playRoomsList" class="list"></div>
        </div>
      </div>
    `;

    const grid = $("#quickPlayGrid", this.root);
    grid.innerHTML = QUICKS.map((q) => `
      <button class="btn primary" type="button" data-quick="${q.key}" style="justify-content:flex-start;">${q.label}</button>
    `).join("");
    $$("[data-quick]", grid).forEach((btn) => btn.addEventListener("click", () => {
      const q = QUICKS.find((x) => x.key === btn.dataset.quick);
      if (!q) return;
      this.joinQueue(q.kind, q.mode);
    }));

    $("#queueCancelBtn", this.root).addEventListener("click", () => {
      if (!this.queue) return;
      this.ctx.ws.send({ type: "queue_leave", kind: this.queue.kind, mode: this.queue.mode });
    });
    $("#playRefreshLobbyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "get_lobby" }));
    $("#manualOpenBtn", this.root).addEventListener("click", () => this.openManual());
    $("#manualCopyBtn", this.root).addEventListener("click", () => this.copyManual());
    $("#manualKind", this.root).addEventListener("change", () => this.syncManualModeOptions());

    this.syncManualModeOptions();
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    this.renderLobbyRooms();
    this.renderQueue();
    this.ctx.ws.send({ type: "get_lobby" });
  }

  hide() {}

  syncManualModeOptions() {
    const kind = $("#manualKind", this.root).value;
    const modeSel = $("#manualMode", this.root);
    if (kind === "arena") {
      modeSel.innerHTML = `
        <option value="duel">Duel</option>
        <option value="ffa">FFA</option>
        <option value="teams">Teams</option>
        <option value="boss">Boss</option>
        <option value="practice">Practice</option>
      `;
    } else {
      modeSel.innerHTML = `<option value="1v1">1v1</option>`;
    }
  }

  joinQueue(kind, mode) {
    this.ctx.setScreenLoading("Queueing…", true);
    this.ctx.ws.send({ type: "queue_join", kind, mode });
    setTimeout(() => this.ctx.setScreenLoading("", false), 350);
  }

  manualRoute() {
    const kind = $("#manualKind", this.root).value;
    const mode = $("#manualMode", this.root).value;
    const room = ($("#manualRoomId", this.root).value || "room").trim().toLowerCase() || "room";
    if (kind === "arena") return { route: "arena", params: { room, mode, seconds: 90 } };
    if (kind === "chess") return { route: "chess", params: { room } };
    return { route: kind, params: { room } };
  }

  openManual() {
    const { route, params } = this.manualRoute();
    this.ctx.navigate(route, params);
  }

  copyManual() {
    const { route, params } = this.manualRoute();
    copyToClipboard(buildHashUrl(route, params)).then(() => this.ctx.notify.toast("Link copied", { tone: "success" }));
  }

  renderQueue() {
    const box = $("#queueBox", this.root);
    if (!this.queue?.active) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    $("#queueLabel", this.root).textContent = `${this.queue.kind} · ${this.queue.mode}`;
    $("#queuePos", this.root).textContent = this.queue.position ?? "-";
    $("#queueSize", this.root).textContent = this.queue.size ?? "-";
  }

  renderLobbyRooms() {
    const rows = this.ctx.state?.lobby?.rooms || [];
    const list = $("#playRoomsList", this.root);
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">No active rooms</div>`;
      return;
    }
    list.innerHTML = rows.map((r) => `
      <div class="list-row">
        <div class="stretch">
          <div class="row wrap">
            <span class="badge">${escapeHtml(r.kind)}${r.mode_name ? ` · ${escapeHtml(r.mode_name)}` : ""}</span>
            <span class="tiny muted">${escapeHtml(r.state || "")}</span>
          </div>
          <div><strong>${escapeHtml(r.room_id)}</strong></div>
          <div class="tiny muted">Players ${r.player_count} · Spectators ${r.spectator_count}</div>
        </div>
        <div class="row">
          <button class="btn ghost" type="button" data-copy-room="${r.room_key}">Copy</button>
          <button class="btn secondary" type="button" data-join-room="${r.room_key}">Join</button>
        </div>
      </div>
    `).join("");
    $$("[data-copy-room]", list).forEach((btn) => btn.addEventListener("click", () => {
      const room = rows.find((r) => r.room_key === btn.dataset.copyRoom);
      if (!room) return;
      let route = "play"; let params = {};
      if (room.kind === "arena") { route = "arena"; params = { room: room.room_id, mode: room.mode_name || "ffa" }; }
      else if (room.kind === "chess") { route = "chess"; params = { room: room.room_id }; }
      else { route = room.kind; params = { room: room.room_id }; }
      copyToClipboard(buildHashUrl(route, params)).then(() => this.ctx.notify.toast("Link copied", { tone: "success" }));
    }));
    $$("[data-join-room]", list).forEach((btn) => btn.addEventListener("click", () => {
      const room = rows.find((r) => r.room_key === btn.dataset.joinRoom);
      if (!room) return;
      if (room.kind === "arena") this.ctx.navigate("arena", { room: room.room_id, mode: room.mode_name || "ffa" });
      else if (room.kind === "chess") this.ctx.navigate("chess", { room: room.room_id });
      else this.ctx.navigate(room.kind, { room: room.room_id });
    }));
  }

  onEvent(msg) {
    if (msg.type === "queue_status") {
      this.queue = msg.active ? { ...msg } : null;
      this.renderQueue();
      if (msg.active) this.ctx.notify.toast(`Queue ${msg.kind} ${msg.mode}: #${msg.position}`, { tone: "info", timeout: 1200 });
    }
    if (msg.type === "match_found") {
      this.queue = null;
      this.renderQueue();
    }
    if (msg.type === "lobby_state") this.renderLobbyRooms();
  }
}

