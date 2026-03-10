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
    this.searchQuery = "";
    this.threadsLoading = false;
    this.messagesLoading = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel messages-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Messages</h2>
          <p>Direct conversations, unread threads, and file sharing from a dedicated messaging workspace.</p>
        </div>
        <div class="page-actions">
          <button id="dmRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Threads</span>
          <strong id="dmThreadCount" class="stat-value">0</strong>
          <span class="stat-note">Conversation threads in the current account</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Unread</span>
          <strong id="dmUnreadCount" class="stat-value">0</strong>
          <span class="stat-note">Unread message count across all threads</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Active thread</span>
          <strong id="dmActiveThreadName" class="stat-value">None</strong>
          <span id="dmActiveThreadNote" class="stat-note">Select a conversation to read or reply</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Attachment draft</span>
          <strong id="dmAttachmentName" class="stat-value">None</strong>
          <span id="dmAttachmentNote" class="stat-note">Upload a file before sending if needed</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Threads</h3>
              <p class="helper">Search users, start a conversation, or reopen an unread thread.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="toolbar">
              <input id="dmSearchUsers" class="stretch" placeholder="Search users by name or @username">
              <button id="dmSearchBtn" class="btn secondary" type="button">Search</button>
            </div>
            <div id="dmSearchResults" class="list-stack"></div>
            <div class="divider"></div>
            <div id="dmThreadList" class="thread-list list-stack"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 id="dmThreadTitle" class="section-title">Select a thread</h3>
              <p id="dmThreadSub" class="helper">Choose a conversation to load the message history.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="dmMessageList" class="conversation-log list-stack"></div>
            <form id="dmComposer" class="form-stack">
              <label>Message
                <textarea id="dmBody" placeholder="Write a message"></textarea>
              </label>
              <div class="toolbar">
                <input id="dmFileInput" type="file" class="stretch">
                <button id="dmUploadBtn" class="btn secondary" type="button">Upload</button>
                <button id="dmClearAttachmentBtn" class="btn ghost" type="button">Clear</button>
                <button class="btn primary" type="submit">Send</button>
              </div>
              <div id="dmAttachmentStatus" class="status info">No attachment selected.</div>
            </form>
          </div>
        </section>
      </div>
    `;

    $("#dmSearchBtn", this.root).addEventListener("click", () => this.searchUsers());
    $("#dmSearchUsers", this.root).addEventListener("input", debounce((event) => {
      this.searchQuery = (event.target.value || "").trim();
      this.searchUsers();
    }, 150));
    $("#dmRefreshBtn", this.root).addEventListener("click", () => this.refreshThreads());
    $("#dmUploadBtn", this.root).addEventListener("click", () => this.uploadAttachment());
    $("#dmClearAttachmentBtn", this.root).addEventListener("click", () => this.clearAttachment());
    $("#dmComposer", this.root).addEventListener("submit", (event) => this.sendMessage(event));
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Direct conversations and file sharing");
    this.searchQuery = route?.params?.q || this.searchQuery || "";
    this.ctx.setGlobalSearchValue(this.searchQuery ? `@${this.searchQuery}` : "");
    $("#dmSearchUsers", this.root).value = this.searchQuery;
    if (route?.params?.thread) this.activeThreadId = Number(route.params.thread || 0) || this.activeThreadId;
    this.refreshThreads();
    if (this.searchQuery || !this.userSearchRows.length) this.searchUsers();
    if (this.activeThreadId) {
      this.messagesLoading = true;
      this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
    }
    this.render();
  }

  hide() {}

  refreshThreads() {
    this.threadsLoading = true;
    this.renderThreads();
    this.ctx.ws.send({ type: "dm_threads" });
    if (this.activeThreadId) {
      this.messagesLoading = true;
      this.renderMessages();
      this.ctx.ws.send({ type: "dm_history", other_id: this.activeThreadId });
    }
  }

  searchUsers() {
    const q = ($("#dmSearchUsers", this.root).value || "").trim();
    this.searchQuery = q;
    this.ctx.ws.send({ type: "user_search", q });
  }

  render() {
    this.renderSummary();
    this.renderSearch();
    this.renderThreads();
    this.renderThreadHeader();
    this.renderMessages();
    this.renderInspector();
  }

  renderSummary() {
    const counts = this.ctx.notify.getCounts?.() || { messages: 0 };
    const activeUser = this.userMap.get(Number(this.activeThreadId));
    $("#dmThreadCount", this.root).textContent = String(this.threads.length || 0);
    $("#dmUnreadCount", this.root).textContent = String(counts.messages || 0);
    $("#dmActiveThreadName", this.root).textContent = activeUser?.display_name || activeUser?.username || "None";
    $("#dmActiveThreadNote", this.root).textContent = activeUser
      ? `@${activeUser.username}`
      : "Select a conversation to read or reply";
    $("#dmAttachmentName", this.root).textContent = this.pendingAttachment?.original_name || "None";
    $("#dmAttachmentNote", this.root).textContent = this.pendingAttachment
      ? "Ready to send with the next message"
      : "Upload a file before sending if needed";
  }

  renderSearch() {
    const node = $("#dmSearchResults", this.root);
    if (!this.searchQuery) {
      node.innerHTML = `<div class="empty-state"><strong>Search for a user</strong><span>Find someone by display name or username to start a new thread.</span></div>`;
      return;
    }
    if (!this.userSearchRows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No users found</strong><span>No profiles matched the current search.</span></div>`;
      return;
    }
    node.innerHTML = this.userSearchRows.map((user) => `
      <button class="list-item compact" data-pick-user="${user.id}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(user.display_name || user.username)}</strong>
          <span>@${escapeHtml(user.username)}</span>
        </div>
        <div class="feed-body">Start or reopen a direct conversation.</div>
      </button>
    `).join("");
    $$("[data-pick-user]", node).forEach((button) => {
      button.addEventListener("click", () => this.openThread(Number(button.dataset.pickUser), true));
    });
  }

  renderThreads() {
    const node = $("#dmThreadList", this.root);
    if (this.threadsLoading && !this.threads.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!this.threads.length) {
      node.innerHTML = `<div class="empty-state"><strong>No threads yet</strong><span>Search for a user to start the first conversation.</span></div>`;
      return;
    }
    node.innerHTML = this.threads.map((thread) => {
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
    $$("[data-thread]", node).forEach((button) => {
      button.addEventListener("click", () => this.openThread(Number(button.dataset.thread), false));
    });
  }

  renderThreadHeader() {
    const user = this.userMap.get(Number(this.activeThreadId));
    $("#dmThreadTitle", this.root).textContent = user ? (user.display_name || user.username) : "Select a thread";
    $("#dmThreadSub", this.root).textContent = user ? `@${user.username}` : "Choose a conversation to load the message history.";
  }

  renderMessages() {
    const node = $("#dmMessageList", this.root);
    if (this.messagesLoading && !this.messages.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!this.activeThreadId) {
      node.innerHTML = `<div class="empty-state"><strong>No thread selected</strong><span>Select a conversation from the thread list to view messages.</span></div>`;
      return;
    }
    if (!this.messages.length) {
      node.innerHTML = `<div class="empty-state"><strong>No messages yet</strong><span>Start the conversation with a message or attachment.</span></div>`;
      return;
    }
    node.innerHTML = this.messages.map((message) => {
      const mine = Number(message.sender_id) === Number(this.ctx.me.id);
      const canDeleteFile = message.file && (Number(message.file.uploader_id || 0) === Number(this.ctx.me?.id || 0) || this.ctx.me?.is_admin);
      return `
        <div class="message-card-deep ${mine ? "mine" : ""}">
          <div class="message-meta">
            <strong>${escapeHtml(message.sender_display_name || message.sender_username || "")}</strong>
            <span>${tsToLocal(message.created_at)} | #${message.id}</span>
          </div>
          ${message.body ? `<div class="message-body">${escapeHtml(message.body)}</div>` : ""}
          ${attachmentPreview(message.file)}
          ${canDeleteFile ? `<button class="btn ghost" data-delete-file="${message.file.id}" type="button">Delete file</button>` : ""}
        </div>
      `;
    }).join("");
    $$("[data-delete-file]", node).forEach((button) => {
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
    node.scrollTop = node.scrollHeight;
  }

  renderInspector() {
    const user = this.userMap.get(Number(this.activeThreadId));
    const files = this.messages.filter((message) => message.file).slice(-4).reverse();
    const unread = this.activeThreadId ? this.ctx.notify.unreadForThread(this.activeThreadId) : 0;
    this.ctx.setInspector({
      title: user ? (user.display_name || user.username) : "Thread detail",
      subtitle: user ? `@${user.username}` : "Select a conversation",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Unread in thread</span><strong>${unread}</strong></div>
          <div class="detail-row"><span class="muted">Messages loaded</span><strong>${this.messages.length || 0}</strong></div>
          <div class="detail-row"><span class="muted">Attachment draft</span><strong>${escapeHtml(this.pendingAttachment?.original_name || "None")}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Recent shared files</div>
          ${files.length ? files.map((message) => `
            <a class="list-item compact" href="/api/file/${message.file.id}" target="_blank" rel="noopener">
              <div class="feed-meta">
                <strong>${escapeHtml(message.file.original_name)}</strong>
                <span>${tsToRelative(message.created_at)}</span>
              </div>
              <div class="feed-body">${escapeHtml(message.file.mime || "file")}</div>
            </a>
          `).join("") : `<div class="helper">No files shared in this thread yet.</div>`}
        </div>
      `,
    });
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
    this.messagesLoading = true;
    this.render();
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
      this.render();
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
    this.render();
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
      return;
    }
    if (msg.type === "dm_threads") {
      this.threadsLoading = false;
      this.threads = msg.threads || [];
      this.threads.forEach((thread) => {
        this.userMap.set(Number(thread.other_id), {
          id: thread.other_id,
          username: thread.username,
          display_name: thread.display_name,
        });
      });
      this.render();
      return;
    }
    if (msg.type === "dm_history") {
      if (Number(msg.other_id) !== Number(this.activeThreadId)) return;
      this.messagesLoading = false;
      this.messages = msg.messages || [];
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
      this.render();
      return;
    }
    if (msg.type === "dm_new" && msg.message) {
      const message = msg.message;
      const otherId = Number(message.sender_id) === Number(this.ctx.me.id) ? Number(message.recipient_id) : Number(message.sender_id);
      if (Number(this.activeThreadId) === otherId) {
        this.messages.push(message);
        this.messagesLoading = false;
        this.ctx.notify.markDMThreadRead(otherId);
      }
      this.ctx.ws.send({ type: "dm_threads" });
      this.render();
      return;
    }
    if (msg.type === "file_deleted") {
      this.refreshThreads();
    }
  }
}
