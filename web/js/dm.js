import { api, getSharedWS, getToken } from "./net.js";
import { $, $$, escapeHtml, installTopbar, requireAuth, setStatus, toast, tsToLocal } from "./ui.js";

let me = null;
let ws = null;
let currentOtherId = null;
let pendingFile = null;
let messageCache = [];
let threadCache = [];
let userCache = new Map();

function renderThreads() {
  const list = $("#threadList");
  if (!list) return;
  if (!threadCache.length) {
    list.innerHTML = `<div class="list-item muted">No threads yet. Search a classmate and send a message.</div>`;
    return;
  }
  list.innerHTML = threadCache.map((t) => `
    <button type="button" class="list-item ghost thread-btn ${Number(t.other_id) === Number(currentOtherId) ? "ok" : ""}" data-other-id="${t.other_id}">
      <div class="row space">
        <strong>${escapeHtml(t.display_name || t.username)}</strong>
        <span class="tiny muted">${tsToLocal(t.created_at)}</span>
      </div>
      <div class="tiny muted">@${escapeHtml(t.username)}</div>
      <div class="small">${escapeHtml(t.body || (t.file_id ? "[attachment]" : ""))}</div>
    </button>
  `).join("");
  $$(".thread-btn", list).forEach((btn) => btn.addEventListener("click", () => openThread(Number(btn.dataset.otherId))));
}

function renderMessages() {
  const box = $("#dmMessages");
  if (!box) return;
  box.innerHTML = messageCache.map((m) => {
    const mine = Number(m.sender_id) === Number(me.id);
    const fileHtml = m.file ? `<div><a href="/api/file/${m.file.id}" target="_blank" rel="noopener">Attachment: ${escapeHtml(m.file.original_name)}</a> (${Math.round((m.file.size_bytes || 0)/1024)} KB)</div>` : "";
    const adminActions = me.is_admin ? `
      <div class="row tiny">
        <button type="button" class="ghost" data-delmsg="${m.id}">Delete msg</button>
        <button type="button" class="ghost" data-mute="${mine ? m.recipient_id : m.sender_id}">Mute 5m</button>
      </div>` : "";
    return `
      <div class="dm-msg ${mine ? "mine" : ""}">
        <div class="meta">${escapeHtml(m.sender_display_name || m.sender_username || "")} · ${tsToLocal(m.created_at)} · #${m.id}</div>
        <div class="body">${escapeHtml(m.body || "")}</div>
        ${fileHtml}
        ${adminActions}
      </div>
    `;
  }).join("");
  box.scrollTop = box.scrollHeight;
  $$("[data-delmsg]", box).forEach((btn) => btn.addEventListener("click", () => ws.send({ type: "dm_delete", message_id: Number(btn.dataset.delmsg) })));
  $$("[data-mute]", box).forEach((btn) => btn.addEventListener("click", () => ws.send({ type: "admin_mute", user_id: Number(btn.dataset.mute), minutes: 5 })));
}

function renderSearchResults(users = []) {
  const list = $("#userSearchResults");
  if (!list) return;
  list.innerHTML = users.map((u) => {
    userCache.set(Number(u.id), u);
    return `
      <button type="button" class="list-item ghost user-pick" data-user-id="${u.id}">
        <div><strong>${escapeHtml(u.display_name || u.username)}</strong> <span class="tiny muted">@${escapeHtml(u.username)}</span></div>
      </button>
    `;
  }).join("") || `<div class="list-item muted">No matches.</div>`;
  $$(".user-pick", list).forEach((btn) => btn.addEventListener("click", () => openThread(Number(btn.dataset.userId), true)));
}

function setThreadHeader() {
  const name = $("#currentThreadName");
  const hint = $("#currentThreadHint");
  const u = userCache.get(Number(currentOtherId));
  if (!currentOtherId) {
    name.textContent = "Select a thread";
    hint.textContent = "Search a classmate or click an existing thread.";
    return;
  }
  name.textContent = u ? (u.display_name || u.username) : `User #${currentOtherId}`;
  hint.textContent = u ? `@${u.username}${u.is_admin ? " · Admin" : ""}` : `User ID ${currentOtherId}`;
}

function openThread(otherId, createPlaceholder = false) {
  currentOtherId = Number(otherId);
  if (createPlaceholder && !threadCache.some((t) => Number(t.other_id) === Number(otherId))) {
    const u = userCache.get(Number(otherId)) || { id: otherId, username: `user${otherId}`, display_name: `User ${otherId}` };
    threadCache.unshift({ other_id: otherId, username: u.username, display_name: u.display_name, created_at: Math.floor(Date.now()/1000), body: "" });
  }
  setThreadHeader();
  renderThreads();
  ws.send({ type: "dm_history", other_id: Number(otherId) });
}

async function uploadAttachment() {
  const input = $("#dmFileInput");
  const status = $("#uploadStatus");
  if (!input?.files?.length) {
    setStatus(status, "Choose a file first.", "warn");
    return;
  }
  const fd = new FormData();
  fd.append("file", input.files[0]);
  setStatus(status, "Uploading...", "warn");
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "X-Session-Token": getToken() },
      body: fd,
    });
    const payload = await res.json();
    if (!res.ok) throw Object.assign(new Error(payload.error || "upload_failed"), { payload });
    pendingFile = payload.file;
    setStatus(status, `Attached: ${pendingFile.original_name} (${Math.round(pendingFile.size_bytes/1024)} KB)`, "ok");
    input.value = "";
  } catch (e) {
    setStatus(status, `Upload failed: ${e.payload?.detail || e.message}`, "err");
  }
}

async function init() {
  me = await requireAuth();
  installTopbar({ pageTitle: "DMs" });

  $("#meBadge").innerHTML = `${escapeHtml(me.display_name)} · ${me.username}`;
  $("#searchBtn").addEventListener("click", () => {
    const q = $("#userSearchInput").value.trim();
    ws.send({ type: "user_search", q });
  });
  $("#userSearchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#searchBtn").click();
    }
  });
  $("#uploadBtn").addEventListener("click", uploadAttachment);
  $("#clearAttachmentBtn").addEventListener("click", () => {
    pendingFile = null;
    setStatus($("#uploadStatus"), "No attachment selected.", "");
  });
  $("#dmSendForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentOtherId) return toast("Pick a thread first.", "err");
    const body = $("#dmBody").value.trim();
    if (!body && !pendingFile) return toast("Message is empty.", "err");
    ws.send({ type: "dm_send", recipient_id: Number(currentOtherId), body, file_id: pendingFile?.id || null });
    $("#dmBody").value = "";
    pendingFile = null;
    setStatus($("#uploadStatus"), "No attachment selected.", "");
  });

  ws = getSharedWS();
  await ws.connect();

  ws.on("hello_ok", (m) => {
    me = m.me;
    ws.send({ type: "dm_threads" });
    ws.send({ type: "user_search", q: "" });
  });
  ws.on("user_search_result", (m) => renderSearchResults(m.users || []));
  ws.on("dm_threads", (m) => {
    threadCache = m.threads || [];
    for (const t of threadCache) userCache.set(Number(t.other_id), { id: t.other_id, username: t.username, display_name: t.display_name, is_admin: t.is_admin });
    renderThreads();
  });
  ws.on("dm_history", (m) => {
    if (Number(m.other_id) !== Number(currentOtherId)) return;
    messageCache = m.messages || [];
    renderMessages();
  });
  ws.on("dm_new", (m) => {
    const msg = m.message;
    const other = Number(msg.sender_id) === Number(me.id) ? Number(msg.recipient_id) : Number(msg.sender_id);
    if (Number(currentOtherId) === other) {
      messageCache.push(msg);
      renderMessages();
    }
    ws.send({ type: "dm_threads" });
  });
  ws.on("dm_deleted", () => {
    if (currentOtherId) ws.send({ type: "dm_history", other_id: Number(currentOtherId) });
    ws.send({ type: "dm_threads" });
  });
  ws.on("error", (m) => {
    if (m.error) toast(`WS error: ${m.error}`, "err");
  });
  ws.on("moderation", (m) => {
    if (m.kind === "mute") toast(`Muted until ${tsToLocal(m.until_ts)}`, "err");
    if (m.kind === "ban") toast(`Banned until ${tsToLocal(m.until_ts)}`, "err");
  });

  // Trigger hello manually if socket already open from another page module instance.
  if (ws.helloReady) {
    ws.send({ type: "dm_threads" });
    ws.send({ type: "user_search", q: "" });
  }

  setStatus($("#uploadStatus"), "No attachment selected.", "");
}

init().catch((e) => {
  console.error(e);
  setStatus($("#pageStatus"), `Failed to load DMs: ${e.message}`, "err");
});

