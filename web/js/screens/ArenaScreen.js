import { loadArenaCatalog } from "../arena_catalog.js";
import { audio } from "../audio.js";
import { createKeyInput, toArenaInputPayload } from "../input.js";
import { ArenaRenderer } from "../render_arena.js";
import { $, $$, createEl, escapeHtml, formatTime } from "../ui.js";

export class ArenaScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "arena";
    this.title = "Arena Match";
    this.root = null;
    this.renderer = null;
    this.keyInput = null;
    this.loopHandle = 0;
    this.lastFrame = performance.now();
    this.inputAccum = 0;
    this.inputSeq = 0;
    this.active = false;
    this.catalog = { characters: [], maps: [], charactersById: {}, mapsById: {} };
    this.roomId = "arena";
    this.mode = "duel";
    this.bestOf = 3;
    this.roundSeconds = 95;
    this.roundKoTarget = 3;
    this.stageId = "";
    this.joinedRoomId = null;
    this.roster = null;
    this.state = null;
    this.selectedChar = null;
    this.readyLocal = false;
    this.paused = false;
    this.autoReturnTimer = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel arena-screen" });
    this.root.innerHTML = `
      <div class="arena-shell">
        <div class="card arena-sidebar-card">
          <div class="card-header">
            <div>
              <h2 class="screen-title">Arena Room</h2>
              <p class="helper">Ready up, lock a fighter, then play the full match flow.</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row wrap">
              <button id="arenaReadyBtn" class="btn primary" type="button">Ready</button>
              <button id="arenaStartBtn" class="btn ghost" type="button">Force Start</button>
              <button id="arenaRestartBtn" class="btn ghost" type="button">Rematch</button>
              <button id="arenaLeaveBtn" class="btn danger" type="button">Leave</button>
            </div>
            <div id="arenaStatus" class="status info">Connecting...</div>
            <div class="arena-stage-summary">
              <img id="arenaStagePreview" alt="Arena stage preview">
              <div>
                <div class="section-title" id="arenaStageName">Stage</div>
                <div class="helper" id="arenaStageTag">Waiting for room data.</div>
              </div>
            </div>
            <div>
              <div class="section-title">Character Select</div>
              <div id="arenaCharacterGrid" class="arena-character-grid"></div>
            </div>
            <div>
              <div class="section-title">Roster</div>
              <div id="arenaRoster" class="list"></div>
            </div>
            <div class="arena-legend">
              <strong>Controls</strong>
              <span><code>A / D</code> move</span>
              <span><code>W</code> or <code>Space</code> jump / double jump</span>
              <span><code>S</code> fast-fall</span>
              <span><code>Shift</code> burst dash</span>
              <span><code>J / K / E</code> attack / special / super</span>
            </div>
          </div>
        </div>

        <div class="card arena-stage-card">
          <div class="card-header row space">
            <div class="row wrap">
              <span id="arenaRoomBadge" class="badge">Room -</span>
              <span id="arenaPhaseBadge" class="badge">lobby</span>
              <span id="arenaRoundBadge" class="badge">Round 0</span>
            </div>
            <div class="row wrap">
              <span id="arenaTimerBadge" class="badge">0:00</span>
              <button id="arenaFullscreenBtn" class="btn secondary" type="button">Fullscreen</button>
            </div>
          </div>
          <div class="card-body arena-stage-body">
            <div id="arenaScoreStrip" class="arena-score-strip"></div>
            <div class="canvas-wrap arena-canvas-shell"><canvas id="arenaCanvas" style="height:min(74vh, 760px);"></canvas></div>
          </div>
          <div id="arenaOverlay" class="screen-loading show">
            <div class="screen-loading-card">
              <div id="arenaOverlayText" style="margin-bottom:10px;">Connecting...</div>
              <div class="loading-line"></div>
            </div>
          </div>
          <div id="arenaPauseOverlay" class="screen-loading hidden">
            <div class="screen-loading-card">
              <div style="margin-bottom:12px;font-weight:700;">Paused</div>
              <div class="row wrap">
                <button id="arenaResumeBtn" class="btn primary" type="button">Resume</button>
                <button id="arenaQuitBtn" class="btn danger" type="button">Leave Match</button>
              </div>
            </div>
          </div>
          <div id="arenaResultsOverlay" class="screen-loading hidden">
            <div class="screen-loading-card arena-results-card">
              <div id="arenaResultsTitle" style="font-weight:700;margin-bottom:10px;">Results</div>
              <div id="arenaResultsBody" class="list"></div>
              <div class="row wrap" style="margin-top:12px;">
                <button id="arenaBackMenuBtn" class="btn primary" type="button">Back to Menu</button>
                <button id="arenaRematchBtn" class="btn secondary" type="button">Rematch</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.renderer = new ArenaRenderer($("#arenaCanvas", this.root));
    this.keyInput = createKeyInput();
    window.addEventListener("resize", () => this.renderer.resize());
    window.addEventListener("keydown", (e) => this.onGlobalKey(e));
    document.addEventListener("fullscreenchange", () => this.renderer.resize());
    this.renderer.resize();

    $("#arenaReadyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_ready", ready: !this.readyLocal }));
    $("#arenaStartBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_start" }));
    $("#arenaRestartBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_restart" }));
    $("#arenaFullscreenBtn", this.root).addEventListener("click", () => this.toggleFullscreen());
    $("#arenaLeaveBtn", this.root).addEventListener("click", () => this.leaveToMenu());
    $("#arenaResumeBtn", this.root).addEventListener("click", () => this.setPaused(false));
    $("#arenaQuitBtn", this.root).addEventListener("click", () => this.leaveToMenu());
    $("#arenaBackMenuBtn", this.root).addEventListener("click", () => this.leaveToMenu());
    $("#arenaRematchBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_restart" }));

    this.startLoop();
    return this.root;
  }

  parseRoute(route) {
    const params = route?.params || {};
    this.roomId = "arena";
    this.mode = "duel";
    this.stageId = "";
    this.bestOf = 3;
    this.roundSeconds = 95;
    this.roundKoTarget = 3;
    if (params.room) this.roomId = String(params.room).toLowerCase();
    if (params.mode) this.mode = String(params.mode).toLowerCase();
    if (params.stage_id) this.stageId = String(params.stage_id).toLowerCase();
    this.bestOf = Math.max(1, Math.min(5, Number(params.best_of || 3)));
    this.roundSeconds = Math.max(60, Math.min(150, Number(params.round_seconds || 95)));
    this.roundKoTarget = Math.max(1, Math.min(5, Number(params.round_ko_target || 3)));
  }

  async show(route) {
    this.active = true;
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Platform fighter");
    const previousRoomId = this.joinedRoomId;
    this.parseRoute(route);
    if (previousRoomId && previousRoomId !== this.roomId) {
      this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: previousRoomId });
    }
    this.joinedRoomId = null;
    this.roster = null;
    this.state = null;
    this.readyLocal = false;
    this.hideResults();
    if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
    this.autoReturnTimer = null;
    this.catalog = await loadArenaCatalog();
    const match = this.ctx.lastMatchFound;
    if (match?.kind === "arena") {
      this.roomId = match.room_id;
      this.mode = match.mode || this.mode;
    }
    this.renderer.setMyUserId(this.ctx.me?.id);
    this.renderCharacterGrid();
    this.renderStageSummary();
    this.joinRoom();
  }

  hide() {
    this.active = false;
    this.setPaused(false);
    document.body.classList.remove("arena-focus-mode");
    if (this.joinedRoomId) this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: this.joinedRoomId });
    this.joinedRoomId = null;
    this.roster = null;
    this.state = null;
    if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
    this.autoReturnTimer = null;
  }

  startLoop() {
    const frame = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.active && !this.paused) {
        const phase = this.state?.state;
        if (["round_start", "in_round"].includes(phase) && this.joinedRoomId) {
          this.inputAccum += dt;
          if (this.inputAccum >= 1 / 30) {
            this.inputAccum = 0;
            this.inputSeq += 1;
            const payload = toArenaInputPayload(this.keyInput.state, this.inputSeq, dt);
            this.ctx.ws.send(payload);
          }
        }
      }
      this.renderer.update(dt);
      this.renderer.draw();
      this.loopHandle = requestAnimationFrame(frame);
    };
    this.loopHandle = requestAnimationFrame(frame);
  }

  joinRoom() {
    this.ctx.setScreenLoading("Joining arena...", true);
    this.ctx.ws.send({ type: "join_room", kind: "arena", room_id: this.roomId, arena_mode_name: this.mode, best_of: this.bestOf, round_seconds: this.roundSeconds, round_ko_target: this.roundKoTarget, stage_id: this.stageId });
    setTimeout(() => this.ctx.setScreenLoading("", false), 450);
  }

  onGlobalKey(event) {
    if (!this.active) return;
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.toggleFullscreen();
    }
    if (event.key === "Escape" && ["round_start", "in_round"].includes(this.state?.state)) {
      event.preventDefault();
      this.setPaused(!this.paused);
    }
  }

  setPaused(flag) {
    this.paused = !!flag;
    $("#arenaPauseOverlay", this.root).classList.toggle("hidden", !this.paused);
    $("#arenaPauseOverlay", this.root).classList.toggle("show", this.paused);
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await this.root.requestFullscreen();
      else await document.exitFullscreen();
      this.renderer.resize();
    } catch {
      this.ctx.notify.toast("Fullscreen unavailable", { tone: "error" });
    }
  }

  leaveToMenu() {
    if (this.joinedRoomId) this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: this.joinedRoomId });
    if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
    this.autoReturnTimer = null;
    document.body.classList.remove("arena-focus-mode");
    this.ctx.navigate("play");
  }

  renderStageSummary() {
    const stage = this.state?.stage || this.roster?.stage || this.catalog.mapsById?.[this.stageId] || this.catalog.maps[0];
    if (!stage) return;
    $("#arenaStagePreview", this.root).src = stage.preview || "";
    $("#arenaStageName", this.root).textContent = stage.display_name || "Arena";
    $("#arenaStageTag", this.root).textContent = stage.tagline || "Platform fighter stage";
  }

  renderCharacterGrid() {
    const grid = $("#arenaCharacterGrid", this.root);
    if (!this.catalog.characters.length) {
      grid.innerHTML = `<div class="empty-state">Loading fighters...</div>`;
      return;
    }
    grid.innerHTML = this.catalog.characters.map((fighter) => `
      <button class="arena-character-card ${this.selectedChar === fighter.id ? "active" : ""}" data-char-id="${fighter.id}" type="button">
        <img src="${escapeHtml(fighter.portrait || "")}" alt="${escapeHtml(fighter.display_name)}">
        <div>
          <strong>${escapeHtml(fighter.display_name)}</strong>
          <span>${escapeHtml(fighter.title || fighter.archetype || "")}</span>
          <small>${escapeHtml(fighter.summary || "")}</small>
        </div>
      </button>
    `).join("");
    $$("[data-char-id]", grid).forEach((button) => button.addEventListener("click", () => {
      this.selectedChar = button.dataset.charId;
      this.ctx.ws.send({ type: "arena_select", character_id: this.selectedChar });
      this.renderCharacterGrid();
    }));
  }

  renderRoster() {
    const box = $("#arenaRoster", this.root);
    const players = this.roster?.players || this.state?.players || [];
    if (!players.length) {
      box.innerHTML = `<div class="empty-state">Waiting for players...</div>`;
      return;
    }
    const ready = new Set((this.roster?.ready || this.state?.ready || []).map(Number));
    const metaMap = this.roster?.fighters || {};
    const liveMap = this.state?.fighters || {};
    box.innerHTML = players.map((uid) => {
      const meta = metaMap[uid] || metaMap[String(uid)] || {};
      const live = liveMap[uid] || liveMap[String(uid)] || {};
      const mine = Number(uid) === Number(this.ctx.me?.id);
      return `
        <div class="list-row ${mine ? "active" : ""}">
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(meta.display_name || live.display_name || `Fighter ${uid}`)}</strong>
              <span class="tiny muted">${ready.has(Number(uid)) ? "ready" : (live.ai_controlled ? "bot" : "waiting")}</span>
            </div>
            <div class="tiny muted">${escapeHtml(meta.character_name || meta.character_id || live.character_id || "-")} | Stocks ${live.stocks ?? "-"} | ${Math.round(Number(live.damage || 0))}%</div>
          </div>
        </div>
      `;
    }).join("");
    this.readyLocal = ready.has(Number(this.ctx.me?.id));
    $("#arenaReadyBtn", this.root).textContent = this.readyLocal ? "Unready" : "Ready";
  }

  renderScoreStrip() {
    const wrap = $("#arenaScoreStrip", this.root);
    const players = this.state?.players || [];
    if (!players.length) {
      wrap.innerHTML = "";
      return;
    }
    const fighters = this.state?.fighters || {};
    wrap.innerHTML = players.map((uid) => {
      const fighter = fighters[uid] || fighters[String(uid)] || {};
      const mine = Number(uid) === Number(this.ctx.me?.id);
      const stocks = Math.max(0, Number(fighter.stocks || 0));
      return `
        <div class="arena-score-card ${mine ? "active" : ""}">
          <strong>${escapeHtml(fighter.display_name || fighter.username || `P${uid}`)}</strong>
          <span>${Math.round(Number(fighter.damage || 0))}%</span>
          <div class="arena-stock-row">${Array.from({ length: Math.max(1, Number(fighter.max_stocks || 3)) }).map((_, index) => `<i class="${index < stocks ? "on" : ""}"></i>`).join("")}</div>
        </div>
      `;
    }).join("");
  }

  updateHUD() {
    const state = this.state?.state || this.roster?.state || "lobby";
    $("#arenaRoomBadge", this.root).textContent = `Room ${this.roomId}`;
    $("#arenaPhaseBadge", this.root).textContent = state.replace(/_/g, " ");
    $("#arenaTimerBadge", this.root).textContent = formatTime(this.state?.time_left || 0);
    $("#arenaRoundBadge", this.root).textContent = `Round ${this.state?.round || 0}`;
    const overlay = $("#arenaOverlay", this.root);
    let label = "";
    if (!this.joinedRoomId) label = "Connecting...";
    else if (state === "character_select") label = `Character select | ${Math.ceil(this.state?.character_select_left || 0)}s`;
    else if (state === "loading") label = `Loading ${this.state?.stage?.display_name || ""}`.trim();
    else if (state === "round_start") label = `Round ${this.state?.round || 1} starts in ${Math.ceil(this.state?.round_start_left || 0)}`;
    else if (state === "round_end") label = `Next round in ${Math.ceil(this.state?.round_end_left || 0)}`;
    overlay.classList.toggle("show", !!label);
    overlay.classList.toggle("hidden", !label);
    $("#arenaOverlayText", this.root).textContent = label;
    document.body.classList.toggle("arena-focus-mode", ["round_start", "in_round", "round_end"].includes(state));
    const me = this.state?.fighters?.[this.ctx.me?.id] || this.state?.fighters?.[String(this.ctx.me?.id)] || {};
    $("#arenaStatus", this.root).textContent = `${state.toUpperCase()} | Damage ${Math.round(Number(me.damage || 0))}% | Stocks ${me.stocks ?? "-"}`;
    this.renderScoreStrip();
    this.renderStageSummary();
  }

  showResults(payload) {
    $("#arenaResultsTitle", this.root).textContent = "Match Results";
    $("#arenaResultsBody", this.root).innerHTML = (payload?.scoreboard || []).map((row) => `
      <div class="list-row ${payload?.winners?.includes(row.user_id) ? "active" : ""}">
        <div class="stretch">
          <strong>${escapeHtml(row.display_name || row.username)}</strong>
          <div class="tiny muted">Rounds ${row.round_wins} | KO ${row.kos} | Deaths ${row.deaths} | Damage ${Number(row.damage || 0).toFixed(1)}</div>
          <div class="tiny muted">CC +${row.cc_credited || 0} | Cortisol ${row.cortisol_delta >= 0 ? "+" : ""}${row.cortisol_delta || 0}</div>
        </div>
      </div>
    `).join("");
    $("#arenaResultsOverlay", this.root).classList.remove("hidden");
    $("#arenaResultsOverlay", this.root).classList.add("show");
  }

  hideResults() {
    $("#arenaResultsOverlay", this.root).classList.add("hidden");
    $("#arenaResultsOverlay", this.root).classList.remove("show");
  }

  onEvent(msg) {
    if (msg.type === "room_joined" && msg.kind === "arena" && msg.room_id === this.roomId) {
      this.joinedRoomId = msg.room_id;
      this.ctx.setScreenLoading("", false);
      this.updateHUD();
      return;
    }
    if (msg.type === "arena_roster" && msg.room_id === this.roomId) {
      this.roster = msg;
      const mine = msg.fighters?.[this.ctx.me?.id] || msg.fighters?.[String(this.ctx.me?.id)];
      if (mine?.character_id) this.selectedChar = mine.character_id;
      this.renderCharacterGrid();
      this.renderRoster();
      this.renderStageSummary();
      return;
    }
    if (msg.type === "arena_state" && msg.room_id === this.roomId) {
      this.state = msg;
      this.renderer.applySnapshot(msg);
      this.renderRoster();
      this.updateHUD();
      if (msg.state !== "match_end") this.hideResults();
      for (const event of msg.events || []) {
        if (event.kind === "hit") audio.beep(520, 0.05, "square");
        if (event.kind === "ko") audio.beep(220, 0.12, "sawtooth");
      }
      return;
    }
    if (msg.type === "arena_round_end" && msg.room_id === this.roomId) {
      const won = (msg.winners || []).map(Number).includes(Number(this.ctx.me?.id));
      this.ctx.notify.toast(won ? "Round won" : "Round resolved", { tone: won ? "success" : "info" });
      return;
    }
    if (msg.type === "arena_end" && msg.room_id === this.roomId) {
      this.showResults(msg);
      if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
      this.autoReturnTimer = setTimeout(() => this.ctx.navigate("play"), 15000);
    }
  }
}
