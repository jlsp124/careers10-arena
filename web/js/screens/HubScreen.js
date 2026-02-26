import { api } from "../net.js";
import { $, $$, createEl, debounce, escapeHtml } from "../ui.js";

export class HubScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "hub";
    this.title = "Hub";
    this.root = null;
    this.posts = [];
    this.loaded = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="screen-title">Hub</h2>
              <p class="helper">Resume · References · Interview · Assignment Help · Resources</p>
            </div>
          </div>
          <div class="card-body">
            <form id="hubPostForm" class="col">
              <div class="row wrap">
                <label class="stretch">Category
                  <select id="hubCategory">
                    <option>Resume</option>
                    <option>References</option>
                    <option>Interview</option>
                    <option>Assignment Help</option>
                    <option>Resources</option>
                  </select>
                </label>
                <label class="stretch">Tags
                  <input id="hubTags" maxlength="120" placeholder="comma,separated">
                </label>
              </div>
              <label>Title <input id="hubTitle" maxlength="120" required></label>
              <label>Post <textarea id="hubBody" maxlength="4000" required></textarea></label>
              <div class="row wrap">
                <button class="btn primary" type="submit">Post</button>
                <div id="hubStatus" class="status info stretch">Ready</div>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="section-title">Feed</h3></div>
          <div class="card-body col">
            <div class="row wrap">
              <input id="hubSearch" class="stretch" placeholder="Search">
              <select id="hubFilterCategory" style="max-width:220px">
                <option value="">All</option>
                <option>Resume</option>
                <option>References</option>
                <option>Interview</option>
                <option>Assignment Help</option>
                <option>Resources</option>
              </select>
              <button id="hubRefreshBtn" class="btn secondary" type="button">Refresh</button>
            </div>
            <div id="hubFeed" class="list" style="max-height:calc(100vh - 280px); overflow:auto;"></div>
          </div>
        </div>
      </div>
    `;

    $("#hubPostForm", this.root).addEventListener("submit", (e) => this.submitPost(e));
    $("#hubRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#hubSearch", this.root).addEventListener("input", debounce(() => this.renderFeed(), 120));
    $("#hubFilterCategory", this.root).addEventListener("change", () => this.renderFeed());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    this.ctx.notify.markHubRead();
    if (!this.loaded) await this.load();
  }

  hide() {}

  async load() {
    const status = $("#hubStatus", this.root);
    status.className = "status info stretch";
    status.textContent = "Loading…";
    try {
      const res = await api("/api/hub_feed");
      this.posts = res.posts || [];
      this.loaded = true;
      this.renderFeed();
      status.className = "status success stretch";
      status.textContent = `Loaded ${this.posts.length}`;
      this.ctx.notify.markHubRead();
    } catch (e) {
      status.className = "status error stretch";
      status.textContent = `Failed: ${e.message}`;
    }
  }

  get filteredPosts() {
    const q = ($("#hubSearch", this.root)?.value || "").trim().toLowerCase();
    const cat = $("#hubFilterCategory", this.root)?.value || "";
    return this.posts.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      const hay = `${p.title || ""}\n${p.body || ""}\n${p.tags || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  renderFeed() {
    const list = $("#hubFeed", this.root);
    const rows = this.filteredPosts;
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">No posts</div>`;
      return;
    }
    list.innerHTML = rows.map((p) => `
      <div class="list-row hub-post">
        <div class="stretch">
          <div class="row wrap" style="margin-bottom:4px;">
            <span class="badge">${escapeHtml(p.category)}</span>
            <span class="tiny muted">#${p.id}</span>
            <span class="tiny muted">${new Date(p.created_at * 1000).toLocaleString()}</span>
          </div>
          <div class="post-title">${escapeHtml(p.title)}</div>
          <div class="post-meta">${escapeHtml(p.display_name || p.username)} · @${escapeHtml(p.username)}${p.tags ? ` · ${escapeHtml(p.tags)}` : ""}</div>
          <div class="post-body">${escapeHtml(p.body)}</div>
        </div>
        ${this.ctx.me?.is_admin ? `
          <div class="col">
            <button class="btn ghost" data-del-post="${p.id}" type="button">Delete</button>
            <button class="btn ghost" data-mute-user="${p.user_id}" type="button">Mute</button>
          </div>
        ` : ""}
      </div>
    `).join("");
    if (this.ctx.me?.is_admin) {
      $$("[data-del-post]", list).forEach((btn) => btn.addEventListener("click", () => {
        this.ctx.ws.send({ type: "hub_delete", post_id: Number(btn.dataset.delPost) });
      }));
      $$("[data-mute-user]", list).forEach((btn) => btn.addEventListener("click", () => {
        this.ctx.ws.send({ type: "admin_mute", user_id: Number(btn.dataset.muteUser), minutes: 10 });
      }));
    }
  }

  async submitPost(ev) {
    ev.preventDefault();
    const status = $("#hubStatus", this.root);
    status.className = "status info stretch";
    status.textContent = "Posting…";
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
      this.posts = [res.post, ...this.posts.filter((p) => p.id !== res.post.id)];
      this.renderFeed();
      $("#hubTitle", this.root).value = "";
      $("#hubBody", this.root).value = "";
      $("#hubTags", this.root).value = "";
      status.className = "status success stretch";
      status.textContent = "Posted";
      this.ctx.notify.pushHubPost(res.post, { hubOpen: true, ownPost: true });
    } catch (e) {
      status.className = "status error stretch";
      status.textContent = `Failed: ${e.payload?.error || e.message}`;
      this.ctx.notify.toast(`Hub error: ${e.payload?.error || e.message}`, { tone: "error" });
    }
  }

  onEvent(msg) {
    if (msg.type === "hub_new_post" && msg.post) {
      this.posts = [msg.post, ...this.posts.filter((p) => p.id !== msg.post.id)];
      this.renderFeed();
      if (this.ctx.isScreenActive(this)) this.ctx.notify.markHubRead();
    }
    if (msg.type === "hub_deleted" && msg.ok) {
      this.posts = this.posts.filter((p) => Number(p.id) !== Number(msg.post_id));
      this.renderFeed();
    }
  }
}
