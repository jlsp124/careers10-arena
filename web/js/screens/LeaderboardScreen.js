import { api } from "../net.js";
import { $, createEl, cortisolBadge, escapeHtml } from "../ui.js";

export class LeaderboardScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "leaderboard";
    this.title = "Leaderboard";
    this.root = null;
    this.tbody = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="screen-title">Leaderboard</h2>
            <p class="helper">Cortisol ranking</p>
          </div>
          <div class="row">
            <button id="lbRefreshBtn" class="btn secondary" type="button">Refresh</button>
          </div>
        </div>
        <div class="card-body">
          <div id="lbStatus" class="status info">Loading…</div>
          <div class="table-wrap" style="margin-top:16px;">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Name</th><th>User</th><th>Cortisol</th><th>W</th><th>L</th><th>KOs</th><th>D</th><th>Streak</th>
                </tr>
              </thead>
              <tbody id="lbBody">
                <tr><td colspan="9">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.tbody = $("#lbBody", this.root);
    $("#lbRefreshBtn", this.root).addEventListener("click", () => this.load());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "");
    await this.load();
  }

  hide() {}

  async load() {
    const status = $("#lbStatus", this.root);
    status.className = "status info";
    status.textContent = "Loading…";
    try {
      const res = await api("/api/leaderboard?limit=200");
      const rows = res.rows || [];
      this.tbody.innerHTML = rows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.display_name || r.username)}</td>
          <td>${escapeHtml(r.username)}</td>
          <td>${cortisolBadge(r.cortisol)}</td>
          <td>${r.wins}</td>
          <td>${r.losses}</td>
          <td>${r.kos}</td>
          <td>${r.deaths}</td>
          <td>${r.streak}</td>
        </tr>
      `).join("");
      status.className = "status success";
      status.textContent = `Loaded ${rows.length} players.`;
    } catch (e) {
      status.className = "status error";
      status.textContent = `Failed: ${e.message}`;
      this.tbody.innerHTML = `<tr><td colspan="9">Failed to load.</td></tr>`;
    }
  }

  onEvent(msg) {
    if (msg.type === "arena_end" || msg.type.endsWith("_end")) {
      // Lightweight refresh after matches.
      this.load();
    }
  }
}

