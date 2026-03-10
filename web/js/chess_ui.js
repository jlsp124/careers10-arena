import { getSharedWS } from "./net.js";
import { $, $$, escapeHtml, formatClockMs, installTopbar, requireAuth, setStatus, toast } from "./ui.js";

const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟", ".": ""
};

let me = null;
let ws = null;
let roomId = "chess-room";
let roomKey = null;
let chessState = null;
let mySeat = "spectator";
let selectedSq = null;
let lastUci = "";

function squareName(rankIndex, fileIndex) {
  return "abcdefgh"[fileIndex] + String(8 - rankIndex);
}

function renderBoard() {
  const board = $("#chessBoard");
  if (!board) return;
  const rows = chessState?.board || Array.from({ length: 8 }, () => Array(8).fill("."));
  const lastFrom = lastUci?.slice(0, 2);
  const lastTo = lastUci?.slice(2, 4);
  let html = "";
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = squareName(r, f);
      const piece = rows[r][f];
      const light = (r + f) % 2 === 0;
      const cls = [
        "chess-square",
        light ? "light" : "dark",
        selectedSq === sq ? "selected" : "",
        (sq === lastFrom || sq === lastTo) ? "lastmove" : ""
      ].filter(Boolean).join(" ");
      html += `<button type="button" class="${cls}" data-sq="${sq}" aria-label="${sq}">${PIECES[piece] || ""}</button>`;
    }
  }
  board.innerHTML = html;
  $$("[data-sq]", board).forEach((btn) => btn.addEventListener("click", () => handleSquareClick(btn.dataset.sq)));
}

function handleSquareClick(sq) {
  if (!chessState) return;
  if (!selectedSq) {
    selectedSq = sq;
    renderBoard();
    return;
  }
  if (selectedSq === sq) {
    selectedSq = null;
    renderBoard();
    return;
  }
  const promotion = $("#promoSelect")?.value || "q";
  ws.send({ type: "chess_move", from: selectedSq, to: sq, promotion });
  selectedSq = null;
  renderBoard();
}

function renderMoves() {
  const list = $("#moveList");
  if (!list) return;
  const moves = chessState?.moves || [];
  list.innerHTML = moves.map((m) => `<div>${m.ply.padStart(3, " ")} ${m.side}: ${escapeHtml(m.move)}</div>`).join("") || `<div class="muted">No moves yet.</div>`;
  list.scrollTop = list.scrollHeight;
}

function renderHeader() {
  $("#roomKeyBadge").textContent = roomKey || `chess:${roomId}`;
  $("#seatBadge").textContent = mySeat === "w" ? "Seat: White" : mySeat === "b" ? "Seat: Black" : "Seat: Spectator";
  $("#turnBadge").textContent = chessState ? `Turn: ${chessState.turn === "w" ? "White" : "Black"}` : "Turn: -";
  $("#whiteClock").textContent = chessState ? formatClockMs(chessState.clocks_ms?.w ?? 0) : "5:00";
  $("#blackClock").textContent = chessState ? formatClockMs(chessState.clocks_ms?.b ?? 0) : "5:00";
  $("#whitePlayer").textContent = chessState?.players?.w ? `White: #${chessState.players.w}` : "White: (open)";
  $("#blackPlayer").textContent = chessState?.players?.b ? `Black: #${chessState.players.b}` : "Black: (open)";
  const statusText = chessState
    ? `${chessState.state} · ${chessState.status}${chessState.winner ? ` · winner ${chessState.winner}` : ""}${chessState.draw_reason ? ` · ${chessState.draw_reason}` : ""}`
    : "Waiting";
  setStatus($("#chessStatus"), statusText, chessState?.status === "ongoing" ? "" : "warn");
  if (chessState?.draw_offer_from) {
    $("#drawOfferStatus").textContent = `Draw offer from ${chessState.draw_offer_from === "w" ? "White" : "Black"}`;
    $("#acceptDrawBtn").disabled = !((mySeat === "w" || mySeat === "b") && mySeat !== chessState.draw_offer_from);
  } else {
    $("#drawOfferStatus").textContent = "No active draw offer.";
    $("#acceptDrawBtn").disabled = true;
  }
}

function renderAll() {
  renderHeader();
  renderBoard();
  renderMoves();
}

function joinRoom() {
  roomId = ($("#roomInput").value || "chess-room").trim().toLowerCase() || "chess-room";
  ws.send({ type: "join_room", kind: "chess", room_id: roomId });
}

async function init() {
  me = await requireAuth();
  installTopbar({ pageTitle: "Chess 1v1" });

  const qpRoom = new URLSearchParams(location.search).get("room");
  if (qpRoom) $("#roomInput").value = qpRoom;

  $("#joinChessBtn").addEventListener("click", joinRoom);
  $("#roomInput").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("#resignBtn").addEventListener("click", () => ws.send({ type: "chess_resign" }));
  $("#offerDrawBtn").addEventListener("click", () => ws.send({ type: "chess_offer_draw" }));
  $("#acceptDrawBtn").addEventListener("click", () => ws.send({ type: "chess_accept_draw" }));
  $("#restartBtn").addEventListener("click", () => ws.send({ type: "chess_restart" }));

  ws = getSharedWS();
  await ws.connect();

  ws.on("hello_ok", (m) => {
    me = m.me;
    joinRoom();
  });

  ws.on("room_joined", (m) => {
    if (m.kind !== "chess") return;
    roomKey = m.room_key;
    if (m.seat) mySeat = m.seat;
    setStatus($("#chessStatus"), `Joined ${m.room_key}`, "ok");
  });

  ws.on("chess_roster", (m) => {
    if (m.room_id !== roomId) return;
    if (m.players?.w === me.id) mySeat = "w";
    else if (m.players?.b === me.id) mySeat = "b";
    else if (m.players) mySeat = "spectator";
    if (chessState) chessState.players = m.players;
    renderHeader();
  });

  ws.on("chess_state", (m) => {
    if (m.room_id !== roomId) return;
    chessState = m;
    renderAll();
  });

  ws.on("chess_move_ok", (m) => {
    if (m.room_id !== roomId) return;
    lastUci = m.uci || "";
  });

  ws.on("chess_move_reject", (m) => {
    toast(`Move rejected: ${m.reason}`, "err");
  });

  ws.on("chess_draw_offer", (m) => {
    if (m.room_id !== roomId) return;
    toast(`Draw offer from ${m.from === "w" ? "White" : "Black"}`);
  });

  ws.on("chess_end", (m) => {
    if (m.room_id !== roomId) return;
    toast(`Chess ended: ${m.status || m.reason || "done"}`);
  });

  ws.on("error", (m) => {
    if (m.error) toast(`WS error: ${m.error}`, "err");
  });

  if (ws.helloReady) joinRoom();
}

init().catch((e) => {
  console.error(e);
  setStatus($("#chessStatus"), `Failed to load chess: ${e.message}`, "err");
});

