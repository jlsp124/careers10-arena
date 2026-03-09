import { api } from "../net.js";
import {
  $,
  createEl,
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
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel token-create-screen" });
    this.root.innerHTML = `
      <div class="hero-card">
        <div class="hero-copy">
          <span class="eyebrow">Launch</span>
          <h2 class="screen-title">Create a new token</h2>
          <p class="helper">Define supply, theme, volatility, and risk so the market simulator can track the asset from launch through mania or collapse.</p>
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
              <textarea id="tokenDescription" maxlength="420" placeholder="Describe the token, creator thesis, or launch vibe."></textarea>
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
              <label>Volatility Profile
                <select id="tokenVolatility">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="chaos">Chaos</option>
                </select>
              </label>
              <label>Risk Profile
                <select id="tokenRisk">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="rug-prone">Rug-prone</option>
                </select>
              </label>
            </div>
            <div class="grid cols-2">
              <label>Starting Supply
                <input id="tokenSupply" type="number" min="100" step="100" value="1000000">
              </label>
              <label>Starting Price (CC)
                <input id="tokenPrice" type="number" min="0.01" step="0.01" value="1.25">
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
    ["tokenName", "tokenSymbol", "tokenDescription", "tokenCategory", "tokenThemeColor", "tokenVolatility", "tokenRisk", "tokenSupply", "tokenPrice"]
      .forEach((id) => $("#" + id, this.root).addEventListener("input", () => this.renderPreview()));
    $("#tokenIconFile", this.root).addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
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
      volatility: $("#tokenVolatility", this.root).value,
      risk_profile: $("#tokenRisk", this.root).value,
      starting_supply: Number($("#tokenSupply", this.root).value || 0),
      starting_price: Number($("#tokenPrice", this.root).value || 0),
      icon_data: this.iconData,
    };
  }

  renderPreview() {
    const token = this.draftToken();
    const preview = {
      ...token,
      price: token.starting_price,
      supply: token.starting_supply,
      category: token.category,
    };
    $("#tokenPreviewCard", this.root).innerHTML = `
      <div class="detail-stack">
        <div class="detail-hero detail-hero-token">
          <div class="row">
            ${renderTokenAvatar(preview)}
            <div class="col" style="gap:4px;">
              <strong>${token.name}</strong>
              <span class="muted">${token.symbol} | ${token.category}</span>
            </div>
          </div>
          <span class="chip chip-primary">${formatCC(token.starting_price, 4)}</span>
        </div>
        <p class="helper">${token.description || "Add a token description to give the launch a stronger identity."}</p>
        <div class="detail-grid">
          <div><span class="muted">Supply</span><strong>${formatDecimal(token.starting_supply, 0)}</strong></div>
          <div><span class="muted">Volatility</span><strong>${token.volatility}</strong></div>
          <div><span class="muted">Risk</span><strong>${token.risk_profile}</strong></div>
          <div><span class="muted">Theme</span><strong>${token.theme_color}</strong></div>
        </div>
        <div class="chip-row">
          <span class="chip">${token.category}</span>
          <span class="chip">${token.volatility}</span>
          <span class="chip">${token.risk_profile}</span>
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
      const res = await api("/api/token/create", { method: "POST", json: payload });
      const token = res.token || {};
      status.className = "status success";
      status.textContent = `Launched ${token.symbol || payload.symbol}.`;
      this.ctx.notify.toast("Token launched", { tone: "success" });
      $("#tokenName", this.root).value = "";
      $("#tokenSymbol", this.root).value = "";
      $("#tokenDescription", this.root).value = "";
      $("#tokenSupply", this.root).value = "1000000";
      $("#tokenPrice", this.root).value = "1.25";
      $("#tokenIconFile", this.root).value = "";
      this.iconData = "";
      this.renderPreview();
      this.ctx.navigate("market", { token: token.id || token.token_id || "" });
    } catch (error) {
      status.className = "status error";
      status.textContent = `Launch failed: ${error.message}`;
      this.ctx.notify.toast(`Token launch failed: ${error.message}`, { tone: "error" });
    }
  }
}
