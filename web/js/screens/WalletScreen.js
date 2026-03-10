import { api, copyToClipboard } from "../net.js";
import {
  $,
  $$,
  createEl,
  escapeHtml,
  formatCC,
  formatDecimal,
  formatSignedPct,
  percentClass,
  renderTokenAvatar,
  tsToLocal,
  tsToRelative,
} from "../ui.js";

export class WalletScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "wallets";
    this.title = "Wallets";
    this.root = null;
    this.wallets = [];
    this.transactions = [];
    this.recentBlocks = [];
    this.summary = null;
    this.stats = null;
    this.selectedWalletId = null;
    this.selectedTokenId = null;
    this.tab = "holdings";
    this.actionPane = "receive";
    this.exchangeKind = "stress_for_coins";
    this.loading = false;
    this.deleting = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel wallet-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Wallets</h2>
          <p>Manage balances, holdings, transfers, and Cortisol Coin flow from the active account set.</p>
        </div>
        <div class="page-actions">
          <label class="inline-select">
            <span>Active wallet</span>
            <select id="walletSelect"></select>
          </label>
          <button id="walletRefreshBtn" class="btn secondary" type="button">Refresh</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Portfolio value</span>
          <strong id="walletPortfolioValue" class="stat-value">0 CC</strong>
          <span id="walletPortfolioNote" class="stat-note">Across all wallets</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Selected wallet</span>
          <strong id="walletSelectedValue" class="stat-value">0 CC</strong>
          <span id="walletSelectedNote" class="stat-note">No wallet selected</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cortisol Coin</span>
          <strong id="walletCCBalance" class="stat-value">0 CC</strong>
          <span id="walletCCNote" class="stat-note">Liquid balance in the active wallet</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Recent account activity</span>
          <strong id="walletActivityCount" class="stat-value">0</strong>
          <span id="walletActivityNote" class="stat-note">Tracked events</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Wallet directory</h3>
              <p class="helper">Switch between wallets, reorder them, and add new storage slots.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="walletList" class="wallet-list list-stack"></div>
            <div class="divider"></div>
            <div class="grid cols-2">
              <label>New wallet name
                <input id="walletCreateName" maxlength="40" placeholder="Market Runner">
              </label>
              <div class="row" style="align-items:end;">
                <button id="walletCreateBtn" class="btn primary" type="button">Create wallet</button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 id="walletDetailTitle" class="section-title">Wallet detail</h3>
              <p id="walletDetailSubtitle" class="helper">Holdings and activity for the selected wallet.</p>
            </div>
            <div class="tabs">
              <button class="tab-btn active" data-wallet-tab="holdings" type="button">Holdings</button>
              <button class="tab-btn" data-wallet-tab="activity" type="button">Activity</button>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="walletHero" class="detail-card"></div>
            <div id="walletMainList" class="list-stack"></div>
          </div>
        </section>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Quick actions</h3>
              <p class="helper">Receive, transfer between wallets, or convert cortisol into CC.</p>
            </div>
            <div class="tabs" id="walletActionTabs"></div>
          </div>
          <div class="panel-body">
            <div id="walletActionPane"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Explorer watch</h3>
              <p class="helper">Recent blocks and account transactions tied to wallet activity.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="walletRecentWatch" class="list-stack"></div>
          </div>
        </section>
      </div>
    `;

    $("#walletRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#walletCreateBtn", this.root).addEventListener("click", () => this.createWalletFromField());
    $("#walletSelect", this.root).addEventListener("change", (event) => {
      this.selectedWalletId = Number(event.target.value || 0) || null;
      this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || this.selectedWallet?.tokens?.[0]?.id || null;
      this.render();
    });
    $$("[data-wallet-tab]", this.root).forEach((button) => {
      button.addEventListener("click", () => {
        this.tab = button.dataset.walletTab;
        this.render();
      });
    });
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Portfolio and account management");
    this.ctx.setGlobalSearchValue("");
    if (route?.params?.wallet) this.selectedWalletId = Number(route.params.wallet || 0) || this.selectedWalletId;
    if (route?.params?.action) {
      const action = route.params.action;
      this.actionPane = action === "send" || action === "swap" ? "transfer" : action;
    }
    await this.load();
  }

  hide() {}

  get selectedWallet() {
    return this.wallets.find((wallet) => Number(wallet.id) === Number(this.selectedWalletId)) || this.wallets[0] || null;
  }

  get selectedToken() {
    return this.selectedWallet?.tokens?.find((token) => Number(token.token_id || token.id) === Number(this.selectedTokenId)) || null;
  }

  async load() {
    this.loading = true;
    if (!this.wallets.length) this.render();
    try {
      const res = await api("/api/wallets");
      this.wallets = res.wallets || [];
      this.transactions = res.transactions || [];
      this.recentBlocks = res.recent_blocks || [];
      this.summary = res.summary || {};
      this.stats = res.stats || this.ctx.me?.stats || {};
      if (!this.selectedWalletId) this.selectedWalletId = res.default_wallet_id || this.wallets[0]?.id || null;
      if (!this.wallets.some((wallet) => Number(wallet.id) === Number(this.selectedWalletId))) {
        this.selectedWalletId = this.wallets[0]?.id || null;
      }
      if (!this.selectedTokenId) {
        this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || this.selectedWallet?.tokens?.[0]?.id || null;
      }
    } catch (error) {
      this.ctx.notify.toast(`Wallet load failed: ${error.message}`, { tone: "error" });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    this.renderWalletSelect();
    this.renderSummary();
    this.renderWalletList();
    this.renderWalletHero();
    this.renderMainContent();
    this.renderActionTabs();
    this.renderActionPane();
    this.renderRecentWatch();
    this.renderInspector();
  }

  renderWalletSelect() {
    const select = $("#walletSelect", this.root);
    if (!this.wallets.length) {
      select.innerHTML = `<option value="">No wallets</option>`;
      return;
    }
    select.innerHTML = this.wallets.map((wallet) => `
      <option value="${wallet.id}" ${Number(wallet.id) === Number(this.selectedWalletId) ? "selected" : ""}>
        ${escapeHtml(wallet.name)}
      </option>
    `).join("");
  }

  renderSummary() {
    const wallet = this.selectedWallet;
    const portfolio = Number(this.summary?.total_value_cc || 0);
    const ccToken = (wallet?.tokens || []).find((token) => token.symbol === "CC");
    $("#walletPortfolioValue", this.root).textContent = formatCC(portfolio);
    $("#walletPortfolioNote", this.root).textContent = `${this.wallets.length || 0} wallet${this.wallets.length === 1 ? "" : "s"} active`;
    $("#walletSelectedValue", this.root).textContent = wallet ? formatCC(wallet.total_value_cc || 0) : "0 CC";
    $("#walletSelectedNote", this.root).textContent = wallet ? wallet.address : "No wallet selected";
    $("#walletCCBalance", this.root).textContent = formatCC(ccToken?.amount || 0, 2);
    $("#walletCCNote", this.root).textContent = wallet ? `${wallet.name} primary balance` : "No wallet selected";
    $("#walletActivityCount", this.root).textContent = formatDecimal(wallet?.activity?.length || 0, 0);
    $("#walletActivityNote", this.root).textContent = `${this.transactions.length || 0} account events tracked`;
  }

  renderWalletList() {
    const node = $("#walletList", this.root);
    if (this.loading && !this.wallets.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!this.wallets.length) {
      node.innerHTML = `<div class="empty-state"><strong>No wallets yet</strong><span>Create the first wallet to start holding assets.</span></div>`;
      return;
    }
    node.innerHTML = this.wallets.map((wallet, index) => `
      <div class="row" style="align-items:stretch;">
        <button class="list-item ${Number(wallet.id) === Number(this.selectedWalletId) ? "active" : ""}" data-select-wallet="${wallet.id}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(wallet.name)}</strong>
            <span>${formatCC(wallet.total_value_cc || 0)}</span>
          </div>
          <div class="feed-body">${escapeHtml(wallet.address)}</div>
          <div class="chip-row">
            <span class="chip">${wallet.tokens?.length || 0} holdings</span>
            <span class="chip">${wallet.activity?.length || 0} activity</span>
          </div>
        </button>
        <div class="col">
          <button class="icon-btn" data-wallet-up="${wallet.id}" type="button" ${index === 0 ? "disabled" : ""}>Up</button>
          <button class="icon-btn" data-wallet-down="${wallet.id}" type="button" ${index === this.wallets.length - 1 ? "disabled" : ""}>Down</button>
        </div>
      </div>
    `).join("");

    $$("[data-select-wallet]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedWalletId = Number(button.dataset.selectWallet);
        this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || this.selectedWallet?.tokens?.[0]?.id || null;
        this.render();
      });
    });
    $$("[data-wallet-up]", node).forEach((button) => {
      button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletUp), -1));
    });
    $$("[data-wallet-down]", node).forEach((button) => {
      button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletDown), 1));
    });
  }

  renderWalletHero() {
    const wallet = this.selectedWallet;
    $("#walletDetailTitle", this.root).textContent = wallet ? wallet.name : "Wallet detail";
    $("#walletDetailSubtitle", this.root).textContent = wallet
      ? `${wallet.address} · ${wallet.tokens?.length || 0} holdings`
      : "Holdings and activity for the selected wallet.";
    const node = $("#walletHero", this.root);
    if (!wallet) {
      node.innerHTML = `<div class="empty-state"><strong>No active wallet</strong><span>Select a wallet from the directory.</span></div>`;
      return;
    }
    const recent = wallet.activity?.[0];
    node.innerHTML = `
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
      <div class="helper">${recent ? `Latest event ${tsToRelative(recent.ts)}` : "No wallet events yet."}</div>
    `;
  }

  renderMainContent() {
    $$("[data-wallet-tab]", this.root).forEach((button) => {
      button.classList.toggle("active", button.dataset.walletTab === this.tab);
    });
    if (this.tab === "activity") this.renderActivity();
    else this.renderHoldings();
  }

  renderHoldings() {
    const node = $("#walletMainList", this.root);
    const wallet = this.selectedWallet;
    const rows = wallet?.tokens || [];
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No holdings</strong><span>This wallet does not contain any visible assets.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((token) => `
      <button class="token-row ${Number(token.token_id || token.id) === Number(this.selectedTokenId) ? "active" : ""}" data-open-wallet-token="${token.token_id || token.id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name || token.symbol)}</strong>
              <span class="chip">${formatCC(token.value_cc || 0)}</span>
            </div>
            <div class="token-meta-line">
              <span>${escapeHtml(token.symbol)}</span>
              <span>${formatDecimal(token.amount || 0, token.symbol === "CC" ? 2 : 4)} held</span>
            </div>
          </div>
        </div>
        <div class="row-trailing">
          <span class="trend-chip ${percentClass(token.change_24h || token.change_pct)}">${formatSignedPct(token.change_24h || token.change_pct || 0)}</span>
        </div>
      </button>
    `).join("");
    $$("[data-open-wallet-token]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedTokenId = Number(button.dataset.openWalletToken);
        this.render();
      });
    });
  }

  renderActivity() {
    const node = $("#walletMainList", this.root);
    const rows = this.selectedWallet?.activity || [];
    if (this.loading && !rows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No activity</strong><span>This wallet does not have recent activity yet.</span></div>`;
      return;
    }
    node.innerHTML = rows.map((row) => `
      <div class="list-item">
        <div class="feed-meta">
          <strong>${escapeHtml(row.kind || "activity")}</strong>
          <span>${tsToLocal(row.ts)}</span>
        </div>
        <div class="feed-body">${escapeHtml(this.activityLine(row))}</div>
      </div>
    `).join("");
  }

  activityLine(row) {
    if (row.meta?.symbol) {
      return `${row.meta.symbol} · ${formatDecimal(row.meta.amount || 0, 4)} · CC ${formatDecimal(row.delta_cc || 0, 2)}`;
    }
    if (row.delta_cortisol || row.delta_cc) {
      return `Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)} · CC ${formatDecimal(row.delta_cc || 0, 2)}`;
    }
    return JSON.stringify(row.meta || {});
  }

  renderActionTabs() {
    const node = $("#walletActionTabs", this.root);
    const tabs = [
      { id: "receive", label: "Receive" },
      { id: "transfer", label: "Transfer" },
      { id: "exchange", label: "CC flow" },
    ];
    node.innerHTML = tabs.map((tab) => `
      <button class="tab-btn ${tab.id === this.actionPane ? "active" : ""}" data-wallet-action="${tab.id}" type="button">${tab.label}</button>
    `).join("");
    $$("[data-wallet-action]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.actionPane = button.dataset.walletAction;
        this.renderActionTabs();
        this.renderActionPane();
      });
    });
  }

  renderActionPane() {
    const wallet = this.selectedWallet;
    const node = $("#walletActionPane", this.root);
    if (!wallet) {
      node.innerHTML = `<div class="empty-state"><strong>No wallet selected</strong><span>Select a wallet to access quick actions.</span></div>`;
      return;
    }
    if (this.actionPane === "receive") {
      node.innerHTML = `
        <div class="detail-card">
          <div class="detail-row"><span class="muted">Wallet address</span><strong class="wallet-address">${escapeHtml(wallet.address)}</strong></div>
          <div class="helper">Share the selected wallet address to receive simulated transfers.</div>
          <button id="walletCopyAddressBtn" class="btn primary" type="button">Copy address</button>
        </div>
      `;
      $("#walletCopyAddressBtn", this.root).addEventListener("click", async () => {
        await copyToClipboard(wallet.address);
        this.ctx.notify.toast("Wallet address copied", { tone: "success" });
      });
      return;
    }
    if (this.actionPane === "transfer") {
      node.innerHTML = `
        <div class="form-stack">
          <label>From wallet
            <select id="walletTransferFrom">
              ${this.wallets.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(wallet.id) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <label>To wallet
            <select id="walletTransferTo">
              ${this.wallets.filter((item) => Number(item.id) !== Number(wallet.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <label>Token
            <select id="walletTransferToken">
              ${(wallet.tokens || []).map((token) => `<option value="${token.token_id || token.id}">${escapeHtml(token.symbol)} (${formatDecimal(token.amount || 0, token.symbol === "CC" ? 2 : 4)})</option>`).join("")}
            </select>
          </label>
          <label>Amount
            <input id="walletTransferAmount" type="number" min="0.000001" step="0.000001" value="1">
          </label>
          <button id="walletTransferBtn" class="btn primary" type="button">Transfer between wallets</button>
        </div>
      `;
      $("#walletTransferBtn", this.root).addEventListener("click", () => this.transferBetweenWallets());
      return;
    }

    const amount = Number($("#walletExchangeAmount", this.root)?.value || 25);
    const preview = this.estimateExchange(amount, wallet);
    node.innerHTML = `
      <div class="form-stack">
        <div class="tabs">
          <button id="walletStressBtn" class="tab-btn ${this.exchangeKind === "stress_for_coins" ? "active" : ""}" type="button">Raise cortisol</button>
          <button id="walletCalmBtn" class="tab-btn ${this.exchangeKind === "coins_for_calm" ? "active" : ""}" type="button">Lower cortisol</button>
        </div>
        <label>Amount
          <input id="walletExchangeAmount" type="number" min="1" max="500" step="1" value="${amount || 25}">
        </label>
        <div class="detail-card">
          <div class="detail-row"><span class="muted">Preview</span><strong>${escapeHtml(preview.summary)}</strong></div>
          <div class="helper">${escapeHtml(preview.detail)}</div>
        </div>
        <button id="walletExchangeSubmitBtn" class="btn primary" type="button">Confirm conversion</button>
      </div>
    `;
    $("#walletStressBtn", this.root).addEventListener("click", () => this.setExchangeKind("stress_for_coins"));
    $("#walletCalmBtn", this.root).addEventListener("click", () => this.setExchangeKind("coins_for_calm"));
    $("#walletExchangeAmount", this.root).addEventListener("input", () => this.renderActionPane());
    $("#walletExchangeSubmitBtn", this.root).addEventListener("click", () => this.submitExchange());
  }

  estimateExchange(amount, wallet) {
    const cortisol = Number(this.stats?.cortisol ?? 1000);
    const ccBalance = Number((wallet?.tokens || []).find((token) => token.symbol === "CC")?.amount || 0);
    const fee = 0.02;
    if (this.exchangeKind === "stress_for_coins") {
      const deltaCortisol = Math.min(amount, Math.max(0, 5000 - cortisol));
      const rate = 0.05 + (cortisol / 20000);
      const deltaCC = Math.floor(deltaCortisol * rate * (1 - fee));
      return {
        summary: `+${deltaCC} CC for +${deltaCortisol} cortisol`,
        detail: `After confirmation: cortisol ${cortisol + deltaCortisol}, CC ${formatDecimal(ccBalance + deltaCC, 2)}, fee ${(fee * 100).toFixed(0)}%`,
      };
    }
    const spend = Math.min(amount, ccBalance);
    const calmPerCoin = 2.4 - Math.min(0.9, cortisol / 6000);
    const deltaCortisol = Math.floor(spend * calmPerCoin * (1 - fee));
    return {
      summary: `-${spend} CC for -${deltaCortisol} cortisol`,
      detail: `After confirmation: cortisol ${Math.max(0, cortisol - deltaCortisol)}, CC ${formatDecimal(ccBalance - spend, 2)}, fee ${(fee * 100).toFixed(0)}%`,
    };
  }

  renderRecentWatch() {
    const node = $("#walletRecentWatch", this.root);
    const blockRows = this.recentBlocks.slice(0, 3);
    const txRows = this.transactions.slice(0, 4);
    if (this.loading && !blockRows.length && !txRows.length) {
      node.innerHTML = `<div class="skeleton-block"></div>`;
      return;
    }
    if (!blockRows.length && !txRows.length) {
      node.innerHTML = `<div class="empty-state"><strong>No watch items</strong><span>Recent blocks and transactions will appear here after activity starts.</span></div>`;
      return;
    }
    node.innerHTML = `
      ${blockRows.map((block) => `
        <button class="list-item compact" data-wallet-block="${block.height}" type="button">
          <div class="feed-meta">
            <strong>Block ${block.height}</strong>
            <span>${tsToRelative(block.created_at || block.ts)}</span>
          </div>
          <div class="feed-body">${block.tx_count || 0} transaction${Number(block.tx_count || 0) === 1 ? "" : "s"}</div>
        </button>
      `).join("")}
      ${txRows.map((row) => `
        <button class="list-item compact" data-wallet-watch-kind="${escapeHtml(row.kind || "")}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(row.kind || "activity")}</strong>
            <span>${tsToRelative(row.ts)}</span>
          </div>
          <div class="feed-body">${escapeHtml(this.activityLine(row))}</div>
        </button>
      `).join("")}
    `;
    $$("[data-wallet-block]", node).forEach((button) => {
      button.addEventListener("click", () => this.ctx.navigate("explorer", { view: "blocks", block: button.dataset.walletBlock }));
    });
  }

  renderInspector() {
    const wallet = this.selectedWallet;
    if (!wallet) {
      this.ctx.clearInspector();
      return;
    }
    const token = this.selectedToken;
    const tokenContent = token ? `
      <div class="inspector-card">
        <div class="row" style="align-items:flex-start;">
          ${renderTokenAvatar(token)}
          <div class="stack" style="gap:4px;">
            <strong>${escapeHtml(token.name || token.symbol)}</strong>
            <span class="small muted">${escapeHtml(token.symbol)}</span>
          </div>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Amount</span><strong>${formatDecimal(token.amount || 0, token.symbol === "CC" ? 2 : 4)}</strong></div>
          <div><span class="muted">Value</span><strong>${formatCC(token.value_cc || 0)}</strong></div>
          <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
          <div><span class="muted">24h</span><strong class="${percentClass(token.change_24h || token.change_pct)}">${formatSignedPct(token.change_24h || token.change_pct || 0)}</strong></div>
        </div>
        <button id="walletInspectorMarketBtn" class="btn secondary" type="button">Open market</button>
      </div>
    ` : `
      <div class="inspector-card">
        <div class="detail-row"><span class="muted">Wallet value</span><strong>${formatCC(wallet.total_value_cc || 0)}</strong></div>
        <div class="detail-row"><span class="muted">Holdings</span><strong>${wallet.tokens?.length || 0}</strong></div>
        <div class="detail-row"><span class="muted">Recent activity</span><strong>${wallet.activity?.length || 0}</strong></div>
      </div>
    `;
    this.ctx.setInspector({
      title: token ? (token.name || token.symbol) : wallet.name,
      subtitle: token ? `${wallet.name} · ${wallet.address}` : wallet.address,
      content: `
        ${tokenContent}
        <div class="inspector-card">
          <div class="section-title">Wallet maintenance</div>
          <label>Name
            <input id="walletRenameInput" maxlength="40" value="${escapeHtml(wallet.name)}">
          </label>
          <button id="walletRenameBtn" class="btn secondary" type="button">Rename wallet</button>
          <label>Transfer holdings before delete
            <select id="walletDeleteTarget">
              ${this.wallets.filter((item) => Number(item.id) !== Number(wallet.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <button id="walletDeleteBtn" class="btn danger" type="button" ${this.wallets.length <= 1 ? "disabled" : ""}>Delete wallet</button>
        </div>
      `,
    });

    const inspectorRoot = document.getElementById("inspectorContent");
    $("#walletInspectorMarketBtn", inspectorRoot)?.addEventListener("click", () => {
      this.ctx.navigate("market", { token: token.token_id || token.id });
    });
    $("#walletRenameBtn", inspectorRoot)?.addEventListener("click", () => this.renameWallet());
    $("#walletDeleteBtn", inspectorRoot)?.addEventListener("click", () => this.deleteWallet());
  }

  setExchangeKind(kind) {
    this.exchangeKind = kind;
    this.renderActionPane();
  }

  async createWalletFromField() {
    const name = ($("#walletCreateName", this.root).value || "").trim() || "New Wallet";
    await api("/api/wallets/create", { method: "POST", json: { name } });
    $("#walletCreateName", this.root).value = "";
    this.ctx.notify.toast("Wallet created", { tone: "success" });
    await this.load();
  }

  async renameWallet() {
    const wallet = this.selectedWallet;
    const inspectorRoot = document.getElementById("inspectorContent");
    if (!wallet || !inspectorRoot) return;
    const name = ($("#walletRenameInput", inspectorRoot).value || "").trim();
    if (!name) return;
    await api("/api/wallets/rename", { method: "POST", json: { wallet_id: wallet.id, name } });
    this.ctx.notify.toast("Wallet renamed", { tone: "success" });
    await this.load();
  }

  async deleteWallet() {
    const wallet = this.selectedWallet;
    const inspectorRoot = document.getElementById("inspectorContent");
    if (!wallet || !inspectorRoot || this.wallets.length <= 1 || this.deleting) return;
    const transferTarget = Number($("#walletDeleteTarget", inspectorRoot)?.value || 0);
    this.deleting = true;
    try {
      await api("/api/wallets/delete", {
        method: "POST",
        json: { wallet_id: wallet.id, transfer_wallet_id: transferTarget || null },
      });
      this.ctx.notify.toast("Wallet deleted", { tone: "success" });
      this.selectedWalletId = null;
      this.selectedTokenId = null;
      await this.load();
    } finally {
      this.deleting = false;
    }
  }

  async reorderWallet(walletId, direction) {
    const ordered = [...this.wallets];
    const index = ordered.findIndex((wallet) => Number(wallet.id) === Number(walletId));
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, item);
    await api("/api/wallets/reorder", {
      method: "POST",
      json: { wallet_ids: ordered.map((wallet) => wallet.id) },
    });
    this.wallets = ordered;
    this.renderWalletList();
    this.renderWalletSelect();
  }

  async transferBetweenWallets() {
    const payload = {
      from_wallet_id: Number($("#walletTransferFrom", this.root).value || 0),
      to_wallet_id: Number($("#walletTransferTo", this.root).value || 0),
      token_id: Number($("#walletTransferToken", this.root).value || 0),
      amount: Number($("#walletTransferAmount", this.root).value || 0),
    };
    await api("/api/wallets/transfer", { method: "POST", json: payload });
    this.ctx.notify.toast("Transfer completed", { tone: "success" });
    await this.load();
  }

  async submitExchange() {
    const wallet = this.selectedWallet;
    if (!wallet) return;
    const amount = Number($("#walletExchangeAmount", this.root).value || 0);
    const res = await api("/api/exchange", {
      method: "POST",
      json: { wallet_id: wallet.id, kind: this.exchangeKind, amount },
    });
    if (res.me) await this.ctx.refreshMe();
    this.ctx.notify.toast("Conversion completed", { tone: "success" });
    await this.load();
  }
}
