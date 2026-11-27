'use strict';
/* ============================================================
   SPACE GLIDER — audio.js
   Everything is synthesised with WebAudio: effects, engine hum
   and an original step-sequenced synth soundtrack.
   ============================================================ */

const Sfx = (() => {
  let ac = null, master, sfxBus, musBus, noiseBuf, eng = null;
  let mode = 0;              // 0 = all, 1 = effects only, 2 = muted
  let level = 0, step = 0, nextT = 0, bpm = 100;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }

    master = ac.createGain(); master.gain.value = 0.85;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);

    sfxBus = ac.createGain(); sfxBus.connect(master);
    musBus = ac.createGain(); musBus.connect(master);
    // tape-echo on the music bus
    const dly = ac.createDelay(1); dly.delayTime.value = 0.31;
    const fb = ac.createGain(); fb.gain.value = 0.3;
    const wet = ac.createGain(); wet.gain.value = 0.3;
    musBus.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(master);
    applyMode();

    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // engine drone
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.value = 48; o2.frequency.value = 48.6;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    const g = ac.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(sfxBus);
    o1.start(); o2.start();
    eng = { o1, o2, lp, g };
  }

  function applyMode() {
    if (!ac) return;
    musBus.gain.value = mode === 0 ? 0.5 : 0;
    sfxBus.gain.value = mode === 2 ? 0 : 0.9;
  }
  function cycleMode() { mode = (mode + 1) % 3; applyMode(); return mode; }
  function setMode(m) { mode = m; applyMode(); }
  const ready = () => ac && mode !== 2;

  function env(g, t, vol, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(type, f0, f1, dur, vol, delay = 0, bus) {
    if (!ready()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env(g, t, vol, dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, f0, f1, type = 'lowpass', q = 1, delay = 0, bus) {
    if (!ready()) return;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ac.createGain(); env(g, t, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.03);
  }

  /* ---------- effects ---------- */
  const fx = {
    laser() { tone('sawtooth', 1700, 240, 0.13, 0.11); tone('square', 2400, 500, 0.07, 0.04); },
    enemyFire(v = 1) { tone('square', 520, 110, 0.24, 0.07 * v); },
    boom(size = 1, v = 1) {
      noise(0.45 + size * 0.35, 0.42 * v, 2200, 50);
      tone('sine', 150, 28, 0.4 + size * 0.2, 0.4 * v);
    },
    bigBoom() {
      noise(1.8, 0.6, 3000, 30);
      tone('sine', 120, 20, 1.4, 0.6);
      tone('sawtooth', 300, 30, 0.9, 0.2, 0.05);
      noise(1.2, 0.35, 800, 60, 'lowpass', 1, 0.35);
    },
    pop() { tone('square', 900, 1800, 0.06, 0.06); noise(0.08, 0.12, 4000, 800); },
    clank() { tone('square', 320, 180, 0.07, 0.09); noise(0.06, 0.12, 5000, 1500, 'bandpass', 3); },
    hit() { noise(0.3, 0.55, 3200, 160); tone('sawtooth', 210, 36, 0.32, 0.32); },
    scrape() { noise(0.2, 0.3, 5000, 900, 'bandpass', 2); },
    missile() { noise(0.8, 0.3, 500, 4500, 'bandpass', 1.5); tone('sawtooth', 160, 720, 0.55, 0.08); },
    deny() { tone('square', 160, 150, 0.12, 0.09); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone('triangle', f, f, 0.12, 0.13, i * 0.07)); },
    warn() { tone('square', 880, 880, 0.09, 0.08); tone('square', 880, 880, 0.09, 0.08, 0.16); },
    blip() { tone('square', 1200, 1200, 0.04, 0.05); },
    tick() { tone('triangle', 1500, 1500, 0.05, 0.08); },
    gate() { [440, 554, 659, 880, 1109, 1319].forEach((f, i) => tone('triangle', f, f * 1.01, 0.22, 0.12, i * 0.08)); },
    warp() { noise(1.7, 0.4, 200, 7000, 'bandpass', 2); tone('sawtooth', 70, 1400, 1.5, 0.12); },
    start() { [330, 440, 660, 880].forEach((f, i) => tone('square', f, f, 0.1, 0.08, i * 0.06)); },
  };

  function engine(n, on) {
    if (!ac || !eng) return;
    const t = ac.currentTime;
    eng.o1.frequency.setTargetAtTime(40 + n * 52, t, 0.12);
    eng.o2.frequency.setTargetAtTime((40 + n * 52) * 1.012 + 0.4, t, 0.12);
    eng.lp.frequency.setTargetAtTime(160 + n * 520, t, 0.12);
    eng.g.gain.setTargetAtTime(on ? 0.05 + n * 0.035 : 0, t, 0.15);
  }

  /* ---------- music: Am – F – C – G, one bar each, 16 steps per bar ---------- */
  const CH = [{ r: 45, min: true }, { r: 41, min: false }, { r: 48, min: false }, { r: 43, min: false }];
  const BASS = [0, 0, 12, 0, 0, 12, 0, 12];
  const ARP = [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 4, 2];
  const LEAD = { 0: 76, 6: 74, 8: 72, 12: 69, 16: 72, 22: 69, 24: 65, 28: 67, 32: 67, 38: 72, 40: 76, 44: 79, 48: 74, 54: 71, 56: 67, 60: 71 };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function note(midi, t, dur, type, vol, cut) {
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = type; o.frequency.value = mtof(midi);
    f.type = 'lowpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(cut, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cut * 0.25), t + dur);
    env(g, t, vol, dur);
    o.connect(f); f.connect(g); g.connect(musBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function drum(kind, t) {
    if (kind === 'kick') {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      env(g, t, 0.55, 0.2); o.connect(g); g.connect(musBus); o.start(t); o.stop(t + 0.25);
      return;
    }
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(), g = ac.createGain();
    if (kind === 'hat') { f.type = 'highpass'; f.frequency.value = 7500; env(g, t, 0.07, 0.04); }
    else { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8; env(g, t, 0.22, 0.15); }
    s.connect(f); f.connect(g); g.connect(musBus);
    s.start(t, Math.random()); s.stop(t + 0.2);
  }
  function sched(s, t) {
    const st = s & 15, c = CH[(s >> 4) & 3];
    const third = c.min ? 3 : 4;
    const tones = [c.r + 12, c.r + 12 + third, c.r + 19, c.r + 24, c.r + 24 + third];
    const sd = 60 / bpm / 4;
    if ((st & 1) === 0) note(c.r + BASS[st >> 1], t, sd * 1.8, 'sawtooth', 0.2, 650);
    note(tones[ARP[st]], t, sd * 0.95, 'square', level === 0 ? 0.05 : 0.065, 2300);
    if (level >= 1) {
      if (st % 4 === 0) drum('kick', t);
      if (st % 4 === 2) drum('hat', t);
      if (st === 4 || st === 12) drum('snare', t);
    }
    if (level >= 2 && (st & 1)) drum('hat', t);
    if (level >= 2 || (level === 1 && ((s >> 6) & 1))) {
      const L = LEAD[s & 63];
      if (L) note(L, t, sd * 3.6, 'sawtooth', 0.085, 3000);
    }
  }
  /** Call every frame; schedules a short look-ahead of notes. */
  function tick() {
    if (!ac || mode !== 0 || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (nextT < now - 0.25) nextT = now + 0.05;
    let guard = 0;
    while (nextT < now + 0.14 && guard++ < 16) {
      sched(step, nextT);
      nextT += 60 / bpm / 4;
      step++;
    }
  }
  function setLevel(l) { level = l; bpm = [100, 112, 126][l] || 112; }

  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else ac.resume();
  });

  return Object.assign(fx, { init, tick, engine, setLevel, cycleMode, setMode, get mode() { return mode; } });
})();
