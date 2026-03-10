import { api } from "../net.js";
import {
  $,
  $$,
  createEl,
  debounce,
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

const MARKET_VIEWS = [
  { id: "trending", label: "Trending", sort: "market_cap_desc" },
  { id: "new", label: "New", sort: "newest" },
  { id: "gainers", label: "Gainers", sort: "change_desc" },
  { id: "losers", label: "Losers", sort: "change_asc" },
  { id: "chaos", label: "Chaos", sort: "volume_desc" },
];

export class MarketScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "market";
    this.title = "Market";
    this.root = null;
    this.payload = null;
    this.wallets = [];
    this.walletId = null;
    this.selectedTokenId = null;
    this.side = "buy";
    this.view = "trending";
    this.query = "";
    this.loading = false;
    this.timer = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel market-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Market</h2>
          <p>Search, screen, and open token detail from a wallet-first trading workspace.</p>
        </div>
        <div class="page-actions">
          <label class="inline-select">
            <span>Execution wallet</span>
            <select id="marketWalletSelect"></select>
          </label>
          <button id="marketCreateTokenBtn" class="btn secondary" type="button">Create token</button>
          <button id="marketRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Tracked tokens</span>
          <strong id="marketTokenCount" class="stat-value">0</strong>
          <span class="stat-note">Visible in the current screener view</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Owned positions</span>
          <strong id="marketOwnedCount" class="stat-value">0</strong>
          <span class="stat-note">Holdings in the selected wallet</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Market cap</span>
          <strong id="marketCapValue" class="stat-value">0 CC</strong>
          <span class="stat-note">Combined simulated valuation</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Volume</span>
          <strong id="marketVolumeValue" class="stat-value">0 CC</strong>
          <span class="stat-note">Screen-wide trade volume</span>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Screener</h3>
            <p class="helper">Search token names, symbols, categories, or route directly into detail and trade.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <div class="toolbar">
            <input id="marketSearch" class="market-search stretch" placeholder="Search token, symbol, or category">
            <div id="marketViewTabs" class="tabs"></div>
          </div>
          <div class="section-grid two">
            <div id="marketTokenList" class="list-stack market-list"></div>
            <div id="marketDetailPane" class="stack"></div>
          </div>
        </div>
      </section>
    `;

    $("#marketRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#marketWalletSelect", this.root).addEventListener("change", (event) => {
      this.walletId = Number(event.target.value || 0) || null;
      this.load();
    });
    $("#marketSearch", this.root).addEventListener("input", debounce((event) => {
      this.query = (event.target.value || "").trim();
      this.load({ silent: true });
    }, 150));
    $("#marketCreateTokenBtn", this.root).addEventListener("click", () => {
      this.ctx.navigate("create-token", { wallet: this.walletId || "" });
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Screener and execution");
    this.side = route?.params?.side === "sell" ? "sell" : "buy";
    this.selectedTokenId = Number(route?.params?.token || 0) || this.selectedTokenId;
    this.query = route?.params?.q || this.query || "";
    this.ctx.setGlobalSearchValue(this.query);
    $("#marketSearch", this.root).value = this.query;
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
    this.loading = true;
    if (!silent && !this.payload) this.render();
    try {
      if (!this.wallets.length) {
        const walletsRes = await api("/api/wallets");
        this.wallets = walletsRes.wallets || [];
        if (!this.walletId) this.walletId = walletsRes.default_wallet_id || this.wallets[0]?.id || null;
      }
      const query = new URLSearchParams();
      if (this.walletId) query.set("wallet_id", String(this.walletId));
      if (this.selectedTokenId) query.set("token", String(this.selectedTokenId));
      if (this.query) query.set("search", this.query);
      query.set("sort", this.sortForView());
      this.payload = await api(`/api/market?${query.toString()}`);
      if (!this.selectedTokenId) {
        this.selectedTokenId = this.payload?.selected_token?.id || this.tokens[0]?.id || null;
      }
    } catch (error) {
      this.ctx.notify.toast(`Market load failed: ${error.message}`, { tone: "error" });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  sortForView() {
    return MARKET_VIEWS.find((view) => view.id === this.view)?.sort || "market_cap_desc";
  }

  filteredTokens() {
    const rows = [...this.tokens];
    if (this.view === "chaos") {
      const chaosRows = rows
        .filter((token) => ["chaos", "high"].includes(String(token.volatility_profile || "").toLowerCase()) || Math.abs(Number(token.change_pct || 0)) >= 8)
        .sort((a, b) => Math.abs(Number(b.change_pct || 0)) - Math.abs(Number(a.change_pct || 0)));
      return chaosRows.length ? chaosRows : rows;
    }
    return rows;
  }

  render() {
    this.renderWallets();
    this.renderSummary();
    this.renderViewTabs();
    this.renderList();
    this.renderDetail();
    this.renderInspector();
  }

  renderWallets() {
    const select = $("#marketWalletSelect", this.root);
    if (!this.wallets.length) {
      select.innerHTML = `<option value="">No wallets</option>`;
      return;
    }
    select.innerHTML = this.wallets.map((wallet) => `
      <option value="${wallet.id}" ${Number(wallet.id) === Number(this.walletId) ? "selected" : ""}>${escapeHtml(wallet.name)}</option>
    `).join("");
  }

  renderSummary() {
    const summary = this.payload?.summary || {};
    $("#marketTokenCount", this.root).textContent = formatCompactNumber(summary.token_count || 0, 0);
    $("#marketOwnedCount", this.root).textContent = formatCompactNumber(summary.owned_token_count || 0, 0);
    $("#marketCapValue", this.root).textContent = formatCC(summary.market_cap_cc || 0);
    $("#marketVolumeValue", this.root).textContent = formatCC(summary.volume_cc || 0);
  }

  renderViewTabs() {
    const node = $("#marketViewTabs", this.root);
    node.innerHTML = MARKET_VIEWS.map((view) => `
      <button class="tab-btn ${view.id === this.view ? "active" : ""}" data-market-view="${view.id}" type="button">${view.label}</button>
    `).join("");
    $$("[data-market-view]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.view = button.dataset.marketView;
        this.load({ silent: true });
      });
    });
  }

  renderList() {
    const node = $("#marketTokenList", this.root);
    const rows = this.filteredTokens();
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No tokens found</strong><span>Try another search term or switch to a different screener view.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((token) => `
      <button class="token-row ${Number(token.id || token.token_id) === Number(this.selectedToken?.id || this.selectedToken?.token_id) ? "active" : ""}" data-market-token="${token.id || token.token_id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.price || 0, 4)}</span>
            </div>
            <div class="token-meta-line">
              <span>${escapeHtml(token.symbol)}</span>
              <span>${escapeHtml(token.category || "token")}</span>
              <span>Vol ${formatCC(token.volume_cc || 0)}</span>
              <span>Held ${formatDecimal(token.wallet_amount || 0, token.symbol === "CC" ? 2 : 4)}</span>
            </div>
          </div>
        </div>
        <div class="row-trailing">
          <span class="trend-chip ${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</span>
        </div>
      </button>
    `).join("");
    $$("[data-market-token]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedTokenId = Number(button.dataset.marketToken);
        this.ctx.navigate("market", {
          token: this.selectedTokenId,
          side: this.side,
          q: this.query || "",
        });
      });
    });
  }

  renderDetail() {
    const token = this.selectedToken;
    const node = $("#marketDetailPane", this.root);
    if (this.loading && !token) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!token) {
      node.innerHTML = `<div class="empty-state"><strong>No token selected</strong><span>Select a token from the screener to open its detail view.</span></div>`;
      return;
    }
    const recentTrades = token.recent_trades || [];
    const topHolders = token.top_holders || [];
    node.innerHTML = `
      <div class="panel inset">
        <div class="panel-body stack">
          <div class="row space">
            <div class="row">
              ${renderTokenAvatar(token)}
              <div class="stack" style="gap:4px;">
                <strong>${escapeHtml(token.name || token.symbol)}</strong>
                <span class="small muted">${escapeHtml(token.symbol)} · ${escapeHtml(token.category || "token")}</span>
              </div>
            </div>
            <span class="trend-chip ${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</span>
          </div>
          <div class="detail-grid">
            <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
            <div><span class="muted">Market cap</span><strong>${formatCC(token.market_cap_cc || 0)}</strong></div>
            <div><span class="muted">Volume</span><strong>${formatCC(token.volume_cc || 0)}</strong></div>
            <div><span class="muted">Supply</span><strong>${formatCompactNumber(token.circulating_supply || 0)}</strong></div>
            <div><span class="muted">Holders</span><strong>${formatCompactNumber(token.holder_count || 0, 0)}</strong></div>
            <div><span class="muted">Volatility</span><strong>${escapeHtml(token.volatility_profile || "-")}</strong></div>
          </div>
          <div class="helper">${escapeHtml(token.description || "No token description has been set for this asset.")}</div>
          <div class="row">
            <button id="marketOpenExplorerBtn" class="btn secondary" type="button">Open in Explorer</button>
            <button id="marketOpenWalletBtn" class="btn secondary" type="button">Open wallet holdings</button>
          </div>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Recent trades</h3>
              <p class="helper">Most recent token-side execution history.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="list-stack">
              ${recentTrades.length ? recentTrades.slice(0, 6).map((trade) => `
                <div class="list-item compact">
                  <div class="feed-meta">
                    <strong>${escapeHtml(trade.tx_kind || trade.kind || trade.side || "trade")}</strong>
                    <span>${tsToRelative(trade.created_at || trade.ts)}</span>
                  </div>
                  <div class="feed-body">${escapeHtml(trade.user?.display_name || trade.user?.username || "Unknown")} · ${formatDecimal(trade.amount || 0, 4)}</div>
                </div>
              `).join("") : `<div class="empty-state"><strong>No trades yet</strong><span>This token has not recorded any recent trades.</span></div>`}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Top holders</h3>
              <p class="helper">Largest balances currently visible on the simulated ledger.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="list-stack">
              ${topHolders.length ? topHolders.slice(0, 6).map((holder) => `
                <button class="list-item compact" data-market-holder="${escapeHtml(String(holder.wallet?.id || ""))}" type="button">
                  <div class="feed-meta">
                    <strong>${escapeHtml(holder.wallet?.name || holder.wallet?.address || "Wallet")}</strong>
                    <span>${formatCC(holder.value_cc || 0)}</span>
                  </div>
                  <div class="feed-body">${formatDecimal(holder.amount || 0, 4)} ${escapeHtml(token.symbol || "")}</div>
                </button>
              `).join("") : `<div class="empty-state"><strong>No holders listed</strong><span>Holder detail is not available for this asset yet.</span></div>`}
            </div>
          </div>
        </section>
      </div>
    `;

    $("#marketOpenExplorerBtn", node)?.addEventListener("click", () => {
      this.ctx.navigate("explorer", { view: "tokens", token: token.id || token.token_id });
    });
    $("#marketOpenWalletBtn", node)?.addEventListener("click", () => {
      this.ctx.navigate("wallets", { wallet: this.walletId || "" });
    });
    $$("[data-market-holder]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.ctx.navigate("explorer", { view: "wallets", wallet: button.dataset.marketHolder });
      });
    });
  }

  renderInspector() {
    const token = this.selectedToken;
    if (!token) {
      this.ctx.clearInspector();
      return;
    }
    const amountInput = Number($("#marketTradeAmount", document.getElementById("inspectorContent"))?.value || 1);
    const gross = amountInput * Number(token.price || 0);
    const feeRate = Number(token.fee_rate || 0.01);
    const total = this.side === "buy" ? gross * (1 + feeRate) : gross * (1 - feeRate);
    this.ctx.setInspector({
      title: `${this.side === "buy" ? "Buy" : "Sell"} ${token.symbol}`,
      subtitle: `Wallet ${escapeHtml(this.wallets.find((wallet) => Number(wallet.id) === Number(this.walletId))?.name || "-")}`,
      content: `
        <div class="inspector-card">
          <div class="tabs">
            <button id="marketBuyTab" class="tab-btn ${this.side === "buy" ? "active" : ""}" type="button">Buy</button>
            <button id="marketSellTab" class="tab-btn ${this.side === "sell" ? "active" : ""}" type="button">Sell</button>
          </div>
          <label>Amount
            <input id="marketTradeAmount" type="number" min="0.0001" step="0.0001" value="${amountInput}">
          </label>
          <div class="detail-card">
            <div class="detail-row"><span class="muted">${this.side === "buy" ? "Estimated cost" : "Estimated proceeds"}</span><strong>${formatCC(total, 4)}</strong></div>
            <div class="helper">Base ${formatCC(gross, 4)} · fee ${(feeRate * 100).toFixed(2)}% · held ${formatDecimal(token.wallet_amount || 0, token.symbol === "CC" ? 2 : 4)}</div>
          </div>
          <button id="marketTradeSubmitBtn" class="btn primary" type="button">${this.side === "buy" ? "Buy token" : "Sell token"}</button>
        </div>
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Created</span><strong>${tsToLocal(token.created_at)}</strong></div>
          <div class="detail-row"><span class="muted">Creator</span><strong>${escapeHtml(token.creator?.display_name || token.creator?.username || "-")}</strong></div>
          <div class="detail-row"><span class="muted">Held in wallet</span><strong>${formatDecimal(token.wallet_amount || 0, token.symbol === "CC" ? 2 : 4)}</strong></div>
        </div>
      `,
    });

    const inspectorRoot = document.getElementById("inspectorContent");
    $("#marketBuyTab", inspectorRoot)?.addEventListener("click", () => {
      this.side = "buy";
      this.renderInspector();
    });
    $("#marketSellTab", inspectorRoot)?.addEventListener("click", () => {
      this.side = "sell";
      this.renderInspector();
    });
    $("#marketTradeAmount", inspectorRoot)?.addEventListener("input", () => this.renderInspector());
    $("#marketTradeSubmitBtn", inspectorRoot)?.addEventListener("click", () => this.trade());
  }

  async trade() {
    const token = this.selectedToken;
    const inspectorRoot = document.getElementById("inspectorContent");
    if (!token || !this.walletId || !inspectorRoot) return;
    const amount = Number($("#marketTradeAmount", inspectorRoot).value || 0);
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
