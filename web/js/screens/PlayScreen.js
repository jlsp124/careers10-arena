import { buildHashUrl, copyToClipboard } from "../net.js";
import { loadArenaCatalog } from "../arena_catalog.js";
import { $, $$, createEl, escapeHtml } from "../ui.js";

const ARENA_MODES = [
  {
    id: "practice",
    label: "Practice Lab",
    players: "1 + sparring drone",
    desc: "Instant room with a Host-controlled sparring opponent.",
    bestOf: 1,
    roundSeconds: 75,
    roundKoTarget: 3,
  },
  {
    id: "duel",
    label: "Duel Room",
    players: "2 players",
    desc: "Private head-to-head Arena match.",
    bestOf: 3,
    roundSeconds: 95,
    roundKoTarget: 3,
  },
  {
    id: "ffa",
    label: "Free-For-All",
    players: "2-4 players",
    desc: "Open private room for local chaos.",
    bestOf: 3,
    roundSeconds: 95,
    roundKoTarget: 3,
  },
  {
    id: "teams",
    label: "Teams",
    players: "4 players",
    desc: "Private 2v2 room. Bring the players directly.",
    bestOf: 3,
    roundSeconds: 95,
    roundKoTarget: 3,
  },
];

function sanitizeRoom(value, fallback = "arena") {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return clean || fallback;
}

export class PlayScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "play";
    this.title = "Play";
    this.root = null;
    this.catalog = { maps: [] };
    this.selectedMode = "practice";
    this.selectedStageId = "";
    this.roomId = "arena-room";
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel play-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Arena</h2>
          <p>Flagship platform-fighter rooms for practice, direct invites, and LAN play.</p>
        </div>
        <div class="page-actions">
          <button class="btn secondary" data-play-link="minigames" type="button">Mini-Games</button>
          <button class="btn secondary" data-play-link="leaderboard" type="button">Leaderboard</button>
        </div>
      </div>

      <section class="game-hero arena-hero">
        <img src="/assets/arena-marquee.png" alt="Arena marquee">
        <div class="game-hero-copy">
          <span class="eyebrow">Flagship Module</span>
          <h3>Arena</h3>
          <p>Pick a mode, choose a stage, share a room link, and launch straight into a Host-owned match.</p>
          <div class="hero-cta-row">
            <button id="playStartPrimaryBtn" class="btn primary" type="button">Launch Arena</button>
            <button id="playCopyLinkBtn" class="btn secondary" type="button">Copy room link</button>
          </div>
        </div>
      </section>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Mode</span>
          <strong id="playSelectedMode" class="stat-value">Practice</strong>
          <span id="playSelectedModeNote" class="stat-note">Instant room</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Stage</span>
          <strong id="playSelectedStage" class="stat-value">Auto</strong>
          <span class="stat-note">Chosen before room launch</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Live rooms</span>
          <strong id="playRoomCount" class="stat-value">0</strong>
          <span class="stat-note">Currently hosted by Cortisol Host</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cortisol</span>
          <strong id="playCortisol" class="stat-value">0</strong>
          <span id="playCortisolNote" class="stat-note">Current player tier</span>
        </div>
      </div>

      <section class="panel arena-launch-panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Launch Setup</h3>
            <p class="helper">Direct rooms and practice keep every match on the selected Cortisol Host.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <div id="playModeGrid" class="launcher-grid arena-mode-grid"></div>
          <div class="arena-room-builder">
            <label class="stretch">Room code
              <input id="playRoomInput" value="arena-room" maxlength="32">
            </label>
            <button id="playStartBtn" class="btn primary" type="button">Launch room</button>
            <button id="playRefreshRoomsBtn" class="btn secondary" type="button">Refresh rooms</button>
          </div>
          <div id="playStageGrid" class="arena-stage-picker"></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Live Arena Rooms</h3>
            <p class="helper">Join rooms already running on this Host or spectate a match in progress.</p>
          </div>
        </div>
        <div class="panel-body">
          <div id="roomList" class="list-stack"></div>
        </div>
      </section>
    `;

    $$("[data-play-link]", this.root).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate(button.dataset.playLink));
    });
    $("#playStartPrimaryBtn", this.root).addEventListener("click", () => this.launchArena());
    $("#playStartBtn", this.root).addEventListener("click", () => this.launchArena());
    $("#playCopyLinkBtn", this.root).addEventListener("click", () => this.copyArenaLink());
    $("#playRefreshRoomsBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "get_lobby" }));
    $("#playRoomInput", this.root).addEventListener("input", (event) => {
      this.roomId = sanitizeRoom(event.target.value, "arena-room");
      this.renderSummary();
    });
    this.renderModeGrid();
    this.renderStageGrid();
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Arena launcher");
    this.ctx.setGlobalSearchValue("");
    if (route?.params?.mode) this.selectedMode = String(route.params.mode || "practice").toLowerCase();
    if (route?.params?.stage_id) this.selectedStageId = String(route.params.stage_id || "");
    if (route?.params?.room) this.roomId = sanitizeRoom(route.params.room, this.roomId);
    $("#playRoomInput", this.root).value = this.roomId;
    this.catalog = await loadArenaCatalog();
    if (!this.selectedStageId && this.catalog.maps?.[0]?.id) this.selectedStageId = this.catalog.maps[0].id;
    this.renderModeGrid();
    this.renderStageGrid();
    this.render();
    this.ctx.ws.send({ type: "get_lobby" });
  }

  hide() {}

  selectedModeConfig() {
    return ARENA_MODES.find((mode) => mode.id === this.selectedMode) || ARENA_MODES[0];
  }

  arenaRouteParams() {
    const mode = this.selectedModeConfig();
    const room = mode.id === "practice"
      ? sanitizeRoom(`practice-${this.ctx.me?.id || "solo"}`, "practice")
      : sanitizeRoom($("#playRoomInput", this.root)?.value || this.roomId, "arena-room");
    return {
      room,
      mode: mode.id,
      best_of: mode.bestOf,
      round_seconds: mode.roundSeconds,
      round_ko_target: mode.roundKoTarget,
      stage_id: this.selectedStageId || "",
    };
  }

  launchArena() {
    const params = this.arenaRouteParams();
    this.roomId = params.room;
    this.ctx.navigate("arena", params);
  }

  async copyArenaLink() {
    await copyToClipboard(buildHashUrl("arena", this.arenaRouteParams()));
    this.ctx.notify.toast("Arena room link copied", { tone: "success" });
  }

  render() {
    this.renderSummary();
    this.renderRooms();
    this.renderInspector();
  }

  renderModeGrid() {
    const node = $("#playModeGrid", this.root);
    node.innerHTML = ARENA_MODES.map((mode) => `
      <button class="action-card arena-mode-card ${mode.id === this.selectedMode ? "active" : ""}" data-arena-mode="${mode.id}" type="button">
        <span class="stat-label">${escapeHtml(mode.players)}</span>
        <strong>${escapeHtml(mode.label)}</strong>
        <span>${escapeHtml(mode.desc)}</span>
        <div class="chip-row">
          <span class="chip">Best of ${mode.bestOf}</span>
          <span class="chip">${mode.roundSeconds}s</span>
        </div>
      </button>
    `).join("");
    $$("[data-arena-mode]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedMode = button.dataset.arenaMode;
        this.renderModeGrid();
        this.renderSummary();
        this.renderInspector();
      });
    });
  }

  renderStageGrid() {
    const node = $("#playStageGrid", this.root);
    const stages = this.catalog.maps || [];
    if (!stages.length) {
      node.innerHTML = `<div class="empty-state">Stage catalog is loading.</div>`;
      return;
    }
    node.innerHTML = stages.map((stage) => `
      <button class="stage-pick ${stage.id === this.selectedStageId ? "active" : ""}" data-stage-id="${escapeHtml(stage.id)}" type="button">
        <img src="${escapeHtml(stage.preview || "")}" alt="${escapeHtml(stage.display_name || stage.id)}">
        <span>
          <strong>${escapeHtml(stage.display_name || stage.id)}</strong>
          <small>${escapeHtml(stage.tagline || "Arena stage")}</small>
        </span>
      </button>
    `).join("");
    $$("[data-stage-id]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedStageId = button.dataset.stageId;
        this.renderStageGrid();
        this.renderSummary();
        this.renderInspector();
      });
    });
  }

  renderSummary() {
    const rooms = (this.ctx.state?.lobby?.rooms || []).filter((room) => room.kind === "arena");
    const stats = this.ctx.me?.stats || {};
    const mode = this.selectedModeConfig();
    const stage = this.catalog.maps?.find((item) => item.id === this.selectedStageId);
    $("#playSelectedMode", this.root).textContent = mode.label;
    $("#playSelectedModeNote", this.root).textContent = mode.players;
    $("#playSelectedStage", this.root).textContent = stage?.display_name || "Auto";
    $("#playRoomCount", this.root).textContent = String(rooms.length || 0);
    $("#playCortisol", this.root).textContent = String(stats.cortisol || 0);
    $("#playCortisolNote", this.root).textContent = `${stats.tier || "Stable"} tier`;
  }

  renderRooms() {
    const rooms = (this.ctx.state?.lobby?.rooms || []).filter((room) => room.kind === "arena");
    const node = $("#roomList", this.root);
    if (!rooms.length) {
      node.innerHTML = `<div class="empty-state"><strong>No Arena rooms live</strong><span>Launch practice or create a direct room above.</span></div>`;
      return;
    }
    node.innerHTML = rooms.map((room) => `
      <div class="list-item">
        <div class="feed-meta">
          <strong>${escapeHtml(room.room_id)}</strong>
          <span>${escapeHtml(room.mode_name || "arena")} | ${escapeHtml(room.state || "waiting")}</span>
        </div>
        <div class="feed-body">Players ${room.player_count} | Spectators ${room.spectator_count} | ${room.time_left != null ? `${Math.ceil(Number(room.time_left || 0))}s left` : "lobby"}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(room.mode_name || "arena")}</span>
          <button class="btn secondary" data-join="${escapeHtml(room.room_id)}" data-mode="${escapeHtml(room.mode_name || "duel")}" type="button">Join</button>
        </div>
      </div>
    `).join("");
    $$("[data-join]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.ctx.navigate("arena", { room: button.dataset.join, mode: button.dataset.mode || "duel" });
      });
    });
  }

  renderInspector() {
    const mode = this.selectedModeConfig();
    const stage = this.catalog.maps?.find((item) => item.id === this.selectedStageId);
    this.ctx.setInspector({
      title: "Arena setup",
      subtitle: `${mode.label} | ${stage?.display_name || "Auto stage"}`,
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Mode</span><strong>${escapeHtml(mode.label)}</strong></div>
          <div class="detail-row"><span class="muted">Players</span><strong>${escapeHtml(mode.players)}</strong></div>
          <div class="detail-row"><span class="muted">Rules</span><strong>Best of ${mode.bestOf}</strong></div>
          <div class="detail-row"><span class="muted">Stage</span><strong>${escapeHtml(stage?.display_name || "Auto")}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Controls</div>
          <div class="control-hints compact">
            <span><kbd>WASD</kbd> Move</span>
            <span><kbd>Space</kbd> Jump</span>
            <span><kbd>Shift</kbd> Dash</span>
            <span><kbd>J/K/E</kbd> Attack</span>
          </div>
        </div>
      `,
    });
  }

  onEvent(msg) {
    if (msg.type === "lobby_state") this.render();
  }
}
