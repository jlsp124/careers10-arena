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

    this.roomId = "arena";
    this.mode = "duel";
    this.bestOf = 3;
    this.roundSeconds = 60;
    this.roundKoTarget = 4;
    this.roomKey = null;
    this.joinedRoomId = null;
    this.roster = null;
    this.state = null;
    this.selectedChar = null;
    this.readyLocal = false;
    this.characters = [];
    this.paused = false;
    this.lastResult = null;
    this.autoReturnTimer = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="arena-layout">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="screen-title">Arena Flow</h2>
              <p class="helper">Character Select -> Round Start -> In Round -> Round End -> Results</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row wrap">
              <button id="arenaReadyBtn" class="btn primary" type="button">Ready</button>
              <button id="arenaStartBtn" class="btn ghost" type="button">Force Start</button>
              <button id="arenaRestartBtn" class="btn ghost" type="button">Rematch</button>
              <button id="arenaFullscreenBtn" class="btn secondary" type="button">Fullscreen (F)</button>
              <button id="arenaLeaveBtn" class="btn danger" type="button">Leave</button>
            </div>
            <div id="arenaStatus" class="status info">Connecting...</div>
            <div class="col">
              <div class="section-title">Character Select</div>
              <div id="arenaCharacterGrid" class="character-grid"></div>
            </div>
            <div class="col">
              <div class="section-title">Roster</div>
              <div id="arenaRoster" class="list"></div>
            </div>
          </div>
        </div>

        <div class="card" style="position:relative;">
          <div class="card-header row space">
            <span id="arenaRoomBadge" class="badge">Room -</span>
            <span id="arenaPhaseBadge" class="badge">lobby</span>
            <span id="arenaTimerBadge" class="badge">0:00</span>
            <span id="arenaRoundBadge" class="badge">Round 0</span>
          </div>
          <div class="card-body col">
            <div class="canvas-wrap"><canvas id="arenaCanvas" style="height:min(76vh, 720px);"></canvas></div>
            <div class="tiny muted">WASD move | Shift dash | J basic | K special | E ultimate | Esc pause</div>
          </div>
          <div id="arenaOverlay" class="screen-loading show" style="display:flex;">
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
            <div class="screen-loading-card" style="min-width:340px;">
              <div id="arenaResultsTitle" style="font-weight:700;margin-bottom:10px;">Results</div>
              <div id="arenaResultsBody" class="list" style="max-height:300px;overflow:auto;"></div>
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

    this.loadCharacters();
    this.startLoop();
    return this.root;
  }

  onGlobalKey(e) {
    if (!this.active) return;
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      this.toggleFullscreen();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const st = this.state?.state;
      if (st === "in_round" || st === "round_start") this.setPaused(!this.paused);
    }
  }

  async loadCharacters() {
    try {
      const res = await fetch("/assets/characters.json");
      const payload = await res.json();
      this.characters = Array.isArray(payload) ? payload : [];
    } catch {
      this.characters = [];
    }
    this.renderCharacterGrid();
  }

  parseRoute(route) {
    const p = route?.params || {};
    if (p.room) this.roomId = String(p.room).toLowerCase();
    if (p.mode) this.mode = String(p.mode).toLowerCase();
    this.bestOf = Math.max(1, Math.min(7, Number(p.best_of || 3)));
    this.roundSeconds = Math.max(30, Math.min(120, Number(p.round_seconds || 60)));
    this.roundKoTarget = Math.max(1, Math.min(12, Number(p.round_ko_target || 4)));
  }

  async show(route) {
    this.active = true;
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Round-based arena");
    this.parseRoute(route);
    const match = this.ctx.lastMatchFound;
    if (match?.kind === "arena") {
      this.roomId = match.room_id;
      this.mode = match.mode || this.mode;
    }
    this.renderer.setMyUserId(this.ctx.me?.id);
    this.joinRoom();
  }

  hide() {
    this.active = false;
    this.setPaused(false);
    document.body.classList.remove("arena-focus-mode");
    if (this.joinedRoomId) this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: this.joinedRoomId });
    this.roomKey = null;
    this.joinedRoomId = null;
    this.state = null;
    this.roster = null;
    if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
    this.autoReturnTimer = null;
  }

  startLoop() {
    const frame = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.active && !this.paused) {
        this.inputAccum += dt;
        if (this.inputAccum >= 1 / 30 && this.joinedRoomId) {
          this.inputAccum = 0;
          this.inputSeq += 1;
          const payload = toArenaInputPayload(this.keyInput.state, this.inputSeq, dt);
          this.ctx.ws.send(payload);
          this.renderer.pushLocalInput(payload);
        }
      }
      this.renderer.update(dt);
      this.renderer.draw();
      this.loopHandle = requestAnimationFrame(frame);
    };
    this.loopHandle = requestAnimationFrame(frame);
  }

  joinRoom() {
    this.ctx.setScreenLoading("Starting...", true);
    this.ctx.ws.send({
      type: "join_room",
      kind: "arena",
      room_id: this.roomId,
      arena_mode_name: this.mode,
      best_of: this.bestOf,
      round_seconds: this.roundSeconds,
      round_ko_target: this.roundKoTarget,
      match_seconds: Math.max(this.bestOf * this.roundSeconds, 60),
    });
    setTimeout(() => this.ctx.setScreenLoading("", false), 600);
  }

  setPaused(flag) {
    this.paused = !!flag;
    const overlay = $("#arenaPauseOverlay", this.root);
    overlay.classList.toggle("hidden", !this.paused);
    overlay.classList.toggle("show", !!this.paused);
  }

  async toggleFullscreen() {
    const host = this.root;
    try {
      if (!document.fullscreenElement) await host.requestFullscreen();
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

  renderCharacterGrid() {
    const grid = $("#arenaCharacterGrid", this.root);
    if (!this.characters.length) {
      grid.innerHTML = `<div class="empty-state">Loading assets...</div>`;
      return;
    }
    grid.innerHTML = this.characters.map((c) => `
      <button type="button" class="character-card ${this.selectedChar === c.id ? "active" : ""}" data-char="${c.id}">
        <div class="row space">
          <div class="name">${escapeHtml(c.display_name)}</div>
          <span style="width:10px;height:10px;border-radius:50%;background:${c.color};display:inline-block"></span>
        </div>
        <div class="meta">${escapeHtml(c.archetype || "-")}</div>
      </button>
    `).join("");
    $$("[data-char]", grid).forEach((btn) => btn.addEventListener("click", () => {
      this.selectedChar = btn.dataset.char;
      this.ctx.ws.send({ type: "arena_select", character_id: this.selectedChar });
      this.renderCharacterGrid();
    }));
  }

  renderRoster() {
    const box = $("#arenaRoster", this.root);
    const players = this.roster?.players || this.state?.players || [];
    if (!players.length) {
      box.innerHTML = `<div class="empty-state">No players</div>`;
      return;
    }
    const ready = new Set((this.state?.ready || this.roster?.ready || []).map(Number));
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
              <strong>${escapeHtml(meta.display_name || live.display_name || `User ${uid}`)}</strong>
              <span class="tiny muted">${ready.has(Number(uid)) ? "ready" : "waiting"}</span>
            </div>
            <div class="tiny muted">Round W ${live.round_wins ?? 0} | KOs ${live.score_kos ?? 0} | D ${live.score_deaths ?? 0}</div>
          </div>
        </div>
      `;
    }).join("");
    this.readyLocal = ready.has(Number(this.ctx.me?.id));
    $("#arenaReadyBtn", this.root).textContent = this.readyLocal ? "Unready" : "Ready";
  }

  updateHUD() {
    const state = this.state?.state || this.roster?.state || "lobby";
    const overlay = $("#arenaOverlay", this.root);
    const overlayText = $("#arenaOverlayText", this.root);
    const timer = this.state?.time_left || 0;
    $("#arenaRoomBadge", this.root).textContent = `Room ${this.roomId}`;
    $("#arenaPhaseBadge", this.root).textContent = state;
    $("#arenaTimerBadge", this.root).textContent = formatTime(timer);
    $("#arenaRoundBadge", this.root).textContent = `Round ${this.state?.round || 0}`;

    let label = "";
    if (!this.joinedRoomId) label = "Connecting...";
    else if (state === "character_select") label = `Character Select (${Math.ceil(this.state?.character_select_left || 0)}s)`;
    else if (state === "round_start") label = `Starting Round ${this.state?.round || 1} (${Math.ceil(this.state?.round_start_left || 0)}s)`;
    else if (state === "round_end") label = `Between Rounds (${Math.ceil(this.state?.round_end_left || 0)}s)`;
    else if (state === "match_end") label = "";
    if (state === "in_round") label = "";
    overlay.classList.toggle("show", !!label);
    overlay.classList.toggle("hidden", !label);
    overlayText.textContent = label || "";
    document.body.classList.toggle("arena-focus-mode", ["round_start", "in_round", "round_end"].includes(state));

    const me = this.state?.fighters?.[this.ctx.me?.id] || this.state?.fighters?.[String(this.ctx.me?.id)] || {};
    const status = $("#arenaStatus", this.root);
    status.className = "status info";
    status.textContent = `${state.toUpperCase()} | Round CC ${me.round_cc ?? 0} | Match CC ${me.match_cc ?? 0}`;
  }

  showResults(payload) {
    this.lastResult = payload;
    const rows = payload?.scoreboard || [];
    const winners = new Set((payload?.winners || []).map(Number));
    $("#arenaResultsTitle", this.root).textContent = winners.size ? "Match Results" : "Match Results (Tie)";
    $("#arenaResultsBody", this.root).innerHTML = rows.map((r) => `
      <div class="list-row ${winners.has(Number(r.user_id)) ? "active" : ""}">
        <div class="stretch">
          <strong>${escapeHtml(r.display_name || r.username)}</strong>
          <div class="tiny muted">W ${r.round_wins} | KO ${r.kos} | D ${r.deaths} | DMG ${Number(r.damage || 0).toFixed(1)}</div>
          <div class="tiny muted">CC +${r.cc_credited || 0} | Cortisol ${r.cortisol_delta >= 0 ? "+" : ""}${r.cortisol_delta || 0}</div>
        </div>
      </div>
    `).join("");
    const overlay = $("#arenaResultsOverlay", this.root);
    overlay.classList.remove("hidden");
    overlay.classList.add("show");
  }

  hideResults() {
    const overlay = $("#arenaResultsOverlay", this.root);
    overlay.classList.add("hidden");
    overlay.classList.remove("show");
  }

  onEvent(msg) {
    if (msg.type === "room_joined" && msg.kind === "arena" && msg.room_id === this.roomId) {
      this.roomKey = msg.room_key;
      this.joinedRoomId = msg.room_id;
      this.ctx.setScreenLoading("", false);
      this.updateHUD();
      return;
    }
    if (msg.type === "arena_roster" && msg.room_id === this.roomId) {
      this.roster = msg;
      this.renderRoster();
      return;
    }
    if (msg.type === "arena_state" && msg.room_id === this.roomId) {
      this.state = msg;
      this.renderer.applySnapshot(msg);
      this.renderRoster();
      this.updateHUD();
      const events = msg.events || [];
      for (const ev of events) {
        if (ev.kind === "hit") audio.beep(520, 0.04, "square");
        if (ev.kind === "ko") audio.beep(220, 0.1, "sawtooth");
        if (ev.kind === "coin_pickup") audio.beep(760, 0.06, "triangle");
      }
      if (msg.state !== "match_end") this.hideResults();
      return;
    }
    if (msg.type === "arena_round_end" && msg.room_id === this.roomId) {
      const won = (msg.winners || []).map(Number).includes(Number(this.ctx.me?.id));
      this.ctx.notify.toast(won ? "Round won" : "Round lost", { tone: won ? "success" : "info" });
      return;
    }
    if (msg.type === "arena_end" && msg.room_id === this.roomId) {
      this.ctx.notify.toast("Match ended", { tone: "success" });
      this.showResults(msg);
      if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
      this.autoReturnTimer = setTimeout(() => this.ctx.navigate("play"), 12000);
      return;
    }
    if (msg.type === "match_found" && msg.kind === "arena") {
      this.ctx.setScreenLoading("Match found", true);
      setTimeout(() => this.ctx.setScreenLoading("", false), 600);
    }
  }
}
