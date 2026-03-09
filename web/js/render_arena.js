import { formatTime } from "./ui.js";

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.snapshot = null;
    this.prevSnapshot = null;
    this.myUserId = null;
    this.localPred = null;
    this.pendingInputs = [];
    this.lastApplyTime = performance.now();
    this.chatLines = [];
  }

  setMyUserId(id) {
    this.myUserId = Number(id || 0);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 1200;
    const h = this.canvas.clientHeight || 680;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  addChatLine(line) {
    this.chatLines.push(line);
    if (this.chatLines.length > 5) this.chatLines.shift();
  }

  pushLocalInput(payload) {
    this.pendingInputs.push({
      seq: Number(payload.seq || 0),
      up: !!payload.up,
      down: !!payload.down,
      left: !!payload.left,
      right: !!payload.right,
      dt: Math.max(0.001, Number(payload.dt || 1 / 30)),
    });
    if (this.pendingInputs.length > 120) this.pendingInputs = this.pendingInputs.slice(-120);
    if (this.localPred) {
      this._simulateInput(this.localPred, this.pendingInputs[this.pendingInputs.length - 1], this.snapshot);
    }
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

    const ack = Number(me.last_input_seq || 0);
    if (ack) this.pendingInputs = this.pendingInputs.filter((i) => Number(i.seq) > ack);

    this.localPred.x = Number(me.x);
    this.localPred.y = Number(me.y);
    this.localPred.seq = ack;
    for (const input of this.pendingInputs) {
      this._simulateInput(this.localPred, input, snap);
    }
  }

  _simulateInput(state, input, snap) {
    const arena = snap?.arena || { w: 1200, h: 700 };
    const meSnap = snap?.fighters?.[this.myUserId] || snap?.fighters?.[String(this.myUserId)];
    const speed = Number(meSnap?.move_speed || 190);
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    state.x += dx * speed * input.dt;
    state.y += dy * speed * input.dt;
    state.x = Math.max(-60, Math.min(arena.w + 60, state.x));
    state.y = Math.max(-60, Math.min(arena.h + 60, state.y));
  }

  _interpFighter(uid) {
    const current = this.snapshot?.fighters?.[uid] || this.snapshot?.fighters?.[String(uid)];
    if (!current) return null;
    if (Number(uid) === Number(this.myUserId) && this.localPred && current.alive) {
      return { ...current, x: this.localPred.x, y: this.localPred.y };
    }
    const prev = this.prevSnapshot?.fighters?.[uid] || this.prevSnapshot?.fighters?.[String(uid)];
    if (!prev) return current;
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.lastApplyTime) / 60));
    return {
      ...current,
      x: prev.x + (current.x - prev.x) * alpha,
      y: prev.y + (current.y - prev.y) * alpha,
    };
  }

  update() {}

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth || 1200;
    const H = this.canvas.clientHeight || 680;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#081219";
    ctx.fillRect(0, 0, W, H);

    if (!this.snapshot) {
      ctx.fillStyle = "#d1e7ff";
      ctx.font = "18px system-ui";
      ctx.fillText("Waiting for arena room...", 24, 36);
      return;
    }

    const arena = this.snapshot.arena || { w: 1200, h: 700 };
    const scale = Math.min(W / arena.w, H / arena.h);
    const offsetX = (W - (arena.w * scale)) / 2;
    const offsetY = (H - (arena.h * scale)) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.fillStyle = "#102331";
    ctx.fillRect(0, 0, arena.w, arena.h);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, arena.w, arena.h);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 40; x < arena.w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, arena.h);
      ctx.stroke();
    }
    for (let y = 40; y < arena.h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(arena.w, y);
      ctx.stroke();
    }

    const coins = this.snapshot.coins || [];
    for (const c of coins) {
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(Number(c.x), Number(c.y), 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#503400";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(c.v || ""), Number(c.x), Number(c.y) + 3);
    }

    const drawFighter = (f, boss = false) => {
      const x = Number(f.x || 0);
      const y = Number(f.y || 0);
      const r = 16 * Number(f.hitbox_scale || 1);
      const hpRatio = Math.max(0, Math.min(1, Number(f.hp || 0) / Math.max(1, Number(f.max_hp || 1))));
      ctx.save();
      if (!f.alive) ctx.globalAlpha = 0.45;
      if (Number(f.invuln || 0) > 0) ctx.globalAlpha = 0.65;
      ctx.translate(x, y);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, r + 7, r * 0.95, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f.color || "#d7edff";
      ctx.lineWidth = boss ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.65, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1); ctx.lineTo(0, r * 0.95);
      ctx.moveTo(0, r * 0.2); ctx.lineTo(-r * 0.85, r * 0.52);
      ctx.moveTo(0, r * 0.2); ctx.lineTo(r * 0.85, r * 0.52);
      ctx.moveTo(0, r * 0.95); ctx.lineTo(-r * 0.75, r * 1.7);
      ctx.moveTo(0, r * 0.95); ctx.lineTo(r * 0.75, r * 1.7);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(-r, -r * 1.85, r * 2, 5);
      ctx.fillStyle = hpRatio > 0.4 ? "#4ade80" : hpRatio > 0.2 ? "#ffd166" : "#ff6b7a";
      ctx.fillRect(-r, -r * 1.85, r * 2 * hpRatio, 5);
      ctx.restore();

      ctx.fillStyle = "#e8f3ff";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(f.display_name || f.username || `P${f.user_id}`, x, y - (r * 2.1));
    };

    for (const uid of this.snapshot.players || []) {
      const fighter = this._interpFighter(uid);
      if (fighter) drawFighter(fighter, false);
    }
    if (this.snapshot.boss) drawFighter(this.snapshot.boss, true);
    ctx.restore();

    ctx.fillStyle = "rgba(4,14,22,0.78)";
    ctx.fillRect(12, 12, 320, 78);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.strokeRect(12, 12, 320, 78);
    ctx.fillStyle = "#eaf4ff";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(`${String(this.snapshot.mode_name || "arena").toUpperCase()} | ${String(this.snapshot.state).toUpperCase()}`, 20, 34);
    ctx.font = "12px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#a8cfff";
    ctx.fillText(`Round ${this.snapshot.round || 0} | Best of ${this.snapshot.best_of || 3}`, 20, 54);
    ctx.fillText(`Time ${formatTime(this.snapshot.time_left || 0)} | Tick ${this.snapshot.tick || 0}`, 20, 72);
  }
}
