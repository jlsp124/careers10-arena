import { $, $$, createEl, escapeHtml } from "../ui.js";

const QUICK_MODES = [
  { label: "Duel", mode: "duel", desc: "Tight 1v1 arena rounds and fast rematches." },
  { label: "Free-for-all", mode: "ffa", desc: "Loose chaos and four-player pressure." },
  { label: "Teams", mode: "teams", desc: "Coordinated 2v2 arena queue." },
  { label: "Practice", mode: "practice", desc: "Solo launch with no queue wait." },
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
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Play</h2>
          <p>Arena launcher for practice, matchmaking, and direct entry into live rooms.</p>
        </div>
        <div class="page-actions">
          <button class="btn secondary" data-play-link="minigames" type="button">Mini-Games</button>
          <button class="btn secondary" data-play-link="leaderboard" type="button">Leaderboard</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Queue state</span>
          <strong id="playQueueState" class="stat-value">Idle</strong>
          <span id="playQueueNote" class="stat-note">Join a mode to start matchmaking</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Online players</span>
          <strong id="playOnlineCount" class="stat-value">0</strong>
          <span class="stat-note">Visible live presence in the sim</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Live rooms</span>
          <strong id="playRoomCount" class="stat-value">0</strong>
          <span class="stat-note">Rooms available to join right now</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cortisol</span>
          <strong id="playCortisol" class="stat-value">0</strong>
          <span id="playCortisolNote" class="stat-note">Current player pressure tier</span>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Arena launcher</h3>
            <p class="helper">Pick a mode to queue, or start practice immediately.</p>
          </div>
        </div>
        <div class="panel-body">
          <div id="playModeGrid" class="launcher-grid"></div>
        </div>
      </section>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Matchmaking queue</h3>
              <p class="helper">Current queue position and the option to leave before a match is found.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="queuePanel"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Live rooms</h3>
              <p class="helper">Attach to a room already running on the simulation cluster.</p>
            </div>
            <button id="refreshLobbyBtn" class="btn secondary" type="button">Refresh</button>
          </div>
          <div class="panel-body">
            <div id="roomList" class="list-stack"></div>
          </div>
        </section>
      </div>
    `;

    this.renderModeGrid();
    $$("[data-play-link]", this.root).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate(button.dataset.playLink));
    });
    $("#refreshLobbyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "get_lobby" }));
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Arena launcher");
    this.ctx.setGlobalSearchValue("");
    this.render();
    this.ctx.ws.send({ type: "get_lobby" });
  }

  hide() {}

  render() {
    this.renderSummary();
    this.renderQueue();
    this.renderRooms();
    this.renderInspector();
  }

  renderModeGrid() {
    const node = $("#playModeGrid", this.root);
    node.innerHTML = QUICK_MODES.map((mode) => `
      <button class="action-card" data-quick="${mode.mode}" type="button">
        <strong>${mode.label}</strong>
        <span>${mode.desc}</span>
      </button>
    `).join("");
    $$("[data-quick]", node).forEach((button) => {
      button.addEventListener("click", () => this.onQuick(button.dataset.quick));
    });
  }

  renderSummary() {
    const rooms = this.ctx.state?.lobby?.rooms || [];
    const online = this.ctx.state?.lobby?.online || [];
    const stats = this.ctx.me?.stats || {};
    $("#playQueueState", this.root).textContent = this.queue?.active ? `${this.queue.kind} ${this.queue.mode}` : "Idle";
    $("#playQueueNote", this.root).textContent = this.queue?.active
      ? `Position ${this.queue.position ?? "-"} of ${this.queue.size ?? "-"}`
      : "Join a mode to start matchmaking";
    $("#playOnlineCount", this.root).textContent = String(online.length || 0);
    $("#playRoomCount", this.root).textContent = String(rooms.length || 0);
    $("#playCortisol", this.root).textContent = String(stats.cortisol || 0);
    $("#playCortisolNote", this.root).textContent = `${stats.tier || "Stable"} tier`;
  }

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
    const node = $("#queuePanel", this.root);
    if (!this.queue?.active) {
      node.innerHTML = `<div class="empty-state"><strong>No active queue</strong><span>Select a mode above to enter matchmaking or open practice immediately.</span></div>`;
      return;
    }
    node.innerHTML = `
      <div class="detail-card">
        <div class="detail-row"><span class="muted">Mode</span><strong>${escapeHtml(`${this.queue.kind} ${this.queue.mode}`)}</strong></div>
        <div class="detail-row"><span class="muted">Position</span><strong>${this.queue.position ?? "-"}</strong></div>
        <div class="detail-row"><span class="muted">Visible players</span><strong>${this.queue.size ?? "-"}</strong></div>
        <button id="queueLeaveBtn" class="btn danger" type="button">Leave queue</button>
      </div>
    `;
    $("#queueLeaveBtn", this.root).addEventListener("click", () => this.leaveQueue());
  }

  renderRooms() {
    const rooms = this.ctx.state?.lobby?.rooms || [];
    const node = $("#roomList", this.root);
    if (!rooms.length) {
      node.innerHTML = `<div class="empty-state"><strong>No live rooms</strong><span>Refresh after a queue pops or a practice room starts.</span></div>`;
      return;
    }
    node.innerHTML = rooms.map((room) => `
      <div class="list-item">
        <div class="feed-meta">
          <strong>${escapeHtml(room.room_id)}</strong>
          <span>${escapeHtml(room.kind)} · ${escapeHtml(room.mode_name || "mode")}</span>
        </div>
        <div class="feed-body">Players ${room.player_count} · Spectators ${room.spectator_count} · ${escapeHtml(room.state || "waiting")}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(room.kind)}</span>
          <span class="chip">${escapeHtml(room.mode_name || "mode")}</span>
          <button class="btn secondary" data-join="${escapeHtml(room.room_id)}" data-kind="${escapeHtml(room.kind)}" data-mode="${escapeHtml(room.mode_name || "ffa")}" type="button">Join</button>
        </div>
      </div>
    `).join("");
    $$("[data-join]", node).forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.kind;
        const roomId = button.dataset.join;
        if (kind === "arena") this.ctx.navigate("arena", { room: roomId, mode: button.dataset.mode || "ffa" });
        else this.ctx.navigate(kind, { room: roomId });
      });
    });
  }

  renderInspector() {
    const online = this.ctx.state?.lobby?.online || [];
    this.ctx.setInspector({
      title: "Play detail",
      subtitle: "Queue state and live presence",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Queue</span><strong>${escapeHtml(this.queue?.active ? `${this.queue.kind} ${this.queue.mode}` : "Idle")}</strong></div>
          <div class="detail-row"><span class="muted">Online users</span><strong>${online.length || 0}</strong></div>
          <div class="detail-row"><span class="muted">Rooms</span><strong>${this.ctx.state?.lobby?.rooms?.length || 0}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Shortcuts</div>
          <button class="btn secondary" data-play-inspector="arena" type="button">Open practice arena</button>
          <button class="btn secondary" data-play-inspector="minigames" type="button">Open mini-games</button>
          <button class="btn secondary" data-play-inspector="leaderboard" type="button">Open leaderboard</button>
        </div>
      `,
    });
    const inspectorRoot = document.getElementById("inspectorContent");
    $$("[data-play-inspector]", inspectorRoot).forEach((button) => {
      button.addEventListener("click", () => {
        const route = button.dataset.playInspector;
        if (route === "arena") this.onQuick("practice");
        else this.ctx.navigate(route);
      });
    });
  }

  onEvent(msg) {
    if (msg.type === "queue_status") {
      this.queue = msg.active ? { ...msg } : null;
      this.render();
    }
    if (msg.type === "match_found") {
      this.queue = null;
      this.render();
    }
    if (msg.type === "lobby_state") this.render();
  }
}
