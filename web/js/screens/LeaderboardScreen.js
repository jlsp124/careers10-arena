import { api } from "../net.js";
import { $, createEl, cortisolBadge, escapeHtml, formatDecimal } from "../ui.js";

export class LeaderboardScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "leaderboard";
    this.title = "Leaderboard";
    this.root = null;
    this.rows = [];
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel leaderboard-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Leaderboard</h2>
          <p>Ranking by cortisol state, match performance, and recent arena outcomes.</p>
        </div>
        <div class="page-actions">
          <button id="lbRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Players loaded</span>
          <strong id="lbPlayerCount" class="stat-value">0</strong>
          <span class="stat-note">Rows currently in the leaderboard</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Top cortisol</span>
          <strong id="lbTopCortisol" class="stat-value">0</strong>
          <span id="lbTopCortisolNote" class="stat-note">Waiting for leaderboard data</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Most wins</span>
          <strong id="lbTopWins" class="stat-value">0</strong>
          <span id="lbTopWinsNote" class="stat-note">Waiting for leaderboard data</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Your position</span>
          <strong id="lbMyPosition" class="stat-value">-</strong>
          <span id="lbMyPositionNote" class="stat-note">Sign in to compare your account</span>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Player rankings</h3>
            <p class="helper">Ordered by the current server leaderboard response.</p>
          </div>
        </div>
        <div class="panel-body">
          <div id="lbStatus" class="status info">Loading...</div>
          <div class="table-wrap" style="margin-top:16px;">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>User</th>
                  <th>Cortisol</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>KOs</th>
                  <th>Deaths</th>
                  <th>Streak</th>
                </tr>
              </thead>
              <tbody id="lbBody">
                <tr><td colspan="9">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    $("#lbRefreshBtn", this.root).addEventListener("click", () => this.load());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Player rankings");
    this.ctx.setGlobalSearchValue("");
    await this.load();
  }

  hide() {}

  async load() {
    const status = $("#lbStatus", this.root);
    status.className = "status info";
    status.textContent = "Loading...";
    try {
      const res = await api("/api/leaderboard?limit=200");
      this.rows = res.rows || [];
      this.render();
      status.className = "status success";
      status.textContent = `Loaded ${this.rows.length} players`;
    } catch (error) {
      this.rows = [];
      this.render();
      status.className = "status error";
      status.textContent = `Failed: ${error.message}`;
    }
  }

  render() {
    const topCortisol = this.rows.reduce((best, row) => Number(row.cortisol || 0) > Number(best?.cortisol || -1) ? row : best, null);
    const topWins = this.rows.reduce((best, row) => Number(row.wins || 0) > Number(best?.wins || -1) ? row : best, null);
    const myIndex = this.rows.findIndex((row) => Number(row.id || row.user_id || 0) === Number(this.ctx.me?.id || -1));
    $("#lbPlayerCount", this.root).textContent = String(this.rows.length || 0);
    $("#lbTopCortisol", this.root).textContent = String(topCortisol?.cortisol || 0);
    $("#lbTopCortisolNote", this.root).textContent = topCortisol ? `${topCortisol.display_name || topCortisol.username}` : "Waiting for leaderboard data";
    $("#lbTopWins", this.root).textContent = String(topWins?.wins || 0);
    $("#lbTopWinsNote", this.root).textContent = topWins ? `${topWins.display_name || topWins.username}` : "Waiting for leaderboard data";
    $("#lbMyPosition", this.root).textContent = myIndex >= 0 ? String(myIndex + 1) : "-";
    $("#lbMyPositionNote", this.root).textContent = myIndex >= 0
      ? `${this.rows[myIndex].display_name || this.rows[myIndex].username} | ${formatDecimal(this.rows[myIndex].cortisol || 0, 0)} cortisol`
      : "Sign in to compare your account";

    const tbody = $("#lbBody", this.root);
    if (!this.rows.length) {
      tbody.innerHTML = `<tr><td colspan="9">No leaderboard rows available.</td></tr>`;
      this.ctx.clearInspector();
      return;
    }
    tbody.innerHTML = this.rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.display_name || row.username)}</td>
        <td>@${escapeHtml(row.username)}</td>
        <td>${cortisolBadge(row.cortisol)}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.kos}</td>
        <td>${row.deaths}</td>
        <td>${row.streak}</td>
      </tr>
    `).join("");

    this.ctx.setInspector({
      title: "Leaderboard detail",
      subtitle: "Top three players by current ranking",
      content: `
        <div class="inspector-card">
          ${this.rows.slice(0, 3).map((row, index) => `
            <div class="detail-row">
              <span class="muted">#${index + 1} ${escapeHtml(row.display_name || row.username)}</span>
              <strong>${escapeHtml(String(row.cortisol || 0))}</strong>
            </div>
          `).join("")}
        </div>
      `,
    });
  }

  onEvent(msg) {
    if (msg.type === "arena_end" || msg.type.endsWith("_end")) {
      this.load();
    }
  }
}
