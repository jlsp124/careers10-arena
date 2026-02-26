import { buildHashUrl, copyToClipboard } from "../net.js";
import { $, $$, clamp, createEl, escapeHtml, formatClockMs } from "../ui.js";

const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟", ".": "",
};
const INITIAL_COUNTS = {
  w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
  b: { p: 8, n: 2, b: 2, r: 2, q: 1 },
};

function chessSquare(rank, file) {
  return "abcdefgh"[file] + String(8 - rank);
}

function countPieces(boardRows) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of boardRows || []) {
    for (const piece of row || []) {
      if (!piece || piece === ".") continue;
      const side = piece === piece.toUpperCase() ? "w" : "b";
      const pt = piece.toLowerCase();
      if (counts[side][pt] !== undefined) counts[side][pt] += 1;
    }
  }
  return counts;
}

export class MiniGamesScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "minigames";
    this.title = "Mini-Games";
    this.root = null;
    this.activeRoute = "minigames"; // minigames | chess | pong | reaction | typing
    this.joinedKind = null;
    this.roomId = "room";
    this.roomKey = null;
    this.joinedRoomId = null;
    this.seat = "spectator";

    this.pongState = null;
    this.pongKeys = { up: false, down: false };
    this.pongInputTimer = null;

    this.reactionState = null;
    this.typingState = null;
    this.typingInputText = "";
    this.typingRoundStartedAt = 0;
    this.typingStats = { wpm: 0, acc: 100, elapsed: 0 };

    this.chessState = null;
    this.chessSelected = null;
    this.chessLastUci = "";
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="screen-title">Mini-Games</h2>
            <p class="helper" id="miniHeaderHelper">Select a mode</p>
          </div>
          <div class="tabs" id="miniTabs">
            <button class="tab-btn" data-mini-route="minigames" type="button">Menu</button>
            <button class="tab-btn" data-mini-route="chess" type="button">Chess</button>
            <button class="tab-btn" data-mini-route="pong" type="button">Pong</button>
            <button class="tab-btn" data-mini-route="reaction" type="button">Reaction</button>
            <button class="tab-btn" data-mini-route="typing" type="button">Typing</button>
          </div>
        </div>
        <div class="card-body col">
          <div class="row wrap">
            <label class="stretch">Room
              <input id="miniRoomInput" value="room">
            </label>
            <button id="miniJoinBtn" class="btn primary" type="button">Join</button>
            <button id="miniCopyBtn" class="btn secondary" type="button">Copy Link</button>
            <button id="miniRestartBtn" class="btn ghost" type="button">Restart</button>
            <span id="miniRoomBadge" class="badge">Room -</span>
            <span id="miniStateBadge" class="badge">state -</span>
          </div>
          <div id="miniStatus" class="status info">Ready</div>
        </div>
      </div>

      <div id="miniMenuPanel" class="card">
        <div class="card-body">
          <div class="grid cols-3">
            <button class="list-row clickable" type="button" data-open-route="chess"><strong class="stretch">Chess</strong><span class="tiny muted">1v1</span></button>
            <button class="list-row clickable" type="button" data-open-route="pong"><strong class="stretch">Pong</strong><span class="tiny muted">1v1</span></button>
            <button class="list-row clickable" type="button" data-open-route="reaction"><strong class="stretch">Reaction</strong><span class="tiny muted">1v1</span></button>
            <button class="list-row clickable" type="button" data-open-route="typing"><strong class="stretch">Typing</strong><span class="tiny muted">1v1</span></button>
          </div>
        </div>
      </div>

      <div id="pongPanel" class="card hidden">
        <div class="card-header">
          <h3 class="section-title">Pong</h3>
          <span class="helper">W / S</span>
        </div>
        <div class="card-body">
          <div class="pong-stage"><canvas id="pongCanvas" style="height:420px;"></canvas></div>
        </div>
      </div>

      <div id="reactionPanel" class="card hidden">
        <div class="card-header"><h3 class="section-title">Reaction</h3></div>
        <div class="card-body col">
          <div id="reactionStatus" class="status info">Join a room</div>
          <div class="row wrap">
            <button id="reactionPressBtn" class="btn primary" type="button">PRESS</button>
            <span class="helper">Space also works</span>
          </div>
        </div>
      </div>

      <div id="typingPanel" class="card hidden">
        <div class="card-header">
          <h3 class="section-title">Typing</h3>
          <div class="typing-stats">
            <span>WPM <strong id="typingWpm">0</strong></span>
            <span>ACC <strong id="typingAcc">100%</strong></span>
            <span>TIME <strong id="typingTime">0.0s</strong></span>
          </div>
        </div>
        <div class="card-body col">
          <div class="typing-ux">
            <div id="typingPromptView" class="typing-prompt"></div>
            <div class="helper" id="typingRoundInfo">Join a room</div>
          </div>
          <form id="typingForm" class="row">
            <input id="typingInput" class="stretch" autocomplete="off" spellcheck="false" placeholder="Type and press Enter">
            <button class="btn primary" type="submit">Submit</button>
          </form>
          <div class="helper">Enter = submit · Enter again = restart (after end)</div>
        </div>
      </div>

      <div id="chessPanel" class="card hidden">
        <div class="card-header">
          <div>
            <h3 class="section-title">Chess</h3>
            <div class="helper" id="chessMetaLine">Join a room</div>
          </div>
          <div class="clock-badges">
            <span id="chessWhiteClock" class="badge">W 5:00</span>
            <span id="chessBlackClock" class="badge">B 5:00</span>
          </div>
        </div>
        <div class="card-body chess-layout">
          <div class="col">
            <div id="chessBoard" class="chess-board"></div>
            <div class="capture-row">
              <span>White captures: <span id="chessCapWhite">-</span></span>
              <span>Black captures: <span id="chessCapBlack">-</span></span>
            </div>
          </div>
          <div class="col">
            <div class="row wrap">
              <select id="chessPromoSelect" style="max-width:140px">
                <option value="q">Promote: Queen</option>
                <option value="r">Promote: Rook</option>
                <option value="b">Promote: Bishop</option>
                <option value="n">Promote: Knight</option>
              </select>
              <button id="chessResignBtn" class="btn ghost" type="button">Resign</button>
              <button id="chessOfferDrawBtn" class="btn ghost" type="button">Offer Draw</button>
              <button id="chessAcceptDrawBtn" class="btn ghost" type="button">Accept Draw</button>
            </div>
            <div id="chessStatus" class="status info">Waiting</div>
            <div id="chessMoveList" class="move-list"></div>
          </div>
        </div>
      </div>
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
    $("#chessResignBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_resign" }));
    $("#chessOfferDrawBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_offer_draw" }));
    $("#chessAcceptDrawBtn", this.root).addEventListener("click", () => this.ctx.ws.send({ type: "chess_accept_draw" }));

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
    if (["chess", "pong", "reaction", "typing"].includes(routeName)) return routeName;
    return null;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.activeRoute = route?.name || "minigames";
    this.roomId = String(route?.params?.room || this.ctx.lastMatchFound?.room_id || this.roomId || "room").toLowerCase();
    $("#miniRoomInput", this.root).value = this.roomId;
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
    $("#miniHeaderHelper", this.root).textContent = this.activeRoute === "minigames" ? "Select a mode" : this.activeRoute;
    this.renderMiniStatus();
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
    this.ctx.setScreenLoading("Joining…", true);
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
    st.textContent = routeKind ? `${routeKind} · room ${this.roomId || "-"} · ${state || "waiting"}` : "Select a mini-game";
    $("#miniRoomBadge", this.root).textContent = `Room ${this.roomId || "-"}`;
    $("#miniStateBadge", this.root).textContent = state || "-";
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
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.setLineDash([]);
      if (this.pongState) {
        const sx = W / (this.pongState.width || 800);
        const sy = H / (this.pongState.height || 450);
        ctx.fillStyle = "#e8edf5";
        ctx.font = "bold 18px system-ui";
        ctx.fillText(`${this.pongState.score?.[0] ?? 0}`, W * 0.25, 28);
        ctx.fillText(`${this.pongState.score?.[1] ?? 0}`, W * 0.75, 28);
        ctx.fillStyle = "#55b2ff";
        const ph = 90 * sy;
        ctx.fillRect(20, (this.pongState.paddles?.left_y || 0) * sy - ph / 2, 10, ph);
        ctx.fillRect(W - 30, (this.pongState.paddles?.right_y || 0) * sy - ph / 2, 10, ph);
        ctx.beginPath();
        ctx.fillStyle = "#d7a746";
        ctx.arc((this.pongState.ball?.x || 0) * sx, (this.pongState.ball?.y || 0) * sy, 7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#9aa7bc";
        ctx.fillText("Join a room", 16, 24);
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
    el.textContent = `${this.reactionState.state} · ${this.reactionState.phase} · round ${this.reactionState.round} · ${this.reactionState.phase_timer}s · ${score}`;
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
    $("#typingRoundInfo", this.root).textContent = `${this.typingState?.state || "waiting"} · round ${this.typingState?.round || 0} · ${score}`;
    this.renderTypingStats();
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

  renderChess() {
    if (this.activeRoute !== "chess") return;
    const boardEl = $("#chessBoard", this.root);
    const rows = this.chessState?.board || Array.from({ length: 8 }, () => Array(8).fill("."));
    const lastFrom = this.chessLastUci?.slice(0, 2);
    const lastTo = this.chessLastUci?.slice(2, 4);
    let html = "";
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = chessSquare(r, f);
        const piece = rows[r][f];
        const light = (r + f) % 2 === 0;
        const isSel = sq === this.chessSelected;
        const isLast = sq === lastFrom || sq === lastTo;
        html += `
          <button type="button" class="chess-square ${light ? "light" : "dark"} ${isSel ? "sel" : ""} ${isLast ? "last" : ""}" data-chess-sq="${sq}">
            ${PIECES[piece] || ""}
            ${r === 7 ? `<span class="chess-filehint">${"abcdefgh"[f]}</span>` : ""}
            ${f === 0 ? `<span class="chess-rankhint">${8 - r}</span>` : ""}
          </button>
        `;
      }
    }
    boardEl.innerHTML = html;
    $$("[data-chess-sq]", boardEl).forEach((btn) => btn.addEventListener("click", () => this.handleChessSquare(btn.dataset.chessSq)));

    $("#chessMetaLine", this.root).textContent = this.chessState
      ? `Seat ${this.seat} · turn ${this.chessState.turn || "-"}`
      : "Join a room";
    $("#chessWhiteClock", this.root).textContent = `W ${formatClockMs(this.chessState?.clocks_ms?.w ?? 300000)}`;
    $("#chessBlackClock", this.root).textContent = `B ${formatClockMs(this.chessState?.clocks_ms?.b ?? 300000)}`;
    const status = $("#chessStatus", this.root);
    const statusText = this.chessState
      ? `${this.chessState.state} · ${this.chessState.status}${this.chessState.winner ? ` · winner ${this.chessState.winner}` : ""}${this.chessState.draw_reason ? ` · ${this.chessState.draw_reason}` : ""}`
      : "Waiting";
    status.className = `status ${this.chessState?.status === "ongoing" ? "info" : "warn"}`;
    status.textContent = statusText;
    $("#chessAcceptDrawBtn", this.root).disabled = !(
      this.chessState?.draw_offer_from &&
      (this.seat === "w" || this.seat === "b") &&
      this.seat !== this.chessState.draw_offer_from
    );

    const moves = this.chessState?.moves || [];
    $("#chessMoveList", this.root).innerHTML = moves.length
      ? moves.map((m) => `<div>${m.ply.padStart(3, " ")} ${m.side}: ${escapeHtml(m.move)}</div>`).join("")
      : `<div class="empty-state">No moves</div>`;

    const counts = countPieces(rows);
    const whiteCaps = [];
    const blackCaps = [];
    for (const pt of ["q", "r", "b", "n", "p"]) {
      const missingBlack = (INITIAL_COUNTS.b[pt] || 0) - (counts.b[pt] || 0);
      const missingWhite = (INITIAL_COUNTS.w[pt] || 0) - (counts.w[pt] || 0);
      for (let i = 0; i < missingBlack; i++) whiteCaps.push(PIECES[pt]);
      for (let i = 0; i < missingWhite; i++) blackCaps.push(PIECES[pt.toUpperCase()]);
    }
    $("#chessCapWhite", this.root).textContent = whiteCaps.join(" ") || "-";
    $("#chessCapBlack", this.root).textContent = blackCaps.join(" ") || "-";
  }

  handleChessSquare(square) {
    if (!this.chessSelected) {
      this.chessSelected = square;
      this.renderChess();
      return;
    }
    if (this.chessSelected === square) {
      this.chessSelected = null;
      this.renderChess();
      return;
    }
    const promo = $("#chessPromoSelect", this.root).value || "q";
    this.ctx.ws.send({ type: "chess_move", from: this.chessSelected, to: square, promotion: promo });
    this.chessSelected = null;
    this.renderChess();
  }

  onRoomJoined(msg) {
    const routeKind = this.currentKind();
    if (!routeKind || msg.kind !== routeKind) return;
    this.joinedKind = msg.kind;
    this.roomKey = msg.room_key;
    this.roomId = msg.room_id;
    this.joinedRoomId = msg.room_id;
    $("#miniRoomInput", this.root).value = this.roomId;
    this.ctx.setScreenLoading("", false);
    if (msg.kind === "chess" && msg.seat) this.seat = msg.seat;
    this.renderMiniStatus();
  }

  onEvent(msg) {
    if (msg.type === "room_joined") return this.onRoomJoined(msg);
    if (msg.type === "match_found" && ["pong", "reaction", "typing", "chess"].includes(msg.kind)) {
      this.ctx.setScreenLoading("Match found", true);
      setTimeout(() => this.ctx.setScreenLoading("", false), 800);
      return;
    }

    if (msg.type === "pong_state") {
      if (msg.room_id === this.roomId) {
        this.pongState = msg;
        this.renderMiniStatus();
      }
      return;
    }
    if (msg.type === "pong_end" && msg.room_id === this.roomId) {
      this.ctx.notify.toast("Pong ended", { tone: "info" });
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
      if (msg.players?.w === this.ctx.me.id) this.seat = "w";
      else if (msg.players?.b === this.ctx.me.id) this.seat = "b";
      else this.seat = "spectator";
      if (this.chessState) this.chessState.players = msg.players;
      this.renderChess();
      return;
    }
    if (msg.type === "chess_state" && msg.room_id === this.roomId) {
      this.chessState = msg;
      this.renderChess();
      this.renderMiniStatus();
      return;
    }
    if (msg.type === "chess_move_ok" && msg.room_id === this.roomId) {
      this.chessLastUci = msg.uci || "";
      this.renderChess();
      return;
    }
    if (msg.type === "chess_move_reject" && msg.reason) {
      this.ctx.notify.toast(`Move rejected: ${msg.reason}`, { tone: "error" });
      return;
    }
    if (msg.type === "chess_end" && msg.room_id === this.roomId) {
      this.ctx.notify.toast(`Chess: ${msg.status || msg.reason}`, { tone: "info" });
      return;
    }
  }
}
