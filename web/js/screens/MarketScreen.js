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
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel market-screen" });
    this.root.innerHTML = `
      <div class="hero-card market-hero">
        <div class="hero-copy">
          <span class="eyebrow">Market</span>
          <h2 class="screen-title">Cortisol Exchange terminal</h2>
          <p class="helper">Screen the sim, inspect real price and volume history, execute buys and sells, and manage pool exposure from the active wallet.</p>
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
          <div class="card-header"><div><h3 class="section-title">Token Screener</h3><p class="helper">Trending, new, gainers, losers, chaos, and your watchlist.</p></div></div>
          <div class="card-body"><div id="marketTokenList" class="list token-list market-token-list"></div></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div><h3 class="section-title">Token Detail</h3><p class="helper">Chart, risk, liquidity, holders, and linked explorer context.</p></div>
            <div class="row wrap"><button id="marketOpenExplorerBtn" class="btn ghost" type="button">Open explorer</button></div>
          </div>
          <div class="card-body"><div id="marketTokenDetail"></div></div>
        </div>

        <div class="card trade-card">
          <div class="card-header"><div><h3 class="section-title">Execution</h3><p class="helper">Trade and liquidity controls pinned to the active wallet.</p></div></div>
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
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Trading and discovery");
    this.side = route?.params?.side === "sell" ? "sell" : "buy";
    this.selectedTokenId = Number(route?.params?.token || 0) || this.selectedTokenId;
    await this.load();
    this.timer = setInterval(() => this.load({ silent: true }), 6000);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get tokens() { return this.payload?.tokens || []; }
  get selectedToken() { return this.payload?.selected_token || this.tokens.find((token) => Number(token.id) === Number(this.selectedTokenId)) || this.tokens[0] || null; }
  get activeWallet() { return this.wallets.find((item) => Number(item.id) === Number(this.walletId)) || this.wallets[0] || null; }

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
      if (this.selectedTokenId) query.set("token", String(this.selectedTokenId));
      if (this.sort) query.set("sort", this.sort);
      this.payload = await api(`/api/market?${query.toString()}`);
      if (!this.selectedTokenId) this.selectedTokenId = this.payload?.selected_token?.id || this.tokens[0]?.id || null;
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
    return this.tokens.filter((token) => {
      if (this.ownedOnly && Number(token.wallet_amount || 0) <= 0) return false;
      if (this.category && String(token.category || "").toLowerCase() !== this.category.toLowerCase()) return false;
      if (this.watchOnly && !this.watchlist.has(Number(token.id))) return false;
      if (!q) return true;
      const creator = `${token.creator?.display_name || ""} ${token.creator?.username || ""}`.toLowerCase();
      const haystack = `${token.name || ""}\n${token.symbol || ""}\n${token.category || ""}\n${token.regime || ""}\n${token.description || ""}\n${creator}`.toLowerCase();
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
      <div class="market-row-wrap ${Number(token.id) === Number(this.selectedToken?.id) ? "active" : ""}">
        <button class="token-row" data-market-token="${token.id}" type="button">
          <div class="token-row-main">
            ${renderTokenAvatar(token)}
            <div class="stretch">
              <div class="row space"><strong>${escapeHtml(token.name || token.symbol)}</strong><span class="chip">${formatCC(token.price || 0, 4)}</span></div>
              <div class="tiny muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category || token.regime || "market")}</div>
              <div class="token-meta-line">
                <span>Vol ${formatCC(token.volume_cc || 0)}</span>
                <span>Liq ${formatCC(token.liquidity_value_cc || 0)}</span>
                <span>Risk ${formatDecimal(token.risk_score || 0, 0)}</span>
              </div>
            </div>
          </div>
          <div class="token-row-side">
            <div class="trend-chip ${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</div>
            <div class="mini-chart">${sparklineSvg(token.history || [], { width: 126, height: 36 })}</div>
          </div>
        </button>
        <button class="watch-toggle ${this.watchlist.has(Number(token.id)) ? "active" : ""}" data-toggle-watch="${token.id}" type="button">WL</button>
      </div>
    `).join("");
    $$("[data-market-token]", list).forEach((button) => button.addEventListener("click", () => {
      this.selectedTokenId = Number(button.dataset.marketToken);
      this.ctx.navigate("market", { token: this.selectedTokenId, side: this.side });
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
    node.innerHTML = `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token">
          <div class="row">${renderTokenAvatar(token)}<div class="col" style="gap:4px;"><strong>${escapeHtml(token.name || token.symbol)}</strong><span class="muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.regime || token.category || "token")}</span></div></div>
          <button class="watch-toggle ${this.watchlist.has(Number(token.id)) ? "active" : ""}" id="marketWatchBtn" type="button">WL</button>
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
    panel.innerHTML = `
      <div class="stat-card"><span class="metric-label">Selected asset</span><strong>${escapeHtml(token.name || token.symbol)}</strong><span class="muted">${escapeHtml(token.symbol)} | held ${formatDecimal(amountOwned, token.symbol === "CC" ? 2 : 4)}</span></div>
      <div class="amount-with-max"><label class="stretch">Amount<input id="marketTradeAmount" type="number" min="0.0001" step="0.0001" value="${amountInput || ""}"></label><button id="marketTradeMaxBtn" class="btn ghost" type="button">Max</button></div>
      <div class="stat-card"><span class="metric-label">Preview</span><strong>${quote.title}</strong><span class="muted">${quote.detail}</span></div>
      <button id="marketTradeSubmitBtn" class="btn primary" type="button">${this.side === "buy" ? "Buy asset" : "Sell asset"}</button>
      <div class="detail-section"><h4>Market-wide activity</h4><div class="list">${(this.payload?.market_activity || []).slice(0, 6).map((row) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(row.bot?.slug || row.wallet?.name || row.tx_kind || "activity")}</strong><span>${tsToRelative(row.created_at || row.ts)}</span></div><div class="feed-body">${escapeHtml(row.summary || "")}</div></div>`).join("") || `<div class="empty-state">Activity feed will populate as trades and launches hit the market.</div>`}</div></div>
    `;
    $("#marketTradeAmount", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketTradeMaxBtn", this.root).addEventListener("click", () => this.setTradeMax(token));
    $("#marketTradeSubmitBtn", this.root).addEventListener("click", () => this.trade());
  }

  renderLiquidityPanel(panel, token) {
    const addAmount = Number($("#marketLiquidityAddAmount", this.root)?.value || 0);
    const removePct = Number($("#marketLiquidityRemovePct", this.root)?.value || 25);
    const addPreview = this.quoteLiquidityAdd(token, addAmount);
    const removePreview = this.quoteLiquidityRemove(token, removePct);
    panel.innerHTML = `
      <div class="stat-card"><span class="metric-label">Pool Position</span><strong>${formatDecimal(token.wallet_liquidity_share_pct || 0, 2)}% of ${escapeHtml(token.symbol)}</strong><span class="muted">Pool depth ${formatCC(token.liquidity_value_cc || 0)} | reserve ${formatCC(token.liquidity_cc || 0)}</span></div>
      <div class="detail-section">
        <h4>Add liquidity</h4>
        <div class="amount-with-max"><label class="stretch">CC amount<input id="marketLiquidityAddAmount" type="number" min="1" step="1" value="${addAmount || ""}"></label><button id="marketLiquidityAddMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${addPreview.title}</strong><span class="muted">${addPreview.detail}</span></div>
        <button id="marketLiquidityAddBtn" class="btn secondary" type="button">Add liquidity</button>
      </div>
      <div class="detail-section">
        <h4>Remove liquidity</h4>
        <div class="amount-with-max"><label class="stretch">% of your LP<input id="marketLiquidityRemovePct" type="number" min="1" max="100" step="1" value="${removePct}"></label><button id="marketLiquidityRemoveMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${removePreview.title}</strong><span class="muted">${removePreview.detail}</span></div>
        <button id="marketLiquidityRemoveBtn" class="btn danger" type="button" ${Number(token.wallet_liquidity_share_pct || 0) <= 0 ? "disabled" : ""}>Remove liquidity</button>
      </div>
    `;
    $("#marketLiquidityAddAmount", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketLiquidityRemovePct", this.root).addEventListener("input", () => this.renderTrade());
    $("#marketLiquidityAddMaxBtn", this.root).addEventListener("click", () => this.setLiquidityAddMax());
    $("#marketLiquidityRemoveMaxBtn", this.root).addEventListener("click", () => { $("#marketLiquidityRemovePct", this.root).value = "100"; this.renderTrade(); });
    $("#marketLiquidityAddBtn", this.root).addEventListener("click", () => this.manageLiquidity("add"));
    $("#marketLiquidityRemoveBtn", this.root).addEventListener("click", () => this.manageLiquidity("remove"));
  }

  quoteBuy(token, amount) {
    const n = Math.max(0, Number(amount || 0));
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    if (!n) return { title: "Enter a buy size", detail: `Wallet ${escapeHtml(this.activeWallet?.name || "-")} | max ${formatDecimal(this.maxBuyAmount(token), 4)} ${escapeHtml(token.symbol)}` };
    if (n >= y * 0.82) return { title: "Order too large", detail: "This buy would drain too much of the pool." };
    const effectiveIn = ((x * y) / (y - n)) - x;
    const total = effectiveIn / Math.max(0.000001, 1 - fee);
    const avg = total / n;
    const slip = ((avg / Math.max(Number(token.price || 0.0001), 0.0001)) - 1) * 100;
    return { title: `Cost ${formatCC(total, 4)}`, detail: `Avg ${formatCC(avg, 4)} | fee ${formatCC(total - effectiveIn, 4)} | slip ${formatDecimal(slip, 2)}%` };
  }

  quoteSell(token, amount) {
    const n = Math.max(0, Number(amount || 0));
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    if (!n) return { title: "Enter a sell size", detail: `Held ${formatDecimal(token.wallet_amount || 0, 4)} ${escapeHtml(token.symbol)}` };
    const effective = n * Math.max(0.000001, 1 - fee);
    const proceeds = x - ((x * y) / (y + effective));
    const avg = proceeds / n;
    const slip = (1 - (avg / Math.max(Number(token.price || 0.0001), 0.0001))) * 100;
    return { title: `Receive ${formatCC(proceeds, 4)}`, detail: `Avg ${formatCC(avg, 4)} | fee ${formatCC((n - effective) * Number(token.price || 0), 4)} | slip ${formatDecimal(slip, 2)}%` };
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
    const walletCC = Number((this.activeWallet?.tokens || []).find((item) => item.symbol === "CC")?.amount || 0);
    const fee = Number(token.trade_preview?.fee_rate || 0.0125);
    const x = Number(token.liquidity_cc || 0);
    const y = Number(token.liquidity_tokens || 0);
    return Math.max(0, (y - ((x * y) / (x + (walletCC * Math.max(0.000001, 1 - fee))))) * 0.985);
  }

  setTradeMax(token) {
    $("#marketTradeAmount", this.root).value = String(this.side === "buy" ? this.maxBuyAmount(token) : Number(token.wallet_amount || 0));
    this.renderTrade();
  }

  setLiquidityAddMax() {
    const cc = Number((this.activeWallet?.tokens || []).find((item) => item.symbol === "CC")?.amount || 0);
    $("#marketLiquidityAddAmount", this.root).value = String(Math.max(0, Math.floor(cc)));
    this.renderTrade();
  }

  toggleWatch(tokenId) {
    if (this.watchlist.has(tokenId)) this.watchlist.delete(tokenId); else this.watchlist.add(tokenId);
    storageSet(WATCHLIST_KEY, [...this.watchlist]);
    this.render();
  }

  async trade() {
    const token = this.selectedToken;
    if (!token || !this.walletId) return;
    await api("/api/trade", { method: "POST", json: { wallet_id: this.walletId, token_id: token.id, side: this.side, amount: Number($("#marketTradeAmount", this.root).value || 0) } });
    this.ctx.notify.toast("Trade executed", { tone: "success" });
    this.wallets = [];
    await this.load();
  }

  async manageLiquidity(action) {
    const token = this.selectedToken;
    if (!token || !this.walletId) return;
    await api("/api/liquidity", { method: "POST", json: {
      wallet_id: this.walletId,
      token_id: token.id,
      action,
      cc_amount: Number($("#marketLiquidityAddAmount", this.root)?.value || 0),
      share_pct: Number($("#marketLiquidityRemovePct", this.root)?.value || 0),
    } });
    this.ctx.notify.toast(action === "add" ? "Liquidity added" : "Liquidity removed", { tone: "success" });
    this.wallets = [];
    await this.load();
  }

  onEvent(msg) {
    if (msg.type === "market_cycle" && this.ctx.isScreenActive(this)) this.load({ silent: true }).catch(() => {});
  }
}
