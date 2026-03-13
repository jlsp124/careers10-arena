import { api, copyToClipboard } from "../net.js";
import { $, $$, createEl, escapeHtml, formatCC, formatDecimal, formatSignedPct, iconSprite, initials, percentClass, renderTokenAvatar, tsToLocal } from "../ui.js";

function shortAddress(value, lead = 8, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= lead + tail + 3) return text;
  return `${text.slice(0, lead)}...${text.slice(-tail)}`;
}

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
    this.timer = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel wallet-screen" });
    this.root.innerHTML = `
      <header class="page-shell-header wallet-page-header">
        <div class="page-shell-copy">
          <span class="page-shell-kicker">Wallets</span>
          <div class="page-shell-title-row">
            <h2 class="page-shell-title">Portfolio cockpit</h2>
            <span class="page-shell-chip">Desktop wallet workspace</span>
          </div>
          <p class="page-shell-subtitle">Run multiple wallets, move balances, manage pool ownership, and convert cortisol into Cortisol Coin from a tighter, desktop-style control surface.</p>
        </div>
        <div class="page-shell-actions wallet-page-actions">
          <label class="page-header-field">
            <span>New wallet</span>
            <input id="walletCreateName" maxlength="40" placeholder="Market Runner">
          </label>
          <button id="walletCreateBtn" class="btn primary" type="button">Create wallet</button>
        </div>
      </header>

      <div class="wallet-summary-strip">
        <div class="wallet-summary-card wallet-summary-card-primary">
          <span class="wallet-summary-label">Portfolio total</span>
          <strong id="walletPortfolioValue" class="wallet-summary-value">0 CC</strong>
          <span id="walletPortfolioSub" class="wallet-summary-note">Across all wallets</span>
        </div>
        <div class="wallet-summary-card">
          <span class="wallet-summary-label">Active wallets</span>
          <strong id="walletActiveCount" class="wallet-summary-value">0</strong>
          <span id="walletActiveSub" class="wallet-summary-note">Wallet stack</span>
        </div>
        <div class="wallet-summary-card">
          <span class="wallet-summary-label">Focus wallet</span>
          <strong id="walletFocusValue" class="wallet-summary-value">0 CC</strong>
          <span id="walletFocusSub" class="wallet-summary-note">Select a wallet</span>
        </div>
        <div class="wallet-summary-card">
          <span class="wallet-summary-label">Cortisol</span>
          <strong id="walletCortisolValue" class="wallet-summary-value">0</strong>
          <span id="walletCortisolSub" class="wallet-summary-note">Exchange pressure</span>
        </div>
      </div>

      <div class="wallet-shell-grid">
        <div class="card wallet-directory-card">
          <div class="card-header wallet-card-header">
            <div>
              <h3 class="section-title">Wallet directory</h3>
              <p class="helper">Choose the active wallet and keep the stack ordered.</p>
            </div>
          </div>
          <div class="card-body col wallet-directory-body">
            <div id="walletList" class="list wallet-directory"></div>
          </div>
        </div>

        <div class="card wallet-detail-card">
          <div class="card-header wallet-card-header">
            <div>
              <h3 id="walletDetailTitle" class="section-title">Wallet overview</h3>
              <p id="walletDetailSub" class="helper">Select a wallet to inspect balances, LP shares, and activity.</p>
            </div>
            <div class="tabs">
              <button class="tab-btn active" data-wallet-tab="holdings" type="button">Holdings</button>
              <button class="tab-btn" data-wallet-tab="activity" type="button">Activity</button>
            </div>
          </div>
          <div class="card-body col wallet-detail-body">
            <div id="walletManageCard" class="wallet-manage-card"></div>
            <div id="walletMainList" class="list wallet-main-list"></div>
            <div id="walletTokenDetail" class="token-detail-panel"></div>
          </div>
        </div>

        <div class="card wallet-actions-card">
          <div class="card-header wallet-card-header">
            <div>
              <h3 class="section-title">Action center</h3>
              <p class="helper">Receive, send, move funds internally, or route cortisol through the exchange.</p>
            </div>
            <div class="pill-tabs wallet-action-tabs" id="walletActionTabs"></div>
          </div>
          <div class="card-body wallet-actions-body">
            <div id="walletActionPane" class="wallet-action-pane"></div>
          </div>
        </div>
      </div>
    `;
    $("#walletCreateBtn", this.root).addEventListener("click", () => this.createWalletFromField());
    $$("[data-wallet-tab]", this.root).forEach((button) => button.addEventListener("click", () => {
      this.tab = button.dataset.walletTab;
      this.render();
    }));
    return this.root;
  }

  async show(route) {
    if (this.timer) clearInterval(this.timer);
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Portfolio and account management");
    if (route?.params?.wallet) this.selectedWalletId = Number(route.params.wallet || 0) || this.selectedWalletId;
    if (route?.params?.action) {
      const action = String(route.params.action || "").toLowerCase();
      this.actionPane = action === "swap" ? "exchange" : (action === "send" ? "send" : action);
    }
    await this.load();
    this.timer = setInterval(() => this.load({ silent: true }), 7000);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get selectedWallet() {
    return this.wallets.find((wallet) => Number(wallet.id) === Number(this.selectedWalletId)) || this.wallets[0] || null;
  }

  get selectedToken() {
    return this.selectedWallet?.tokens?.find((token) => Number(token.token_id || token.id) === Number(this.selectedTokenId)) || null;
  }

  async load({ silent = false } = {}) {
    if (!silent) this.ctx.setScreenLoading("Loading wallets...", true);
    try {
      const res = await api("/api/wallets");
      this.wallets = res.wallets || [];
      this.transactions = res.transactions || [];
      this.stats = res.stats || this.ctx.me?.stats || {};
      if (!this.selectedWalletId) this.selectedWalletId = res.default_wallet_id || this.wallets[0]?.id || null;
      if (!this.wallets.some((wallet) => Number(wallet.id) === Number(this.selectedWalletId))) this.selectedWalletId = this.wallets[0]?.id || null;
      if (!this.selectedTokenId || !this.selectedWallet?.tokens?.some((token) => Number(token.token_id || token.id) === Number(this.selectedTokenId))) {
        this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || null;
      }
      this.render();
    } finally {
      if (!silent) this.ctx.setScreenLoading("", false);
    }
  }

  render() {
    const wallet = this.selectedWallet;
    const portfolioTotal = this.wallets.reduce((sum, item) => sum + Number(item.total_value_cc || 0), 0);
    const walletCount = this.wallets.length || 0;
    const cortisol = Number(this.stats?.cortisol ?? this.ctx.me?.stats?.cortisol ?? 0);
    $("#walletPortfolioValue", this.root).textContent = formatCC(portfolioTotal);
    $("#walletPortfolioSub", this.root).textContent = `${walletCount} wallet${walletCount === 1 ? "" : "s"} linked`;
    $("#walletActiveCount", this.root).textContent = String(walletCount);
    $("#walletActiveSub", this.root).textContent = wallet ? `Selected: ${wallet.name}` : "No wallet selected";
    $("#walletFocusValue", this.root).textContent = wallet ? formatCC(wallet.total_value_cc || 0) : "0 CC";
    $("#walletFocusSub", this.root).textContent = wallet
      ? `${wallet.tokens?.length || 0} assets | ${shortAddress(wallet.address)}`
      : "Select a wallet to inspect it";
    $("#walletCortisolValue", this.root).textContent = formatDecimal(cortisol, 0);
    $("#walletCortisolSub", this.root).textContent = "Live exchange pressure";
    $("#walletDetailTitle", this.root).textContent = wallet ? wallet.name : "Wallet overview";
    $("#walletDetailSub", this.root).textContent = wallet ? wallet.address : "Select a wallet to inspect balances and activity.";
    $$("[data-wallet-tab]", this.root).forEach((button) => button.classList.toggle("active", button.dataset.walletTab === this.tab));
    this.renderWalletList();
    this.renderManageCard(wallet);
    if (this.tab === "holdings") this.renderHoldings(wallet); else this.renderActivity(wallet);
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
          <div class="wallet-row-head">
            <div class="wallet-row-avatar">${escapeHtml(initials(wallet.name, "WL"))}</div>
            <div class="stretch wallet-row-copy">
              <div class="feed-meta"><strong>${escapeHtml(wallet.name)}</strong><span class="wallet-row-value">${formatCC(wallet.total_value_cc || 0)}</span></div>
              <div class="feed-body wallet-row-address">${escapeHtml(shortAddress(wallet.address))}</div>
              <div class="chip-row">
                <span class="chip">${wallet.tokens?.length || 0} assets</span>
                <span class="chip">${wallet.liquidity_positions?.length || 0} LP</span>
                <span class="chip">${wallet.activity?.length || 0} events</span>
              </div>
            </div>
          </div>
        </button>
        <div class="wallet-row-actions">
          <button class="icon-btn small wallet-sort-btn" data-wallet-up="${wallet.id}" type="button" aria-label="Move wallet up" title="Move wallet up" ${index === 0 ? "disabled" : ""}>${iconSprite("chevron-up")}</button>
          <button class="icon-btn small wallet-sort-btn" data-wallet-down="${wallet.id}" type="button" aria-label="Move wallet down" title="Move wallet down" ${index === this.wallets.length - 1 ? "disabled" : ""}>${iconSprite("chevron-down")}</button>
        </div>
      </div>
    `).join("");
    $$("[data-select-wallet]", node).forEach((button) => button.addEventListener("click", () => {
      this.selectedWalletId = Number(button.dataset.selectWallet);
      this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || null;
      this.render();
    }));
    $$("[data-wallet-up]", node).forEach((button) => button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletUp), -1)));
    $$("[data-wallet-down]", node).forEach((button) => button.addEventListener("click", () => this.reorderWallet(Number(button.dataset.walletDown), 1)));
  }

  renderManageCard(wallet) {
    const node = $("#walletManageCard", this.root);
    if (!wallet) {
      node.innerHTML = `<div class="empty-state">Create a wallet to begin.</div>`;
      return;
    }
    const lp = (wallet.liquidity_positions || []).slice(0, 4);
    node.innerHTML = `
      <div class="wallet-control-grid">
        <div class="wallet-control-panel wallet-control-panel-primary">
          <span class="wallet-control-label">Wallet value</span>
          <strong>${formatCC(wallet.total_value_cc || 0)}</strong>
          <span class="wallet-control-note">${wallet.tokens?.length || 0} assets | ${wallet.liquidity_positions?.length || 0} LP positions</span>
        </div>
        <div class="wallet-control-panel">
          <span class="wallet-control-label">Rename wallet</span>
          <div class="wallet-inline-form">
            <label class="wallet-inline-label stretch">Name
              <input id="walletRenameInput" value="${escapeHtml(wallet.name)}" maxlength="40">
            </label>
            <button id="walletRenameBtn" class="btn secondary" type="button">Save</button>
          </div>
        </div>
        <div class="wallet-control-panel">
          <span class="wallet-control-label">LP exposure</span>
          <div class="wallet-badge-strip">${lp.length ? lp.map((item) => `<span class="chip">${escapeHtml(item.symbol)} ${formatDecimal(item.share_pct || 0, 2)}%</span>`).join("") : `<span class="wallet-control-note">No active pool shares</span>`}</div>
        </div>
        <div class="wallet-control-panel danger">
          <span class="wallet-control-label">Retire wallet</span>
          <label class="wallet-inline-label">Move balances into
            <select id="walletDeleteTarget">${this.wallets.filter((item) => Number(item.id) !== Number(wallet.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select>
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
            <div class="row space"><strong>${escapeHtml(token.name)}</strong><span class="chip">${formatCC(token.value_cc || 0)}</span></div>
            <div class="tiny muted">${escapeHtml(token.symbol)} | ${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)} held</div>
          </div>
        </div>
        <div class="token-row-side"><div class="trend-chip ${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || token.change_pct || 0)}</div></div>
      </button>
    `).join("");
    $$("[data-open-wallet-token]", node).forEach((button) => button.addEventListener("click", () => {
      this.selectedTokenId = Number(button.dataset.openWalletToken);
      this.renderTokenDetail();
      this.renderHoldings(this.selectedWallet);
    }));
  }

  renderActivity(wallet) {
    const node = $("#walletMainList", this.root);
    const rows = wallet?.activity || [];
    node.innerHTML = rows.length ? rows.map((row) => `
      <div class="feed-row">
        <div class="feed-meta"><strong>${escapeHtml(row.kind || "activity")}</strong><span>${tsToLocal(row.ts)}</span></div>
        <div class="feed-body">${this.activityLine(row)}</div>
      </div>
    `).join("") : `<div class="empty-state">No wallet activity recorded yet.</div>`;
  }

  activityLine(row) {
    if (row.meta?.event_label) return escapeHtml(row.meta.event_label);
    if (row.meta?.symbol && row.meta?.amount) return `${escapeHtml(row.meta.symbol)} | ${formatDecimal(row.meta.amount || 0, 4)} | ${formatCC(row.meta.cc_amount || row.meta.fee_cc || row.delta_cc || 0, 2)}`;
    if (row.meta?.from_wallet_id || row.meta?.to_wallet_id) return `Wallet transfer | ${formatDecimal(row.meta.amount || 0, 4)} ${escapeHtml(row.meta.symbol || "asset")}`;
    if (row.delta_cortisol || row.delta_cc) return `Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)} | CC ${formatDecimal(row.delta_cc || 0, 2)}`;
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
        <div class="detail-hero wallet-token-detail-hero">
          <div class="row wallet-token-detail-head">${renderTokenAvatar(token)}<div class="col wallet-token-detail-copy"><strong>${escapeHtml(token.name)}</strong><span class="muted">${escapeHtml(token.symbol)}</span></div></div>
          <button class="btn ghost" id="walletOpenMarketBtn" type="button">Open market</button>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Amount</span><strong>${formatDecimal(token.amount, token.symbol === "CC" ? 2 : 4)}</strong></div>
          <div><span class="muted">Value</span><strong>${formatCC(token.value_cc || 0)}</strong></div>
          <div><span class="muted">Price</span><strong>${formatCC(token.price || 0, 4)}</strong></div>
          <div><span class="muted">Move</span><strong class="${percentClass(token.change_24h)}">${formatSignedPct(token.change_24h || token.change_pct || 0)}</strong></div>
        </div>
        <p class="helper">${escapeHtml(token.description || "No token description available.")}</p>
      </div>
    `;
    $("#walletOpenMarketBtn", this.root)?.addEventListener("click", () => this.ctx.navigate("market", { token: token.token_id || token.id }));
  }

  renderActionTabs() {
    const tabs = $("#walletActionTabs", this.root);
    const options = [["receive", "Receive"], ["send", "Send"], ["transfer", "Internal"], ["exchange", "CC Flow"]];
    tabs.innerHTML = options.map(([id, label]) => `<button class="pill-tab ${id === this.actionPane ? "active" : ""}" data-wallet-action-tab="${id}" type="button">${label}</button>`).join("");
    $$("[data-wallet-action-tab]", tabs).forEach((button) => button.addEventListener("click", () => {
      this.actionPane = button.dataset.walletActionTab;
      this.renderActionTabs();
      this.renderActionPane();
    }));
  }

  renderActionPane() {
    const node = $("#walletActionPane", this.root);
    const wallet = this.selectedWallet;
    if (!wallet) {
      node.innerHTML = `<div class="empty-state">No wallet selected.</div>`;
      return;
    }
    if (this.actionPane === "receive") {
      node.innerHTML = `<div class="detail-stack"><div class="stat-card"><span class="metric-label">Selected Address</span><strong class="wallet-address">${escapeHtml(wallet.address)}</strong><span class="muted">Share this address to receive simulated transfers from other in-app wallets.</span></div><button id="walletCopyAddressBtn" class="btn secondary" type="button">Copy address</button></div>`;
      $("#walletCopyAddressBtn", this.root).addEventListener("click", async () => {
        await copyToClipboard(wallet.address);
        this.ctx.notify.toast("Wallet address copied", { tone: "success" });
      });
      return;
    }
    if (this.actionPane === "send") {
      this.renderSendPane(node, wallet);
      return;
    }
    if (this.actionPane === "transfer") {
      this.renderInternalPane(node, wallet);
      return;
    }
    this.renderExchangePane(node, wallet);
  }

  renderSendPane(node, wallet) {
    const token = this.selectedToken || wallet.tokens?.[0];
    const tokenId = Number($("#walletSendToken", this.root)?.value || token?.token_id || 0);
    const amount = Number($("#walletSendAmount", this.root)?.value || 0);
    const toAddress = ($("#walletSendAddress", this.root)?.value || "").trim();
    const preview = this.buildPreview(wallet, tokenId, amount, null, toAddress);
    node.innerHTML = `
      <div class="detail-stack">
        <label>From Wallet<select id="walletSendFrom">${this.wallets.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(wallet.id) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
        <label>Destination Address<input id="walletSendAddress" value="${escapeHtml(toAddress)}" placeholder="ca_xxxxx"></label>
        <label>Token<select id="walletSendToken">${(wallet.tokens || []).map((item) => `<option value="${item.token_id || item.id}" ${Number(item.token_id || item.id) === tokenId ? "selected" : ""}>${escapeHtml(item.symbol)} (${formatDecimal(item.amount, item.symbol === "CC" ? 2 : 4)})</option>`).join("")}</select></label>
        <div class="amount-with-max"><label class="stretch">Amount<input id="walletSendAmount" type="number" min="0.000001" step="0.000001" value="${amount || ""}"></label><button id="walletSendMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${preview.title}</strong><span class="muted">${preview.detail}</span></div>
        <button id="walletSendBtn" class="btn primary" type="button">Send now</button>
      </div>
    `;
    $("#walletSendFrom", this.root).addEventListener("change", (event) => {
      this.selectedWalletId = Number(event.target.value || 0) || this.selectedWalletId;
      this.selectedTokenId = this.selectedWallet?.tokens?.[0]?.token_id || null;
      this.render();
    });
    ["walletSendAddress", "walletSendToken", "walletSendAmount"].forEach((id) => $("#" + id, this.root).addEventListener("input", () => this.renderActionPane()));
    $("#walletSendMaxBtn", this.root).addEventListener("click", () => this.fillMax("walletSendToken", "walletSendAmount", wallet));
    $("#walletSendBtn", this.root).addEventListener("click", () => this.sendToAddress());
  }

  renderInternalPane(node, wallet) {
    const fromWalletId = Number($("#walletTransferFrom", this.root)?.value || wallet.id);
    const fromWallet = this.wallets.find((item) => Number(item.id) === fromWalletId) || wallet;
    const tokenId = Number($("#walletTransferToken", this.root)?.value || fromWallet.tokens?.[0]?.token_id || 0);
    const amount = Number($("#walletTransferAmount", this.root)?.value || 0);
    const toWalletId = Number($("#walletTransferTo", this.root)?.value || this.wallets.find((item) => Number(item.id) !== Number(fromWallet.id))?.id || 0);
    const preview = this.buildPreview(fromWallet, tokenId, amount, toWalletId);
    node.innerHTML = `
      <div class="detail-stack">
        <label>From Wallet<select id="walletTransferFrom">${this.wallets.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(fromWallet.id) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
        <label>To Wallet<select id="walletTransferTo">${this.wallets.filter((item) => Number(item.id) !== Number(fromWallet.id)).map((item) => `<option value="${item.id}" ${Number(item.id) === Number(toWalletId) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
        <label>Token<select id="walletTransferToken">${(fromWallet.tokens || []).map((item) => `<option value="${item.token_id || item.id}" ${Number(item.token_id || item.id) === tokenId ? "selected" : ""}>${escapeHtml(item.symbol)} (${formatDecimal(item.amount, item.symbol === "CC" ? 2 : 4)})</option>`).join("")}</select></label>
        <div class="amount-with-max"><label class="stretch">Amount<input id="walletTransferAmount" type="number" min="0.000001" step="0.000001" value="${amount || ""}"></label><button id="walletTransferMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${preview.title}</strong><span class="muted">${preview.detail}</span></div>
        <button id="walletTransferBtn" class="btn primary" type="button">Transfer now</button>
      </div>
    `;
    ["walletTransferFrom", "walletTransferTo", "walletTransferToken", "walletTransferAmount"].forEach((id) => $("#" + id, this.root).addEventListener("input", () => this.renderActionPane()));
    $("#walletTransferMaxBtn", this.root).addEventListener("click", () => this.fillMax("walletTransferToken", "walletTransferAmount", fromWallet));
    $("#walletTransferBtn", this.root).addEventListener("click", () => this.transferBetweenWallets());
  }

  renderExchangePane(node, wallet) {
    const amount = Number($("#walletExchangeAmount", this.root)?.value || 25);
    const preview = this.estimateExchange(amount, wallet);
    const recent = this.transactions.filter((row) => row.kind === "cortisol_exchange").slice(0, 5);
    node.innerHTML = `
      <div class="detail-stack">
        <div class="pill-tabs">
          <button id="walletModeStressBtn" class="pill-tab ${this.exchangeKind === "stress_for_coins" ? "active" : ""}" type="button">Raise cortisol</button>
          <button id="walletModeCalmBtn" class="pill-tab ${this.exchangeKind === "coins_for_calm" ? "active" : ""}" type="button">Lower cortisol</button>
        </div>
        <div class="amount-with-max"><label class="stretch">Amount<input id="walletExchangeAmount" type="number" min="1" max="500" step="1" value="${amount || 25}"></label><button id="walletExchangeMaxBtn" class="btn ghost" type="button">Max</button></div>
        <div class="stat-card"><span class="metric-label">Preview</span><strong>${preview.summary}</strong><span class="muted">${preview.detail}</span></div>
        <button id="walletExchangeSubmitBtn" class="btn primary" type="button">Confirm conversion</button>
        <div class="detail-section"><h4>Recent conversions</h4><div class="list">${recent.length ? recent.map((row) => `<div class="feed-row"><div class="feed-meta"><strong>${escapeHtml(row.meta?.kind || row.kind)}</strong><span>${tsToLocal(row.ts)}</span></div><div class="feed-body">${escapeHtml(`CC ${formatDecimal(row.delta_cc || 0, 2)} | Cortisol ${formatDecimal(row.delta_cortisol || 0, 0)}`)}</div></div>`).join("") : `<div class="empty-state">No conversions yet.</div>`}</div></div>
      </div>
    `;
    $("#walletModeStressBtn", this.root).addEventListener("click", () => this.setExchangeKind("stress_for_coins"));
    $("#walletModeCalmBtn", this.root).addEventListener("click", () => this.setExchangeKind("coins_for_calm"));
    $("#walletExchangeAmount", this.root).addEventListener("input", () => this.renderActionPane());
    $("#walletExchangeMaxBtn", this.root).addEventListener("click", () => this.setExchangeMax(wallet));
    $("#walletExchangeSubmitBtn", this.root).addEventListener("click", () => this.submitExchange());
  }

  buildPreview(wallet, tokenId, amount, toWalletId = null, toAddress = "") {
    const token = (wallet?.tokens || []).find((item) => Number(item.token_id || item.id) === Number(tokenId)) || wallet?.tokens?.[0];
    if (!token) return { title: "No token selected", detail: "Pick a token first." };
    const balance = Number(token.amount || 0);
    const sendAmount = Math.max(0, Math.min(balance, Number(amount || 0)));
    if (sendAmount <= 0) return { title: `Available ${formatDecimal(balance, token.symbol === "CC" ? 2 : 4)} ${token.symbol}`, detail: "Enter an amount to preview the transfer." };
    const destination = this.wallets.find((item) => Number(item.id) === Number(toWalletId))?.name || toAddress || "destination";
    return {
      title: `${formatDecimal(sendAmount, token.symbol === "CC" ? 2 : 4)} ${token.symbol} -> ${destination}`,
      detail: `Sender after: ${formatDecimal(balance - sendAmount, token.symbol === "CC" ? 2 : 4)} ${token.symbol} | Est. value ${formatCC((token.price || 0) * sendAmount, 2)}`,
    };
  }

  estimateExchange(amount, wallet) {
    const cortisol = Number(this.stats?.cortisol ?? 1000);
    const ccBalance = Number((wallet?.tokens || []).find((token) => token.symbol === "CC")?.amount || 0);
    const recentPressure = this.transactions
      .filter((row) => row.kind === "cortisol_exchange" && Number(row.ts || 0) >= ((Date.now() / 1000) - 3600))
      .reduce((sum, row) => sum + Math.abs(Number(row.delta_cc || 0)), 0);
    const spread = Math.min(0.14, 0.03 + Math.min(0.035, recentPressure / 1200) + Math.max(0, (cortisol - 1100) / 12000));
    if (this.exchangeKind === "stress_for_coins") {
      const deltaCortisol = Math.min(amount, Math.max(0, 5000 - cortisol));
      const rate = 0.028 + (Math.sqrt(Math.max(25, cortisol)) / 520);
      const deltaCC = Math.floor(deltaCortisol * rate * (1 - spread));
      return { summary: `+${deltaCC} CC for +${deltaCortisol} cortisol`, detail: `After confirmation: cortisol ${cortisol + deltaCortisol}, CC ${formatDecimal(ccBalance + deltaCC, 2)}, spread ${(spread * 100).toFixed(1)}%` };
    }
    const spend = Math.min(amount, ccBalance);
    const calmPerCoin = 1.55 - Math.min(0.55, cortisol / 5200);
    const deltaCortisol = Math.floor(spend * calmPerCoin * (1 - spread));
    return { summary: `-${spend} CC for -${deltaCortisol} cortisol`, detail: `After confirmation: cortisol ${Math.max(0, cortisol - deltaCortisol)}, CC ${formatDecimal(ccBalance - spend, 2)}, spread ${(spread * 100).toFixed(1)}%` };
  }

  setExchangeKind(kind) { this.exchangeKind = kind; this.renderActionPane(); }

  setExchangeMax(wallet) {
    const ccBalance = Number((wallet?.tokens || []).find((token) => token.symbol === "CC")?.amount || 0);
    $("#walletExchangeAmount", this.root).value = String(
      this.exchangeKind === "stress_for_coins"
        ? Math.min(500, Math.max(1, 5000 - Number(this.stats?.cortisol ?? 1000)))
        : Math.min(500, Math.max(1, Math.floor(ccBalance))),
    );
    this.renderActionPane();
  }

  fillMax(tokenSelectId, amountInputId, wallet = null) {
    const sourceWallet = wallet || this.selectedWallet;
    const tokenId = Number($("#" + tokenSelectId, this.root).value || 0);
    const token = (sourceWallet?.tokens || []).find((item) => Number(item.token_id || item.id) === Number(tokenId));
    $("#" + amountInputId, this.root).value = token ? String(token.amount) : "0";
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
    const name = ($("#walletRenameInput", this.root).value || "").trim();
    if (!wallet || !name) return;
    await api("/api/wallets/rename", { method: "POST", json: { wallet_id: wallet.id, name } });
    this.ctx.notify.toast("Wallet renamed", { tone: "success" });
    await this.load();
  }

  async deleteWallet() {
    const wallet = this.selectedWallet;
    if (!wallet || this.wallets.length <= 1 || this.deleting) return;
    this.deleting = true;
    try {
      await api("/api/wallets/delete", { method: "POST", json: { wallet_id: wallet.id, transfer_wallet_id: Number($("#walletDeleteTarget", this.root)?.value || 0) || null } });
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
    await api("/api/wallets/reorder", { method: "POST", json: { wallet_ids: ordered.map((wallet) => wallet.id) } });
    await this.load({ silent: true });
  }

  async sendToAddress() {
    await api("/api/wallets/transfer", { method: "POST", json: {
      from_wallet_id: Number($("#walletSendFrom", this.root).value || 0),
      to_address: ($("#walletSendAddress", this.root).value || "").trim(),
      token_id: Number($("#walletSendToken", this.root).value || 0),
      amount: Number($("#walletSendAmount", this.root).value || 0),
    } });
    this.ctx.notify.toast("Transfer sent", { tone: "success" });
    await this.load();
  }

  async transferBetweenWallets() {
    await api("/api/wallets/transfer", { method: "POST", json: {
      from_wallet_id: Number($("#walletTransferFrom", this.root).value || 0),
      to_wallet_id: Number($("#walletTransferTo", this.root).value || 0),
      token_id: Number($("#walletTransferToken", this.root).value || 0),
      amount: Number($("#walletTransferAmount", this.root).value || 0),
    } });
    this.ctx.notify.toast("Internal transfer completed", { tone: "success" });
    await this.load();
  }

  async submitExchange() {
    const wallet = this.selectedWallet;
    if (!wallet) return;
    const res = await api("/api/exchange", { method: "POST", json: { wallet_id: wallet.id, kind: this.exchangeKind, amount: Number($("#walletExchangeAmount", this.root).value || 0) } });
    if (res.me) await this.ctx.refreshMe();
    this.ctx.notify.toast("Conversion completed", { tone: "success" });
    await this.load();
  }

  onEvent(msg) {
    if (msg.type === "market_cycle" && this.ctx.isScreenActive(this)) this.load({ silent: true }).catch(() => {});
  }
}
