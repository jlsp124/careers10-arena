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

const SORTS = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "volume", label: "Highest Volume" },
  { id: "gainers", label: "Biggest Gainers" },
  { id: "losers", label: "Biggest Losers" },
];

export class MarketScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "market";
    this.title = "Market";
    this.root = null;
    this.wallets = [];
    this.walletId = null;
    this.selectedTokenId = null;
    this.side = "buy";
    this.sort = "trending";
    this.query = "";
    this.payload = null;
    this.timer = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel market-screen" });
    this.root.innerHTML = `
      <div class="hero-card market-hero">
        <div class="hero-copy">
          <span class="eyebrow">Market</span>
          <h2 class="screen-title">Trading terminal</h2>
          <p class="helper">Search the simulated market, review risk flags, and execute buys or sells from the active wallet.</p>
        </div>
        <div class="hero-actions market-hero-actions">
          <label class="inline-select">
            <span>Wallet</span>
            <select id="marketWalletSelect"></select>
          </label>
          <button id="marketCreateTokenBtn" class="btn secondary" type="button">Create token</button>
          <button id="marketRefreshBtn" class="btn primary" type="button">Refresh</button>
        </div>
      </div>

      <div class="market-toolbar">
        <input id="marketSearch" class="market-search" placeholder="Search symbol, name, creator, or tag">
        <div id="marketSortTabs" class="pill-tabs"></div>
      </div>

      <div class="content-grid content-grid-market">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Asset List</h3>
              <p class="helper">Sortable token rows with mini charts and quick filtering.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="marketTokenList" class="list token-list market-token-list"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Token Detail</h3>
              <p class="helper">Branch into creator, risk, holders, and explorer context.</p>
            </div>
            <div class="row wrap">
              <button id="marketOpenExplorerBtn" class="btn ghost" type="button">Open explorer</button>
            </div>
          </div>
          <div class="card-body">
            <div id="marketTokenDetail"></div>
          </div>
        </div>

        <div class="card trade-card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Trade Panel</h3>
              <p class="helper">Pinned execution with live preview.</p>
            </div>
          </div>
          <div class="card-body">
            <div class="pill-tabs" id="marketSideTabs"></div>
            <div class="detail-stack" id="marketTradePanel"></div>
          </div>
        </div>
      </div>
    `;

    $("#marketRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#marketWalletSelect", this.root).addEventListener("change", (event) => {
      this.walletId = Number(event.target.value || 0) || null;
      this.load();
    });
    $("#marketSearch", this.root).addEventListener("input", (event) => {
      this.query = (event.target.value || "").trim();
      this.renderList();
    });
    $("#marketCreateTokenBtn", this.root).addEventListener("click", () => this.ctx.navigate("create-token", { wallet: this.walletId || "" }));
    $("#marketOpenExplorerBtn", this.root).addEventListener("click", () => {
      if (!this.selectedTokenId) return;
      this.ctx.navigate("explorer", { view: "tokens", token: this.selectedTokenId });
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Trading and discovery");
    this.side = route?.params?.side === "sell" ? "sell" : "buy";
    this.selectedTokenId = Number(route?.params?.token || 0) || this.selectedTokenId;
    await this.load();
    this.timer = setInterval(() => this.load({ silent: true }), 5000);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get tokens() {
    return this.payload?.tokens || [];
  }

  get selectedToken() {
    return this.payload?.selected_token
      || this.tokens.find((token) => Number(token.id || token.token_id) === Number(this.selectedTokenId))
      || this.tokens[0]
      || null;
  }

  async load({ silent = false } = {}) {
    if (!silent) this.ctx.setScreenLoading("Loading market...", true);
    try {
      if (!this.wallets.length) {
        const walletsRes = await api("/api/wallets");
        this.wallets = walletsRes.wallets || [];
        if (!this.walletId) this.walletId = walletsRes.default_wallet_id || this.wallets[0]?.id || null;
      }
      const query = new URLSearchParams();
      if (this.walletId) query.set("wallet_id", String(this.walletId));
      if (this.selectedTokenId) query.set("token_id", String(this.selectedTokenId));
      if (this.sort) query.set("sort", this.sort);
      this.payload = await api(`/api/market?${query.toString()}`);
      if (!this.selectedTokenId) this.selectedTokenId = this.payload?.selected_token?.id || this.tokens[0]?.id || null;
    } catch (error) {
      console.error("market load failed", error);
      this.ctx.notify.toast(`Market load failed: ${error.message}`, { tone: "error" });
    } finally {
      this.render();
      if (!silent) this.ctx.setScreenLoading("", false);
    }
  }

  render() {
    this.renderWallets();
    this.renderSortTabs();
    this.renderList();
    this.renderDetail();
    this.renderTrade();
  }

  renderWallets() {
    const select = $("#marketWalletSelect", this.root);
    select.innerHTML = this.wallets.map((wallet) => `
      <option value="${wallet.id}" ${Number(wallet.id) === Number(this.walletId) ? "selected" : ""}>${escapeHtml(wallet.name)}</option>
    `).join("");
  }

  renderSortTabs() {
    const tabs = $("#marketSortTabs", this.root);
    tabs.innerHTML = SORTS.map((sort) => `
      <button class="pill-tab ${sort.id === this.sort ? "active" : ""}" data-market-sort="${sort.id}" type="button">${sort.label}</button>
    `).join("");
    $$("[data-market-sort]", tabs).forEach((button) => {
      button.addEventListener("click", () => {
        this.sort = button.dataset.marketSort;
        this.load();
      });
    });
  }

  filteredTokens() {
    const q = this.query.toLowerCase();
    if (!q) return this.tokens;
    return this.tokens.filter((token) => {
      const haystack = `${token.name || ""}\n${token.symbol || ""}\n${token.category || ""}\n${token.creator || token.creator_name || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  renderList() {
    const list = $("#marketTokenList", this.root);
    const rows = this.filteredTokens();
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">No tokens matched the current filter.</div>`;
      return;
    }
    list.innerHTML = rows.map((token) => `
      <button class="token-row ${Number(token.id || token.token_id) === Number(this.selectedToken?.id || this.selectedToken?.token_id) ? "active" : ""}" data-market-token="${token.id || token.token_id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.price || 0, 4)}</span>
            </div>
            <div class="tiny muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category || token.status || "market")}</div>
            <div class="token-meta-line">
              <span>Vol ${formatCC(token.volume_24h || token.volume || 0)}</span>
              <span>MCap ${formatCC(token.market_cap || 0)}</span>
              <span>Supply ${formatCompactNumber(token.supply || token.total_supply || 0)}</span>
            </div>
          </div>
        </div>
        <div class="token-row-side">
          <div class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</div>
          <div class="mini-chart">${sparklineSvg(token.history || [], { width: 126, height: 36 })}</div>
        </div>
      </button>
    `).join("");
    $$("[data-market-token]", list).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedTokenId = Number(button.dataset.marketToken);
        this.ctx.navigate("market", { token: this.selectedTokenId, side: this.side });
      });
    });
  }

  renderDetail() {
    const token = this.selectedToken;
    const node = $("#marketTokenDetail", this.root);
    if (!token) {
      node.innerHTML = `<div class="empty-state">Select a token to inspect it.</div>`;
      return;
    }
    const recentTrades = token.recent_trades || this.payload?.market_activity || [];
    const topBots = this.payload?.top_bot_trades || [];
    node.innerHTML = `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token">
          <div class="row">
            ${renderTokenAvatar(token)}
            <div class="col" style="gap:4px;">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category || token.status || "token")}</span>
            </div>
          </div>
          <div class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</div>
        </div>

        <div class="mini-chart wide">${sparklineSvg(token.history || [], { width: 360, height: 92 })}</div>

        <div class="detail-grid">
          <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
          <div><span class="muted">Market Cap</span><strong>${formatCC(token.market_cap || 0)}</strong></div>
          <div><span class="muted">Supply</span><strong>${formatCompactNumber(token.supply || token.total_supply || 0)}</strong></div>
          <div><span class="muted">Volatility</span><strong>${escapeHtml(String(token.volatility || token.volatility_profile || "-"))}</strong></div>
          <div><span class="muted">Creator</span><strong>${escapeHtml(String(token.creator || token.creator_name || token.creator_wallet || token.creator_user_id || "-"))}</strong></div>
          <div><span class="muted">Risk</span><strong>${escapeHtml(String(token.risk_profile || token.risk_status || token.status || "-"))}</strong></div>
        </div>

        <p class="helper">${escapeHtml(token.description || "No token description available.")}</p>

        ${token.risk_flags?.length ? `
          <div class="chip-row">
            ${token.risk_flags.map((flag) => `<span class="chip chip-danger">${escapeHtml(flag)}</span>`).join("")}
          </div>
        ` : ""}

        <div class="content-grid content-grid-market-detail">
          <div class="detail-section">
            <h4>Recent Trades</h4>
            <div class="list">
              ${recentTrades.length ? recentTrades.slice(0, 6).map((trade) => `
                <div class="feed-row">
                  <div class="feed-meta">
                    <strong>${escapeHtml(trade.kind || trade.side || "trade")}</strong>
                    <span>${tsToRelative(trade.ts || trade.created_at)}</span>
                  </div>
                  <div class="feed-body">${escapeHtml((trade.summary || `${trade.symbol || token.symbol} ${formatDecimal(trade.amount || 0, 4)}`).trim())}</div>
                </div>
              `).join("") : `<div class="empty-state">No recent trades yet.</div>`}
            </div>
          </div>
          <div class="detail-section">
            <h4>Top Bot Trades</h4>
            <div class="list">
              ${topBots.length ? topBots.slice(0, 6).map((trade) => `
                <div class="feed-row">
                  <div class="feed-meta">
                    <strong>${escapeHtml(trade.bot_name || trade.actor || "Bot")}</strong>
                    <span>${tsToRelative(trade.ts || trade.created_at)}</span>
                  </div>
                  <div class="feed-body">${escapeHtml(trade.summary || `${trade.kind || "trade"} ${trade.symbol || token.symbol}`)}</div>
                </div>
              `).join("") : `<div class="empty-state">Bot trade feed is waiting for market simulation events.</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderTrade() {
    const token = this.selectedToken;
    const panel = $("#marketTradePanel", this.root);
    const tabs = $("#marketSideTabs", this.root);
    tabs.innerHTML = `
      <button class="pill-tab ${this.side === "buy" ? "active" : ""}" data-market-side="buy" type="button">Buy</button>
      <button class="pill-tab ${this.side === "sell" ? "active" : ""}" data-market-side="sell" type="button">Sell</button>
    `;
    $$("[data-market-side]", tabs).forEach((button) => {
      button.addEventListener("click", () => {
        this.side = button.dataset.marketSide;
        this.renderTrade();
      });
    });

    if (!token) {
      panel.innerHTML = `<div class="empty-state">Select a token to trade.</div>`;
      return;
    }

    const wallet = this.wallets.find((item) => Number(item.id) === Number(this.walletId)) || null;
    const amountOwned = Number(this.payload?.wallet?.tokens?.find((item) => Number(item.token_id || item.id) === Number(token.id || token.token_id))?.amount || token.wallet_amount || 0);
    const amountInput = Number($("#marketTradeAmount", this.root)?.value || 1);
    const gross = amountInput * Number(token.price || 0);
    const feeRate = Number(token.fee_rate || 0.01);
    const total = this.side === "buy" ? gross * (1 + feeRate) : gross * (1 - feeRate);
    const marketActivity = this.payload?.market_activity || [];
    panel.innerHTML = `
      <div class="stat-card">
        <span class="metric-label">Selected asset</span>
        <strong>${escapeHtml(token.name || token.symbol)}</strong>
        <span class="muted">${escapeHtml(token.symbol)} | held ${formatDecimal(amountOwned, token.symbol === "CC" ? 2 : 4)}</span>
      </div>
      <label>Amount
        <input id="marketTradeAmount" type="number" min="0.0001" step="0.0001" value="${amountInput}">
      </label>
      <div class="stat-card">
        <span class="metric-label">Preview</span>
        <strong>${this.side === "buy" ? "Cost" : "Receive"} ${formatCC(total, 4)}</strong>
        <span class="muted">Base ${formatCC(gross, 4)} | fee ${(feeRate * 100).toFixed(2)}% | wallet ${escapeHtml(wallet?.name || "-")}</span>
      </div>
      <button id="marketTradeSubmitBtn" class="btn primary" type="button">${this.side === "buy" ? "Buy asset" : "Sell asset"}</button>
      <div class="detail-section">
        <h4>Market-wide activity</h4>
        <div class="list">
          ${marketActivity.length ? marketActivity.slice(0, 6).map((row) => `
            <div class="feed-row">
              <div class="feed-meta"><strong>${escapeHtml(row.kind || row.side || "activity")}</strong><span>${tsToRelative(row.ts || row.created_at)}</span></div>
              <div class="feed-body">${escapeHtml(row.summary || `${row.symbol || token.symbol} ${formatDecimal(row.amount || 0, 4)}`)}</div>
            </div>
          `).join("") : `<div class="empty-state">Activity feed will populate as trades and launches hit the market.</div>`}
        </div>
      </div>
    `;

    $("#marketTradeAmount", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketTradeSubmitBtn", this.root).addEventListener("click", () => this.trade());
  }

  async trade() {
    const token = this.selectedToken;
    if (!token || !this.walletId) return;
    const amount = Number($("#marketTradeAmount", this.root).value || 0);
    await api("/api/trade", {
      method: "POST",
      json: {
        wallet_id: this.walletId,
        token_id: token.id || token.token_id,
        side: this.side,
        amount,
      },
    });
    this.ctx.notify.toast("Trade executed", { tone: "success" });
    this.wallets = [];
    await this.load();
  }
}
