import { api } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml, tsToLocal } from "../ui.js";

const HUB_CATEGORIES = ["All", "Launches", "Strategy", "Rooms", "Resources", "Support"];

export class HubScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "hub";
    this.title = "Hub";
    this.root = null;
    this.posts = [];
    this.loading = false;
    this.category = "All";
    this.query = "";
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel hub-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Hub</h2>
          <p>Share launch notes, strategy, room updates, and community resources from one feed.</p>
        </div>
        <div class="page-actions">
          <button id="hubRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Posts</span>
          <strong id="hubPostCount" class="stat-value">0</strong>
          <span class="stat-note">Visible feed entries</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Unread</span>
          <strong id="hubUnreadCount" class="stat-value">0</strong>
          <span class="stat-note">Unread items since last open</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Category</span>
          <strong id="hubCategoryCount" class="stat-value">All</strong>
          <span id="hubCategoryNote" class="stat-note">Current feed filter</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Latest post</span>
          <strong id="hubLatestTitle" class="stat-value">None</strong>
          <span id="hubLatestNote" class="stat-note">Waiting for a new post</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Composer</h3>
              <p class="helper">Publish a post into the shared feed without leaving the client.</p>
            </div>
          </div>
          <div class="panel-body">
            <form id="hubPostForm" class="form-stack">
              <div class="grid cols-2">
                <label>Category
                  <select id="hubCategory">
                    ${HUB_CATEGORIES.filter((category) => category !== "All").map((category) => `<option value="${category}">${category}</option>`).join("")}
                  </select>
                </label>
                <label>Tags
                  <input id="hubTags" maxlength="120" placeholder="market, launch, guide">
                </label>
              </div>
              <label>Title
                <input id="hubTitle" maxlength="120" required placeholder="Post title">
              </label>
              <label>Post
                <textarea id="hubBody" maxlength="4000" required placeholder="What changed, what launched, or what should the community know?"></textarea>
              </label>
              <button class="btn primary" type="submit">Publish</button>
              <div id="hubStatus" class="status info">Ready</div>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Feed</h3>
              <p class="helper">Filter by category or search the feed body, title, or tags.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="toolbar">
              <input id="hubSearch" class="stretch" placeholder="Search posts">
            </div>
            <div id="hubCategoryTabs" class="tabs"></div>
            <div id="hubFeed" class="hub-feed list-stack"></div>
          </div>
        </section>
      </div>
    `;

    $("#hubPostForm", this.root).addEventListener("submit", (event) => this.submitPost(event));
    $("#hubRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#hubSearch", this.root).addEventListener("input", debounce((event) => {
      this.query = (event.target.value || "").trim().toLowerCase();
      this.render();
    }, 120));
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Community feed and discovery");
    this.ctx.setGlobalSearchValue("");
    await this.load();
    this.ctx.notify.markHubRead();
  }

  hide() {}

  async load() {
    this.loading = true;
    this.renderFeed();
    const status = $("#hubStatus", this.root);
    status.className = "status info";
    status.textContent = "Loading feed...";
    try {
      const res = await api("/api/hub_feed");
      this.posts = res.posts || [];
      this.ctx.notify.markHubRead();
      status.className = "status success";
      status.textContent = `${this.posts.length || 0} posts loaded`;
    } catch (error) {
      status.className = "status error";
      status.textContent = `Feed failed: ${error.message}`;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  get filteredPosts() {
    return this.posts.filter((post) => {
      if (this.category !== "All" && post.category !== this.category) return false;
      if (!this.query) return true;
      const haystack = `${post.title || ""}\n${post.body || ""}\n${post.tags || ""}`.toLowerCase();
      return haystack.includes(this.query);
    });
  }

  render() {
    this.renderSummary();
    this.renderCategoryTabs();
    this.renderFeed();
    this.renderInspector();
  }

  renderSummary() {
    const unread = this.ctx.notify.getCounts?.().hub || 0;
    const rows = this.filteredPosts;
    const latest = rows[0] || this.posts[0];
    $("#hubPostCount", this.root).textContent = String(rows.length || 0);
    $("#hubUnreadCount", this.root).textContent = String(unread || 0);
    $("#hubCategoryCount", this.root).textContent = this.category;
    $("#hubCategoryNote", this.root).textContent = this.category === "All" ? "Showing every category" : `Showing ${this.category} only`;
    $("#hubLatestTitle", this.root).textContent = latest?.title || "None";
    $("#hubLatestNote", this.root).textContent = latest
      ? `${latest.display_name || latest.username} · ${latest.category}`
      : "Waiting for a new post";
  }

  renderCategoryTabs() {
    const node = $("#hubCategoryTabs", this.root);
    node.innerHTML = HUB_CATEGORIES.map((category) => `
      <button class="tab-btn ${category === this.category ? "active" : ""}" data-hub-category="${category}" type="button">${category}</button>
    `).join("");
    $$("[data-hub-category]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.category = button.dataset.hubCategory;
        this.render();
      });
    });
  }

  renderFeed() {
    const node = $("#hubFeed", this.root);
    const rows = this.filteredPosts;
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No posts in this view</strong><span>Try another category or adjust the search term.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((post) => `
      <article class="hub-post-card">
        <div class="chip-row">
          <span class="chip chip-primary">${escapeHtml(post.category)}</span>
          <span class="chip">${tsToLocal(post.created_at)}</span>
          ${post.tags ? `<span class="chip">${escapeHtml(post.tags)}</span>` : ""}
        </div>
        <div class="hub-post-title">${escapeHtml(post.title)}</div>
        <div class="hub-post-meta">${escapeHtml(post.display_name || post.username)} · @${escapeHtml(post.username)}</div>
        <div class="hub-post-body">${escapeHtml(post.body)}</div>
      </article>
    `).join("");
  }

  renderInspector() {
    const counts = HUB_CATEGORIES
      .filter((category) => category !== "All")
      .map((category) => ({ category, count: this.posts.filter((post) => post.category === category).length }))
      .sort((a, b) => b.count - a.count);
    this.ctx.setInspector({
      title: "Hub detail",
      subtitle: "Category counts and recent authors",
      content: `
        <div class="inspector-card">
          <div class="section-title">Category distribution</div>
          ${counts.map((item) => `
            <div class="detail-row">
              <span class="muted">${escapeHtml(item.category)}</span>
              <strong>${item.count}</strong>
            </div>
          `).join("")}
        </div>
        <div class="inspector-card">
          <div class="section-title">Recent authors</div>
          ${this.posts.slice(0, 5).map((post) => `
            <div class="detail-row">
              <span class="muted">${escapeHtml(post.display_name || post.username)}</span>
              <strong>${escapeHtml(post.category)}</strong>
            </div>
          `).join("") || `<div class="helper">No posts yet.</div>`}
        </div>
      `,
    });
  }

  async submitPost(event) {
    event.preventDefault();
    const status = $("#hubStatus", this.root);
    status.className = "status info";
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
      status.className = "status success";
      status.textContent = "Published";
      this.render();
    } catch (error) {
      status.className = "status error";
      status.textContent = `Publish failed: ${error.payload?.error || error.message}`;
      this.ctx.notify.toast(`Hub error: ${error.payload?.error || error.message}`, { tone: "error" });
    }
  }

  onEvent(msg) {
    if (msg.type === "hub_new_post" && msg.post) {
      this.posts = [msg.post, ...this.posts.filter((post) => Number(post.id) !== Number(msg.post.id))];
      this.render();
      if (this.ctx.isScreenActive(this)) this.ctx.notify.markHubRead();
    }
    if (msg.type === "hub_deleted" && msg.ok) {
      this.posts = this.posts.filter((post) => Number(post.id) !== Number(msg.post_id));
      this.render();
    }
  }
}
