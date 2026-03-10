import { $, $$, createEl, escapeHtml } from "../ui.js";

const QUICK_MODES = [
  { label: "Duel", mode: "duel", desc: "Tight 1v1 rounds and fast rematches" },
  { label: "FFA", mode: "ffa", desc: "Loose chaos and four-player pressure" },
  { label: "Teams", mode: "teams", desc: "Coordinated 2v2 arena queue" },
  { label: "Practice", mode: "practice", desc: "Solo warmup with instant launch" },
];

export class PlayScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "play";
    this.title = "Play";
    this.root = null;
    this.queue = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel play-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Arena</span>
          <h2 class="screen-title">Launch a match</h2>
          <p class="helper">Queue into the arena, jump to practice instantly, or attach to a live room already running on the simulation cluster.</p>
        </div>
        <div class="hero-actions">
          <button class="btn secondary" data-play-link="minigames" type="button">Open mini-games</button>
          <button class="btn ghost" data-play-link="leaderboard" type="button">View leaderboard</button>
        </div>
      </div>

      <div class="metrics-grid">
        ${QUICK_MODES.map((mode) => `
          <button class="quick-action" data-quick="${mode.mode}" type="button">
            <strong>${mode.label}</strong>
            <span>${mode.desc}</span>
          </button>
        `).join("")}
      </div>

      <div id="queueOverlay" class="card hidden">
        <div class="card-header">
          <div>
            <h3 class="section-title" id="queueLabel">Queue</h3>
            <p class="helper">Live matchmaking state</p>
          </div>
          <button id="queueLeaveBtn" class="btn ghost" type="button">Leave queue</button>
        </div>
        <div class="card-body">
          <div class="mini-stat-grid">
            <div class="stat-card">
              <span class="metric-label">Status</span>
              <strong>Finding match</strong>
              <span class="muted">Waiting for enough players to satisfy the queue rule.</span>
            </div>
            <div class="stat-card">
              <span class="metric-label">Position</span>
              <strong id="queuePos">-</strong>
              <span class="muted">Current queue order</span>
            </div>
            <div class="stat-card">
              <span class="metric-label">Players</span>
              <strong id="queueSize">-</strong>
              <span class="muted">Visible queue depth</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="section-title">Active Rooms</h3>
            <p class="helper">Join a live room already running.</p>
          </div>
          <button id="refreshLobbyBtn" class="btn secondary" type="button">Refresh</button>
        </div>
        <div class="card-body">
          <div id="roomList" class="list"></div>
        </div>
      </div>
    `;

    $$("[data-quick]", this.root).forEach((button) => button.addEventListener("click", () => this.onQuick(button.dataset.quick)));
    $$("[data-play-link]", this.root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate(button.dataset.playLink)));
    $("#queueLeaveBtn", this.root).addEventListener("click", () => this.leaveQueue());
    $("#refreshLobbyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "get_lobby" }));
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Arena launcher");
    this.renderQueue();
    this.renderRooms();
    this.ctx.ws.send({ type: "get_lobby" });
  }

  hide() {}

  onQuick(mode) {
    if (mode === "practice") {
      const room = `practice-${this.ctx.me?.id || "solo"}`;
      this.ctx.navigate("arena", { room, mode: "practice", best_of: 1, round_seconds: 60 });
      return;
    }
    this.ctx.setScreenLoading("Finding match...", true);
    this.ctx.ws.send({ type: "queue_join", kind: "arena", mode });
    setTimeout(() => this.ctx.setScreenLoading("", false), 600);
  }

  leaveQueue() {
    if (!this.queue?.active) return;
    this.ctx.ws.send({ type: "queue_leave", kind: this.queue.kind, mode: this.queue.mode });
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
    const rooms = this.ctx.state?.lobby?.rooms || [];
    const list = $("#roomList", this.root);
    if (!rooms.length) {
      list.innerHTML = `<div class="empty-state">No active rooms right now.</div>`;
      return;
    }
    list.innerHTML = rooms.map((room) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(room.room_id)}</strong>
          <span>${escapeHtml(room.kind)} | ${escapeHtml(room.mode_name || "mode")}</span>
        </div>
        <div class="feed-body">Players ${room.player_count} | Spectators ${room.spectator_count} | ${escapeHtml(room.state || "waiting")}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(room.kind)}</span>
          <span class="chip">${escapeHtml(room.mode_name || "mode")}</span>
          <button class="btn secondary" data-join="${escapeHtml(room.room_id)}" data-kind="${escapeHtml(room.kind)}" data-mode="${escapeHtml(room.mode_name || "ffa")}" type="button">Join</button>
        </div>
      </div>
    `).join("");
    $$("[data-join]", list).forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.kind;
        const roomId = button.dataset.join;
        if (kind === "arena") this.ctx.navigate("arena", { room: roomId, mode: button.dataset.mode || "ffa" });
        else this.ctx.navigate(kind, { room: roomId });
      });
    });
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
