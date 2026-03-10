import { api } from "../net.js";
import {
  $,
  $$,
  createEl,
  escapeHtml,
  formatCC,
  formatCompactNumber,
  formatDecimal,
  formatSignedPct,
  percentClass,
  renderTokenAvatar,
  tsToLocal,
  tsToRelative,
} from "../ui.js";

export class HomeScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "home";
    this.title = "Home";
    this.root = null;
    this.data = null;
    this.selectedWalletId = null;
    this.loading = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel home-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Cortisol Arcade</h2>
          <p>Selected wallet, portfolio pressure, market motion, and communication activity in one client view.</p>
        </div>
        <div class="page-actions">
          <label class="inline-select">
            <span>Selected wallet</span>
            <select id="homeWalletSelect"></select>
          </label>
          <button id="homeRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Selected wallet</span>
          <strong id="homeWalletValue" class="stat-value">0 CC</strong>
          <span id="homeWalletNote" class="stat-note">No wallet selected</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total portfolio value</span>
          <strong id="homePortfolioValue" class="stat-value">0 CC</strong>
          <span id="homePortfolioNote" class="stat-note">Across all wallets</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cortisol score</span>
          <strong id="homeCortisolValue" class="stat-value">0</strong>
          <span id="homeCortisolNote" class="stat-note">Stable</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cortisol Coin balance</span>
          <strong id="homeCCValue" class="stat-value">0 CC</strong>
          <span id="homeCCNote" class="stat-note">Primary wallet balance</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Quick actions</h3>
              <p class="helper">Jump directly into the sections that move the portfolio.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="route-grid" id="homeQuickActions"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Notification summary</h3>
              <p class="helper">Unread messages, hub updates, and recent system alerts.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeNotifications" class="list-stack"></div>
          </div>
        </section>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Selected wallet summary</h3>
              <p class="helper">Balances, holdings, and the next steps for the active wallet.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeWalletSummary" class="stack"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Market movers</h3>
              <p class="helper">Trending assets and biggest percentage moves across the simulated market.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeMarketMovers" class="list-stack market-list"></div>
          </div>
        </section>
      </div>

      <div class="section-grid three">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Recent activity</h3>
              <p class="helper">Wallet, exchange, and arena results from the current account.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeRecentActivity" class="list-stack"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Bot activity feed</h3>
              <p class="helper">Active bot accounts and the latest strategies still in circulation.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeBotFeed" class="list-stack"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Explorer watch</h3>
              <p class="helper">Latest blocks and transactions with direct entry into Explorer.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="homeExplorerWatch" class="list-stack"></div>
          </div>
        </section>
      </div>
    `;

    $("#homeRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#homeWalletSelect", this.root).addEventListener("change", (event) => {
      this.selectedWalletId = Number(event.target.value || 0) || null;
      this.render();
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Wallet-first dashboard");
    this.ctx.setGlobalSearchValue("");
    if (route?.params?.wallet) this.selectedWalletId = Number(route.params.wallet || 0) || this.selectedWalletId;
    await this.load();
  }

  hide() {}

  get wallets() {
    return this.data?.wallets?.wallets || [];
  }

  get selectedWallet() {
    return this.wallets.find((wallet) => Number(wallet.id) === Number(this.selectedWalletId)) || this.wallets[0] || null;
  }

  async load() {
    this.loading = true;
    if (!this.data) this.render();
    try {
      this.data = await api("/api/dashboard");
      if (!this.selectedWalletId) {
        this.selectedWalletId = this.data?.wallets?.default_wallet_id || this.wallets[0]?.id || null;
      }
      if (!this.wallets.some((wallet) => Number(wallet.id) === Number(this.selectedWalletId))) {
        this.selectedWalletId = this.wallets[0]?.id || null;
      }
    } catch (error) {
      this.ctx.notify.toast(`Dashboard load failed: ${error.message}`, { tone: "error" });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    this.renderWalletSelect();
    this.renderSummary();
    this.renderQuickActions();
    this.renderNotifications();
    this.renderWalletSummary();
    this.renderMarketMovers();
    this.renderRecentActivity();
    this.renderBotFeed();
    this.renderExplorerWatch();
    this.renderInspector();
  }

  renderWalletSelect() {
    const select = $("#homeWalletSelect", this.root);
    const wallets = this.wallets;
    if (!wallets.length) {
      select.innerHTML = `<option value="">No wallets</option>`;
      return;
    }
    select.innerHTML = wallets.map((wallet) => `
      <option value="${wallet.id}" ${Number(wallet.id) === Number(this.selectedWalletId) ? "selected" : ""}>
        ${escapeHtml(wallet.name)}
      </option>
    `).join("");
  }

  renderSummary() {
    const wallet = this.selectedWallet;
    const stats = this.data?.stats || this.ctx.me?.stats || {};
    const totalValue = Number(this.data?.wallets?.summary?.total_value_cc || 0);
    const ccToken = (wallet?.tokens || []).find((token) => token.symbol === "CC");
    $("#homeWalletValue", this.root).textContent = wallet ? formatCC(wallet.total_value_cc || 0) : "0 CC";
    $("#homeWalletNote", this.root).textContent = wallet
      ? `${wallet.token_count || wallet.tokens?.length || 0} holdings · ${wallet.activity?.length || 0} recent events`
      : "No wallet selected";
    $("#homePortfolioValue", this.root).textContent = formatCC(totalValue);
    $("#homePortfolioNote", this.root).textContent = `${this.wallets.length || 0} wallet${this.wallets.length === 1 ? "" : "s"} tracked`;
    $("#homeCortisolValue", this.root).textContent = formatDecimal(stats.cortisol || 0, 0);
    $("#homeCortisolNote", this.root).textContent = `${stats.tier || "Stable"} tier`;
    $("#homeCCValue", this.root).textContent = formatCC(ccToken?.amount || ccToken?.wallet_amount || 0, 2);
    $("#homeCCNote", this.root).textContent = wallet ? `${escapeHtml(wallet.name)} liquid balance` : "Primary wallet balance";
  }

  renderQuickActions() {
    const actions = [
      { title: "Open Market", detail: "Search tokens, screen movers, and trade from the active wallet.", route: "market" },
      { title: "Open Explorer", detail: "Jump into blocks, wallets, transactions, and token detail.", route: "explorer" },
      { title: "Launch Play", detail: "Open the arena launcher and live room list.", route: "play" },
      { title: "Open Messages", detail: "Review unread threads and send files.", route: "messages" },
      { title: "Create Token", detail: "Launch a new asset from the current wallet.", route: "create-token" },
      { title: "Manage Wallets", detail: "Move between holdings, transfers, and CC conversion.", route: "wallets" },
      { title: "Open Hub", detail: "Share updates and browse the community feed.", route: "hub" },
      { title: "Mini-Games", detail: "Open the mini-game library and room links.", route: "minigames" },
    ];
    const node = $("#homeQuickActions", this.root);
    node.innerHTML = actions.map((action) => `
      <button class="action-card" data-home-route="${action.route}" type="button">
        <strong>${escapeHtml(action.title)}</strong>
        <span>${escapeHtml(action.detail)}</span>
      </button>
    `).join("");
    $$("[data-home-route]", node).forEach((button) => {
      button.addEventListener("click", () => {
        const route = button.dataset.homeRoute;
        const params = route === "create-token" && this.selectedWalletId ? { wallet: this.selectedWalletId } : {};
        this.ctx.navigate(route, params);
      });
    });
  }

  renderNotifications() {
    const counts = this.ctx.notify.getCounts?.() || { messages: 0, hub: 0, bell: 0 };
    const items = (this.ctx.notify.state?.items || []).slice(0, 4);
    const node = $("#homeNotifications", this.root);
    const summary = `
      <div class="detail-card">
        <div class="detail-row"><span class="muted">Unread messages</span><strong>${counts.messages || 0}</strong></div>
        <div class="detail-row"><span class="muted">Unread hub posts</span><strong>${counts.hub || 0}</strong></div>
        <div class="detail-row"><span class="muted">Bell queue</span><strong>${counts.bell || 0}</strong></div>
      </div>
    `;
    if (!items.length && !counts.messages && !counts.hub && !counts.bell) {
      node.innerHTML = `${summary}<div class="empty-state"><strong>No notifications</strong><span>Alerts, DMs, and hub posts appear here once activity starts.</span></div>`;
      return;
    }
    node.innerHTML = summary + items.map((item) => `
      <button class="list-item compact" data-home-notice="${escapeHtml(item.kind || "")}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(item.title || item.kind || "Alert")}</strong>
          <span>${tsToRelative(item.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(item.body || "")}</div>
      </button>
    `).join("");
    $$("[data-home-notice]", node).forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.homeNotice;
        if (kind === "dm") this.ctx.navigate("messages");
        else if (kind === "hub") this.ctx.navigate("hub");
      });
    });
  }

  renderWalletSummary() {
    const node = $("#homeWalletSummary", this.root);
    const wallet = this.selectedWallet;
    if (this.loading && !wallet) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!wallet) {
      node.innerHTML = `<div class="empty-state"><strong>No wallet available</strong><span>Create a wallet to start holding tokens.</span></div>`;
      return;
    }
    const topTokens = (wallet.tokens || []).slice(0, 6);
    node.innerHTML = `
      <div class="detail-card">
        <div class="detail-row">
          <div>
            <div class="small muted">Address</div>
            <div class="wallet-address">${escapeHtml(wallet.address)}</div>
          </div>
          <span class="badge primary">${formatCC(wallet.total_value_cc || 0)}</span>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Assets</span><strong>${wallet.tokens?.length || 0}</strong></div>
          <div><span class="muted">Recent events</span><strong>${wallet.activity?.length || 0}</strong></div>
        </div>
        <div class="list-stack">
          ${topTokens.length ? topTokens.map((token) => `
            <button class="token-row" data-home-wallet-token="${token.token_id || token.id}" type="button">
              <div class="token-row-main">
                ${renderTokenAvatar(token)}
                <div class="stretch">
                  <div class="row space">
                    <strong>${escapeHtml(token.name || token.symbol)}</strong>
                    <span class="chip">${formatCC(token.value_cc || token.wallet_value_cc || 0)}</span>
                  </div>
                  <div class="tiny muted">${escapeHtml(token.symbol)} · ${formatDecimal(token.amount || token.wallet_amount || 0, token.symbol === "CC" ? 2 : 4)} held</div>
                </div>
              </div>
            </button>
          `).join("") : `<div class="empty-state"><strong>No holdings</strong><span>This wallet does not hold any tokens yet.</span></div>`}
        </div>
      </div>
    `;
    $$("[data-home-wallet-token]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.ctx.navigate("market", { token: button.dataset.homeWalletToken });
      });
    });
  }

  renderMarketMovers() {
    const node = $("#homeMarketMovers", this.root);
    const rows = [...(this.data?.market?.tokens || [])]
      .sort((a, b) => Math.abs(Number(b.change_pct || 0)) - Math.abs(Number(a.change_pct || 0)))
      .slice(0, 6);
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No market movers</strong><span>Market data appears here once token pricing is available.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((token) => `
      <button class="token-row" data-home-token="${token.id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.price || 0, 4)}</span>
            </div>
            <div class="token-meta-line">
              <span>${escapeHtml(token.symbol)}</span>
              <span>${escapeHtml(token.category || "market")}</span>
              <span>Vol ${formatCC(token.volume_cc || 0)}</span>
            </div>
          </div>
        </div>
        <div class="row-trailing">
          <span class="trend-chip ${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</span>
        </div>
      </button>
    `).join("");
    $$("[data-home-token]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("market", { token: button.dataset.homeToken }));
    });
  }

  renderRecentActivity() {
    const node = $("#homeRecentActivity", this.root);
    const rows = this.data?.wallets?.transactions || [];
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No activity yet</strong><span>Trades, transfers, exchanges, and arena rewards will appear here.</span></div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 7).map((row) => `
      <div class="list-item compact">
        <div class="feed-meta">
          <strong>${escapeHtml(this.activityTitle(row))}</strong>
          <span>${tsToLocal(row.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(this.activityBody(row))}</div>
      </div>
    `).join("");
  }

  activityTitle(row) {
    if (row.kind === "cortisol_exchange") return "CC conversion";
    if (row.kind === "arena_match") return "Arena result";
    if (row.kind === "wallet_transfer") return "Wallet transfer";
    return row.kind || "Activity";
  }

  activityBody(row) {
    const meta = row.meta || {};
    if (meta.symbol && meta.amount) {
      return `${meta.symbol} · ${formatDecimal(meta.amount, 4)} · CC ${formatDecimal(row.delta_cc || 0, 2)}`;
    }
    if (meta.kind === "stress_for_coins" || meta.kind === "coins_for_calm") {
      return `CC ${formatDecimal(row.delta_cc || 0, 2)} · Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)}`;
    }
    if (row.delta_cc || row.delta_cortisol) {
      return `CC ${formatDecimal(row.delta_cc || 0, 2)} · Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)}`;
    }
    return JSON.stringify(meta || {});
  }

  renderBotFeed() {
    const node = $("#homeBotFeed", this.root);
    const rows = this.data?.bots || [];
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No bot activity</strong><span>Bot accounts appear here after the market loop activates.</span></div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 6).map((bot) => `
      <div class="list-item compact">
        <div class="feed-meta">
          <strong>${escapeHtml(bot.user?.display_name || bot.slug)}</strong>
          <span>${tsToRelative(bot.last_action_at)}</span>
        </div>
        <div class="feed-body">${escapeHtml(bot.strategy || "No strategy set")} · ${escapeHtml(bot.risk_level || "standard")} risk</div>
      </div>
    `).join("");
  }

  renderExplorerWatch() {
    const node = $("#homeExplorerWatch", this.root);
    const blocks = this.data?.explorer?.latest_blocks || [];
    const txs = this.data?.explorer?.latest_transactions || [];
    if (this.loading && !blocks.length && !txs.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!blocks.length && !txs.length) {
      node.innerHTML = `<div class="empty-state"><strong>No explorer data</strong><span>Blocks and transactions will appear here when chain activity is available.</span></div>`;
      return;
    }
    node.innerHTML = `
      ${blocks.slice(0, 3).map((block) => `
        <button class="list-item compact" data-home-block="${block.height}" type="button">
          <div class="feed-meta">
            <strong>Block ${block.height}</strong>
            <span>${tsToRelative(block.created_at || block.ts)}</span>
          </div>
          <div class="feed-body">${block.tx_count || 0} transaction${Number(block.tx_count || 0) === 1 ? "" : "s"}</div>
        </button>
      `).join("")}
      ${txs.slice(0, 4).map((tx) => `
        <button class="list-item compact" data-home-tx="${escapeHtml(tx.tx_hash || tx.id || "")}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(tx.tx_kind || tx.kind || "transaction")}</strong>
            <span>${tsToRelative(tx.created_at || tx.ts)}</span>
          </div>
          <div class="feed-body">${escapeHtml(tx.token?.symbol || tx.symbol || "asset")} · ${formatDecimal(tx.amount || 0, 4)}</div>
        </button>
      `).join("")}
    `;
    $$("[data-home-block]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "blocks", block: button.dataset.homeBlock }));
    });
    $$("[data-home-tx]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "transactions", tx: button.dataset.homeTx }));
    });
  }

  renderInspector() {
    const wallet = this.selectedWallet;
    if (!wallet) {
      this.ctx.clearInspector();
      return;
    }
    const ccToken = (wallet.tokens || []).find((token) => token.symbol === "CC");
    this.ctx.setInspector({
      title: wallet.name,
      subtitle: wallet.address,
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Portfolio value</span><strong>${formatCC(wallet.total_value_cc || 0)}</strong></div>
          <div class="detail-row"><span class="muted">Cortisol Coin</span><strong>${formatCC(ccToken?.amount || 0, 2)}</strong></div>
          <div class="detail-row"><span class="muted">Holdings</span><strong>${wallet.tokens?.length || 0}</strong></div>
          <div class="detail-row"><span class="muted">Activity</span><strong>${wallet.activity?.length || 0}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Jump points</div>
          <button class="btn secondary" data-home-inspector-route="wallets" type="button">Open wallet view</button>
          <button class="btn secondary" data-home-inspector-route="market" type="button">Open market</button>
          <button class="btn secondary" data-home-inspector-route="explorer" type="button">Open explorer</button>
        </div>
      `,
    });
    const inspectorRoot = document.getElementById("inspectorContent");
    $$("[data-home-inspector-route]", inspectorRoot).forEach((button) => {
      button.onclick = () => {
        const route = button.dataset.homeInspectorRoute;
        const params = route === "wallets"
          ? { wallet: wallet.id }
          : route === "market"
            ? {}
            : { view: "wallets", wallet: wallet.id };
        this.ctx.navigate(route, params);
      };
    });
  }

  onEvent(msg) {
    if (["announcement", "dm_new", "hub_new_post", "match_found"].includes(msg.type)) {
      this.renderNotifications();
    }
  }
}
