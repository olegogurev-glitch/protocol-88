'use strict';
/*
 * PROTOCOL 88 — audio engine
 * Procedural 80s hard rock x 8-bit soundtrack + sound effects. Pure Web Audio, no samples.
 * The sequencer also emits beat events the game uses to time alien spawns and visuals,
 * so the music literally drives the action.
 */
window.AudioEngine = (() => {
  let ctx = null;
  let master, musicBus, sfxBus, guitarBus, leadBus, leadDelay, gatedIn, hallIn;
  let noiseBuf, distCurve, pulse25, pulse125;
  let musicMuted = false;
  const MUSIC_VOL = 0.42, SFX_VOL = 0.5;
  let musicLevel = 1, sfxLevel = 1; // user settings, 1 = default mix
  let beatFn = null;

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function makePulse(duty) {
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
      im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
    }
    return ctx.createPeriodicWave(re, im);
  }

  function makeDist(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return c;
  }

  function makeImpulse(dur, gate) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const env = gate ? (x < 0.75 ? 1 - x * 0.3 : (1 - x) * 3) : Math.pow(1 - x, 2.6);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.002; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = musicMuted ? 0 : MUSIC_VOL * musicLevel; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = SFX_VOL * sfxLevel; sfxBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    distCurve = makeDist(5);
    pulse25 = makePulse(0.25);
    pulse125 = makePulse(0.125);

    // guitar "cabinet"
    guitarBus = ctx.createGain();
    const ghp = ctx.createBiquadFilter(); ghp.type = 'highpass'; ghp.frequency.value = 90;
    const gpk = ctx.createBiquadFilter(); gpk.type = 'peaking'; gpk.frequency.value = 1600; gpk.gain.value = 4; gpk.Q.value = 0.8;
    const glp = ctx.createBiquadFilter(); glp.type = 'lowpass'; glp.frequency.value = 5200;
    guitarBus.connect(ghp); ghp.connect(gpk); gpk.connect(glp); glp.connect(musicBus);

    // reverbs: gated (the 80s snare) and a long hall for leads and pads
    gatedIn = ctx.createGain();
    const gated = ctx.createConvolver(); gated.buffer = makeImpulse(0.32, true);
    const gatedOut = ctx.createGain(); gatedOut.gain.value = 0.55;
    gatedIn.connect(gated); gated.connect(gatedOut); gatedOut.connect(musicBus);
    hallIn = ctx.createGain();
    const hall = ctx.createConvolver(); hall.buffer = makeImpulse(2.4, false);
    const hallOut = ctx.createGain(); hallOut.gain.value = 0.35;
    hallIn.connect(hall); hall.connect(hallOut); hallOut.connect(musicBus);

    // 8-bit lead with an 80s dotted-eighth echo
    leadBus = ctx.createGain(); leadBus.connect(musicBus);
    const leadHall = ctx.createGain(); leadHall.gain.value = 0.4; leadBus.connect(leadHall); leadHall.connect(hallIn);
    leadDelay = ctx.createDelay(1.5); leadDelay.delayTime.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    leadBus.connect(leadDelay); leadDelay.connect(dlp); dlp.connect(fb); fb.connect(leadDelay);
    dlp.connect(wet); wet.connect(musicBus);

    nextT = ctx.currentTime + 0.1;
    setInterval(tick, 25);
    return true;
  }

  // ---------------------------------------------------------------- building blocks
  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(t, Math.random() * 0.8);
    s.stop(t + dur + 0.03);
    return s;
  }

  function envGain(t, peak, attack, decay, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  // ---------------------------------------------------------------- instruments
  function kick(t, v) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    o.connect(envGain(t, 0.95 * v, 0.002, 0.3, musicBus));
    o.start(t); o.stop(t + 0.36);
    const n = noiseSrc(t, 0.02);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    n.connect(f); f.connect(envGain(t, 0.25 * v, 0.001, 0.015, musicBus));
  }

  function snare(t, v) {
    const n = noiseSrc(t, 0.22);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const ng = envGain(t, 0.5 * v, 0.001, 0.18, musicBus);
    n.connect(f); f.connect(ng); ng.connect(gatedIn);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(envGain(t, 0.45 * v, 0.001, 0.09, musicBus));
    o.start(t); o.stop(t + 0.13);
  }

  function hat(t, v, open) {
    const dur = open ? 0.25 : 0.045;
    const n = noiseSrc(t, dur);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    n.connect(f); f.connect(envGain(t, 0.16 * v, 0.001, dur, musicBus));
  }

  function crash(t) {
    const n = noiseSrc(t, 1.5);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3800;
    n.connect(f); f.connect(envGain(t, 0.22, 0.002, 1.4, musicBus));
  }

  // distorted power chord (root + fifth + octave), palm-muted or open
  function guitar(t, root, dur, open, v) {
    const pre = ctx.createGain(); pre.gain.value = open ? 1.2 : 0.8;
    const sh = ctx.createWaveShaper(); sh.curve = distCurve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(open ? 3400 : 1500, t);
    if (!open) lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    const pk = 0.2 * v;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + 0.004);
    g.gain.exponentialRampToValueAtTime(pk * (open ? 0.45 : 0.25), t + Math.max(0.01, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    pre.connect(sh); sh.connect(lp); lp.connect(g); g.connect(guitarBus);
    const ivs = open ? [0, 7, 12] : [0, 7];
    for (const iv of ivs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(root + iv);
        o.detune.value = det + Math.random() * 4;
        o.connect(pre); o.start(t); o.stop(t + dur + 0.08);
      }
    }
  }

  function bass(t, m, dur) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.08, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    f.connect(g); g.connect(musicBus);
    for (const type of ['square', 'triangle']) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m - 12);
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
  }

  function lead(t, m, dur, v = 1) {
    const o = ctx.createOscillator(); o.setPeriodicWave(pulse25);
    const f0 = mtof(m);
    o.frequency.setValueAtTime(f0 * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.035);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.2;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.18, dur * 0.5));
    lg.gain.linearRampToValueAtTime(f0 * 0.018, t + dur);
    lfo.connect(lg); lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11 * v, t + 0.01);
    g.gain.linearRampToValueAtTime(0.08 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(g); g.connect(leadBus);
    o.start(t); o.stop(t + dur + 0.1);
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  function tom(t, f0) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.25);
    const g = envGain(t, 0.6, 0.002, 0.28, musicBus); g.connect(gatedIn);
    o.connect(g); o.start(t); o.stop(t + 0.32);
  }

  // lush 80s synth pad (detuned saws, no third so it fits any power chord)
  function pad(t, root, dur) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1900, t + Math.max(0.2, dur * 0.6));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.2);
    g.gain.setValueAtTime(0.045, t + Math.max(0.25, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.45);
    f.connect(g); g.connect(musicBus); g.connect(hallIn);
    for (const iv of [12, 19, 24, 31]) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(root + iv); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.5);
      }
    }
  }

  function arp(t, m, dur) {
    const o = ctx.createOscillator(); o.setPeriodicWave(pulse125);
    o.frequency.value = mtof(m);
    o.connect(envGain(t, 0.045, 0.003, dur, musicBus));
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- the songs
  // Guitar tab notation, 16 sixteenth-steps per bar:
  //   lowercase = palm-muted chug, UPPERCASE = open power chord, '-' = hold, '.' = rest
  // Everything is written relative to E minor; each song's `key` transposes it.
  const NT = { m: 35, k: 36, l: 38, e: 40, h: 41, f: 42, g: 43, a: 45, b: 47, c: 48, d: 50 };
  const toMap = arr => { const m = {}; for (const [s, n, l] of arr) m[s] = [n, l]; return m; };
  const ARP = [0, 7, 12, 19, 24, 19, 12, 7];
  const MINOR = [0, 2, 3, 5, 7, 8, 10]; // E natural minor, as offsets from E

  // diatonic third above (twin-guitar harmony)
  function third(m) {
    const pc = (((m - 4) % 12) + 12) % 12;
    const i = MINOR.indexOf(pc);
    if (i < 0) return m + 3;
    const j = i + 2;
    return m + MINOR[j % 7] + (j >= 7 ? 12 : 0) - MINOR[i];
  }

  // improvised 4-bar solo over E minor pentatonic: a fresh one every time
  const PENT = [59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86];
  const RHYTHMS = [[4], [2, 2], [2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1], [1, 1, 1, 1], [1, 1, 1, 1]];
  function genSolo() {
    const out = [];
    let i = 6, s = 0, dir = 1;
    for (let beat = 0; beat < 16; beat++) {
      if (beat >= 8 && beat < 12) { // repeat the opening motif an octave-ish up: sounds composed
        for (const [st, n, l] of out.filter(o => o[0] >= (beat - 8) * 4 && o[0] < (beat - 7) * 4)) {
          out.push([st + 32, Math.min(88, n + (beat >= 10 ? 5 : 0)), l]);
        }
        s += 4;
        continue;
      }
      const last = beat === 15;
      const r = last || beat === 7 ? [4] : RHYTHMS[(Math.random() * RHYTHMS.length) | 0];
      for (const len of r) {
        if (!last && Math.random() < 0.07) { s += len; continue; }
        if (i >= 10) dir = -1; else if (i <= 2) dir = 1; else if (Math.random() < 0.3) dir = -dir;
        i = Math.max(0, Math.min(PENT.length - 1, i + dir * (Math.random() < 0.75 ? 1 : 2)));
        if (last) i = 7;
        out.push([s, PENT[i], len]);
        s += len;
      }
    }
    return toMap(out);
  }

  const sec = (o) => Object.assign({ bass: 2, oct: false, lead: null, leadMin: 99, arpMin: 99, gv: 1, pad: false, harm: false, crash: false, solo: false }, o);

  // --- 1. PROTOCOL 88: the main theme. E minor gallop, anthem chorus.
  const P88 = {
    name: 'PROTOCOL 88', key: 0, bpmOff: 0,
    order: ['verse', 'chorus', 'solo', 'verse', 'chorus', 'bridge'],
    sec: {
      verse: sec({ gtr: ['e-eee-eee-eeG-A-', 'e-eee-eee-eeD-C-', 'e-eee-eee-eeG-A-', 'C---C-D---D-eeee'], drums: 'rock',
        leadMin: 2, lead: toMap([[0,64,2],[2,67,2],[4,69,2],[6,71,4],[10,69,2],[12,67,2],[14,69,2],[16,64,2],[18,67,2],[20,69,2],[22,74,4],[26,72,2],[28,71,4],
          [32,64,2],[34,67,2],[36,69,2],[38,71,4],[42,74,2],[44,76,4],[48,72,4],[52,74,4],[56,76,8]]) }),
      chorus: sec({ gtr: ['C-------G-------', 'D-------e-e-e-E-', 'C-------G-------', 'D-------D---dddd'], drums: 'chorus', crash: true, arpMin: 3,
        leadMin: 1, lead: toMap([[0,67,4],[4,72,4],[8,71,2],[10,72,2],[12,74,4],[16,74,6],[22,72,2],[24,71,4],[28,67,4],
          [32,67,4],[36,72,4],[40,76,4],[44,74,4],[48,74,4],[52,76,4],[56,79,8]]) }),
      bridge: sec({ gtr: ['e-e-g-e-a-e-g-f-', 'e-e-g-e-b-a-g-a-', 'e-e-g-e-a-e-g-f-', 'G---A---B---B-B-'], drums: 'rock', leadMin: 2,
        lead: toMap([[0,71,6],[6,74,2],[8,76,8],[16,79,4],[20,76,4],[24,74,8]]
          .concat([64,67,69,71,74,76,79,81,79,76,74,71,69,67,64,67].map((n, i) => [32 + i, n, 1]))
          .concat([76,79,81,79,76,74,76,74,71,74,71,69,67].map((n, i) => [48 + i, n, 1]), [[61, 64, 3]])) }),
      solo: sec({ gtr: ['e-eee-eee-eeG-A-', 'e-eee-eee-eeD-C-', 'e-eee-eee-eeG-A-', 'C---C-D---D-eeee'], drums: 'chorus', solo: true, leadMin: 1 }),
    },
  };

  // --- 2. NEON CARNAGE: synth-rock, four-on-the-floor, octave-bounce bass. A minor.
  const NEON = {
    name: 'NEON CARNAGE', key: 5, bpmOff: -8,
    order: ['verse', 'chorus', 'solo', 'verse', 'chorus', 'chorus'],
    sec: {
      verse: sec({ gtr: ['e.e.e.e.e.e.e.e.', 'k.k.k.k.k.k.k.k.', 'l.l.l.l.l.l.l.l.', 'm.m.m.m.M---M---'], drums: 'disco', oct: true, arpMin: 0, gv: 0.75, pad: true,
        leadMin: 2, lead: toMap([0, 16, 32].flatMap(o => [[o,76,1],[o+2,76,1],[o+3,74,1],[o+4,76,2],[o+8,71,2],[o+10,74,2],[o+12,76,4]])
          .concat([[48,74,2],[50,72,2],[52,71,2],[54,69,2],[56,66,8]])) }),
      chorus: sec({ gtr: ['E-------K-------', 'L-------M-------', 'E-------K-------', 'L-------L-l-l-l-'], drums: 'disco', oct: true, arpMin: 0, pad: true, harm: true, crash: true,
        leadMin: 1, lead: toMap([[0,71,4],[4,69,2],[6,67,2],[8,64,8],[16,67,4],[20,69,4],[24,71,8],[32,74,4],[36,72,2],[38,71,2],[40,69,8],[48,66,4],[52,67,4],[56,71,8]]) }),
      solo: sec({ gtr: ['E-------K-------', 'L-------M-------', 'E-------K-------', 'L-------L-l-l-l-'], drums: 'disco', oct: true, arpMin: 2, pad: true, solo: true, leadMin: 1 }),
    },
  };

  // --- 3. STEEL RAIN: thrash gallop, descending riff, twin-guitar harmonies. D minor.
  const STEEL = {
    name: 'STEEL RAIN', key: -2, bpmOff: 12,
    order: ['verse', 'chorus', 'solo', 'verse', 'chorus', 'verse'],
    sec: {
      verse: sec({ gtr: ['e-eed-ddc-ccb-bb', 'e-eed-ddc-ccA---', 'e-eed-ddc-ccb-bb', 'g-ggf-ffe-eeE---'], drums: 'gallop', bass: 1, harm: true,
        leadMin: 1, lead: toMap([[0,76,2],[2,74,1],[3,72,1],[4,71,2],[6,72,1],[7,74,1],[8,76,4],[12,79,4],[16,76,2],[18,74,1],[19,72,1],[20,71,2],[22,69,1],[23,71,1],[24,72,8],
          [32,76,2],[34,74,1],[35,72,1],[36,71,2],[38,72,1],[39,74,1],[40,76,4],[44,79,4],[48,71,4],[52,72,4],[56,74,4],[60,75,4]]) }),
      chorus: sec({ gtr: ['E---D---C---D---', 'E---D---C---B---', 'E---D---C---D---', 'C---D---E-e-e-e-'], drums: 'chorus', harm: true, crash: true,
        leadMin: 1, lead: toMap([[0,71,4],[4,69,4],[8,67,4],[12,69,4],[16,71,4],[20,74,4],[24,72,4],[28,71,4],[32,76,4],[36,74,4],[40,72,4],[44,74,4],[48,72,4],[52,74,4],[56,76,8]]) }),
      solo: sec({ gtr: ['e-eed-ddc-ccb-bb', 'e-eed-ddc-ccA---', 'e-eed-ddc-ccb-bb', 'g-ggf-ffe-eeE---'], drums: 'gallop', bass: 1, solo: true, leadMin: 1 }),
    },
  };

  // --- 4. MIDNIGHT HIGHWAY: big half-time arena anthem in G major. Also the title theme.
  const HWY = {
    name: 'MIDNIGHT HIGHWAY', key: 0, bpmOff: -10,
    order: ['verse', 'chorus', 'solo', 'verse', 'chorus', 'chorus'],
    sec: {
      verse: sec({ gtr: ['G-------G-g-g-g-', 'L-------L-l-l-l-', 'E-------E-e-e-e-', 'K-------K---L---'], drums: 'halftime', pad: true, arpMin: 2,
        leadMin: 1, lead: toMap([[0,67,2],[2,71,2],[4,74,4],[8,71,2],[10,69,2],[12,67,4],[16,66,2],[18,69,2],[20,74,4],[24,72,4],[28,69,4],
          [32,67,2],[34,71,2],[36,74,4],[40,76,4],[44,74,4],[48,72,4],[52,71,4],[56,69,8]]) }),
      chorus: sec({ gtr: ['G---L---E---K---', 'G---L---K---K---', 'G---L---E---K---', 'K---L---G-g-g-g-'], drums: 'rock', pad: true, harm: true, crash: true,
        leadMin: 1, lead: toMap([[0,74,4],[4,74,4],[8,71,4],[12,72,4],[16,74,4],[20,74,4],[24,72,8],[32,74,4],[36,78,4],[40,79,4],[44,76,4],[48,76,4],[52,74,4],[56,71,4],[60,74,4]]) }),
      solo: sec({ gtr: ['G---L---E---K---', 'G---L---K---K---', 'G---L---E---K---', 'K---L---G-g-g-g-'], drums: 'rock', pad: true, solo: true, leadMin: 1 }),
    },
  };

  // --- boss themes
  const HIVE = {
    name: 'HIVE MIND', key: 0, bpmOff: 0,
    order: ['boss', 'boss', 'solo'],
    sec: {
      boss: sec({ gtr: ['eeeehheeggeehhee', 'eeeehheeggeeA-G-', 'eeeehheeggeehhee', 'C-C-C-D-D-D-H-H-'], drums: 'boss', bass: 1, crash: true,
        leadMin: 0, lead: toMap([[0,76,3],[3,77,3],[6,76,2],[8,82,8],[16,76,3],[19,77,3],[22,76,2],[24,79,4],[28,77,4],
          [32,76,3],[35,77,3],[38,76,2],[40,82,6],[46,83,2],[48,84,4],[52,83,4],[56,82,4],[60,77,4]]) }),
      solo: sec({ gtr: ['eeeehheeggeehhee', 'eeeehheeggeeA-G-', 'eeeehheeggeehhee', 'C-C-C-D-D-D-H-H-'], drums: 'boss', bass: 1, solo: true, leadMin: 0 }),
    },
  };
  const TEETH = {
    name: 'QUEEN OF TEETH', key: 2, bpmOff: 6,
    order: ['boss', 'boss', 'solo'],
    sec: {
      boss: sec({ gtr: ['e.e.h.e.e.e.g.f.', 'e.e.h.e.e.e.B-A-', 'e.e.h.e.e.e.g.f.', 'H---H---G---F---'], drums: 'blast', crash: true, pad: true,
        leadMin: 0, lead: toMap([[0,76,4],[4,82,4],[8,76,4],[12,82,4],[16,77,2],[18,76,2],[20,74,2],[22,73,2],[24,72,8],
          [32,76,4],[36,82,4],[40,76,4],[44,82,4],[48,84,4],[52,82,4],[56,81,4],[60,77,4]]) }),
      solo: sec({ gtr: ['e.e.h.e.e.e.g.f.', 'e.e.h.e.e.e.B-A-', 'e.e.h.e.e.e.g.f.', 'H---H---G---F---'], drums: 'blast', solo: true, leadMin: 0 }),
    },
  };

  // --- intermissions
  const STATIC = {
    name: 'STATIC', key: 0, bpmOff: 0, order: ['a'],
    sec: { a: sec({ gtr: ['E---------------', '----------------', 'C---------------', 'D-------D-------'], drums: 'break', bass: 4, arpMin: 0, gv: 0.55 }) },
  };
  const AFTERGLOW = {
    name: 'AFTERGLOW', key: 0, bpmOff: -6, order: ['a'],
    sec: { a: sec({ gtr: ['E---------------', 'K---------------', 'G---------------', 'L-------L-------'], drums: 'drift', bass: 4, arpMin: 0, gv: 0, pad: true }) },
  };

  const SONGS = { wave: [P88, NEON, STEEL, HWY], boss: [HIVE, TEETH], break: [STATIC, AFTERGLOW], menu: [HWY], off: [STATIC] };

  let mode = 'off', pending = null, intensity = 1, baseBpm = 140, bpm = 140;
  let song = STATIC, secPos = 0, secName = 'a', bar = 0, step = 0, nextT = 0, lastRoot = 40;
  let keyShift = 0, fillType = 0, crashNext = false;
  const counters = {}, plays = {};
  let trackFn = null;

  function drums(kind, s, b, t, I) {
    let k = false, sn = false, hv = 0, ho = false;
    const even = s % 2 === 0, q = s % 4;
    switch (kind) {
      case 'rock': k = s === 0 || s === 8 || s === 10 || (I >= 2 && s === 14 && b !== 3) || (I >= 3 && s === 6); sn = s === 4 || s === 12; if (even || I >= 3) hv = q === 0 ? 0.9 : 0.55; break;
      case 'chorus': k = s === 0 || s === 3 || s === 8 || s === 10 || (I >= 3 && even); sn = s === 4 || s === 12; if (q === 2) { hv = 0.7; ho = true; } else if (even || I >= 3) hv = q === 0 ? 0.8 : 0.45; break;
      case 'boss': k = I >= 3 || even; sn = s === 4 || s === 12; hv = q === 0 ? 0.9 : 0.55; break;
      case 'break': k = s === 0 || (b % 2 === 1 && s === 10); sn = b === 3 && s === 12; if (even) hv = q === 0 ? 0.5 : 0.3; break;
      case 'disco': k = q === 0; sn = s === 4 || s === 12; if (q === 2) { hv = 0.75; ho = true; } else if (I >= 2) hv = 0.35; break;
      case 'gallop': k = q !== 1; sn = s === 4 || s === 12; if (even) hv = q === 0 ? 0.8 : 0.5; break;
      case 'halftime': k = s === 0 || s === 10 || (I >= 2 && s === 3); sn = s === 8; if (even) hv = 0.6; else if (I >= 2) hv = 0.3; break;
      case 'blast': k = I >= 3 || even; sn = q === 2; if (even) hv = 0.65; break;
      case 'drift': k = s === 0 || (s === 8 && b % 2 === 1); sn = b === 3 && s === 12; if (q === 2) { hv = 0.3; ho = true; } break;
    }
    let roll = false;
    if (b === 3 && kind !== 'break' && kind !== 'drift') {
      switch (fillType) {
        case 0: if (s >= 12) { sn = true; k = s === 12; roll = true; } break;
        case 1: if (s >= 8 && even) { sn = false; k = s === 8; tom(t, [220, 170, 130, 95][(s - 8) / 2]); } break;
        case 2: if (s === 12 || s === 14) sn = true; if (s === 13 || s === 15) { sn = false; tom(t, s === 13 ? 150 : 100); } break;
        case 3: if (s >= 8) { sn = even || s >= 14; k = s === 8; roll = true; } break;
      }
    }
    if (k) kick(t, s === 0 ? 1 : 0.85);
    if (sn) snare(t, roll && s > 12 ? 0.6 + (s - 12) * 0.13 : 1);
    if (hv) hat(t, hv, ho);
    return { k, sn };
  }

  function playStep(t) {
    const S = song.sec[secName];
    const sd = 60 / bpm / 4;
    const tr = song.key + keyShift;
    let kickHit = false, snareHit = false;
    if (mode !== 'off') {
      if (step === 0 && bar === 0) {
        fillType = (Math.random() * 4) | 0;
        if (S.crash || crashNext) crash(t);
        crashNext = false;
      }
      const row = S.gtr[bar];
      const ch = row[step];
      if (ch !== '-' && ch !== '.') {
        const lc = ch.toLowerCase();
        const open = ch !== lc;
        const m = NT[lc] + tr;
        let len = 1;
        while (step + len < 16 && row[step + len] === '-') len++;
        lastRoot = m;
        if (S.gv > 0) guitar(t, m, open ? len * sd : Math.min(len, 2) * sd * 0.75, open, S.gv * (step % 4 === 0 ? 1 : 0.85));
        if (S.pad && open) pad(t, m, len * sd);
      }
      if (step % S.bass === 0) bass(t, S.oct && step % 4 === 2 ? lastRoot + 12 : lastRoot, S.bass * sd * 0.85);
      const dr = drums(S.drums, step, bar, t, intensity);
      kickHit = dr.k; snareHit = dr.sn;
      if (S.lead && intensity >= S.leadMin) {
        const n = S.lead[bar * 16 + step];
        if (n) {
          lead(t, n[0] + tr, n[1] * sd, 1);
          if (S.harm || (intensity >= 3 && !S.solo)) lead(t, third(n[0]) + tr, n[1] * sd, 0.55);
        }
      }
      if (intensity >= S.arpMin) arp(t, lastRoot + 24 + ARP[step % 8], sd * 0.7);
    }
    if (step % 4 === 0 && beatFn) {
      const info = { beat: step / 4, bar, kick: kickHit, snare: snareHit, mode };
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => beatFn(info), delay);
    }
  }

  function enterSection() {
    secName = song.order[secPos % song.order.length];
    const S = song.sec[secName];
    if (S.solo) S.lead = genSolo();
  }

  function applyPending() {
    const p = pending; pending = null;
    intensity = p.inten;
    if (p.tempo) baseBpm = p.tempo;
    if (p.m !== mode || p.force) {
      mode = p.m;
      const list = SONGS[mode] || SONGS.off;
      counters[mode] = (counters[mode] === undefined ? -1 : counters[mode]) + 1;
      song = list[counters[mode] % list.length];
      plays[song.name] = (plays[song.name] || 0) + 1;
      // when a battle track comes back around, the band plays it higher: classic 80s key change
      keyShift = mode === 'wave' ? ((plays[song.name] - 1) % 3) * 2 : 0;
      secPos = 0; bar = 0;
      enterSection();
      if (mode === 'wave' || mode === 'boss') crashNext = true;
      if (trackFn && mode !== 'off') {
        const info = { name: song.name, mode, key: keyShift };
        setTimeout(() => trackFn(info), 0);
      }
    }
    bpm = baseBpm + song.bpmOff;
    leadDelay.delayTime.setValueAtTime((60 / bpm) * 0.75, ctx.currentTime);
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (nextT < now - 0.05) nextT = now + 0.05;
    while (nextT < now + 0.12) {
      if (step === 0 && pending) applyPending();
      playStep(nextT);
      nextT += 60 / bpm / 4;
      step++;
      if (step >= 16) {
        step = 0; bar++;
        if (bar >= 4) { bar = 0; secPos++; enterSection(); }
      }
    }
  }

  function setMode(m, inten = 1, tempo) {
    if (!ctx) return;
    pending = { m, inten, tempo };
    if (m === 'off') applyPending(); // cut immediately rather than waiting for the bar line
  }

  function nextTrack() {
    if (!ctx || mode === 'off') return;
    pending = { m: mode, inten: intensity, tempo: baseBpm, force: true };
  }

  // ---------------------------------------------------------------- SFX
  const lastPlay = {};
  function ok(name, ms) {
    const n = performance.now();
    if (lastPlay[name] && n - lastPlay[name] < ms) return false;
    lastPlay[name] = n;
    return true;
  }
  function tone(type, f0, f1, dur, vol, t) {
    t = t === undefined ? ctx.currentTime : t;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(envGain(t, vol, 0.002, dur, sfxBus));
    o.start(t); o.stop(t + dur + 0.05);
  }
  function nz(dur, vol, type, f0, f1, q, t) {
    t = t === undefined ? ctx.currentTime : t;
    const n = noiseSrc(t, dur);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    n.connect(f); f.connect(envGain(t, vol, 0.002, dur, sfxBus));
  }
  function pnote(m, dur, vol, t) {
    const o = ctx.createOscillator(); o.setPeriodicWave(pulse25);
    o.frequency.value = mtof(m);
    o.connect(envGain(t, vol, 0.003, dur, sfxBus));
    o.start(t); o.stop(t + dur + 0.03);
  }
  const notes = (arr, step, dur, vol) => {
    const t = ctx.currentTime;
    arr.forEach((m, i) => pnote(m, dur, vol, t + i * step));
  };

  const SFX = {
    pistol()  { tone('square', 880, 160, 0.09, 0.16); nz(0.07, 0.3, 'bandpass', 3200, 900, 0.9); },
    smg()     { if (!ok('smg', 40)) return; tone('square', 1300, 320, 0.05, 0.1); nz(0.05, 0.22, 'bandpass', 4200, 1600, 1); },
    shotgun() { nz(0.32, 0.65, 'lowpass', 5000, 220, 0.8); tone('sine', 150, 40, 0.22, 0.5); tone('square', 400, 60, 0.12, 0.12); },
    rifle()   { if (!ok('rifle', 55)) return; tone('sawtooth', 1800, 220, 0.08, 0.13); nz(0.09, 0.3, 'highpass', 2600, 700, 0.7); },
    rocket()  { nz(0.55, 0.35, 'bandpass', 500, 2600, 2.5); tone('square', 240, 60, 0.3, 0.12); },
    flamer()  { if (!ok('flamer', 70)) return; nz(0.14, 0.14, 'lowpass', 1400, 300, 0.7); },
    rail()    { tone('sawtooth', 2600, 90, 0.4, 0.2); tone('square', 1300, 50, 0.4, 0.12); nz(0.2, 0.25, 'highpass', 6000, 1500, 0.7); },
    minigun() { if (!ok('mini', 30)) return; tone('square', 760, 240, 0.04, 0.08); nz(0.04, 0.2, 'bandpass', 3800, 1500, 1); },
    hit()     { if (!ok('hit', 35)) return; tone('square', rnd(500, 800), rnd(150, 250), 0.05, 0.06); },
    die()     { if (!ok('die', 40)) return; nz(0.22, 0.32, 'lowpass', 2200, 200, 1.5); tone('square', rnd(300, 420), 50, 0.2, 0.1); },
    explode() { if (!ok('boom', 50)) return; nz(0.9, 0.8, 'lowpass', 3000, 60, 0.7); tone('sine', 120, 30, 0.6, 0.7); tone('square', 90, 30, 0.3, 0.15); },
    pickup()  { notes([72, 76, 79], 0.055, 0.07, 0.12); },
    med()     { notes([67, 72, 76, 84], 0.06, 0.08, 0.12); },
    weapon()  { notes([64, 67, 71, 76, 79, 83, 88], 0.06, 0.09, 0.13); tone('sawtooth', 200, 800, 0.4, 0.06); },
    upgrade() { notes([72, 79, 84, 91], 0.07, 0.1, 0.12); },
    overdrive() { notes([60, 64, 67, 72, 76, 79, 84], 0.035, 0.06, 0.12); nz(0.5, 0.2, 'bandpass', 400, 4000, 2); },
    switch()  { tone('square', 600, 900, 0.04, 0.06); },
    hurt()    { if (!ok('hurt', 90)) return; tone('sawtooth', 220, 70, 0.22, 0.25); nz(0.12, 0.25, 'lowpass', 1500, 300, 1); },
    dash()    { nz(0.18, 0.22, 'bandpass', 800, 3500, 1.5); },
    empty()   { if (!ok('empty', 200)) return; tone('square', 1800, 1700, 0.03, 0.08); },
    spit()    { if (!ok('spit', 60)) return; nz(0.15, 0.18, 'bandpass', 900, 2200, 3); tone('sine', 500, 900, 0.1, 0.06); },
    leap()    { if (!ok('leap', 100)) return; tone('sawtooth', 300, 900, 0.15, 0.08); },
    roar()    { if (!ok('roar', 300)) return; tone('sawtooth', 110, 55, 0.6, 0.25); nz(0.6, 0.3, 'lowpass', 900, 200, 2); },
    fuse()    { tone('square', 1200, 2400, 0.3, 0.07); },
    alarm()   { const t = ctx.currentTime; for (let i = 0; i < 3; i++) tone('square', 880, 440, 0.25, 0.12, t + i * 0.3); },
    clear()   { notes([76, 79, 84, 88], 0.09, 0.14, 0.13); },
    death()   { tone('sawtooth', 300, 30, 1.6, 0.3); nz(1.2, 0.4, 'lowpass', 2000, 80, 1); },
    saw()     { tone('sawtooth', 320, 900, 0.18, 0.1); nz(0.15, 0.18, 'bandpass', 2500, 5000, 3); },
    arc()     { if (!ok('arc', 50)) return; nz(0.12, 0.3, 'highpass', 5000, 2000, 1); tone('square', rnd(900, 1400), rnd(80, 200), 0.1, 0.1); },
    drone()   { if (!ok('drone', 70)) return; tone('square', 1500, 600, 0.03, 0.04); },
    ricochet(){ if (!ok('rico', 60)) return; tone('triangle', rnd(1800, 2600), rnd(900, 1300), 0.12, 0.08); },
    block()   { if (!ok('block', 50)) return; tone('square', 2200, 1800, 0.04, 0.06); nz(0.05, 0.12, 'highpass', 6000, 3000, 1); },
    shield()  { if (!ok('shield', 80)) return; tone('sine', 900, 1500, 0.12, 0.12); tone('triangle', 450, 700, 0.12, 0.06); },
    shieldbreak() { nz(0.5, 0.35, 'highpass', 4000, 800, 1); tone('square', 1200, 100, 0.4, 0.12); },
    gear()    { notes([60, 67, 72, 76, 79, 84], 0.05, 0.12, 0.13); tone('sawtooth', 100, 400, 0.35, 0.08); },
    nova()    { nz(0.9, 0.6, 'lowpass', 6000, 100, 0.6); tone('sine', 400, 40, 0.8, 0.5); notes([84, 79, 76, 72], 0.04, 0.1, 0.1); },
    chrono()  { tone('sine', 1200, 300, 0.8, 0.15); notes([84, 83, 84, 83], 0.12, 0.08, 0.08); },
    aegis()   { notes([72, 76, 79, 84, 88], 0.05, 0.1, 0.12); tone('sine', 300, 600, 0.5, 0.1); },
    burrow()  { if (!ok('burrow', 150)) return; nz(0.45, 0.35, 'lowpass', 400, 120, 2); },
    hatch()   { if (!ok('hatch', 100)) return; nz(0.18, 0.25, 'bandpass', 600, 1800, 4); tone('square', 200, 600, 0.12, 0.06); },
    buzz()    { if (!ok('buzz', 120)) return; tone('sawtooth', 180, 260, 0.4, 0.09); },
    thud()    { tone('sine', 120, 40, 0.25, 0.4); nz(0.15, 0.25, 'lowpass', 900, 200, 1); },
  };

  function sfx(name) {
    if (!ctx || ctx.state !== 'running') return;
    const f = SFX[name];
    if (f) f();
  }

  return {
    init,
    setMode,
    sfx,
    onBeat(fn) { beatFn = fn; },
    onTrack(fn) { trackFn = fn; },
    nextTrack,
    get track() { return mode === 'off' ? null : song.name; },
    running() { return !!ctx && ctx.state === 'running'; },
    suspend() { if (ctx) ctx.suspend(); },
    resume() { if (ctx) ctx.resume(); },
    toggleMusic() {
      musicMuted = !musicMuted;
      if (ctx) musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_VOL * musicLevel, ctx.currentTime, 0.05);
      return musicMuted;
    },
    get musicMuted() { return musicMuted; },
    setVolumes(m, fx) {
      musicLevel = m; sfxLevel = fx;
      if (!ctx) return;
      musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_VOL * musicLevel, ctx.currentTime, 0.05);
      sfxBus.gain.setTargetAtTime(SFX_VOL * sfxLevel, ctx.currentTime, 0.05);
    },
  };
})();
