import { audio } from "../audio.js";
import { buildHashUrl, copyToClipboard } from "../net.js";
import { $, $$, createEl, escapeHtml } from "../ui.js";

const CHESS_PIECES = {
  K: "&#9812;",
  Q: "&#9813;",
  R: "&#9814;",
  B: "&#9815;",
  N: "&#9816;",
  P: "&#9817;",
  k: "&#9818;",
  q: "&#9819;",
  r: "&#9820;",
  b: "&#9821;",
  n: "&#9822;",
  p: "&#9823;",
  ".": "",
};

function formatChessClock(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function chessSquareName(rankIndex, fileIndex) {
  return "abcdefgh"[fileIndex] + String(8 - rankIndex);
}

export class MiniGamesScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "minigames";
    this.title = "Mini-Games";
    this.root = null;
    this.activeRoute = "minigames"; // minigames | pong
    this.joinedKind = null;
    this.roomId = "room";
    this.roomKey = null;
    this.joinedRoomId = null;
    this.seat = "spectator";
    this.pongState = null;
    this.pongRoster = { players: [], spectators: [] };
    this.pongResult = null;
    this.pongKeys = { up: false, down: false };
    this.pongInputTimer = null;

    this.reactionState = null;
    this.typingState = null;
    this.typingInputText = "";
    this.typingRoundStartedAt = 0;
    this.typingStats = { wpm: 0, acc: 100, elapsed: 0 };
    this.chessState = null;
    this.chessSeat = "spectator";
    this.chessSelectedSq = null;
    this.chessLastUci = "";

  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Mini-Games</h2>
          <p id="miniHeaderHelper">Select a game from the library or jump directly into a room.</p>
        </div>
        <div class="page-actions tabs" id="miniTabs">
          <button class="tab-btn" data-mini-route="minigames" type="button">Library</button>
          <button class="tab-btn" data-mini-route="pong" type="button">Pong</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Active mode</span>
          <strong id="miniSummaryMode" class="stat-value">Library</strong>
          <span class="stat-note">Current game route</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Room</span>
          <strong id="miniSummaryRoom" class="stat-value">room</strong>
          <span class="stat-note">Current room link</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Module state</span>
          <strong id="miniSummaryState" class="stat-value">Idle</strong>
          <span class="stat-note">Current room lifecycle</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Seat</span>
          <strong id="miniSummarySeat" class="stat-value">None</strong>
          <span class="stat-note">Joined role in the current room</span>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Room controls</h3>
            <p class="helper">Join a private room, copy the current link, or restart the active game.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <div class="toolbar">
            <label class="stretch">Room
              <input id="miniRoomInput" value="room">
            </label>
            <button id="miniJoinBtn" class="btn primary" type="button">Join</button>
            <button id="miniCopyBtn" class="btn secondary" type="button">Copy link</button>
            <button id="miniRestartBtn" class="btn ghost" type="button">Restart</button>
            <span id="miniRoomBadge" class="badge">Room -</span>
            <span id="miniStateBadge" class="badge">state -</span>
          </div>
          <div id="miniStatus" class="status info">Ready</div>
        </div>
      </section>

      <section id="miniMenuPanel" class="panel">
        <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Library</h3>
            <p class="helper">Registered V1 modules only. Use direct rooms for LAN play and invites.</p>
            </div>
        </div>
        <div class="panel-body">
          <div class="launcher-grid game-center-grid">
            <div class="game-card game-card-arena">
              <div class="game-card-media"><img src="/assets/arena-marquee.png" alt="Arena game marquee"></div>
              <span class="stat-label">Arena</span>
              <strong>Flagship platform fighter</strong>
              <span class="stat-note">Practice, private rooms, character select, and match rewards.</span>
              <div class="row wrap">
                <button class="btn primary" type="button" data-open-route="play">Open Play</button>
              </div>
            </div>
            <div class="game-card game-card-pong">
              <div class="game-card-media"><img src="/assets/pong-marquee.png" alt="Pong game marquee"></div>
              <span class="stat-label">Pong</span>
              <strong>Head-to-head paddle duel</strong>
              <span class="stat-note">Direct room, clean HUD, live results, and leaderboard pressure.</span>
              <div class="row wrap">
                <button class="btn primary" type="button" data-open-route="pong">Open Pong</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pongPanel" class="panel hidden pong-module-panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Pong</h3>
            <p class="helper">Private paddle rooms with Host-owned ball physics and leaderboard results.</p>
          </div>
          <div class="pong-scoreline">
            <strong id="pongScoreLeft">0</strong>
            <span>:</span>
            <strong id="pongScoreRight">0</strong>
          </div>
        </div>
        <div class="panel-body pong-module-layout">
          <aside class="pong-info-rail">
            <div class="game-card-media compact"><img src="/assets/pong-marquee.png" alt="Pong module art"></div>
            <div class="stat-card">
              <span class="metric-label">Room state</span>
              <strong id="pongRoomState">Waiting</strong>
              <span id="pongRoomNote" class="muted">Join a room to take a paddle.</span>
            </div>
            <div class="detail-section">
              <h4>Controls</h4>
              <div class="control-hints">
                <span><kbd>W</kbd> or <kbd>Up</kbd> Move up</span>
                <span><kbd>S</kbd> or <kbd>Down</kbd> Move down</span>
                <span>First two players take paddles; extras spectate.</span>
              </div>
            </div>
            <div class="detail-section">
              <h4>Roster</h4>
              <div id="pongRosterList" class="list"></div>
            </div>
          </aside>
          <div class="pong-playfield-wrap">
            <div class="pong-hud-strip">
              <span id="pongTimeLeft" class="badge">60s</span>
              <span id="pongSlotBadge" class="badge">Spectator</span>
              <span id="pongResultBadge" class="badge">First to 5</span>
            </div>
            <div class="pong-stage"><canvas id="pongCanvas" style="height:420px;"></canvas></div>
            <div id="pongResultOverlay" class="pong-result-overlay hidden"></div>
          </div>
        </div>
      </section>

      <section id="reactionPanel" class="panel hidden">
        <div class="panel-header"><h3 class="section-title">Reaction</h3></div>
        <div class="panel-body col">
          <div id="reactionStatus" class="status info">Join a room</div>
          <div class="row wrap">
            <button id="reactionPressBtn" class="btn primary" type="button">PRESS</button>
            <span class="helper">Space also works</span>
          </div>
        </div>
      </section>

      <section id="typingPanel" class="panel hidden">
        <div class="panel-header">
          <h3 class="section-title">Typing</h3>
          <div class="typing-stats">
            <span>WPM <strong id="typingWpm">0</strong></span>
            <span>ACC <strong id="typingAcc">100%</strong></span>
            <span>TIME <strong id="typingTime">0.0s</strong></span>
          </div>
        </div>
        <div class="panel-body col">
          <div class="typing-ux">
            <div id="typingPromptView" class="typing-prompt"></div>
            <div class="helper" id="typingRoundInfo">Join a room</div>
          </div>
          <form id="typingForm" class="row">
            <input id="typingInput" class="stretch" autocomplete="off" spellcheck="false" placeholder="Type and press Enter">
            <button class="btn primary" type="submit">Submit</button>
          </form>
          <div class="helper">Enter = submit | Enter again = restart (after end)</div>
        </div>
      </section>

      <section id="chessPanel" class="panel hidden">
        <div class="panel-header">
          <div>
            <h3 class="section-title">Chess</h3>
            <span class="helper">Classic 1v1 with spectator support and clocks</span>
          </div>
          <div class="typing-stats">
            <span>WHITE <strong id="miniChessWhiteClock">5:00</strong></span>
            <span>BLACK <strong id="miniChessBlackClock">5:00</strong></span>
          </div>
        </div>
        <div class="card-body chess-layout">
          <div class="col">
            <div class="row wrap">
              <span id="miniChessSeatBadge" class="badge">Seat Spectator</span>
              <span id="miniChessTurnBadge" class="badge">Turn -</span>
              <span id="miniChessPlayers" class="helper">White open | Black open</span>
            </div>
            <div id="miniChessBoard" class="chess-board"></div>
            <div class="row wrap">
              <label>Promotion
                <select id="miniChessPromotion">
                  <option value="q">Queen</option>
                  <option value="r">Rook</option>
                  <option value="b">Bishop</option>
                  <option value="n">Knight</option>
                </select>
              </label>
              <button id="chessOfferDrawBtn" class="btn secondary" type="button">Offer Draw</button>
              <button id="chessAcceptDrawBtn" class="btn ghost" type="button">Accept Draw</button>
              <button id="chessResignBtn" class="btn danger" type="button">Resign</button>
            </div>
            <div id="miniChessStatus" class="status info">Join a room</div>
            <div id="miniChessDrawOffer" class="helper">No active draw offer.</div>
          </div>
          <div class="panel inset">
            <div class="panel-header">
              <div>
                <h4 class="section-title">Match Log</h4>
                <span class="helper">Latest moves in the current room</span>
              </div>
            </div>
            <div class="panel-body col">
              <div id="miniChessMoves" class="list" style="max-height:320px;overflow:auto;"></div>
            </div>
          </div>
        </div>
      </section>

    `;

    this.wireUI();
    this.bindPongKeys();
    this.pongInputTimer = setInterval(() => {
      if (this.ctx.route?.name === "pong" && this.joinedKind === "pong" && this.roomKey) {
        this.ctx.ws.send({ type: "pong_input", up: this.pongKeys.up, down: this.pongKeys.down });
      }
    }, 40);
    this.startPongRenderLoop();
    this.startTypingTicker();
    this.renderChess();
    return this.root;
  }

  wireUI() {
    $$("[data-mini-route]", this.root).forEach((btn) => btn.addEventListener("click", () => {
      const next = btn.dataset.miniRoute;
      this.ctx.navigate(next, { room: this.roomId || "room" });
    }));
    $$("[data-open-route]", this.root).forEach((btn) => btn.addEventListener("click", () => {
      this.ctx.navigate(btn.dataset.openRoute, { room: this.roomId || "room" });
    }));
    $("#miniJoinBtn", this.root).addEventListener("click", () => this.joinCurrentRoute());
    $("#miniCopyBtn", this.root).addEventListener("click", () => this.copyCurrentRoute());
    $("#miniRestartBtn", this.root).addEventListener("click", () => this.restartCurrent());
    $("#reactionPressBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "reaction_press" }));
    $("#typingForm", this.root).addEventListener("submit", (e) => this.submitTyping(e));
    $("#typingInput", this.root).addEventListener("input", () => this.updateTypingPreview());
    $("#typingInput", this.root).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.typingState?.state === "ended" && !($("#typingInput", this.root).value || "").trim()) {
        e.preventDefault();
        this.ctx.ws.send({ type: "typing_restart" });
      }
    });
    $("#chessOfferDrawBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_offer_draw" }));
    $("#chessAcceptDrawBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_accept_draw" }));
    $("#chessResignBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_resign" }));
    window.addEventListener("keydown", (e) => {
      if (!this.ctx.isScreenActive(this)) return;
      if (this.activeRoute === "reaction" && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        this.ctx.ws.send({ type: "reaction_press" });
      }
    });
  }

  bindPongKeys() {
    window.addEventListener("keydown", (e) => {
      if (!this.ctx.isScreenActive(this) || this.activeRoute !== "pong") return;
      const k = String(e.key).toLowerCase();
      if (k === "w" || k === "arrowup") { this.pongKeys.up = true; e.preventDefault(); }
      if (k === "s" || k === "arrowdown") { this.pongKeys.down = true; e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => {
      const k = String(e.key).toLowerCase();
      if (k === "w" || k === "arrowup") { this.pongKeys.up = false; }
      if (k === "s" || k === "arrowdown") { this.pongKeys.down = false; }
    });
    window.addEventListener("blur", () => {
      this.pongKeys.up = false;
      this.pongKeys.down = false;
    });
  }

  kindForRoute(routeName) {
    if (["pong"].includes(routeName)) return routeName;
    return null;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.activeRoute = route?.name || "minigames";
    this.roomId = String(route?.params?.room || this.ctx.lastMatchFound?.room_id || this.roomId || "room").toLowerCase();
    $("#miniRoomInput", this.root).value = this.roomId;
    this.ctx.setGlobalSearchValue("");
    this.ctx.setTopbar("Mini-Games", this.activeRoute === "minigames" ? "" : this.activeRoute.charAt(0).toUpperCase() + this.activeRoute.slice(1));
    this.renderRoute();

    const routeKind = this.kindForRoute(this.activeRoute);
    if (routeKind) {
      const mf = this.ctx.lastMatchFound;
      if (mf?.kind === routeKind) this.roomId = mf.room_id;
      $("#miniRoomInput", this.root).value = this.roomId;
      this.joinCurrentRoute();
    }
  }

  hide() {
    if (this.joinedKind && this.joinedRoomId) {
      this.ctx.ws.send({ type: "leave_room", kind: this.joinedKind, room_id: this.joinedRoomId });
    }
    this.joinedKind = null;
    this.roomKey = null;
    this.joinedRoomId = null;
    this.chessSelectedSq = null;
  }

  renderRoute() {
    const panels = ["miniMenuPanel", "pongPanel", "reactionPanel", "typingPanel", "chessPanel"];
    panels.forEach((id) => $("#" + id, this.root)?.classList.add("hidden"));
    if (this.activeRoute === "pong") $("#pongPanel", this.root).classList.remove("hidden");
    else if (this.activeRoute === "reaction") $("#reactionPanel", this.root).classList.remove("hidden");
    else if (this.activeRoute === "typing") $("#typingPanel", this.root).classList.remove("hidden");
    else if (this.activeRoute === "chess") $("#chessPanel", this.root).classList.remove("hidden");
    else $("#miniMenuPanel", this.root).classList.remove("hidden");

    $$("[data-mini-route]", this.root).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.miniRoute === this.activeRoute || (this.activeRoute === "minigames" && btn.dataset.miniRoute === "minigames"));
    });
    $("#miniHeaderHelper", this.root).textContent = this.activeRoute === "minigames" ? "Select a registered V1 module." : `${this.activeRoute} room view`;
    this.renderMiniStatus();
    this.renderPongStatus();
    this.renderReaction();
    this.renderTyping();
    this.renderChess();
  }

  currentKind() {
    return this.kindForRoute(this.activeRoute);
  }

  joinCurrentRoute() {
    const kind = this.currentKind();
    if (!kind) return;
    const nextRoomId = ($("#miniRoomInput", this.root).value || "room").trim().toLowerCase() || "room";
    if (this.joinedKind && this.joinedRoomId && (this.joinedKind !== kind || this.joinedRoomId !== nextRoomId)) {
      this.ctx.ws.send({ type: "leave_room", kind: this.joinedKind, room_id: this.joinedRoomId });
      this.roomKey = null;
    }
    this.roomId = nextRoomId;
    this.ctx.setScreenLoading("Joining...", true);
    this.ctx.ws.send({ type: "join_room", kind, room_id: this.roomId });
    setTimeout(() => this.ctx.setScreenLoading("", false), 500);
  }

  copyCurrentRoute() {
    const route = this.currentKind() || "minigames";
    const room = ($("#miniRoomInput", this.root).value || this.roomId || "room").trim().toLowerCase() || "room";
    copyToClipboard(buildHashUrl(route, { room })).then(() => this.ctx.notify.toast("Link copied", { tone: "success" }));
  }

  restartCurrent() {
    if (this.activeRoute === "pong") this.ctx.ws.send({ type: "pong_restart" });
    if (this.activeRoute === "reaction") this.ctx.ws.send({ type: "reaction_restart" });
    if (this.activeRoute === "typing") this.ctx.ws.send({ type: "typing_restart" });
    if (this.activeRoute === "chess") this.ctx.ws.send({ type: "chess_restart" });
  }

  renderMiniStatus() {
    const st = $("#miniStatus", this.root);
    const routeKind = this.currentKind();
    const state =
      routeKind === "pong" ? this.pongState?.state :
      routeKind === "reaction" ? this.reactionState?.state :
      routeKind === "typing" ? this.typingState?.state :
      routeKind === "chess" ? this.chessState?.state : "menu";
    st.className = `status ${state === "running" ? "success" : "info"}`;
    st.textContent = routeKind ? `${routeKind} | room ${this.roomId || "-"} | ${state || "waiting"}` : "Select a mini-game";
    $("#miniRoomBadge", this.root).textContent = `Room ${this.roomId || "-"}`;
    $("#miniStateBadge", this.root).textContent = state || "-";
    $("#miniSummaryMode", this.root).textContent = this.activeRoute === "minigames"
      ? "Library"
      : this.activeRoute.charAt(0).toUpperCase() + this.activeRoute.slice(1);
    $("#miniSummaryRoom", this.root).textContent = this.roomId || "-";
    $("#miniSummaryState", this.root).textContent = state || "Idle";
    $("#miniSummarySeat", this.root).textContent = this.chessSeat === "w"
      ? "White"
      : this.chessSeat === "b"
        ? "Black"
        : this.joinedRoomId
          ? "Joined"
          : "None";
    this.renderInspector();
  }

  renderInspector() {
    this.ctx.setInspector({
      title: "Mini-games",
      subtitle: "Room state and module shortcuts",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Route</span><strong>${escapeHtml(this.activeRoute === "minigames" ? "Library" : this.activeRoute)}</strong></div>
          <div class="detail-row"><span class="muted">Room</span><strong>${escapeHtml(this.roomId || "-")}</strong></div>
          <div class="detail-row"><span class="muted">State</span><strong>${escapeHtml(this.currentKind() === "pong" ? (this.pongState?.state || "waiting") : "library")}</strong></div>
          <div class="detail-row"><span class="muted">Joined room</span><strong>${escapeHtml(this.joinedRoomId || "-")}</strong></div>
        </div>
        <div class="inspector-card">
          <button id="miniInspectorLibraryBtn" class="btn secondary" type="button">Open library</button>
          <button id="miniInspectorPlayBtn" class="btn secondary" type="button">Open Play</button>
          <button id="miniInspectorCopyBtn" class="btn secondary" type="button">Copy current link</button>
        </div>
      `,
    });
    const inspectorRoot = document.getElementById("inspectorContent");
    $("#miniInspectorLibraryBtn", inspectorRoot)?.addEventListener("click", () => this.ctx.navigate("minigames"));
    $("#miniInspectorPlayBtn", inspectorRoot)?.addEventListener("click", () => this.ctx.navigate("play"));
    $("#miniInspectorCopyBtn", inspectorRoot)?.addEventListener("click", () => this.copyCurrentRoute());
  }

  renderPongStatus() {
    if (!this.root || this.activeRoute !== "pong") return;
    const state = this.pongState?.state || "waiting";
    const score = this.pongState?.score || { 0: 0, 1: 0 };
    const players = this.pongRoster?.players || this.pongState?.players || [];
    const slot = players.findIndex((uid) => Number(uid) === Number(this.ctx.me?.id));
    $("#pongScoreLeft", this.root).textContent = String(score[0] ?? score["0"] ?? 0);
    $("#pongScoreRight", this.root).textContent = String(score[1] ?? score["1"] ?? 0);
    $("#pongRoomState", this.root).textContent = state.charAt(0).toUpperCase() + state.slice(1);
    $("#pongRoomNote", this.root).textContent = state === "running"
      ? "Match is live. First to 5 or timer wins."
      : state === "ended"
        ? "Match complete. Restart to run it back."
        : "Waiting for two players.";
    $("#pongTimeLeft", this.root).textContent = `${Math.ceil(Number(this.pongState?.time_left ?? 60))}s`;
    $("#pongSlotBadge", this.root).textContent = slot === 0 ? "Left paddle" : slot === 1 ? "Right paddle" : "Spectator";
    $("#pongResultBadge", this.root).textContent = this.pongResult ? "Results ready" : "First to 5";
    const roster = $("#pongRosterList", this.root);
    if (roster) {
      const spectators = this.pongRoster?.spectators || [];
      roster.innerHTML = `
        <div class="list-row"><strong>Left</strong><span>${players[0] ? `User #${escapeHtml(players[0])}` : "Open paddle"}</span></div>
        <div class="list-row"><strong>Right</strong><span>${players[1] ? `User #${escapeHtml(players[1])}` : "Open paddle"}</span></div>
        <div class="list-row"><strong>Spectators</strong><span>${spectators.length}</span></div>
      `;
    }
    const overlay = $("#pongResultOverlay", this.root);
    if (overlay) {
      if (!this.pongResult) {
        overlay.classList.add("hidden");
      } else {
        const result = this.pongResult.result || {};
        const winner = result.winner_user_id ? `User #${result.winner_user_id}` : "Draw";
        const reward = result.rewards?.[String(this.ctx.me?.id || "")];
        const rewardLine = reward
          ? `Your cortisol ${Number(reward.cortisol_delta || 0) >= 0 ? "+" : ""}${reward.cortisol_delta || 0} -> ${reward.cortisol_after}`
          : "Leaderboard and cortisol score updated for completed 1v1 matches.";
        overlay.classList.remove("hidden");
        overlay.innerHTML = `
          <div class="pong-result-card">
            <span class="eyebrow">Match Complete</span>
            <strong>${escapeHtml(winner)}</strong>
            <span>${escapeHtml(this.pongResult.reason || "finished")} | ${score[0] ?? score["0"] ?? 0}:${score[1] ?? score["1"] ?? 0}</span>
            <span class="muted">${escapeHtml(rewardLine)}</span>
            <button id="pongOverlayRestartBtn" class="btn primary" type="button">Run it back</button>
          </div>
        `;
        $("#pongOverlayRestartBtn", overlay)?.addEventListener("click", () => this.restartCurrent());
      }
    }
  }

  startPongRenderLoop() {
    const canvas = $("#pongCanvas", this.root);
    const draw = () => {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || 760;
      const H = canvas.clientHeight || 420;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#08111f");
      bg.addColorStop(0.54, "#101725");
      bg.addColorStop(1, "#05080d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(103,216,255,0.045)";
      for (let x = 0; x < W; x += 38) ctx.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += 38) ctx.fillRect(0, y, W, 1);
      ctx.strokeStyle = "rgba(103,216,255,.22)";
      ctx.lineWidth = 2;
      ctx.strokeRect(14, 14, W - 28, H - 28);
      ctx.strokeStyle = "rgba(98,247,177,.18)";
      ctx.setLineDash([7, 10]);
      ctx.beginPath(); ctx.moveTo(W / 2, 18); ctx.lineTo(W / 2, H - 18); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(98,247,177,0.14)";
      ctx.fillRect(W / 2 - 2, H * 0.18, 4, H * 0.64);
      if (this.pongState) {
        const sx = W / (this.pongState.width || 800);
        const sy = H / (this.pongState.height || 450);
        ctx.fillStyle = "rgba(236,246,255,0.94)";
        ctx.font = "800 34px 'Bahnschrift', system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`${this.pongState.score?.[0] ?? 0}`, W * 0.25, 46);
        ctx.fillText(`${this.pongState.score?.[1] ?? 0}`, W * 0.75, 46);
        const ph = 90 * sy;
        const leftY = (this.pongState.paddles?.left_y || 0) * sy - ph / 2;
        const rightY = (this.pongState.paddles?.right_y || 0) * sy - ph / 2;
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(98,247,177,0.55)";
        ctx.fillStyle = "#62f7b1";
        ctx.fillRect(24, leftY, 12, ph);
        ctx.shadowColor = "rgba(103,216,255,0.55)";
        ctx.fillStyle = "#67d8ff";
        ctx.fillRect(W - 36, rightY, 12, ph);
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.shadowBlur = 22;
        ctx.shadowColor = "rgba(255,215,122,0.8)";
        ctx.fillStyle = "#ffd77a";
        ctx.arc((this.pongState.ball?.x || 0) * sx, (this.pongState.ball?.y || 0) * sy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (this.pongState.state !== "running") {
          ctx.fillStyle = "rgba(5,8,13,0.62)";
          ctx.fillRect(0, H * 0.36, W, H * 0.28);
          ctx.fillStyle = "#edf6ff";
          ctx.font = "800 24px 'Bahnschrift', system-ui";
          ctx.fillText(this.pongState.state === "ended" ? "MATCH COMPLETE" : "WAITING FOR PADDLES", W / 2, H / 2);
        }
      } else {
        ctx.fillStyle = "#9fc6ee";
        ctx.font = "700 18px 'Bahnschrift', system-ui";
        ctx.fillText("Join a Pong room", 24, 34);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  renderReaction() {
    const el = $("#reactionStatus", this.root);
    if (!el) return;
    if (!this.reactionState) {
      el.className = "status info";
      el.textContent = "Join a room";
      return;
    }
    el.className = `status ${this.reactionState.phase === "go" ? "success" : "info"}`;
    const score = Object.entries(this.reactionState.score || {}).map(([id, s]) => `${id}:${s}`).join(" | ") || "0-0";
    el.textContent = `${this.reactionState.state} | ${this.reactionState.phase} | round ${this.reactionState.round} | ${this.reactionState.phase_timer}s | ${score}`;
  }

  startTypingTicker() {
    setInterval(() => {
      if (!this.ctx.isScreenActive(this) || this.activeRoute !== "typing" || !this.typingRoundStartedAt) return;
      if (!this.typingState?.round_open) return;
      this.recalcTypingStats();
      this.renderTypingStats();
    }, 120);
  }

  recalcTypingStats() {
    const prompt = this.typingState?.phrase || "";
    const typed = this.typingInputText || "";
    const elapsed = Math.max(0.1, (Date.now() - this.typingRoundStartedAt) / 1000);
    let correctChars = 0;
    let checked = 0;
    for (let i = 0; i < typed.length; i++) {
      checked += 1;
      if (typed[i] === prompt[i]) correctChars += 1;
    }
    const acc = checked ? (correctChars / checked) * 100 : 100;
    const words = correctChars / 5;
    const wpm = (words / elapsed) * 60;
    this.typingStats = { wpm: Math.round(wpm), acc: Math.round(acc), elapsed };
  }

  renderTypingStats() {
    $("#typingWpm", this.root).textContent = String(this.typingStats.wpm || 0);
    $("#typingAcc", this.root).textContent = `${this.typingStats.acc || 100}%`;
    $("#typingTime", this.root).textContent = `${(this.typingStats.elapsed || 0).toFixed(1)}s`;
  }

  updateTypingPreview() {
    this.typingInputText = $("#typingInput", this.root).value || "";
    this.recalcTypingStats();
    this.renderTyping();
  }

  renderTyping() {
    const prompt = this.typingState?.phrase || "";
    const typed = this.typingInputText || "";
    const view = $("#typingPromptView", this.root);
    if (!prompt) {
      view.innerHTML = `<span class="typing-char">Join a room</span>`;
      $("#typingRoundInfo", this.root).textContent = "Join a room";
      this.renderTypingStats();
      return;
    }
    const chars = [];
    for (let i = 0; i < prompt.length; i++) {
      const p = prompt[i];
      let cls = "typing-char";
      if (i < typed.length) cls += typed[i] === p ? " correct" : " incorrect";
      if (i === typed.length) cls += " caret";
      chars.push(`<span class="${cls}">${escapeHtml(p)}</span>`);
    }
    if (typed.length > prompt.length) {
      for (let i = prompt.length; i < typed.length; i++) {
        chars.push(`<span class="typing-char incorrect">${escapeHtml(typed[i])}</span>`);
      }
    }
    view.innerHTML = chars.join("");
    const score = Object.entries(this.typingState?.score || {}).map(([id, s]) => `${id}:${s}`).join(" | ") || "0-0";
    $("#typingRoundInfo", this.root).textContent = `${this.typingState?.state || "waiting"} | round ${this.typingState?.round || 0} | ${score}`;
    this.renderTypingStats();
  }

  renderChess() {
    const board = $("#miniChessBoard", this.root);
    if (!board) return;

    const players = this.chessState?.players || {};
    const seatText = this.chessSeat === "w" ? "White" : this.chessSeat === "b" ? "Black" : "Spectator";
    $("#miniChessSeatBadge", this.root).textContent = `Seat ${seatText}`;
    $("#miniChessTurnBadge", this.root).textContent = this.chessState ? `Turn ${this.chessState.turn === "w" ? "White" : "Black"}` : "Turn -";
    $("#miniChessWhiteClock", this.root).textContent = formatChessClock(this.chessState?.clocks_ms?.w ?? 5 * 60 * 1000);
    $("#miniChessBlackClock", this.root).textContent = formatChessClock(this.chessState?.clocks_ms?.b ?? 5 * 60 * 1000);
    const whitePlayer = players.w ? `White #${players.w}` : "White open";
    const blackPlayer = players.b ? `Black #${players.b}` : "Black open";
    $("#miniChessPlayers", this.root).textContent = `${whitePlayer} | ${blackPlayer}`;

    const statusEl = $("#miniChessStatus", this.root);
    if (!this.chessState) {
      statusEl.className = "status info";
      statusEl.textContent = "Join a room";
    } else {
      const statusTone = this.chessState.status === "ongoing" ? (this.chessState.state === "running" ? "success" : "info") : "warn";
      statusEl.className = `status ${statusTone}`;
      const winner = this.chessState.winner ? ` | winner ${this.chessState.winner === "w" ? "White" : "Black"}` : "";
      const drawReason = this.chessState.draw_reason ? ` | ${this.chessState.draw_reason}` : "";
      statusEl.textContent = `${this.chessState.state} | ${this.chessState.status}${winner}${drawReason}`;
    }

    $("#miniChessDrawOffer", this.root).textContent = this.chessState?.draw_offer_from
      ? `Draw offer from ${this.chessState.draw_offer_from === "w" ? "White" : "Black"}`
      : "No active draw offer.";

    const canAct = Boolean(this.chessState) && this.chessState.status === "ongoing" && ["w", "b"].includes(this.chessSeat);
    $("#chessOfferDrawBtn", this.root).disabled = !canAct;
    $("#chessResignBtn", this.root).disabled = !canAct;
    $("#chessAcceptDrawBtn", this.root).disabled =
      !canAct ||
      !this.chessState?.draw_offer_from ||
      this.chessState.draw_offer_from === this.chessSeat;

    this.renderChessBoard();
    this.renderChessMoves();
  }

  renderChessBoard() {
    const board = $("#miniChessBoard", this.root);
    if (!board) return;
    const rows = this.chessState?.board || Array.from({ length: 8 }, () => Array(8).fill("."));
    const lastFrom = this.chessLastUci?.slice(0, 2);
    const lastTo = this.chessLastUci?.slice(2, 4);
    let html = "";
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = chessSquareName(r, f);
        const piece = rows[r]?.[f] || ".";
        const light = (r + f) % 2 === 0;
        const cls = [
          "chess-square",
          light ? "light" : "dark",
          this.chessSelectedSq === sq ? "selected" : "",
          sq === lastFrom || sq === lastTo ? "lastmove" : "",
        ].filter(Boolean).join(" ");
        html += `<button type="button" class="${cls}" data-sq="${sq}" aria-label="${sq}">${CHESS_PIECES[piece] || ""}</button>`;
      }
    }
    board.innerHTML = html;
    $$("[data-sq]", board).forEach((btn) => btn.addEventListener("click", () => this.handleChessSquare(btn.dataset.sq)));
  }

  renderChessMoves() {
    const list = $("#miniChessMoves", this.root);
    if (!list) return;
    const moves = this.chessState?.moves || [];
    if (!moves.length) {
      list.innerHTML = `<div class="muted">No moves yet.</div>`;
      return;
    }
    list.innerHTML = moves.map((move) => {
      const side = move.side === "w" ? "White" : "Black";
      return `<div class="list-row"><strong>#${escapeHtml(String(move.ply || ""))}</strong><span>${side}</span><span>${escapeHtml(move.move || "")}</span></div>`;
    }).join("");
    list.scrollTop = list.scrollHeight;
  }

  handleChessSquare(square) {
    if (this.activeRoute !== "chess" || !this.chessState || this.chessState.status !== "ongoing") return;
    if (!["w", "b"].includes(this.chessSeat)) return;
    if (!this.chessSelectedSq) {
      this.chessSelectedSq = square;
      this.renderChessBoard();
      return;
    }
    if (this.chessSelectedSq === square) {
      this.chessSelectedSq = null;
      this.renderChessBoard();
      return;
    }
    const promotion = $("#miniChessPromotion", this.root).value || "q";
    this.ctx.ws.send({ type: "chess_move", from: this.chessSelectedSq, to: square, promotion });
    this.chessSelectedSq = null;
    this.renderChessBoard();
  }

  submitTyping(ev) {
    ev.preventDefault();
    const text = $("#typingInput", this.root).value || "";
    if (this.typingState?.state === "ended" && !text.trim()) {
      this.ctx.ws.send({ type: "typing_restart" });
      return;
    }
    this.ctx.ws.send({ type: "typing_submit", text });
  }

  onRoomJoined(msg) {
    const routeKind = this.currentKind();
    if (!routeKind || msg.kind !== routeKind) return;
    this.joinedKind = msg.kind;
    this.roomKey = msg.room_key;
    this.roomId = msg.room_id;
    this.joinedRoomId = msg.room_id;
    if (msg.kind === "pong") {
      this.pongResult = null;
      this.pongRoster = { players: msg.players || this.pongRoster.players || [], spectators: msg.spectators || [] };
    }
    if (msg.kind === "chess" && msg.seat) {
      this.chessSeat = msg.seat;
      this.chessSelectedSq = null;
    }
    $("#miniRoomInput", this.root).value = this.roomId;
    this.ctx.setScreenLoading("", false);
    this.renderMiniStatus();
    this.renderPongStatus();
    this.renderChess();
  }

  onEvent(msg) {
    if (msg.type === "queue_status") {
      return;
    }
    if (msg.type === "room_joined") return this.onRoomJoined(msg);
    if (msg.type === "pong_roster" && msg.room_id === this.roomId) {
      this.pongRoster = { players: msg.players || [], spectators: msg.spectators || [] };
      this.renderPongStatus();
      return;
    }

    if (msg.type === "pong_state") {
      if (msg.room_id === this.roomId) {
        this.pongState = msg;
        this.renderMiniStatus();
        this.renderPongStatus();
      }
      return;
    }
    if (msg.type === "pong_end" && msg.room_id === this.roomId) {
      this.pongResult = msg;
      this.pongState = { ...(this.pongState || {}), state: "ended", score: msg.score || this.pongState?.score || { 0: 0, 1: 0 } };
      this.renderMiniStatus();
      this.renderPongStatus();
      this.ctx.notify.toast("Pong match complete", { tone: "info" });
      audio.beep(220, 0.12, "sawtooth");
      return;
    }
    if (msg.type === "pong_point" && msg.room_id === this.roomId) {
      audio.beep(660, 0.08, "triangle");
      return;
    }
    if (msg.type === "pong_paddle_hit" && msg.room_id === this.roomId) {
      audio.beep(420, 0.045, "square");
      return;
    }
    if (msg.type === "pong_wall_hit" && msg.room_id === this.roomId) {
      audio.beep(280, 0.035, "sine");
      return;
    }

    if (msg.type === "reaction_state" && msg.room_id === this.roomId) {
      this.reactionState = msg;
      this.renderReaction();
      this.renderMiniStatus();
      return;
    }
    if (["reaction_go", "reaction_round_win", "reaction_false_start", "reaction_end"].includes(msg.type) && msg.room_id === this.roomId) {
      if (msg.type === "reaction_go") this.ctx.notify.toast("GO", { tone: "success", timeout: 900 });
      if (msg.type === "reaction_end") this.ctx.notify.toast("Reaction ended", { tone: "info" });
      return;
    }

    if (msg.type === "typing_state" && msg.room_id === this.roomId) {
      this.typingState = msg;
      this.renderTyping();
      this.renderMiniStatus();
      return;
    }
    if (msg.type === "typing_round" && msg.room_id === this.roomId) {
      this.typingState = { ...(this.typingState || {}), ...msg, phrase: msg.phrase, round_open: true };
      this.typingRoundStartedAt = Date.now();
      this.typingInputText = "";
      $("#typingInput", this.root).value = "";
      this.typingStats = { wpm: 0, acc: 100, elapsed: 0 };
      this.renderTyping();
      return;
    }
    if (msg.type === "typing_round_win" && msg.room_id === this.roomId) {
      this.ctx.notify.toast(`Round win: ${msg.user_id}`, { tone: "success" });
      return;
    }
    if (msg.type === "typing_incorrect" && msg.room_id === this.roomId && Number(msg.user_id) === Number(this.ctx.me.id)) {
      this.ctx.notify.toast("Incorrect", { tone: "error", timeout: 1000 });
      return;
    }
    if (msg.type === "typing_end" && msg.room_id === this.roomId) {
      this.ctx.notify.toast("Typing ended", { tone: "info" });
      return;
    }

    if (msg.type === "chess_roster" && msg.room_id === this.roomId) {
      const players = msg.players || {};
      if (Number(players.w) === Number(this.ctx.me.id)) this.chessSeat = "w";
      else if (Number(players.b) === Number(this.ctx.me.id)) this.chessSeat = "b";
      else this.chessSeat = "spectator";
      this.chessState = { ...(this.chessState || {}), players, spectators: msg.spectators || [] };
      this.renderChess();
      this.renderMiniStatus();
      return;
    }
    if (msg.type === "chess_state" && msg.room_id === this.roomId) {
      this.chessState = msg;
      const players = msg.players || {};
      if (Number(players.w) === Number(this.ctx.me.id)) this.chessSeat = "w";
      else if (Number(players.b) === Number(this.ctx.me.id)) this.chessSeat = "b";
      else this.chessSeat = "spectator";
      this.renderChess();
      this.renderMiniStatus();
      return;
    }
    if (msg.type === "chess_move_ok" && msg.room_id === this.roomId) {
      this.chessLastUci = msg.uci || "";
      this.renderChessBoard();
      return;
    }
    if (msg.type === "chess_move_reject" && msg.room_id === this.roomId) {
      this.ctx.notify.toast(`Move rejected: ${msg.reason || "illegal_move"}`, { tone: "error" });
      return;
    }
    if (msg.type === "chess_draw_offer" && msg.room_id === this.roomId) {
      this.chessState = { ...(this.chessState || {}), draw_offer_from: msg.from };
      this.renderChess();
      this.ctx.notify.toast(`Draw offer from ${msg.from === "w" ? "White" : "Black"}`, { tone: "info" });
      return;
    }
    if (msg.type === "chess_end" && msg.room_id === this.roomId) {
      this.chessState = {
        ...(this.chessState || {}),
        state: "ended",
        status: msg.status || this.chessState?.status || "ended",
        winner: msg.winner ?? this.chessState?.winner ?? null,
        draw_reason: msg.reason ?? this.chessState?.draw_reason ?? null,
      };
      this.renderChess();
      this.renderMiniStatus();
      this.ctx.notify.toast(`Chess ended: ${msg.status || msg.reason || "done"}`, { tone: "info" });
      return;
    }

  }
}
