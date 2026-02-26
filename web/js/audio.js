export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.volume = 0.08;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.ensure();
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(0.3, Number(v) || 0));
    this.ensure();
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  beep(freq = 440, dur = 0.08, type = "square") {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.001;
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }
}

export const audio = new AudioEngine();

