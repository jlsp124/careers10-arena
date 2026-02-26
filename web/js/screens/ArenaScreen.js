import { audio } from "../audio.js";
import { createKeyInput, toArenaInputPayload } from "../input.js";
import { buildHashUrl, copyToClipboard } from "../net.js";
import { ArenaRenderer } from "../render_arena.js";
import { $, $$, createEl, escapeHtml, tsToLocal } from "../ui.js";

export class ArenaScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "arena";
    this.title = "Arena";
    this.root = null;
    this.renderer = null;
    this.keyInput = null;
    this.loopHandle = 0;
    this.lastFrame = performance.now();
    this.inputAccum = 0;
    this.inputSeq = 0;
    this.active = false;

    this.roomId = "arena";
    this.mode = "ffa";
    this.seconds = 90;
    this.roomKey = null;
    this.joinedRoomId = null;
    this.roster = null;
    this.state = null;
    this.selectedChar = null;
    this.readyLocal = false;
    this.characters = [];
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="arena-layout">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="screen-title">Arena</h2>
              <p class="helper">Match</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row wrap">
              <label class="stretch">Room
                <input id="arenaRoomId" value="arena">
              </label>
              <label class="stretch">Mode
                <select id="arenaMode">
                  <option value="duel">Duel</option>
                  <option value="teams">Teams</option>
                  <option value="ffa">FFA</option>
                  <option value="boss">Boss</option>
                  <option value="practice">Practice</option>
                </select>
              </label>
              <label style="max-width:120px;">Seconds
                <input id="arenaSeconds" type="number" min="60" max="120" value="90">
              </label>
            </div>
            <div class="row wrap">
              <button id="arenaJoinBtn" class="btn primary" type="button">Join</button>
              <button id="arenaCopyBtn" class="btn secondary" type="button">Copy Link</button>
              <button id="arenaReadyBtn" class="btn ghost" type="button">Ready</button>
              <button id="arenaStartBtn" class="btn ghost" type="button">Start</button>
              <button id="arenaRestartBtn" class="btn ghost" type="button">Restart</button>
            </div>
            <div id="arenaStatus" class="status info">Idle</div>

            <div class="col" style="margin-top:8px;">
              <div class="section-title">Characters</div>
              <div id="arenaCharacterGrid" class="character-grid"></div>
            </div>

            <div class="col">
              <div class="section-title">Roster</div>
              <div id="arenaRoster" class="list"></div>
            </div>

            <div class="col">
              <div class="section-title">Chat</div>
              <div id="arenaChatLog" class="chat-log"></div>
              <form id="arenaChatForm" class="row">
                <input id="arenaChatInput" class="stretch" placeholder="Message">
                <button class="btn secondary" type="submit">Send</button>
              </form>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="row wrap">
              <span id="arenaRoomBadge" class="badge">Room -</span>
              <span id="arenaStateBadge" class="badge">waiting</span>
            </div>
            <div class="row wrap">
              <span id="arenaTimeBadge" class="badge">0:00</span>
              <span id="arenaDebugBadge" class="badge">tick -</span>
            </div>
          </div>
          <div class="card-body col">
            <div class="canvas-wrap">
              <canvas id="arenaCanvas" style="height:min(72vh, 680px);"></canvas>
            </div>
            <div class="row wrap">
              <label class="row">
                <input id="arenaSoundToggle" type="checkbox" style="width:auto">
                <span>Sound</span>
              </label>
              <label class="stretch">Volume
                <input id="arenaSoundVol" type="range" min="0" max="0.3" step="0.01" value="0.08">
              </label>
            </div>
            <div class="status info" id="arenaEventLine">No events</div>
          </div>
        </div>
      </div>
    `;

    this.renderer = new ArenaRenderer($("#arenaCanvas", this.root));
    this.keyInput = createKeyInput();
    const self = this;
    this.renderer.setInputState({
      get up() { return self.keyInput.state.w; },
      get down() { return self.keyInput.state.s; },
      get left() { return self.keyInput.state.a; },
      get right() { return self.keyInput.state.d; },
    });
    window.addEventListener("resize", () => this.renderer.resize());
    this.renderer.resize();

    $("#arenaJoinBtn", this.root).addEventListener("click", () => this.joinFromInputs());
    $("#arenaCopyBtn", this.root).addEventListener("click", () => this.copyLink());
    $("#arenaReadyBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_ready", ready: !this.readyLocal }));
    $("#arenaStartBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_start" }));
    $("#arenaRestartBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "arena_restart" }));
    $("#arenaChatForm", this.root).addEventListener("submit", (e) => this.sendChat(e));
    $("#arenaSoundToggle", this.root).addEventListener("change", (e) => this.ctx.setSoundEnabled(!!e.target.checked));
    $("#arenaSoundVol", this.root).addEventListener("input", (e) => this.ctx.setSoundVolume(Number(e.target.value)));

    this.loadCharacters();
    this.startLoop();
    return this.root;
  }

  async loadCharacters() {
    try {
      const res = await fetch("/assets/characters.json");
      this.characters = await res.json();
    } catch {
      this.characters = [];
    }
    if (!Array.isArray(this.characters)) this.characters = [];
    this.renderCharacterGrid();
  }

  startLoop() {
    const frame = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.active) {
        this.inputAccum += dt;
        if (this.inputAccum >= 1 / 30 && this.roomKey) {
          this.inputAccum = 0;
          this.inputSeq += 1;
          this.ctx.ws.send(toArenaInputPayload(this.keyInput.state, this.inputSeq));
        }
        this.renderer.update(dt);
      }
      this.renderer.draw();
      this.loopHandle = requestAnimationFrame(frame);
    };
    this.loopHandle = requestAnimationFrame(frame);
  }

  stopLoop() {
    if (this.loopHandle) cancelAnimationFrame(this.loopHandle);
    this.loopHandle = 0;
  }

  routeParamsToState(route) {
    const p = route?.params || {};
    if (p.room) this.roomId = String(p.room).toLowerCase();
    if (p.mode) this.mode = String(p.mode).toLowerCase();
    if (p.seconds) this.seconds = Math.max(60, Math.min(120, Number(p.seconds) || 90));
  }

  async show(route) {
    this.active = true;
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    this.routeParamsToState(route);
    const match = this.ctx.lastMatchFound;
    if (match?.kind === "arena") {
      this.roomId = match.room_id;
      this.mode = match.mode || this.mode;
    }
    $("#arenaRoomId", this.root).value = this.roomId;
    $("#arenaMode", this.root).value = this.mode;
    $("#arenaSeconds", this.root).value = String(this.seconds);
    $("#arenaSoundToggle", this.root).checked = !!this.ctx.soundEnabled;
    $("#arenaSoundVol", this.root).value = String(this.ctx.soundVolume ?? 0.08);
    this.renderer.setMyUserId(this.ctx.me?.id);

    if (this.roomId) {
      this.joinRoom(this.roomId, this.mode, this.seconds);
    }
  }

  hide() {
    this.active = false;
    if (this.joinedRoomId) {
      this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: this.joinedRoomId });
    }
    this.roomKey = null;
    this.joinedRoomId = null;
    this.state = null;
    this.roster = null;
    this.renderRoster();
    this.updateStatus();
  }

  joinFromInputs() {
    const room = ($("#arenaRoomId", this.root).value || "arena").trim().toLowerCase() || "arena";
    const mode = $("#arenaMode", this.root).value;
    const seconds = Math.max(60, Math.min(120, Number($("#arenaSeconds", this.root).value) || 90));
    this.ctx.navigate("arena", { room, mode, seconds });
    this.joinRoom(room, mode, seconds);
  }

  joinRoom(roomId, mode, seconds) {
    if (this.joinedRoomId && this.joinedRoomId !== roomId) {
      this.ctx.ws.send({ type: "leave_room", kind: "arena", room_id: this.joinedRoomId });
      this.roomKey = null;
    }
    this.roomId = roomId;
    this.mode = mode;
    this.seconds = seconds;
    this.ctx.setScreenLoading("Joining…", true);
    this.ctx.ws.send({
      type: "join_room",
      kind: "arena",
      room_id: this.roomId,
      arena_mode_name: this.mode,
      match_seconds: this.seconds,
    });
    setTimeout(() => this.ctx.setScreenLoading("", false), 500);
  }

  copyLink() {
    copyToClipboard(buildHashUrl("arena", { room: this.roomId, mode: this.mode, seconds: this.seconds }))
      .then(() => this.ctx.notify.toast("Link copied", { tone: "success" }));
  }

  sendChat(ev) {
    ev.preventDefault();
    const text = ($("#arenaChatInput", this.root).value || "").trim();
    if (!text || !this.roomKey) return;
    this.ctx.ws.send({ type: "room_chat", room_key: this.roomKey, text });
    $("#arenaChatInput", this.root).value = "";
  }

  addChat(text) {
    const log = $("#arenaChatLog", this.root);
    const line = document.createElement("div");
    line.className = "chat-line";
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 120) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    this.renderer.addChatLine(text);
  }

  renderCharacterGrid() {
    const grid = $("#arenaCharacterGrid", this.root);
    if (!this.characters.length) {
      grid.innerHTML = `<div class="empty-state">Loading…</div>`;
      return;
    }
    grid.innerHTML = this.characters.map((c) => `
      <button type="button" class="character-card ${this.selectedChar === c.id ? "active" : ""}" data-char="${c.id}">
        <div class="row space">
          <div class="name">${escapeHtml(c.display_name)}</div>
          <span style="width:10px;height:10px;border-radius:50%;background:${c.color};display:inline-block"></span>
        </div>
        <div class="meta">${escapeHtml(c.archetype)}</div>
        <div class="meta">HP ${c.stats?.hp} · SPD ${c.stats?.speed}</div>
      </button>
    `).join("");
    $$("[data-char]", grid).forEach((btn) => btn.addEventListener("click", () => {
      this.selectedChar = btn.dataset.char;
      this.renderCharacterGrid();
      this.ctx.ws.send({ type: "arena_select", character_id: this.selectedChar });
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
            <div class="tiny muted">${escapeHtml(meta.character_name || live.character_id || "-")} · Team ${live.team ?? meta.team ?? "-"}</div>
            <div class="tiny muted">KOs ${live.score_kos ?? 0} · D ${live.score_deaths ?? 0} · HP ${Math.round(live.hp ?? 0)}/${Math.round(live.max_hp ?? 0)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  updateStatus() {
    const st = this.state?.state || this.roster?.state || "idle";
    const line = $("#arenaStatus", this.root);
    line.className = `status ${st === "running" ? "success" : "info"}`;
    line.textContent = `Room ${this.roomKey || "-"} · ${this.mode} · ${st}`;
    $("#arenaRoomBadge", this.root).textContent = `Room ${this.roomId || "-"}`;
    $("#arenaStateBadge", this.root).textContent = st;
    $("#arenaTimeBadge", this.root).textContent = this.state ? `${Math.max(0, Math.ceil(this.state.time_left || 0))}s` : "-";
    $("#arenaDebugBadge", this.root).textContent = `tick ${this.state?.tick ?? "-"}`;
    const ev = (this.state?.events || []).slice(-1)[0];
    $("#arenaEventLine", this.root).textContent = ev ? JSON.stringify(ev) : "No events";
    this.readyLocal = Boolean((this.state?.ready || this.roster?.ready || []).map(Number).includes(Number(this.ctx.me?.id)));
    $("#arenaReadyBtn", this.root).textContent = this.readyLocal ? "Unready" : "Ready";
  }

  onEvent(msg) {
    if (msg.type === "room_joined" && msg.kind === "arena" && msg.room_id === this.roomId) {
      this.roomKey = msg.room_key;
      this.joinedRoomId = msg.room_id;
      this.ctx.setScreenLoading("", false);
      this.updateStatus();
      return;
    }
    if (msg.type === "arena_roster" && msg.room_id === this.roomId) {
      this.roster = msg;
      const mine = (msg.fighters || {})[this.ctx.me?.id] || (msg.fighters || {})[String(this.ctx.me?.id)];
      if (mine?.character_id && !this.selectedChar) {
        this.selectedChar = mine.character_id;
        this.renderCharacterGrid();
      }
      this.renderRoster();
      this.updateStatus();
      return;
    }
    if (msg.type === "arena_state" && msg.room_id === this.roomId) {
      this.state = msg;
      this.renderer.applySnapshot(msg);
      this.renderRoster();
      this.updateStatus();
      for (const ev of msg.events || []) {
        if (ev.kind === "hit") audio.beep(520, 0.05, "square");
        if (ev.kind === "ko") audio.beep(220, 0.12, "sawtooth");
        if (ev.kind === "buff") audio.beep(680, 0.08, "triangle");
      }
      return;
    }
    if (msg.type === "arena_start" && msg.room_id === this.roomId) {
      this.ctx.notify.toast("Match started", { tone: "success" });
      return;
    }
    if (msg.type === "arena_end" && msg.room_id === this.roomId) {
      this.ctx.notify.toast(`Match ended: ${msg.reason}`, { tone: "info" });
      return;
    }
    if (msg.type === "room_chat" && msg.room_key && msg.room_key === this.roomKey) {
      this.addChat(`[${new Date((msg.created_at || 0) * 1000).toLocaleTimeString()}] ${msg.from_name}: ${msg.text}`);
      return;
    }
    if (msg.type === "room_error") {
      this.ctx.notify.toast("Room error", { tone: "error" });
    }
    if (msg.type === "match_found" && msg.kind === "arena") {
      this.ctx.setScreenLoading("Match found", true);
      setTimeout(() => this.ctx.setScreenLoading("", false), 800);
    }
  }
}
