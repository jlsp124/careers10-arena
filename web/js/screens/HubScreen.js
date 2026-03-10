import { api } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml, tsToLocal } from "../ui.js";

const HUB_CATEGORIES = ["Launches", "Strategy", "Rooms", "Resources", "Support"];

export class HubScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "hub";
    this.title = "Hub";
    this.root = null;
    this.posts = [];
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel hub-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Hub</span>
          <h2 class="screen-title">Community and discovery</h2>
          <p class="helper">Post updates, launch notes, room intel, and resources without leaving the terminal shell.</p>
        </div>
      </div>

      <div class="content-grid content-grid-hub">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Compose</h3>
              <p class="helper">Create a clean post for the shared feed.</p>
            </div>
          </div>
          <div class="card-body">
            <form id="hubPostForm" class="col">
              <div class="grid cols-2">
                <label>Category
                  <select id="hubCategory">
                    ${HUB_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join("")}
                  </select>
                </label>
                <label>Tags
                  <input id="hubTags" maxlength="120" placeholder="market, launch, guide">
                </label>
              </div>
              <label>Title
                <input id="hubTitle" maxlength="120" required placeholder="Headline">
              </label>
              <label>Post
                <textarea id="hubBody" maxlength="4000" required placeholder="What happened, what changed, or what should the community know?"></textarea>
              </label>
              <div class="row wrap">
                <button class="btn primary" type="submit">Publish</button>
                <div id="hubStatus" class="status info stretch">Ready</div>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Feed</h3>
              <p class="helper">Category, search, and pinned discovery cards.</p>
            </div>
          </div>
          <div class="card-body col">
            <div class="row wrap">
              <input id="hubSearch" class="stretch" placeholder="Search posts">
              <select id="hubFilterCategory">
                <option value="">All categories</option>
                ${HUB_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join("")}
              </select>
              <button id="hubRefreshBtn" class="btn secondary" type="button">Refresh</button>
            </div>
            <div id="hubPinned" class="mini-stat-grid"></div>
            <div id="hubFeed" class="list"></div>
          </div>
        </div>
      </div>
    `;

    $("#hubPostForm", this.root).addEventListener("submit", (event) => this.submitPost(event));
    $("#hubRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#hubSearch", this.root).addEventListener("input", debounce(() => this.renderFeed(), 120));
    $("#hubFilterCategory", this.root).addEventListener("change", () => this.renderFeed());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Community feed");
    await this.load();
    this.ctx.notify.markHubRead();
  }

  hide() {}

  async load() {
    const status = $("#hubStatus", this.root);
    status.className = "status info stretch";
    status.textContent = "Loading feed...";
    try {
      const res = await api("/api/hub_feed");
      this.posts = res.posts || [];
      this.renderPinned();
      this.renderFeed();
      status.className = "status success stretch";
      status.textContent = `${this.posts.length || 0} posts loaded`;
      this.ctx.notify.markHubRead();
    } catch (error) {
      status.className = "status error stretch";
      status.textContent = `Feed failed: ${error.message}`;
    }
  }

  get filteredPosts() {
    const query = ($("#hubSearch", this.root)?.value || "").trim().toLowerCase();
    const category = $("#hubFilterCategory", this.root)?.value || "";
    return this.posts.filter((post) => {
      if (category && post.category !== category) return false;
      if (!query) return true;
      const haystack = `${post.title || ""}\n${post.body || ""}\n${post.tags || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  renderPinned() {
    const node = $("#hubPinned", this.root);
    const featured = [
      { label: "Live feed", value: this.posts.length, detail: "Posts indexed" },
      { label: "Unread", value: this.ctx.notify.getCounts?.().hub || 0, detail: "Pending since last open" },
      { label: "Latest", value: this.posts[0]?.category || "Quiet", detail: this.posts[0] ? this.posts[0].title : "No post yet" },
    ];
    node.innerHTML = featured.map((card) => `
      <div class="stat-card">
        <span class="metric-label">${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
        <span class="muted">${escapeHtml(card.detail)}</span>
      </div>
    `).join("");
  }

  renderFeed() {
    const node = $("#hubFeed", this.root);
    const rows = this.filteredPosts;
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No posts matched the current filter.</div>`;
      return;
    }
    node.innerHTML = rows.map((post) => `
      <div class="hub-post-card">
        <div class="chip-row">
          <span class="chip chip-primary">${escapeHtml(post.category)}</span>
          <span class="chip">${tsToLocal(post.created_at)}</span>
          ${post.tags ? `<span class="chip">${escapeHtml(post.tags)}</span>` : ""}
        </div>
        <div class="hub-post-title">${escapeHtml(post.title)}</div>
        <div class="hub-post-meta">${escapeHtml(post.display_name || post.username)} | @${escapeHtml(post.username)}</div>
        <div class="hub-post-body">${escapeHtml(post.body)}</div>
        ${this.ctx.me?.is_admin ? `
          <div class="row wrap" style="margin-top:12px;">
            <button class="btn ghost" data-delete-post="${post.id}" type="button">Delete</button>
            <button class="btn ghost" data-mute-user="${post.user_id}" type="button">Mute</button>
          </div>
        ` : ""}
      </div>
    `).join("");

    if (this.ctx.me?.is_admin) {
      $$("[data-delete-post]", node).forEach((button) => button.addEventListener("click", () => this.ctx.ws.send({ type: "hub_delete", post_id: Number(button.dataset.deletePost) })));
      $$("[data-mute-user]", node).forEach((button) => button.addEventListener("click", () => this.ctx.ws.send({ type: "admin_mute", user_id: Number(button.dataset.muteUser), minutes: 10 })));
    }
  }

  async submitPost(event) {
    event.preventDefault();
    const status = $("#hubStatus", this.root);
    status.className = "status info stretch";
    status.textContent = "Publishing...";
    try {
      const res = await api("/api/hub_post", {
        method: "POST",
        json: {
          category: $("#hubCategory", this.root).value,
          title: $("#hubTitle", this.root).value,
          body: $("#hubBody", this.root).value,
          tags: $("#hubTags", this.root).value,
        },
      });
      this.posts = [res.post, ...this.posts.filter((post) => Number(post.id) !== Number(res.post.id))];
      $("#hubTitle", this.root).value = "";
      $("#hubBody", this.root).value = "";
      $("#hubTags", this.root).value = "";
      this.renderPinned();
      this.renderFeed();
      status.className = "status success stretch";
      status.textContent = "Published";
    } catch (error) {
      status.className = "status error stretch";
      status.textContent = `Publish failed: ${error.payload?.error || error.message}`;
      this.ctx.notify.toast(`Hub error: ${error.payload?.error || error.message}`, { tone: "error" });
    }
  }

  onEvent(msg) {
    if (msg.type === "hub_new_post" && msg.post) {
      this.posts = [msg.post, ...this.posts.filter((post) => Number(post.id) !== Number(msg.post.id))];
      this.renderPinned();
      this.renderFeed();
      if (this.ctx.isScreenActive(this)) this.ctx.notify.markHubRead();
    }
    if (msg.type === "hub_deleted" && msg.ok) {
      this.posts = this.posts.filter((post) => Number(post.id) !== Number(msg.post_id));
      this.renderPinned();
      this.renderFeed();
    }
  }
}
