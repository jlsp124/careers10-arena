import { api } from "../net.js";
import { $, $$, createEl, escapeHtml } from "../ui.js";

export class WalletScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "wallet";
    this.title = "Wallet";
    this.root = null;
    this.wallets = [];
    this.blocks = [];
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel" });
    this.root.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <div class="card-header"><h2 class="screen-title">Wallets</h2></div>
          <div class="card-body col">
            <div class="row wrap">
              <input id="walletLabel" class="stretch" placeholder="New wallet label">
              <button id="walletCreateBtn" class="btn primary" type="button">Create Wallet</button>
              <button id="walletRefreshBtn" class="btn secondary" type="button">Refresh</button>
            </div>
            <div id="walletStatus" class="status info">Ready</div>
            <div id="walletList" class="list"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="section-title">Send Cortisol Coin</h3></div>
          <div class="card-body col">
            <label>From Wallet <select id="sendFromWallet"></select></label>
            <label>To Wallet <input id="sendToWallet" placeholder="cw_..."></label>
            <label>Amount <input id="sendAmount" type="number" min="1" value="10"></label>
            <button id="walletSendBtn" class="btn primary" type="button">Send</button>
            <div class="helper">Host mining wallet: <code>host_miner</code></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="section-title">Exchange</h3></div>
        <div class="card-body row wrap">
          <label>Wallet <select id="exchangeWallet"></select></label>
          <label>Spend Amount <input id="exchangeAmount" type="number" min="1" value="10"></label>
          <button id="exchangeBtn" class="btn ghost" type="button">Spend to Lower Leaderboard Ranking</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="section-title">Blockchain (new block every 30s)</h3></div>
        <div class="card-body"><div id="blockList" class="list"></div></div>
      </div>
    `;
    $("#walletCreateBtn", this.root).addEventListener("click", () => this.createWallet());
    $("#walletRefreshBtn", this.root).addEventListener("click", () => this.load());
    $("#walletSendBtn", this.root).addEventListener("click", () => this.send());
    $("#exchangeBtn", this.root).addEventListener("click", () => this.exchange());
    return this.root;
  }

  async show() {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Cortisol coin");
    await this.load();
  }

  hide() {}

  async load() {
    const status = $("#walletStatus", this.root);
    try {
      const res = await api("/api/wallets");
      this.wallets = res.wallets || [];
      this.blocks = res.blocks || [];
      this.render();
      status.className = "status success";
      status.textContent = `Loaded ${this.wallets.length} wallet(s)`;
    } catch (e) {
      status.className = "status error";
      status.textContent = `Failed: ${e.message}`;
    }
  }

  render() {
    const list = $("#walletList", this.root);
    list.innerHTML = this.wallets.length ? this.wallets.map((w) => `
      <div class="list-row">
        <div class="stretch">
          <strong>${escapeHtml(w.label)}</strong>
          <div class="tiny muted"><code>${escapeHtml(w.address)}</code></div>
        </div>
        <span class="badge">${Number(w.balance || 0)} CC</span>
      </div>
    `).join("") : '<div class="empty-state">No wallets</div>';

    const opts = this.wallets.map((w) => `<option value="${escapeHtml(w.address)}">${escapeHtml(w.label)} (${w.balance})</option>`).join("");
    $$("#sendFromWallet,#exchangeWallet", this.root).forEach((sel) => { sel.innerHTML = opts; });

    const b = $("#blockList", this.root);
    b.innerHTML = this.blocks.length ? this.blocks.map((x) => `
      <div class="list-row">
        <span class="badge">#${x.height}</span>
        <span class="tiny muted">${escapeHtml(x.block_hash.slice(0, 16))}…</span>
        <span class="tiny muted">+${x.reward_amount} to ${escapeHtml(x.reward_address)}</span>
      </div>
    `).join("") : '<div class="empty-state">No blocks yet</div>';
  }

  async createWallet() {
    await api('/api/wallets/create', { method: 'POST', json: { label: $("#walletLabel", this.root).value || 'Wallet' } });
    this.load();
  }

  async send() {
    await api('/api/wallets/send', { method: 'POST', json: {
      from_address: $("#sendFromWallet", this.root).value,
      to_address: $("#sendToWallet", this.root).value.trim(),
      amount: Number($("#sendAmount", this.root).value || 0),
    } });
    this.ctx.notify.toast('Transfer sent', { tone: 'success' });
    this.load();
  }

  async exchange() {
    await api('/api/exchange/spend', { method: 'POST', json: {
      wallet_address: $("#exchangeWallet", this.root).value,
      amount: Number($("#exchangeAmount", this.root).value || 0),
    } });
    this.ctx.notify.toast('Exchange complete; ranking lowered', { tone: 'info' });
    this.load();
  }
}
