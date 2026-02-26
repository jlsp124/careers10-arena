import { copyToClipboard, getSharedWS, joinUrlFor } from "./net.js";
import { $, escapeHtml, installTopbar, requireAuth, setStatus, toast, tsToLocal } from "./ui.js";

let me = null;
let ws = null;
let currentKind = "pong";
let currentRoomId = "mini-room";
let currentRoomKey = null;

let pongState = null;
let reactionState = null;
let typingState = null;
const pongKeys = { up: false, down: false };

function showPanel(kind) {
  ["pong", "reaction", "typing", "chess"].forEach((k) => {
    const panel = document.querySelector(`[data-mini-panel="${k}"]`);
    if (panel) panel.classList.toggle("hidden", k !== kind);
  });
}

function readRoomControls() {
  currentKind = $("#miniKind").value;
  currentRoomId = ($("#miniRoomInput").value || "mini-room").trim().toLowerCase() || "mini-room";
}

function joinSelected() {
  readRoomControls();
  showPanel(currentKind);
  if (currentKind === "chess") {
    location.href = joinUrlFor("chess.html", { room: currentRoomId });
    return;
  }
  ws.send({ type: "join_room", kind: currentKind, room_id: currentRoomId });
  setStatus($("#miniStatus"), `Joining ${currentKind}:${currentRoomId}...`, "warn");
}

function copyJoinLink() {
  readRoomControls();
  const page = currentKind === "chess" ? "chess.html" : "minigames.html";
  const url = joinUrlFor(page, currentKind === "chess" ? { room: currentRoomId } : { kind: currentKind, room: currentRoomId });
  copyToClipboard(url).then(() => toast("Join URL copied", "ok")).catch(() => toast("Clipboard failed", "err"));
}

function wirePongKeys() {
  window.addEventListener("keydown", (e) => {
    const k = String(e.key).toLowerCase();
    if (["w", "arrowup"].includes(k)) { pongKeys.up = true; e.preventDefault(); }
    if (["s", "arrowdown"].includes(k)) { pongKeys.down = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    const k = String(e.key).toLowerCase();
    if (["w", "arrowup"].includes(k)) { pongKeys.up = false; e.preventDefault(); }
    if (["s", "arrowdown"].includes(k)) { pongKeys.down = false; e.preventDefault(); }
  });
  setInterval(() => {
    if (currentKind === "pong" && currentRoomKey) ws.send({ type: "pong_input", up: pongKeys.up, down: pongKeys.down });
  }, 40);
}

function renderPong() {
  const canvas = $("#pongCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.clientWidth || 760;
  const H = canvas.clientHeight || 420;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0b1722";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.setLineDash([]);

  if (!pongState) {
    ctx.fillStyle = "#9ec2e8";
    ctx.fillText("Join a Pong room.", 16, 24);
    return;
  }
  const sx = W / pongState.width;
  const sy = H / pongState.height;
  ctx.fillStyle = "#e8f3ff";
  ctx.font = "bold 18px Trebuchet MS";
  ctx.fillText(`${pongState.score?.[0] ?? 0}`, W * 0.25, 28);
  ctx.fillText(`${pongState.score?.[1] ?? 0}`, W * 0.75, 28);
  ctx.font = "12px Consolas";
  ctx.fillStyle = "#9ec2e8";
  ctx.fillText(`Time ${Math.max(0, Math.ceil(pongState.time_left || 0))}s · ${pongState.state}`, 16, 46);

  const paddleH = 90 * sy;
  const paddleW = 10;
  ctx.fillStyle = "#7df9c1";
  ctx.fillRect(20, (pongState.paddles.left_y * sy) - paddleH / 2, paddleW, paddleH);
  ctx.fillRect(W - 20 - paddleW, (pongState.paddles.right_y * sy) - paddleH / 2, paddleW, paddleH);
  ctx.beginPath();
  ctx.fillStyle = "#ffd166";
  ctx.arc(pongState.ball.x * sx, pongState.ball.y * sy, 7, 0, Math.PI * 2);
  ctx.fill();
}

function renderReaction() {
  const box = $("#reactionState");
  if (!box) return;
  if (!reactionState) {
    box.textContent = "Join a Reaction Duel room.";
    return;
  }
  box.innerHTML = `
    <div><strong>${reactionState.state}</strong> · phase <span class="${reactionState.phase === "go" ? "blink" : ""}">${reactionState.phase}</span></div>
    <div>Round ${reactionState.round} · timer ${reactionState.phase_timer}s</div>
    <div>Players: ${(reactionState.players || []).join(", ") || "(waiting)"}</div>
    <div>Score: ${Object.entries(reactionState.score || {}).map(([id, s]) => `${id}:${s}`).join(" | ") || "0-0"}</div>
  `;
}

function renderTyping() {
  const box = $("#typingState");
  if (!box) return;
  if (!typingState) {
    box.textContent = "Join a Typing Duel room.";
    return;
  }
  $("#typingPhrase").textContent = typingState.phrase || "(waiting)";
  box.innerHTML = `
    <div><strong>${typingState.state}</strong> · Round ${typingState.round}</div>
    <div>Timeout: ${typingState.timeout}s · ${typingState.round_open ? "Open" : "Locked"}</div>
    <div>Score: ${Object.entries(typingState.score || {}).map(([id, s]) => `${id}:${s}`).join(" | ") || "0-0"}</div>
  `;
}

function logMiniEvent(text) {
  const box = $("#miniEventLog");
  const div = document.createElement("div");
  div.className = "chat-line";
  div.innerHTML = `<span class="time">${new Date().toLocaleTimeString()}</span> ${text}`;
  box.prepend(div);
  while (box.children.length > 40) box.lastElementChild.remove();
}

async function init() {
  me = await requireAuth();
  installTopbar({ pageTitle: "Mini-Games" });

  const qs = new URLSearchParams(location.search);
  if (qs.get("kind")) $("#miniKind").value = qs.get("kind");
  if (qs.get("room")) $("#miniRoomInput").value = qs.get("room");
  showPanel($("#miniKind").value);

  $("#joinMiniBtn").addEventListener("click", joinSelected);
  $("#copyMiniBtn").addEventListener("click", copyJoinLink);
  $("#miniKind").addEventListener("change", () => {
    showPanel($("#miniKind").value);
    currentKind = $("#miniKind").value;
  });
  $("#reactionFireBtn").addEventListener("click", () => ws.send({ type: "reaction_press" }));
  $("#typingForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#typingInput");
    ws.send({ type: "typing_submit", text: input.value });
    input.select();
  });
  $("#typingRestartBtn").addEventListener("click", () => ws.send({ type: "typing_restart" }));
  $("#reactionRestartBtn").addEventListener("click", () => ws.send({ type: "reaction_restart" }));
  $("#pongRestartBtn").addEventListener("click", () => ws.send({ type: "pong_restart" }));

  window.addEventListener("keydown", (e) => {
    if (currentKind === "reaction" && (e.code === "Space" || e.key === " ")) {
      e.preventDefault();
      ws.send({ type: "reaction_press" });
    }
  });
  wirePongKeys();

  ws = getSharedWS();
  await ws.connect();

  ws.on("hello_ok", () => {
    setStatus($("#miniStatus"), "Connected to mini-game server.", "ok");
    if (qs.get("kind") && qs.get("room")) joinSelected();
  });

  ws.on("room_joined", (m) => {
    if (!["pong", "reaction", "typing"].includes(m.kind)) return;
    currentRoomKey = m.room_key;
    currentKind = m.kind;
    currentRoomId = m.room_id;
    $("#miniKind").value = m.kind;
    $("#miniRoomInput").value = m.room_id;
    showPanel(m.kind);
    setStatus($("#miniStatus"), `Joined ${m.room_key}`, "ok");
    logMiniEvent(`Joined ${m.room_key}`);
  });

  ws.on("pong_state", (m) => {
    if (m.room_id !== currentRoomId || currentKind !== "pong") return;
    pongState = m;
    renderPong();
  });
  ws.on("pong_roster", (m) => {
    logMiniEvent(`Pong roster update: players ${JSON.stringify(m.players)}`);
  });
  ws.on("pong_end", (m) => {
    logMiniEvent(`Pong ended (${m.reason})`);
    toast(`Pong ended: ${m.reason}`);
  });

  ws.on("reaction_state", (m) => {
    if (m.room_id !== currentRoomId || currentKind !== "reaction") return;
    reactionState = m;
    renderReaction();
  });
  ["reaction_round_start", "reaction_go", "reaction_round_win", "reaction_false_start", "reaction_timeout", "reaction_end"].forEach((t) => {
    ws.on(t, (m) => {
      if (m.room_id !== currentRoomId) return;
      logMiniEvent(`${t.replaceAll("_", " ")} · ${escapeHtml(JSON.stringify(m))}`);
      if (t === "reaction_go") toast("GO!", "ok");
      if (t === "reaction_end") toast(`Reaction Duel ended: ${m.reason}`);
      if (reactionState) renderReaction();
    });
  });

  ws.on("typing_state", (m) => {
    if (m.room_id !== currentRoomId || currentKind !== "typing") return;
    typingState = m;
    renderTyping();
  });
  ["typing_round", "typing_round_win", "typing_incorrect", "typing_round_timeout", "typing_end"].forEach((t) => {
    ws.on(t, (m) => {
      if (m.room_id !== currentRoomId) return;
      if (t === "typing_round" && m.phrase) $("#typingPhrase").textContent = m.phrase;
      if (t === "typing_round_win") toast(`Round win: user ${m.user_id}`, "ok");
      if (t === "typing_incorrect" && Number(m.user_id) === Number(me.id)) toast("Incorrect. Keep typing.", "err");
      if (t === "typing_end") toast(`Typing Duel ended: ${m.reason}`);
      logMiniEvent(`${t.replaceAll("_", " ")}`);
    });
  });

  ws.on("announcement", (m) => {
    logMiniEvent(`ANNOUNCEMENT (${tsToLocal(m.created_at)}): ${escapeHtml(m.text)}`);
    toast(m.text);
  });

  ws.on("error", (m) => {
    if (!m.error) return;
    toast(`WS error: ${m.error}`, "err");
    setStatus($("#miniStatus"), `Error: ${m.error}`, "err");
  });

  if (ws.helloReady && qs.get("kind") && qs.get("room")) joinSelected();

  // render loop for pong
  const loop = () => {
    renderPong();
    requestAnimationFrame(loop);
  };
  loop();
}

init().catch((e) => {
  console.error(e);
  setStatus($("#miniStatus"), `Failed to load minigames: ${e.message}`, "err");
});
