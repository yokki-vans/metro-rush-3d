// All audio is synthesized with WebAudio at runtime — no samples, no licenses.
// Music: a 132 BPM chiptune-ish loop (kick/hat/snare, bass, arp lead with delay).
// SFX: jump/coin/crash/swipe/etc. Ambience: wind, rain, train rumble, thunder.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor() {
    this.ctx = null;
    let m = null;
    try { m = localStorage.getItem('mr_muted'); } catch { /* private mode */ }
    this.muted = m === '1';
    this.musicOn = false;
    this._step = 0;
    this._nextT = 0;
    this._timer = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musBus = ctx.createGain(); this.musBus.gain.value = 0.5; this.musBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1.0; this.ambBus.connect(this.master);

    // shared noise buffer (2s white)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // lead delay (echo) for the arp
    this.delay = ctx.createDelay(0.6);
    this.delay.delayTime.value = 0.341; // dotted 8th @132
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dwet = ctx.createGain(); dwet.gain.value = 0.25;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(dwet); dwet.connect(this.musBus);

    this._loops = {};
    this._mkLoop('wind', { type: 'bandpass', f: 320, q: 0.4 });
    this._mkLoop('rain', { type: 'highpass', f: 900, q: 0.3 });
    this._mkLoop('rumble', { type: 'lowpass', f: 110, q: 0.6, pan: true });
  }

  _mkLoop(name, { type, f, q, pan }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(flt); flt.connect(g);
    let panner = null;
    if (pan && ctx.createStereoPanner) { panner = ctx.createStereoPanner(); g.connect(panner); panner.connect(this.ambBus); }
    else g.connect(this.ambBus);
    src.start();
    this._loops[name] = { g, flt, panner };
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('mr_muted', m ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx) this.master.gain.linearRampToValueAtTime(m ? 0 : 0.9, this.ctx.currentTime + 0.15);
  }

  // на паузе дождь/ветер/грохот не должны продолжать шуметь
  setAmbPaused(p) {
    if (!this.ctx) return;
    this.ambBus.gain.linearRampToValueAtTime(p ? 0 : 1, this.ctx.currentTime + 0.2);
  }

  // ------------------------------------------------------------------ music
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this._step = 0;
    this._nextT = this.ctx.currentTime + 0.06;
    const tick = () => {
      if (!this.musicOn) return;
      const ahead = 0.14;
      while (this._nextT < this.ctx.currentTime + ahead) {
        this._schedStep(this._step, this._nextT);
        this._nextT += 60 / 132 / 4;             // 16th notes @132bpm
        this._step = (this._step + 1) % 256;     // 16 bars
      }
      this._timer = setTimeout(tick, 30);
    };
    tick();
  }

  stopMusic() { this.musicOn = false; clearTimeout(this._timer); }

  _schedStep(s, t) {
    const ctx = this.ctx, bar = (s >> 4) % 8, st = s & 15;
    const ROOTS = [45, 45, 41, 43, 45, 45, 48, 43]; // A A F G A A C G
    const root = ROOTS[bar];
    // kick on quarters
    if (st % 4 === 0) this._kick(t);
    // snare on 2 & 4
    if (st === 4 || st === 12) this._snare(t);
    // hats on 8ths, accent offbeat
    if (st % 2 === 0) this._hat(t, st % 4 === 2 ? 0.32 : 0.16);
    // bass
    if ([0, 3, 6, 8, 10, 14].includes(st)) {
      const oct = st === 6 || st === 14 ? 12 : 0;
      this._bass(mtof(root + oct), t, 0.16);
    }
    // arp lead (minor pentatonic), rests keep it groovy
    const PENT = [0, 3, 5, 7, 10, 12, 15, 12];
    if (bar % 2 === 1 || bar >= 4) {
      if ([0, 2, 3, 6, 8, 11, 12, 14].includes(st)) {
        const n = PENT[(s * 5 + bar) % 8] + root + 24;
        this._lead(mtof(n), t, 0.1, bar >= 6 ? 0.07 : 0.05);
      }
    }
  }

  _kick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(this.musBus); o.start(t); o.stop(t + 0.18);
  }

  _snare(t) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.playbackRate.value = 1.4;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(f); f.connect(g); g.connect(this.musBus);
    src.start(t, Math.random()); src.stop(t + 0.15);
  }

  _hat(t, v) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(f); f.connect(g); g.connect(this.musBus);
    src.start(t, Math.random()); src.stop(t + 0.06);
  }

  _bass(freq, t, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
    g.gain.setValueAtTime(0.30, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _lead(freq, t, dur, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musBus); g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // -------------------------------------------------------------------- sfx
  _env(vol, dur, t0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    g.connect(this.sfxBus);
    return g;
  }

  jump() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(780, t + 0.16);
    o.connect(this._env(0.35, 0.2, t)); o.start(t); o.stop(t + 0.22);
    this._whoosh(t, 600, 2400, 0.16, 0.12);
  }

  land() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    o.connect(this._env(0.3, 0.1, t)); o.start(t); o.stop(t + 0.12);
  }

  roll() { if (this.ctx) this._whoosh(this.ctx.currentTime, 300, 900, 0.22, 0.2); }
  swipe() { if (this.ctx) this._whoosh(this.ctx.currentTime, 500, 2000, 0.12, 0.14); }

  _whoosh(t, f0, f1, dur, vol) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f); f.connect(this._env(vol, dur, t));
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  coin() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [[988, 0], [1319, 0.07]].forEach(([fr, dt]) => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.17, t + dt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.09);
      o.connect(g); g.connect(this.sfxBus); o.start(t + dt); o.stop(t + dt + 0.1);
    });
  }

  milestone() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((m, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
      o.connect(this._env(0.22, 0.18, t + i * 0.07)); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.2);
    });
  }

  horn() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [311, 370].forEach(fr => {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05);
      g.gain.setValueAtTime(0.18, t + 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      o.connect(f); f.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.8);
    });
  }

  crash() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.5);
    src.connect(f); f.connect(this._env(0.8, 0.55, t)); src.start(t, Math.random()); src.stop(t + 0.6);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    o.connect(this._env(0.55, 0.55, t)); o.start(t); o.stop(t + 0.6);
    // metallic clank
    [820, 1240].forEach((fr, i) => {
      const m = this.ctx.createOscillator(); m.type = 'square'; m.frequency.value = fr * (1 + Math.random() * 0.02);
      m.connect(this._env(0.1, 0.12, t + 0.02 + i * 0.03)); m.start(t + 0.02 + i * 0.03); m.stop(t + 0.2);
    });
  }

  gameover() {
    if (!this.ctx) return; const t = this.ctx.currentTime + 0.45;
    [69, 65, 62, 57].forEach((m, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
      o.connect(this._env(0.25, 0.3, t + i * 0.17)); o.start(t + i * 0.17); o.stop(t + i * 0.17 + 0.32);
    });
  }

  thunder(delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(60, t + 2.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    src.connect(f); f.connect(g); g.connect(this.ambBus);
    src.start(t); src.stop(t + 2.5);
  }

  click() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 660;
    o.connect(this._env(0.15, 0.07, t)); o.start(t); o.stop(t + 0.08);
  }

  // ------------------------------------------------------------ ambience mix
  update(dt, { speed = 0, rain = 0, trainDist = 999, trainPan = 0 }) {
    if (!this.ctx) return;
    const L = this._loops, T = this.ctx.currentTime + 0.1;
    L.wind.g.gain.linearRampToValueAtTime(Math.min(0.16, Math.max(0, (speed - 9) * 0.011)), T);
    L.wind.flt.frequency.value = 280 + speed * 14;
    L.rain.g.gain.linearRampToValueAtTime(rain * 0.22, T);
    const prox = Math.max(0, 1 - trainDist / 90);
    L.rumble.g.gain.linearRampToValueAtTime(prox * prox * 0.5, T);
    if (L.rumble.panner) L.rumble.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, trainPan)), T);
  }
}
