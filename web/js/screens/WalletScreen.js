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
} from "../ui.js";

export class WalletScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "wallets";
    this.title = "Wallets";
    this.root = null;
    this.wallets = [];
    this.transactions = [];
    this.stats = null;
    this.selectedWalletId = null;
    this.selectedTokenId = null;
    this.tab = "holdings";
    this.actionPane = "receive";
    this.exchangeKind = "stress_for_coins";
    this.deleting = false;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel wallet-screen" });
    this.root.innerHTML = `
      <div class="hero-card wallet-hero">
        <div class="hero-copy">
          <span class="eyebrow">Wallets</span>
          <h2 class="screen-title">Multi-account command deck</h2>
          <p class="helper">Manage wallet names, holdings, transfers, and Cortisol Coin conversions without leaving the app shell.</p>
        </div>
        <div class="hero-actions hero-actions-wallet">
          <div class="metric-card compact">
            <span class="metric-label">Portfolio Total</span>
            <strong id="walletPortfolioValue" class="metric-value">0 CC</strong>
            <span id="walletPortfolioSub" class="metric-sub">Across all wallets</span>
          </div>
          <button id="walletCreateBtn" class="btn primary" type="button">Create wallet</button>
        </div>
      </div>

      <div class="content-grid content-grid-wallets">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Wallet Directory</h3>
              <p class="helper">Rename, reorder, and retire wallets from here.</p>
            </div>
          </div>
          <div class="card-body col">
            <div id="walletList" class="list wallet-directory"></div>
            <div class="divider"></div>
            <label>New Wallet Name
              <input id="walletCreateName" maxlength="40" placeholder="Market Runner">
            </label>
            <button id="walletCreateSubmit" class="btn secondary" type="button">Create now</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 id="walletDetailTitle" class="section-title">Wallet Detail</h3>
              <p id="walletDetailSub" class="helper">Select a wallet to inspect balances and activity.</p>
            </div>
            <div class="tabs">
              <button class="tab-btn active" data-wallet-tab="holdings" type="button">Holdings</button>
              <button class="tab-btn" data-wallet-tab="activity" type="button">Activity</button>
            </div>
          </div>
          <div class="card-body col">
            <div id="walletManageCard" class="wallet-manage-card"></div>
            <div id="walletMainList" class="list"></div>
            <div id="walletTokenDetail" class="token-detail-panel"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Wallet Actions</h3>
              <p class="helper">Receive, transfer, and convert Cortisol Coin.</p>
            </div>
            <div class="pill-tabs" id="walletActionTabs"></div>
          </div>
          <div class="card-body">
            <div id="walletActionPane"></div>
          </div>
        </div>
      </div>
    `;

    $("#walletCreateBtn", this.root).addEventListener("click", () => this.createWalletFromField());
    $("#walletCreateSubmit", this.root).addEventListener("click", () => this.createWalletFromField());
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
    const res = await api("/api/wallets");
    this.wallets = res.wallets || [];
    this.transactions = res.transactions || [];
    this.stats = res.stats || this.ctx.me?.stats || {};
    if (!this.selectedWalletId) this.selectedWalletId = res.default_wallet_id || this.wallets[0]?.id || null;
    if (!this.wallets.some((wallet) => Number(wallet.id) === Number(this.selectedWalletId))) {
      this.selectedWalletId = this.wallets[0]?.id || null;
    }
    if (!this.selectedTokenId) this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || null;
    this.render();
  }

  render() {
    const wallet = this.selectedWallet;
    const portfolioTotal = this.wallets.reduce((sum, item) => sum + Number(item.total_value_cc || 0), 0);
    $("#walletPortfolioValue", this.root).textContent = formatCC(portfolioTotal);
    $("#walletPortfolioSub", this.root).textContent = `${this.wallets.length || 0} wallet${this.wallets.length === 1 ? "" : "s"} active`;
    $("#walletDetailTitle", this.root).textContent = wallet ? wallet.name : "Wallet Detail";
    $("#walletDetailSub", this.root).textContent = wallet ? wallet.address : "Select a wallet to inspect balances and activity.";
    $$("[data-wallet-tab]", this.root).forEach((button) => button.classList.toggle("active", button.dataset.walletTab === this.tab));
    this.renderWalletList();
    this.renderManageCard(wallet);
    if (this.tab === "holdings") this.renderHoldings(wallet);
    else this.renderActivity(wallet);
    this.renderTokenDetail();
    this.renderActionTabs();
    this.renderActionPane();
  }

  renderWalletList() {
    const node = $("#walletList", this.root);
    if (!this.wallets.length) {
      node.innerHTML = `<div class="empty-state">No wallets available.</div>`;
      return;
    }
    node.innerHTML = this.wallets.map((wallet, index) => `
      <div class="wallet-row ${Number(wallet.id) === Number(this.selectedWalletId) ? "active" : ""}">
        <button class="wallet-row-main" data-select-wallet="${wallet.id}" type="button">
          <div class="feed-meta">
            <strong>${escapeHtml(wallet.name)}</strong>
            <span>${formatCC(wallet.total_value_cc || 0)}</span>
          </div>
          <div class="feed-body">${escapeHtml(wallet.address)}</div>
          <div class="chip-row">
            <span class="chip">${wallet.tokens?.length || 0} assets</span>
            <span class="chip">${wallet.activity?.length || 0} events</span>
          </div>
        </button>
        <div class="wallet-row-actions">
          <button class="icon-btn small" data-wallet-up="${wallet.id}" type="button" ${index === 0 ? "disabled" : ""}>UP</button>
          <button class="icon-btn small" data-wallet-down="${wallet.id}" type="button" ${index === this.wallets.length - 1 ? "disabled" : ""}>DN</button>
        </div>
      </div>
    `).join("");

    $$("[data-select-wallet]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedWalletId = Number(button.dataset.selectWallet);
        this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || null;
        this.render();
      });
    });
    $$("[data-wallet-up]", node).forEach((button) => button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletUp), -1)));
    $$("[data-wallet-down]", node).forEach((button) => button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletDown), 1)));
  }

  renderManageCard(wallet) {
    const node = $("#walletManageCard", this.root);
    if (!wallet) {
      node.innerHTML = `<div class="empty-state">Create a wallet to begin.</div>`;
      return;
    }
    node.innerHTML = `
      <div class="mini-stat-grid">
        <div class="stat-card">
          <span class="metric-label">Wallet Value</span>
          <strong>${formatCC(wallet.total_value_cc || 0)}</strong>
          <span class="muted">${wallet.tokens?.length || 0} visible assets</span>
        </div>
        <div class="stat-card">
          <span class="metric-label">Rename Wallet</span>
          <div class="row">
            <input id="walletRenameInput" value="${escapeHtml(wallet.name)}" maxlength="40">
            <button id="walletRenameBtn" class="btn secondary" type="button">Save</button>
          </div>
        </div>
        <div class="stat-card danger">
          <span class="metric-label">Delete Wallet</span>
          <label class="small">Transfer holdings into
            <select id="walletDeleteTarget">
              ${this.wallets.filter((item) => Number(item.id) !== Number(wallet.id)).map((item) => `
                <option value="${item.id}">${escapeHtml(item.name)}</option>
              `).join("")}
            </select>
          </label>
          <button id="walletDeleteBtn" class="btn danger" type="button" ${this.wallets.length <= 1 ? "disabled" : ""}>Delete wallet</button>
        </div>
      </div>
    `;
    $("#walletRenameBtn", this.root)?.addEventListener("click", () => this.renameWallet());
    $("#walletDeleteBtn", this.root)?.addEventListener("click", () => this.deleteWallet());
  }

  renderHoldings(wallet) {
    const node = $("#walletMainList", this.root);
    if (!wallet?.tokens?.length) {
      node.innerHTML = `<div class="empty-state">No holdings in this wallet.</div>`;
      return;
    }
    node.innerHTML = wallet.tokens.map((token) => `
      <button class="token-row ${Number(token.token_id || token.id) === Number(this.selectedTokenId) ? "active" : ""}" data-open-wallet-token="${token.token_id || token.id}" type="button">
        <div class="token-row-main">
          ${renderTokenAvatar(token)}
          <div class="stretch">
            <div class="row space">
              <strong>${escapeHtml(token.name)}</strong>
              <span class="chip">${formatCC(token.value_cc || 0)}</span>
            </div>
            <div class="tiny muted">${escapeHtml(token.symbol)} | ${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)} held</div>
          </div>
        </div>
        <div class="token-row-side">
          <div class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</div>
        </div>
      </button>
    `).join("");
    $$("[data-open-wallet-token]", node).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedTokenId = Number(button.dataset.openWalletToken);
        this.renderTokenDetail();
        this.renderHoldings(this.selectedWallet);
      });
    });
  }

  renderActivity(wallet) {
    const node = $("#walletMainList", this.root);
    const rows = wallet?.activity || [];
    if (!rows.length) {
      node.innerHTML = `<div class="empty-state">No wallet activity recorded yet.</div>`;
      return;
    }
    node.innerHTML = rows.map((row) => `
      <div class="feed-row">
        <div class="feed-meta">
          <strong>${escapeHtml(row.kind || "activity")}</strong>
          <span>${tsToLocal(row.ts)}</span>
        </div>
        <div class="feed-body">${this.activityLine(row)}</div>
      </div>
    `).join("");
  }

  activityLine(row) {
    if (row.meta?.symbol) {
      return `${escapeHtml(row.meta.symbol)} | ${formatDecimal(row.meta.amount || 0, 4)} | delta ${formatCC(row.delta_cc || 0)}`;
    }
    if (row.delta_cortisol || row.delta_cc) {
      return `Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)} | CC ${formatDecimal(row.delta_cc || 0, 2)}`;
    }
    return escapeHtml(JSON.stringify(row.meta || {}));
  }

  renderTokenDetail() {
    const node = $("#walletTokenDetail", this.root);
    const token = this.selectedToken;
    if (!token) {
      node.innerHTML = "";
      return;
    }
    node.innerHTML = `
      <div class="token-detail-card">
        <div class="row space">
          <div class="row">
            ${renderTokenAvatar(token)}
            <div class="col" style="gap:4px;">
              <strong>${escapeHtml(token.name)}</strong>
              <span class="muted">${escapeHtml(token.symbol)}</span>
            </div>
          </div>
          <button class="btn ghost" id="walletOpenMarketBtn" type="button">Open market</button>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Amount</span><strong>${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)}</strong></div>
          <div><span class="muted">Value</span><strong>${formatCC(token.value_cc || 0)}</strong></div>
          <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
          <div><span class="muted">24h</span><strong class="${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || 0)}</strong></div>
        </div>
        <p class="helper">${escapeHtml(token.description || "No token description available.")}</p>
      </div>
    `;
    $("#walletOpenMarketBtn", this.root)?.addEventListener("click", () => this.ctx.navigate("market", { token: token.token_id || token.id }));
  }

  renderActionTabs() {
    const tabs = $("#walletActionTabs", this.root);
    const options = [
      { id: "receive", label: "Receive" },
      { id: "transfer", label: "Transfer" },
      { id: "exchange", label: "CC Flow" },
    ];
    tabs.innerHTML = options.map((option) => `
      <button class="pill-tab ${option.id === this.actionPane ? "active" : ""}" data-wallet-action-tab="${option.id}" type="button">${option.label}</button>
    `).join("");
    $$("[data-wallet-action-tab]", tabs).forEach((button) => {
      button.addEventListener("click", () => {
        this.actionPane = button.dataset.walletActionTab;
        this.renderActionTabs();
        this.renderActionPane();
      });
    });
  }

  renderActionPane() {
    const node = $("#walletActionPane", this.root);
    const wallet = this.selectedWallet;
    if (!wallet) {
      node.innerHTML = `<div class="empty-state">No wallet selected.</div>`;
      return;
    }
    if (this.actionPane === "receive") {
      node.innerHTML = `
        <div class="detail-stack">
          <div class="stat-card">
            <span class="metric-label">Selected Address</span>
            <strong class="wallet-address">${escapeHtml(wallet.address)}</strong>
            <span class="muted">Share this address to receive simulated transfers.</span>
          </div>
          <button id="walletCopyAddressBtn" class="btn secondary" type="button">Copy address</button>
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
        <div class="detail-stack">
          <label>From Wallet
            <select id="walletTransferFrom">
              ${this.wallets.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(wallet.id) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <label>To Wallet
            <select id="walletTransferTo">
              ${this.wallets.filter((item) => Number(item.id) !== Number(wallet.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <label>Token
            <select id="walletTransferToken">
              ${(wallet.tokens || []).map((token) => `<option value="${token.token_id || token.id}">${escapeHtml(token.symbol)} (${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)})</option>`).join("")}
            </select>
          </label>
          <label>Amount
            <input id="walletTransferAmount" type="number" min="0.000001" step="0.000001" value="1">
          </label>
          <button id="walletTransferBtn" class="btn primary" type="button">Transfer</button>
        </div>
      `;
      $("#walletTransferBtn", this.root).addEventListener("click", () => this.transferBetweenWallets());
      return;
    }
    node.innerHTML = this.renderExchangePane(wallet);
    $("#walletModeStressBtn", this.root).addEventListener("click", () => this.setExchangeKind("stress_for_coins"));
    $("#walletModeCalmBtn", this.root).addEventListener("click", () => this.setExchangeKind("coins_for_calm"));
    $("#walletExchangeAmount", this.root).addEventListener("input", () => this.renderActionPane());
    $("#walletExchangeSubmitBtn", this.root).addEventListener("click", () => this.submitExchange());
  }

  renderExchangePane(wallet) {
    const amount = Number($("#walletExchangeAmount", this.root)?.value || 25);
    const preview = this.estimateExchange(amount, wallet);
    const recentConversions = this.transactions.filter((row) => row.kind === "cortisol_exchange").slice(0, 4);
    return `
      <div class="detail-stack">
        <div class="pill-tabs">
          <button id="walletModeStressBtn" class="pill-tab ${this.exchangeKind === "stress_for_coins" ? "active" : ""}" type="button">Raise cortisol</button>
          <button id="walletModeCalmBtn" class="pill-tab ${this.exchangeKind === "coins_for_calm" ? "active" : ""}" type="button">Lower cortisol</button>
        </div>
        <label>Amount
          <input id="walletExchangeAmount" type="number" min="1" max="500" step="1" value="${amount || 25}">
        </label>
        <div class="stat-card">
          <span class="metric-label">Preview</span>
          <strong>${preview.summary}</strong>
          <span class="muted">${preview.detail}</span>
        </div>
        <button id="walletExchangeSubmitBtn" class="btn primary" type="button">Confirm conversion</button>
        <div class="detail-section">
          <h4>Recent conversions</h4>
          <div class="list">
            ${recentConversions.length ? recentConversions.map((row) => `
              <div class="feed-row">
                <div class="feed-meta"><strong>${escapeHtml(row.meta?.kind || row.kind)}</strong><span>${tsToLocal(row.ts)}</span></div>
                <div class="feed-body">${escapeHtml(`CC ${formatDecimal(row.delta_cc || 0, 2)} | Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)}`)}</div>
              </div>
            `).join("") : `<div class="empty-state">No conversions yet.</div>`}
          </div>
        </div>
      </div>
    `;
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
    if (!wallet) return;
    const name = ($("#walletRenameInput", this.root).value || "").trim();
    if (!name) return;
    await api("/api/wallets/rename", { method: "POST", json: { wallet_id: wallet.id, name } });
    this.ctx.notify.toast("Wallet renamed", { tone: "success" });
    await this.load();
  }

  async deleteWallet() {
    const wallet = this.selectedWallet;
    if (!wallet || this.wallets.length <= 1 || this.deleting) return;
    const transferTarget = Number($("#walletDeleteTarget", this.root)?.value || 0);
    this.deleting = true;
    try {
      await api("/api/wallets/delete", {
        method: "POST",
        json: { wallet_id: wallet.id, transfer_wallet_id: transferTarget || null },
      });
      this.ctx.notify.toast("Wallet deleted", { tone: "success" });
      this.selectedWalletId = null;
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
