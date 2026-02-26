import { formatTime } from "./ui.js";

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.snapshot = null;
    this.prevSnapshot = null;
    this.myUserId = null;
    this.localPred = null;
    this.lastApplyTime = performance.now();
    this.inputState = null;
    this.chatLines = [];
  }

  setMyUserId(id) { this.myUserId = Number(id || 0); }
  setInputState(keys) { this.inputState = keys; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 480;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  applySnapshot(snap) {
    this.prevSnapshot = this.snapshot;
    this.snapshot = snap;
    this.lastApplyTime = performance.now();
    if (!snap?.fighters || !this.myUserId) return;
    const me = snap.fighters[this.myUserId] || snap.fighters[String(this.myUserId)];
    if (!me) return;
    if (!this.localPred) {
      this.localPred = { x: me.x, y: me.y, seq: me.last_input_seq || 0 };
      return;
    }
    const dx = me.x - this.localPred.x;
    const dy = me.y - this.localPred.y;
    const err = Math.hypot(dx, dy);
    if (err > 70) {
      this.localPred.x = me.x;
      this.localPred.y = me.y;
    } else {
      this.localPred.x += dx * 0.35;
      this.localPred.y += dy * 0.35;
    }
    this.localPred.seq = me.last_input_seq || this.localPred.seq;
  }

  addChatLine(line) {
    this.chatLines.push(line);
    if (this.chatLines.length > 5) this.chatLines.shift();
  }

  update(dt) {
    if (!this.snapshot || !this.localPred || !this.inputState) return;
    const meSnap = this.snapshot.fighters?.[this.myUserId] || this.snapshot.fighters?.[String(this.myUserId)];
    if (!meSnap?.alive) return;
    let dx = (this.inputState.right ? 1 : 0) - (this.inputState.left ? 1 : 0);
    let dy = (this.inputState.down ? 1 : 0) - (this.inputState.up ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    this.localPred.x += dx * 180 * dt;
    this.localPred.y += dy * 180 * dt;
    const arena = this.snapshot.arena || { w: 1200, h: 700 };
    this.localPred.x = Math.max(18, Math.min(arena.w - 18, this.localPred.x));
    this.localPred.y = Math.max(18, Math.min(arena.h - 18, this.localPred.y));
  }

  _interp(uid) {
    const cur = this.snapshot?.fighters?.[uid] || this.snapshot?.fighters?.[String(uid)];
    if (!cur) return null;
    if (Number(uid) === this.myUserId && this.localPred && cur.alive) {
      return { ...cur, x: this.localPred.x, y: this.localPred.y };
    }
    const prev = this.prevSnapshot?.fighters?.[uid] || this.prevSnapshot?.fighters?.[String(uid)];
    if (!prev) return cur;
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.lastApplyTime) / 50));
    return { ...cur, x: prev.x + (cur.x - prev.x) * alpha, y: prev.y + (cur.y - prev.y) * alpha };
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth || 800;
    const H = this.canvas.clientHeight || 480;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b1722";
    ctx.fillRect(0, 0, W, H);

    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    if (!this.snapshot) {
      ctx.fillStyle = "#9ec2e8";
      ctx.font = "16px Trebuchet MS";
      ctx.fillText("Join an arena room to begin.", 16, 28);
      return;
    }

    const arena = this.snapshot.arena || { w: 1200, h: 700 };
    const scale = Math.min(W / arena.w, H / arena.h);

    const drawStick = (f, boss = false) => {
      const x = f.x * scale;
      const y = f.y * scale;
      const r = (16 * (f.hitbox_scale || 1)) * scale;
      const hpRatio = Math.max(0, Math.min(1, f.hp / Math.max(1, f.max_hp)));
      ctx.save();
      if (!f.alive) ctx.globalAlpha = 0.4;
      ctx.translate(x, y);

      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(0, r + 7, r * 0.95, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = f.color || "#ffffff";
      ctx.lineWidth = boss ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.65, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1); ctx.lineTo(0, r * 0.95);
      ctx.moveTo(0, r * 0.15); ctx.lineTo(-r * 0.85, r * 0.52);
      ctx.moveTo(0, r * 0.15); ctx.lineTo(r * 0.85, r * 0.52);
      ctx.moveTo(0, r * 0.95); ctx.lineTo(-r * 0.75, r * 1.7);
      ctx.moveTo(0, r * 0.95); ctx.lineTo(r * 0.75, r * 1.7);
      ctx.stroke();

      if (f.ult_buff > 0) {
        ctx.strokeStyle = "rgba(255,209,102,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (f.stun > 0) {
        ctx.fillStyle = "rgba(255,209,102,0.75)";
        ctx.fillRect(-r, -r * 2.25, r * 2, 4);
      }

      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(-r, -r * 1.85, r * 2, 5);
      ctx.fillStyle = hpRatio > 0.4 ? "#4ade80" : hpRatio > 0.2 ? "#ffd166" : "#ff6b7a";
      ctx.fillRect(-r, -r * 1.85, r * 2 * hpRatio, 5);
      ctx.restore();

      ctx.font = "11px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8f3ff";
      ctx.fillText(f.display_name || f.username || `P${f.user_id}`, x, y - r * 1.95);
    };

    for (const uid of this.snapshot.players || []) {
      const fighter = this._interp(uid);
      if (fighter) drawStick(fighter, false);
    }
    if (this.snapshot.boss) drawStick(this.snapshot.boss, true);

    // HUD panel
    ctx.fillStyle = "rgba(7,17,26,0.82)";
    ctx.fillRect(10, 10, 270, 70);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(10, 10, 270, 70);
    ctx.font = "bold 14px Trebuchet MS";
    ctx.fillStyle = "#e8f3ff";
    ctx.fillText(`${String(this.snapshot.mode_name || "arena").toUpperCase()} · ${this.snapshot.state}`, 18, 31);
    ctx.font = "12px Consolas";
    ctx.fillStyle = "#9ec2e8";
    ctx.fillText(`Time ${formatTime(this.snapshot.time_left || 0)} | Tick ${this.snapshot.tick || 0}`, 18, 50);
    if (this.snapshot.target_kos && this.snapshot.mode_name !== "boss") {
      ctx.fillText(`First to ${this.snapshot.target_kos} KOs`, 18, 68);
    }

    if (this.chatLines.length) {
      const boxH = 16 + this.chatLines.length * 14;
      const y0 = H - boxH - 10;
      ctx.fillStyle = "rgba(7,17,26,0.78)";
      ctx.fillRect(10, y0, 420, boxH);
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.strokeRect(10, y0, 420, boxH);
      ctx.font = "12px Trebuchet MS";
      let y = y0 + 16;
      for (const line of this.chatLines) {
        ctx.fillStyle = "#9fe4ff";
        ctx.fillText(line, 16, y);
        y += 14;
      }
    }
  }
}

