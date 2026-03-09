import { api } from "../net.js";
import {
  $,
  $$,
  createEl,
  escapeHtml,
  formatCC,
  formatCompactNumber,
  formatDecimal,
  percentClass,
  renderTokenAvatar,
  sparklineSvg,
  tsToLocal,
  tsToRelative,
} from "../ui.js";

const VIEWS = ["overview", "blocks", "transactions", "wallets", "tokens"];

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
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel explorer-screen" });
    this.root.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="screen-title">Explorer</h2>
            <p class="helper">Inspect the simulated chain, wallets, transactions, launches, and bot footprints.</p>
          </div>
          <div class="row wrap">
            <input id="explorerSearch" class="explorer-search" placeholder="Search token, wallet, block, or tx">
            <button id="explorerRefreshBtn" class="btn secondary" type="button">Refresh</button>
          </div>
        </div>
        <div class="card-body">
          <div id="explorerTabs" class="pill-tabs"></div>
        </div>
      </div>

      <div class="content-grid content-grid-explorer">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 id="explorerListTitle" class="section-title">Overview</h3>
              <p id="explorerListSub" class="helper">Latest network state</p>
            </div>
          </div>
          <div class="card-body">
            <div id="explorerList" class="list explorer-list"></div>
          </div>
        </div>

        <div class="card explorer-detail-card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Detail</h3>
              <p class="helper">Selection-aware payload view</p>
            </div>
          </div>
          <div class="card-body">
            <div id="explorerDetail" class="explorer-detail"></div>
          </div>
        </div>
      </div>
    `;

    $("#explorerRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#explorerSearch", this.root).addEventListener("input", (event) => {
      this.query = (event.target.value || "").trim();
      this.render();
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.view = VIEWS.includes(route?.params?.view) ? route.params.view : (this.view || "overview");
    this.ctx.setTopbar(this.title, "Simnet inspection");
    $("#explorerSearch", this.root).value = this.query;
    await this.load(route?.params || {});
  }

  hide() {}

  async load(params = {}) {
    this.payload = await this.loadPrimary(params);
    this.detail = await this.loadDetail(params, this.payload);
    this.render();
  }

  async loadPrimary(params) {
    try {
      if (this.view === "overview") return await api("/api/explorer/overview");
      if (this.view === "blocks") return await api("/api/explorer/blocks");
      if (this.view === "transactions") return await api("/api/explorer/transactions");
      if (this.view === "wallets") return await api("/api/explorer/wallets");
      if (this.view === "tokens") return await api("/api/explorer/tokens");
    } catch {
      return this.loadFallback();
    }
    return this.loadFallback();
  }

  async loadDetail(params, payload) {
    try {
      if (params.block) return await api(`/api/explorer/block/${encodeURIComponent(params.block)}`);
      if (params.tx) return await api(`/api/explorer/transaction/${encodeURIComponent(params.tx)}`);
      if (params.wallet) return await api(`/api/explorer/wallet/${encodeURIComponent(params.wallet)}`);
      if (params.token) return await api(`/api/explorer/token/${encodeURIComponent(params.token)}`);
    } catch {
      return null;
    }
    if (this.view === "overview") return payload;
    return null;
  }

  async loadFallback() {
    const [walletsRes, marketRes] = await Promise.all([
      api("/api/wallets"),
      api("/api/market").catch(() => ({ tokens: [] })),
    ]);
    return {
      overview: {
        wallet_count: walletsRes.wallets?.length || 0,
        token_count: marketRes.tokens?.length || 0,
        tx_count: walletsRes.transactions?.length || 0,
      },
      latest_blocks: [],
      latest_transactions: walletsRes.transactions || [],
      wallets: walletsRes.wallets || [],
      tokens: marketRes.tokens || [],
    };
  }

  setView(view) {
    this.view = view;
    this.ctx.navigate("explorer", { view });
  }

  filteredRows() {
    const q = this.query.toLowerCase();
    const payload = this.payload || {};
    if (this.view === "overview") {
      return [
        ...(payload.latest_blocks || []).slice(0, 4).map((item) => ({ ...item, _kind: "block" })),
        ...(payload.latest_transactions || []).slice(0, 6).map((item) => ({ ...item, _kind: "transaction" })),
      ];
    }
    const rows = payload[this.view] || payload.rows || [];
    if (!q) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }

  render() {
    this.renderTabs();
    this.renderList();
    this.renderDetail();
  }

  renderTabs() {
    const tabs = $("#explorerTabs", this.root);
    tabs.innerHTML = VIEWS.map((view) => `
      <button class="pill-tab ${view === this.view ? "active" : ""}" data-explorer-view="${view}" type="button">${escapeHtml(view)}</button>
    `).join("");
    $$("[data-explorer-view]", tabs).forEach((button) => {
      button.addEventListener("click", () => this.setView(button.dataset.explorerView));
    });
  }

  renderList() {
    const rows = this.filteredRows();
    $("#explorerListTitle", this.root).textContent = this.view.charAt(0).toUpperCase() + this.view.slice(1);
    $("#explorerListSub", this.root).textContent = this.summaryText(rows.length);
    const list = $("#explorerList", this.root);
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">No explorer rows for this view yet.</div>`;
      return;
    }
    if (this.view === "overview") {
      list.innerHTML = this.renderOverviewRows(rows);
      this.bindOverviewRows(list);
      return;
    }
    if (this.view === "blocks") {
      list.innerHTML = rows.map((row) => this.renderBlockRow(row)).join("");
      $$("[data-open-block]", list).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "blocks", block: button.dataset.openBlock })));
      return;
    }
    if (this.view === "transactions") {
      list.innerHTML = rows.map((row) => this.renderTxRow(row)).join("");
      $$("[data-open-tx]", list).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "transactions", tx: button.dataset.openTx })));
      return;
    }
    if (this.view === "wallets") {
      list.innerHTML = rows.map((row) => this.renderWalletRow(row)).join("");
      $$("[data-open-wallet]", list).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "wallets", wallet: button.dataset.openWallet })));
      return;
    }
    if (this.view === "tokens") {
      list.innerHTML = rows.map((row) => this.renderTokenRow(row)).join("");
      $$("[data-open-token]", list).forEach((button) => button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "tokens", token: button.dataset.openToken })));
    }
  }

  renderOverviewRows(rows) {
    return rows.map((row) => `
      <button class="feed-row explorer-overview-row" data-overview-kind="${row._kind}" data-overview-ref="${row.height || row.tx_id || row.id || ""}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(row._kind === "block" ? `Block ${row.height || "-"}` : (row.tx_id || row.kind || "Transaction"))}</strong>
          <span>${tsToRelative(row.ts || row.created_at || row.timestamp)}</span>
        </div>
        <div class="feed-body">${escapeHtml(this.overviewBody(row))}</div>
      </button>
    `).join("");
  }

  bindOverviewRows(list) {
    $$("[data-overview-kind]", list).forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.overviewKind;
        const ref = button.dataset.overviewRef;
        if (kind === "block") this.ctx.navigate("explorer", { view: "blocks", block: ref });
        if (kind === "transaction") this.ctx.navigate("explorer", { view: "transactions", tx: ref });
      });
    });
  }

  overviewBody(row) {
    if (row._kind === "block") {
      return `${row.tx_count || 0} txs | ${row.block_hash || row.hash || "pending hash"}`;
    }
    return `${row.kind || row.type || "tx"} | ${row.status || "confirmed"} | ${row.symbol || ""} ${formatDecimal(row.amount || 0, 4)}`;
  }

  renderBlockRow(row) {
    return `
      <button class="explorer-row" data-open-block="${row.height || row.block_number || row.id}" type="button">
        <div class="feed-meta">
          <strong>Block ${row.height || row.block_number || row.id}</strong>
          <span>${tsToLocal(row.ts || row.created_at || row.timestamp)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.block_hash || row.hash || "No hash")}</div>
        <div class="chip-row">
          <span class="chip">${row.tx_count || row.transactions || 0} txs</span>
          <span class="chip">${escapeHtml(row.kind || "block")}</span>
        </div>
      </button>
    `;
  }

  renderTxRow(row) {
    return `
      <button class="explorer-row" data-open-tx="${row.tx_id || row.id}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(row.tx_id || row.id || "tx")}</strong>
          <span>${tsToLocal(row.ts || row.created_at || row.timestamp)}</span>
        </div>
        <div class="feed-body">${escapeHtml(`${row.kind || row.type || "transaction"} | ${row.status || "confirmed"}`)}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(row.symbol || row.token_symbol || "asset")}</span>
          <span class="chip">${formatDecimal(row.amount || row.token_amount || 0, 4)}</span>
          <span class="chip">${formatCC(row.fee_cc || row.fees || 0, 2)}</span>
        </div>
      </button>
    `;
  }

  renderWalletRow(row) {
    const label = row.name || row.wallet_name || row.address || "Wallet";
    const address = row.address || row.id || "";
    return `
      <button class="explorer-row" data-open-wallet="${address}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(row.owner_kind || row.kind || (row.bot_name ? "bot" : "wallet"))}</span>
        </div>
        <div class="feed-body">${escapeHtml(address)}</div>
        <div class="chip-row">
          <span class="chip">${formatCC(row.total_value_cc || row.balance_cc || 0)}</span>
          <span class="chip">${row.tx_count || row.activity_count || 0} txs</span>
        </div>
      </button>
    `;
  }

  renderTokenRow(row) {
    return `
      <button class="token-row explorer-token-row" data-open-token="${row.id || row.token_id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(row)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(row.name || row.symbol)}</strong>
              <span class="chip">${formatCC(row.price || row.last_price || 0, 4)}</span>
            </div>
            <div class="tiny muted">${escapeHtml(row.symbol)} | ${escapeHtml(row.category || row.status || "token")}</div>
          </div>
        </div>
        <div class="token-row-side">
          <div class="trend-chip ${percentClass(row.change_24h)}">${formatDecimal(row.change_24h || 0, 2)}%</div>
          <div class="mini-chart">${sparklineSvg(row.history || [], { width: 110, height: 34 })}</div>
        </div>
      </button>
    `;
  }

  renderDetail() {
    const node = $("#explorerDetail", this.root);
    const detail = this.detail;
    if (!detail) {
      node.innerHTML = `<div class="empty-state">Select a block, transaction, wallet, or token to inspect it here.</div>`;
      return;
    }
    if (detail.block || detail.height || detail.block_hash) {
      node.innerHTML = this.renderBlockDetail(detail.block || detail);
      return;
    }
    if (detail.transaction || detail.tx_id || detail.kind) {
      node.innerHTML = this.renderTxDetail(detail.transaction || detail);
      return;
    }
    if (detail.wallet || detail.address || detail.tokens) {
      node.innerHTML = this.renderWalletDetail(detail.wallet || detail);
      return;
    }
    if (detail.token || detail.symbol || detail.holders) {
      node.innerHTML = this.renderTokenDetail(detail.token || detail);
      return;
    }
    node.innerHTML = `<pre class="code-panel">${escapeHtml(JSON.stringify(detail, null, 2))}</pre>`;
  }

  renderBlockDetail(block) {
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <strong>Block ${block.height || block.block_number || "-"}</strong>
          <span>${tsToLocal(block.ts || block.created_at || block.timestamp)}</span>
        </div>
        <div class="chip-row">
          <span class="chip">${block.tx_count || 0} txs</span>
          <span class="chip">${escapeHtml(block.block_hash || block.hash || "no hash")}</span>
        </div>
        ${block.transactions?.length ? `
          <div class="detail-section">
            <h4>Contents</h4>
            <div class="list">
              ${block.transactions.map((tx) => `
                <button class="explorer-row" data-open-inline-tx="${tx.tx_id || tx.id}" type="button">
                  <div class="feed-meta"><strong>${escapeHtml(tx.tx_id || tx.id || "tx")}</strong><span>${escapeHtml(tx.kind || tx.type || "tx")}</span></div>
                  <div class="feed-body">${escapeHtml(tx.symbol || tx.token_symbol || "")} ${formatDecimal(tx.amount || tx.token_amount || 0, 4)}</div>
                </button>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  renderTxDetail(tx) {
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <strong>${escapeHtml(tx.tx_id || tx.id || "Transaction")}</strong>
          <span>${escapeHtml(tx.status || "confirmed")}</span>
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(tx.kind || tx.type || "tx")}</span>
          <span class="chip">${escapeHtml(tx.symbol || tx.token_symbol || "asset")}</span>
          <span class="chip">${formatDecimal(tx.amount || tx.token_amount || 0, 4)}</span>
          <span class="chip">${formatCC(tx.fee_cc || tx.fees || 0)}</span>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Block</span><strong>${escapeHtml(String(tx.block_height || tx.block || "-"))}</strong></div>
          <div><span class="muted">Sender</span><strong>${escapeHtml(String(tx.sender || tx.from_address || tx.from_wallet || tx.from_wallet_id || "-"))}</strong></div>
          <div><span class="muted">Receiver</span><strong>${escapeHtml(String(tx.receiver || tx.to_address || tx.to_wallet || tx.to_wallet_id || "-"))}</strong></div>
          <div><span class="muted">Timestamp</span><strong>${escapeHtml(tsToLocal(tx.ts || tx.created_at || tx.timestamp))}</strong></div>
        </div>
        ${tx.meta ? `<pre class="code-panel">${escapeHtml(JSON.stringify(tx.meta, null, 2))}</pre>` : ""}
      </div>
    `;
  }

  renderWalletDetail(wallet) {
    return `
      <div class="detail-stack">
        <div class="detail-hero">
          <strong>${escapeHtml(wallet.name || wallet.wallet_name || "Wallet")}</strong>
          <span>${escapeHtml(wallet.address || wallet.id || "")}</span>
        </div>
        <div class="chip-row">
          <span class="chip">${formatCC(wallet.total_value_cc || wallet.balance_cc || 0)}</span>
          <span class="chip">${wallet.tx_count || wallet.activity_count || 0} txs</span>
          <span class="chip">${escapeHtml(wallet.owner_kind || wallet.kind || (wallet.bot_name ? "bot" : "wallet"))}</span>
        </div>
        ${wallet.tokens?.length ? `
          <div class="detail-section">
            <h4>Balances</h4>
            <div class="list">
              ${wallet.tokens.map((token) => `
                <div class="wallet-mini-token">
                  ${renderTokenAvatar(token, { compact: true })}
                  <div class="stretch">
                    <strong>${escapeHtml(token.symbol || token.name)}</strong>
                    <div class="tiny muted">${formatDecimal(token.amount || 0, 4)}</div>
                  </div>
                  <span class="chip">${formatCC(token.value_cc || 0)}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
        ${wallet.transactions?.length ? `
          <div class="detail-section">
            <h4>Transactions</h4>
            <div class="list">
              ${wallet.transactions.map((tx) => `
                <div class="feed-row">
                  <div class="feed-meta"><strong>${escapeHtml(tx.tx_id || tx.kind || tx.type || "tx")}</strong><span>${tsToRelative(tx.ts || tx.created_at || tx.timestamp)}</span></div>
                  <div class="feed-body">${escapeHtml(tx.summary || tx.symbol || "")}</div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  renderTokenDetail(token) {
    return `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token">
          <div class="row">
            ${renderTokenAvatar(token)}
            <div class="col" style="gap:4px;">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="muted">${escapeHtml(token.symbol || "")}</span>
            </div>
          </div>
          <span class="chip chip-primary">${formatCC(token.price || token.last_price || 0, 4)}</span>
        </div>
        <div class="mini-chart wide">${sparklineSvg(token.history || [], { width: 340, height: 90 })}</div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(token.category || token.status || "token")}</span>
          <span class="chip">${formatCompactNumber(token.holder_count || token.holders?.length || 0)} holders</span>
          <span class="chip">${formatCC(token.market_cap || 0)}</span>
          <span class="chip">${formatCC(token.volume_24h || 0)} vol</span>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Creator</span><strong>${escapeHtml(String(token.creator || token.creator_name || token.creator_wallet || token.creator_user_id || "-"))}</strong></div>
          <div><span class="muted">Supply</span><strong>${formatCompactNumber(token.supply || token.total_supply || 0)}</strong></div>
          <div><span class="muted">Volatility</span><strong>${escapeHtml(String(token.volatility || token.volatility_profile || "-"))}</strong></div>
          <div><span class="muted">Risk</span><strong>${escapeHtml(String(token.risk_profile || token.risk_status || "-"))}</strong></div>
        </div>
        ${token.description ? `<p class="helper">${escapeHtml(token.description)}</p>` : ""}
      </div>
    `;
  }

  summaryText(count) {
    if (this.view === "overview") return "Latest blocks and transactions";
    return `${count} ${this.view} loaded`;
  }
}
