import { api, uploadFile } from "../net.js";
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
    this.iconFile = null;
  }

  mount() {
    this.root = createEl("section", { cls: "screen-panel token-create-screen" });
    this.root.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <h2>Create token</h2>
          <p>Launch a new simulated asset from the current wallet without leaving the market workflow.</p>
        </div>
        <div class="page-actions">
          <button id="tokenCreateBackBtn" class="btn secondary" type="button">Back to market</button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="stat-card">
          <span class="stat-label">Creator wallet</span>
          <strong id="tokenSummaryWallet" class="stat-value">-</strong>
          <span class="stat-note">Wallet selected for launch</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Starting price</span>
          <strong id="tokenSummaryPrice" class="stat-value">1.25 CC</strong>
          <span class="stat-note">Launch price per unit</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Supply</span>
          <strong id="tokenSummarySupply" class="stat-value">1,000,000</strong>
          <span class="stat-note">Initial circulating supply</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Category</span>
          <strong id="tokenSummaryCategory" class="stat-value">meme</strong>
          <span class="stat-note">Current launch grouping</span>
        </div>
      </div>

      <div class="section-grid two">
        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Launch parameters</h3>
              <p class="helper">Fields below map directly to the current token launch flow.</p>
            </div>
          </div>
          <div class="panel-body form-stack">
            <div id="tokenCreateStatus" class="status info">Loading wallet options...</div>
            <label>Creator wallet
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
              <textarea id="tokenDescription" maxlength="420" placeholder="Describe the token, creator thesis, or launch angle."></textarea>
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
              <label>Theme color
                <input id="tokenThemeColor" type="color" value="#7dc39d">
              </label>
            </div>
            <div class="grid cols-2">
              <label>Volatility profile
                <select id="tokenVolatility">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="chaos">Chaos</option>
                </select>
              </label>
              <label>Risk note
                <select id="tokenRisk">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="rug-prone">Rug-prone</option>
                </select>
              </label>
            </div>
            <div class="grid cols-2">
              <label>Starting supply
                <input id="tokenSupply" type="number" min="100" step="100" value="1000000">
              </label>
              <label>Starting price (CC)
                <input id="tokenPrice" type="number" min="0.01" step="0.01" value="1.25">
              </label>
            </div>
            <label>Icon upload (optional)
              <input id="tokenIconFile" type="file" accept="image/*">
            </label>
            <button id="tokenCreateBtn" class="btn primary" type="button">Launch token</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div class="section-copy">
              <h3 class="section-title">Launch preview</h3>
              <p class="helper">Preview the token before the launch request is submitted.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="tokenPreviewCard" class="stack"></div>
          </div>
        </section>
      </div>
    `;

    $("#tokenCreateBackBtn", this.root).addEventListener("click", () => this.ctx.navigate("market"));
    ["tokenName", "tokenSymbol", "tokenDescription", "tokenCategory", "tokenThemeColor", "tokenVolatility", "tokenRisk", "tokenSupply", "tokenPrice", "tokenWallet"]
      .forEach((id) => $("#" + id, this.root).addEventListener("input", () => this.renderPreview()));
    $("#tokenIconFile", this.root).addEventListener("change", async (event) => {
      const file = event.target.files?.[0] || null;
      this.iconFile = file;
      this.iconData = file ? await readFileAsDataUrl(file) : "";
      this.renderPreview();
    });
    $("#tokenCreateBtn", this.root).addEventListener("click", () => this.createToken());
    return this.root;
  }

  async show(route) {
    this.root.classList.add("ready");
    this.ctx.setTopbar(this.title, "Launch a new market asset");
    this.ctx.setGlobalSearchValue("");
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
      initial_supply: Number($("#tokenSupply", this.root).value || 0),
      launch_price: Number($("#tokenPrice", this.root).value || 0),
    };
  }

  renderPreview() {
    const token = this.draftToken();
    const walletName = this.wallets.find((wallet) => String(wallet.id) === String($("#tokenWallet", this.root).value || ""))?.name || "-";
    const preview = {
      ...token,
      price: token.launch_price,
      symbol: token.symbol,
      theme_color: token.theme_color,
      icon_data: this.iconData,
    };
    $("#tokenSummaryWallet", this.root).textContent = walletName;
    $("#tokenSummaryPrice", this.root).textContent = formatCC(token.launch_price, 4);
    $("#tokenSummarySupply", this.root).textContent = formatDecimal(token.initial_supply, 0);
    $("#tokenSummaryCategory", this.root).textContent = token.category;
    $("#tokenPreviewCard", this.root).innerHTML = `
      <div class="detail-card">
        <div class="row" style="align-items:flex-start;">
          ${renderTokenAvatar(preview)}
          <div class="stack" style="gap:4px;">
            <strong>${token.name}</strong>
            <span class="small muted">${token.symbol} · ${token.category}</span>
          </div>
        </div>
        <div class="detail-grid">
          <div><span class="muted">Launch price</span><strong>${formatCC(token.launch_price, 4)}</strong></div>
          <div><span class="muted">Initial supply</span><strong>${formatDecimal(token.initial_supply, 0)}</strong></div>
          <div><span class="muted">Volatility</span><strong>${token.volatility}</strong></div>
          <div><span class="muted">Risk note</span><strong>${token.risk_profile}</strong></div>
        </div>
        <div class="helper">${token.description || "Add a token description to define the launch context."}</div>
      </div>
    `;
    this.renderInspector(walletName, token);
  }

  renderInspector(walletName, token) {
    this.ctx.setInspector({
      title: "Launch detail",
      subtitle: walletName,
      content: `
        <div class="inspector-card">
          <div class="detail-row"><span class="muted">Wallet</span><strong>${walletName}</strong></div>
          <div class="detail-row"><span class="muted">Price</span><strong>${formatCC(token.launch_price, 4)}</strong></div>
          <div class="detail-row"><span class="muted">Supply</span><strong>${formatDecimal(token.initial_supply, 0)}</strong></div>
          <div class="detail-row"><span class="muted">Category</span><strong>${token.category}</strong></div>
        </div>
      `,
    });
  }

  async createToken() {
    const draft = this.draftToken();
    const status = $("#tokenCreateStatus", this.root);
    status.className = "status info";
    status.textContent = "Launching token...";
    try {
      let iconFileId = null;
      if (this.iconFile) {
        const upload = await uploadFile(this.iconFile);
        iconFileId = upload.file?.id || null;
      }
      const res = await api("/api/token/create", {
        method: "POST",
        json: {
          wallet_id: Number($("#tokenWallet", this.root).value || 0),
          name: draft.name,
          symbol: draft.symbol,
          description: draft.description,
          volatility: draft.volatility,
          category: draft.category,
          theme: draft.category,
          initial_supply: draft.initial_supply,
          supply_cap: draft.initial_supply,
          launch_price: draft.launch_price,
          icon_file_id: iconFileId,
          metadata: {
            theme_color: draft.theme_color,
            risk_profile: draft.risk_profile,
          },
        },
      });
      const token = res.token || {};
      status.className = "status success";
      status.textContent = `Launched ${token.symbol || draft.symbol}.`;
      this.ctx.notify.toast("Token launched", { tone: "success" });
      $("#tokenName", this.root).value = "";
      $("#tokenSymbol", this.root).value = "";
      $("#tokenDescription", this.root).value = "";
      $("#tokenSupply", this.root).value = "1000000";
      $("#tokenPrice", this.root).value = "1.25";
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
