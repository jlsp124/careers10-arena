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
  sparklineSvg,
  tsToLocal,
  tsToRelative,
} from "../ui.js";

export class HomeScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "home";
    this.title = "Home";
    this.root = null;
    this.walletId = null;
    this.data = null;
    this.lastAutoRefreshAt = 0;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel home-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Overview</span>
          <h2 class="screen-title">Portfolio command center</h2>
          <p class="helper">Monitor balances, market flow, bot pressure, and the latest activity from one wallet-first dashboard.</p>
        </div>
        <div class="hero-actions action-grid">
          <button class="quick-action" data-home-action="buy" type="button"><strong>Buy</strong><span>Open market panel</span></button>
          <button class="quick-action" data-home-action="sell" type="button"><strong>Sell</strong><span>Review holdings</span></button>
          <button class="quick-action" data-home-action="swap" type="button"><strong>Swap</strong><span>Move between assets</span></button>
          <button class="quick-action" data-home-action="create" type="button"><strong>Create Token</strong><span>Launch a new asset</span></button>
          <button class="quick-action" data-home-action="send" type="button"><strong>Send</strong><span>Transfer from wallet</span></button>
          <button class="quick-action" data-home-action="receive" type="button"><strong>Receive</strong><span>Share wallet address</span></button>
        </div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Portfolio</span>
          <strong id="homePortfolioValue" class="metric-value">0 CC</strong>
          <span id="homePortfolioSub" class="metric-sub">Across wallets</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Cortisol Coin</span>
          <strong id="homeCCBalance" class="metric-value">0 CC</strong>
          <span id="homeCCSub" class="metric-sub">Primary gas and utility balance</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Cortisol</span>
          <strong id="homeCortisolValue" class="metric-value">0</strong>
          <span id="homeCortisolSub" class="metric-sub">Current pressure tier</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Market Snapshot</span>
          <strong id="homeMarketPulse" class="metric-value">0</strong>
          <span id="homeMarketPulseSub" class="metric-sub">Tracked assets live</span>
        </div>
      </div>

      <div class="content-grid content-grid-home">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Selected Wallet</h3>
              <p class="helper">Fast access to balances, transfers, and token detail.</p>
            </div>
            <label class="inline-select">
              <span>Wallet</span>
              <select id="homeWalletSelect"></select>
            </label>
          </div>
          <div class="card-body col">
            <div id="homeWalletCard" class="wallet-hero-card skeleton-block"></div>
            <div class="mini-stat-grid" id="homeMarketCards"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Notifications</h3>
              <p class="helper">Local alerts and routed activity.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="homeNotifications" class="list feed-list"></div>
          </div>
        </div>
      </div>

      <div class="content-grid content-grid-home">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Recent Activity</h3>
              <p class="helper">Wallet, trade, and conversion events.</p>
            </div>
            <button id="homeRefreshBtn" class="btn secondary" type="button">Refresh</button>
          </div>
          <div class="card-body">
            <div id="homeRecentActivity" class="list feed-list"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Top Movers</h3>
              <p class="helper">Most active assets across the simulated market.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="homeTopMovers" class="list token-list"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Bot Activity Feed</h3>
              <p class="helper">Distinct simulation actors only.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="homeBotFeed" class="list feed-list"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="section-title">Your Tokens</h3>
            <p class="helper">Assets currently held across the selected wallet.</p>
          </div>
        </div>
        <div class="card-body">
          <div id="homeYourTokens" class="list token-list"></div>
        </div>
      </div>
    `;

    $("#homeRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#homeWalletSelect", this.root).addEventListener("change", (event) => {
      this.walletId = Number(event.target.value || 0) || null;
      this.load();
    });
    $$("[data-home-action]", this.root).forEach((button) => {
      button.addEventListener("click", () => this.handleAction(button.dataset.homeAction));
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Wallet-first overview");
    if (route?.params?.wallet) this.walletId = Number(route.params.wallet || 0) || null;
    await this.load();
  }

  hide() {}

  handleAction(action) {
    if (action === "buy") this.ctx.navigate("market", { side: "buy" });
    if (action === "sell") this.ctx.navigate("market", { side: "sell" });
    if (action === "swap") this.ctx.navigate("wallets", { action: "swap", wallet: this.walletId || "" });
    if (action === "create") this.ctx.navigate("create-token", { wallet: this.walletId || "" });
    if (action === "send") this.ctx.navigate("wallets", { action: "send", wallet: this.walletId || "" });
    if (action === "receive") this.ctx.navigate("wallets", { action: "receive", wallet: this.walletId || "" });
  }

  async load() {
    let payload = null;
    try {
      payload = await api(`/api/dashboard${this.walletId ? `?wallet_id=${encodeURIComponent(this.walletId)}` : ""}`);
    } catch {
      payload = await this.loadFallback();
    }
    this.data = payload || {};
    const selectedWalletId = Number(this.data.selected_wallet?.id || this.walletId || this.data.wallets?.[0]?.id || 0) || null;
    if (selectedWalletId && selectedWalletId !== this.walletId) {
      this.walletId = selectedWalletId;
    }
    this.render();
  }

  async loadFallback() {
    const walletsRes = await api("/api/wallets");
    const wallets = walletsRes.wallets || [];
    const walletId = this.walletId || walletsRes.default_wallet_id || wallets[0]?.id || null;
    const marketRes = await api(`/api/market${walletId ? `?wallet_id=${encodeURIComponent(walletId)}` : ""}`);
    const selectedWallet = wallets.find((wallet) => Number(wallet.id) === Number(walletId)) || wallets[0] || null;
    const portfolioTotal = wallets.reduce((sum, wallet) => sum + Number(wallet.total_value_cc || 0), 0);
    const tokens = marketRes.tokens || [];
    const sortedMovers = [...tokens]
      .map((token) => {
        const history = token.history || [];
        const first = Number(history[0] || token.price || 0);
        const last = Number(history[history.length - 1] || token.price || 0);
        const change = first ? ((last - first) / first) * 100 : 0;
        return { ...token, change_24h: change };
      })
      .sort((a, b) => Math.abs(Number(b.change_24h || 0)) - Math.abs(Number(a.change_24h || 0)));
    return {
      wallets,
      selected_wallet: selectedWallet,
      portfolio_total_cc: portfolioTotal,
      recent_activity: walletsRes.transactions || selectedWallet?.activity || [],
      top_movers: sortedMovers.slice(0, 6),
      bot_feed: [],
      your_tokens: selectedWallet?.tokens || [],
      market_cards: [
        { label: "Tracked assets", value: formatCompactNumber(tokens.length), detail: "Live market list" },
        { label: "Visible movers", value: formatCompactNumber(sortedMovers.length), detail: "Derived from price history" },
      ],
      notifications: (this.ctx.notify?.state?.items || []).slice(0, 8),
      stats: walletsRes.stats || this.ctx.me?.stats || {},
      market_stats: { active_tokens: tokens.length },
    };
  }

  render() {
    const wallets = this.data.wallets || [];
    const selectedWallet = this.data.selected_wallet
      || wallets.find((wallet) => Number(wallet.id) === Number(this.walletId))
      || wallets[0]
      || null;
    const portfolioTotal = Number(this.data.portfolio_total_cc ?? wallets.reduce((sum, wallet) => sum + Number(wallet.total_value_cc || 0), 0));
    const ccToken = (selectedWallet?.tokens || []).find((token) => token.symbol === "CC");
    const stats = this.data.stats || this.ctx.me?.stats || {};
    const marketStats = this.data.market_stats || {};

    const walletSelect = $("#homeWalletSelect", this.root);
    walletSelect.innerHTML = wallets.map((wallet) => `
      <option value="${wallet.id}" ${Number(wallet.id) === Number(selectedWallet?.id) ? "selected" : ""}>
        ${escapeHtml(wallet.name)}
      </option>
    `).join("");

    $("#homePortfolioValue", this.root).textContent = formatCC(portfolioTotal);
    $("#homePortfolioSub", this.root).textContent = `${wallets.length || 0} wallet${wallets.length === 1 ? "" : "s"} tracked`;
    $("#homeCCBalance", this.root).textContent = formatCC(ccToken?.amount || 0, 2);
    $("#homeCCSub", this.root).textContent = selectedWallet ? `${selectedWallet.name} primary balance` : "No wallet selected";
    $("#homeCortisolValue", this.root).textContent = formatDecimal(stats.cortisol || 0, 0);
    $("#homeCortisolSub", this.root).textContent = `${stats.tier || "Stable"} state`;
    $("#homeMarketPulse", this.root).textContent = formatCompactNumber(marketStats.active_tokens || this.data.top_movers?.length || 0);
    $("#homeMarketPulseSub", this.root).textContent = `${marketStats.mood?.regime || "balanced"} mood`;

    this.renderWalletCard(selectedWallet);
    this.renderMarketCards();
    this.renderNotifications();
    this.renderActivity(this.data.recent_activity || []);
    this.renderMovers(this.data.top_movers || []);
    this.renderBotFeed(this.data.bot_feed || []);
    this.renderYourTokens(this.data.your_tokens || selectedWallet?.tokens || []);
  }

  renderWalletCard(wallet) {
    const node = $("#homeWalletCard", this.root);
    if (!wallet) {
      node.innerHTML = `<div class="empty-state">No wallets available yet.</div>`;
      return;
    }
    const tokens = wallet.tokens || [];
    const topTokens = tokens.slice(0, 4).map((token) => `
      <div class="wallet-mini-token">
        ${renderTokenAvatar(token, { compact: true })}
        <div class="stretch">
          <strong>${escapeHtml(token.symbol)}</strong>
          <div class="tiny muted">${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)}</div>
        </div>
        <span class="chip">${formatCC(token.value_cc || 0)}</span>
      </div>
    `).join("");
    node.innerHTML = `
      <div class="wallet-hero-top">
        <div>
          <div class="tiny muted">Address</div>
          <div class="wallet-address">${escapeHtml(wallet.address)}</div>
        </div>
        <span class="chip chip-primary">${formatCC(wallet.total_value_cc || 0)}</span>
      </div>
      <div class="wallet-hero-name">${escapeHtml(wallet.name)}</div>
      <div class="wallet-hero-badges">
        <span class="chip">${tokens.length} asset${tokens.length === 1 ? "" : "s"}</span>
        <span class="chip">${wallet.activity?.length || 0} recent events</span>
      </div>
      <div class="wallet-mini-list">${topTokens || `<div class="empty-state">No holdings in this wallet yet.</div>`}</div>
    `;
  }

  renderMarketCards() {
    const cards = this.data.market_cards || [];
    const node = $("#homeMarketCards", this.root);
    if (!cards.length) {
      node.innerHTML = `
        <div class="stat-card"><strong>Market</strong><span class="muted">Dashboard data will appear here once the richer market snapshot is available.</span></div>
      `;
      return;
    }
    node.innerHTML = cards.slice(0, 4).map((card) => `
      <div class="stat-card">
        <span class="metric-label">${escapeHtml(card.label || "Metric")}</span>
        <strong>${escapeHtml(String(card.value ?? "-"))}</strong>
        <span class="muted">${escapeHtml(card.detail || "")}</span>
      </div>
    `).join("");
  }

  renderNotifications() {
    const items = this.data.notifications || this.ctx.notify?.state?.items || [];
    const node = $("#homeNotifications", this.root);
    if (!items.length) {
      node.innerHTML = `<div class="empty-state">No notifications yet.</div>`;
      return;
    }
    node.innerHTML = items.slice(0, 8).map((item) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(item.title || item.kind || "Alert")}</strong>
          <span>${tsToRelative(item.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(item.body || "")}</div>
      </div>
    `).join("");
  }

  renderActivity(rows) {
    const node = $("#homeRecentActivity", this.root);
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No activity yet.</div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 8).map((row) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(row.kind || row.type || "activity")}</strong>
          <span>${tsToLocal(row.ts || row.created_at)}</span>
        </div>
        <div class="feed-body">${this.renderActivityBody(row)}</div>
      </div>
    `).join("");
  }

  renderActivityBody(row) {
    if (row.meta?.symbol && row.meta?.amount) {
      return `${escapeHtml(row.meta.symbol)} | ${formatDecimal(row.meta.amount, 4)} @ ${formatDecimal(row.meta.price || 0, 4)}`;
    }
    if (row.meta?.from_wallet_id || row.meta?.to_wallet_id) {
      return `Wallet transfer | ${formatDecimal(row.meta.amount || 0, 4)} ${escapeHtml(row.meta.symbol || "asset")}`;
    }
    if (row.delta_cc || row.delta_cortisol) {
      return `CC ${formatDecimal(row.delta_cc || 0, 2)} | Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)}`;
    }
    return escapeHtml(row.body || row.summary || "Activity event");
  }

  renderMovers(rows) {
    const node = $("#homeTopMovers", this.root);
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No market data yet.</div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 6).map((token) => `
      <button class="token-row" data-open-token="${token.id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.price || 0, 4)}</span>
            </div>
            <div class="tiny muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category || token.status || "market")}</div>
          </div>
        </div>
        <div class="token-row-side">
          <div class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</div>
          <div class="mini-chart">${sparklineSvg(token.history || [], { width: 120, height: 34 })}</div>
        </div>
      </button>
    `).join("");
    $$("[data-open-token]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("market", { token: button.dataset.openToken }));
    });
  }

  renderBotFeed(rows) {
    const node = $("#homeBotFeed", this.root);
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">Bot events will appear here once the autonomous market feed is active.</div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 8).map((row) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(row.bot_name || row.actor || "Bot")}</strong>
          <span>${tsToRelative(row.ts || row.created_at)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.summary || row.body || `${row.kind || "activity"} ${row.symbol || ""}`.trim())}</div>
      </div>
    `).join("");
  }

  renderYourTokens(rows) {
    const node = $("#homeYourTokens", this.root);
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No token holdings in the selected wallet.</div>`;
      return;
    }
    node.innerHTML = rows.slice(0, 10).map((token) => `
      <button class="token-row" data-open-owned-token="${token.token_id || token.id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.value_cc || (Number(token.amount || 0) * Number(token.price || 0)), 2)}</span>
            </div>
            <div class="tiny muted">${escapeHtml(token.symbol)} | ${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)} held</div>
          </div>
        </div>
        <div class="token-row-side">
          <span class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</span>
        </div>
      </button>
    `).join("");
    $$("[data-open-owned-token]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("market", { token: button.dataset.openOwnedToken }));
    });
  }

  onEvent(msg) {
    if (msg.type === "market_cycle" && this.ctx.isScreenActive(this)) {
      const now = Date.now();
      if (now - this.lastAutoRefreshAt >= 5000) {
        this.lastAutoRefreshAt = now;
        this.load().catch(() => {});
      }
      return;
    }
    if (["dm_new", "hub_new_post", "announcement", "match_found"].includes(msg.type)) {
      this.renderNotifications();
    }
  }
}
