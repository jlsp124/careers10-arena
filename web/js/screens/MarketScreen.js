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
  iconSprite,
  percentClass,
  priceVolumeChartSvg,
  renderTokenAvatar,
  sparklineSvg,
  storageGet,
  storageSet,
  tsToRelative,
} from "../ui.js";

const SORTS = [
  ["trending", "Trending"],
  ["newest", "New"],
  ["gainers", "Gainers"],
  ["losers", "Losers"],
  ["chaos", "Chaos"],
  ["volume", "Volume"],
];
const WATCHLIST_KEY = "cortisol_arcade_watchlist";
const TRADE_ERROR_LABELS = {
  bad_trade: "Enter a valid order size.",
  wallet_not_found: "The active wallet is unavailable.",
  token_not_found: "That token is no longer available.",
  cannot_trade_cc: "Cortisol Coin cannot be traded from this screen.",
  trade_size_too_large: "This order is too large for the current pool depth.",
  insufficient_cc_balance: "Not enough CC in the active wallet.",
  insufficient_token_balance: "Not enough token balance to sell that size.",
  trade_failed: "The order could not be filled right now.",
};

function parseRouteBool(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

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
    this.category = "";
    this.ownedOnly = false;
    this.watchOnly = false;
    this.payload = null;
    this.timer = null;
    this.watchlist = new Set(storageGet(WATCHLIST_KEY, []));
    this.tradeFeedback = null;
    this.pendingAction = "";
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel market-screen" });
    this.root.innerHTML = `
      <div class="hero-card market-hero">
        <div class="hero-copy">
          <span class="eyebrow">Market</span>
          <h2 class="screen-title">Cortisol Exchange terminal</h2>
          <p class="helper">Screen the tape, lock onto a token, and route buys, sells, and liquidity moves from the active wallet without losing state.</p>
        </div>
        <div class="hero-actions market-hero-actions">
          <label class="inline-select"><span>Wallet</span><select id="marketWalletSelect"></select></label>
          <button id="marketCreateTokenBtn" class="btn secondary" type="button">Create token</button>
          <button id="marketRefreshBtn" class="btn primary" type="button">Refresh</button>
        </div>
      </div>

      <div class="market-toolbar">
        <input id="marketSearch" class="market-search" placeholder="Search symbol, name, creator, regime, or category">
        <div id="marketSortTabs" class="pill-tabs"></div>
      </div>
      <div class="market-filter-bar">
        <label class="inline-select"><span>Category</span><select id="marketCategory"><option value="">All</option><option value="meme">Meme</option><option value="utility">Utility</option><option value="chaos">Chaos</option><option value="game">Game</option><option value="social">Social</option></select></label>
        <label class="checkbox-inline"><input id="marketOwnedOnly" type="checkbox"> Owned only</label>
        <label class="checkbox-inline"><input id="marketWatchOnly" type="checkbox"> Watchlist</label>
      </div>

      <div class="content-grid content-grid-market">
        <div class="card">
          <div class="card-header"><div><h3 class="section-title">Token Screener</h3><p class="helper">Selectable market rows with clear state, wallet exposure, and watchlist control.</p></div></div>
          <div class="card-body"><div id="marketTokenList" class="list token-list market-token-list"></div></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div><h3 class="section-title">Token Detail</h3><p class="helper">Selected-token board with chart, tape, holders, and risk context.</p></div>
            <div class="row wrap"><button id="marketOpenExplorerBtn" class="btn ghost" type="button">Open explorer</button></div>
          </div>
          <div class="card-body"><div id="marketTokenDetail"></div></div>
        </div>

        <div class="card trade-card">
          <div class="card-header"><div><h3 class="section-title">Execution</h3><p class="helper">Active-wallet trade ticket, order preview, and liquidity controls.</p></div></div>
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
      this.tradeFeedback = null;
      this.load();
    });
    $("#marketSearch", this.root).addEventListener("input", (event) => {
      this.query = (event.target.value || "").trim();
      this.renderList();
    });
    $("#marketCategory", this.root).addEventListener("change", (event) => {
      this.category = event.target.value || "";
      this.renderList();
    });
    $("#marketOwnedOnly", this.root).addEventListener("change", (event) => {
      this.ownedOnly = !!event.target.checked;
      this.renderList();
    });
    $("#marketWatchOnly", this.root).addEventListener("change", (event) => {
      this.watchOnly = !!event.target.checked;
      this.renderList();
    });
    $("#marketCreateTokenBtn", this.root).addEventListener("click", () => this.ctx.navigate("create-token", { wallet: this.walletId || "" }));
    $("#marketOpenExplorerBtn", this.root).addEventListener("click", () => this.selectedTokenId && this.ctx.navigate("explorer", { view: "tokens", token: this.selectedTokenId }));
    return this.root;
  }

  async show(route) {
    if (this.timer) clearInterval(this.timer);
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Trading and discovery");
    this.applyRoute(route);
    await this.load();
    this.timer = setInterval(() => this.load({ silent: true }), 6000);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get tokens() { return this.payload?.tokens || []; }
  get selectedToken() {
    const selectedId = Number(this.selectedTokenId || 0);
    const payloadToken = this.payload?.selected_token || null;
    if (payloadToken && (!selectedId || Number(payloadToken.id) === selectedId)) return payloadToken;
    return this.tokens.find((token) => Number(token.id) === selectedId) || payloadToken || this.tokens[0] || null;
  }
  get activeWallet() {
    const selectedId = Number(this.walletId || 0);
    const payloadWallet = this.payload?.wallet || null;
    if (payloadWallet && (!selectedId || Number(payloadWallet.id) === selectedId)) return payloadWallet;
    return this.wallets.find((item) => Number(item.id) === selectedId) || this.wallets[0] || payloadWallet || null;
  }

  applyRoute(route) {
    const params = route?.params || {};
    this.side = params.side === "sell" ? "sell" : (params.side === "liquidity" ? "liquidity" : "buy");
    this.selectedTokenId = Number(params.token || 0) || null;
    this.walletId = Number(params.wallet || params.wallet_id || 0) || null;
    this.query = String(params.q || "").trim();
    this.category = String(params.category || "").trim();
    this.ownedOnly = parseRouteBool(params.owned_only || params.ownedOnly);
    this.watchOnly = parseRouteBool(params.watch_only || params.watchOnly);
    this.sort = String(params.sort || this.sort || "trending");
  }

  routeParams(overrides = {}) {
    const params = {
      side: this.side,
      wallet: this.walletId || "",
      token: this.selectedTokenId || "",
      q: this.query,
      category: this.category,
      owned_only: this.ownedOnly ? "1" : "",
      watch_only: this.watchOnly ? "1" : "",
      sort: this.sort,
    };
    return { ...params, ...overrides };
  }

  async load({ silent = false } = {}) {
    if (!silent) this.ctx.setScreenLoading("Loading market...", true);
    try {
      const query = new URLSearchParams();
      if (this.walletId) query.set("wallet_id", String(this.walletId));
      if (this.selectedTokenId) query.set("token", String(this.selectedTokenId));
      if (this.query) query.set("search", this.query);
      if (this.sort) query.set("sort", this.sort);
      if (this.category) query.set("category", this.category);
      if (this.ownedOnly) query.set("owned_only", "1");
      this.payload = await api(`/api/market?${query.toString()}`);
      this.wallets = this.payload?.wallets || this.wallets || [];
      this.walletId = this.payload?.wallet?.id || this.walletId || this.wallets[0]?.id || null;
      if (!this.selectedTokenId) this.selectedTokenId = this.payload?.selected_token?.id || this.tokens[0]?.id || null;
      if (this.selectedTokenId && this.payload?.selected_token?.id) {
        this.selectedTokenId = Number(this.payload.selected_token.id);
      }
      this.render();
    } finally {
      if (!silent) this.ctx.setScreenLoading("", false);
    }
  }

  render() {
    $("#marketSearch", this.root).value = this.query;
    $("#marketCategory", this.root).value = this.category;
    $("#marketOwnedOnly", this.root).checked = this.ownedOnly;
    $("#marketWatchOnly", this.root).checked = this.watchOnly;
    this.renderWallets();
    this.renderSortTabs();
    this.renderList();
    this.renderDetail();
    this.renderTrade();
  }

  renderWallets() {
    $("#marketWalletSelect", this.root).innerHTML = this.wallets.map((wallet) => `<option value="${wallet.id}" ${Number(wallet.id) === Number(this.walletId) ? "selected" : ""}>${escapeHtml(wallet.name)}</option>`).join("");
  }

  renderSortTabs() {
    const tabs = $("#marketSortTabs", this.root);
    tabs.innerHTML = SORTS.map(([id, label]) => `<button class="pill-tab ${id === this.sort ? "active" : ""}" data-market-sort="${id}" type="button">${label}</button>`).join("");
    $$("[data-market-sort]", tabs).forEach((button) => button.addEventListener("click", () => {
      this.sort = button.dataset.marketSort;
      this.render();
    }));
  }

  filteredTokens() {
    const q = this.query.toLowerCase();
    return this.sortTokens(this.tokens.filter((token) => {
      if (this.ownedOnly && Number(token.wallet_amount || 0) <= 0) return false;
      if (this.category && String(token.category || "").toLowerCase() !== this.category.toLowerCase()) return false;
      if (this.watchOnly && !this.watchlist.has(Number(token.id))) return false;
      if (!q) return true;
      const creator = `${token.creator?.display_name || ""} ${token.creator?.username || ""}`.toLowerCase();
      const haystack = `${token.name || ""}\n${token.symbol || ""}\n${token.category || ""}\n${token.regime || ""}\n${token.description || ""}\n${creator}`.toLowerCase();
      return haystack.includes(q);
    }));
  }

  sortTokens(rows) {
    const items = [...rows];
    if (this.sort === "trending") return items.sort((a, b) => (Number(b.trend_score || 0) - Number(a.trend_score || 0)) || (Number(b.volume_cc || 0) - Number(a.volume_cc || 0)));
    if (this.sort === "newest") return items.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    if (this.sort === "gainers") return items.sort((a, b) => Number(b.change_pct || 0) - Number(a.change_pct || 0));
    if (this.sort === "losers") return items.sort((a, b) => Number(a.change_pct || 0) - Number(b.change_pct || 0));
    if (this.sort === "chaos") return items.sort((a, b) => Number(b.chaos_score || 0) - Number(a.chaos_score || 0));
    if (this.sort === "volume") return items.sort((a, b) => Number(b.volume_cc || 0) - Number(a.volume_cc || 0));
    return items;
  }

  renderList() {
    const list = $("#marketTokenList", this.root);
    const rows = this.filteredTokens();
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">No tokens matched the current filter.</div>`;
      return;
    }
    const summary = this.payload?.summary || {};
    list.innerHTML = `
      <div class="detail-section" style="margin-bottom:12px; padding:14px 16px;">
        <div class="row wrap space" style="gap:12px;">
          <div class="chip-row" style="gap:8px;">
            <span class="chip">${iconSprite("stack")} ${formatCompactNumber(summary.token_count || rows.length)} listed</span>
            <span class="chip">${iconSprite("wallet")} ${formatCompactNumber(summary.owned_token_count || 0)} owned</span>
            <span class="chip">${iconSprite("pulse")} ${formatCC(summary.volume_cc || 0)} flow</span>
          </div>
          <div class="tiny muted">Mood ${escapeHtml(summary.market_mood?.regime || "balanced")} | Watchlist ${this.watchlist.size}</div>
        </div>
      </div>
      ${rows.map((token, index) => {
        const isActive = Number(token.id) === Number(this.selectedTokenId || this.selectedToken?.id);
        const ownedAmount = Number(token.wallet_amount || 0);
        const rowStyle = isActive
          ? "border:1px solid rgba(132,120,255,0.55); box-shadow:0 0 0 1px rgba(132,120,255,0.18), 0 22px 44px rgba(11,14,25,0.36); background:linear-gradient(180deg, rgba(132,120,255,0.12), rgba(17,20,31,0.96));"
          : "border:1px solid rgba(255,255,255,0.06); background:linear-gradient(180deg, rgba(255,255,255,0.015), rgba(9,11,17,0.92));";
        return `
          <div class="market-row-wrap ${isActive ? "active" : ""}" style="${rowStyle}">
            <button class="token-row" data-market-token="${token.id}" type="button" aria-pressed="${isActive ? "true" : "false"}">
              <div class="token-row-main" style="align-items:flex-start;">
                ${renderTokenAvatar(token)}
                <div class="stretch">
                  <div class="row wrap space" style="gap:10px;">
                    <div class="col" style="gap:4px;">
                      <strong>${escapeHtml(token.name || token.symbol)}</strong>
                      <span class="tiny muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category || token.regime || "market")} | ${escapeHtml(token.creator?.display_name || token.creator?.username || "market")}</span>
                    </div>
                    <div class="col" style="align-items:flex-end; gap:6px;">
                      <span class="chip">${isActive ? "Selected" : `#${index + 1}`}</span>
                      <strong>${formatCC(token.price || 0, 4)}</strong>
                    </div>
                  </div>
                  <div class="chip-row" style="margin-top:8px;">
                    <span class="chip ${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</span>
                    <span class="chip">Vol ${formatCC(token.volume_cc || 0)}</span>
                    <span class="chip">Liq ${formatCC(token.liquidity_value_cc || 0)}</span>
                    <span class="chip">Risk ${formatDecimal(token.risk_score || 0, 0)}</span>
                    ${ownedAmount > 0 ? `<span class="chip positive">Held ${formatDecimal(ownedAmount, 4)} ${escapeHtml(token.symbol)}</span>` : ""}
                  </div>
                </div>
              </div>
              <div class="token-row-side" style="align-items:flex-end; gap:10px;">
                <div class="tiny muted">${formatCC(token.wallet_value_cc || 0)} wallet value</div>
                <div class="mini-chart">${sparklineSvg(token.history || [], { width: 132, height: 38 })}</div>
              </div>
            </button>
            <button class="watch-toggle ${this.watchlist.has(Number(token.id)) ? "active" : ""}" data-toggle-watch="${token.id}" type="button">${iconSprite("spark")} ${this.watchlist.has(Number(token.id)) ? "Watch" : "Track"}</button>
          </div>
        `;
      }).join("")}
    `;
    $$("[data-market-token]", list).forEach((button) => button.addEventListener("click", () => {
      this.selectedTokenId = Number(button.dataset.marketToken);
      this.tradeFeedback = null;
      this.ctx.navigate("market", this.routeParams({ token: this.selectedTokenId }));
    }));
    $$("[data-toggle-watch]", list).forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleWatch(Number(button.dataset.toggleWatch));
    }));
  }

  renderDetail() {
    const token = this.selectedToken;
    const node = $("#marketTokenDetail", this.root);
    if (!token) {
      node.innerHTML = `<div class="empty-state">Select a token to inspect it.</div>`;
      return;
    }
    const recentTrades = token.recent_trades || [];
    const recentEvents = token.recent_events || [];
    const topHolders = token.top_holders || [];
    const lpRows = token.liquidity_positions || [];
    const heldAmount = Number(token.wallet_amount || 0);
    node.innerHTML = `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token" style="padding-bottom:18px;">
          <div class="row wrap space" style="width:100%; gap:14px;">
            <div class="row" style="align-items:flex-start; gap:14px;">
              ${renderTokenAvatar(token)}
              <div class="col" style="gap:6px;">
                <div class="chip-row" style="gap:8px;">
                  <span class="chip">${iconSprite("grid")} ${escapeHtml(token.category || "market")}</span>
                  <span class="chip">${iconSprite("pulse")} ${escapeHtml(token.regime || "active")}</span>
                  ${heldAmount > 0 ? `<span class="chip positive">${formatDecimal(heldAmount, 4)} ${escapeHtml(token.symbol)} held</span>` : ""}
                </div>
                <strong style="font-size:1.15rem;">${escapeHtml(token.name || token.symbol)}</strong>
                <span class="muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.creator?.display_name || token.creator?.username || "market maker")}</span>
              </div>
            </div>
            <div class="row wrap" style="gap:10px; align-items:flex-start;">
              <div class="col" style="align-items:flex-end; gap:4px;">
                <span class="muted tiny">Spot price</span>
                <strong style="font-size:1.9rem; line-height:1;">${formatCC(token.price || 0, 4)}</strong>
                <span class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)} 24h</span>
              </div>
              <button class="watch-toggle ${this.watchlist.has(Number(token.id)) ? "active" : ""}" id="marketWatchBtn" type="button">${iconSprite("spark")} ${this.watchlist.has(Number(token.id)) ? "Watching" : "Watch"}</button>
            </div>
          </div>
        </div>

        <div class="market-chart-wrap">${priceVolumeChartSvg(token.chart || { points: [] }, { width: 460, height: 250 })}</div>

        <div class="detail-grid">
          <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
          <div><span class="muted">1h</span><strong class="${percentClass(token.change_1h)}">${formatSignedPct(token.change_1h || 0)}</strong></div>
          <div><span class="muted">24h</span><strong class="${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</strong></div>
          <div><span class="muted">Liquidity</span><strong>${formatCC(token.liquidity_value_cc || 0)}</strong></div>
          <div><span class="muted">Volume</span><strong>${formatCC(token.volume_cc || 0)}</strong></div>
          <div><span class="muted">Risk</span><strong>${escapeHtml(String(token.risk_profile || "-"))}</strong></div>
          <div><span class="muted">Creator</span><strong>${escapeHtml(String(token.creator?.display_name || token.creator?.username || "-"))}</strong></div>
          <div><span class="muted">Your spot</span><strong>${formatDecimal(heldAmount, 4)} ${escapeHtml(token.symbol)}</strong></div>
          <div><span class="muted">LP Share</span><strong>${formatDecimal(token.wallet_liquidity_share_pct || 0, 2)}%</strong></div>
        </div>

        ${token.risk_flags?.length ? `<div class="chip-row">${token.risk_flags.map((flag) => `<span class="chip chip-danger">${escapeHtml(flag)}</span>`).join("")}</div>` : ""}
        <p class="helper">${escapeHtml(token.description || "No token description available.")}</p>

        <div class="content-grid content-grid-market-detail">
          <div class="detail-section"><h4>Recent Trades</h4><div class="list">${recentTrades.length ? recentTrades.slice(0, 6).map((trade) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(trade.bot?.slug || trade.wallet?.name || trade.tx_kind || trade.side || "trade")}</strong><span>${tsToRelative(trade.created_at || trade.ts)}</span></div><div class="feed-body">${escapeHtml(trade.summary || "")}</div></div>`).join("") : `<div class="empty-state">No recent trades yet.</div>`}</div></div>
          <div class="detail-section"><h4>Recent Events</h4><div class="list">${recentEvents.length ? recentEvents.slice(0, 6).map((row) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(row.tx_kind || "event")}</strong><span>${tsToRelative(row.created_at || row.ts)}</span></div><div class="feed-body">${escapeHtml(row.summary || row.meta?.event_label || "")}</div></div>`).join("") : `<div class="empty-state">No event markers yet.</div>`}</div></div>
        </div>

        <div class="content-grid content-grid-market-detail">
          <div class="detail-section"><h4>Top Holders</h4><div class="list">${topHolders.length ? topHolders.slice(0, 5).map((holder) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(holder.wallet?.name || holder.wallet?.address || "Wallet")}</strong><span>${holder.wallet?.owner?.is_bot ? "bot" : "wallet"}</span></div><div class="feed-body">${formatDecimal(holder.amount || 0, 4)} ${escapeHtml(token.symbol)} | ${formatCC(holder.value_cc || 0)}</div></div>`).join("") : `<div class="empty-state">No holder data yet.</div>`}</div></div>
          <div class="detail-section"><h4>Pool Owners</h4><div class="list">${lpRows.length ? lpRows.slice(0, 5).map((row) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(row.wallet?.name || row.wallet?.address || "Wallet")}</strong><span>${row.wallet?.owner?.is_bot ? "bot" : "wallet"}</span></div><div class="feed-body">${formatDecimal(row.share_pct || 0, 2)}% of pool | ${formatCC(row.pool_value_cc || 0)}</div></div>`).join("") : `<div class="empty-state">No active LP positions.</div>`}</div></div>
        </div>
      </div>
    `;
    $("#marketWatchBtn", this.root)?.addEventListener("click", () => this.toggleWatch(Number(token.id)));
  }

  renderTrade() {
    const token = this.selectedToken;
    const panel = $("#marketTradePanel", this.root);
    const tabs = $("#marketSideTabs", this.root);
    tabs.innerHTML = `<button class="pill-tab ${this.side === "buy" ? "active" : ""}" data-market-side="buy" type="button">Buy</button><button class="pill-tab ${this.side === "sell" ? "active" : ""}" data-market-side="sell" type="button">Sell</button><button class="pill-tab ${this.side === "liquidity" ? "active" : ""}" data-market-side="liquidity" type="button">Liquidity</button>`;
    $$("[data-market-side]", tabs).forEach((button) => button.addEventListener("click", () => {
      this.side = button.dataset.marketSide;
      this.tradeFeedback = null;
      this.renderTrade();
    }));
    if (!token) {
      panel.innerHTML = `<div class="empty-state">Select a token to trade.</div>`;
      return;
    }
    if (this.side === "liquidity") {
      this.renderLiquidityPanel(panel, token);
      return;
    }
    const wallet = this.activeWallet;
    const amountOwned = Number(token.wallet_amount || 0);
    const amountInput = Number($("#marketTradeAmount", this.root)?.value || 0);
    const quote = this.side === "buy" ? this.quoteBuy(token, amountInput) : this.quoteSell(token, amountInput);
    const availableCC = this.walletCCBalance(wallet);
    const maxBase = this.side === "buy" ? this.maxBuyAmount(token) : amountOwned;
    const submitDisabled = !wallet || !quote.valid || !!this.pendingAction;
    const submitLabel = this.pendingAction
      ? "Routing order..."
      : this.side === "buy"
        ? `Buy ${escapeHtml(token.symbol)}`
        : `Sell ${escapeHtml(token.symbol)}`;
    panel.innerHTML = `
      <div class="content-grid content-grid-market-detail">
        <div class="stat-card">
          <span class="metric-label">Active wallet</span>
          <strong>${escapeHtml(wallet?.name || "No wallet selected")}</strong>
          <span class="muted">${formatCC(availableCC)} available | ${formatCompactNumber(wallet?.tokens?.length || 0)} assets</span>
        </div>
        <div class="stat-card">
          <span class="metric-label">Selected asset</span>
          <strong>${escapeHtml(token.name || token.symbol)}</strong>
          <span class="muted">${formatDecimal(amountOwned, 4)} ${escapeHtml(token.symbol)} held | ${formatCC(token.wallet_value_cc || 0)} value</span>
        </div>
      </div>
      <div class="detail-section" style="padding:16px;">
        <div class="row wrap space" style="gap:10px; margin-bottom:12px;">
          <div>
            <h4 style="margin:0;">Market order</h4>
            <div class="tiny muted">Token amount routed against live pool reserves.</div>
          </div>
          <div class="chip-row" style="gap:8px;">
            <span class="chip">${iconSprite("wallet")} ${escapeHtml(wallet?.name || "-")}</span>
            <span class="chip">${iconSprite("stack")} Max ${formatDecimal(maxBase, 4)} ${escapeHtml(token.symbol)}</span>
          </div>
        </div>
        <div class="amount-with-max">
          <label class="stretch">Amount<input id="marketTradeAmount" type="number" min="0.0001" step="0.0001" value="${amountInput || ""}"></label>
          <button id="marketTradeMaxBtn" class="btn ghost" type="button">Max</button>
        </div>
        <div class="row wrap" style="gap:8px; margin:12px 0 0;">
          <button class="btn ghost" data-trade-size="0.25" type="button">25%</button>
          <button class="btn ghost" data-trade-size="0.5" type="button">50%</button>
          <button class="btn ghost" data-trade-size="0.75" type="button">75%</button>
          <button class="btn ghost" data-trade-size="1" type="button">100%</button>
        </div>
      </div>
      <div class="stat-card" style="${quote.valid ? "border:1px solid rgba(67,196,148,0.18);" : "border:1px solid rgba(255,255,255,0.06);"}">
        <span class="metric-label">Preview</span>
        <strong>${quote.title}</strong>
        <span class="muted">${quote.detail}</span>
      </div>
      ${this.renderTradeFeedback()}
      <button id="marketTradeSubmitBtn" class="btn primary" type="button" ${submitDisabled ? "disabled" : ""}>${submitLabel}</button>
      <div class="detail-section"><h4>Market-wide activity</h4><div class="list">${(this.payload?.market_activity || []).slice(0, 6).map((row) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(row.bot?.slug || row.wallet?.name || row.tx_kind || "activity")}</strong><span>${tsToRelative(row.created_at || row.ts)}</span></div><div class="feed-body">${escapeHtml(row.summary || "")}</div></div>`).join("") || `<div class="empty-state">Activity feed will populate as trades and launches hit the market.</div>`}</div></div>
    `;
    $("#marketTradeAmount", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketTradeMaxBtn", this.root).addEventListener("click", () => this.setTradeMax(token));
    $$("[data-trade-size]", panel).forEach((button) => button.addEventListener("click", () => this.setTradePreset(token, Number(button.dataset.tradeSize || 0))));
    $("#marketTradeSubmitBtn", this.root).addEventListener("click", () => this.trade());
  }

  renderLiquidityPanel(panel, token) {
    const addAmount = Number($("#marketLiquidityAddAmount", this.root)?.value || 0);
    const removePct = Number($("#marketLiquidityRemovePct", this.root)?.value || 25);
    const addPreview = this.quoteLiquidityAdd(token, addAmount);
    const removePreview = this.quoteLiquidityRemove(token, removePct);
    const wallet = this.activeWallet;
    const isPending = !!this.pendingAction;
    panel.innerHTML = `
      <div class="content-grid content-grid-market-detail">
        <div class="stat-card"><span class="metric-label">Active wallet</span><strong>${escapeHtml(wallet?.name || "No wallet selected")}</strong><span class="muted">${formatCC(this.walletCCBalance(wallet))} CC available</span></div>
        <div class="stat-card"><span class="metric-label">Pool Position</span><strong>${formatDecimal(token.wallet_liquidity_share_pct || 0, 2)}% of ${escapeHtml(token.symbol)}</strong><span class="muted">Pool depth ${formatCC(token.liquidity_value_cc || 0)} | reserve ${formatCC(token.liquidity_cc || 0)}</span></div>
      </div>
      <div class="detail-section">
        <h4>Add liquidity</h4>
        <div class="amount-with-max"><label class="stretch">CC amount<input id="marketLiquidityAddAmount" type="number" min="1" step="1" value="${addAmount || ""}"></label><button id="marketLiquidityAddMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${addPreview.title}</strong><span class="muted">${addPreview.detail}</span></div>
        <button id="marketLiquidityAddBtn" class="btn secondary" type="button" ${isPending ? "disabled" : ""}>${this.pendingAction === "liquidity_add" ? "Routing..." : "Add liquidity"}</button>
      </div>
      <div class="detail-section">
        <h4>Remove liquidity</h4>
        <div class="amount-with-max"><label class="stretch">% of your LP<input id="marketLiquidityRemovePct" type="number" min="1" max="100" step="1" value="${removePct}"></label><button id="marketLiquidityRemoveMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${removePreview.title}</strong><span class="muted">${removePreview.detail}</span></div>
        <button id="marketLiquidityRemoveBtn" class="btn danger" type="button" ${(Number(token.wallet_liquidity_share_pct || 0) <= 0 || isPending) ? "disabled" : ""}>${this.pendingAction === "liquidity_remove" ? "Routing..." : "Remove liquidity"}</button>
      </div>
      ${this.renderTradeFeedback()}
    `;
    $("#marketLiquidityAddAmount", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketLiquidityRemovePct", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketLiquidityAddMaxBtn", this.root).addEventListener("click", () => this.setLiquidityAddMax());
    $("#marketLiquidityRemoveMaxBtn", this.root).addEventListener("click", () => { $("#marketLiquidityRemovePct", this.root).value = "100"; this.renderTrade(); });
    $("#marketLiquidityAddBtn", this.root).addEventListener("click", () => this.manageLiquidity("add"));
    $("#marketLiquidityRemoveBtn", this.root).addEventListener("click", () => this.manageLiquidity("remove"));
  }

  walletCCBalance(wallet = this.activeWallet) {
    return Number((wallet?.tokens || []).find((item) => item.symbol === "CC")?.amount || 0);
  }

  renderTradeFeedback() {
    if (!this.tradeFeedback) return "";
    const border = this.tradeFeedback.tone === "success" ? "rgba(67,196,148,0.24)" : "rgba(255,122,122,0.24)";
    const label = this.tradeFeedback.tone === "success" ? "Terminal status" : "Action blocked";
    return `
      <div class="stat-card" style="border:1px solid ${border};">
        <span class="metric-label">${label}</span>
        <strong>${escapeHtml(this.tradeFeedback.title || "")}</strong>
        <span class="muted">${escapeHtml(this.tradeFeedback.detail || "")}</span>
      </div>
    `;
  }

  quoteBuy(token, amount) {
    const n = Math.max(0, Number(amount || 0));
    const wallet = this.activeWallet;
    const walletCC = this.walletCCBalance(wallet);
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    if (!wallet) return { valid: false, title: "Select a wallet", detail: "Orders need an active wallet to settle." };
    if (walletCC <= 0.000001) return { valid: false, title: "No CC available", detail: `${escapeHtml(wallet.name)} has no CC ready. Switch wallets or earn more CC first.` };
    if (!n) return { valid: false, title: "Enter a buy size", detail: `Wallet ${escapeHtml(wallet.name)} | max ${formatDecimal(this.maxBuyAmount(token), 4)} ${escapeHtml(token.symbol)}` };
    if (n >= y * 0.82) return { valid: false, title: "Order too large", detail: "This buy would drain too much of the pool." };
    const effectiveIn = ((x * y) / (y - n)) - x;
    const total = effectiveIn / Math.max(0.000001, 1 - fee);
    const avg = total / n;
    const slip = ((avg / Math.max(Number(token.price || 0.0001), 0.0001)) - 1) * 100;
    if (total > walletCC + 1e-9) {
      return {
        valid: false,
        title: "Insufficient CC",
        detail: `Need ${formatCC(total, 4)} but ${escapeHtml(wallet.name)} only has ${formatCC(walletCC, 4)} available.`,
      };
    }
    return {
      valid: true,
      title: `Cost ${formatCC(total, 4)}`,
      detail: `Avg ${formatCC(avg, 4)} | fee ${formatCC(total - effectiveIn, 4)} | slip ${formatDecimal(slip, 2)}%`,
      total,
      average: avg,
      slippage: slip,
    };
  }

  quoteSell(token, amount) {
    const n = Math.max(0, Number(amount || 0));
    const wallet = this.activeWallet;
    const heldAmount = Number(token.wallet_amount || 0);
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    if (!wallet) return { valid: false, title: "Select a wallet", detail: "Orders need an active wallet to settle." };
    if (heldAmount <= 0.000001) return { valid: false, title: "No position to sell", detail: `${escapeHtml(wallet.name)} does not currently hold ${escapeHtml(token.symbol)}.` };
    if (!n) return { valid: false, title: "Enter a sell size", detail: `Held ${formatDecimal(heldAmount, 4)} ${escapeHtml(token.symbol)}` };
    if (n > heldAmount + 1e-9) return { valid: false, title: "Insufficient token balance", detail: `Held ${formatDecimal(heldAmount, 4)} ${escapeHtml(token.symbol)} in ${escapeHtml(wallet.name)}.` };
    const effective = n * Math.max(0.000001, 1 - fee);
    const proceeds = x - ((x * y) / (y + effective));
    const avg = proceeds / n;
    const slip = (1 - (avg / Math.max(Number(token.price || 0.0001), 0.0001))) * 100;
    return {
      valid: true,
      title: `Receive ${formatCC(proceeds, 4)}`,
      detail: `Avg ${formatCC(avg, 4)} | fee ${formatCC((n - effective) * Number(token.price || 0), 4)} | slip ${formatDecimal(slip, 2)}%`,
      proceeds,
      average: avg,
      slippage: slip,
    };
  }

  quoteLiquidityAdd(token, ccAmount) {
    const n = Math.max(0, Number(ccAmount || 0));
    if (!n) return { title: "Enter a CC amount", detail: "The panel will estimate matching token inventory and new LP depth." };
    const tokenNeeded = Number(token.liquidity_tokens || 0) * (n / Math.max(Number(token.liquidity_cc || 0), 0.000001));
    return { title: `${formatCC(n, 2)} + ${formatDecimal(tokenNeeded, 4)} ${escapeHtml(token.symbol)}`, detail: `Requires wallet spot balance in both legs. LP share will increase after deposit.` };
  }

  quoteLiquidityRemove(token, removePct) {
    const pct = Math.max(0, Math.min(100, Number(removePct || 0)));
    const ownedPoolFraction = (Number(token.wallet_liquidity_share_pct || 0) / 100) * (pct / 100);
    const ccOut = Number(token.liquidity_cc || 0) * ownedPoolFraction;
    const tokenOut = Number(token.liquidity_tokens || 0) * ownedPoolFraction;
    return { title: `${formatCC(ccOut, 2)} + ${formatDecimal(tokenOut, 4)} ${escapeHtml(token.symbol)}`, detail: `Withdrawing ${formatDecimal(pct, 0)}% of your LP will make the pool thinner and future moves rougher.` };
  }

  maxBuyAmount(token) {
    const walletCC = this.walletCCBalance();
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    return Math.max(0, (y - ((x * y) / (x + (walletCC * Math.max(0.000001, 1 - fee))))) * 0.985);
  }

  setTradeMax(token) {
    $("#marketTradeAmount", this.root).value = String(this.side === "buy" ? this.maxBuyAmount(token) : Number(token.wallet_amount || 0));
    this.renderTrade();
  }

  setTradePreset(token, fraction) {
    const base = this.side === "buy" ? this.maxBuyAmount(token) : Number(token.wallet_amount || 0);
    const nextValue = Math.max(0, base * Math.max(0, Math.min(1, Number(fraction || 0))));
    $("#marketTradeAmount", this.root).value = nextValue > 0 ? String(Number(nextValue.toFixed(6))) : "";
    this.renderTrade();
  }

  setLiquidityAddMax() {
    const cc = this.walletCCBalance();
    $("#marketLiquidityAddAmount", this.root).value = String(Math.max(0, Math.floor(cc)));
    this.renderTrade();
  }

  toggleWatch(tokenId) {
    if (this.watchlist.has(tokenId)) this.watchlist.delete(tokenId); else this.watchlist.add(tokenId);
    storageSet(WATCHLIST_KEY, [...this.watchlist]);
    this.render();
  }

  tradeErrorFeedback(error) {
    const code = String(error?.payload?.error || error?.message || "trade_failed");
    const title = TRADE_ERROR_LABELS[code] || "The order could not be filled.";
    const detail = code === "insufficient_cc_balance"
      ? "Reduce the order size or switch to a wallet with more CC."
      : code === "insufficient_token_balance"
        ? "Lower the sell size or change to the wallet holding that token."
        : code === "trade_size_too_large"
          ? "Split the order into a smaller size so it fits the current liquidity."
          : "Refresh the market and try again.";
    return { tone: "error", title, detail };
  }

  async trade() {
    const token = this.selectedToken;
    if (!token || !this.walletId) return;
    const amount = Number($("#marketTradeAmount", this.root)?.value || 0);
    const quote = this.side === "buy" ? this.quoteBuy(token, amount) : this.quoteSell(token, amount);
    if (!quote.valid) {
      this.tradeFeedback = { tone: "error", title: quote.title, detail: quote.detail };
      this.ctx.notify.toast(quote.title, { tone: "error" });
      this.renderTrade();
      return;
    }
    this.pendingAction = this.side;
    this.tradeFeedback = null;
    this.renderTrade();
    try {
      const result = await api("/api/trade", {
        method: "POST",
        json: { wallet_id: this.walletId, token_id: token.id, side: this.side, amount },
      });
      await this.load({ silent: true });
      const filled = result?.trade || {};
      const tokenAfter = this.selectedToken;
      const walletAfter = this.activeWallet;
      const title = this.side === "buy"
        ? `Bought ${formatDecimal(filled.amount || amount, 4)} ${token.symbol}`
        : `Sold ${formatDecimal(filled.amount || amount, 4)} ${token.symbol}`;
      const detail = this.side === "buy"
        ? `${formatCC(Math.abs(Number(filled.delta_cc || 0)), 4)} routed from ${walletAfter?.name || "the active wallet"} | now holding ${formatDecimal(tokenAfter?.wallet_amount || 0, 4)} ${token.symbol}.`
        : `${formatCC(Math.abs(Number(filled.delta_cc || 0)), 4)} returned to ${walletAfter?.name || "the active wallet"} | ${formatDecimal(tokenAfter?.wallet_amount || 0, 4)} ${token.symbol} remaining.`;
      this.tradeFeedback = { tone: "success", title, detail };
      this.ctx.notify.toast(title, { tone: "success" });
    } catch (error) {
      this.tradeFeedback = this.tradeErrorFeedback(error);
      this.ctx.notify.toast(this.tradeFeedback.title, { tone: "error" });
    } finally {
      this.pendingAction = "";
      this.renderTrade();
    }
  }

  async manageLiquidity(action) {
    const token = this.selectedToken;
    if (!token || !this.walletId) return;
    this.pendingAction = `liquidity_${action}`;
    this.tradeFeedback = null;
    this.renderTrade();
    try {
      await api("/api/liquidity", { method: "POST", json: {
        wallet_id: this.walletId,
        token_id: token.id,
        action,
        cc_amount: Number($("#marketLiquidityAddAmount", this.root)?.value || 0),
        share_pct: Number($("#marketLiquidityRemovePct", this.root)?.value || 0),
      } });
      await this.load({ silent: true });
      const title = action === "add" ? `Added ${token.symbol} liquidity` : `Removed ${token.symbol} liquidity`;
      const detail = action === "add"
        ? `Pool share is now ${formatDecimal(this.selectedToken?.wallet_liquidity_share_pct || 0, 2)}% for ${this.activeWallet?.name || "the active wallet"}.`
        : `Pool share is now ${formatDecimal(this.selectedToken?.wallet_liquidity_share_pct || 0, 2)}% for ${this.activeWallet?.name || "the active wallet"}.`;
      this.tradeFeedback = { tone: "success", title, detail };
      this.ctx.notify.toast(title, { tone: "success" });
    } catch (error) {
      const title = action === "add" ? "Liquidity add failed." : "Liquidity removal failed.";
      this.tradeFeedback = { tone: "error", title, detail: String(error?.payload?.error || error?.message || "Refresh the market and try again.") };
      this.ctx.notify.toast(title, { tone: "error" });
    } finally {
      this.pendingAction = "";
      this.renderTrade();
    }
  }

  onEvent(msg) {
    if (msg.type === "market_cycle" && this.ctx.isScreenActive(this)) this.load({ silent: true }).catch(() => {});
  }
}
