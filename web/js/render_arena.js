export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.snapshot = null;
    this.prevSnapshot = null;
    this.myUserId = null;
    this.lastApplyTime = performance.now();
    this.particles = [];
    this.shake = 0;
    this.stageLabel = "";
  }

  setMyUserId(id) {
    this.myUserId = Number(id || 0);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const parent = this.canvas.parentElement;
    const w = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || parent?.clientWidth || 1200));
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || parent?.clientHeight || 720));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  pushLocalInput() {}

  applySnapshot(snap) {
    this.prevSnapshot = this.snapshot;
    this.snapshot = snap;
    this.lastApplyTime = performance.now();
    this.stageLabel = snap?.stage?.display_name || "";
    const events = snap?.events || [];
    for (const event of events) {
      if (event.kind === "hit") {
        const target = snap?.fighters?.[event.target] || snap?.fighters?.[String(event.target)];
        if (target) this._burst(target.x, target.y - 48, target.color || "#ffffff", 7);
        this.shake = Math.max(this.shake, 7);
      }
      if (event.kind === "ko") {
        const target = snap?.fighters?.[event.victim] || snap?.fighters?.[String(event.victim)];
        if (target) this._burst(target.x, target.y - 44, "#fff2c0", 16);
        this.shake = Math.max(this.shake, 12);
      }
      if (event.kind === "land") {
        const fighter = snap?.fighters?.[event.user_id] || snap?.fighters?.[String(event.user_id)];
        if (fighter) this._burst(fighter.x, fighter.y + 2, "rgba(255,255,255,0.28)", 4, 120);
      }
    }
  }

  _burst(x, y, color, count, speed = 180) {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / Math.max(1, count);
      this.particles.push({
        x: Number(x || 0),
        y: Number(y || 0),
        vx: Math.cos(angle) * (speed * (0.5 + Math.random() * 0.7)),
        vy: Math.sin(angle) * (speed * (0.4 + Math.random() * 0.7)),
        life: 0.35 + Math.random() * 0.25,
        size: 2 + Math.random() * 4,
        color,
      });
    }
  }

  _interp(uid) {
    const current = this.snapshot?.fighters?.[uid] || this.snapshot?.fighters?.[String(uid)];
    if (!current) return null;
    const prev = this.prevSnapshot?.fighters?.[uid] || this.prevSnapshot?.fighters?.[String(uid)];
    if (!prev) return current;
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.lastApplyTime) / 70));
    return {
      ...current,
      x: prev.x + ((current.x - prev.x) * alpha),
      y: prev.y + ((current.y - prev.y) * alpha),
      damage: prev.damage + ((current.damage - prev.damage) * alpha),
    };
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - (dt * 34));
    this.particles = this.particles
      .map((particle) => ({
        ...particle,
        x: particle.x + (particle.vx * dt),
        y: particle.y + (particle.vy * dt),
        vx: particle.vx * 0.95,
        vy: (particle.vy * 0.95) + (60 * dt),
        life: particle.life - dt,
      }))
      .filter((particle) => particle.life > 0);
  }

  _drawBackdrop(ctx, stage, width, height) {
    const theme = stage?.theme || {};
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, theme.sky_top || "#102030");
    bg.addColorStop(1, theme.sky_bottom || "#20344a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = theme.fog || "rgba(255,255,255,0.08)";
    ctx.globalAlpha = 0.24;
    for (let index = 0; index < 6; index += 1) {
      const w = 200 + (index * 48);
      const x = -40 + (index * 84);
      const y = height * 0.18 + ((index % 3) * 36);
      ctx.beginPath();
      ctx.arc(x + w * 0.25, y, w * 0.18, Math.PI, 0);
      ctx.arc(x + w * 0.45, y - 20, w * 0.2, Math.PI, 0);
      ctx.arc(x + w * 0.67, y, w * 0.17, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(4,10,16,0.24)";
    for (let index = 0; index < 12; index += 1) {
      const towerW = 56 + ((index % 4) * 18);
      const towerH = height * (0.18 + ((index % 5) * 0.06));
      const towerX = index * ((width + 120) / 12);
      ctx.fillRect(towerX, height - towerH - 90, towerW, towerH);
    }
  }

  _drawPlatforms(ctx, stage) {
    const theme = stage?.theme || {};
    const platforms = stage?.platforms || [];
    for (const platform of platforms) {
      ctx.fillStyle = theme.platform || "#223147";
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h || 10);
      ctx.fillStyle = theme.platform_edge || theme.accent || "#8fd8ff";
      ctx.fillRect(platform.x, platform.y, platform.w, 3);
      ctx.fillStyle = theme.shadow || "rgba(0,0,0,0.35)";
      ctx.fillRect(platform.x + 8, platform.y + (platform.h || 10), Math.max(0, platform.w - 16), 4);
    }
  }

  _drawFighter(ctx, fighter, isMine) {
    const x = Number(fighter.x || 0);
    const y = Number(fighter.y || 0);
    const scale = Number(fighter.hitbox_scale || 1);
    const body = 26 * scale;
    const facing = Number(fighter.facing || 1) >= 0 ? 1 : -1;
    const damage = Number(fighter.damage || 0);
    ctx.save();
    if (!fighter.alive) ctx.globalAlpha = 0.35;
    if (Number(fighter.invuln || 0) > 0) ctx.globalAlpha = 0.75;
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(0, 4, body * 0.7, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fighter.color || "#dcecff";
    ctx.strokeStyle = fighter.accent_color || "#ffffff";
    ctx.lineWidth = isMine ? 3 : 2;
    ctx.fillRect(-body * 0.42, -body * 1.4, body * 0.84, body * 1.1);
    ctx.fillRect(-body * 0.78, -body * 1.08, body * 0.26, body * 0.7);
    ctx.fillRect(body * 0.52, -body * 1.08, body * 0.26, body * 0.7);
    ctx.fillRect(-body * 0.34, -body * 0.25, body * 0.22, body * 0.72);
    ctx.fillRect(body * 0.12, -body * 0.25, body * 0.22, body * 0.72);
    ctx.beginPath();
    ctx.arc(0, -body * 1.75, body * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -body * 1.75, body * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#081118";
    ctx.fillRect(-body * 0.18, -body * 1.78, body * 0.44, body * 0.12);
    if (fighter.attack_name) {
      ctx.strokeStyle = fighter.accent_color || "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(body * 0.92, -body * 0.88, body * 0.52, -0.9, 0.9);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = isMine ? "#ffffff" : "rgba(236,243,255,0.92)";
    ctx.font = "600 14px 'Bahnschrift', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fighter.display_name || fighter.username || `P${fighter.user_id}`, x, y - (body * 2.55));
    ctx.fillStyle = damage < 80 ? "#eaf4ff" : damage < 140 ? "#ffd27a" : "#ff8c8c";
    ctx.font = "700 20px 'Bahnschrift', sans-serif";
    ctx.fillText(`${Math.round(damage)}%`, x, y - (body * 2.05));
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth || 1200;
    const H = this.canvas.clientHeight || 720;
    if (this.canvas.width !== Math.floor(W * (window.devicePixelRatio || 1)) || this.canvas.height !== Math.floor(H * (window.devicePixelRatio || 1))) {
      this.resize();
    }
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#05080d";
    ctx.fillRect(0, 0, W, H);
    if (!this.snapshot) {
      ctx.fillStyle = "#d5e9ff";
      ctx.font = "600 18px 'Bahnschrift', sans-serif";
      ctx.fillText("Waiting for arena room...", 28, 42);
      return;
    }

    const stage = this.snapshot.stage || {};
    const arena = this.snapshot.arena || { w: 1600, h: 900 };
    const scale = Math.min(W / arena.w, H / arena.h);
    const offsetX = (W - (arena.w * scale)) / 2;
    const offsetY = (H - (arena.h * scale)) / 2;
    const shakeX = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake ? (Math.random() - 0.5) * this.shake : 0;

    ctx.save();
    ctx.translate(offsetX + shakeX, offsetY + shakeY);
    ctx.scale(scale, scale);
    this._drawBackdrop(ctx, stage, arena.w, arena.h);
    this._drawPlatforms(ctx, stage);

    const fighters = (this.snapshot.players || [])
      .map((uid) => this._interp(uid))
      .filter(Boolean)
      .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
    for (const fighter of fighters) {
      this._drawFighter(ctx, fighter, Number(fighter.user_id) === Number(this.myUserId));
    }

    for (const particle of this.particles) {
      const alpha = Math.max(0, Math.min(1, particle.life * 2.4));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;

    const blast = stage.blast_zone || {};
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([8, 10]);
    ctx.strokeRect(blast.left || -220, blast.top || -220, (blast.right || arena.w + 220) - (blast.left || -220), (blast.bottom || arena.h + 220) - (blast.top || -220));
    ctx.setLineDash([]);
    ctx.restore();

    const infoW = 280;
    ctx.fillStyle = "rgba(8,13,20,0.72)";
    ctx.fillRect(16, 16, infoW, 74);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(16, 16, infoW, 74);
    ctx.fillStyle = "#edf6ff";
    ctx.font = "700 14px 'Bahnschrift', sans-serif";
    ctx.fillText((this.snapshot.mode_name || "arena").toUpperCase(), 28, 38);
    ctx.font = "500 12px 'Bahnschrift', sans-serif";
    ctx.fillStyle = "#9fc6ee";
    ctx.fillText(this.stageLabel || "Arena", 28, 58);
    ctx.fillText(`Round ${this.snapshot.round || 0} / Best of ${this.snapshot.best_of || 3}`, 28, 76);
  }
}
