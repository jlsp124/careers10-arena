import { loadArenaCatalog } from "../arena_catalog.js";
import { $, $$, createEl, escapeHtml } from "../ui.js";

const PUBLIC_MODES = [
  { id: "duel", label: "Public Duel", detail: "2 players, stocks on, best-of rounds." },
  { id: "ffa", label: "Free-For-All", detail: "4 players, last stock standing." },
  { id: "teams", label: "Squad Clash", detail: "2v2 team stocks." },
];

export class PlayScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "play";
    this.title = "Play";
    this.root = null;
    this.queue = null;
    this.catalog = { characters: [], maps: [] };
    this.selectedStageId = "skyway_split";
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel play-screen" });
    this.root.innerHTML = `
      <div class="hero-card play-hero">
        <div class="hero-copy">
          <span class="eyebrow">Flagship Mode</span>
          <h2 class="screen-title">Arena Platform Fighter</h2>
          <p class="helper">Queue into public matches, boot a custom room, or run solo practice against the training drone. Mini-Games remain separate.</p>
        </div>
        <div class="hero-actions">
          <button class="btn secondary" data-play-link="minigames" type="button">Open Mini-Games</button>
          <button class="btn ghost" data-play-link="leaderboard" type="button">View Leaderboard</button>
        </div>
      </div>

      <div id="queueOverlay" class="card hidden">
        <div class="card-header">
          <div>
            <h3 class="section-title" id="queueLabel">Queue</h3>
            <p class="helper">Public matchmaking state</p>
          </div>
          <button id="queueLeaveBtn" class="btn ghost" type="button">Leave Queue</button>
        </div>
        <div class="card-body mini-stat-grid">
          <div class="stat-card"><span class="metric-label">Status</span><strong>Searching</strong><span class="muted">Waiting for the mode's player requirement.</span></div>
          <div class="stat-card"><span class="metric-label">Position</span><strong id="queuePos">-</strong><span class="muted">Current order</span></div>
          <div class="stat-card"><span class="metric-label">Players</span><strong id="queueSize">-</strong><span class="muted">Visible queue depth</span></div>
        </div>
      </div>

      <div class="play-shell-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Launch Match</h3>
              <p class="helper">Use public queues for live matches or spin up a named room for local/same-network play.</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="play-mode-grid">
              ${PUBLIC_MODES.map((mode) => `
                <button class="play-mode-card" data-queue-mode="${mode.id}" type="button">
                  <strong>${mode.label}</strong>
                  <span>${mode.detail}</span>
                </button>
              `).join("")}
            </div>
            <div class="play-inline-grid">
              <label>Room code <input id="playRoomCode" value="arcade-room"></label>
              <label>Room mode
                <select id="playRoomMode">
                  <option value="duel">Duel</option>
                  <option value="ffa">Free-For-All</option>
                  <option value="teams">Teams</option>
                </select>
              </label>
              <label>Best of
                <select id="playBestOf">
                  <option value="3">3 rounds</option>
                  <option value="5">5 rounds</option>
                </select>
              </label>
              <label>Round timer
                <select id="playRoundSeconds">
                  <option value="95">95 sec</option>
                  <option value="75">75 sec</option>
                  <option value="120">120 sec</option>
                </select>
              </label>
            </div>
            <div class="row wrap">
              <button id="playCustomBtn" class="btn primary" type="button">Open Custom Room</button>
              <button id="playPracticeBtn" class="btn secondary" type="button">Solo Practice</button>
            </div>
            <div>
              <div class="section-title">Stage Rotation</div>
              <div id="playStageGrid" class="play-stage-grid"></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Active Rooms</h3>
              <p class="helper">Join a room already in character select, loading, or match flow.</p>
            </div>
            <button id="refreshLobbyBtn" class="btn secondary" type="button">Refresh</button>
          </div>
          <div class="card-body">
            <div id="roomList" class="list"></div>
          </div>
        </div>
      </div>
    `;
    $$("[data-play-link]", this.root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate(button.dataset.playLink)));
    $$("[data-queue-mode]", this.root).forEach((button) => button.addEventListener("click", () => this.queueMode(button.dataset.queueMode)));
    $("#queueLeaveBtn", this.root).addEventListener("click", () => this.leaveQueue());
    $("#refreshLobbyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "get_lobby" }));
    $("#playCustomBtn", this.root).addEventListener("click", () => this.launchRoom($("#playRoomMode", this.root).value || "duel"));
    $("#playPracticeBtn", this.root).addEventListener("click", () => this.launchPractice());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Arena launcher");
    this.catalog = await loadArenaCatalog();
    this.selectedStageId = this.catalog.maps[0]?.id || this.selectedStageId;
    this.renderStages();
    this.renderQueue();
    this.renderRooms();
    this.ctx.ws.send({ type: "get_lobby" });
  }

  hide() {}

  queueMode(mode) {
    this.ctx.setScreenLoading("Joining queue...", true);
    this.ctx.ws.send({ type: "queue_join", kind: "arena", mode });
    setTimeout(() => this.ctx.setScreenLoading("", false), 450);
  }

  launchPractice() {
    const room = `practice-${this.ctx.me?.id || "solo"}`;
    this.ctx.navigate("arena", { room, mode: "practice", stage_id: this.selectedStageId, best_of: 1, round_seconds: 95, round_ko_target: 4 });
  }

  launchRoom(mode) {
    const room = ($("#playRoomCode", this.root).value || "arcade-room").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 32) || "arcade-room";
    this.ctx.navigate("arena", {
      room,
      mode,
      stage_id: this.selectedStageId,
      best_of: $("#playBestOf", this.root).value,
      round_seconds: $("#playRoundSeconds", this.root).value,
      round_ko_target: 3,
    });
  }

  leaveQueue() {
    if (!this.queue?.active) return;
    this.ctx.ws.send({ type: "queue_leave", kind: this.queue.kind, mode: this.queue.mode });
  }

  renderStages() {
    const grid = $("#playStageGrid", this.root);
    grid.innerHTML = this.catalog.maps.map((stage) => `
      <button class="stage-card ${this.selectedStageId === stage.id ? "active" : ""}" data-stage-id="${stage.id}" type="button">
        <img src="${escapeHtml(stage.preview || "")}" alt="${escapeHtml(stage.display_name)}">
        <strong>${escapeHtml(stage.display_name)}</strong>
        <span>${escapeHtml(stage.tagline || "")}</span>
      </button>
    `).join("");
    $$("[data-stage-id]", grid).forEach((button) => button.addEventListener("click", () => {
      this.selectedStageId = button.dataset.stageId;
      this.renderStages();
    }));
  }

  renderQueue() {
    const wrap = $("#queueOverlay", this.root);
    if (!this.queue?.active) {
      wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");
    $("#queueLabel", this.root).textContent = `${this.queue.kind.toUpperCase()} ${this.queue.mode.toUpperCase()}`;
    $("#queuePos", this.root).textContent = this.queue.position ?? "-";
    $("#queueSize", this.root).textContent = this.queue.size ?? "-";
  }

  renderRooms() {
    const rooms = (this.ctx.state?.lobby?.rooms || []).filter((room) => room.kind === "arena");
    const list = $("#roomList", this.root);
    if (!rooms.length) {
      list.innerHTML = `<div class="empty-state">No active arena rooms right now.</div>`;
      return;
    }
    list.innerHTML = rooms.map((room) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(room.room_id)}</strong>
          <span>${escapeHtml(room.mode_name || "arena")} | ${escapeHtml(room.state || "waiting")}</span>
        </div>
        <div class="feed-body">Players ${room.player_count} | Spectators ${room.spectator_count}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(room.mode_name || "arena")}</span>
          <span class="chip">${escapeHtml(room.state || "state")}</span>
          <button class="btn secondary" data-join-room="${escapeHtml(room.room_id)}" data-join-mode="${escapeHtml(room.mode_name || "duel")}" type="button">Join</button>
        </div>
      </div>
    `).join("");
    $$("[data-join-room]", list).forEach((button) => button.addEventListener("click", () => {
      this.ctx.navigate("arena", { room: button.dataset.joinRoom, mode: button.dataset.joinMode || "duel" });
    }));
  }

  onEvent(msg) {
    if (msg.type === "queue_status") {
      this.queue = msg.active ? { ...msg } : null;
      this.renderQueue();
    }
    if (msg.type === "match_found") {
      this.queue = null;
      this.renderQueue();
    }
    if (msg.type === "lobby_state") this.renderRooms();
  }
}
