import { api, copyToClipboard } from "../net.js";
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
  iconSprite,
  percentClass,
  priceVolumeChartSvg,
  renderTokenAvatar,
  sparklineSvg,
  tsToLocal,
  tsToRelative,
} from "../ui.js";

const VIEWS = ["overview", "blocks", "transactions", "wallets", "tokens"];
const VIEW_LABELS = {
  overview: "Overview",
  blocks: "Blocks",
  transactions: "Transactions",
  wallets: "Wallets",
  tokens: "Tokens",
};
const MONO_STYLE = "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;";

export class ExplorerScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "explorer";
    this.title = "Explorer";
    this.root = null;
    this.view = "overview";
    this.query = "";
    this.payload = null;
    this.detail = null;
    this.searchResults = null;
    this.routeParams = {};
    this.timer = null;
    this.lastAutoRefreshAt = 0;
    this.runSearch = debounce(() => this.fetchSearch().catch(() => {}), 180);
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel explorer-screen" });
    this.root.innerHTML = `
      <div class="hero-card explorer-hero">
        <div class="hero-copy">
          <span class="eyebrow">Explorer</span>
          <h2 class="screen-title">Cortisol simnet explorer</h2>
          <p class="helper">Trace blocks, swaps, launches, liquidity pulls, and wallet changes from the same live simulation state used by Market and Wallets.</p>
        </div>
        <div class="hero-actions row wrap" style="gap:10px; align-items:center;">
          <input id="explorerSearch" class="explorer-search" placeholder="Search token, wallet, tx hash, block, or address">
          <button id="explorerClearSearchBtn" class="btn ghost" type="button">Clear</button>
          <button id="explorerRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div id="explorerMetaStrip" class="mini-stat-grid"></div>
          <div id="explorerTabs" class="pill-tabs" style="margin-top:14px;"></div>
        </div>
      </div>

      <div class="content-grid content-grid-explorer">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 id="explorerListTitle" class="section-title">Overview</h3>
              <p id="explorerListSub" class="helper">Live explorer landing page</p>
            </div>
            <div class="chip-row" id="explorerListMeta"></div>
          </div>
          <div class="card-body"><div id="explorerList" class="list explorer-list"></div></div>
        </div>

        <div class="card explorer-detail-card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Detail</h3>
              <p class="helper">Dense inspection panel for the selected block, transaction, wallet, or token.</p>
            </div>
          </div>
          <div class="card-body"><div id="explorerDetail" class="explorer-detail"></div></div>
        </div>
      </div>
    `;

    $("#explorerRefreshBtn", this.root).addEventListener("click", () => this.load(this.routeParams));
    $("#explorerClearSearchBtn", this.root).addEventListener("click", () => {
      this.query = "";
      this.searchResults = null;
      $("#explorerSearch", this.root).value = "";
      this.render();
    });
    $("#explorerSearch", this.root).addEventListener("input", (event) => {
      this.query = (event.target.value || "").trim();
      if (!this.query) {
        this.searchResults = null;
        this.render();
        return;
      }
      this.runSearch();
    });
    return this.root;
  }

  async show(route) {
    if (this.timer) clearInterval(this.timer);
    this.root.classList.add("ready");
    this.routeParams = { ...(route?.params || {}) };
    this.view = VIEWS.includes(this.routeParams.view) ? this.routeParams.view : (this.view || "overview");
    this.query = String(route?.params?.q || "").trim();
    $("#explorerSearch", this.root).value = this.query;
    this.ctx.setTopbar(this.title, "Internal simnet inspection");
    await this.load(this.routeParams);
    this.timer = setInterval(() => {
      if (this.ctx.isScreenActive(this)) this.load(this.routeParams, { silent: true }).catch(() => {});
    }, 9000);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async load(params = this.routeParams, { silent = false } = {}) {
    this.routeParams = { ...params };
    if (!silent) this.ctx.setScreenLoading("Loading explorer...", true);
    try {
      const [payload, detail, search] = await Promise.all([
        this.loadPrimary(),
        this.loadDetail(this.routeParams),
        this.query ? this.fetchSearch({ render: false }) : Promise.resolve(null),
      ]);
      this.payload = payload || this.emptyOverview();
      this.detail = detail;
      this.searchResults = search;
      this.render();
    } finally {
      if (!silent) this.ctx.setScreenLoading("", false);
    }
  }

  async loadPrimary() {
    try {
      if (this.view === "overview") return await api("/api/explorer/overview");
      if (this.view === "blocks") return await api("/api/explorer/blocks?limit=40");
      if (this.view === "transactions") return await api("/api/explorer/transactions?limit=60");
      if (this.view === "wallets") return await api("/api/explorer/wallets?limit=40");
      if (this.view === "tokens") return await api("/api/explorer/tokens?limit=40");
    } catch {}
    return this.emptyOverview();
  }

  async loadDetail(params) {
    try {
      if (params.block) return await api(`/api/explorer/block/${encodeURIComponent(params.block)}`);
      if (params.tx) return await api(`/api/explorer/transaction/${encodeURIComponent(params.tx)}`);
      if (params.wallet) return await api(`/api/explorer/wallet/${encodeURIComponent(params.wallet)}`);
      if (params.token) return await api(`/api/explorer/token/${encodeURIComponent(params.token)}`);
    } catch {}
    return null;
  }

  async fetchSearch({ render = true } = {}) {
    const q = this.query.trim();
    if (!q) {
      this.searchResults = null;
      if (render) this.render();
      return null;
    }
    try {
      const payload = await api(`/api/explorer/search?q=${encodeURIComponent(q)}&limit=8`);
      if (this.query.trim() !== q) return null;
      this.searchResults = payload;
      if (render) this.render();
      return payload;
    } catch {
      if (this.query.trim() !== q) return null;
      this.searchResults = { query: q, wallets: [], tokens: [], transactions: [], blocks: [], error: true };
      if (render) this.render();
      return this.searchResults;
    }
  }

  emptyOverview() {
    return {
      counts: { blocks: 0, transactions: 0, wallets: 0, tokens: 0, bots: 0, market_mood: { regime: "balanced", value: 0 } },
      latest_blocks: [],
      latest_transactions: [],
      top_tokens: [],
      top_wallets: [],
      bots: [],
      market_activity: [],
    };
  }

  setView(view) {
    this.view = view;
    this.ctx.navigate("explorer", { view });
  }

  render() {
    this.renderMetaStrip();
    this.renderTabs();
    this.renderList();
    this.renderDetail();
  }

  renderMetaStrip() {
    const node = $("#explorerMetaStrip", this.root);
    const counts = this.payload?.counts || {};
    const rows = this.rowsForView();
    const totalResults = this.query
      ? ((this.searchResults?.tokens || []).length + (this.searchResults?.wallets || []).length + (this.searchResults?.transactions || []).length + (this.searchResults?.blocks || []).length)
      : Number(this.payload?.total || counts[this.view] || rows.length || 0);
    const latestBlock = counts.latest_block_height || this.payload?.blocks?.[0]?.height || this.detail?.block?.height || 0;
    const pendingCount = counts.pending_transactions || (this.payload?.transactions || []).filter((row) => row.status === "pending").length || 0;
    const mood = counts.market_mood || {};
    node.innerHTML = `
      <div class="stat-card"><span class="metric-label">Current view</span><strong>${escapeHtml(this.query ? "Search" : this.viewLabel(this.view))}</strong><span class="muted">${formatCompactNumber(totalResults || 0, 0)} rows in focus</span></div>
      <div class="stat-card"><span class="metric-label">Latest block</span><strong>${latestBlock ? `#${escapeHtml(String(latestBlock))}` : "-"}</strong><span class="muted">${counts.latest_block_at ? tsToRelative(counts.latest_block_at) : "Awaiting chain data"}</span></div>
      <div class="stat-card"><span class="metric-label">Pending tx</span><strong>${formatCompactNumber(pendingCount || 0, 0)}</strong><span class="muted">${formatCC(counts.pending_volume_cc || 0, 2)} unsettled flow</span></div>
      <div class="stat-card"><span class="metric-label">Market mood</span><strong>${escapeHtml(String(mood.regime || "balanced"))}</strong><span class="muted">${formatSignedPct(Number(mood.value || 0) * 100, 1)} bias</span></div>
    `;
  }

  renderTabs() {
    const tabs = $("#explorerTabs", this.root);
    tabs.innerHTML = VIEWS.map((view) => `<button class="pill-tab ${view === this.view ? "active" : ""}" data-explorer-view="${view}" type="button">${escapeHtml(this.viewLabel(view))}</button>`).join("");
    $$("[data-explorer-view]", tabs).forEach((button) => button.addEventListener("click", () => this.setView(button.dataset.explorerView)));
  }

  viewLabel(view) {
    return VIEW_LABELS[view] || view;
  }

  monoValue(value, { head = 10, tail = 8, full = false } = {}) {
    const raw = String(value || "");
    const text = full || raw.length <= head + tail + 2 ? raw : `${raw.slice(0, head)}...${raw.slice(-tail)}`;
    return `<span title="${escapeHtml(raw)}" style="${MONO_STYLE}">${escapeHtml(text)}</span>`;
  }

  copyButton(value, label = "Copy") {
    const raw = String(value || "");
    if (!raw) return "";
    return `<button class="btn ghost" data-copy-value="${escapeHtml(raw)}" type="button">${escapeHtml(label)}</button>`;
  }

  txValueLabel(row) {
    const kind = String(row?.tx_kind || row?.kind || "");
    const meta = row?.meta || {};
    if (kind === "token_create") {
      const seed = Number(meta.seed_liquidity_cc || 0);
      return seed > 0 ? `Seed ${formatCC(seed, 2)}` : "Launch";
    }
    if (kind === "wallet_transfer") {
      const symbol = row?.token?.symbol || meta.symbol || "asset";
      return `${formatDecimal(row?.amount || 0, symbol === "CC" ? 2 : 4)} ${symbol}`;
    }
    return formatCC(row?.value_cc || 0, 2);
  }

  listMetaChips() {
    if (this.query) {
      return [
        `<span class="chip">${iconSprite("compass")} Search</span>`,
        `<span class="chip">${formatCompactNumber((this.searchResults?.tokens || []).length + (this.searchResults?.wallets || []).length + (this.searchResults?.transactions || []).length + (this.searchResults?.blocks || []).length, 0)} matches</span>`,
      ];
    }
    const rows = this.rowsForView();
    const total = Number(this.payload?.total || this.payload?.counts?.[this.view] || rows.length || 0);
    return [
      `<span class="chip">${iconSprite("stack")} ${escapeHtml(this.viewLabel(this.view))}</span>`,
      `<span class="chip">${formatCompactNumber(total || 0, 0)} rows</span>`,
    ];
  }

  rowsForView() {
    if (this.view === "blocks") return this.payload?.blocks || [];
    if (this.view === "transactions") return this.payload?.transactions || [];
    if (this.view === "wallets") return this.payload?.wallets || [];
    if (this.view === "tokens") return this.payload?.tokens || [];
    return [];
  }

  renderList() {
    const node = $("#explorerList", this.root);
    $("#explorerListMeta", this.root).innerHTML = this.listMetaChips().join("");
    if (this.query) {
      $("#explorerListTitle", this.root).textContent = "Search";
      $("#explorerListSub", this.root).textContent = this.searchSummary();
      node.innerHTML = this.renderSearchSections();
      this.bindLinks(node);
      return;
    }
    $("#explorerListTitle", this.root).textContent = this.viewLabel(this.view);
    $("#explorerListSub", this.root).textContent = this.summaryText();
    if (this.view === "overview") {
      node.innerHTML = this.renderOverviewList(this.payload || this.emptyOverview());
      this.bindLinks(node);
      return;
    }
    const rows = this.rowsForView();
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No explorer rows for this view yet.</div>`;
      return;
    }
    if (this.view === "blocks") node.innerHTML = rows.map((row) => this.renderBlockRow(row)).join("");
    if (this.view === "transactions") node.innerHTML = rows.map((row) => this.renderTxRow(row)).join("");
    if (this.view === "wallets") node.innerHTML = rows.map((row) => this.renderWalletRow(row)).join("");
    if (this.view === "tokens") node.innerHTML = rows.map((row) => this.renderTokenRow(row)).join("");
    this.bindLinks(node);
  }

  renderOverviewBlockStrip(rows) {
    if (!rows.length) return `<div class="empty-state">No blocks yet.</div>`;
    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px;">
        ${rows.slice(0, 6).map((row) => `
          <button class="stat-card" data-open-block="${row.height || row.id}" type="button" style="text-align:left; min-height:0; padding:14px 16px; background:linear-gradient(180deg, rgba(115,96,255,0.16), rgba(10,13,22,0.96));">
            <span class="metric-label">Block ${escapeHtml(String(row.height || row.id || "-"))}</span>
            <strong style="font-size:1.2rem; line-height:1.1;">${formatCC(row.volume_cc || 0, 2)}</strong>
            <span class="muted">${formatDecimal(row.tx_count || 0, 0)} txs | ${tsToRelative(row.created_at || row.ts || row.timestamp)}</span>
            <span class="tiny muted" style="${MONO_STYLE}; display:block; margin-top:8px;">${escapeHtml(String(row.block_hash || row.hash || "").slice(0, 16))}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  renderOverviewList(payload) {
    const counts = payload.counts || {};
    const mood = counts.market_mood || {};
    return `
      <div class="detail-stack">
        <div class="mini-stat-grid">
          <div class="stat-card"><span class="metric-label">Blocks</span><strong>${formatCompactNumber(counts.blocks || 0, 0)}</strong><span class="muted">Confirmed ledger batches</span></div>
          <div class="stat-card"><span class="metric-label">Pending tx</span><strong>${formatCompactNumber(counts.pending_transactions || 0, 0)}</strong><span class="muted">${formatCC(counts.pending_volume_cc || 0, 2)} unsettled flow</span></div>
          <div class="stat-card"><span class="metric-label">Wallets</span><strong>${formatCompactNumber(counts.wallets || 0, 0)}</strong><span class="muted">User and bot accounts</span></div>
          <div class="stat-card"><span class="metric-label">Mood</span><strong>${escapeHtml(String(mood.regime || "balanced"))}</strong><span class="muted">${formatSignedPct(Number(mood.value || 0) * 100, 1)} bias</span></div>
        </div>
        <div class="detail-section"><h4>Latest Blocks</h4>${this.renderOverviewBlockStrip(payload.latest_blocks || [])}</div>
        <div class="content-grid content-grid-market-detail">
          <div class="detail-section"><h4>Latest Transactions</h4><div class="list">${(payload.latest_transactions || []).slice(0, 6).map((row) => this.renderTxRow(row)).join("") || `<div class="empty-state">No transactions yet.</div>`}</div></div>
          <div class="detail-section"><h4>Top Tokens</h4><div class="list">${(payload.top_tokens || []).slice(0, 5).map((row) => this.renderTokenRow(row)).join("") || `<div class="empty-state">No token coverage yet.</div>`}</div></div>
        </div>
      </div>
    `;
  }

  renderSearchSections() {
    const results = this.searchResults;
    if (!results) return `<div class="empty-state">Search the explorer for a wallet, token, transaction, or block.</div>`;
    const sections = [
      ["Tokens", results.tokens || [], (row) => this.renderTokenRow(row)],
      ["Wallets", results.wallets || [], (row) => this.renderWalletRow(row)],
      ["Transactions", results.transactions || [], (row) => this.renderTxRow(row)],
      ["Blocks", results.blocks || [], (row) => this.renderBlockRow(row)],
    ].filter(([, rows]) => rows.length);
    if (!sections.length) {
      return `<div class="empty-state">${results.error ? "Search failed against the live explorer index." : `No explorer entities matched "${escapeHtml(results.query || this.query)}".`}</div>`;
    }
    return sections.map(([title, rows, render]) => `<div class="detail-section explorer-search-section"><div class="row wrap space" style="gap:10px;"><h4>${escapeHtml(title)}</h4><span class="chip">${formatCompactNumber(rows.length, 0)} matches</span></div><div class="list">${rows.map(render).join("")}</div></div>`).join("");
  }

  renderBlockRow(row) {
    return `
      <button class="explorer-row" data-open-block="${row.height || row.id}" type="button">
        <div class="row wrap space" style="gap:10px;">
          <div class="feed-meta"><strong>Block ${row.height || row.id}</strong><span>${tsToRelative(row.created_at || row.ts || row.timestamp)}</span></div>
          <span class="chip">${formatDecimal(row.tx_count || 0, 0)} txs</span>
        </div>
        <div class="feed-body">${this.monoValue(row.block_hash || row.hash || "No block hash", { head: 14, tail: 10 })}</div>
        <div class="chip-row"><span class="chip">${formatCC(row.volume_cc || 0, 2)} volume</span><span class="chip">${formatCC(row.reward_amount || 0, 0)} reward</span>${row.miner_wallet?.address ? `<span class="chip">${this.monoValue(row.miner_wallet.address, { head: 8, tail: 6 })}</span>` : ""}${row.miner_wallet?.owner?.is_bot ? `<span class="chip chip-primary">Bot-mined</span>` : ""}</div>
      </button>
    `;
  }

  renderTxRow(row) {
    const token = row.token || {};
    const actor = row.bot?.slug || row.wallet?.name || row.tx_kind || "transaction";
    const valueLabel = this.txValueLabel(row);
    return `
      <button class="explorer-row" data-open-tx="${row.tx_hash || row.id}" type="button">
        <div class="row wrap space" style="gap:10px;">
          <div class="feed-meta"><strong>${escapeHtml(actor)}</strong><span>${tsToRelative(row.created_at || row.ts || row.timestamp)}</span></div>
          <span class="chip">${escapeHtml(String(row.status || "pending"))}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.summary || `${row.tx_kind || "transaction"} ${token.symbol || ""}`.trim())}</div>
        <div class="tiny muted" style="${MONO_STYLE}; margin-top:8px;">${escapeHtml(String(row.tx_hash || row.id || ""))}</div>
        <div class="chip-row"><span class="chip">${escapeHtml(String(row.tx_kind || row.kind || "tx")).replace(/_/g, " ")}</span><span class="chip">${escapeHtml(token.symbol || "asset")}</span><span class="chip">${escapeHtml(valueLabel)}</span>${row.block_height ? `<span class="chip">Block ${escapeHtml(String(row.block_height))}</span>` : `<span class="chip">Pending</span>`}${row.bot ? `<span class="chip chip-primary">Bot</span>` : ""}</div>
      </button>
    `;
  }

  renderWalletRow(row) {
    const owner = row.owner || {};
    return `
      <button class="explorer-row" data-open-wallet="${row.address || row.id}" type="button">
        <div class="row wrap space" style="gap:10px;">
          <div class="feed-meta"><strong>${escapeHtml(row.name || "Wallet")}</strong><span>${escapeHtml(row.owner_kind || row.wallet_kind || (owner.is_bot ? "bot" : "wallet"))}</span></div>
          <span class="chip">${formatCC(row.total_value_cc || row.balance_cc || 0)}</span>
        </div>
        <div class="feed-body">${this.monoValue(row.address || row.id || "", { head: 12, tail: 8 })}</div>
        <div class="chip-row"><span class="chip">${formatDecimal(row.token_count || row.tokens?.length || 0, 0)} assets</span><span class="chip">${formatDecimal(row.activity_count || row.tx_count || 0, 0)} txs</span><span class="chip">Last ${tsToRelative(row.last_activity_at || row.created_at)}</span>${owner.is_bot ? `<span class="chip chip-primary">Bot</span>` : ""}</div>
      </button>
    `;
  }

  renderTokenRow(row) {
    const chartPoints = row.chart?.points?.map((point) => point.price) || row.history || [];
    const change = row.change_24h ?? row.change_pct ?? 0;
    return `
      <button class="token-row explorer-token-row" data-open-token="${row.id || row.token_id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(row)}
          <div class="stretch">
            <div class="row wrap space" style="gap:10px;"><strong>${escapeHtml(row.name || row.symbol)}</strong><span class="chip">${formatCC(row.price || row.last_price || 0, 4)}</span></div>
            <div class="tiny muted">${escapeHtml(row.symbol || "")} | ${escapeHtml(row.category || row.regime || "token")} | ${this.monoValue(row.id || row.token_id || "", { head: 4, tail: 2, full: true })}</div>
            <div class="token-meta-line"><span>Vol ${formatCC(row.volume_cc || row.volume_24h || 0, 2)}</span><span>Liq ${formatCC(row.liquidity_value_cc || 0, 2)}</span><span>Cap ${formatCC(row.market_cap_cc || 0, 2)}</span><span>Risk ${formatDecimal(row.risk_score || 0, 0)}</span></div>
          </div>
        </div>
        <div class="token-row-side"><div class="trend-chip ${percentClass(change)}">${formatSignedPct(change, 2)}</div><div class="mini-chart">${sparklineSvg(chartPoints, { width: 120, height: 34 })}</div></div>
      </button>
    `;
  }

  renderDetail() {
    const node = $("#explorerDetail", this.root);
    if (!this.detail) {
      if (this.view === "overview") {
        node.innerHTML = this.renderOverviewDetail(this.payload || this.emptyOverview());
        this.bindLinks(node);
        return;
      }
      node.innerHTML = `<div class="empty-state">Select a block, transaction, wallet, or token to inspect it here.</div>`;
      return;
    }
    if (this.detail.block) node.innerHTML = this.renderBlockDetail(this.detail);
    else if (this.detail.transaction) node.innerHTML = this.renderTxDetail(this.detail.transaction);
    else if (this.detail.wallet || this.detail.owner) node.innerHTML = this.renderWalletDetail(this.detail);
    else if (this.detail.token) node.innerHTML = this.renderTokenDetail(this.detail.token);
    else node.innerHTML = `<pre class="code-panel">${escapeHtml(JSON.stringify(this.detail, null, 2))}</pre>`;
    this.bindLinks(node);
  }

  renderOverviewDetail(payload) {
    const counts = payload.counts || {};
    const mood = counts.market_mood || {};
    return `
      <div class="detail-stack">
        <div class="detail-hero"><strong>Explorer Landing</strong><span>${escapeHtml(String(mood.regime || "balanced"))}</span></div>
        <div class="mini-stat-grid">
          <div class="stat-card"><span class="metric-label">Blocks</span><strong>${formatCompactNumber(counts.blocks || 0, 0)}</strong><span class="muted">Ledger batches</span></div>
          <div class="stat-card"><span class="metric-label">Transactions</span><strong>${formatCompactNumber(counts.transactions || 0, 0)}</strong><span class="muted">Transfers, swaps, LP events</span></div>
          <div class="stat-card"><span class="metric-label">Bots</span><strong>${formatCompactNumber(counts.bots || 0, 0)}</strong><span class="muted">Autonomous actors</span></div>
          <div class="stat-card"><span class="metric-label">Market Mood</span><strong>${formatSignedPct(Number(mood.value || 0) * 100, 1)}</strong><span class="muted">${escapeHtml(String(mood.regime || "balanced"))}</span></div>
        </div>
        <div class="detail-section"><h4>Top Wallets</h4><div class="list">${(payload.top_wallets || []).slice(0, 5).map((row) => this.renderWalletRow(row)).join("") || `<div class="empty-state">No wallet leaders yet.</div>`}</div></div>
        <div class="detail-section"><h4>Top Tokens</h4><div class="list">${(payload.top_tokens || []).slice(0, 5).map((row) => this.renderTokenRow(row)).join("") || `<div class="empty-state">No token leaders yet.</div>`}</div></div>
        <div class="detail-section"><h4>Bot Registry</h4><div class="list">${(payload.bots || []).slice(0, 6).map((bot) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(bot.user?.display_name || bot.slug || "Bot")}</strong><span>${escapeHtml(bot.strategy || "strategy")}</span></div><div class="feed-body">${escapeHtml(bot.persona || "")}</div><div class="chip-row"><span class="chip">${escapeHtml(bot.risk_level || "medium")}</span>${bot.wallet?.address ? `<button class="btn ghost" data-open-wallet="${bot.wallet.address}" type="button">Open wallet</button>` : ""}</div></div>`).join("") || `<div class="empty-state">No bots registered.</div>`}</div></div>
        <div class="detail-section"><h4>Market Activity</h4><div class="list">${(payload.market_activity || []).slice(0, 8).map((row) => this.renderTxRow(row)).join("") || `<div class="empty-state">No activity recorded yet.</div>`}</div></div>
      </div>
    `;
  }

  renderBlockDetail(payload) {
    const block = payload.block || {};
    const txs = payload.transactions || [];
    const blockHash = String(block.block_hash || block.hash || "");
    const prevHash = String(block.prev_hash || "");
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <div class="col" style="gap:4px;">
            <strong>Block #${escapeHtml(String(block.height || "-"))}</strong>
            <span class="muted">${tsToLocal(block.created_at || block.ts || block.timestamp)} | ${tsToRelative(block.created_at || block.ts || block.timestamp)}</span>
          </div>
          <div class="row wrap" style="gap:8px;">
            ${this.copyButton(blockHash, "Copy hash")}
            ${block.miner_wallet?.address ? `<button class="btn ghost" data-open-wallet="${block.miner_wallet.address}" type="button">Miner ${escapeHtml(block.miner_wallet.name || block.miner_wallet.address)}</button>` : ""}
          </div>
        </div>
        <div class="detail-grid"><div><span class="muted">Height</span><strong>${escapeHtml(String(block.height || "-"))}</strong></div><div><span class="muted">Tx Count</span><strong>${formatDecimal(block.tx_count || 0, 0)}</strong></div><div><span class="muted">Volume</span><strong>${formatCC(block.volume_cc || 0, 2)}</strong></div><div><span class="muted">Reward</span><strong>${formatCC(block.reward_amount || 0, 0)}</strong></div><div><span class="muted">Mined</span><strong>${tsToRelative(block.created_at || block.ts || block.timestamp)}</strong></div><div><span class="muted">Status</span><strong>confirmed</strong></div></div>
        <div class="detail-section"><h4>Block Hash</h4><div class="code-panel" style="${MONO_STYLE}">${escapeHtml(blockHash || "-")}</div></div>
        <div class="detail-section"><h4>Previous Hash</h4><div class="code-panel" style="${MONO_STYLE}">${escapeHtml(prevHash || "-")}</div></div>
        <div class="detail-section"><h4>Transactions</h4><div class="list">${txs.length ? txs.map((row) => this.renderTxRow(row)).join("") : `<div class="empty-state">No transactions in this block.</div>`}</div></div>
      </div>
    `;
  }

  renderTxDetail(tx) {
    const token = tx.token || {};
    const txHash = String(tx.tx_hash || tx.id || "");
    const txKind = escapeHtml(String(tx.tx_kind || tx.kind || "transaction")).replace(/_/g, " ");
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <div class="col" style="gap:4px;">
            <strong>${escapeHtml(tx.summary || "Explorer transaction")}</strong>
            <span class="muted">${txKind} | ${tsToLocal(tx.created_at || tx.ts || tx.timestamp)}</span>
          </div>
          <div class="row wrap" style="gap:8px;">
            <span class="chip">${escapeHtml(tx.status || "pending")}</span>
            ${this.copyButton(txHash, "Copy tx hash")}
          </div>
        </div>
        <div class="chip-row"><span class="chip">${txKind}</span><span class="chip">${escapeHtml(token.symbol || "asset")}</span><span class="chip">${formatDecimal(tx.amount || 0, 4)}</span><span class="chip">${escapeHtml(this.txValueLabel(tx))}</span>${tx.bot ? `<span class="chip chip-primary">Bot ${escapeHtml(tx.bot.slug || "")}</span>` : ""}</div>
        <div class="detail-grid"><div><span class="muted">Block</span><strong>${escapeHtml(String(tx.block_height || "-"))}</strong></div><div><span class="muted">Timestamp</span><strong>${escapeHtml(tsToLocal(tx.created_at || tx.ts || tx.timestamp))}</strong></div><div><span class="muted">Price</span><strong>${formatCC(tx.price || 0, 4)}</strong></div><div><span class="muted">Fee</span><strong>${formatCC(tx.fee_cc || 0, 4)}</strong></div><div><span class="muted">Side</span><strong>${escapeHtml(tx.side || "-")}</strong></div><div><span class="muted">Memo</span><strong>${escapeHtml(String(tx.memo || "-"))}</strong></div></div>
        <div class="detail-section"><h4>Transaction Hash</h4><div class="code-panel" style="${MONO_STYLE}">${escapeHtml(txHash || "-")}</div></div>
        <div class="chip-row">${tx.wallet?.address ? `<button class="btn ghost" data-open-wallet="${tx.wallet.address}" type="button">From ${escapeHtml(tx.wallet.name || tx.wallet.address)}</button>` : ""}${tx.counterparty_wallet?.address ? `<button class="btn ghost" data-open-wallet="${tx.counterparty_wallet.address}" type="button">To ${escapeHtml(tx.counterparty_wallet.name || tx.counterparty_wallet.address)}</button>` : ""}${token.id ? `<button class="btn ghost" data-open-token="${token.id}" type="button">Token ${escapeHtml(token.symbol || "")}</button>` : ""}${tx.block_height ? `<button class="btn ghost" data-open-block="${tx.block_height}" type="button">Open block</button>` : ""}</div>
        <div class="stat-card"><span class="metric-label">Summary</span><strong>${escapeHtml(tx.summary || "Explorer transaction")}</strong><span class="muted">${escapeHtml(String(tx.memo || ""))}</span></div>
        ${tx.meta ? `<pre class="code-panel">${escapeHtml(JSON.stringify(tx.meta, null, 2))}</pre>` : ""}
      </div>
    `;
  }

  renderWalletDetail(payload) {
    const wallet = payload.wallet || {};
    const owner = payload.owner || wallet.owner || null;
    const balances = wallet.tokens || [];
    const positions = wallet.liquidity_positions || [];
    const txs = payload.transactions || [];
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <div class="col" style="gap:4px;">
            <strong>${escapeHtml(wallet.name || "Wallet")}</strong>
            <span class="muted">${escapeHtml(owner?.display_name || owner?.username || "System")} | ${escapeHtml(wallet.wallet_kind || "wallet")}</span>
          </div>
          <div class="row wrap" style="gap:8px;">
            ${owner?.is_bot ? `<span class="chip chip-primary">Bot wallet</span>` : `<span class="chip">${escapeHtml(wallet.wallet_kind || "wallet")}</span>`}
            ${this.copyButton(wallet.address, "Copy address")}
          </div>
        </div>
        <div class="detail-section"><h4>Address</h4><div class="code-panel" style="${MONO_STYLE}">${escapeHtml(wallet.address || "-")}</div></div>
        <div class="detail-grid"><div><span class="muted">Owner</span><strong>${escapeHtml(owner?.display_name || owner?.username || "System")}</strong></div><div><span class="muted">Value</span><strong>${formatCC(wallet.total_value_cc || 0)}</strong></div><div><span class="muted">Assets</span><strong>${formatDecimal(balances.length, 0)}</strong></div><div><span class="muted">LP Positions</span><strong>${formatDecimal(positions.length, 0)}</strong></div><div><span class="muted">Created</span><strong>${escapeHtml(tsToLocal(wallet.created_at))}</strong></div><div><span class="muted">Route</span><strong>${escapeHtml(owner?.is_bot ? "bot managed" : "user managed")}</strong></div></div>
        <div class="detail-section"><h4>Balances</h4><div class="list">${balances.length ? balances.map((token) => {
          const change = token.change_24h ?? token.change_pct ?? 0;
          return `<button class="token-row" data-open-token="${token.token_id || token.id}" type="button"><div class="token-row-main">${renderTokenAvatar(token, { compact: true })}<div class="stretch"><div class="row space"><strong>${escapeHtml(token.name || token.symbol)}</strong><span class="chip">${formatCC(token.value_cc || 0, 2)}</span></div><div class="tiny muted">${escapeHtml(token.symbol || "")} | ${formatDecimal(token.amount || 0, token.symbol === "CC" ? 2 : 4)} held</div></div></div><div class="token-row-side"><span class="trend-chip ${percentClass(change)}">${formatSignedPct(change, 2)}</span></div></button>`;
        }).join("") : `<div class="empty-state">No balances in this wallet.</div>`}</div></div>
        <div class="detail-section"><h4>Liquidity Positions</h4><div class="list">${positions.length ? positions.map((position) => `<button class="token-row" data-open-token="${position.token_id}" type="button"><div class="token-row-main">${renderTokenAvatar(position, { compact: true })}<div class="stretch"><div class="row wrap space" style="gap:10px;"><strong>${escapeHtml(position.name || position.symbol || "Pool")}</strong><span class="chip">${formatCC(position.pool_value_cc || 0, 2)}</span></div><div class="tiny muted">${escapeHtml(position.symbol || "")} | ${formatDecimal(position.share_units || 0, 4)} LP units | ${formatSignedPct(position.share_pct || 0, 2).replace(/^\+/, "")} of pool</div></div></div><div class="token-row-side"><span class="chip">${formatCC(position.pool_value_cc || 0, 2)}</span></div></button>`).join("") : `<div class="empty-state">No active LP positions in this wallet.</div>`}</div></div>
        <div class="detail-section"><h4>Transactions</h4><div class="list">${txs.length ? txs.map((row) => this.renderTxRow(row)).join("") : `<div class="empty-state">No explorer transactions for this wallet.</div>`}</div></div>
      </div>
    `;
  }

  renderTokenDetail(token) {
    const chartPoints = token.chart || { points: [] };
    return `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token"><div class="row">${renderTokenAvatar(token)}<div class="col" style="gap:4px;"><strong>${escapeHtml(token.name || token.symbol)}</strong><span class="muted">${escapeHtml(token.symbol || "")} | ${escapeHtml(token.regime || token.category || "token")}</span></div></div><div class="row wrap" style="gap:8px;"><button class="btn secondary" data-open-market-token="${token.id}" type="button">Open market</button>${token.creator_wallet?.address ? `<button class="btn ghost" data-open-wallet="${token.creator_wallet.address}" type="button">Creator wallet</button>` : ""}${this.copyButton(token.slug || token.id, "Copy token id")}</div></div>
        <div class="market-chart-wrap">${priceVolumeChartSvg(chartPoints, { width: 460, height: 250 })}</div>
        <div class="detail-section"><h4>Token Index</h4><div class="code-panel" style="${MONO_STYLE}">${escapeHtml(String(token.slug || token.id || "-"))}</div></div>
        <div class="detail-grid"><div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div><div><span class="muted">1h</span><strong class="${percentClass(token.change_1h)}">${formatSignedPct(token.change_1h || 0, 2)}</strong></div><div><span class="muted">24h</span><strong class="${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0, 2)}</strong></div><div><span class="muted">Liquidity</span><strong>${formatCC(token.liquidity_value_cc || 0, 2)}</strong></div><div><span class="muted">Volume</span><strong>${formatCC(token.volume_cc || 0, 2)}</strong></div><div><span class="muted">Market Cap</span><strong>${formatCC(token.market_cap_cc || 0, 2)}</strong></div><div><span class="muted">Risk</span><strong>${escapeHtml(String(token.risk_profile || "-"))}</strong></div><div><span class="muted">Holders</span><strong>${formatDecimal(token.holder_count || 0, 0)}</strong></div><div><span class="muted">Creator LP</span><strong>${formatSignedPct(token.creator_liquidity_share_pct || 0, 2).replace(/^\+/, "")}</strong></div><div><span class="muted">Wallet LP</span><strong>${formatSignedPct(token.wallet_liquidity_share_pct || 0, 2).replace(/^\+/, "")}</strong></div><div><span class="muted">Supply</span><strong>${formatCompactNumber(token.circulating_supply || 0, 2)}</strong></div><div><span class="muted">Bot Flow</span><strong>${formatDecimal(token.bot_participation || 0, 0)}</strong></div></div>
        ${token.risk_flags?.length ? `<div class="chip-row">${token.risk_flags.map((flag) => `<span class="chip chip-danger">${escapeHtml(flag)}</span>`).join("")}</div>` : ""}
        <p class="helper">${escapeHtml(token.description || "No token description available.")}</p>
        <div class="detail-section"><h4>Liquidity Holders</h4><div class="list">${(token.liquidity_positions || []).length ? (token.liquidity_positions || []).slice(0, 8).map((position) => `<button class="explorer-row" data-open-wallet="${position.wallet?.address || ""}" type="button"><div class="row wrap space" style="gap:10px;"><div class="feed-meta"><strong>${escapeHtml(position.wallet?.name || position.wallet?.address || "Wallet")}</strong><span>${this.monoValue(position.wallet?.address || "", { head: 10, tail: 6 })}</span></div><span class="chip">${formatCC(position.pool_value_cc || 0, 2)}</span></div><div class="chip-row"><span class="chip">${formatDecimal(position.share_units || 0, 4)} LP units</span><span class="chip">${formatSignedPct(position.share_pct || 0, 2).replace(/^\+/, "")} of pool</span></div></button>`).join("") : `<div class="empty-state">No LP holders yet.</div>`}</div></div>
        <div class="detail-section"><h4>Recent Trades</h4><div class="list">${(token.recent_trades || []).slice(0, 8).map((row) => this.renderTxRow(row)).join("") || `<div class="empty-state">No recent trades yet.</div>`}</div></div>
        <div class="detail-section"><h4>Recent Events</h4><div class="list">${(token.recent_events || []).slice(0, 8).map((row) => this.renderTxRow(row)).join("") || `<div class="empty-state">No event markers yet.</div>`}</div></div>
      </div>
    `;
  }

  bindLinks(root) {
    $$("[data-open-block]", root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "blocks", block: button.dataset.openBlock })));
    $$("[data-open-tx]", root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "transactions", tx: button.dataset.openTx })));
    $$("[data-open-wallet]", root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "wallets", wallet: button.dataset.openWallet })));
    $$("[data-open-token]", root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "tokens", token: button.dataset.openToken })));
    $$("[data-open-market-token]", root).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("market", { token: button.dataset.openMarketToken })));
    $$("[data-copy-value]", root).forEach((button) => button.addEventListener("click", async () => {
      try {
        await copyToClipboard(button.dataset.copyValue || "");
        this.ctx.notify.toast("Copied to clipboard", { tone: "success" });
      } catch {
        this.ctx.notify.toast("Copy failed", { tone: "error" });
      }
    }));
  }

  summaryText() {
    if (this.view === "overview") return "Unified chain, token, wallet, and market state";
    if (this.view === "blocks") return `${this.rowsForView().length} newest blocks, densest flow first`;
    if (this.view === "transactions") return `${this.rowsForView().length} recent launches, swaps, transfers, and LP events`;
    if (this.view === "wallets") return `${this.rowsForView().length} wallets ranked from the live simulation`;
    if (this.view === "tokens") return `${this.rowsForView().length} tokens sorted from the same market state used by trading`;
    return `${this.rowsForView().length} explorer rows loaded`;
  }

  searchSummary() {
    if (!this.searchResults) return "Querying explorer index...";
    if (this.searchResults.error) return "Search failed";
    const total = (this.searchResults.tokens || []).length + (this.searchResults.wallets || []).length + (this.searchResults.transactions || []).length + (this.searchResults.blocks || []).length;
    return `${total} result${total === 1 ? "" : "s"} across tokens, wallets, txs, and blocks`;
  }

  onEvent(msg) {
    if (msg.type === "market_cycle" && this.ctx.isScreenActive(this)) {
      const now = Date.now();
      if (now - this.lastAutoRefreshAt >= 5000) {
        this.lastAutoRefreshAt = now;
        this.load(this.routeParams, { silent: true }).catch(() => {});
      }
    }
  }
}
