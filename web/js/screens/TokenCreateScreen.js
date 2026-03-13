import { api, uploadFile } from "../net.js";
import {
  $,
  createEl,
  escapeHtml,
  formatCC,
  formatDecimal,
  readFileAsDataUrl,
  renderTokenAvatar,
  tokenAccent,
} from "../ui.js";

export class TokenCreateScreen {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = "create-token";
    this.title = "Create Token";
    this.root = null;
    this.wallets = [];
    this.iconData = "";
    this.iconFile = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel token-create-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Launch</span>
          <h2 class="screen-title">Create a new token</h2>
          <p class="helper">Name the token, choose seed liquidity, and let the simulator derive how steady or chaotic the launch should be.</p>
        </div>
        <div class="hero-actions">
          <button id="tokenCreateBackBtn" class="btn ghost" type="button">Back to market</button>
        </div>
      </div>

      <div class="content-grid content-grid-token-create">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Launch Parameters</h3>
              <p class="helper">Every field below affects how the token appears in the market and explorer.</p>
            </div>
          </div>
          <div class="card-body col">
            <div id="tokenCreateStatus" class="status info">Loading wallet options...</div>
            <label>Creator Wallet
              <select id="tokenWallet"></select>
            </label>
            <div class="grid cols-2">
              <label>Name
                <input id="tokenName" maxlength="40" placeholder="Frenzy Fruit">
              </label>
              <label>Symbol
                <input id="tokenSymbol" maxlength="8" placeholder="FRNZ">
              </label>
            </div>
            <label>Description
              <textarea id="tokenDescription" maxlength="240" placeholder="Describe the token, creator thesis, or launch vibe."></textarea>
            </label>
            <div class="grid cols-2">
              <label>Category
                <select id="tokenCategory">
                  <option value="meme">Meme</option>
                  <option value="utility">Utility</option>
                  <option value="chaos">Chaos</option>
                  <option value="game">Game</option>
                  <option value="social">Social</option>
                </select>
              </label>
              <label>Theme Color
                <input id="tokenThemeColor" type="color" value="#59bbff">
              </label>
            </div>
            <div class="grid cols-2">
              <label>Seed Liquidity (CC)
                <input id="tokenSeedLiquidity" type="number" min="25" step="1" value="60">
              </label>
              <label>Creator Allocation (%)
                <input id="tokenCreatorAlloc" type="number" min="8" max="55" step="1" value="22">
              </label>
            </div>
            <label>Icon Upload (optional)
              <input id="tokenIconFile" type="file" accept="image/*">
            </label>
            <button id="tokenCreateBtn" class="btn primary" type="button">Launch token</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">Launch Preview</h3>
              <p class="helper">This preview updates before you confirm the launch.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="tokenPreviewCard" class="token-launch-preview"></div>
          </div>
        </div>
      </div>
    `;

    $("#tokenCreateBackBtn", this.root).addEventListener("click", () => this.ctx.navigate("market"));
    ["tokenName", "tokenSymbol", "tokenDescription", "tokenCategory", "tokenThemeColor", "tokenSeedLiquidity", "tokenCreatorAlloc"]
      .forEach((id) => $("#" + id, this.root).addEventListener("input", () => this.renderPreview()));
    $("#tokenIconFile", this.root).addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      this.iconFile = file || null;
      this.iconData = file ? await readFileAsDataUrl(file) : "";
      this.renderPreview();
    });
    $("#tokenCreateBtn", this.root).addEventListener("click", () => this.createToken());
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Launch a new market asset");
    await this.loadWallets(route?.params?.wallet);
    this.renderPreview();
  }

  hide() {}

  async loadWallets(walletId) {
    const status = $("#tokenCreateStatus", this.root);
    status.className = "status info";
    status.textContent = "Loading wallets...";
    try {
      const res = await api("/api/wallets");
      this.wallets = res.wallets || [];
      const select = $("#tokenWallet", this.root);
      select.innerHTML = this.wallets.map((wallet) => `<option value="${wallet.id}">${wallet.name}</option>`).join("");
      if (walletId) select.value = String(walletId);
      status.className = "status success";
      status.textContent = `Ready to launch from ${this.wallets.length || 0} wallet${this.wallets.length === 1 ? "" : "s"}.`;
    } catch (error) {
      status.className = "status error";
      status.textContent = `Wallet load failed: ${error.message}`;
    }
  }

  draftToken() {
    return {
      name: ($("#tokenName", this.root).value || "").trim() || "Unnamed Token",
      symbol: ($("#tokenSymbol", this.root).value || "").trim().toUpperCase() || "TKN",
      description: ($("#tokenDescription", this.root).value || "").trim(),
      category: $("#tokenCategory", this.root).value,
      theme_color: $("#tokenThemeColor", this.root).value || tokenAccent("CA"),
      seed_liquidity_cc: Number($("#tokenSeedLiquidity", this.root).value || 0),
      creator_allocation_pct: Number($("#tokenCreatorAlloc", this.root).value || 22),
      icon_data: this.iconData,
    };
  }

  estimateLaunch(token) {
    const seed = Math.max(25, Number(token.seed_liquidity_cc || 0));
    const creatorPct = Math.max(8, Math.min(55, Number(token.creator_allocation_pct || 22)));
    const hash = Array.from(token.symbol || token.name || "CA").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const brandNoise = ((hash % 24) - 12) / 100;
    const launchPrice = Math.max(0.06, Math.min(5.5, (0.18 + (Math.log10(seed + 10) * 0.22) + brandNoise)));
    const poolTokens = Math.max(18, seed / Math.max(launchPrice, 0.01));
    const creatorTokens = Math.max(4, poolTokens * (creatorPct / Math.max(1, 100 - creatorPct)));
    const stability = Math.max(0, Math.min(100, 82 - ((creatorPct - 22) * 0.8) + (Math.log10(seed + 10) * 16)));
    const chaos = Math.max(0, Math.min(100, 96 - stability + Math.max(0, creatorPct - 28) * 0.7));
    return {
      launchPrice,
      poolTokens,
      creatorTokens,
      liquidityValue: seed * 2,
      stability,
      chaos,
    };
  }

  renderPreview() {
    const token = this.draftToken();
    const estimate = this.estimateLaunch(token);
    const preview = {
      ...token,
      price: estimate.launchPrice,
      supply: estimate.poolTokens + estimate.creatorTokens,
      category: token.category,
      icon_data_url: token.icon_data,
    };
    $("#tokenPreviewCard", this.root).innerHTML = `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token">
          <div class="row">
            ${renderTokenAvatar(preview)}
            <div class="col" style="gap:4px;">
              <strong>${escapeHtml(token.name)}</strong>
              <span class="muted">${escapeHtml(token.symbol)} | ${escapeHtml(token.category)}</span>
            </div>
          </div>
          <span class="chip chip-primary">${formatCC(estimate.launchPrice, 4)}</span>
        </div>
        <p class="helper">${escapeHtml(token.description || "Add a token description to give the launch a stronger identity.")}</p>
        <div class="detail-grid">
          <div><span class="muted">Launch Price</span><strong>${formatCC(estimate.launchPrice, 4)}</strong></div>
          <div><span class="muted">Pool Depth</span><strong>${formatCC(estimate.liquidityValue, 2)}</strong></div>
          <div><span class="muted">Creator Tokens</span><strong>${formatDecimal(estimate.creatorTokens, 2)}</strong></div>
          <div><span class="muted">Seeded Into Pool</span><strong>${formatDecimal(estimate.poolTokens, 2)}</strong></div>
          <div><span class="muted">Stability</span><strong>${formatDecimal(estimate.stability, 0)} / 100</strong></div>
          <div><span class="muted">Chaos</span><strong>${formatDecimal(estimate.chaos, 0)} / 100</strong></div>
          <div><span class="muted">Theme</span><strong>${escapeHtml(token.theme_color)}</strong></div>
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(token.category)}</span>
          <span class="chip">${formatCC(token.seed_liquidity_cc, 0)} seed</span>
          <span class="chip">${formatDecimal(token.creator_allocation_pct, 0)}% creator</span>
        </div>
      </div>
    `;
  }

  async createToken() {
    const payload = {
      wallet_id: Number($("#tokenWallet", this.root).value || 0),
      ...this.draftToken(),
    };
    const status = $("#tokenCreateStatus", this.root);
    status.className = "status info";
    status.textContent = "Launching token...";
    try {
      if (this.iconFile) {
        const upload = await uploadFile(this.iconFile);
        payload.icon_file_id = upload.file?.id;
      }
      const res = await api("/api/token/create", { method: "POST", json: payload });
      const token = res.token || {};
      status.className = "status success";
      status.textContent = `Launched ${token.symbol || payload.symbol}.`;
      this.ctx.notify.toast("Token launched", { tone: "success" });
      $("#tokenName", this.root).value = "";
      $("#tokenSymbol", this.root).value = "";
      $("#tokenDescription", this.root).value = "";
      $("#tokenSeedLiquidity", this.root).value = "60";
      $("#tokenCreatorAlloc", this.root).value = "22";
      $("#tokenIconFile", this.root).value = "";
      this.iconData = "";
      this.iconFile = null;
      this.renderPreview();
      this.ctx.navigate("market", { token: token.id || token.token_id || "" });
    } catch (error) {
      status.className = "status error";
      status.textContent = `Launch failed: ${error.message}`;
      this.ctx.notify.toast(`Token launch failed: ${error.message}`, { tone: "error" });
    }
  }
}
