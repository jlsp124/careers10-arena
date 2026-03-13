import { api, uploadFile } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml, iconSprite, tsToLocal, tsToRelative } from "../ui.js";

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

function formatMessageBody(text) {
  return escapeHtml(text || "").replace(/\n/g, "<br>");
}

function memberLabel(member) {
  return escapeHtml(member?.display_name || member?.username || "Unknown");
}

function threadKindLabel(thread) {
  return thread?.kind === "group" ? "Group" : "Direct";
}

function threadCode(thread) {
  if (!thread) return "";
  if (thread.kind === "group") return `group:${thread.id}`;
  const direct = thread.direct_user;
  return direct?.username ? `dm:@${direct.username}` : `dm:${thread.id}`;
}

function threadPeopleSummary(thread) {
  if (!thread) return "";
  if (thread.kind === "group") {
    const members = Array.isArray(thread.members) ? thread.members : [];
    return members.map((member) => member.display_name || member.username).join(", ");
  }
  const direct = thread.direct_user;
  return direct ? `@${direct.username}` : thread.subtitle || "";
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
    this.pendingOpenUserId = null;
    this.pendingAttachment = null;
    this.searchQuery = "";
    this.groupDraftName = "";
    this.groupMemberIds = [];
    this.groupCreateBusy = false;
    this.threadsLoading = false;
    this.messagesLoading = false;
    this.hasBootstrappedThread = false;
    this.attachmentStatus = { tone: "info", text: "No attachment selected." };
    this.groupStatus = { tone: "info", text: "Add at least two people from search results to create a group." };
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel messages-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <div class="muted small">Communications</div>
          <h2>Messages</h2>
          <p>Direct chats, group rooms, attachments, and unread threads in a dedicated messaging workspace.</p>
        </div>
        <div class="page-actions chip-row">
          <span id="dmHeaderSummary" class="chip">0 threads</span>
          <button id="dmRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Conversations</h3>
              <p class="helper">Search people, start a direct chat, or create a named group with selected members.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="toolbar">
              <input id="dmSearchUsers" class="stretch" placeholder="Search people or @user">
              <button id="dmSearchBtn" class="btn secondary" type="button">Search</button>
            </div>
            <div id="dmSearchResults" class="list-stack"></div>

            <div class="detail-card">
              <div class="detail-row">
                <strong>Create group</strong>
                <span class="muted">2+ members</span>
              </div>
              <label>Group name
                <input id="dmGroupName" placeholder="Night shift alpha">
              </label>
              <div id="dmGroupMembers" class="chip-row"></div>
              <div class="toolbar">
                <button id="dmCreateGroupBtn" class="btn primary" type="button">Create group</button>
                <button id="dmClearGroupBtn" class="btn ghost" type="button">Clear</button>
              </div>
              <div id="dmGroupStatus" class="status info">Add at least two people from search results to create a group.</div>
            </div>

            <div class="detail-card">
              <div class="detail-grid">
                <div>
                  <span class="muted">Threads</span>
                  <strong id="dmThreadCount">0</strong>
                </div>
                <div>
                  <span class="muted">Unread</span>
                  <strong id="dmUnreadCount">0</strong>
                </div>
              </div>
            </div>

            <div id="dmThreadList" class="thread-list list-stack"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 id="dmThreadTitle" class="section-title">Select a thread</h3>
              <p id="dmThreadSub" class="helper">Choose a conversation to load its message history.</p>
            </div>
            <div id="dmThreadMeta" class="chip-row"></div>
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
                <button id="dmSendBtn" class="btn primary" type="submit">Send</button>
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
    $("#dmGroupName", this.root).addEventListener("input", (event) => {
      this.groupDraftName = String(event.target.value || "");
      this.renderGroupDraft();
    });
    $("#dmCreateGroupBtn", this.root).addEventListener("click", () => this.createGroup());
    $("#dmClearGroupBtn", this.root).addEventListener("click", () => this.clearGroupDraft());
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Direct messages and shared group rooms");
    this.searchQuery = route?.params?.q || this.searchQuery || "";
    this.ctx.setGlobalSearchValue(this.searchQuery ? `@${this.searchQuery}` : "");
    $("#dmSearchUsers", this.root).value = this.searchQuery;
    if (route?.params?.thread) this.activeThreadId = Number(route.params.thread || 0) || this.activeThreadId;
    this.render();
    this.refreshThreads();
    this.searchUsers();
  }

  hide() {
    this.ctx.clearInspector?.();
  }

  rememberUser(user) {
    if (!user || !user.id) return;
    this.userMap.set(Number(user.id), user);
  }

  rememberThread(thread) {
    if (!thread) return;
    this.rememberUser(thread.created_by);
    this.rememberUser(thread.direct_user);
    (thread.members || []).forEach((member) => this.rememberUser(member));
    (thread.participants_preview || []).forEach((member) => this.rememberUser(member));
  }

  upsertThread(thread) {
    if (!thread || !thread.id) return;
    this.rememberThread(thread);
    const id = Number(thread.id);
    const existingIndex = this.threads.findIndex((item) => Number(item.id) === id);
    if (existingIndex >= 0) this.threads.splice(existingIndex, 1, thread);
    else this.threads.unshift(thread);
    this.threads.sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
  }

  activeThread() {
    return this.threads.find((thread) => Number(thread.id) === Number(this.activeThreadId)) || null;
  }

  pendingUser() {
    return this.userMap.get(Number(this.pendingOpenUserId)) || null;
  }

  setAttachmentStatus(text, tone = "info") {
    this.attachmentStatus = { tone, text };
    const node = $("#dmAttachmentStatus", this.root);
    if (!node) return;
    node.className = `status ${tone}`;
    node.textContent = text;
  }

  setGroupStatus(text, tone = "info") {
    this.groupStatus = { tone, text };
    const node = $("#dmGroupStatus", this.root);
    if (!node) return;
    node.className = `status ${tone}`;
    node.textContent = text;
  }

  refreshThreads() {
    this.threadsLoading = true;
    this.renderThreads();
    this.ctx.ws.send({ type: "dm_threads" });
    if (this.activeThreadId) this.requestHistory({ threadId: this.activeThreadId });
  }

  requestHistory({ threadId = null, otherId = null } = {}) {
    this.messagesLoading = true;
    if (threadId) {
      this.activeThreadId = Number(threadId);
      this.pendingOpenUserId = null;
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
      this.ctx.ws.send({ type: "dm_history", thread_id: this.activeThreadId });
    } else if (otherId) {
      this.pendingOpenUserId = Number(otherId);
      this.ctx.ws.send({ type: "dm_history", other_id: this.pendingOpenUserId });
    }
    this.render();
  }

  searchUsers() {
    const q = ($("#dmSearchUsers", this.root).value || "").trim();
    this.searchQuery = q;
    this.ctx.ws.send({ type: "user_search", q });
  }

  findDirectThreadByUserId(userId) {
    return this.threads.find((thread) => thread.kind === "dm" && Number(thread.direct_user?.id || 0) === Number(userId)) || null;
  }

  openThread(threadId) {
    this.messages = [];
    this.requestHistory({ threadId });
  }

  openDirectChat(userId) {
    const existingThread = this.findDirectThreadByUserId(userId);
    if (existingThread) {
      this.openThread(existingThread.id);
      return;
    }
    this.activeThreadId = null;
    this.messages = [];
    this.requestHistory({ otherId: userId });
  }

  toggleGroupMember(userId) {
    const memberId = Number(userId);
    if (!memberId || Number(this.ctx.me?.id || 0) === memberId) return;
    if (this.groupMemberIds.includes(memberId)) {
      this.groupMemberIds = this.groupMemberIds.filter((id) => Number(id) !== memberId);
    } else {
      this.groupMemberIds = [...this.groupMemberIds, memberId];
    }
    this.setGroupStatus(
      this.groupMemberIds.length >= 2
        ? "Group is ready to create."
        : "Add at least two people from search results to create a group.",
      this.groupMemberIds.length >= 2 ? "success" : "info",
    );
    this.renderGroupDraft();
    this.renderSearch();
  }

  clearGroupDraft() {
    this.groupDraftName = "";
    this.groupMemberIds = [];
    this.groupCreateBusy = false;
    $("#dmGroupName", this.root).value = "";
    this.setGroupStatus("Add at least two people from search results to create a group.", "info");
    this.renderGroupDraft();
    this.renderSearch();
  }

  createGroup() {
    if (this.groupCreateBusy) return;
    const cleanName = this.groupDraftName.trim();
    if (!cleanName) {
      this.setGroupStatus("Group name is required.", "error");
      return;
    }
    if (this.groupMemberIds.length < 2) {
      this.setGroupStatus("Choose at least two members for a group chat.", "error");
      return;
    }
    this.groupCreateBusy = true;
    this.setGroupStatus("Creating group...", "info");
    this.ctx.ws.send({
      type: "dm_group_create",
      name: cleanName,
      member_ids: this.groupMemberIds,
    });
    this.renderGroupDraft();
  }

  render() {
    this.renderSummary();
    this.renderSearch();
    this.renderGroupDraft();
    this.renderThreads();
    this.renderThreadHeader();
    this.renderMessages();
    this.renderComposer();
    this.renderInspector();
  }

  renderSummary() {
    const counts = this.ctx.notify.getCounts?.() || { messages: 0 };
    const threadCount = this.threads.length || 0;
    $("#dmHeaderSummary", this.root).textContent = `${threadCount} thread${threadCount === 1 ? "" : "s"} | ${counts.messages || 0} unread`;
    $("#dmThreadCount", this.root).textContent = String(threadCount);
    $("#dmUnreadCount", this.root).textContent = String(counts.messages || 0);
  }

  renderSearch() {
    const node = $("#dmSearchResults", this.root);
    const rows = (this.userSearchRows || []).filter((user) => Number(user.id) !== Number(this.ctx.me?.id || 0));
    if (!rows.length) {
      node.innerHTML = this.searchQuery
        ? `<div class="empty-state"><strong>No people found</strong><span>No profiles matched the current search.</span></div>`
        : `<div class="empty-state"><strong>Search the roster</strong><span>Find someone by name or @username to start a new chat or add them to a group.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((user) => {
      const inGroup = this.groupMemberIds.includes(Number(user.id));
      return `
        <div class="list-item compact">
          <div class="feed-meta">
            <strong>${escapeHtml(user.display_name || user.username)}</strong>
            <span>@${escapeHtml(user.username)}</span>
          </div>
          <div class="feed-body">Open a direct thread or add this person to the current group draft.</div>
          <div class="chip-row">
            <button class="btn secondary" data-start-dm="${user.id}" type="button">${iconSprite("message")} Message</button>
            <button class="btn ${inGroup ? "primary" : "ghost"}" data-toggle-group-member="${user.id}" type="button">${inGroup ? "Added" : "Add to group"}</button>
          </div>
        </div>
      `;
    }).join("");
    $$("[data-start-dm]", node).forEach((button) => {
      button.addEventListener("click", () => this.openDirectChat(Number(button.dataset.startDm)));
    });
    $$("[data-toggle-group-member]", node).forEach((button) => {
      button.addEventListener("click", () => this.toggleGroupMember(Number(button.dataset.toggleGroupMember)));
    });
  }

  renderGroupDraft() {
    const membersNode = $("#dmGroupMembers", this.root);
    const members = this.groupMemberIds
      .map((userId) => this.userMap.get(Number(userId)))
      .filter(Boolean);
    $("#dmGroupName", this.root).value = this.groupDraftName;
    membersNode.innerHTML = members.length
      ? members.map((member) => `
          <button class="chip ${this.groupCreateBusy ? "chip-primary" : ""}" data-remove-group-member="${member.id}" type="button">
            ${escapeHtml(member.display_name || member.username)} <span class="muted">@${escapeHtml(member.username)}</span>
          </button>
        `).join("")
      : `<span class="helper">No group members selected yet.</span>`;
    $$("[data-remove-group-member]", membersNode).forEach((button) => {
      button.addEventListener("click", () => this.toggleGroupMember(Number(button.dataset.removeGroupMember)));
    });
    $("#dmCreateGroupBtn", this.root).disabled = this.groupCreateBusy;
    $("#dmClearGroupBtn", this.root).disabled = this.groupCreateBusy && !members.length && !this.groupDraftName.trim();
    this.setGroupStatus(this.groupStatus.text, this.groupStatus.tone);
  }

  renderThreads() {
    const node = $("#dmThreadList", this.root);
    if (this.threadsLoading && !this.threads.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!this.threads.length) {
      node.innerHTML = `<div class="empty-state"><strong>No conversations yet</strong><span>Start a direct chat from search results or create a group to populate the thread list.</span></div>`;
      return;
    }
    node.innerHTML = this.threads.map((thread) => {
      const unread = this.ctx.notify.unreadForThread(thread.id);
      const selected = Number(thread.id) === Number(this.activeThreadId);
      const previewLead = thread.kind === "group" && thread.last_sender
        ? `${thread.last_sender.display_name || thread.last_sender.username}: `
        : "";
      return `
        <button class="thread-row ${selected ? "active" : ""}" data-thread="${thread.id}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(thread.title || thread.name || "Conversation")}</strong>
            <span title="${escapeHtml(tsToLocal(thread.updated_at || thread.created_at))}">${tsToRelative(thread.updated_at || thread.created_at)}</span>
          </div>
          <div class="feed-body">${escapeHtml(previewLead)}${escapeHtml(thread.preview || "No messages yet.")}</div>
          <div class="chip-row">
            <span class="chip">${threadKindLabel(thread)}</span>
            <span class="chip">${thread.kind === "group" ? `${thread.member_count} members` : (thread.direct_user ? `@${escapeHtml(thread.direct_user.username)}` : "Direct")}</span>
            ${unread ? `<span class="chip chip-primary">${unread} unread</span>` : ""}
          </div>
        </button>
      `;
    }).join("");
    $$("[data-thread]", node).forEach((button) => {
      button.addEventListener("click", () => this.openThread(Number(button.dataset.thread)));
    });
  }

  renderThreadHeader() {
    const thread = this.activeThread();
    const pendingUser = this.pendingUser();
    const title = thread?.title || pendingUser?.display_name || pendingUser?.username || "Select a thread";
    const subtitle = thread
      ? (thread.kind === "group" ? threadPeopleSummary(thread) : `@${thread.direct_user?.username || ""}`)
      : (pendingUser ? `Opening @${pendingUser.username}...` : "Choose a conversation to load its message history.");
    $("#dmThreadTitle", this.root).textContent = title;
    $("#dmThreadSub", this.root).textContent = subtitle || "Choose a conversation to load its message history.";
    const unread = thread ? this.ctx.notify.unreadForThread(thread.id) : 0;
    $("#dmThreadMeta", this.root).innerHTML = thread ? `
      <span class="chip">${threadKindLabel(thread)}</span>
      <span class="chip">${thread.kind === "group" ? `${thread.member_count} members` : `Thread ${thread.id}`}</span>
      ${unread ? `<span class="chip chip-primary">${unread} unread</span>` : `<span class="chip">Read</span>`}
      <span class="chip"><code>${escapeHtml(threadCode(thread))}</code></span>
    ` : "";
  }

  renderMessages() {
    const node = $("#dmMessageList", this.root);
    const thread = this.activeThread();
    if (this.messagesLoading && (thread || this.pendingOpenUserId)) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!thread) {
      node.innerHTML = `<div class="empty-state"><strong>No thread selected</strong><span>Pick a direct chat or group from the left rail to start messaging.</span></div>`;
      return;
    }
    if (!this.messages.length) {
      node.innerHTML = `<div class="empty-state"><strong>No messages yet</strong><span>Send the first message, drop in an attachment, or share the thread with a clear prompt.</span></div>`;
      return;
    }
    node.innerHTML = this.messages.map((message) => {
      const mine = Number(message.sender_id) === Number(this.ctx.me.id);
      const senderLabel = mine ? "You" : (message.sender_display_name || message.sender_username || "Unknown");
      const canDeleteFile = message.file && (Number(message.file.uploader_id || 0) === Number(this.ctx.me?.id || 0) || this.ctx.me?.is_admin);
      return `
        <div class="message-card-deep ${mine ? "mine" : ""}">
          <div class="message-meta">
            <strong>${escapeHtml(senderLabel)}</strong>
            <span title="${escapeHtml(tsToLocal(message.created_at))}">${tsToRelative(message.created_at)} | <code>#${message.id}</code></span>
          </div>
          ${message.body ? `<div class="message-body">${formatMessageBody(message.body)}</div>` : ""}
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

  renderComposer() {
    const thread = this.activeThread();
    const disabled = !thread;
    $("#dmBody", this.root).disabled = disabled;
    $("#dmFileInput", this.root).disabled = disabled;
    $("#dmUploadBtn", this.root).disabled = disabled;
    $("#dmClearAttachmentBtn", this.root).disabled = disabled && !this.pendingAttachment;
    $("#dmSendBtn", this.root).disabled = disabled;
    $("#dmBody", this.root).placeholder = thread
      ? `Message ${thread.kind === "group" ? thread.title : `@${thread.direct_user?.username || "contact"}`}`
      : "Select a thread to start typing";
    this.setAttachmentStatus(this.attachmentStatus.text, this.attachmentStatus.tone);
  }

  renderInspector() {
    const thread = this.activeThread();
    const files = this.messages.filter((message) => message.file).slice(-4).reverse();
    const unread = thread ? this.ctx.notify.unreadForThread(thread.id) : 0;
    const members = thread?.members || [];
    this.ctx.setInspector({
      title: thread ? thread.title : "Thread detail",
      subtitle: thread ? threadCode(thread) : "Select a conversation",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Kind</span><strong>${thread ? threadKindLabel(thread) : "None"}</strong></div>
          <div class="detail-row"><span class="muted">Unread in thread</span><strong>${unread}</strong></div>
          <div class="detail-row"><span class="muted">Messages loaded</span><strong>${this.messages.length || 0}</strong></div>
          <div class="detail-row"><span class="muted">Attachment draft</span><strong>${escapeHtml(this.pendingAttachment?.original_name || "None")}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Members</div>
          ${members.length ? members.map((member) => `
            <div class="detail-row">
              <span>${escapeHtml(member.display_name || member.username)}</span>
              <strong>${escapeHtml(`@${member.username}`)}</strong>
            </div>
          `).join("") : `<div class="helper">No thread selected.</div>`}
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

  async uploadAttachment() {
    const file = $("#dmFileInput", this.root).files?.[0];
    if (!file) {
      this.setAttachmentStatus("Choose a file first.", "warn");
      return;
    }
    this.setAttachmentStatus("Uploading...", "info");
    try {
      const res = await uploadFile(file);
      this.pendingAttachment = res.file;
      $("#dmFileInput", this.root).value = "";
      this.setAttachmentStatus(`Attached ${res.file.original_name}`, "success");
      this.render();
    } catch (error) {
      this.setAttachmentStatus(`Upload failed: ${error.payload?.detail || error.message}`, "error");
      this.ctx.notify.toast("Upload failed", { tone: "error" });
    }
  }

  clearAttachment() {
    this.pendingAttachment = null;
    $("#dmFileInput", this.root).value = "";
    this.setAttachmentStatus("No attachment selected.", "info");
    this.renderComposer();
    this.renderInspector();
  }

  sendMessage(event) {
    event.preventDefault();
    const thread = this.activeThread();
    if (!thread) {
      this.ctx.notify.toast("Select a thread first", { tone: "error" });
      return;
    }
    const body = ($("#dmBody", this.root).value || "").trim();
    if (!body && !this.pendingAttachment) {
      this.ctx.notify.toast("Message is empty", { tone: "error" });
      return;
    }
    this.setAttachmentStatus("Sending...", "info");
    this.ctx.ws.send({
      type: "dm_send",
      thread_id: thread.id,
      body,
      file_id: this.pendingAttachment?.id || null,
    });
    $("#dmBody", this.root).value = "";
    this.pendingAttachment = null;
  }

  onEvent(msg) {
    if (msg.type === "user_search_result") {
      this.userSearchRows = (msg.users || []).filter((user) => Number(user.id) !== Number(this.ctx.me?.id || 0));
      this.userSearchRows.forEach((user) => this.rememberUser(user));
      this.renderSearch();
      return;
    }
    if (msg.type === "dm_threads") {
      this.threadsLoading = false;
      this.threads = msg.threads || [];
      this.threads.forEach((thread) => this.rememberThread(thread));
      if (!this.activeThreadId && !this.pendingOpenUserId && this.threads.length && !this.hasBootstrappedThread) {
        this.hasBootstrappedThread = true;
        this.openThread(this.threads[0].id);
        return;
      }
      if (this.activeThreadId && !this.threads.some((thread) => Number(thread.id) === Number(this.activeThreadId))) {
        this.activeThreadId = this.threads[0]?.id || null;
        if (this.activeThreadId) {
          this.openThread(this.activeThreadId);
          return;
        }
      }
      this.render();
      return;
    }
    if (msg.type === "dm_history" && msg.thread) {
      this.rememberThread(msg.thread);
      this.upsertThread(msg.thread);
      const directUserId = Number(msg.thread.direct_user?.id || 0);
      if (this.activeThreadId && Number(msg.thread_id) !== Number(this.activeThreadId) && directUserId !== Number(this.pendingOpenUserId || 0)) return;
      this.activeThreadId = Number(msg.thread_id || msg.thread.id);
      this.pendingOpenUserId = null;
      this.messagesLoading = false;
      this.messages = msg.messages || [];
      this.ctx.notify.markDMThreadRead(this.activeThreadId);
      this.render();
      return;
    }
    if (msg.type === "dm_new" && msg.message) {
      const message = msg.message;
      const threadId = Number(message.thread_id || 0);
      if (Number(this.activeThreadId) === threadId) {
        this.messages.push(message);
        this.messagesLoading = false;
        this.ctx.notify.markDMThreadRead(threadId);
        if (Number(message.sender_id) === Number(this.ctx.me?.id || 0)) {
          this.setAttachmentStatus("Message sent.", "success");
        }
      }
      this.ctx.ws.send({ type: "dm_threads" });
      this.render();
      return;
    }
    if (msg.type === "dm_thread_created" && msg.thread) {
      this.upsertThread(msg.thread);
      if (Number(msg.thread.created_by?.id || 0) === Number(this.ctx.me?.id || 0)) {
        this.groupCreateBusy = false;
        this.clearGroupDraft();
        this.openThread(msg.thread.id);
      } else {
        this.render();
      }
      return;
    }
    if (msg.type === "file_deleted") {
      this.refreshThreads();
      return;
    }
    if (msg.type === "error") {
      const error = String(msg.error || "");
      if (["group_name_required", "group_needs_two_members", "group_member_not_found", "bad_group_members", "group_create_failed"].includes(error)) {
        this.groupCreateBusy = false;
        this.setGroupStatus(error.replaceAll("_", " "), "error");
        this.renderGroupDraft();
      }
      if (["missing_recipient", "empty_message", "file_not_accessible", "thread_not_found", "message_send_failed"].includes(error)) {
        this.setAttachmentStatus(error.replaceAll("_", " "), "error");
      }
    }
  }
}
