import { api, uploadFile } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml, tsToLocal, tsToRelative } from "../ui.js";

function attachmentPreview(file) {
  if (!file) return "";
  const href = `/api/file/${file.id}`;
  if ((file.mime || "").startsWith("image/")) {
    return `
      <div class="message-attachment">
        <img class="message-image-preview" src="${href}" alt="${escapeHtml(file.original_name)}">
        <a class="btn ghost" href="${href}" target="_blank" rel="noopener">Open image</a>
      </div>
    `;
  }
  return `
    <div class="message-file-chip">
      <strong>${escapeHtml(file.original_name)}</strong>
      <span class="muted">${escapeHtml(file.mime || "file")}</span>
      <a class="btn ghost" href="${href}" target="_blank" rel="noopener">Download</a>
    </div>
  `;
}

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
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel messages-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Messages</span>
          <h2 class="screen-title">Direct conversations and file sharing</h2>
          <p class="helper">Search users, pick up unread threads, and send attachments from a dedicated communication workspace.</p>
        </div>
      </div>

      <div class="content-grid content-grid-messages">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Threads</h3>
              <p class="helper">Search for users or reopen active conversations.</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row">
              <input id="dmSearchUsers" class="stretch" placeholder="Search users">
              <button id="dmSearchBtn" class="btn secondary" type="button">Search</button>
            </div>
            <div id="dmSearchResults" class="list"></div>
            <div class="divider"></div>
            <div id="dmThreadList" class="list"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 id="dmThreadTitle" class="section-title">Select a thread</h3>
              <p id="dmThreadSub" class="helper">Choose a conversation to view message history.</p>
            </div>
            <button id="dmRefreshBtn" class="btn ghost" type="button">Refresh</button>
          </div>
          <div class="card-body col">
            <div id="dmMessageList" class="message-list message-list-deep"></div>
            <form id="dmComposer" class="col">
              <textarea id="dmBody" placeholder="Type a message"></textarea>
              <div class="row wrap">
                <input id="dmFileInput" type="file" class="stretch">
                <button id="dmUploadBtn" class="btn secondary" type="button">Upload</button>
                <button id="dmClearAttachmentBtn" class="btn ghost" type="button">Clear</button>
                <button class="btn primary" type="submit">Send</button>
              </div>
              <div id="dmAttachmentStatus" class="status info">No attachment selected.</div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Thread Detail</h3>
              <p class="helper">Current recipient, unread state, and attachment controls.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="dmSidePanel" class="detail-stack"></div>
          </div>
        </div>
      </div>
    `;

    $("#dmSearchBtn", this.root).addEventListener("click", () => this.searchUsers());
    $("#dmSearchUsers", this.root).addEventListener("input", debounce(() => this.searchUsers(), 150));
    $("#dmRefreshBtn", this.root).addEventListener("click", () => this.refreshThreads());
    $("#dmUploadBtn", this.root).addEventListener("click", () => this.uploadAttachment());
    $("#dmClearAttachmentBtn", this.root).addEventListener("click", () => this.clearAttachment());
    $("#dmComposer", this.root).addEventListener("submit", (event) => this.sendMessage(event));
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Conversations and files");
    if (route?.params?.thread) this.activeThreadId = Number(route.params.thread || 0) || this.activeThreadId;
    this.refreshThreads();
    if (!this.userSearchRows.length) this.ctx.ws.send({ type: "user_search", q: "" });
    if (this.activeThreadId) {
      this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
    }
    this.renderSidePanel();
  }

  hide() {}

  refreshThreads() {
    this.ctx.ws.send({ type: "dm_threads" });
    if (this.activeThreadId) this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
  }

  searchUsers() {
    const q = ($("#dmSearchUsers", this.root).value || "").trim();
    this.ctx.ws.send({ type: "user_search", q });
  }

  renderSearch() {
    const list = $("#dmSearchResults", this.root);
    if (!this.userSearchRows.length) {
      list.innerHTML = `<div class="empty-state">No matching users.</div>`;
      return;
    }
    list.innerHTML = this.userSearchRows.map((user) => `
      <button class="explorer-row" data-pick-user="${user.id}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(user.display_name || user.username)}</strong>
          <span>@${escapeHtml(user.username)}</span>
        </div>
        <div class="feed-body">Open a direct thread</div>
      </button>
    `).join("");
    $$("[data-pick-user]", list).forEach((button) => button.addEventListener("click", () => this.openThread(Number(button.dataset.pickUser), true)));
  }

  renderThreads() {
    const list = $("#dmThreadList", this.root);
    if (!this.threads.length) {
      list.innerHTML = `<div class="empty-state">No message threads yet.</div>`;
      return;
    }
    list.innerHTML = this.threads.map((thread) => {
      const unread = this.ctx.notify.unreadForThread(thread.other_id);
      return `
        <button class="thread-row ${Number(thread.other_id) === Number(this.activeThreadId) ? "active" : ""}" data-thread="${thread.other_id}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(thread.display_name || thread.username)}</strong>
            <span>${tsToRelative(thread.created_at)}</span>
          </div>
          <div class="feed-body">${escapeHtml(thread.body || (thread.file_id ? "[attachment]" : "Start chatting"))}</div>
          <div class="chip-row">
            <span class="chip">@${escapeHtml(thread.username)}</span>
            ${unread ? `<span class="chip chip-primary">${unread} unread</span>` : ""}
          </div>
        </button>
      `;
    }).join("");
    $$("[data-thread]", list).forEach((button) => button.addEventListener("click", () => this.openThread(Number(button.dataset.thread), false)));
  }

  renderThreadHeader() {
    const user = this.userMap.get(Number(this.activeThreadId));
    $("#dmThreadTitle", this.root).textContent = user ? (user.display_name || user.username) : "Select a thread";
    $("#dmThreadSub", this.root).textContent = user ? `@${user.username}` : "Choose a conversation to view message history.";
  }

  renderMessages() {
    const list = $("#dmMessageList", this.root);
    if (!this.messages.length) {
      list.innerHTML = `<div class="empty-state">No messages in this thread yet.</div>`;
      return;
    }
    list.innerHTML = this.messages.map((message) => {
      const mine = Number(message.sender_id) === Number(this.ctx.me.id);
      const canDeleteFile = message.file && (Number(message.file.uploader_id || 0) === Number(this.ctx.me?.id || 0) || this.ctx.me?.is_admin);
      return `
        <div class="message-card message-card-deep ${mine ? "mine" : ""}">
          <div class="message-meta">
            <strong>${escapeHtml(message.sender_display_name || message.sender_username || "")}</strong>
            <span>${tsToLocal(message.created_at)} | #${message.id}</span>
          </div>
          ${message.body ? `<div class="message-body">${escapeHtml(message.body)}</div>` : ""}
          ${attachmentPreview(message.file)}
          ${canDeleteFile ? `<button class="btn ghost" data-delete-file="${message.file.id}" type="button">Delete file</button>` : ""}
          ${this.ctx.me?.is_admin ? `<button class="btn ghost" data-delete-message="${message.id}" type="button">Delete message</button>` : ""}
        </div>
      `;
    }).join("");
    $$("[data-delete-message]", list).forEach((button) => {
      button.addEventListener("click", () => this.ctx.ws.send({ type: "dm_delete", message_id: Number(button.dataset.deleteMessage) }));
    });
    $$("[data-delete-file]", list).forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await api(`/api/file/${button.dataset.deleteFile}/delete`, { method: "POST" });
          this.ctx.notify.toast("File deleted", { tone: "success" });
          this.refreshThreads();
        } catch (error) {
          this.ctx.notify.toast(`Delete failed: ${error.message}`, { tone: "error" });
        }
      });
    });
    list.scrollTop = list.scrollHeight;
  }

  renderSidePanel() {
    const node = $("#dmSidePanel", this.root);
    const user = this.userMap.get(Number(this.activeThreadId));
    const lastMessage = this.messages[this.messages.length - 1];
    node.innerHTML = `
      <div class="stat-card">
        <span class="metric-label">Active recipient</span>
        <strong>${escapeHtml(user?.display_name || user?.username || "No thread selected")}</strong>
        <span class="muted">${user ? `@${user.username}` : "Choose a conversation from the left."}</span>
      </div>
      <div class="stat-card">
        <span class="metric-label">Unread state</span>
        <strong>${this.activeThreadId ? `${this.ctx.notify.unreadForThread(this.activeThreadId)} unread` : "-"}</strong>
        <span class="muted">${lastMessage ? `Last activity ${tsToRelative(lastMessage.created_at)}` : "No thread activity yet."}</span>
      </div>
      <div class="stat-card">
        <span class="metric-label">Attachment draft</span>
        <strong>${escapeHtml(this.pendingAttachment?.original_name || "None")}</strong>
        <span class="muted">${this.pendingAttachment ? "Ready to send with the next message." : "Upload an image, PDF, or document from the composer."}</span>
      </div>
    `;
  }

  openThread(otherId, createIfMissing = false) {
    this.activeThreadId = Number(otherId);
    if (createIfMissing && !this.threads.some((thread) => Number(thread.other_id) === this.activeThreadId)) {
      const user = this.userMap.get(this.activeThreadId) || {
        id: this.activeThreadId,
        username: `user${this.activeThreadId}`,
        display_name: `User ${this.activeThreadId}`,
      };
      this.threads.unshift({
        other_id: this.activeThreadId,
        username: user.username,
        display_name: user.display_name,
        created_at: Math.floor(Date.now() / 1000),
        body: "",
      });
    }
    this.renderThreads();
    this.renderThreadHeader();
    this.renderSidePanel();
    this.ctx.notify.markDMThreadRead(this.activeThreadId);
    this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
  }

  async uploadAttachment() {
    const file = $("#dmFileInput", this.root).files?.[0];
    if (!file) {
      $("#dmAttachmentStatus", this.root).className = "status warn";
      $("#dmAttachmentStatus", this.root).textContent = "Choose a file first.";
      return;
    }
    $("#dmAttachmentStatus", this.root).className = "status info";
    $("#dmAttachmentStatus", this.root).textContent = "Uploading...";
    try {
      const res = await uploadFile(file);
      this.pendingAttachment = res.file;
      $("#dmAttachmentStatus", this.root).className = "status success";
      $("#dmAttachmentStatus", this.root).textContent = `Attached ${res.file.original_name}`;
      $("#dmFileInput", this.root).value = "";
      this.renderSidePanel();
    } catch (error) {
      $("#dmAttachmentStatus", this.root).className = "status error";
      $("#dmAttachmentStatus", this.root).textContent = `Upload failed: ${error.payload?.detail || error.message}`;
      this.ctx.notify.toast("Upload failed", { tone: "error" });
    }
  }

  clearAttachment() {
    this.pendingAttachment = null;
    $("#dmAttachmentStatus", this.root).className = "status info";
    $("#dmAttachmentStatus", this.root).textContent = "No attachment selected.";
    this.renderSidePanel();
  }

  sendMessage(event) {
    event.preventDefault();
    if (!this.activeThreadId) {
      this.ctx.notify.toast("Select a thread first", { tone: "error" });
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
      this.userSearchRows.forEach((user) => this.userMap.set(Number(user.id), user));
      this.renderSearch();
    }
    if (msg.type === "dm_threads") {
      this.threads = msg.threads || [];
      this.threads.forEach((thread) => {
        this.userMap.set(Number(thread.other_id), {
          id: thread.other_id,
          username: thread.username,
          display_name: thread.display_name,
        });
      });
      this.renderThreads();
      this.renderSidePanel();
    }
    if (msg.type === "dm_history") {
      if (Number(msg.other_id) !== Number(this.activeThreadId)) return;
      this.messages = msg.messages || [];
      this.renderThreadHeader();
      this.renderMessages();
      this.renderSidePanel();
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
    }
    if (msg.type === "dm_new" && msg.message) {
      const message = msg.message;
      const otherId = Number(message.sender_id) === Number(this.ctx.me.id) ? Number(message.recipient_id) : Number(message.sender_id);
      if (Number(this.activeThreadId) === otherId) {
        this.messages.push(message);
        this.renderMessages();
        this.renderSidePanel();
        this.ctx.notify.markDMThreadRead(otherId);
      }
      this.ctx.ws.send({ type: "dm_threads" });
    }
    if (msg.type === "dm_deleted" || msg.type === "file_deleted") {
      this.refreshThreads();
    }
  }
}
