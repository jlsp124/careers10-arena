import { $, escapeHtml, storageGet, storageSet } from "./ui.js";

const STORE_KEY = "cortisol_arcade_notify_state";

export class NotifyCenter {
  constructor({ root }) {
    this.root = root;
    this.state = storageGet(STORE_KEY, {
      hub_unread: 0,
      dm_unread_total: 0,
      dm_threads: {},
      bell_unread: 0,
      items: [],
    });
    this.refs = {
      toastStack: $("#toastStack", root),
      bellBtn: $("#bellBtn", root),
      bellBadge: $("#bellBadge", root),
      bellPanel: $("#bellPanel", root),
      bellList: $("#bellList", root),
      sidebarHubBadge: $("#badgeHub", root),
      sidebarMsgBadge: $("#badgeMessages", root),
    };
    this._listeners = new Set();
    this._wire();
    this.render();
  }

  _wire() {
    this.refs.bellBtn?.addEventListener("click", () => {
      this.refs.bellPanel?.classList.toggle("open");
      if (this.refs.bellPanel?.classList.contains("open")) {
        this.state.bell_unread = 0;
        this._persist();
        this.render();
      }
    });
    document.addEventListener("click", (e) => {
      if (!this.refs.bellPanel || !this.refs.bellBtn) return;
      if (this.refs.bellPanel.contains(e.target) || this.refs.bellBtn.contains(e.target)) return;
      this.refs.bellPanel.classList.remove("open");
    });
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of [...this._listeners]) fn(this.getCounts());
  }

  _persist() {
    storageSet(STORE_KEY, this.state);
  }

  getCounts() {
    return {
      hub: Number(this.state.hub_unread || 0),
      messages: Number(this.state.dm_unread_total || 0),
      bell: Number(this.state.bell_unread || 0),
      dmThreads: { ...(this.state.dm_threads || {}) },
    };
  }

  _pushItem({ kind, title, body, ts = Math.floor(Date.now() / 1000), meta = {} }) {
    this.state.items.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, kind, title, body, ts, meta });
    this.state.items = this.state.items.slice(0, 80);
    this.state.bell_unread = (this.state.bell_unread || 0) + 1;
    this._persist();
    this.render();
    this._emit();
  }

  toast(text, { tone = "info", timeout = 2600 } = {}) {
    const stack = this.refs.toastStack;
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${tone}`;
    el.innerHTML = `<div class="toast-title">${escapeHtml(text)}</div>`;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 180);
    }, timeout);
  }

  pushAnnouncement(text) {
    this._pushItem({ kind: "announcement", title: "Announcement", body: text });
    this.toast(text, { tone: "info" });
  }

  pushMatchFound({ kind, mode, room_id }) {
    const label = `${kind}${mode ? ` · ${mode}` : ""}`;
    this._pushItem({ kind: "match", title: "Match Found", body: `${label} · ${room_id}` });
    this.toast(`Match found: ${label}`, { tone: "success", timeout: 1800 });
  }

  pushHubPost(post, { hubOpen = false, ownPost = false } = {}) {
    if (!ownPost && !hubOpen) this.state.hub_unread = (this.state.hub_unread || 0) + 1;
    this._pushItem({
      kind: "hub",
      title: "Hub",
      body: post?.title || "New post",
      meta: { postId: post?.id },
    });
    if (!ownPost) this.toast(`Hub: ${post?.title || "New post"}`, { tone: "info" });
    this._persist();
    this.render();
    this._emit();
  }

  pushDM(message, { myUserId, activeMessagesOpen = false, activeThreadId = null } = {}) {
    const otherId = Number(message.sender_id) === Number(myUserId) ? Number(message.recipient_id) : Number(message.sender_id);
    const incoming = Number(message.sender_id) !== Number(myUserId);
    if (incoming) {
      const threadKey = String(otherId);
      const isRead = activeMessagesOpen && Number(activeThreadId) === otherId;
      if (!isRead) {
        this.state.dm_threads[threadKey] = (this.state.dm_threads[threadKey] || 0) + 1;
        this.state.dm_unread_total = (this.state.dm_unread_total || 0) + 1;
      }
      this._pushItem({
        kind: "dm",
        title: "Message",
        body: message.body || (message.file ? `[${message.file.original_name}]` : "New message"),
        meta: { threadId: otherId },
      });
      this.toast("New message", { tone: "info" });
    }
    this._persist();
    this.render();
    this._emit();
  }

  markHubRead() {
    this.state.hub_unread = 0;
    this._persist();
    this.render();
    this._emit();
  }

  markDMThreadRead(threadId) {
    const key = String(threadId);
    const count = Number(this.state.dm_threads[key] || 0);
    if (count > 0) {
      this.state.dm_unread_total = Math.max(0, Number(this.state.dm_unread_total || 0) - count);
      this.state.dm_threads[key] = 0;
      this._persist();
      this.render();
      this._emit();
    }
  }

  unreadForThread(threadId) {
    return Number(this.state.dm_threads[String(threadId)] || 0);
  }

  render() {
    const counts = this.getCounts();
    if (this.refs.bellBadge) {
      this.refs.bellBadge.textContent = counts.bell > 99 ? "99+" : String(counts.bell || "");
      this.refs.bellBadge.classList.toggle("hidden", !counts.bell);
    }
    if (this.refs.sidebarHubBadge) {
      this.refs.sidebarHubBadge.textContent = counts.hub > 99 ? "99+" : String(counts.hub || "");
      this.refs.sidebarHubBadge.classList.toggle("hidden", !counts.hub);
    }
    if (this.refs.sidebarMsgBadge) {
      this.refs.sidebarMsgBadge.textContent = counts.messages > 99 ? "99+" : String(counts.messages || "");
      this.refs.sidebarMsgBadge.classList.toggle("hidden", !counts.messages);
    }
    if (this.refs.bellList) {
      const items = this.state.items || [];
      this.refs.bellList.innerHTML = items.length
        ? items.map((it) => `
            <div class="notif-row">
              <div class="notif-kind">${escapeHtml(it.title)}</div>
              <div class="notif-body">${escapeHtml(it.body || "")}</div>
              <div class="notif-time">${new Date(it.ts * 1000).toLocaleTimeString()}</div>
            </div>
          `).join("")
        : `<div class="empty-state">No notifications</div>`;
    }
  }
}

