import { api, uploadFile } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml, tsToLocal } from "../ui.js";

export class MessagesScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "messages";
    this.title = "Messages";
    this.root = null;
    this.threads = [];
    this.messages = [];
    this.userSearchRows = [];
    this.userMap = new Map();
    this.activeThreadId = null;
    this.pendingAttachment = null;
    this.loaded = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="dm-layout">
        <div class="card dm-threads">
          <div class="card-header"><h2 class="screen-title">Messages</h2></div>
          <div class="card-body col">
            <div class="row">
              <input id="dmSearchUsers" class="stretch" placeholder="Find user">
              <button id="dmSearchBtn" class="btn secondary" type="button">Search</button>
            </div>
            <div id="dmSearchResults" class="list"></div>
            <div class="row space" style="margin-top:8px;">
              <h3 class="section-title">Threads</h3>
              <button id="dmRefreshBtn" class="btn ghost" type="button">Refresh</button>
            </div>
            <div id="dmThreadList" class="list"></div>
          </div>
        </div>

        <div class="card dm-messages">
          <div class="card-header">
            <div>
              <div class="section-title" id="dmThreadTitle">Select a thread</div>
              <div class="helper" id="dmThreadSub">-</div>
            </div>
            <div id="dmScreenStatus" class="status info" style="min-width:180px;">Ready</div>
          </div>
          <div class="card-body col">
            <div id="dmMessageList" class="message-list"></div>
            <form id="dmComposer" class="col">
              <textarea id="dmBody" placeholder="Message"></textarea>
              <div class="row wrap">
                <input id="dmFileInput" type="file" class="stretch">
                <button id="dmUploadBtn" class="btn secondary" type="button">Upload</button>
                <button id="dmClearAttachmentBtn" class="btn ghost" type="button">Clear</button>
              </div>
              <div id="dmAttachmentStatus" class="status info">No attachment</div>
              <div class="row">
                <button class="btn primary" type="submit">Send</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    $("#dmSearchBtn", this.root).addEventListener("click", () => this.searchUsers());
    $("#dmSearchUsers", this.root).addEventListener("input", debounce(() => this.searchUsers(), 180));
    $("#dmRefreshBtn", this.root).addEventListener("click", () => {
      this.ctx.ws.send({ type: "dm_threads" });
      if (this.activeThreadId) this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
    });
    $("#dmUploadBtn", this.root).addEventListener("click", () => this.uploadAttachment());
    $("#dmClearAttachmentBtn", this.root).addEventListener("click", () => this.clearAttachment());
    $("#dmComposer", this.root).addEventListener("submit", (e) => this.sendMessage(e));

    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    this.loaded = true;
    this.ctx.ws.send({ type: "dm_threads" });
    if (!this.userSearchRows.length) this.ctx.ws.send({ type: "user_search", q: "" });
    if (this.activeThreadId) this.ctx.notify.markDMThreadRead(this.activeThreadId);
  }

  hide() {}

  setStatus(text, tone = "info") {
    const el = $("#dmScreenStatus", this.root);
    el.className = `status ${tone}`;
    el.textContent = text;
  }

  searchUsers() {
    const q = ($("#dmSearchUsers", this.root).value || "").trim();
    this.ctx.ws.send({ type: "user_search", q });
  }

  renderSearch() {
    const list = $("#dmSearchResults", this.root);
    if (!this.userSearchRows.length) {
      list.innerHTML = `<div class="empty-state">No users</div>`;
      return;
    }
    list.innerHTML = this.userSearchRows.map((u) => `
      <button class="list-row clickable" type="button" data-pick-user="${u.id}">
        <div class="stretch">
          <div>${escapeHtml(u.display_name || u.username)}</div>
          <div class="tiny muted">@${escapeHtml(u.username)}</div>
        </div>
      </button>
    `).join("");
    $$("[data-pick-user]", list).forEach((btn) => btn.addEventListener("click", () => this.openThread(Number(btn.dataset.pickUser), true)));
  }

  renderThreads() {
    const list = $("#dmThreadList", this.root);
    if (!this.threads.length) {
      list.innerHTML = `<div class="empty-state">No threads</div>`;
      return;
    }
    list.innerHTML = this.threads.map((t) => {
      const unread = this.ctx.notify.unreadForThread(t.other_id);
      return `
        <button class="list-row clickable ${Number(this.activeThreadId) === Number(t.other_id) ? "active" : ""}" type="button" data-thread="${t.other_id}">
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(t.display_name || t.username)}</strong>
              <span class="tiny muted">${tsToLocal(t.created_at)}</span>
            </div>
            <div class="tiny muted">@${escapeHtml(t.username)}</div>
            <div class="small">${escapeHtml(t.body || (t.file_id ? "[attachment]" : ""))}</div>
          </div>
          ${unread ? `<span class="sidebar-badge">${unread}</span>` : ""}
        </button>
      `;
    }).join("");
    $$("[data-thread]", list).forEach((btn) => btn.addEventListener("click", () => this.openThread(Number(btn.dataset.thread), false)));
  }

  renderThreadHeader() {
    const u = this.userMap.get(Number(this.activeThreadId));
    $("#dmThreadTitle", this.root).textContent = u ? (u.display_name || u.username) : (this.activeThreadId ? `Thread ${this.activeThreadId}` : "Select a thread");
    $("#dmThreadSub", this.root).textContent = u ? `@${u.username}` : "-";
  }

  renderMessages() {
    const list = $("#dmMessageList", this.root);
    if (!this.messages.length) {
      list.innerHTML = `<div class="empty-state">No messages</div>`;
      return;
    }
    list.innerHTML = this.messages.map((m) => {
      const mine = Number(m.sender_id) === Number(this.ctx.me.id);
      const fileHtml = m.file ? `<div class="tiny" style="margin-top:6px;"><a href="/api/file/${m.file.id}" target="_blank" rel="noopener">${escapeHtml(m.file.original_name)}</a></div>` : "";
      const modHtml = this.ctx.me?.is_admin ? `
        <div class="row wrap" style="margin-top:8px;">
          <button class="btn ghost" type="button" data-del-msg="${m.id}">Delete</button>
          <button class="btn ghost" type="button" data-mute-user="${mine ? m.recipient_id : m.sender_id}">Mute</button>
        </div>` : "";
      return `
        <div class="message-card ${mine ? "mine" : ""}">
          <div class="message-meta">${escapeHtml(m.sender_display_name || m.sender_username || "")} · ${tsToLocal(m.created_at)} · #${m.id}</div>
          <div class="message-body">${escapeHtml(m.body || "")}</div>
          ${fileHtml}
          ${modHtml}
        </div>
      `;
    }).join("");
    $$("[data-del-msg]", list).forEach((btn) => btn.addEventListener("click", () => this.ctx.ws.send({ type: "dm_delete", message_id: Number(btn.dataset.delMsg) })));
    $$("[data-mute-user]", list).forEach((btn) => btn.addEventListener("click", () => this.ctx.ws.send({ type: "admin_mute", user_id: Number(btn.dataset.muteUser), minutes: 5 })));
    list.scrollTop = list.scrollHeight;
  }

  openThread(otherId, createIfMissing = false) {
    this.activeThreadId = Number(otherId);
    if (createIfMissing && !this.threads.some((t) => Number(t.other_id) === this.activeThreadId)) {
      const u = this.userMap.get(this.activeThreadId) || { id: this.activeThreadId, username: `user${this.activeThreadId}`, display_name: `User ${this.activeThreadId}` };
      this.threads.unshift({ other_id: this.activeThreadId, username: u.username, display_name: u.display_name, created_at: Math.floor(Date.now() / 1000), body: "" });
    }
    this.renderThreads();
    this.renderThreadHeader();
    this.ctx.notify.markDMThreadRead(this.activeThreadId);
    this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
  }

  async uploadAttachment() {
    const files = $("#dmFileInput", this.root).files;
    if (!files?.length) {
      $("#dmAttachmentStatus", this.root).className = "status warn";
      $("#dmAttachmentStatus", this.root).textContent = "Pick a file";
      return;
    }
    $("#dmAttachmentStatus", this.root).className = "status info";
    $("#dmAttachmentStatus", this.root).textContent = "Uploading…";
    try {
      const res = await uploadFile(files[0]);
      this.pendingAttachment = res.file;
      $("#dmAttachmentStatus", this.root).className = "status success";
      $("#dmAttachmentStatus", this.root).textContent = `Attached: ${this.pendingAttachment.original_name}`;
      $("#dmFileInput", this.root).value = "";
    } catch (e) {
      $("#dmAttachmentStatus", this.root).className = "status error";
      $("#dmAttachmentStatus", this.root).textContent = `Upload failed: ${e.payload?.detail || e.message}`;
      this.ctx.notify.toast("Upload failed", { tone: "error" });
    }
  }

  clearAttachment() {
    this.pendingAttachment = null;
    $("#dmAttachmentStatus", this.root).className = "status info";
    $("#dmAttachmentStatus", this.root).textContent = "No attachment";
  }

  sendMessage(ev) {
    ev.preventDefault();
    if (!this.activeThreadId) {
      this.ctx.notify.toast("Select a thread", { tone: "error" });
      return;
    }
    const body = ($("#dmBody", this.root).value || "").trim();
    if (!body && !this.pendingAttachment) {
      this.ctx.notify.toast("Message is empty", { tone: "error" });
      return;
    }
    this.ctx.ws.send({
      type: "dm_send",
      recipient_id: this.activeThreadId,
      body,
      file_id: this.pendingAttachment?.id || null,
    });
    $("#dmBody", this.root).value = "";
    this.clearAttachment();
  }

  onEvent(msg) {
    if (msg.type === "user_search_result") {
      this.userSearchRows = msg.users || [];
      this.userSearchRows.forEach((u) => this.userMap.set(Number(u.id), u));
      this.renderSearch();
    }
    if (msg.type === "dm_threads") {
      this.threads = msg.threads || [];
      this.threads.forEach((t) => this.userMap.set(Number(t.other_id), { id: t.other_id, username: t.username, display_name: t.display_name }));
      this.renderThreads();
    }
    if (msg.type === "dm_history") {
      if (Number(msg.other_id) !== Number(this.activeThreadId)) return;
      this.messages = msg.messages || [];
      this.renderMessages();
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
    }
    if (msg.type === "dm_new" && msg.message) {
      const m = msg.message;
      const otherId = Number(m.sender_id) === Number(this.ctx.me.id) ? Number(m.recipient_id) : Number(m.sender_id);
      if (Number(this.activeThreadId) === otherId) {
        this.messages.push(m);
        this.renderMessages();
        this.ctx.notify.markDMThreadRead(otherId);
      }
      this.ctx.ws.send({ type: "dm_threads" });
    }
    if (msg.type === "dm_deleted") {
      if (this.activeThreadId) this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
      this.ctx.ws.send({ type: "dm_threads" });
    }
  }
}

