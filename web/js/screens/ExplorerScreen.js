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
    this.overview = null;
    this.loading = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel explorer-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Explorer</h2>
          <p>Inspect blocks, transactions, wallets, and token detail from the simulated ledger.</p>
        </div>
        <div class="page-actions">
          <input id="explorerSearch" class="explorer-search" placeholder="Search block, tx, wallet, or token">
          <button id="explorerRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Blocks</span>
          <strong id="explorerBlocksCount" class="stat-value">0</strong>
          <span class="stat-note">Indexed explorer blocks</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Transactions</span>
          <strong id="explorerTxCount" class="stat-value">0</strong>
          <span class="stat-note">Ledger transaction records</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Wallets</span>
          <strong id="explorerWalletCount" class="stat-value">0</strong>
          <span class="stat-note">Visible wallets in the sim</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Tokens</span>
          <strong id="explorerTokenCount" class="stat-value">0</strong>
          <span class="stat-note">Active token contracts</span>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Explorer views</h3>
            <p class="helper">Switch between chain overview, block list, transactions, wallets, and tokens.</p>
          </div>
          <div id="explorerTabs" class="tabs"></div>
        </div>
        <div class="panel-body">
          <div class="section-grid two">
            <div class="stack">
              <div class="detail-card">
                <div class="detail-row">
                  <div>
                    <div id="explorerListTitle" class="section-title">Overview</div>
                    <div id="explorerListSubtitle" class="helper">Latest blocks and transactions</div>
                  </div>
                  <button id="explorerClearSelectionBtn" class="btn ghost" type="button">Clear</button>
                </div>
              </div>
              <div id="explorerList" class="list-stack explorer-list"></div>
            </div>
            <div id="explorerDetailPane" class="stack"></div>
          </div>
        </div>
      </section>
    `;

    $("#explorerRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#explorerSearch", this.root).addEventListener("input", (event) => {
      this.query = (event.target.value || "").trim();
      this.render();
    });
    $("#explorerClearSelectionBtn", this.root).addEventListener("click", () => this.clearSelection());
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.view = VIEWS.includes(route?.params?.view) ? route.params.view : (this.view || "overview");
    this.query = route?.params?.q || this.query || "";
    $("#explorerSearch", this.root).value = this.query;
    this.ctx.setGlobalSearchValue(this.query);
    this.ctx.setTopbar(this.title, "Simulated chain inspection");
    await this.load(route?.params || {});
  }

  hide() {}

  async load(params = {}) {
    this.loading = true;
    if (!this.payload) this.render();
    try {
      if (!this.overview) this.overview = await api("/api/explorer/overview");
      this.payload = await this.loadPrimary(params);
      this.detail = await this.loadDetail(params);
    } catch (error) {
      this.ctx.notify.toast(`Explorer load failed: ${error.message}`, { tone: "error" });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async loadPrimary(params) {
    if (this.view === "overview") return await api("/api/explorer/overview");
    if (this.view === "blocks") return await api("/api/explorer/blocks");
    if (this.view === "transactions") return await api("/api/explorer/transactions");
    if (this.view === "wallets") return await api("/api/explorer/wallets");
    if (this.view === "tokens") return await api("/api/explorer/tokens");
    return await api("/api/explorer/overview");
  }

  async loadDetail(params) {
    if (params.block) return await api(`/api/explorer/block/${encodeURIComponent(params.block)}`);
    if (params.tx) return await api(`/api/explorer/transaction/${encodeURIComponent(params.tx)}`);
    if (params.wallet) return await api(`/api/explorer/wallet/${encodeURIComponent(params.wallet)}`);
    if (params.token) return await api(`/api/explorer/token/${encodeURIComponent(params.token)}`);
    return null;
  }

  clearSelection() {
    const nextParams = { view: this.view };
    if (this.query) nextParams.q = this.query;
    this.ctx.navigate("explorer", nextParams);
  }

  filteredRows() {
    const search = this.query.toLowerCase();
    if (this.view === "overview") {
      const blocks = (this.payload?.latest_blocks || []).map((row) => ({ ...row, _kind: "block" }));
      const txs = (this.payload?.latest_transactions || []).map((row) => ({ ...row, _kind: "transaction" }));
      const rows = [...blocks, ...txs];
      if (!search) return rows;
      return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
    }
    const key = this.view === "blocks"
      ? "blocks"
      : this.view === "transactions"
        ? "transactions"
        : this.view === "wallets"
          ? "wallets"
          : "tokens";
    const rows = this.payload?.[key] || [];
    if (!search) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
  }

  render() {
    this.renderSummary();
    this.renderTabs();
    this.renderList();
    this.renderDetail();
    this.renderInspector();
  }

  renderSummary() {
    const counts = this.overview?.counts || {};
    $("#explorerBlocksCount", this.root).textContent = formatCompactNumber(counts.blocks || 0, 0);
    $("#explorerTxCount", this.root).textContent = formatCompactNumber(counts.transactions || 0, 0);
    $("#explorerWalletCount", this.root).textContent = formatCompactNumber(counts.wallets || 0, 0);
    $("#explorerTokenCount", this.root).textContent = formatCompactNumber(counts.tokens || 0, 0);
  }

  renderTabs() {
    const tabs = $("#explorerTabs", this.root);
    tabs.innerHTML = VIEWS.map((view) => `
      <button class="tab-btn ${view === this.view ? "active" : ""}" data-explorer-view="${view}" type="button">${escapeHtml(view)}</button>
    `).join("");
    $$("[data-explorer-view]", tabs).forEach((button) => {
      button.addEventListener("click", () => {
        this.view = button.dataset.explorerView;
        const params = { view: this.view };
        if (this.query) params.q = this.query;
        this.ctx.navigate("explorer", params);
      });
    });
  }

  renderList() {
    const node = $("#explorerList", this.root);
    const rows = this.filteredRows();
    $("#explorerListTitle", this.root).textContent = this.view.charAt(0).toUpperCase() + this.view.slice(1);
    $("#explorerListSubtitle", this.root).textContent = this.subtitleForView(rows.length);
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No explorer rows</strong><span>Try a different view or search term.</span></div>`;
      return;
    }
    if (this.view === "overview") {
      node.innerHTML = rows.map((row) => this.renderOverviewRow(row)).join("");
      $$("[data-overview-kind]", node).forEach((button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.overviewKind;
          const ref = button.dataset.overviewRef;
          if (kind === "block") this.ctx.navigate("explorer", { view: "blocks", block: ref, q: this.query || "" });
          if (kind === "transaction") this.ctx.navigate("explorer", { view: "transactions", tx: ref, q: this.query || "" });
        });
      });
      return;
    }
    if (this.view === "blocks") {
      node.innerHTML = rows.map((row) => this.renderBlockRow(row)).join("");
      $$("[data-open-block]", node).forEach((button) => {
        button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "blocks", block: button.dataset.openBlock, q: this.query || "" }));
      });
      return;
    }
    if (this.view === "transactions") {
      node.innerHTML = rows.map((row) => this.renderTxRow(row)).join("");
      $$("[data-open-tx]", node).forEach((button) => {
        button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "transactions", tx: button.dataset.openTx, q: this.query || "" }));
      });
      return;
    }
    if (this.view === "wallets") {
      node.innerHTML = rows.map((row) => this.renderWalletRow(row)).join("");
      $$("[data-open-wallet]", node).forEach((button) => {
        button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "wallets", wallet: button.dataset.openWallet, q: this.query || "" }));
      });
      return;
    }
    node.innerHTML = rows.map((row) => this.renderTokenRow(row)).join("");
    $$("[data-open-token]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "tokens", token: button.dataset.openToken, q: this.query || "" }));
    });
  }

  renderOverviewRow(row) {
    return `
      <button class="list-item" data-overview-kind="${row._kind}" data-overview-ref="${row.height || row.tx_hash || row.id || ""}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(row._kind === "block" ? `Block ${row.height}` : (row.tx_hash || row.tx_id || "Transaction"))}</strong>
          <span>${tsToRelative(row.created_at || row.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row._kind === "block" ? `${row.tx_count || 0} transaction${Number(row.tx_count || 0) === 1 ? "" : "s"}` : `${row.tx_kind || row.kind || "transaction"} · ${row.token?.symbol || row.symbol || "asset"} ${formatDecimal(row.amount || 0, 4)}`)}</div>
      </button>
    `;
  }

  renderBlockRow(row) {
    return `
      <button class="list-item" data-open-block="${row.height || row.id}" type="button">
        <div class="feed-meta">
          <strong>Block ${row.height || row.id}</strong>
          <span>${tsToLocal(row.created_at || row.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.block_hash || row.hash || "No hash")}</div>
        <div class="chip-row">
          <span class="chip">${row.tx_count || 0} txs</span>
          <span class="chip">${escapeHtml(row.miner_wallet?.name || row.miner_wallet?.address || "Miner")}</span>
        </div>
      </button>
    `;
  }

  renderTxRow(row) {
    return `
      <button class="list-item" data-open-tx="${row.tx_hash || row.id}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(row.tx_hash || row.tx_id || row.id || "tx")}</strong>
          <span>${tsToLocal(row.created_at || row.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.tx_kind || row.kind || "transaction")} · ${escapeHtml(row.token?.symbol || row.symbol || "asset")} ${formatDecimal(row.amount || 0, 4)}</div>
      </button>
    `;
  }

  renderWalletRow(row) {
    const owner = row.owner || {};
    return `
      <button class="list-item" data-open-wallet="${row.id || row.address}" type="button">
        <div class="feed-meta">
          <strong>${escapeHtml(row.name || row.address || "Wallet")}</strong>
          <span>${formatCC(row.total_value_cc || 0)}</span>
        </div>
        <div class="feed-body">${escapeHtml(row.address || "")}</div>
        <div class="chip-row">
          <span class="chip">${row.token_count || 0} holdings</span>
          <span class="chip">${owner.display_name ? escapeHtml(owner.display_name) : "Unassigned"}</span>
        </div>
      </button>
    `;
  }

  renderTokenRow(row) {
    return `
      <button class="token-row" data-open-token="${row.id || row.token_id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(row)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(row.name || row.symbol)}</strong>
              <span class="chip">${formatCC(row.price || 0, 4)}</span>
            </div>
            <div class="token-meta-line">
              <span>${escapeHtml(row.symbol || "")}</span>
              <span>${escapeHtml(row.category || "token")}</span>
            </div>
          </div>
        </div>
        <div class="row-trailing">
          <span class="trend-chip ${percentClass(row.change_pct)}">${formatSignedPct(row.change_pct || 0)}</span>
        </div>
      </button>
    `;
  }

  renderDetail() {
    const node = $("#explorerDetailPane", this.root);
    const detail = this.detail;
    if (this.loading && !detail) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!detail) {
      node.innerHTML = this.renderOverviewDetail();
      this.bindDetailActions(node);
      return;
    }
    if (detail.block || detail.height || detail.block_hash) {
      node.innerHTML = this.renderBlockDetail(detail.block || detail);
      this.bindDetailActions(node);
      return;
    }
    if (detail.transaction || detail.tx_hash || detail.tx_kind) {
      node.innerHTML = this.renderTxDetail(detail.transaction || detail);
      this.bindDetailActions(node);
      return;
    }
    if (detail.wallet || detail.address || detail.tokens) {
      node.innerHTML = this.renderWalletDetail(detail.wallet || detail);
      this.bindDetailActions(node);
      return;
    }
    if (detail.token || detail.symbol || detail.top_holders) {
      node.innerHTML = this.renderTokenDetail(detail.token || detail);
      this.bindDetailActions(node);
      return;
    }
    node.innerHTML = `<pre class="detail-card">${escapeHtml(JSON.stringify(detail, null, 2))}</pre>`;
  }

  renderOverviewDetail() {
    const overview = this.overview || {};
    const topTokens = overview.top_tokens || [];
    const topWallets = overview.top_wallets || [];
    return `
      <div class="section-grid two">
        <section class="panel inset">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Top tokens</h3>
              <p class="helper">Largest visible assets by market cap.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="list-stack">
              ${topTokens.length ? topTokens.map((token) => `
                <button class="token-row" data-inline-token="${token.id}" type="button">
                  <div class="token-row-main">
                    ${renderTokenAvatar(token)}
                    <div class="stretch">
                      <div class="row space">
                        <strong>${escapeHtml(token.name || token.symbol)}</strong>
                        <span class="chip">${formatCC(token.price || 0, 4)}</span>
                      </div>
                      <div class="token-meta-line">
                        <span>${escapeHtml(token.symbol || "")}</span>
                        <span>${escapeHtml(token.category || "token")}</span>
                      </div>
                    </div>
                  </div>
                </button>
              `).join("") : `<div class="empty-state"><strong>No tokens</strong><span>Token detail will appear here once active assets exist.</span></div>`}
            </div>
          </div>
        </section>

        <section class="panel inset">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Top wallets</h3>
              <p class="helper">Highest visible wallet values in the explorer index.</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="list-stack">
              ${topWallets.length ? topWallets.map((wallet) => `
                <button class="list-item compact" data-inline-wallet="${wallet.id}" type="button">
                  <div class="feed-meta">
                    <strong>${escapeHtml(wallet.name || wallet.address || "Wallet")}</strong>
                    <span>${formatCC(wallet.total_value_cc || 0)}</span>
                  </div>
                  <div class="feed-body">${escapeHtml(wallet.address || "")}</div>
                </button>
              `).join("") : `<div class="empty-state"><strong>No wallets</strong><span>Wallet detail will appear here once balances are indexed.</span></div>`}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  renderBlockDetail(block) {
    const transactions = block.transactions || this.detail?.transactions || [];
    return `
      <div class="panel inset">
        <div class="panel-body stack">
          <div class="detail-row"><span class="muted">Block</span><strong>${escapeHtml(String(block.height || block.id || "-"))}</strong></div>
          <div class="detail-row"><span class="muted">Hash</span><strong>${escapeHtml(block.block_hash || block.hash || "-")}</strong></div>
          <div class="detail-row"><span class="muted">Created</span><strong>${tsToLocal(block.created_at || block.ts)}</strong></div>
          <div class="detail-row"><span class="muted">Transactions</span><strong>${transactions.length || block.tx_count || 0}</strong></div>
        </div>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Block contents</h3>
            <p class="helper">Transactions currently attached to this block.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="list-stack">
            ${transactions.length ? transactions.map((tx) => `
              <button class="list-item compact" data-inline-tx="${tx.tx_hash || tx.id}" type="button">
                <div class="feed-meta">
                  <strong>${escapeHtml(tx.tx_hash || tx.id || "tx")}</strong>
                  <span>${escapeHtml(tx.tx_kind || tx.kind || "transaction")}</span>
                </div>
                <div class="feed-body">${escapeHtml(tx.token?.symbol || tx.symbol || "asset")} ${formatDecimal(tx.amount || 0, 4)}</div>
              </button>
            `).join("") : `<div class="empty-state"><strong>No transactions</strong><span>This block does not have decoded transactions attached.</span></div>`}
          </div>
        </div>
      </section>
    `;
  }

  renderTxDetail(tx) {
    return `
      <div class="panel inset">
        <div class="panel-body stack">
          <div class="detail-row"><span class="muted">Transaction</span><strong>${escapeHtml(tx.tx_hash || tx.id || "tx")}</strong></div>
          <div class="detail-row"><span class="muted">Kind</span><strong>${escapeHtml(tx.tx_kind || tx.kind || "transaction")}</strong></div>
          <div class="detail-row"><span class="muted">Token</span><strong>${escapeHtml(tx.token?.symbol || tx.symbol || "asset")}</strong></div>
          <div class="detail-row"><span class="muted">Amount</span><strong>${formatDecimal(tx.amount || 0, 4)}</strong></div>
          <div class="detail-row"><span class="muted">Value</span><strong>${formatCC(tx.value_cc || 0)}</strong></div>
          <div class="detail-row"><span class="muted">Timestamp</span><strong>${tsToLocal(tx.created_at || tx.ts)}</strong></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body stack">
          <button class="btn secondary" data-inline-wallet="${escapeHtml(String(tx.wallet?.id || ""))}" type="button">Open source wallet</button>
          <button class="btn secondary" data-inline-token="${escapeHtml(String(tx.token?.id || ""))}" type="button">Open token</button>
          ${tx.counterparty_wallet?.id ? `<button class="btn secondary" data-inline-wallet="${escapeHtml(String(tx.counterparty_wallet.id))}" type="button">Open counterparty wallet</button>` : ""}
        </div>
      </div>
    `;
  }

  renderWalletDetail(wallet) {
    const transactions = this.detail?.transactions || [];
    return `
      <div class="panel inset">
        <div class="panel-body stack">
          <div class="detail-row"><span class="muted">Wallet</span><strong>${escapeHtml(wallet.name || wallet.address || "Wallet")}</strong></div>
          <div class="detail-row"><span class="muted">Address</span><strong>${escapeHtml(wallet.address || "")}</strong></div>
          <div class="detail-row"><span class="muted">Portfolio value</span><strong>${formatCC(wallet.total_value_cc || 0)}</strong></div>
          <div class="detail-row"><span class="muted">Holdings</span><strong>${wallet.tokens?.length || 0}</strong></div>
        </div>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Balances</h3>
            <p class="helper">Visible token balances for this wallet.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="list-stack">
            ${(wallet.tokens || []).length ? wallet.tokens.map((token) => `
              <button class="token-row" data-inline-token="${token.token_id || token.id}" type="button">
                <div class="token-row-main">
                  ${renderTokenAvatar(token)}
                  <div class="stretch">
                    <div class="row space">
                      <strong>${escapeHtml(token.name || token.symbol)}</strong>
                      <span class="chip">${formatCC(token.value_cc || 0)}</span>
                    </div>
                    <div class="token-meta-line">
                      <span>${escapeHtml(token.symbol || "")}</span>
                      <span>${formatDecimal(token.amount || 0, 4)} held</span>
                    </div>
                  </div>
                </div>
              </button>
            `).join("") : `<div class="empty-state"><strong>No balances</strong><span>This wallet does not have visible balances.</span></div>`}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Transactions</h3>
            <p class="helper">Latest transaction records tied to this wallet.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="list-stack">
            ${transactions.length ? transactions.slice(0, 10).map((tx) => `
              <button class="list-item compact" data-inline-tx="${tx.tx_hash || tx.id}" type="button">
                <div class="feed-meta">
                  <strong>${escapeHtml(tx.tx_kind || tx.kind || "transaction")}</strong>
                  <span>${tsToRelative(tx.created_at || tx.ts)}</span>
                </div>
                <div class="feed-body">${escapeHtml(tx.token?.symbol || tx.symbol || "asset")} ${formatDecimal(tx.amount || 0, 4)}</div>
              </button>
            `).join("") : `<div class="empty-state"><strong>No transactions</strong><span>This wallet does not have recent explorer activity.</span></div>`}
          </div>
        </div>
      </section>
    `;
  }

  renderTokenDetail(token) {
    const holders = token.top_holders || [];
    const trades = token.recent_trades || [];
    return `
      <div class="panel inset">
        <div class="panel-body stack">
          <div class="row">
            ${renderTokenAvatar(token)}
            <div class="stack" style="gap:4px;">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="small muted">${escapeHtml(token.symbol || "")}</span>
            </div>
          </div>
          <div class="detail-grid">
            <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
            <div><span class="muted">Market cap</span><strong>${formatCC(token.market_cap_cc || 0)}</strong></div>
            <div><span class="muted">Volume</span><strong>${formatCC(token.volume_cc || 0)}</strong></div>
            <div><span class="muted">24h</span><strong class="${percentClass(token.change_pct)}">${formatSignedPct(token.change_pct || 0)}</strong></div>
          </div>
          <div class="helper">${escapeHtml(token.description || "No token description is available.")}</div>
        </div>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Top holders</h3>
            <p class="helper">Largest visible balances for this token.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="list-stack">
            ${holders.length ? holders.map((holder) => `
              <button class="list-item compact" data-inline-wallet="${holder.wallet?.id || ""}" type="button">
                <div class="feed-meta">
                  <strong>${escapeHtml(holder.wallet?.name || holder.wallet?.address || "Wallet")}</strong>
                  <span>${formatCC(holder.value_cc || 0)}</span>
                </div>
                <div class="feed-body">${formatDecimal(holder.amount || 0, 4)} ${escapeHtml(token.symbol || "")}</div>
              </button>
            `).join("") : `<div class="empty-state"><strong>No holder data</strong><span>Holder detail is not available for this token yet.</span></div>`}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div class="section-copy">
            <h3 class="section-title">Recent token trades</h3>
            <p class="helper">Latest transactions tied to this token.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="list-stack">
            ${trades.length ? trades.map((trade) => `
              <button class="list-item compact" data-inline-tx="${trade.tx_hash || trade.id}" type="button">
                <div class="feed-meta">
                  <strong>${escapeHtml(trade.tx_kind || trade.kind || "trade")}</strong>
                  <span>${tsToRelative(trade.created_at || trade.ts)}</span>
                </div>
                <div class="feed-body">${escapeHtml(trade.user?.display_name || trade.user?.username || "Unknown")} · ${formatDecimal(trade.amount || 0, 4)}</div>
              </button>
            `).join("") : `<div class="empty-state"><strong>No trade history</strong><span>This token does not have recent trade records.</span></div>`}
          </div>
        </div>
      </section>
    `;
  }

  bindDetailActions(node) {
    $$("[data-inline-tx]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "transactions", tx: button.dataset.inlineTx, q: this.query || "" }));
    });
    $$("[data-inline-wallet]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "wallets", wallet: button.dataset.inlineWallet, q: this.query || "" }));
    });
    $$("[data-inline-token]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "tokens", token: button.dataset.inlineToken, q: this.query || "" }));
    });
  }

  subtitleForView(count) {
    if (this.view === "overview") return "Latest blocks and transactions";
    return `${count} ${this.view} loaded`;
  }

  renderInspector() {
    const counts = this.overview?.counts || {};
    const bots = this.overview?.bots || [];
    this.ctx.setInspector({
      title: "Explorer state",
      subtitle: "Current network counts and active bots",
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Blocks</span><strong>${formatCompactNumber(counts.blocks || 0, 0)}</strong></div>
          <div class="detail-row"><span class="muted">Transactions</span><strong>${formatCompactNumber(counts.transactions || 0, 0)}</strong></div>
          <div class="detail-row"><span class="muted">Wallets</span><strong>${formatCompactNumber(counts.wallets || 0, 0)}</strong></div>
          <div class="detail-row"><span class="muted">Tokens</span><strong>${formatCompactNumber(counts.tokens || 0, 0)}</strong></div>
        </div>
        <div class="inspector-card">
          <div class="section-title">Active bots</div>
          ${(bots || []).length ? bots.slice(0, 5).map((bot) => `
            <div class="detail-row">
              <span class="muted">${escapeHtml(bot.user?.display_name || bot.slug)}</span>
              <strong>${escapeHtml(bot.strategy || "-")}</strong>
            </div>
          `).join("") : `<div class="helper">No active bot accounts are visible right now.</div>`}
        </div>
      `,
    });
  }
}
