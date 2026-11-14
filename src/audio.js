// Весь звук синтезируется через WebAudio: эффекты, шум дождя, музыка (по мотивам sprint-city-3d).
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('sd_mute') === '1';
    this.musicOn = false; this.step = 0; this.nextT = 0; this.combo = 0; this.comboT = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.0; this.mus.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkLoop = (type, f, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start();
      return g;
    };
    this.rainG = mkLoop('highpass', 2600, 0.3);
    this.windG = mkLoop('bandpass', 420, 0.8);
    setInterval(() => this.tick(), 30);
  }
  setMuted(m) {
    this.muted = m; localStorage.setItem('sd_mute', m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
  tone(f, dur, { type = 'sine', vol = 0.3, to = 0, delay = 0, out = this.sfx, attack = 0.005 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, { vol = 0.3, type = 'lowpass', f = 1000, to = 0, delay = 0, out = this.sfx, q = 0.7 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  coin() {
    const now = performance.now();
    this.combo = now - this.comboT < 450 ? Math.min(this.combo + 1, 12) : 0; this.comboT = now;
    const f = 880 * Math.pow(2, this.combo / 12);
    this.tone(f, 0.09, { type: 'square', vol: 0.11 }); this.tone(f * 1.5, 0.16, { type: 'square', vol: 0.09, delay: 0.05 });
  }
  jump() { this.tone(260, 0.22, { type: 'triangle', vol: 0.3, to: 620 }); this.noise(0.12, { vol: 0.08, type: 'highpass', f: 1800 }); }
  roll() { this.noise(0.34, { vol: 0.24, type: 'bandpass', f: 1400, to: 300, q: 1.2 }); }
  land() { this.tone(130, 0.1, { vol: 0.3, to: 55 }); this.noise(0.07, { vol: 0.1, f: 600 }); }
  swipe() { this.noise(0.09, { vol: 0.1, type: 'bandpass', f: 2400, to: 900 }); }
  bump() { this.tone(160, 0.12, { type: 'square', vol: 0.16, to: 70 }); }
  crash() {
    this.noise(0.5, { vol: 0.7, f: 2400, to: 90 }); this.tone(110, 0.45, { type: 'sawtooth', vol: 0.4, to: 32 });
    this.tone(660, 0.6, { type: 'triangle', vol: 0.12, to: 110, delay: 0.1 });
  }
  power() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.22, delay: i * 0.06 })); }
  shield() { this.noise(0.35, { vol: 0.4, type: 'highpass', f: 900, to: 4000 }); this.tone(880, 0.3, { type: 'sine', vol: 0.25, to: 220 }); }
  click() { this.tone(700, 0.05, { type: 'square', vol: 0.1 }); }
  record() { [659, 784, 988, 1319, 1568].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.09 })); }
  setAmbience(rain, wind) {
    if (!this.ctx) return;
    this.rainG.gain.setTargetAtTime(rain * 0.16, this.ctx.currentTime, 0.4);
    this.windG.gain.setTargetAtTime(wind * 0.1, this.ctx.currentTime, 0.4);
  }
  music(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.mus.gain.setTargetAtTime(on ? 0.5 : 0.0, this.ctx.currentTime, on ? 0.3 : 0.15);
    if (on) { this.nextT = this.ctx.currentTime + 0.08; }
  }
  tick() {
    const c = this.ctx;
    if (!c || !this.musicOn || c.state !== 'running') return;
    const spb = 60 / 126 / 4;
    if (this.nextT < c.currentTime - 0.3) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.12) { this.playStep(this.step++, this.nextT - c.currentTime, spb); this.nextT += spb; }
  }
  playStep(s, delay, spb) {
    const bar = Math.floor(s / 16) % 8, st = s % 16, o = this.mus;
    const roots = [45, 45, 41, 41, 48, 48, 43, 43];
    const minor = [1, 1, 0, 0, 0, 0, 0, 0];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const root = roots[bar], third = minor[bar] ? 3 : 4;
    if (st % 4 === 0) { this.tone(150, 0.16, { vol: 0.75, to: 42, delay, out: o }); }
    if (st % 8 === 4) this.noise(0.13, { vol: 0.28, type: 'bandpass', f: 1900, delay, out: o });
    if (st % 2 === 0) this.noise(0.035, { vol: st % 4 === 2 ? 0.13 : 0.06, type: 'highpass', f: 7000, delay, out: o });
    if ([0, 3, 6, 8, 11, 14].includes(st)) this.tone(hz(root - 12 + (st === 14 ? 7 : 0)), spb * 1.7, { type: 'sawtooth', vol: 0.2, delay, out: o, attack: 0.01 });
    const arp = [0, third, 7, 12, 7, third, 12, 7, 0, third, 7, 14, 12, 7, third, 7];
    this.tone(hz(root + 12 + arp[st]), spb * 0.95, { type: 'square', vol: 0.055, delay, out: o });
    if (st === 0 && bar % 2 === 0) for (const iv of [0, third, 7]) this.tone(hz(root + 12 + iv), spb * 30, { type: 'triangle', vol: 0.06, delay, out: o, attack: 0.3 });
  }
}
