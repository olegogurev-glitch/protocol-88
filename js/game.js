'use strict';
/*
 * PROTOCOL 88 — top-down alien wave shooter
 * Vanilla JS + Canvas 2D. All art is procedural; all audio comes from js/audio.js.
 */
(() => {
  const A = window.AudioEngine;
  const cvs = document.getElementById('game');
  const mainCtx = cvs.getContext('2d');
  let ctx = mainCtx; // swapped temporarily when stamping corpses onto the floor or drawing the actor layer
  let noBlob = false; // true while drawing into the actor layer, which casts real shadows instead
  const FONT = '"Press Start 2P", "Courier New", monospace';
  const font = px => `${Math.round(px)}px ${FONT}`;
  // UI: a clean condensed tech face for small labels and numbers; pixel font stays for headlines
  const UI = '"Chakra Petch", "Arial Narrow", sans-serif';
  const ufont = (px, wt = 600) => `${wt} ${Math.round(px)}px ${UI}`;
  if (document.fonts && document.fonts.load) {
    document.fonts.load('16px "Press Start 2P"').catch(() => {});
    for (const wt of [500, 600, 700]) document.fonts.load(`${wt} 16px "Chakra Petch"`).catch(() => {});
  }

  // ======================================================================= utils
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const choose = arr => arr[(Math.random() * arr.length) | 0];
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
    return px * px + py * py <= r * r;
  }
  function compact(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
  }
  function ell(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }
  function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }

  // light colors as "r,g,b", pulled toward white so saturated neon still lights the floor
  const lcCache = {};
  function lc(hex, w = 0.3) {
    const k = hex + w;
    let c = lcCache[k];
    if (c) return c;
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return (lcCache[k] = '255,255,255');
    const n = parseInt(hex.slice(1), 16), m = v => Math.round(v + (255 - v) * w);
    return (lcCache[k] = `${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)}`);
  }
  const WHITE_L = '255,255,255', SUIT_L = '226,236,255';

  const glowCache = {};
  function glowSprite(color) {
    let c = glowCache[color];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color); gr.addColorStop(0.22, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (glowCache[color] = c);
  }
  function glow(color, x, y, r, a = 1) {
    if (a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  // ======================================================================= screen
  let W = 0, H = 0, DPR = 1, VIEW = 1, VIEW_BASE = 1;
  // phones and tablets: primary pointer is a finger. Drives layout (zoom, UI scale, render
  // resolution, landscape lock); the on-screen controls follow touch.using instead.
  const TOUCH = (() => { try { return matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window; } catch (e) { return false; } })();
  let UIS = 1; // screen-UI scale: HUD and menus are drawn at UIS and laid out in W/UIS x H/UIS
  const safe = { l: 0, r: 0, t: 0, b: 0 }; // notch / home-indicator insets in CSS px
  const safeProbe = document.getElementById('safe');
  function readSafe() {
    if (!safeProbe) return;
    const cs = getComputedStyle(safeProbe);
    safe.l = parseFloat(cs.paddingLeft) || 0; safe.r = parseFloat(cs.paddingRight) || 0;
    safe.t = parseFloat(cs.paddingTop) || 0; safe.b = parseFloat(cs.paddingBottom) || 0;
  }
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  const DS = 0.5;

  // ======================================================================= post-processing
  // Screen-space finish applied after the world is drawn: scene bloom (downsample, soft
  // threshold by squaring, blur, add back), impact chromatic aberration, vignette, film
  // grain and optional scanlines. Canvas 2D only; quality follows settings.fx / settings.crt.
  const mkCanvas = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const bHalf = mkCanvas(), bQ = mkCanvas(), bTmp = mkCanvas(), bWide = mkCanvas();
  const bHalfX = bHalf.getContext('2d'), bQX = bQ.getContext('2d'), bTmpX = bTmp.getContext('2d'), bWideX = bWide.getContext('2d');
  let caA = null, caB = null, caAX = null, caBX = null; // full-res scratch for aberration, made on first use
  let aberr = 0; // 0..1, kicked by heavy impacts and decays in update()
  const canFilter = (() => {
    try {
      const g = mkCanvas(16, 16).getContext('2d');
      g.filter = 'blur(3px)'; g.fillStyle = '#fff'; g.fillRect(7, 7, 2, 2);
      return g.getImageData(4, 8, 1, 1).data[3] > 0;
    } catch (e) { return false; }
  })();
  const vignette = (() => {
    // square radial gradient, stretched to the screen so it becomes an ellipse
    const c = mkCanvas(256, 256), g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 181);
    gr.addColorStop(0, 'rgba(0,0,6,0)'); gr.addColorStop(0.5, 'rgba(0,0,6,0)');
    gr.addColorStop(0.8, 'rgba(0,0,6,0.32)'); gr.addColorStop(1, 'rgba(0,0,6,0.78)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return c;
  })();
  const grain = Array.from({ length: 4 }, () => {
    const c = mkCanvas(128, 128), g = c.getContext('2d'), img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 150;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return mainCtx.createPattern(c, 'repeat');
  });
  const scanlines = (() => {
    const c = mkCanvas(1, 3), g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 2, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 1, 1);
    return mainCtx.createPattern(c, 'repeat');
  })();
  let grainIdx = 0, grainOX = 0, grainOY = 0, grainT = 0;

  function postResize() {
    const sz = (c, d) => { c.width = Math.max(1, Math.ceil(W / d)); c.height = Math.max(1, Math.ceil(H / d)); };
    sz(bHalf, 2); sz(bQ, 4); sz(bTmp, 4); sz(bWide, 8); sz(shC, 2);
    actL.width = cvs.width; actL.height = cvs.height;
    for (const g of [bHalfX, bQX, bTmpX, bWideX]) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium'; }
    if (caA) { caA.width = caB.width = cvs.width; caA.height = caB.height = cvs.height; }
  }

  // Bloom from the finished scene: everything bright (neon, muzzle flashes, beams, the
  // menu sun) bleeds light; the dark floor squares to ~0 and contributes nothing.
  function bloom(k, wide) {
    bHalfX.globalCompositeOperation = 'copy'; bHalfX.drawImage(cvs, 0, 0, bHalf.width, bHalf.height);
    bQX.globalCompositeOperation = 'copy'; bQX.drawImage(bHalf, 0, 0, bQ.width, bQ.height);
    bTmpX.globalCompositeOperation = 'copy'; bTmpX.drawImage(bQ, 0, 0);
    bQX.globalCompositeOperation = 'multiply'; bQX.drawImage(bTmp, 0, 0); // x^2 soft threshold
    let tight = bQ;
    if (canFilter) {
      bTmpX.filter = 'blur(2.5px)'; bTmpX.drawImage(bQ, 0, 0); bTmpX.filter = 'none';
      tight = bTmp;
    }
    if (wide) {
      bWideX.globalCompositeOperation = 'copy';
      if (canFilter) bWideX.filter = 'blur(4px)';
      bWideX.drawImage(bQ, 0, 0, bWide.width, bWide.height);
      bWideX.filter = 'none';
    }
    const g = mainCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = k; g.drawImage(tight, 0, 0, cvs.width, cvs.height);
    if (wide) { g.globalAlpha = k * 0.8; g.drawImage(bWide, 0, 0, cvs.width, cvs.height); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function ensureScratch() {
    if (caA) return;
    caA = mkCanvas(cvs.width, cvs.height); caB = mkCanvas(cvs.width, cvs.height);
    caAX = caA.getContext('2d'); caBX = caB.getContext('2d');
  }

  // Ground actors (aliens, bosses, the soldier) are drawn to their own layer. From its
  // silhouette we cast soft shadows away from the soldier's lamp, and cut a thin rim of
  // light on the edges that face the lamp.
  const actL = mkCanvas(), actX = actL.getContext('2d'), shC = mkCanvas(), shdX = shC.getContext('2d');
  function lampScreen(tx, ty) {
    const o = player || cam;
    return [DPR * (tx + o.x * VIEW), DPR * (ty + o.y * VIEW)];
  }
  function beginActors() {
    actX.setTransform(1, 0, 0, 1, 0, 0);
    actX.clearRect(0, 0, actL.width, actL.height);
    ctx = actX; noBlob = true;
  }
  function endActors(tx, ty) {
    ctx = mainCtx; noBlob = false;
    const [lx, ly] = lampScreen(tx, ty), k = shC.width / actL.width, s = 1.05;
    const ox = 3 * VIEW * DPR, oy = 5 * VIEW * DPR;
    shdX.setTransform(1, 0, 0, 1, 0, 0);
    shdX.globalCompositeOperation = 'source-over';
    shdX.clearRect(0, 0, shC.width, shC.height);
    shdX.setTransform(k * s, 0, 0, k * s, k * (lx - s * lx + ox), k * (ly - s * ly + oy));
    if (canFilter) shdX.filter = 'blur(2px)';
    shdX.drawImage(actL, 0, 0);
    shdX.filter = 'none';
    shdX.setTransform(1, 0, 0, 1, 0, 0);
    shdX.globalCompositeOperation = 'source-in';
    shdX.fillStyle = '#000'; shdX.fillRect(0, 0, shC.width, shC.height);
    const g = mainCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.55; g.drawImage(shC, 0, 0, cvs.width, cvs.height);
    g.globalAlpha = 1; g.drawImage(actL, 0, 0);
  }
  // after the light map: give aliens and the soldier back part of their own color so they
  // read against the floor in the dark, then cut the rim
  function liftActors() {
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalCompositeOperation = 'lighter';
    mainCtx.globalAlpha = 0.28; mainCtx.drawImage(actL, 0, 0); mainCtx.globalAlpha = 1;
    mainCtx.globalCompositeOperation = 'source-over';
  }
  function drawRim(tx, ty) {
    if (!player || state === 'dying' || state === 'over') return;
    ensureScratch();
    const [lx, ly] = lampScreen(tx, ty), s = 1.009, g = caBX, w = caB.width, h = caB.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy'; g.drawImage(actL, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.setTransform(s, 0, 0, s, lx - s * lx, ly - s * ly); g.drawImage(actL, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#cfe2ff'; g.fillRect(0, 0, w, h);
    const R = 560 * VIEW * DPR, gr = g.createRadialGradient(lx, ly, 0, lx, ly, R);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalCompositeOperation = 'lighter';
    mainCtx.globalAlpha = 0.5; mainCtx.drawImage(caB, 0, 0); mainCtx.globalAlpha = 1;
    mainCtx.globalCompositeOperation = 'source-over';
  }

  // Radial chromatic aberration: red scaled out from the centre, blue scaled in, green stays.
  function aberration(px) {
    const w = cvs.width, h = cvs.height, d = px * DPR, dy = d * h / w, g = mainCtx;
    ensureScratch();
    caAX.globalCompositeOperation = 'copy'; caAX.drawImage(cvs, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#00ff00'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const [col, s] of [['#ff0000', 1], ['#0000ff', -1]]) {
      caBX.globalCompositeOperation = 'copy'; caBX.drawImage(caA, 0, 0);
      caBX.globalCompositeOperation = 'multiply'; caBX.fillStyle = col; caBX.fillRect(0, 0, w, h);
      g.drawImage(caB, -d * s, -dy * s, w + 2 * d * s, h + 2 * dy * s);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // shockwave ripples: a ring of the scene, magnified slightly, expanding outward like a lens
  function drawRipples(tx, ty) {
    if (!ripples.length) return;
    ensureScratch();
    caAX.globalCompositeOperation = 'copy'; caAX.setTransform(1, 0, 0, 1, 0, 0); caAX.drawImage(cvs, 0, 0);
    const g = mainCtx;
    for (const r of ripples) {
      const f = r.t / r.dur, e = 1 - Math.pow(1 - f, 3);
      const cx = DPR * (tx + r.x * VIEW), cy = DPR * (ty + r.y * VIEW);
      const rad = r.R * e * VIEW * DPR, w = (34 - 18 * f) * VIEW * DPR, s = 1 + r.amp * (1 - f);
      if (rad < 2) continue;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.beginPath(); g.arc(cx, cy, rad + w, 0, TAU); g.arc(cx, cy, Math.max(0, rad - w), 0, TAU, true); g.clip();
      g.setTransform(s, 0, 0, s, cx - s * cx, cy - s * cy);
      g.drawImage(caA, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,240,255,${(0.12 * (1 - f)).toFixed(3)})`; g.lineWidth = w * 0.25;
      g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke();
      g.restore();
    }
  }

  // world-layer finish: runs before the HUD so text stays crisp and readable
  function postWorld(menu) {
    const fx = settings.fx;
    if (fx === 0) return;
    bloom(menu ? 0.4 : 0.7, fx === 2);
    if (aberr > 0.02) aberration(aberr * 7);
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalAlpha = fx === 2 ? 1 : 0.75;
    mainCtx.drawImage(vignette, 0, 0, cvs.width, cvs.height);
    mainCtx.globalAlpha = 1;
  }

  // screen-layer finish over everything (HUD included), like the image on a monitor
  function postScreen(rdt) {
    const g = mainCtx;
    if (settings.fx === 2) {
      grainT += rdt;
      if (grainT > 1 / 24) { grainT = 0; grainIdx = (grainIdx + 1) % grain.length; grainOX = Math.random() * 128; grainOY = Math.random() * 128; }
      g.setTransform(DPR, 0, 0, DPR, -grainOX * DPR, -grainOY * DPR);
      g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.09;
      g.fillStyle = grain[grainIdx]; g.fillRect(grainOX, grainOY, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    if (settings.crt) {
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalAlpha = 0.5; g.fillStyle = scanlines; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.5 : 2); // phones: bloom and lighting at 3x DPR cost too much
    // a hidden or minimised window can report 0x0; a zero-size canvas makes every
    // drawImage(cvs) in the post-FX throw, so never go below one pixel
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    cvs.width = Math.max(1, Math.floor(W * DPR)); cvs.height = Math.max(1, Math.floor(H * DPR));
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    dark.width = Math.ceil(W * DS); dark.height = Math.ceil(H * DS);
    // a phone in landscape is ~850x390: zoom out further so aliens don't arrive from off-screen at once
    VIEW = VIEW_BASE = TOUCH ? clamp(Math.min(W / 1150, H / 680), 0.5, 1.2) : clamp(Math.min(W / 1400, H / 880), 0.68, 1.4);
    UIS = TOUCH ? clamp(Math.min(H / 500, W / 900), 0.6, 1) : 1;
    readSafe();
    postResize();
    if (typeof onResizeHook === 'function') onResizeHook();
  }
  let onResizeHook = null;
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 250)); // iOS reports the new size late
  resize();

  // ======================================================================= storage
  let best = { wave: 0, score: 0 };
  try { best = JSON.parse(localStorage.getItem('p88-best')) || best; } catch (e) { /* private mode */ }
  function saveBest() { try { localStorage.setItem('p88-best', JSON.stringify(best)); } catch (e) { /* ignore */ } }

  // ---- meta progression: lifetime counters unlock starting kits
  const NO_SAVE = /[?&]bot\b/.test(location.search); // bot runs never touch the player's profile
  const PROFILE0 = { runs: 0, kills: 0, bestWave: 0, bosses: {}, burnKills: 0, bounties: 0, mods: 0, unlocked: ['standard'], kit: 0 };
  let profile = { ...PROFILE0, bosses: {} };
  try { if (!NO_SAVE) profile = { ...profile, ...JSON.parse(localStorage.getItem('p88-profile') || '{}') }; } catch (e) { /* private mode */ }
  profile.bestWave = Math.max(profile.bestWave, NO_SAVE ? 0 : best.wave || 0); // players from before profiles keep their best wave
  function saveProfile() { if (NO_SAVE) return; try { localStorage.setItem('p88-profile', JSON.stringify(profile)); } catch (e) { /* ignore */ } }

  // ======================================================================= data
  const WEAPONS = [
    { id: 'pistol',  name: 'M-88 BLASTER',  short: 'BLASTER', kind: 'bullet', dmg: 24, rate: 5,   spread: 0.035, speed: 1100, life: 0.9,  r: 3,   color: '#ffe27a', knock: 140, shake: 2,   recoil: 3,  len: 16, ammoMax: Infinity, start: Infinity, pick: 0 },
    { id: 'smg',     name: 'VIPER SMG',     short: 'VIPER',   kind: 'bullet', dmg: 14, rate: 15,  spread: 0.13,  speed: 1150, life: 0.7,  r: 2.5, color: '#9effa0', knock: 70,  shake: 1.5, recoil: 2,  len: 20, ammoMax: 500, start: 250, pick: 150 },
    { id: 'shotgun', name: 'THUNDER-12',    short: 'THUNDER', kind: 'bullet', dmg: 15, rate: 1.7, spread: 0.42,  speed: 1000, life: 0.42, r: 3,   color: '#ffb35c', knock: 200, shake: 7,   recoil: 9,  len: 24, ammoMax: 80,  start: 40,  pick: 24, pellets: 9, speedVar: 0.25 },
    { id: 'rifle',   name: 'PULSE RIFLE',   short: 'PULSE',   kind: 'bullet', dmg: 30, rate: 9,   spread: 0.04,  speed: 1500, life: 0.8,  r: 3,   color: '#7cf3ff', knock: 120, shake: 2.5, recoil: 3,  len: 28, ammoMax: 400, start: 200, pick: 120, pierce: 2 },
    { id: 'rocket',  name: 'NUKA LAUNCHER', short: 'NUKA',    kind: 'rocket', dmg: 140, rate: 1.5, spread: 0.02, speed: 700,  life: 1.6,  r: 6,   color: '#ff7b3a', knock: 0,   shake: 4,   recoil: 12, len: 26, ammoMax: 40,  start: 16,  pick: 8, splash: 140 },
    { id: 'flamer',  name: 'HELLFIRE',      short: 'HELLFIRE',kind: 'flame',  dmg: 9,  rate: 36,  spread: 0.22,  speed: 560,  life: 0.5,  r: 8,   color: '#ff9a2e', knock: 25,  shake: 0.6, recoil: 1,  len: 24, ammoMax: 600, start: 300, pick: 180 },
    { id: 'rail',    name: 'PHOTON RAIL',   short: 'PHOTON',  kind: 'rail',   dmg: 220, rate: 1.3, spread: 0,    speed: 0,    life: 0,    r: 0,   color: '#d97bff', knock: 260, shake: 8,   recoil: 10, len: 32, ammoMax: 40,  start: 20,  pick: 10 },
    { id: 'minigun', name: 'DEVASTATOR',    short: 'DEVASTATOR', kind: 'bullet', dmg: 16, rate: 30, spread: 0.16, speed: 1300, life: 0.8, r: 3,  color: '#fff07a', knock: 90,  shake: 2,   recoil: 2,  len: 28, ammoMax: 900, start: 500, pick: 250, spin: true },
    { id: 'saw',     name: 'RIPPER DISC',   short: 'RIPPER',  kind: 'saw',    dmg: 42, rate: 2.6, spread: 0.03,  speed: 760,  life: 2.4,  r: 9,   color: '#c8ff3a', knock: 110, shake: 2.5, recoil: 5,  len: 22, ammoMax: 60,  start: 30,  pick: 18, bounces: 4 },
    { id: 'arc',     name: 'ARC CASTER',    short: 'ARC',     kind: 'arc',    dmg: 36, rate: 4.5, spread: 0,     speed: 0,    life: 0,    r: 0,   color: '#8ab8ff', knock: 60,  shake: 2,   recoil: 3,  len: 22, ammoMax: 220, start: 110, pick: 60, range: 440, chains: 4 },
  ];
  // which wave's carrier drops which new weapon (index into WEAPONS)
  const UNLOCK = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 8, 8: 6, 9: 9, 10: 7 };
  // the weapon wave n's carrier drops: that wave's own unlock, or - once it's owned (or the
  // wave has none) - the earliest weapon from an earlier wave the player missed. A weapon
  // still lying on the floor doesn't count as missed, so it's never dropped twice.
  function carrierWeapon(n) {
    const want = i => !player.ws[i].owned && !pickups.some(pk => pk.kind === 'weapon' && pk.wi === i && !pk.dead);
    if (UNLOCK[n] !== undefined && want(UNLOCK[n])) return UNLOCK[n];
    for (let w = 2; w < n; w++) if (UNLOCK[w] !== undefined && want(UNLOCK[w])) return UNLOCK[w];
    return undefined;
  }

  const ET = {
    crawler:  { name: 'CRAWLER',  hp: 30,  speed: 185, r: 13, dmg: 10, score: 10,  mass: 1,   first: 1,  body: '#3f8f2a', dark: '#1d4513', eye: '#ff3030', blood: '#7bd12a', desc: 'FAST. HUNGRY. MANY.' },
    leaper:   { name: 'LEAPER',   hp: 26,  speed: 150, r: 12, dmg: 12, score: 15,  mass: 0.8, first: 2,  body: '#2c8f8f', dark: '#124545', eye: '#fff13a', blood: '#3fe0d0', desc: 'POUNCES FROM RANGE' },
    spitter:  { name: 'SPITTER',  hp: 50,  speed: 115, r: 16, dmg: 8,  score: 20,  mass: 1.2, first: 3,  body: '#7a3fa0', dark: '#3a1a52', eye: '#7dff3a', blood: '#c06bff', desc: 'KEEPS DISTANCE. SPITS ACID.' },
    brute:    { name: 'BRUTE',    hp: 260, speed: 80,  r: 27, dmg: 25, score: 60,  mass: 4,   first: 4,  body: '#9a3b22', dark: '#4a1a0e', eye: '#ffb020', blood: '#e0602a', desc: 'ARMORED. CHARGES.' },
    boomer:   { name: 'BOOMER',   hp: 45,  speed: 140, r: 17, dmg: 35, score: 25,  mass: 1.3, first: 6,  body: '#c9a224', dark: '#5e4a0c', eye: '#ff2a2a', blood: '#ffd23a', desc: 'EXPLODES. CHAIN THEM.' },
    phantom:  { name: 'PHANTOM',  hp: 70,  speed: 205, r: 14, dmg: 16, score: 35,  mass: 1,   first: 8,  body: '#5a6a8a', dark: '#242c40', eye: '#9ae6ff', blood: '#8ab0ff', desc: 'CLOAKS IN THE DARK.' },
    burrower: { name: 'BURROWER', hp: 60,  speed: 250, r: 15, dmg: 18, score: 30,  mass: 1.2, first: 9,  body: '#8a6a3a', dark: '#3e2c14', eye: '#ff9a2a', blood: '#d0a050', desc: 'TUNNELS UNDER YOUR FEET.' },
    warden:   { name: 'WARDEN',   hp: 150, speed: 95,  r: 20, dmg: 20, score: 50,  mass: 2.5, first: 11, body: '#3a5a8a', dark: '#18243e', eye: '#5affff', blood: '#5ab0ff', desc: 'FRONT SHIELD. FLANK IT.' },
    hatcher:  { name: 'HATCHER',  hp: 190, speed: 70,  r: 24, dmg: 15, score: 60,  mass: 3,   first: 12, body: '#8a7a2a', dark: '#3c3410', eye: '#ff4a4a', blood: '#e0d060', desc: 'LAYS EGGS. BURSTS INTO MITES.' },
    wasp:     { name: 'STINGER',  hp: 40,  speed: 230, r: 12, dmg: 14, score: 30,  mass: 0.7, first: 13, body: '#d06020', dark: '#5a2a0a', eye: '#ffff5a', blood: '#ff9a3a', desc: 'FLIES OVER COVER. DIVES.' },
    mite:     { name: 'MITE',     hp: 8,   speed: 255, r: 7,  dmg: 5,  score: 3,   mass: 0.4, first: 999, body: '#b8a838', dark: '#4a4210', eye: '#ff4a4a', blood: '#e0d060', desc: '' },
    egg:      { name: 'EGG',      hp: 28,  speed: 0,   r: 11, dmg: 0,  score: 5,   mass: 50,  first: 999, body: '#d8c870', dark: '#6a5a20', eye: '#ff4a4a', blood: '#e0d060', desc: '' },
    queen:    { name: 'HIVE QUEEN', hp: 2600, speed: 75, r: 50, dmg: 24, score: 1000, mass: 20, first: 999, body: '#a0206a', dark: '#4a0a30', eye: '#ff3af0', blood: '#ff4ad0', desc: '', boss: true, color: '#ff3af0', intro: 'THE HIVE QUEEN AWAKENS' },
    specimen: { name: 'SPECIMEN X', hp: 3000, speed: 85, r: 46, dmg: 26, score: 1200, mass: 20, first: 999, body: '#3a9a5a', dark: '#103a20', eye: '#e8ff3a', blood: '#7aff5a', desc: '', boss: true, color: '#7aff5a', intro: 'SOMETHING BROKE OUT OF ITS TANK' },
    titan:    { name: 'BROOD TITAN', hp: 3400, speed: 60, r: 56, dmg: 30, score: 1400, mass: 25, first: 999, body: '#8a6a1a', dark: '#3a2a08', eye: '#ff6a2a', blood: '#e0c050', desc: '', boss: true, color: '#ffb02a', intro: 'THE NEST PROTECTS ITS MOTHER' },
    behemoth: { name: 'MOLTEN BEHEMOTH', hp: 3800, speed: 70, r: 54, dmg: 32, score: 1600, mass: 30, first: 999, body: '#4a3226', dark: '#21140c', eye: '#ffcf3a', blood: '#ff8a2a', desc: '', boss: true, color: '#ff7a1a', intro: 'THE CORE HAS A GUARDIAN' },
  };
  const isBoss = e => !!ET[e.type].boss;
  const ARENA_BOSS = ['queen', 'specimen', 'titan', 'behemoth'];
  const INTRO_ORDER = ['crawler', 'leaper', 'spitter', 'brute', 'boomer', 'phantom', 'burrower', 'warden', 'hatcher', 'wasp'];
  const WEIGHT = { crawler: 10, leaper: 4, spitter: 3, brute: 1.6, boomer: 2.5, phantom: 2.5, burrower: 2.4, warden: 1.5, hatcher: 1.1, wasp: 2.6 };
  const TAUNTS = ['THEY SMELL YOU', 'HOLD THE LINE', 'NO RETREAT', 'MORE OF THEM', 'THE HIVE IS ANGRY', 'LOCK AND LOAD', 'KEEP MOVING'];

  // permanent gear, picked from supply drops after each wave; every level shows on the soldier
  const GEAR = {
    armor:  { name: 'KEVLAR-X ARMOR', max: 3, desc: '-12% DAMAGE TAKEN',       color: '#c8d0e0', icon: 'A' },
    vital:  { name: 'VITAL CORE',     max: 4, desc: '+25 MAX HEALTH',          color: '#5dff8a', icon: '+' },
    shield: { name: 'AEGIS EMITTER',  max: 3, desc: '+30 REGENERATING SHIELD', color: '#5ad1ff', icon: 'O' },
    boots:  { name: 'SERVO BOOTS',    max: 3, desc: '+8% SPEED, FASTER DASH',  color: '#ffd23a', icon: '>' },
    drone:  { name: 'SENTRY DRONE',   max: 2, desc: 'AUTO-FIRING COMPANION',   color: '#ff7ad8', icon: '*' },
  };
  const GEAR_KEYS = Object.keys(GEAR);

  // temporary power-ups (random drops)
  const POWER = {
    overdrive: { name: 'OVERDRIVE', color: '#ff2a4a', dur: 8 },
    aegis:     { name: 'INVULNERABLE', color: '#ffd23a', dur: 5 },
    chrono:    { name: 'CHRONO FIELD', color: '#7ad8ff', dur: 6 },
    nova:      { name: 'NOVA BLAST', color: '#ff7ad8', dur: 0 },
  };

  // perks: behaviour-changing upgrades offered in supply drops next to gear. desc[i] is what level i+1 gives.
  // tags drive synergy - drops favour perks that share a tag with ones you own - and some perks need a partner.
  const PERKS = {
    ignite:    { name: 'INCENDIARY ROUNDS', max: 2, color: '#ff7a1a', icon: 'I', tags: ['fire'],          desc: ['HITS CAN IGNITE ALIENS', 'IGNITE CHANCE DOUBLED'] },
    trail:     { name: 'AFTERBURNER',       max: 2, color: '#ff9a3a', icon: '~', tags: ['fire', 'dash'],  desc: ['DASH LEAVES A FIRE TRAIL', 'WIDER, LONGER TRAIL'] },
    pyre:      { name: 'PYROMANIAC',        max: 2, color: '#ff5a2a', icon: 'P', tags: ['fire', 'boom'],  desc: ['BURNING ALIENS EXPLODE', 'BIGGER DEATH BLASTS'],
                 needs: p => p.perk.ignite > 0 || p.perk.trail > 0, needName: 'A FIRE PERK' },
    chain:     { name: 'CHAIN REACTION',    max: 2, color: '#ffcf3a', icon: 'C', tags: ['boom'],          desc: ['KILLS MAY DETONATE', 'DETONATE TWICE AS OFTEN'] },
    blast:     { name: 'KINETIC DASH',      max: 2, color: '#7ae0ff', icon: 'K', tags: ['dash', 'boom'],  desc: ['DASH ENDS IN A SHOCKWAVE', 'BIGGER, ERASES SPIT'] },
    ricochet:  { name: 'RICOCHET',          max: 2, color: '#c8ff3a', icon: 'R', tags: ['gun'],           desc: ['BULLETS BOUNCE ONCE', 'BULLETS BOUNCE TWICE'] },
    frenzy:    { name: 'FRENZY',            max: 2, color: '#ff6ad8', icon: 'Z', tags: ['gun', 'combo'],  desc: ['KILLS: +2% FIRE RATE', '+3% PER KILL, CAP 50%'] },
    streak:    { name: 'HOT STREAK',        max: 2, color: '#ff2a4a', icon: 'S', tags: ['combo'],         desc: ['X4 COMBO: OVERDRIVE', 'X4 AND X8: LONGER'] },
    static:    { name: 'STATIC FIELD',      max: 2, color: '#8ab8ff', icon: 'E', tags: ['shock', 'combo'], desc: ['EVERY 12 KILLS: LIGHTNING', 'EVERY 8 KILLS, MORE ARCS'] },
    leech:     { name: 'BLOODLUST',         max: 2, color: '#ff3a5a', icon: 'L', tags: ['combo'],         desc: ['KILLS HEAL, MORE WHEN LOW', 'KILLS HEAL TWICE AS MUCH'] },
    dronelink: { name: 'DRONE LINK',        max: 2, color: '#ff7ad8', icon: 'D', tags: ['drone', 'gun'],  desc: ['DRONES FIRE 2X, PIERCE', 'DRONES USE YOUR PERKS'],
                 needs: p => p.gear.drone > 0, needName: 'A SENTRY DRONE' },
    scavenger: { name: 'SCAVENGER',         max: 1, color: '#5affc8', icon: '$', tags: [],                desc: ['BIG MAGNET, MORE AMMO'] },
  };
  const PERK_KEYS = Object.keys(PERKS);

  // elite affixes: carriers (from wave 4) and champions (from wave 6) roll one or two of these
  const AFFIX = {
    swift:     { name: 'SWIFT',     color: '#9ae6ff' },
    regen:     { name: 'REGENERATING', color: '#5dff8a' },
    splitter:  { name: 'SPLITTER',  color: '#c8ff3a' },
    volatile:  { name: 'VOLATILE',  color: '#ff7a1a', not: ['boomer'] },
    toxic:     { name: 'TOXIC',     color: '#9dff3a', not: ['burrower'] },
    commander: { name: 'COMMANDER', color: '#ff4f6d' },
  };
  const AFFIX_KEYS = Object.keys(AFFIX);
  const hasAff = (e, k) => !!e.affix && e.affix.includes(k);
  function rollAffixes(type, n) {
    const pool = AFFIX_KEYS.filter(k => !(AFFIX[k].not || []).includes(type)).sort(() => Math.random() - 0.5);
    return pool.slice(0, n);
  }

  // wave modifiers: some waves after the opening stretch get a twist, announced on the banner.
  // Clearing one pays a bigger bonus and drops a power-up.
  const MODS = {
    blackout: { name: 'BLACKOUT',   color: '#a99aff', desc: 'THE LIGHTS ARE OUT', from: 6 },
    swarm:    { name: 'SWARM',      color: '#7bd12a', desc: 'TWICE AS MANY, HALF AS TOUGH', from: 6 },
    ambush:   { name: 'AMBUSH',     color: '#ff4f6d', desc: 'THEY POUR OUT OF EVERY VENT', from: 6 },
    acid:     { name: 'ACID RAIN',  color: '#9dff3a', desc: 'WATCH THE SKY', from: 7 },
    bounty:   { name: 'BOUNTY',     color: '#ffd23a', desc: 'HUNT THE MARKED ONE BEFORE IT ESCAPES', from: 8 },
    bloodmoon:{ name: 'BLOOD MOON', color: '#ff2a4a', desc: 'FASTER ALIENS, DOUBLE SCORE', from: 9 },
  };
  const MOD_KEYS = Object.keys(MODS);
  // perk damage keeps pace with alien HP growth
  const perkDmg = base => base * (1 + (wave - 1) * 0.12);

  // starting kits, unlocked by lifetime challenges. `goal` reads [progress, target] from the profile.
  const KITS = [
    { id: 'standard', name: 'STANDARD ISSUE', color: '#5ad1ff', desc: 'M-88 BLASTER. THAT IS ALL.' },
    { id: 'assault',  name: 'ASSAULT',        color: '#9effa0', desc: 'STARTS WITH THE VIPER SMG', weapons: ['smg'],
      req: 'REACH WAVE 5', goal: P => [P.bestWave, 5] },
    { id: 'breacher', name: 'BREACHER',       color: '#ffb35c', desc: 'THUNDER-12 + KEVLAR ARMOR', weapons: ['shotgun'], gear: ['armor'],
      req: 'KILL THE HIVE QUEEN', goal: P => [P.bosses.queen || 0, 1] },
    { id: 'pyro',     name: 'PYRO',           color: '#ff7a1a', desc: 'HELLFIRE + INCENDIARY ROUNDS', weapons: ['flamer'], perks: ['ignite'],
      req: 'BURN 150 ALIENS TO DEATH', goal: P => [P.burnKills, 150] },
    { id: 'ghost',    name: 'GHOST',          color: '#7ae0ff', desc: 'SERVO BOOTS + KINETIC DASH', gear: ['boots'], perks: ['blast'],
      req: 'SURVIVE 5 WAVE TWISTS', goal: P => [P.mods, 5] },
    { id: 'engineer', name: 'ENGINEER',       color: '#ff7ad8', desc: 'SENTRY DRONE + DRONE LINK', gear: ['drone'], perks: ['dronelink'],
      req: 'REACH WAVE 12', goal: P => [P.bestWave, 12] },
    { id: 'hunter',   name: 'BOUNTY HUNTER',  color: '#ffd23a', desc: 'PULSE RIFLE + HOT STREAK', weapons: ['rifle'], perks: ['streak'],
      req: 'CLAIM 3 BOUNTIES', goal: P => [P.bounties, 3] },
    { id: 'demo',     name: 'DEMOLITION',     color: '#ff5a3a', desc: 'NUKA LAUNCHER + CHAIN REACTION', weapons: ['rocket'], perks: ['chain'],
      req: 'KILL SPECIMEN X', goal: P => [P.bosses.specimen || 0, 1] },
  ];
  const kitOpen = k => profile.unlocked.includes(k.id);

  // arenas rotate after every boss
  const ARENAS = [
    { name: 'SECTOR 88', sub: 'HANGAR DECK', style: 'metal', emblem: '88', accent: '#ff3a6a', neonA: '255,40,140', neonB: '60,200,255', vent: '#ff2a4a', amb: [0.85, 0.95, 1.3], wall: '#15171d', wallPanel: '#20232c', pillar: 'octagon',
      pillars: [[0.25, 0.28, 44], [0.75, 0.28, 44], [0.25, 0.72, 44], [0.75, 0.72, 44], [0.5, 0.16, 36], [0.5, 0.84, 36], [0.1, 0.5, 34], [0.9, 0.5, 34]],
      pools: [], start: [0.5, 0.57] },
    { name: 'BIOLAB 7', sub: 'CONTAINMENT FAILED', style: 'lab', emblem: 'B7', accent: '#3affb0', neonA: '40,255,170', neonB: '255,220,60', vent: '#3aff9a', amb: [0.8, 1.15, 1.05], wall: '#141c1c', wallPanel: '#1e2a2a', pillar: 'tank',
      pillars: [[0.2, 0.3, 34], [0.4, 0.26, 34], [0.6, 0.26, 34], [0.8, 0.3, 34], [0.2, 0.7, 34], [0.4, 0.74, 34], [0.6, 0.74, 34], [0.8, 0.7, 34]],
      pools: [[0.5, 0.5, 170, 'slime'], [0.1, 0.15, 90, 'slime'], [0.9, 0.85, 90, 'slime']], start: [0.5, 0.7] },
    { name: 'THE NEST', sub: 'HIVE INTERIOR', style: 'organic', emblem: '', accent: '#ff3af0', neonA: '255,60,220', neonB: '160,80,255', vent: '#ff3af0', amb: [1.15, 0.78, 1.25], wall: '#1a0c1a', wallPanel: '#2a1028', pillar: 'sac',
      pillars: [[0.3, 0.22, 50], [0.7, 0.25, 40], [0.18, 0.55, 46], [0.82, 0.6, 52], [0.4, 0.8, 38], [0.62, 0.74, 44], [0.52, 0.4, 30]],
      pools: [[0.22, 0.82, 85, 'acid'], [0.76, 0.14, 75, 'acid'], [0.92, 0.36, 60, 'acid'], [0.08, 0.24, 60, 'acid']], start: [0.5, 0.58] },
    { name: 'CORE REACTOR', sub: 'MELTDOWN IMMINENT', style: 'grate', emblem: '', accent: '#ff9a2a', neonA: '255,140,30', neonB: '255,60,60', vent: '#ff7a1a', amb: [1.3, 0.95, 0.72], wall: '#1c140e', wallPanel: '#2a1e14', pillar: 'reactor',
      pillars: [[0.5, 0.5, 110], [0.5, 0.16, 30], [0.5, 0.84, 30], [0.27, 0.32, 30], [0.73, 0.32, 30], [0.27, 0.68, 30], [0.73, 0.68, 30]],
      pools: [[0.12, 0.18, 70, 'plasma'], [0.88, 0.18, 70, 'plasma'], [0.12, 0.82, 70, 'plasma'], [0.88, 0.82, 70, 'plasma']], start: [0.5, 0.78] },
  ];

  const waveScale = n => ({
    // late game ramps harder so a fully-geared soldier still meets their end
    hp: 1 + (n - 1) * 0.14 + Math.max(0, n - 8) * 0.1 + Math.max(0, n - 12) ** 2 * 0.014,
    spd: 1 + Math.min(0.35, (n - 1) * 0.022),
    dmg: 1 + (n - 1) * 0.08 + Math.max(0, n - 8) * 0.09,
  });
  const intensityFor = n => (n < 3 ? 1 : n < 8 ? 2 : 3);
  const bpmFor = n => Math.round(146 + Math.min(14, n * 1.2));

  // ======================================================================= arena
  const AW = 2800, AH = 2000, WALL = 44;
  const floor = document.createElement('canvas');
  floor.width = AW; floor.height = AH;
  const fctx = floor.getContext('2d');
  let pillars = [], vents = [], pools = [];
  let arena = ARENAS[0];

  function hazard(g, x, y, w, h, stripe = 'rgba(210,170,30,0.32)', base = '#17140a') {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = base; g.fillRect(x, y, w, h);
    g.fillStyle = stripe;
    const m = Math.min(w, h);
    for (let i = 0; i < w + h + m; i += 28) {
      g.beginPath();
      g.moveTo(x + i, y); g.lineTo(x + i + 14, y);
      g.lineTo(x + i + 14 - h, y + h); g.lineTo(x + i - h, y + h);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  function floorMetal(g) {
    g.fillStyle = '#0d0f14'; g.fillRect(0, 0, AW, AH);
    const T = 80;
    for (let y = 0; y < AH; y += T) {
      for (let x = 0; x < AW; x += T) {
        const s = (22 + Math.random() * 7) | 0;
        g.fillStyle = `rgb(${s},${s + 2},${s + 7})`; g.fillRect(x + 1, y + 1, T - 2, T - 2);
        g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x + 1, y + 1, T - 2, 2); g.fillRect(x + 1, y + 1, 2, T - 2);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 1, y + T - 3, T - 2, 2); g.fillRect(x + T - 3, y + 1, 2, T - 2);
        const r = Math.random();
        if (r < 0.1) {
          g.fillStyle = 'rgba(0,0,0,0.45)';
          for (let i = 0; i < 6; i++) g.fillRect(x + 14, y + 14 + i * 9, T - 28, 4);
        } else if (r < 0.17) {
          g.fillStyle = 'rgba(255,255,255,0.08)';
          for (const [a, b] of [[8, 8], [T - 10, 8], [8, T - 10], [T - 10, T - 10]]) { g.beginPath(); g.arc(x + a + 1, y + b + 1, 2.2, 0, TAU); g.fill(); }
        } else if (r < 0.2) {
          g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.beginPath();
          g.moveTo(x + 6, y + 6); g.lineTo(x + T - 6, y + T - 6); g.moveTo(x + T - 6, y + 6); g.lineTo(x + 6, y + T - 6); g.stroke();
        }
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let x = 0; x < AW; x += T * 5) g.fillRect(x - 2, 0, 4, AH);
    for (let y = 0; y < AH; y += T * 5) g.fillRect(0, y - 2, AW, 4);
  }

  function floorLab(g) {
    g.fillStyle = '#0c1414'; g.fillRect(0, 0, AW, AH);
    const T = 60;
    for (let y = 0; y < AH; y += T) {
      for (let x = 0; x < AW; x += T) {
        const s = (30 + Math.random() * 6) | 0;
        g.fillStyle = `rgb(${s - 8},${s + 4},${s + 2})`; g.fillRect(x + 1.5, y + 1.5, T - 3, T - 3);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 2, y + 2, T - 4, 1.5);
        if (Math.random() < 0.06) {
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x + T / 2, y + T / 2, 12, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(160,200,200,0.25)'; g.lineWidth = 1.5;
          for (let i = -8; i <= 8; i += 4) { g.beginPath(); g.moveTo(x + T / 2 - 9, y + T / 2 + i); g.lineTo(x + T / 2 + 9, y + T / 2 + i); g.stroke(); }
        }
      }
    }
    g.fillStyle = 'rgba(60,255,190,0.07)';
    for (let x = T * 3; x < AW; x += T * 9) g.fillRect(x - 3, 0, 6, AH);
    for (let y = T * 4; y < AH; y += T * 8) g.fillRect(0, y - 3, AW, 6);
  }

  function floorOrganic(g) {
    g.fillStyle = '#12060f'; g.fillRect(0, 0, AW, AH);
    const cols = ['70,20,60', '50,10,50', '95,30,75', '30,8,36', '60,14,30'];
    for (let i = 0; i < 300; i++) {
      const x = rand(0, AW), y = rand(0, AH), r = rand(40, 170), c = choose(cols);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${c},${rand(0.35, 0.7).toFixed(2)})`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      let x = rand(0, AW), y = rand(0, AH);
      g.strokeStyle = `rgba(150,40,120,${rand(0.15, 0.4).toFixed(2)})`; g.lineWidth = rand(1.5, 5);
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        const nx = x + rand(-160, 160), ny = y + rand(-160, 160);
        g.quadraticCurveTo(x + rand(-80, 80), y + rand(-80, 80), nx, ny); x = nx; y = ny;
      }
      g.stroke();
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,120,220,0.07)';
      g.beginPath(); g.arc(rand(0, AW), rand(0, AH), rand(2, 7), 0, TAU); g.fill();
    }
  }

  function floorGrate(g) {
    g.fillStyle = '#140f0a'; g.fillRect(0, 0, AW, AH);
    const T = 160;
    for (let y = 0; y < AH; y += T) {
      for (let x = 0; x < AW; x += T) {
        const s = (24 + Math.random() * 6) | 0;
        g.fillStyle = `rgb(${s + 6},${s},${s - 6})`; g.fillRect(x + 3, y + 3, T - 6, T - 6);
        g.save(); g.beginPath(); g.rect(x + 10, y + 10, T - 20, T - 20); g.clip();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
        for (let i = -T; i < T * 2; i += 10) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + T, y + T); g.stroke(); }
        g.restore();
        g.strokeStyle = 'rgba(255,160,80,0.08)'; g.lineWidth = 2; g.strokeRect(x + 10, y + 10, T - 20, T - 20);
      }
    }
    for (let i = 0; i < 80; i++) {
      const x = rand(0, AW), y = rand(0, AH), r = rand(30, 110);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(140,60,10,0.22)'); gr.addColorStop(1, 'rgba(140,60,10,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function drawPoolFloor(g, p) {
    const pal = {
      slime:  ['rgba(90,255,120,0.75)', 'rgba(20,110,40,0.85)', 'rgba(5,40,15,0)'],
      acid:   ['rgba(200,255,60,0.8)', 'rgba(70,140,10,0.85)', 'rgba(20,40,0,0)'],
      plasma: ['rgba(255,190,80,0.9)', 'rgba(160,50,0,0.9)', 'rgba(40,10,0,0)'],
    }[p.kind];
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.15);
    gr.addColorStop(0, pal[0]); gr.addColorStop(0.75, pal[1]); gr.addColorStop(1, pal[2]);
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU, rr = p.r * (1 + Math.sin(a * 3 + p.x) * 0.06 + Math.sin(a * 5 + p.y) * 0.04);
      g.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
    }
    g.fill();
    if (p.kind === 'plasma') {
      g.strokeStyle = 'rgba(40,20,10,0.9)'; g.lineWidth = 4;
      for (let i = -p.r; i <= p.r; i += 14) { g.beginPath(); g.moveTo(p.x + i, p.y - p.r * 0.9); g.lineTo(p.x + i, p.y + p.r * 0.9); g.stroke(); }
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 6; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.2)';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(p.x + rand(-p.r, p.r) * 0.6, p.y + rand(-p.r, p.r) * 0.6, rand(2, 6), 0, TAU); g.fill(); }
    }
  }

  function buildArena(theme = ARENAS[0]) {
    arena = theme;
    pillars = theme.pillars.map(([x, y, r]) => ({ x: x * AW, y: y * AH, r, seed: Math.random() * 100 }));
    pools = theme.pools.map(([x, y, r, kind]) => ({ x: x * AW, y: y * AH, r, kind }));
    barrels = []; later = [];
    vents = [];
    for (const fx of [0.18, 0.5, 0.82]) {
      vents.push({ x: fx * AW, y: WALL + 24, a: Math.PI / 2, pulse: 0 });
      vents.push({ x: fx * AW, y: AH - WALL - 24, a: -Math.PI / 2, pulse: 0 });
    }
    for (const fy of [0.3, 0.7]) {
      vents.push({ x: WALL + 24, y: fy * AH, a: 0, pulse: 0 });
      vents.push({ x: AW - WALL - 24, y: fy * AH, a: Math.PI, pulse: 0 });
    }
    placePads();
    placeBarrels(6);

    const g = fctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    ({ metal: floorMetal, lab: floorLab, organic: floorOrganic, grate: floorGrate })[theme.style](g);

    if (theme.style !== 'organic') {
      for (let i = 0; i < 120; i++) {
        const x = rand(0, AW), y = rand(0, AH), r = rand(20, 120);
        const c = Math.random() < 0.3 ? '60,35,20' : '0,0,0';
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${c},${rand(0.1, 0.26).toFixed(2)})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.5;
      for (let i = 0; i < 50; i++) {
        let x = rand(0, AW), y = rand(0, AH), a = rand(0, TAU);
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 6; j++) { a += rand(-0.8, 0.8); x += Math.cos(a) * rand(8, 26); y += Math.sin(a) * rand(8, 26); g.lineTo(x, y); }
        g.stroke();
      }
    }
    if (theme.emblem) {
      const cx = AW / 2, cy = AH / 2;
      g.save();
      g.globalAlpha = 0.14; g.strokeStyle = theme.accent;
      g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 230, 0, TAU); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 200, 0, TAU); g.stroke();
      g.fillStyle = theme.accent; g.font = `120px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(theme.emblem, cx + 6, cy + 8);
      g.restore();
    }
    if (theme.style === 'reactor' || theme.style === 'grate') {
      const cx = AW / 2, cy = AH / 2;
      g.save(); g.globalAlpha = 0.25; g.strokeStyle = '#ff7a1a'; g.lineWidth = 6; g.setLineDash([30, 20]);
      g.beginPath(); g.arc(cx, cy, 200, 0, TAU); g.stroke(); g.restore();
    }
    const bands = { metal: ['rgba(210,170,30,0.32)', '#17140a'], lab: ['rgba(60,255,190,0.22)', '#0e1a18'], grate: ['rgba(255,120,30,0.3)', '#1a1008'] }[theme.style];
    if (bands) {
      hazard(g, WALL, WALL, AW - 2 * WALL, 20, ...bands);
      hazard(g, WALL, AH - WALL - 20, AW - 2 * WALL, 20, ...bands);
      hazard(g, WALL, WALL, 20, AH - 2 * WALL, ...bands);
      hazard(g, AW - WALL - 20, WALL, 20, AH - 2 * WALL, ...bands);
    }
    for (const p of pools) drawPoolFloor(g, p);
    // ambient occlusion where the floor meets the walls
    const ao = 110;
    for (const [x, y, w, h, gx0, gy0, gx1, gy1] of [
      [WALL, WALL, AW - 2 * WALL, ao, 0, WALL, 0, WALL + ao], [WALL, AH - WALL - ao, AW - 2 * WALL, ao, 0, AH - WALL, 0, AH - WALL - ao],
      [WALL, WALL, ao, AH - 2 * WALL, WALL, 0, WALL + ao, 0], [AW - WALL - ao, WALL, ao, AH - 2 * WALL, AW - WALL, 0, AW - WALL - ao, 0]]) {
      const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
      gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.35, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    }
    for (const p of pillars) {
      const gr = g.createRadialGradient(p.x + 10, p.y + 14, p.r * 0.6, p.x + 10, p.y + 14, p.r * 1.8);
      gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(p.x + 10, p.y + 14, p.r * 1.8, 0, TAU); g.fill();
    }
    for (const v of vents) {
      g.save(); g.translate(v.x, v.y); g.rotate(v.a);
      if (theme.style === 'organic') {
        g.fillStyle = '#050205'; g.beginPath(); g.ellipse(0, 0, 26, 34, 0, 0, TAU); g.fill();
        g.strokeStyle = '#5a1a4a'; g.lineWidth = 6; g.stroke();
      } else {
        g.fillStyle = '#050608'; g.fillRect(-24, -32, 48, 64);
        g.strokeStyle = '#3a3f4a'; g.lineWidth = 3; g.strokeRect(-24, -32, 48, 64);
        g.fillStyle = '#1c1f26';
        for (let i = 0; i < 6; i++) g.fillRect(-20, -27 + i * 10, 40, 3);
      }
      g.restore();
    }
  }

  const corpseCv = document.createElement('canvas');
  corpseCv.width = corpseCv.height = 400;
  const cctx = corpseCv.getContext('2d');
  function stampCorpse(e) {
    const size = Math.min(400, Math.ceil(e.r * 6));
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, size, size);
    const ghost = Object.assign({}, e, { x: size / 2, y: size / 2, corpse: true, flash: 0, spawnT: 0, hitT: 0, biteT: 0, st: null,
      fuse: 0, under: false, cloaked: false, shieldFlash: 0, near: false, angle: e.angle + rand(-0.4, 0.4) });
    const saved = ctx;
    ctx = cctx;
    try { drawEnemy(ghost); } finally { ctx = saved; curlLegs = false; }
    cctx.globalCompositeOperation = 'source-atop';
    cctx.fillStyle = 'rgba(14,8,6,0.55)';
    cctx.fillRect(0, 0, size, size);
    cctx.globalCompositeOperation = 'source-over';
    fctx.save();
    fctx.globalAlpha = 0.9;
    fctx.drawImage(corpseCv, 0, 0, size, size, e.x - size / 2, e.y - size / 2, size, size);
    fctx.restore();
  }

  const ghostPool = Array.from({ length: 24 }, () => { const c = document.createElement('canvas'); c.width = c.height = 160; return c; });
  let ghostIdx = 0;
  function deathGhost(e, T) {
    if (settings.fx === 0 || T.boss || e.under) return;
    const size = Math.min(160, Math.ceil(e.r * 5));
    const cv = ghostPool[ghostIdx = (ghostIdx + 1) % ghostPool.length], g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 160, 160);
    const ghost = Object.assign({}, e, { x: size / 2, y: size / 2, flash: 0, spawnT: 0, hitT: 0, biteT: 0, st: null,
      fuse: 0, under: false, cloaked: false, shieldFlash: 0, near: false });
    const saved = ctx, nb = noBlob;
    ctx = g; noBlob = true;
    try { drawEnemy(ghost); } finally { ctx = saved; noBlob = nb; curlLegs = false; }
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = hexA(T.blood, 0.8); g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
    part({ kind: 'ghost', glow: true, x: e.x, y: e.y, vx: e.vx * 0.3, vy: e.vy * 0.3, drag: 4, life: 0.3, cv, size });
    for (let i = 0, n = 3 + Math.floor(e.r / 5); i < n; i++) {
      const a = rand(0, TAU), sp = rand(40, 160);
      part({ kind: 'ember', glow: true, x: e.x + Math.cos(a) * e.r * 0.5, y: e.y + Math.sin(a) * e.r * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, drag: 2.5, life: rand(0.35, 0.8), size: rand(1.5, 3), color: T.blood });
    }
  }

  function splat(x, y, size, color, n = 7) {
    fctx.save();
    fctx.fillStyle = color;
    fctx.globalAlpha = 0.45;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = rand(0, size), r = rand(size * 0.12, size * 0.4);
      fctx.beginPath(); fctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r, 0, TAU); fctx.fill();
    }
    fctx.globalAlpha = 0.6;
    fctx.beginPath(); fctx.arc(x, y, size * 0.4, 0, TAU); fctx.fill();
    fctx.globalAlpha = 0.25; fctx.fillStyle = '#000';
    fctx.beginPath(); fctx.arc(x, y, size * 0.25, 0, TAU); fctx.fill();
    fctx.restore();
  }
  function scorch(x, y, r) {
    const gr = fctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(10,5,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = gr; fctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function collidePillars(o) {
    for (const pl of pillars) {
      const dx = o.x - pl.x, dy = o.y - pl.y, rr = pl.r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1;
        o.x = pl.x + (dx / d) * rr; o.y = pl.y + (dy / d) * rr;
      }
    }
    for (const b of barrels) {
      if (b.dead || b.drop > 0) continue;
      const dx = o.x - b.x, dy = o.y - b.y, rr = b.r + o.r, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1; o.x = b.x + (dx / d) * rr; o.y = b.y + (dy / d) * rr; }
    }
  }

  // ======================================================================= arena props
  // explosive barrels (themed per arena), turret pads the soldier can switch on, and timed arena events
  const BARREL = {
    metal:   { name: 'FUEL DRUM',     color: '#ff5a2a', body: '#7a2416', band: '#ffb02a' },
    lab:     { name: 'CRYO CANISTER', color: '#7ae0ff', body: '#1e4a66', band: '#c8f4ff' },
    organic: { name: 'GAS POD',       color: '#c8ff3a', body: '#3e4a16', band: '#e8ff8a' },
    grate:   { name: 'PLASMA CELL',   color: '#ff9a2a', body: '#4a3014', band: '#ffe08a' },
  };
  let barrels = [], pads = [], later = [], eventT = 0;

  function placeBarrels(target) {
    let tries = 0;
    while (barrels.filter(b => !b.dead).length < target && tries++ < 300) {
      const x = rand(WALL + 90, AW - WALL - 90), y = rand(WALL + 90, AH - WALL - 90);
      if (pillars.some(pl => Math.hypot(pl.x - x, pl.y - y) < pl.r + 70)) continue;
      if (barrels.some(b => !b.dead && Math.hypot(b.x - x, b.y - y) < 170)) continue;
      if (pads.some(pd => Math.hypot(pd.x - x, pd.y - y) < 130)) continue;
      if (vents.some(v => Math.hypot(v.x - x, v.y - y) < 150)) continue;
      if (pools.some(pl => !pl.temp && Math.hypot(pl.x - x, pl.y - y) < pl.r + 40)) continue;
      if (player && state === 'play' && Math.hypot(player.x - x, player.y - y) < 240) continue;
      if (Math.hypot(arena.start[0] * AW - x, arena.start[1] * AH - y) < 240) continue;
      barrels.push({ x, y, r: 15, hp: 30, max: 30, drop: rand(0.4, 0.9), hitT: 0, ph: rand(0, TAU) });
    }
  }

  function placePads() {
    pads = [];
    const cands = [[0.36, 0.5], [0.64, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.42], [0.7, 0.58], [0.25, 0.5], [0.75, 0.5]];
    for (const [fx, fy] of cands) {
      const x = fx * AW, y = fy * AH;
      if (pillars.some(pl => Math.hypot(pl.x - x, pl.y - y) < pl.r + 80)) continue;
      if (pools.some(pl => !pl.temp && Math.hypot(pl.x - x, pl.y - y) < pl.r + 60)) continue;
      if (pads.some(pd => Math.hypot(pd.x - x, pd.y - y) < 600)) continue;
      pads.push({ x, y, r: 34, st: 'ready', prog: 0, t: 0, aim: -Math.PI / 2, shotCd: 0, flash: 0 });
      if (pads.length === 2) break;
    }
  }

  function damageBarrel(b, d) {
    if (b.dead || b.drop > 0) return;
    b.hp -= d; b.hitT = 0.1;
    if (b.hp <= 0) { b.dead = true; later.push({ t: 0.09, fn: () => blowBarrel(b) }); } // short fuse so chains ripple
  }

  function blowBarrel(b) {
    const dmg = 70 * (1 + (wave - 1) * 0.12);
    explode(b.x, b.y, arena.style === 'organic' ? 185 : 135, dmg, 'barrel', 'EXPLOSIVE BARREL');
    switch (arena.style) {
      case 'metal': for (let i = 0; i < 6; i++) dropFire(b.x + rand(-70, 70), b.y + rand(-70, 70), 1, 'barrel'); break;
      case 'lab': freezeBurst(b.x, b.y, 200, 3.5); break;
      case 'grate': {
        const w = { range: 420, chains: 3, color: BARREL.grate.color, knock: 60, ign: 0, src: 'barrel' };
        const near = enemies.filter(e => !e.dead && !e.under && Math.hypot(e.x - b.x, e.y - b.y) < 420).slice(0, 3);
        for (const e of near) fireArc(w, dmg * 0.5, b.x, b.y, Math.atan2(e.y - b.y, e.x - b.x));
        if (near.length) A.sfx('arc');
        break;
      }
    }
  }

  // freezing gas: aliens inside run at 30% speed for a while (bosses shrug off half of it)
  function freezeBurst(x, y, R, dur) {
    part({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.5, size: R, color: '#9ae6ff', glow: true });
    for (let i = 0; i < 18; i++) { const a = rand(0, TAU), sp = rand(60, 260); part({ kind: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.6, 1.1), size: rand(14, 26), drag: 3, color: '170,230,255' }); }
    for (const e of enemies) if (!e.dead && Math.hypot(e.x - x, e.y - y) < R + e.r) e.frozeT = Math.max(e.frozeT || 0, isBoss(e) ? dur / 2 : dur);
    A.sfx('chrono');
  }

  function updatePads(dt) {
    for (const pd of pads) {
      pd.flash -= dt;
      if (pd.st === 'ready') {
        const on = Math.hypot(player.x - pd.x, player.y - pd.y) < pd.r + 6;
        pd.prog = on ? pd.prog + dt / 1.2 : Math.max(0, pd.prog - dt * 2);
        if (pd.prog >= 1) {
          pd.st = 'active'; pd.t = 20; pd.prog = 0;
          floatText(pd.x, pd.y - 50, 'TURRET ONLINE', '#5affc8', 11);
          part({ kind: 'ring', x: pd.x, y: pd.y, vx: 0, vy: 0, life: 0.5, size: 90, color: '#5affc8', glow: true });
          A.sfx('weapon');
        }
      } else if (pd.st === 'active') {
        pd.t -= dt; pd.shotCd -= dt;
        let best = null, bd = 560 * 560;
        for (const e of enemies) {
          if (e.dead || e.under || (e.type === 'phantom' && e.cloaked)) continue;
          const d2 = (e.x - pd.x) ** 2 + (e.y - pd.y) ** 2;
          if (d2 < bd) { bd = d2; best = e; }
        }
        if (best) {
          const want = Math.atan2(best.y - pd.y, best.x - pd.x);
          pd.aim += clamp(angDiff(pd.aim, want), -8 * dt, 8 * dt);
          if (pd.shotCd <= 0 && Math.abs(angDiff(pd.aim, want)) < 0.25) {
            pd.shotCd = 0.1; pd.flash = 0.05;
            const a = pd.aim + rand(-0.04, 0.04), mx = pd.x + Math.cos(pd.aim) * 26, my = pd.y + Math.sin(pd.aim) * 26;
            bullets.push({ kind: 'bullet', x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * 1250, vy: Math.sin(a) * 1250, life: 0.55, max: 0.55,
              dmg: 13 * (1 + wave * 0.1), r: 2.5, pierce: 0, color: '#5affc8', knock: 50, splash: 0, hits: null, src: 'turret' });
            A.sfx('drone');
          }
        }
        if (pd.t <= 0) { pd.st = 'cool'; pd.t = 40; floatText(pd.x, pd.y - 50, 'TURRET OFFLINE', '#8a8ab0', 9); }
      } else if ((pd.t -= dt) <= 0) pd.st = 'ready';
    }
  }

  // one timed hazard per arena, every ~20s of a regular wave from wave 3
  function arenaEvent() {
    const p = player, near = (arr, n) => arr.slice().sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, n);
    switch (arena.style) {
      case 'metal':
        banner('VENT FLARE', 'THE FLOOR VENTS ARE IGNITING - MOVE', '#ff7a1a', 1.6);
        for (let i = 0; i < 3; i++) {
          const x = clamp(p.x + p.vx * 0.8 + rand(-220, 220), WALL + 60, AW - WALL - 60), y = clamp(p.y + p.vy * 0.8 + rand(-220, 220), WALL + 60, AH - WALL - 60);
          booms.push({ x, y, R: 90, dmg: 18 * SC.dmg, color: '#ff7a1a', t: 1.3, max: 1.3, hostile: true, by: 'VENT FLARE' });
        }
        A.sfx('alarm');
        break;
      case 'lab':
        banner('COOLANT LEAK', 'ALIENS NEAR THE TANKS ARE FREEZING', '#7ae0ff', 1.6);
        for (const t of near(pillars, 2)) {
          t.leak = 0.8;
          later.push({ t: 0.8, fn: () => freezeBurst(t.x, t.y, 270, 4) });
        }
        break;
      case 'organic':
        banner('SPORE BURST', 'THE WALLS ARE HATCHING', '#ff3af0', 1.6);
        for (const sac of near(pillars, 2)) {
          sac.leak = 0.9;
          later.push({ t: 0.9, fn: () => {
            const a = Math.atan2(p.y - sac.y, p.x - sac.x);
            spawnMites(sac.x + Math.cos(a) * (sac.r + 16), sac.y + Math.sin(a) * (sac.r + 16), 4);
            blood(sac.x, sac.y, '#ff4ad0', 18, 260);
          } });
        }
        break;
      case 'grate': {
        const core = pillars.reduce((a, b) => (b.r > a.r ? b : a));
        banner('CORE FLARE', 'DASH THROUGH THE SHOCKWAVE', '#ff9a2a', 1.6);
        core.leak = 1.5;
        A.sfx('alarm');
        later.push({ t: 1.5, fn: () => {
          shocks.push({ x: core.x, y: core.y, r: core.r, spd: 430, max: 1500, dmg: 22 * SC.dmg, hit: false, color: '#ff9a2a', by: 'CORE FLARE' });
          shake = Math.min(30, shake + 12); A.sfx('roar'); ripple(core.x, core.y, 900, 0.035, 0.8);
        } });
        break;
      }
    }
  }

  function updateArena(dt) {
    for (const l of later) if (!l.dead && (l.t -= dt) <= 0) { l.dead = true; l.fn(); }
    compact(later);
    for (const b of barrels) { if (b.drop > 0) { b.drop -= dt; if (b.drop <= 0) { A.sfx('thud'); shake = Math.min(30, shake + 2); } } b.hitT -= dt; }
    compact(barrels);
    for (const pl of pillars) if (pl.leak > 0) pl.leak -= dt;
    if (state !== 'play') return;
    updatePads(dt);
    if (waveActive && wave >= 3 && wave % 5 && (eventT -= dt) <= 0) { eventT = rand(18, 26); arenaEvent(); }
  }
  function clampArena(o) {
    o.x = clamp(o.x, WALL + o.r, AW - WALL - o.r);
    o.y = clamp(o.y, WALL + o.r, AH - WALL - o.r);
  }

  // ======================================================================= state
  let state = 'menu'; // menu | play | paused | dying | over
  let powered = false;
  let player = null;
  let enemies = [], bullets = [], eshots = [], particles = [], pickups = [], beams = [], banners = [];
  const lights = [];
  let wave = 0, waveActive = false, interTimer = 0, spawnQueue = [], SC = waveScale(1);
  let forceMod = null; // debug: next wave's modifier
  let waveMod = null, lastMod = null, acidT = 0, modDark = 1, modRed = 0; // wave modifier + its fading light tint
  let score = 0, kills = 0, combo = 0, comboTimer = 0, mult = 1;
  // per-run report shown on the game-over screen
  // a live combo makes your guns hit harder: +3% per multiplier step, +21% at x8
  const comboBonus = () => (mult - 1) * 0.03;
  const newRun = () => ({ dodges: 0, early: 0, dmg: {}, kills: {}, bestCombo: 0, elites: 0, champs: 0, bosses: 0, bounties: 0, mods: 0, taken: 0, killedBy: null, unlocks: [] });
  let run = newRun();
  // who hurt the soldier: an alien (or its shot, which carries `by`), or a named hazard
  const byName = src => (!src ? 'UNKNOWN' : src.type && ET[src.type] ? src.type : src.by || 'UNKNOWN');
  let shake = 0, timeScale = 1, slowT = 0, beatPulse = 0, snarePulse = 0, hurtFlash = 0, gameTime = 0;
  let dyingT = 0, overT = 0, newRecord = false, menuT = 0, fbBeat = 0, fbCount = 0;
  let shX = 0, shY = 0;
  // camera zoom punch for big moments; eases in fast, relaxes slowly
  let zoomPunch = 0, zoomCur = 0;
  const punchZoom = a => { if (settings.shake > 0) zoomPunch = Math.max(zoomPunch, a * (settings.shake === 1 ? 0.5 : 1)); };
  // transitions: dive from the title into the arena, then fade/zoom in
  let dive = null, fadeIn = 0;
  // screen-space shockwave ripples
  let ripples = [];
  const ripple = (x, y, R, amp = 0.03, dur = 0.55) => { if (ripples.length < 8) ripples.push({ x, y, R, amp, dur, t: 0 }); };
  const cam = { x: AW / 2, y: AH / 2 };
  const keys = {};
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
  let dashQueued = false;
  const camKick = { x: 0, y: 0 }; // camera shove from weapon recoil
  let menuOptRect = null;
  let hunt = false; // true when only a few stragglers remain
  let nowPlaying = null; // { name, mode, t }
  let curBpm = 140;
  // simulation hooks (used by tools/autoplay.js for balance testing)
  const sim = { speed: 1, fakeBeat: false, onTick: null };
  function music(mode, inten, tempo) { if (tempo) curBpm = tempo; A.setMode(mode, inten, tempo); }

  function mouseWorld() {
    return { x: (mouse.x - W / 2) / VIEW + cam.x, y: (mouse.y - H / 2) / VIEW + cam.y };
  }

  function banner(title, sub, color, dur = 2.6, sub2 = '', priority = false) {
    const b = { title, sub, sub2, color, t: 0, dur };
    if (priority && banners.length) banners.splice(0, 1, b);
    else banners.push(b);
    if (banners.length > 4) banners.splice(1, 1);
  }

  // ======================================================================= particles
  function part(o) {
    if (particles.length > 2200) return;
    o.max = o.max || o.life;
    o.drag = o.drag || 0;
    particles.push(o);
  }
  function blood(x, y, color, n, spd, dir = null) {
    for (let i = 0; i < n; i++) {
      const a = dir === null ? rand(0, TAU) : dir + rand(-0.6, 0.6);
      const s = rand(0.2, 1) * spd;
      part({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), size: rand(1.5, 4), color, drag: 6 });
    }
  }
  function sparks(x, y, color, n, spd, dir = null, spread = Math.PI) {
    for (let i = 0; i < n; i++) {
      const a = dir === null ? rand(0, TAU) : dir + rand(-spread, spread);
      const s = rand(0.3, 1) * spd;
      part({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.12, 0.35), size: rand(1, 2.2), color, drag: 5, glow: true });
    }
  }
  function floatText(x, y, text, color, size = 10) {
    part({ kind: 'text', x, y, vx: 0, vy: -50, life: 1.1, text, color, size, drag: 1.5 });
  }

  // ======================================================================= player
  function newPlayer() {
    return {
      x: arena.start[0] * AW, y: arena.start[1] * AH, vx: 0, vy: 0, r: 15, hp: 100, maxHp: 100, speed: 300, angle: -Math.PI / 2,
      invuln: 0, dash: 0, dashCd: 0, dx: 0, dy: 0, cur: 0, prev: 0, fireCd: 0, muzzle: 0, recoil: 0,
      spin: 0, overdrive: 0, aegis: 0, chrono: 0, walk: 0, moving: 0,
      gear: { armor: 0, vital: 0, shield: 0, boots: 0, drone: 0 },
      perk: Object.fromEntries(PERK_KEYS.map(k => [k, 0])), frenzy: 0, staticN: 0, trailD: 0, streakLvl: 0,
      shield: 0, shieldMax: 0, shieldDelay: 0, shieldHit: 0, drones: [], hazardT: 0,
      legA: -Math.PI / 2, kickA: 0, swapT: 0, hitT: 0, pumpT: 0, heat: 0, stepSign: 1, flashRot: 0,
      ws: WEAPONS.map((w, i) => ({ owned: i === 0, ammo: i === 0 ? Infinity : 0, lvl: 0 })),
    };
  }

  function selectWeapon(i, silent) {
    const p = player;
    if (i < 0 || i >= WEAPONS.length || i === p.cur) return false;
    const st = p.ws[i];
    if (!st.owned || st.ammo <= 0) return false;
    p.prev = p.cur; p.cur = i;
    p.fireCd = Math.max(p.fireCd, 0.12);
    p.spin = 0;
    p.swapT = 0.28;
    if (!silent) A.sfx('switch');
    return true;
  }
  function cycleWeapon(dir) {
    const n = WEAPONS.length;
    for (let k = 1; k < n; k++) {
      const i = (((player.cur + dir * k) % n) + n) % n;
      if (selectWeapon(i)) return;
    }
  }
  function autoSwitch() {
    for (let i = WEAPONS.length - 1; i >= 0; i--) {
      if (i !== player.cur && selectWeapon(i, true)) return;
    }
  }

  function startDash(mx, my) {
    const p = player;
    let dx = mx, dy = my;
    if (!dx && !dy) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
    p.dx = dx; p.dy = dy;
    p.dash = 0.15; p.dashCd = 1.0 - 0.15 * p.gear.boots;
    p.trailD = 26; // first flame lands right where the dash starts
    p.dashIF = 0.3; p.dodged = false; // the dash's own i-frames: an attack landing in them is a perfect dodge
    p.invuln = Math.max(p.invuln, 0.3);
    A.sfx('dash');
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, size: 30, color: '#5ad1ff', glow: true });
  }

  function updatePlayer(dt) {
    const p = player;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (pad.move[0] || pad.move[1]) { mx = pad.move[0]; my = pad.move[1]; }
    if (touch.move[0] || touch.move[1]) { mx = touch.move[0]; my = touch.move[1]; }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    if (touch.using || (pad.using && pad.connected)) {
      if (touch.aimActive) p.angle = assistAim(p, touch.aim);
      else if (pad.connected && pad.aimActive) p.angle = pad.aim;
      else if (ml > 0.3) p.angle += angDiff(p.angle, Math.atan2(my, mx)) * Math.min(1, dt * 10);
      // park the virtual cursor ahead of the soldier so camera look-ahead and crosshair follow the stick
      mouse.x = (p.x + Math.cos(p.angle) * 230 - cam.x) * VIEW + W / 2;
      mouse.y = (p.y + Math.sin(p.angle) * 230 - cam.y) * VIEW + H / 2;
    } else {
      const mw = mouseWorld();
      p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
    }
    p.invuln -= dt; p.dashCd -= dt; p.muzzle -= dt; p.dashIF = (p.dashIF || 0) - dt;
    p.overdrive = Math.max(0, p.overdrive - dt);
    p.aegis = Math.max(0, p.aegis - dt);
    p.chrono = Math.max(0, p.chrono - dt);
    p.shieldHit = Math.max(0, p.shieldHit - dt);
    p.shieldDelay -= dt;
    if (p.shieldDelay <= 0 && p.shield < p.shieldMax) p.shield = Math.min(p.shieldMax, p.shield + 12 * dt);
    let slow = 1;
    for (const pl of pools) {
      if (Math.hypot(p.x - pl.x, p.y - pl.y) > pl.r * 0.9) continue;
      if (pl.kind === 'slime') slow = 0.6;
      else {
        envDamage((pl.kind === 'plasma' ? 16 : 11) * dt, pl.kind === 'plasma' ? 'PLASMA' : pl.temp ? 'ACID PUDDLE' : 'ACID POOL');
        if (Math.random() < 0.4) part({ kind: 'fire', x: p.x + rand(-10, 10), y: p.y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-50, -10), life: 0.3, size: 8, glow: true, drag: 1 });
        p.hazardT -= dt;
        if (p.hazardT <= 0) { p.hazardT = 0.8; floatText(p.x, p.y - 26, pl.kind === 'plasma' ? 'BURNING!' : 'ACID!', '#c8ff3a', 8); }
      }
    }
    const speed = p.speed * (1 + 0.08 * p.gear.boots) * slow;
    updateDrones(dt);
    p.recoil *= Math.exp(-dt * 14);
    if (dashQueued) { dashQueued = false; if (p.dashCd <= 0) startDash(mx, my); }
    if (p.dash > 0) {
      p.dash -= dt;
      const s = p.speed * 3.4;
      p.vx = p.dx * s; p.vy = p.dy * s;
      part({ kind: 'after', x: p.x, y: p.y, vx: 0, vy: 0, a: p.angle, life: 0.22 });
      if (p.perk.trail) {
        p.trailD += s * dt;
        while (p.trailD >= 26) { p.trailD -= 26; dropFire(p.x, p.y, p.perk.trail); }
      }
      if (p.dash <= 0 && p.perk.blast) kineticBlast();
    } else {
      const k = 1 - Math.exp(-dt * 16);
      p.vx = lerp(p.vx, mx * speed, k); p.vy = lerp(p.vy, my * speed, k);
    }
    p.moving = ml ? 1 : 0;
    const spdNow = Math.hypot(p.vx, p.vy);
    if (spdNow > 30) {
      let la = Math.atan2(p.vy, p.vx);
      if (Math.abs(angDiff(p.angle, la)) > 1.9) la += Math.PI; // walking backwards: legs face the aim, stride reverses
      p.legA += angDiff(p.legA, la) * Math.min(1, dt * 14);
    } else p.legA += angDiff(p.legA, p.angle) * Math.min(1, dt * 4);
    const stepS = Math.sin(p.walk) >= 0 ? 1 : -1;
    if (stepS !== p.stepSign) {
      p.stepSign = stepS;
      if (spdNow > 120) {
        const fx = p.x + Math.cos(p.legA + stepS * 1.4) * 7, fy = p.y + Math.sin(p.legA + stepS * 1.4) * 7;
        part({ kind: 'smoke', x: fx, y: fy, vx: -p.vx * 0.1, vy: -p.vy * 0.1, life: 0.35, size: 4, drag: 4, color: arena.style === 'organic' ? '90,30,70' : '110,110,120' });
      }
    }
    p.kickA *= Math.exp(-dt * 16);
    p.swapT -= dt; p.hitT -= dt; p.pumpT -= dt;
    p.heat = Math.max(0, p.heat - dt * 0.6);
    if (p.gear.boots && ml && Math.random() < 0.25 * p.gear.boots) {
      part({ kind: 'spark', x: p.x - p.vx * 0.03, y: p.y - p.vy * 0.03, vx: -p.vx * 0.3 + rand(-30, 30), vy: -p.vy * 0.3 + rand(-30, 30), life: 0.25, size: 1.5, color: '#ffd23a', drag: 4, glow: true });
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.walk += Math.hypot(p.vx, p.vy) * dt * 0.05;
    collidePillars(p); clampArena(p);

    const w = WEAPONS[p.cur], st = p.ws[p.cur];
    const firing = mouse.down || (pad.connected && pad.fire) || touch.fire;
    if (w.spin) p.spin = firing ? Math.min(1, p.spin + dt * 1.8) : Math.max(0, p.spin - dt * 1.5);
    if (!firing || p.dash > 0) { p.fireCd = Math.max(0, p.fireCd - dt); return; }
    p.fireCd -= dt;
    let rate = w.rate * (p.overdrive > 0 ? 1.6 : 1) * (1 + frenzyBonus());
    if (w.spin) rate *= 0.2 + 0.8 * p.spin;
    let guard = 0;
    while (p.fireCd <= 0 && guard++ < 6) {
      if (st.ammo <= 0) { A.sfx('empty'); floatText(p.x, p.y - 28, 'OUT OF AMMO', '#ff5a3a', 9); autoSwitch(); p.fireCd = 0.2; return; }
      fire(w, st);
      p.fireCd += 1 / rate;
    }
  }

  function muzzlePos() {
    const p = player, w = WEAPONS[p.cur];
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const L = w.len + 8 - p.recoil;
    return { x: p.x + ca * L - sa * 5, y: p.y + sa * L + ca * 5 };
  }

  function fire(w, st) {
    const p = player;
    if (st.ammo !== Infinity) st.ammo--;
    const dmg = w.dmg * (1 + st.lvl * 0.25) * (p.overdrive > 0 ? 1.4 : 1) * (1 + comboBonus());
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const m = muzzlePos();
    if (w.kind === 'rail') {
      fireRail(w, dmg, m.x, m.y, p.angle);
    } else if (w.kind === 'arc') {
      fireArc(w, dmg, m.x, m.y, p.angle);
    } else {
      const n = w.pellets || 1, ign = igniteChance(w);
      for (let i = 0; i < n; i++) {
        const spread = w.spread * (w.spin ? 1.2 - p.spin * 0.4 : 1);
        const a = p.angle + (Math.random() - 0.5) * spread;
        const sp = w.speed * (1 + (Math.random() - 0.5) * (w.speedVar || 0.08));
        const b = {
          kind: w.kind, x: m.x, y: m.y, px: m.x, py: m.y,
          vx: Math.cos(a) * sp + p.vx * 0.3, vy: Math.sin(a) * sp + p.vy * 0.3,
          life: w.life * (w.kind === 'flame' ? rand(0.75, 1.1) : 1), max: w.life,
          dmg, r: w.r, pierce: w.pierce || 0, color: w.color, knock: w.knock, splash: w.splash || 0, hits: null,
          ign, rico: w.kind === 'bullet' ? p.perk.ricochet : 0, src: w.id,
        };
        if (w.kind === 'flame') { b.pierce = 99; b.hits = new Set(); }
        if (w.kind === 'saw') { b.pierce = 99; b.hits = new Set(); b.bounces = w.bounces; b.rot = 0; }
        bullets.push(b);
      }
    }
    p.muzzle = 0.05;
    p.flashRot = rand(-0.4, 0.4);
    p.recoil = w.recoil;
    p.kickA += (Math.random() < 0.5 ? -1 : 1) * w.recoil * rand(0.008, 0.02);
    camKick.x -= ca * w.recoil * 0.9; camKick.y -= sa * w.recoil * 0.9;
    if (w.id === 'smg' || w.id === 'minigun') p.heat = Math.min(1, p.heat + 0.025);
    if (w.id === 'shotgun') {
      p.pumpT = 0.4;
      setTimeout(() => {
        if (!player || state !== 'play') return;
        const c2 = Math.cos(player.angle), s2 = Math.sin(player.angle);
        part({ kind: 'shell', x: player.x + c2 * 10 - s2 * 5, y: player.y + s2 * 10 + c2 * 5, vx: -s2 * 150 + rand(-30, 30), vy: c2 * 150 + rand(-30, 30), life: 0.9, rot: rand(0, TAU), vr: rand(-15, 15), drag: 4, color: '#d83a2a', size: 1.6 });
      }, 180);
    }
    if (w.kind === 'rocket') {
      for (let i = 0; i < 8; i++) part({ kind: i < 4 ? 'fire' : 'smoke', x: p.x - ca * 18, y: p.y - sa * 18, vx: -ca * rand(120, 260) + rand(-60, 60), vy: -sa * rand(120, 260) + rand(-60, 60), life: rand(0.25, 0.5), size: rand(6, 12), drag: 4, glow: i < 4, color: '80,80,80' });
    }
    shake = Math.min(shake + w.shake, 30);
    A.sfx(w.id);
    if (w.kind === 'bullet' && w.id !== 'shotgun' && Math.random() < (w.rate > 12 ? 0.5 : 1)) {
      part({ kind: 'shell', x: p.x + ca * 8 - sa * 5, y: p.y + sa * 8 + ca * 5,
        vx: -sa * rand(90, 160) + rand(-30, 30), vy: ca * rand(90, 160) + rand(-30, 30),
        life: rand(0.5, 0.9), rot: rand(0, TAU), vr: rand(-20, 20), drag: 5, color: '#d8b04a' });
    }
  }

  function jagged(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 22));
      for (let k = 1; k < n; k++) out.push([lerp(ax, bx, k / n) + rand(-11, 11), lerp(ay, by, k / n) + rand(-11, 11)]);
      out.push([bx, by]);
    }
    return out;
  }

  // chain lightning: locks onto the enemy nearest the aim line, then jumps to its neighbours
  function fireArc(w, dmg, x0, y0, ang) {
    let tgt = null, bs = 1e9;
    for (const e of enemies) {
      if (e.dead || e.under) continue;
      const dx = e.x - x0, dy = e.y - y0, d = Math.hypot(dx, dy);
      if (d > w.range + e.r) continue;
      const da = Math.abs(angDiff(ang, Math.atan2(dy, dx)));
      if (da > 0.55) continue;
      const sc = d * (1 + da * 2);
      if (sc < bs) { bs = sc; tgt = e; }
    }
    const pts = [[x0, y0]];
    if (!tgt) {
      pts.push([x0 + Math.cos(ang) * w.range * 0.55, y0 + Math.sin(ang) * w.range * 0.55]);
      beams.push({ kind: 'bolt', pts: jagged(pts), life: 0.1, max: 0.1, color: w.color, w: 2 });
      return;
    }
    const hit = new Set(), ign = w.ign !== undefined ? w.ign : igniteChance(w);
    let cur = tgt, d = dmg;
    for (let k = 0; k <= w.chains && cur; k++) {
      hit.add(cur);
      pts.push([cur.x, cur.y]);
      const px = pts[pts.length - 2];
      const dx = cur.x - px[0], dy = cur.y - px[1], dl = Math.hypot(dx, dy) || 1;
      damageEnemy(cur, d, dx / dl, dy / dl, w.knock, w.src || w.id);
      perkHit(cur, ign);
      sparks(cur.x, cur.y, w.color, 5, 260);
      d *= 0.85;
      let nx = null, nd = 220 * 220;
      for (const e of enemies) {
        if (e.dead || e.under || hit.has(e)) continue;
        const dd = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
        if (dd < nd) { nd = dd; nx = e; }
      }
      cur = nx;
    }
    beams.push({ kind: 'bolt', pts: jagged(pts), life: 0.14, max: 0.14, color: w.color, w: 3 });
  }

  function updateDrones(dt) {
    const p = player;
    p.drones.forEach((d, i) => {
      d.a += dt * 2.2;
      const oa = d.a + (i * TAU) / p.drones.length;
      const k = 1 - Math.exp(-dt * 12);
      d.x = lerp(d.x, p.x + Math.cos(oa) * 44, k);
      d.y = lerp(d.y, p.y + Math.sin(oa) * 44, k);
      d.flash -= dt;
      d.cd -= dt;
      if (d.cd > 0 || state !== 'play') return;
      let best = null, bd = 470 * 470;
      for (const e of enemies) {
        if (e.dead || e.under || (e.type === 'phantom' && e.cloaked)) continue;
        const d2 = (e.x - d.x) ** 2 + (e.y - d.y) ** 2;
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (!best) { d.cd = 0.1; return; }
      const link = p.perk.dronelink;
      d.cd = link ? 0.11 : 0.22;
      const a = Math.atan2(best.y - d.y, best.x - d.x);
      d.aim = a; d.flash = 0.05;
      bullets.push({ kind: 'bullet', x: d.x, y: d.y, px: d.x, py: d.y, vx: Math.cos(a) * 1200, vy: Math.sin(a) * 1200, life: 0.5, max: 0.5,
        dmg: 11 * (1 + wave * 0.1) * (link >= 2 ? 1.3 : 1), r: 2.5, pierce: link ? 1 : 0, color: link ? '#ffb0ec' : '#ff7ad8', knock: 40, splash: 0, hits: null,
        ign: link >= 2 ? p.perk.ignite * 0.1 : 0, rico: link >= 2 ? p.perk.ricochet : 0, src: 'drone' });
      A.sfx('drone');
    });
  }

  const GEAR_EXTRA = {
    heal: { name: 'FIELD SURGEON', desc: 'FULL HEAL', color: '#ff4a5a', icon: 'H' },
    wup:  { name: 'GUNSMITH', desc: '+1 LEVEL TO HELD WEAPON', color: '#5ad1ff', icon: 'G' },
  };
  const gearInfo = k => GEAR[k] || GEAR_EXTRA[k] || PERKS[k];
  const isPerk = k => !!PERKS[k];
  // what a crate for key k gives if taken now
  const crateDesc = k => (PERKS[k] ? PERKS[k].desc[Math.min(player.perk[k], PERKS[k].max - 1)] : gearInfo(k).desc);
  const ownedTags = p => new Set(PERK_KEYS.filter(k => p.perk[k] > 0).flatMap(k => PERKS[k].tags));
  const perkOpen = (p, k) => p.perk[k] < PERKS[k].max && (!PERKS[k].needs || PERKS[k].needs(p));
  const synergy = (p, k) => p.perk[k] === 0 && PERKS[k].tags.some(t => ownedTags(p).has(t));

  function applyGear(key, quiet = false) {
    const p = player;
    if (key === 'heal') {
      p.hp = p.maxHp;
      banner('FIELD SURGEON', 'FULLY PATCHED UP', '#ff4a5a', 2, '', true);
      A.sfx('med');
      return;
    }
    if (key === 'wup') { collect({ kind: 'upgrade', x: p.x, y: p.y }); return; }
    // perks whose prerequisite this pick satisfies get called out on the banner
    const locked = PERK_KEYS.filter(k => PERKS[k].needs && !PERKS[k].needs(p));
    let info, lvl;
    if (isPerk(key)) {
      info = PERKS[key];
      const desc = crateDesc(key);
      lvl = ++p.perk[key];
      info = { ...info, desc };
    } else {
      info = GEAR[key];
      lvl = ++p.gear[key];
      switch (key) {
        case 'vital': p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 50); break;
        case 'shield': p.shieldMax = 30 * lvl; p.shield = p.shieldMax; break;
        case 'drone': p.drones.push({ a: 0, cd: 0.5, x: p.x, y: p.y, aim: p.angle, flash: 0 }); break;
      }
    }
    if (quiet) return;
    const opened = locked.filter(k => PERKS[k].needs(p));
    const sub2 = opened.length ? `SYNERGY UNLOCKED: ${opened.map(k => PERKS[k].name).join(', ')}` : isPerk(key) ? 'PERK' : '';
    banner(info.name, `${info.max > 1 ? `LEVEL ${lvl} - ` : ''}${info.desc}`, info.color, 2.4, sub2, true);
    A.sfx(isPerk(key) ? 'perk' : 'gear');
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.5, size: 60, color: info.color, glow: true });
    if (isPerk(key)) part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.7, size: 110, color: info.color, glow: true });
  }

  // three crates, take one: the others are recalled. One slot is always gear, one always a perk,
  // the third is either; perks that combo with what you own are favoured.
  let dropGroup = 0;
  function weightedPick(keys, wt) {
    let tot = 0;
    for (const k of keys) tot += wt(k);
    let r = Math.random() * tot;
    for (const k of keys) { r -= wt(k); if (r <= 0) return k; }
    return keys[keys.length - 1];
  }
  function supplyDrop() {
    const p = player;
    for (const pk of pickups) if (pk.kind === 'gear') pk.dead = true;
    const gear = GEAR_KEYS.filter(k => p.gear[k] < GEAR[k].max);
    const perks = PERK_KEYS.filter(k => perkOpen(p, k));
    const perkW = k => 1 + (p.perk[k] > 0 ? 0.8 : 0) + (synergy(p, k) ? 1.6 : 0) + (PERKS[k].needs ? 2 : 0);
    const take = (pool, wt) => { if (!pool.length) return null; const k = wt ? weightedPick(pool, wt) : choose(pool); pool.splice(pool.indexOf(k), 1); return k; };
    const picks = [];
    const g = take(gear), k1 = take(perks, perkW);
    if (g) picks.push(g);
    if (k1) picks.push(k1);
    while (picks.length < 3 && (gear.length || perks.length)) {
      const usePerk = perks.length && (!gear.length || Math.random() < 0.6);
      picks.push(usePerk ? take(perks, perkW) : take(gear));
    }
    if (picks.length < 3) picks.push('heal');
    while (picks.length < 3) picks.push('wup');
    picks.sort(() => Math.random() - 0.5);
    dropGroup++;
    const base = rand(0, TAU);
    picks.forEach((gk, i) => {
      const a = base + (i * TAU) / 3;
      const o = { x: clamp(p.x + Math.cos(a) * 150, WALL + 60, AW - WALL - 60), y: clamp(p.y + Math.sin(a) * 150, WALL + 60, AH - WALL - 60), r: 24 };
      collidePillars(o);
      pickups.push({ kind: 'gear', gk, group: dropGroup, x: o.x, y: o.y, t: rand(0, 6), life: Infinity, drop: 0.7 + i * 0.12 });
    });
    banner('SUPPLY DROP', 'GRAB ONE UPGRADE', '#5affc8', 2.2);
  }

  // ======================================================================= perks
  let fires = []; // afterburner patches on the floor
  let booms = []; // queued perk detonations: a short fuse makes chain reactions ripple outward

  function igniteChance(w) {
    const l = player ? player.perk.ignite : 0;
    if (!l || w.kind === 'flame') return 0;
    return l * 0.2 * (w.rate > 12 ? 0.5 : 1) * (w.pellets ? 0.45 : 1);
  }
  function ignite(e, t = 2.2, src = 'perk') {
    if (e.dead || e.under) return;
    if (!(e.burn > 0)) {
      for (let i = 0; i < 4; i++) part({ kind: 'fire', x: e.x + rand(-e.r, e.r) * 0.5, y: e.y + rand(-e.r, e.r) * 0.5, vx: rand(-40, 40), vy: rand(-90, -30), life: rand(0.25, 0.4), size: rand(8, 14), glow: true, drag: 1 });
      A.sfx('ignite');
    }
    e.burn = Math.max(e.burn, t);
    e.burnSrc = src;
  }
  function perkHit(e, chance) { if (chance > 0 && !e.dead && Math.random() < chance) ignite(e); }

  // a bullet that would stop on this alien hops to the nearest other one instead
  function bounceBullet(b, e) {
    let tgt = null, bd = 380 * 380;
    for (const o of enemies) {
      if (o === e || o.dead || o.under || (b.hits && b.hits.has(o)) || (o.type === 'phantom' && o.cloaked)) continue;
      const d2 = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
      if (d2 < bd) { bd = d2; tgt = o; }
    }
    if (!tgt) return false;
    b.rico--;
    (b.hits || (b.hits = new Set())).add(e);
    const sp = Math.hypot(b.vx, b.vy) || 1, a = Math.atan2(tgt.y - b.y, tgt.x - b.x);
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    b.life = Math.min(b.max, Math.max(b.life, Math.sqrt(bd) / sp + 0.12));
    b.dmg *= 0.8;
    b.color = PERKS.ricochet.color;
    sparks(b.x, b.y, PERKS.ricochet.color, 4, 200, a, 0.6);
    A.sfx('ricochet');
    return true;
  }

  function frenzyBonus() {
    const l = player.perk.frenzy;
    return l ? Math.min(l > 1 ? 0.5 : 0.3, player.frenzy * (l > 1 ? 0.03 : 0.02)) : 0;
  }

  function dropFire(x, y, lvl, src = 'perk') {
    if (fires.length >= 90) fires.shift();
    const life = lvl > 1 ? 4 : 2.5;
    fires.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), r: lvl > 1 ? 34 : 26, life, max: life, tick: 0, ph: rand(0, TAU), src });
  }

  function kineticBlast() {
    const p = player, l = p.perk.blast, R = l > 1 ? 165 : 125, dmg = perkDmg(l > 1 ? 40 : 28), c = PERKS.blast.color;
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.35, size: R, color: c, glow: true });
    part({ kind: 'flash', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.12, size: R * 0.8, color: c, glow: true });
    sparks(p.x, p.y, c, 14, 420);
    ripple(p.x, p.y, R * 2.2, 0.025, 0.4);
    shake = Math.min(30, shake + 6);
    A.sfx('kinetic');
    for (const e of enemies) {
      if (e.dead || e.under) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < R + e.r) damageEnemy(e, dmg * (1 - (d / (R + e.r)) * 0.5), dx / d, dy / d, 520, 'perk');
    }
    if (l > 1) for (const s of eshots) if (!s.lob && !s.dead && Math.hypot(s.x - p.x, s.y - p.y) < R) { s.dead = true; sparks(s.x, s.y, c, 3, 140); }
  }

  function queueBoom(x, y, R, dmg, color) {
    if (booms.length >= 40) return;
    booms.push({ x, y, R, dmg, color, t: rand(0.08, 0.16) });
    part({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.1, size: 22, color, glow: true });
  }

  function staticBurst() {
    const p = player, l = p.perk.static;
    const w = { range: 540, chains: l > 1 ? 4 : 3, color: PERKS.static.color, knock: 80, ign: player.perk.ignite * 0.2, src: 'perk' };
    const dmg = perkDmg(l > 1 ? 48 : 40);
    const near = enemies.filter(e => !e.dead && !e.under && Math.hypot(e.x - p.x, e.y - p.y) < 520)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
      .slice(0, l > 1 ? 5 : 3);
    if (!near.length) { p.staticN = (l > 1 ? 8 : 12) - 1; return; } // hold the charge for the next kill
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, size: 80, color: w.color, glow: true });
    for (const e of near) if (!e.dead) fireArc(w, dmg, p.x, p.y, Math.atan2(e.y - p.y, e.x - p.x));
    A.sfx('arc');
  }

  // every perk that reacts to a kill
  function perkKill(e, T) {
    const p = player, P = p.perk;
    if (P.leech) p.hp = Math.min(p.maxHp, p.hp + P.leech * (p.hp < p.maxHp * 0.35 ? 2 : 1));
    if (P.frenzy) p.frenzy++;
    if (!T.boss) {
      const pyre = P.pyre > 0 && e.burn > 0;
      if (pyre || (P.chain && Math.random() < P.chain * 0.12)) {
        const R = (pyre && P.pyre > 1 ? 100 : 78) + e.r * 0.5;
        queueBoom(e.x, e.y, R, perkDmg(pyre ? 34 : 40), pyre ? PERKS.pyre.color : PERKS.chain.color);
      }
    }
    if (P.static && ++p.staticN >= (P.static > 1 ? 8 : 12)) { p.staticN = 0; staticBurst(); }
    if (P.streak) {
      const tier = mult >= 8 && P.streak > 1 ? 2 : mult >= 4 ? 1 : 0;
      if (tier > p.streakLvl) {
        p.streakLvl = tier;
        p.overdrive = Math.max(p.overdrive, P.streak > 1 ? 6 : 4);
        floatText(p.x, p.y - 34, 'HOT STREAK!', PERKS.streak.color, 12);
        A.sfx('overdrive');
      }
    }
  }

  function updatePerks(dt) {
    for (const f of fires) {
      f.life -= dt;
      if (f.life <= 0) { f.dead = true; continue; }
      const k = f.life / f.max;
      if (Math.random() < 0.35 * k + 0.05) part({ kind: 'fire', x: f.x + rand(-f.r, f.r) * 0.5, y: f.y + rand(-f.r, f.r) * 0.5, vx: rand(-15, 15), vy: rand(-55, -20), life: rand(0.25, 0.45), size: rand(7, 13) * (0.5 + k * 0.5), glow: true, drag: 1 });
      if ((f.tick -= dt) > 0) continue;
      f.tick = 0.15;
      for (const e of enemies) if (!e.dead && !e.under && (e.x - f.x) ** 2 + (e.y - f.y) ** 2 < (f.r + e.r) ** 2) ignite(e, 1.8, f.src);
    }
    compact(fires);
    for (const b of booms) {
      if (b.dead || (b.t -= dt) > 0) continue;
      b.dead = true;
      explode(b.x, b.y, b.R, b.dmg, b.hostile ? 'boomer' : 'perk', b.by);
      part({ kind: 'ring', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, size: b.R * 0.8, color: b.color, glow: true });
    }
    compact(booms);
  }

  function hitShield(dmg) {
    const p = player;
    p.shieldDelay = 2.5;
    if (p.shield <= 0) return dmg;
    const ab = Math.min(p.shield, dmg);
    p.shield -= ab;
    p.shieldHit = 0.25;
    if (p.shield <= 0) {
      A.sfx('shieldbreak');
      for (let i = 0; i < 14; i++) { const a = rand(0, TAU); part({ kind: 'spark', x: p.x + Math.cos(a) * 26, y: p.y + Math.sin(a) * 26, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 0.35, size: 2, color: '#5ad1ff', drag: 3, glow: true }); }
    }
    return dmg - ab;
  }

  // continuous hazard damage (acid, plasma): ignores i-frames, respects armor and shield
  function envDamage(d, by) {
    const p = player;
    if (state !== 'play' || p.aegis > 0) return;
    d = hitShield(d * (1 - 0.12 * p.gear.armor));
    if (d <= 0) return;
    p.hp -= d;
    run.taken += d;
    if (p.hp <= 0) run.killedBy = by;
    hurtFlash = Math.min(1, hurtFlash + d * 0.04);
    if (p.hp <= 0) { p.hp = 0; playerDie(); }
  }

  function fireRail(w, dmg, x0, y0, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    let tmax = 4000;
    if (c > 0) tmax = Math.min(tmax, (AW - WALL - x0) / c);
    if (c < 0) tmax = Math.min(tmax, (WALL - x0) / c);
    if (s > 0) tmax = Math.min(tmax, (AH - WALL - y0) / s);
    if (s < 0) tmax = Math.min(tmax, (WALL - y0) / s);
    for (const pl of pillars) {
      const ox = x0 - pl.x, oy = y0 - pl.y;
      const b = ox * c + oy * s, cc = ox * ox + oy * oy - pl.r * pl.r;
      const disc = b * b - cc;
      if (disc > 0) {
        const t = -b - Math.sqrt(disc);
        if (t > 0) tmax = Math.min(tmax, t);
      }
    }
    tmax = Math.max(0, tmax);
    const x1 = x0 + c * tmax, y1 = y0 + s * tmax;
    for (const e of enemies) {
      if (!e.dead && segCircle(x0, y0, x1, y1, e.x, e.y, e.r + 6)) { damageEnemy(e, dmg, c, s, w.knock, w.id); perkHit(e, igniteChance(w) * 2); }
    }
    for (const b of barrels) if (!b.dead && segCircle(x0, y0, x1, y1, b.x, b.y, b.r + 4)) damageBarrel(b, dmg);
    beams.push({ x0, y0, x1, y1, life: 0.28, max: 0.28, color: w.color, w: 10 });
    sparks(x1, y1, w.color, 14, 380);
    part({ kind: 'flash', x: x1, y: y1, vx: 0, vy: 0, life: 0.15, size: 40, color: w.color, glow: true });
  }

  function hurtPlayer(dmg, src) {
    if (state !== 'play') return;
    const p = player;
    if (p.invuln > 0) { if (p.dashIF > 0 && !p.dodged) perfectDodge(); return; }
    if (p.aegis > 0) { sparks(p.x, p.y, '#ffd23a', 6, 220); p.invuln = 0.15; return; }
    dmg = hitShield(dmg * (1 - 0.12 * p.gear.armor));
    if (dmg <= 0) { A.sfx('shield'); p.invuln = 0.2; return; }
    p.hp -= dmg;
    run.taken += dmg;
    if (p.hp <= 0) run.killedBy = byName(src);
    p.invuln = 0.28;
    p.hitT = 0.22;
    hurtFlash = Math.min(1, hurtFlash + 0.45 + dmg / 40);
    aberr = Math.max(aberr, Math.min(1, 0.45 + dmg / 30));
    shake = Math.min(30, shake + 6 + dmg * 0.25);
    if (src) {
      const dx = p.x - src.x, dy = p.y - src.y, d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 260; p.vy += (dy / d) * 260;
    }
    blood(p.x, p.y, '#d01a2a', 10, 220);
    A.sfx('hurt');
    if (p.hp <= 0) { p.hp = 0; playerDie(); }
  }

  // dashing through an attack: brief slow-mo, dash refunded, combo kept alive
  function perfectDodge() {
    const p = player;
    p.dodged = true; p.dashCd = 0;
    run.dodges++;
    if (combo) comboTimer = Math.max(comboTimer, 1.8);
    if (slowT <= 0) { timeScale = 0.3; slowT = 0.35; }
    floatText(p.x, p.y - 32, 'PERFECT DODGE', '#7ae0ff', 11);
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.45, size: 90, color: '#7ae0ff', glow: true });
    ripple(p.x, p.y, 320, 0.02, 0.4);
    aberr = Math.max(aberr, 0.3);
    A.sfx('dodge');
  }

  function playerDie() {
    const p = player;
    state = 'dying';
    dyingT = 2.4;
    timeScale = 0.3; slowT = 1.6;
    shake = 30; aberr = 1;
    punchZoom(0.22); A.duck(0.15, 1.2, 1.5); ripple(p.x, p.y, 600, 0.04, 0.9);
    blood(p.x, p.y, '#d01a2a', 60, 420);
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU), s = rand(80, 300);
      part({ kind: 'gib', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), size: rand(3, 6), color: i % 3 ? '#8a1020' : '#2e5f6a', rot: rand(0, TAU), vr: rand(-15, 15), drag: 4 });
    }
    splat(p.x, p.y, 40, '#7a0a14', 12);
    music('off');
    A.sfx('death');
    run.time = gameTime;
    profile.runs++; profile.kills += kills;
    saveProfile();
    beginEntry();
    newRecord = false;
    if (wave > best.wave || score > best.score) {
      newRecord = true;
      best = { wave: Math.max(best.wave, wave), score: Math.max(best.score, score) };
      saveBest();
    }
  }

  // ======================================================================= enemies
  function makeEnemy(type, x, y, elite) {
    const T = ET[type];
    const isQueen = !!ET[type].boss;
    const hpMul = SC.hp * (elite && !isQueen ? 4 : 1);
    return {
      type, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      r: T.r * (elite && !isQueen ? 1.3 : 1),
      hp: T.hp * hpMul, maxHp: T.hp * hpMul,
      speed: T.speed * SC.spd * rand(0.9, 1.1) * (elite ? 0.92 : 1),
      dmg: T.dmg * SC.dmg, elite: !!elite,
      atkCd: 0, flash: 0, burn: 0, t: 0, phase: rand(0, TAU), angle: rand(0, TAU), spawnT: 0.45, walk: 0,
      st: null, stT: 0, cd: rand(0.5, 2), cloaked: false, cloakT: rand(1, 2), fuse: 0,
      lx: 0, ly: 0, tx: 0, ty: 0, spd: 0, ringCd: 0, dead: false,
      under: type === 'burrower',
      ...(type === 'burrower' ? { cd: rand(2.5, 4) } : {}), fly: type === 'wasp', hatch: type === 'egg' ? 3 : 0, shieldFlash: 0,
    };
  }

  function applyAffix(e, item) {
    e.affix = item.affix;
    e.hurtAt = 0; e.toxT = 0.5;
    if (item.champ) { e.champ = true; e.r *= 1.15; e.hp = e.maxHp = e.maxHp * 2.5; }
    if (hasAff(e, 'swift')) e.speed *= 1.45;
    if (item.bounty) {
      e.bounty = true; e.bountyT = 45;
      banner('BOUNTY', `${e.affix.map(k => AFFIX[k].name).join(' ')} ${ET[e.type].name}`, MODS.bounty.color, 2.4, 'KILL IT WITHIN 45 SECONDS', true);
      A.sfx('alarm');
    }
  }

  // per-frame affix behaviour; returns true if the alien left the arena
  function updateAffix(e, dt) {
    if (hasAff(e, 'regen') && e.t - e.hurtAt > 1.5 && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.07 * dt);
      if (Math.random() < dt * 8) part({ kind: 'dot', x: e.x + rand(-e.r, e.r), y: e.y + rand(-e.r, e.r), vx: 0, vy: -45, life: 0.5, size: 3, color: AFFIX.regen.color });
    }
    if (hasAff(e, 'toxic') && !e.under && (e.toxT -= dt) <= 0) {
      e.toxT = 0.75;
      if (Math.hypot(e.vx, e.vy) > 20 && pools.filter(pl => pl.temp).length < 36) pools.push({ x: e.x, y: e.y, r: 28 + e.r * 0.5, kind: 'acid', life: 3.5, temp: true });
    }
    if (hasAff(e, 'swift') && Math.random() < dt * 24) part({ kind: 'dot', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, size: e.r * 0.45, color: AFFIX.swift.color });
    if (e.bounty && (e.bountyT -= dt) <= 0) {
      e.dead = true;
      for (let i = 0; i < 14; i++) { const a = rand(0, TAU); part({ kind: 'smoke', x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: rand(0.6, 1), size: rand(14, 24), drag: 2, color: '60,60,40' }); }
      banner('BOUNTY ESCAPED', 'IT GOT AWAY', '#ff8a3a', 2, '', true);
      A.sfx('burrow');
      return true;
    }
    return false;
  }

  function affixDeath(e) {
    if (hasAff(e, 'splitter')) {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU), c = makeEnemy(e.type, e.x + Math.cos(a) * e.r * 0.6, e.y + Math.sin(a) * e.r * 0.6, false);
        c.hp = c.maxHp = c.maxHp * 0.45; c.r *= 0.8; c.under = false;
        c.vx = Math.cos(a) * 260; c.vy = Math.sin(a) * 260; c.spawnT = 0.15;
        enemies.push(c);
      }
      sparks(e.x, e.y, AFFIX.splitter.color, 10, 300);
      A.sfx('hatch');
    }
    // volatile: a fused blast that hurts everyone, telegraphed by a ring
    if (hasAff(e, 'volatile')) booms.push({ x: e.x, y: e.y, R: 120 + e.r, dmg: e.dmg * 1.4, color: AFFIX.volatile.color, t: 0.8, max: 0.8, hostile: true, by: `VOLATILE ${ET[e.type].name}` });
  }

  function claimBounty(e) {
    const reward = 250 * wave;
    score += reward;
    banner('BOUNTY CLAIMED', `+${reward}`, MODS.bounty.color, 2.2, 'WEAPON UPGRADE DROPPED', true);
    spawnPickup('upgrade', e.x, e.y);
    A.sfx('upgrade');
  }

  function spawnFromQueue(item) {
    const p = player;
    const far = vents.filter(v => Math.hypot(v.x - p.x, v.y - p.y) > (waveMod === 'ambush' ? 300 : 520));
    const v = choose(far.length ? far : vents);
    v.pulse = 1;
    const a = v.a + rand(-0.6, 0.6);
    const e = makeEnemy(item.type, v.x + Math.cos(a) * rand(10, 40), v.y + Math.sin(a) * rand(10, 40), item.elite);
    e.vx = Math.cos(v.a) * 220; e.vy = Math.sin(v.a) * 220; e.angle = v.a;
    if (item.affix) applyAffix(e, item);
    if (isBoss(e)) {
      banner('WARNING', `${ET[e.type].name} DETECTED`, ET[e.type].color, 2.2, '', true);
      A.sfx('roar'); shake = 20; aberr = Math.max(aberr, 0.6);
      punchZoom(0.12); A.duck(0.25, 0.6, 1); ripple(e.x, e.y, 520, 0.035, 0.7);
    }
    enemies.push(e);
    for (let i = 0; i < 5; i++) {
      part({ kind: 'smoke', x: v.x, y: v.y, vx: Math.cos(a) * rand(30, 90) + rand(-30, 30), vy: Math.sin(a) * rand(30, 90) + rand(-30, 30), life: rand(0.5, 1), size: rand(10, 20), drag: 2, color: '40,60,40' });
    }
  }

  // boss waves keep a thinner escort so the queen is the star of the fight
  const fieldTarget = () => Math.min(wave > 20 ? 75 : 60, 7 + wave * 3) * (wave % 5 === 0 ? 0.5 : 1) * (waveMod === 'swarm' ? 1.4 : 1);

  function onBeat(info) {
    beatPulse = 1;
    if (info.snare) snarePulse = 1;
    if (state !== 'play' || !waveActive || !spawnQueue.length) return;
    // Pressure model: top the field up toward a target head-count that grows each wave,
    // a few per beat, so kills are replaced on the music's pulse instead of dumping the whole wave.
    const target = fieldTarget();
    const cap = (1 + Math.floor(wave / 4) + (info.beat === 0 ? 1 : 0)) * (waveMod === 'ambush' ? 2 : 1);
    let n = Math.min(cap, Math.ceil(target - enemies.length));
    if (n <= 0 && info.beat === 0 && enemies.length < target * 1.25) n = 1; // never fully stall
    for (let i = 0; i < n && spawnQueue.length; i++) spawnFromQueue(spawnQueue.shift());
  }
  A.onBeat(info => { if (!sim.fakeBeat) onBeat(info); });
  A.onTrack(info => { nowPlaying = { name: info.name, mode: info.mode, key: info.key, t: 0 }; });

  function spit(e, ux, uy, d) {
    const p = player, sp = 340;
    const lead = (d / sp) * 0.5;
    const tx = p.x + p.vx * lead - e.x, ty = p.y + p.vy * lead - e.y;
    const tl = Math.hypot(tx, ty) || 1;
    eshots.push({ x: e.x + ux * e.r, y: e.y + uy * e.r, vx: (tx / tl) * sp, vy: (ty / tl) * sp, r: 6, dmg: 12 * SC.dmg, life: 2.6, color: '#9dff3a', by: e.type });
    A.sfx('spit');
  }

  function updateQueen(e, dt, ux, uy) {
    e.tx = ux; e.ty = uy; e.spd = e.speed;
    const enr = e.hp < e.maxHp * 0.5;
    e.cd -= dt;
    if (e.st === 'charge') {
      e.stT -= dt; e.tx = e.lx; e.ty = e.ly; e.spd = e.speed * 6.5;
      if (Math.random() < 0.6) part({ kind: 'smoke', x: e.x + rand(-20, 20), y: e.y + rand(-20, 20), vx: rand(-40, 40), vy: rand(-40, 40), life: 0.6, size: 18, drag: 2, color: '70,50,60' });
      if (e.stT <= 0) { e.st = null; e.cd = enr ? 1.2 : 2; }
      return;
    }
    if (e.st === 'wind') {
      e.stT -= dt; e.spd = 0;
      if (e.stT <= 0) { e.st = 'charge'; e.stT = 0.75; e.lx = ux; e.ly = uy; shake = Math.min(30, shake + 6); A.sfx('roar'); }
      return;
    }
    if (e.st === 'ring') {
      e.stT -= dt; e.spd *= 0.3; e.ringCd -= dt;
      if (e.ringCd <= 0) {
        e.ringCd = 0.3;
        const n = enr ? 22 : 16, off = e.t;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          eshots.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 8, dmg: 10 * SC.dmg, life: 3.2, color: '#ff4ad0', by: e.type });
        }
        A.sfx('spit');
      }
      if (e.stT <= 0) { e.st = null; e.cd = enr ? 1.4 : 2.2; }
      return;
    }
    if (e.cd <= 0) {
      const r = Math.random();
      if (r < 0.38) { e.st = 'ring'; e.stT = enr ? 1.0 : 0.65; e.ringCd = 0; }
      else if (r < 0.7) { e.st = 'wind'; e.stT = 0.7; }
      else {
        if (enemies.length < 70) {
          const n = enr ? 6 : 4;
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU);
            const c = makeEnemy('crawler', e.x + Math.cos(a) * (e.r + 20), e.y + Math.sin(a) * (e.r + 20), false);
            c.vx = Math.cos(a) * 250; c.vy = Math.sin(a) * 250;
            enemies.push(c);
          }
          blood(e.x, e.y, ET.queen.blood, 20, 200);
        }
        A.sfx('roar');
        e.cd = enr ? 1.5 : 2.5;
      }
    }
  }

  // ---------- boss mechanics shared helpers
  let shocks = []; // expanding ground shockwaves
  function lob(e, tx, ty, kind, dmg) {
    const d = Math.hypot(tx - e.x, ty - e.y);
    const t = clamp(d / 420, 0.7, 1.4);
    eshots.push({ lob: kind, x: e.x, y: e.y, sx: e.x, sy: e.y, tx, ty, t: 0, dur: t, vx: 0, vy: 0, r: 9, dmg, life: t, color: kind === 'gas' ? '#9dff3a' : '#ffb02a', by: e.type });
  }
  function landLob(s) {
    if (s.lob === 'gas') {
      pools.push({ x: s.tx, y: s.ty, r: 65, kind: 'acid', life: 5, temp: true });
      blood(s.tx, s.ty, '#9dff3a', 14, 200);
    } else {
      part({ kind: 'ring', x: s.tx, y: s.ty, vx: 0, vy: 0, life: 0.35, size: 70, color: '#ffb02a', glow: true });
      blood(s.tx, s.ty, '#e0c050', 16, 240);
      if (state === 'play' && Math.hypot(player.x - s.tx, player.y - s.ty) < 70 + player.r) hurtPlayer(s.dmg, { x: s.tx, y: s.ty, by: s.by });
      if (Math.random() < 0.3 && enemies.length < 90) { const egg = makeEnemy('egg', s.tx, s.ty, false); egg.spawnT = 0.2; enemies.push(egg); }
    }
    A.sfx('hatch');
  }
  function bossBase(e, ux, uy) {
    e.tx = ux; e.ty = uy; e.spd = e.speed;
    if (e.cd > 0) e.cd -= e._dt;
  }

  function updateSpecimen(e, dt, ux, uy, d) {
    e._dt = dt; bossBase(e, ux, uy);
    const enr = e.hp < e.maxHp * 0.5;
    // regenerates while wading in slime: drag it out
    for (const pl of pools) if (pl.kind === 'slime' && Math.hypot(e.x - pl.x, e.y - pl.y) < pl.r) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.025 * dt);
      if (Math.random() < 0.3) part({ kind: 'spark', x: e.x + rand(-30, 30), y: e.y + rand(-30, 30), vx: 0, vy: -80, life: 0.4, size: 2, color: '#5dff8a', glow: true, drag: 1 });
    }
    if (enr && !e.shed) { // sheds a swarm once
      e.shed = true;
      for (let i = 0; i < 6; i++) { const a = rand(0, TAU); const c = makeEnemy('crawler', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, false); c.vx = Math.cos(a) * 300; c.vy = Math.sin(a) * 300; enemies.push(c); }
      banner('IT IS SHEDDING!', '', ET.specimen.color, 1.4, '', true);
      A.sfx('roar');
    }
    if (e.st === 'wind') { e.stT -= dt; e.spd = 0; if (e.stT <= 0) { e.st = 'leap'; e.stT = 0.6; e.lx = ux; e.ly = uy; e.fly = true; A.sfx('leap'); } return; }
    if (e.st === 'leap') {
      e.stT -= dt; e.tx = e.lx; e.ty = e.ly; e.spd = Math.min(900, d * 2.4 + 300);
      if (e.stT <= 0) {
        e.st = null; e.fly = false; e.cd = enr ? 1.2 : 2;
        shocks.push({ x: e.x, y: e.y, r: e.r, spd: 520, max: 210, dmg: e.dmg * 0.6, hit: false, color: '#7aff5a', by: e.type });
        shake = Math.min(30, shake + 14); A.sfx('thud');
      }
      return;
    }
    if (e.cd <= 0) {
      if (Math.random() < 0.55) {
        const n = enr ? 3 : 2;
        for (let i = 0; i < n; i++) lob(e, player.x + player.vx * 0.6 + rand(-140, 140), player.y + player.vy * 0.6 + rand(-140, 140), 'gas', 0);
        A.sfx('spit'); e.cd = enr ? 2.2 : 3.2;
      } else { e.st = 'wind'; e.stT = 0.6; }
    }
  }

  function updateTitan(e, dt, ux, uy) {
    e._dt = dt; bossBase(e, ux, uy);
    const enr = e.hp < e.maxHp * 0.5;
    if (e.st === 'barrage') {
      e.spd = 0; e.stT -= dt; e.ringCd -= dt;
      if (e.ringCd <= 0 && e.shots > 0) {
        e.ringCd = 0.18; e.shots--;
        const a = rand(0, TAU), rr = rand(30, 190);
        lob(e, player.x + Math.cos(a) * rr + player.vx * 0.5, player.y + Math.sin(a) * rr + player.vy * 0.5, 'mortar', 18 * SC.dmg);
        A.sfx('spit');
      }
      if (e.stT <= 0) { e.st = null; e.cd = enr ? 1.6 : 2.6; }
      return;
    }
    if (e.cd <= 0) {
      if (Math.random() < 0.6) { e.st = 'barrage'; e.shots = enr ? 9 : 6; e.stT = 2; e.ringCd = 0.3; A.sfx('roar'); }
      else {
        const n = enr ? 8 : 6;
        if (enemies.length < 85) for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const egg = makeEnemy('egg', e.x + Math.cos(a) * (e.r + 40), e.y + Math.sin(a) * (e.r + 40), false);
          egg.spawnT = 0.3; egg.hatch = 2.4; enemies.push(egg);
        }
        A.sfx('hatch'); e.cd = enr ? 2 : 3;
      }
    }
  }

  function updateBehemoth(e, dt, ux, uy) {
    e._dt = dt; bossBase(e, ux, uy);
    const enr = e.hp < e.maxHp * 0.5;
    if (e.st === 'beams') {
      e.spd = e.speed * 0.25; e.stT -= dt;
      const live = e.stT < 3.6;
      for (const b of e.beams) {
        if (live) b.a += b.dir * (enr ? 0.95 : 0.7) * dt;
        b.on = live;
        if (live && state === 'play') {
          const x1 = e.x + Math.cos(b.a) * 560, y1 = e.y + Math.sin(b.a) * 560;
          if (segCircle(e.x, e.y, x1, y1, player.x, player.y, player.r + 6)) hurtPlayer(e.dmg * 0.3, e);
        }
      }
      if (e.stT <= 0) { e.st = null; e.beams = null; e.cd = enr ? 1.4 : 2.2; }
      return;
    }
    if (e.st === 'wind') {
      e.spd = 0; e.stT -= dt;
      if (e.stT <= 0) {
        e.st = null; e.cd = enr ? 1.3 : 2;
        for (let i = 0; i < (enr ? 3 : 2); i++) shocks.push({ x: e.x, y: e.y, r: e.r - i * 120, spd: 380, max: 650, dmg: e.dmg * 0.45, hit: false, color: '#ff7a1a', by: e.type });
        shake = Math.min(30, shake + 18); aberr = Math.max(aberr, 0.5); A.sfx('explode');
        ripple(e.x, e.y, 600, 0.035, 0.6);
      }
      return;
    }
    if (e.cd <= 0) {
      if (Math.random() < 0.55) {
        e.st = 'beams'; e.stT = 4.4;
        const n = enr ? 3 : 2, base = Math.atan2(uy, ux) + Math.PI / 2, dir = Math.random() < 0.5 ? 1 : -1;
        e.beams = Array.from({ length: n }, (_, i) => ({ a: base + (i * TAU) / n, dir, on: false }));
        A.sfx('alarm');
      } else { e.st = 'wind'; e.stT = 0.7; A.sfx('roar'); }
    }
  }

  function updateShocks(dt) {
    for (const sh of shocks) {
      sh.r += sh.spd * dt;
      if (sh.r > sh.max) { sh.dead = true; continue; }
      if (sh.r > 0 && !sh.hit && state === 'play') {
        const d = Math.hypot(player.x - sh.x, player.y - sh.y);
        if (Math.abs(d - sh.r) < 16 + player.r * 0.5) { sh.hit = true; hurtPlayer(sh.dmg, sh); }
      }
    }
    compact(shocks);
    for (const pl of pools) if (pl.temp) { pl.life -= dt; if (pl.life <= 0) pl.dead = true; }
    compact(pools);
  }

  function updateEnemy(e, dt) {
    const T = ET[e.type];
    const p = player;
    e.t += dt; e.flash -= dt; e.atkCd -= dt;
    e.spawnT = Math.max(0, e.spawnT - dt);
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let tx = ux, ty = uy, spd = e.speed;
    let faceTarget = false;

    switch (e.type) {
      case 'crawler': {
        const w = Math.sin(e.t * 6 + e.phase) * 0.35;
        tx = ux - uy * w; ty = uy + ux * w;
        break;
      }
      case 'leaper': {
        if (e.st === 'wind') {
          e.stT -= dt; spd = 0; faceTarget = true;
          if (e.stT <= 0) { e.st = 'lunge'; e.stT = 0.38; e.lx = ux; e.ly = uy; A.sfx('leap'); }
        } else if (e.st === 'lunge') {
          e.stT -= dt; tx = e.lx; ty = e.ly; spd = e.speed * 4.2;
          if (e.stT <= 0) { e.st = null; e.cd = rand(1.6, 2.4); }
        } else {
          e.cd -= dt;
          if (d < 300 && e.cd <= 0 && e.spawnT <= 0) { e.st = 'wind'; e.stT = 0.4; }
        }
        break;
      }
      case 'spitter': {
        const R = 380;
        e.cd -= dt;
        if (hunt) spd *= 1.2;
        else if (d < R * 0.65) { tx = -ux; ty = -uy; }
        else if (d < R) {
          const s = e.phase > Math.PI ? 1 : -1;
          tx = -uy * s * 0.9 + ux * 0.1; ty = ux * s * 0.9 + uy * 0.1; spd *= 0.7;
        }
        if (d < R + 120 && e.cd <= 0 && e.spawnT <= 0) {
          e.cd = rand(1.8, 2.6) / (1 + wave * 0.02);
          spit(e, ux, uy, d);
        }
        break;
      }
      case 'brute': {
        e.cd -= dt;
        if (e.st === 'charge') {
          e.stT -= dt; tx = e.lx; ty = e.ly; spd = e.speed * 4;
          if (Math.random() < 0.5) part({ kind: 'smoke', x: e.x, y: e.y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.5, size: 14, drag: 2, color: '60,50,40' });
          if (e.stT <= 0) { e.st = null; e.cd = rand(3, 5); }
        } else if (e.st === 'wind') {
          e.stT -= dt; spd = 0; faceTarget = true;
          if (e.stT <= 0) { e.st = 'charge'; e.stT = 0.7; e.lx = ux; e.ly = uy; A.sfx('roar'); }
        } else if (d < 420 && d > 120 && e.cd <= 0) {
          e.st = 'wind'; e.stT = 0.5;
        }
        break;
      }
      case 'boomer': {
        if (e.fuse > 0) {
          e.fuse -= dt; spd *= 0.3;
          if (e.fuse <= 0) { killEnemy(e); return; }
        } else if (d < e.r + p.r + 26 && state === 'play') {
          e.fuse = 0.4; A.sfx('fuse');
        }
        break;
      }
      case 'phantom': {
        e.cloakT -= dt;
        if (e.cloakT <= 0) { e.cloaked = !e.cloaked; e.cloakT = e.cloaked ? rand(1.8, 2.6) : rand(1, 1.6); }
        if (e.cloaked) spd *= 1.25;
        const w = Math.sin(e.t * 3 + e.phase) * 0.6;
        tx = ux - uy * w; ty = uy + ux * w;
        break;
      }
      case 'burrower': {
        if (e.st === 'emerge') {
          spd = 0; e.stT -= dt;
          if (Math.random() < 0.6) part({ kind: 'dot', x: e.x + rand(-14, 14), y: e.y + rand(-14, 14), vx: rand(-60, 60), vy: rand(-60, 60), life: 0.4, size: 3, color: '#6a4a24', drag: 4 });
          if (e.stT <= 0) {
            e.st = 'up'; e.under = false; e.stT = 3.2;
            shake = Math.min(30, shake + 4);
            for (let i = 0; i < 12; i++) { const a = rand(0, TAU); part({ kind: 'gib', x: e.x, y: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 0.4, size: 4, color: '#5a3e1e', rot: 0, vr: 8, drag: 5 }); }
            if (d < e.r + p.r + 34 && state === 'play') hurtPlayer(e.dmg, e);
          }
        } else if (e.st === 'up') {
          spd *= 0.45; e.stT -= dt;
          if (e.stT <= 0) { e.st = 'dig'; e.stT = 0.5; }
        } else if (e.st === 'dig') {
          spd = 0; e.stT -= dt;
          if (e.stT <= 0) { e.st = null; e.under = true; e.cd = rand(2.5, 4); }
        } else {
          e.under = true;
          e.cd -= dt;
          if (Math.random() < 0.5) part({ kind: 'dot', x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), vx: rand(-30, 30), vy: rand(-30, 30), life: 0.5, size: 3, color: '#5a3e1e', drag: 3 });
          // surfaces under the player, or on its own after a while (never permanently untouchable)
          if ((d < 100 || e.cd <= 0) && e.spawnT <= 0 && state === 'play') { e.st = 'emerge'; e.stT = 0.45; A.sfx('burrow'); }
        }
        break;
      }
      case 'warden': {
        if (d < e.r + p.r + 20) spd *= 0.5;
        break;
      }
      case 'hatcher': {
        e.cd -= dt;
        if (e.cd <= 0 && e.spawnT <= 0) {
          e.cd = rand(3.5, 5);
          if (enemies.length < 90) {
            const egg = makeEnemy('egg', e.x - Math.cos(e.angle) * e.r, e.y - Math.sin(e.angle) * e.r, false);
            egg.spawnT = 0.2;
            enemies.push(egg);
          }
        }
        break;
      }
      case 'egg': {
        spd = 0;
        e.hatch -= dt;
        if (e.hatch <= 0) { e.dead = true; splat(e.x, e.y, 14, ET.egg.blood, 4); spawnMites(e.x, e.y, 3); return; }
        break;
      }
      case 'mite': {
        const w = Math.sin(e.t * 11 + e.phase) * 0.6;
        tx = ux - uy * w; ty = uy + ux * w;
        break;
      }
      case 'wasp': {
        if (e.st === 'dive') {
          e.stT -= dt; tx = e.lx; ty = e.ly; spd = e.speed * 2.6;
          if (e.stT <= 0) { e.st = null; e.cd = rand(2, 3.2); }
        } else {
          e.cd -= dt;
          const R = 230, sgn = e.phase > Math.PI ? 1 : -1, radial = (d - R) / R;
          tx = ux * radial * 2 - uy * sgn; ty = uy * radial * 2 + ux * sgn;
          if (e.cd <= 0 && d < 430 && e.spawnT <= 0) { e.st = 'dive'; e.stT = 0.5; e.lx = ux; e.ly = uy; A.sfx('buzz'); }
        }
        break;
      }
      case 'queen': {
        updateQueen(e, dt, ux, uy);
        tx = e.tx; ty = e.ty; spd = e.spd;
        faceTarget = e.st === 'wind';
        break;
      }
      case 'specimen': case 'titan': case 'behemoth': {
        if (e.type === 'specimen') updateSpecimen(e, dt, ux, uy, d);
        else if (e.type === 'titan') updateTitan(e, dt, ux, uy);
        else updateBehemoth(e, dt, ux, uy);
        tx = e.tx; ty = e.ty; spd = e.spd;
        faceTarget = e.st === 'wind' || e.st === 'barrage';
        break;
      }
    }
    if (hunt && !isBoss(e)) spd *= 1.3;
    if (!e.fly && !e.under) for (const pl of pools) if (pl.kind === 'slime' && Math.hypot(e.x - pl.x, e.y - pl.y) < pl.r * 0.9) { spd *= 0.6; break; }
    if (state !== 'play' && state !== 'dying') spd = 0;

    // steer around pillars
    if (!e.fly && !e.under) for (const pl of pillars) {
      const ox = e.x - pl.x, oy = e.y - pl.y;
      const od = Math.hypot(ox, oy);
      const lim = pl.r + e.r + 40;
      if (od < lim && od > 0) {
        const nx = ox / od, ny = oy / od;
        if (tx * nx + ty * ny < 0) { // heading into the pillar
          let px = -ny, py = nx;
          if (px * tx + py * ty < 0) { px = -px; py = -py; }
          const k = 1 - (od - pl.r - e.r) / 40;
          tx += px * k * 1.2; ty += py * k * 1.2;
        }
      }
    }
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const fast = e.st === 'lunge' || e.st === 'charge';
    const acc = 1 - Math.exp(-dt * (fast ? 20 : 8));
    e.vx = lerp(e.vx, tx * spd, acc); e.vy = lerp(e.vy, ty * spd, acc);
    e.x += (e.vx + e.kx) * dt; e.y += (e.vy + e.ky) * dt;
    const kd = Math.exp(-dt * 8);
    e.kx *= kd; e.ky *= kd;
    const vm = Math.hypot(e.vx, e.vy);
    e.walk += vm * dt * 0.09;
    const prevA = e.angle;
    e.hitT -= dt; e.biteT -= dt;
    e.near = d < e.r + p.r + 45;
    if (e.type === 'warden') e.angle += clamp(angDiff(e.angle, Math.atan2(uy, ux)), -1.5 * dt, 1.5 * dt); // slow turn: flank it
    else if (faceTarget) e.angle += angDiff(e.angle, Math.atan2(uy, ux)) * Math.min(1, dt * 12);
    else if (vm > 10) e.angle += angDiff(e.angle, Math.atan2(e.vy, e.vx)) * Math.min(1, dt * 10);
    e.av = lerp(e.av || 0, angDiff(prevA, e.angle) / Math.max(dt, 1e-4), Math.min(1, dt * 12));
    if (!e.fly && !e.under) collidePillars(e);
    clampArena(e);
    e.shieldFlash -= dt;
    if (e.affix && updateAffix(e, dt)) return;

    if (e.burn > 0) {
      e.burn -= dt;
      const bd = 22 * dt * (1 + wave * 0.05), bs = e.burnSrc || 'flamer';
      if (state === 'play') run.dmg[bs] = (run.dmg[bs] || 0) + Math.min(bd, Math.max(0, e.hp));
      e.lastSrc = bs;
      e.hp -= bd;
      if (Math.random() < 0.35) part({ kind: 'fire', x: e.x + rand(-e.r, e.r) * 0.6, y: e.y + rand(-e.r, e.r) * 0.6, vx: rand(-20, 20), vy: rand(-60, -20), life: rand(0.25, 0.45), size: rand(6, 12), glow: true, drag: 1 });
      if (e.hp <= 0) { killEnemy(e); return; }
    }

    // body contact with the player
    const rr = e.r + p.r;
    if (d < rr && !e.under && e.dmg > 0 && (state === 'play' || state === 'dying')) {
      const push = rr - d;
      e.x -= ux * push; e.y -= uy * push;
      if (state === 'play' && e.spawnT <= 0 && e.atkCd <= 0) {
        e.biteT = 0.18;
        hurtPlayer(e.dmg, e);
        e.atkCd = 0.7;
        if (e.type === 'boomer') { killEnemy(e); return; }
        if (e.st === 'lunge') { e.st = null; e.cd = 2; }
      }
    }
  }

  function separate() {
    const n = enemies.length;
    for (let i = 0; i < n; i++) {
      const a = enemies[i];
      if (a.dead || a.under) continue;
      const ma = ET[a.type].mass;
      for (let j = i + 1; j < n; j++) {
        const b = enemies[j];
        if (b.dead || b.under) continue;
        const rr = (a.r + b.r) * 0.9;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2), o = ((rr - d) / d) * 0.5;
        const mb = ET[b.type].mass, t = ma + mb;
        a.x -= dx * o * (mb / t); a.y -= dy * o * (mb / t);
        b.x += dx * o * (ma / t); b.y += dy * o * (ma / t);
      }
    }
  }

  // boss crossing half health: a beat of camera, sound and screen to mark the new phase
  function bossEnrageCheck(e) {
    if (e.enragedFx || !isBoss(e) || e.hp >= e.maxHp * 0.5 || e.hp <= 0) return;
    e.enragedFx = true;
    punchZoom(0.11); shake = Math.min(30, shake + 14); aberr = Math.max(aberr, 0.7);
    ripple(e.x, e.y, 560, 0.035, 0.6); A.sfx('roar'); A.duck(0.3, 0.4, 0.8);
    banner('ENRAGED', `${ET[e.type].name} IS FURIOUS`, ET[e.type].color, 1.8, '', true);
  }
  function damageEnemy(e, dmg, kx, ky, knock, src = 'other') {
    if (e.dead || e.under) return;
    if (state === 'play') run.dmg[src] = (run.dmg[src] || 0) + Math.min(dmg, Math.max(0, e.hp));
    e.lastSrc = src;
    e.hp -= dmg;
    e.hurtAt = e.t;
    e.flash = 0.06;
    e.hitT = 0.12;
    const m = ET[e.type].mass;
    e.kx += (kx * knock) / m; e.ky += (ky * knock) / m;
    blood(e.x, e.y, ET[e.type].blood, 3, 180, Math.atan2(ky, kx));
    A.sfx('hit');
    if (e.hp <= 0) killEnemy(e);
    else bossEnrageCheck(e);
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    const T = ET[e.type];
    if (state === 'play') {
      kills++; combo++; comboTimer = 1.8;
      if (combo === 42) { floatText(player.x, player.y - 46, 'MAX COMBO  +21% DMG', '#ff3af0', 12); A.sfx('upgrade'); }
      const ks = e.lastSrc || 'other';
      run.kills[ks] = (run.kills[ks] || 0) + 1;
      run.bestCombo = Math.max(run.bestCombo, combo);
      if (T.boss) { run.bosses++; profile.bosses[e.type] = (profile.bosses[e.type] || 0) + 1; checkUnlocks(); }
      if (e.burn > 0) { profile.burnKills++; checkUnlocks(); }
      else if (e.elite) run.elites++;
      if (e.champ) run.champs++;
      if (e.bounty) { run.bounties++; profile.bounties++; checkUnlocks(); }
      mult = Math.min(8, 1 + Math.floor(combo / 6));
      const pts = T.score * (e.elite && !T.boss ? 5 : e.champ ? 3 : 1) * mult * (waveMod === 'bloodmoon' ? 2 : 1);
      score += pts;
      if (pts >= 150 || T.boss || (e.elite && !T.boss)) floatText(e.x, e.y - e.r, '+' + pts, pts >= 500 ? '#ffd23a' : '#ffffff', pts >= 500 ? 16 : 10);
      perkKill(e, T);
    }
    blood(e.x, e.y, T.blood, 14 + e.r, 260);
    const ng = 3 + Math.floor(e.r / 6);
    for (let i = 0; i < ng; i++) {
      const a = rand(0, TAU), s = rand(60, 260);
      part({ kind: 'gib', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), size: rand(2.5, 5) * (e.r / 14), color: i % 2 ? T.dark : T.body, splat: T.blood, rot: rand(0, TAU), vr: rand(-15, 15), drag: 4 });
    }
    splat(e.x, e.y, e.r * 1.6, T.blood, 8);
    deathGhost(e, T);
    if (e.type !== 'egg' && e.type !== 'boomer') stampCorpse(e);
    part({ kind: 'flash', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.08, size: e.r * 2.2, color: T.blood, glow: true });
    A.sfx('die');
    shake = Math.min(30, shake + e.r / 14);

    if (e.type === 'boomer') explode(e.x, e.y, 115, e.dmg, 'boomer');
    if (e.type === 'hatcher') spawnMites(e.x, e.y, 5);
    if (e.affix) affixDeath(e);
    // micro hit-stop on heavy kills sells the impact
    if (slowT <= 0 && (e.elite || e.type === 'brute') && !T.boss) { timeScale = 0.12; slowT = e.elite ? 0.14 : 0.07; }
    if (T.boss) {
      for (let i = 0; i < 5; i++) explode(e.x + rand(-50, 50), e.y + rand(-50, 50), 90, 0, 'fx');
      timeScale = 0.25; slowT = 1.3; shake = 30; aberr = 1;
      punchZoom(0.16); A.duck(0.2, 0.8, 1.2); ripple(e.x, e.y, 900, 0.045, 1.1);
      banner(`${T.name} SLAIN`, 'THE HIVE SCREAMS', T.color, 2.4, '', true);
      e.beams = null;
      spawnPickup('ammo', e.x + 40, e.y);
      if (state === 'play') {
        player.maxHp += 20; player.hp = player.maxHp;
        floatText(player.x, player.y - 40, '+20 MAX HP', '#5dff8a', 12);
      }
    }
    if (state !== 'play') return;
    if (e.bounty) claimBounty(e);
    else if (e.champ) spawnPickup('power', e.x, e.y, choose(['overdrive', 'aegis', 'chrono', 'nova']));
    if (e.elite) {
      const wi = carrierWeapon(wave);
      if (wi !== undefined) spawnPickup('weapon', e.x, e.y, wi);
      else spawnPickup('upgrade', e.x, e.y);
    } else if (!T.boss) {
      const mul = e.type === 'brute' ? 2.5 : 1;
      const r = Math.random();
      const med = (player.hp < 40 ? 0.06 : 0.03) * mul;
      const cw = WEAPONS[player.cur], cs = player.ws[player.cur];
      const ownsAmmoGun = player.ws.some((st, i) => st.owned && WEAPONS[i].ammoMax !== Infinity);
      const low = cw.ammoMax !== Infinity ? cs.ammo < cw.ammoMax * 0.25 : ownsAmmoGun;
      const ammo = 0.065 * mul * (low ? 1.8 : 1) * (player.perk.scavenger ? 1.5 : 1);
      if (r < med) spawnPickup('med', e.x, e.y);
      else if (r < med + ammo) spawnPickup('ammo', e.x, e.y);
      else if (r < med + ammo + 0.016 * mul) spawnPickup('power', e.x, e.y, choose(['overdrive', 'overdrive', 'aegis', 'chrono', 'nova', 'nova']));
    }
  }

  function explode(x, y, R, dmg, src, by = 'boomer') {
    // perk blasts can cascade a dozen at a time, so they're lighter on particles and shake
    const lite = src === 'perk', mine = src === 'player' || lite;
    shake = Math.min(30, shake + (lite ? 5 : mine ? 9 : 12)); aberr = Math.max(aberr, lite ? 0.15 : mine ? 0.25 : 0.45);
    if (R >= 90 && src !== 'fx') ripple(x, y, R * 2.6, mine ? 0.02 : 0.03, 0.45);
    part({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.18, size: R * 1.1, color: '#ffd27a', glow: true });
    part({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.35, size: R, color: '#ff9a3a', glow: true });
    for (let i = 0; i < (lite ? 11 : 22); i++) {
      const a = rand(0, TAU), s = rand(40, 260);
      part({ kind: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), size: rand(10, 22), glow: true, drag: 4 });
    }
    for (let i = 0; i < (lite ? 4 : 10); i++) {
      const a = rand(0, TAU), s = rand(20, 120);
      part({ kind: 'smoke', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 1.4), size: rand(16, 30), drag: 2, color: '30,28,26' });
    }
    sparks(x, y, '#ffcf5a', lite ? 8 : 18, 520);
    scorch(x, y, R * 0.65);
    A.sfx('explode');
    if (src === 'fx') return;
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < R + e.r) {
        const f = 1 - (d / (R + e.r)) * 0.6;
        const edmg = src === 'boomer' ? 2 * ET.boomer.hp * SC.hp : dmg; // barrels use their own dmg
        damageEnemy(e, edmg * f, dx / d, dy / d, 320 * f, src === 'player' ? 'rocket' : src === 'perk' ? 'perk' : src === 'barrel' ? 'barrel' : 'alien');
      }
    }
    for (const b of barrels) if (!b.dead && Math.hypot(b.x - x, b.y - y) < R + b.r) damageBarrel(b, 999);
    if ((src === 'boomer' || src === 'barrel') && player && state === 'play') {
      const d = Math.hypot(player.x - x, player.y - y);
      if (d < R + player.r) hurtPlayer(dmg * (src === 'barrel' ? 0.45 : 1) * (1 - (d / (R + player.r)) * 0.5), { x, y, by });
    }
  }

  function spawnMites(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const m = makeEnemy('mite', x + Math.cos(a) * 14, y + Math.sin(a) * 14, false);
      m.vx = Math.cos(a) * 260; m.vy = Math.sin(a) * 260; m.spawnT = 0.15;
      enemies.push(m);
    }
    A.sfx('hatch');
  }

  function nova() {
    const p = player;
    part({ kind: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.5, size: 380, color: '#ff7ad8', glow: true });
    part({ kind: 'flash', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, size: 260, color: '#ff7ad8', glow: true });
    shake = 25; aberr = Math.max(aberr, 0.8);
    ripple(p.x, p.y, 520, 0.04, 0.6); punchZoom(0.06);
    for (const e of enemies) {
      if (e.dead || e.under) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 380 + e.r) damageEnemy(e, 130 * SC.hp * (1 - d / 760), dx / d, dy / d, 600, 'power');
    }
    for (const s of eshots) if (Math.hypot(s.x - p.x, s.y - p.y) < 380) s.dead = true;
    A.sfx('nova');
  }

  // ======================================================================= pickups
  function spawnPickup(kind, x, y, wi) {
    const forever = kind === 'weapon' || kind === 'upgrade';
    pickups.push({ kind, x: clamp(x, WALL + 30, AW - WALL - 30), y: clamp(y, WALL + 30, AH - WALL - 30), wi, t: rand(0, 6), life: forever ? Infinity : 16 });
  }

  function collect(pk) {
    const p = player;
    pk.dead = true;
    part({ kind: 'ring', x: pk.x, y: pk.y, vx: 0, vy: 0, life: 0.3, size: 40, color: '#ffffff', glow: true });
    switch (pk.kind) {
      case 'med':
        p.hp = Math.min(p.maxHp, p.hp + 35);
        floatText(p.x, p.y - 24, '+35 HP', '#5dff8a');
        A.sfx('med');
        break;
      case 'ammo': {
        let any = false;
        p.ws.forEach((st, i) => {
          const w = WEAPONS[i];
          if (st.owned && w.ammoMax !== Infinity) { st.ammo = Math.min(w.ammoMax, st.ammo + w.pick); any = true; }
        });
        floatText(p.x, p.y - 24, any ? 'AMMO' : '+100', '#ffd23a');
        if (!any) score += 100;
        A.sfx('pickup');
        break;
      }
      case 'power': {
        const P = POWER[pk.wi];
        if (pk.wi === 'nova') nova();
        else p[pk.wi] = P.dur;
        floatText(p.x, p.y - 24, P.name + '!', P.color, 12);
        if (pk.wi !== 'nova') A.sfx(pk.wi);
        break;
      }
      case 'gear':
        for (const o of pickups) if (o.kind === 'gear' && o.group === pk.group && o !== pk && !o.dead) {
          o.dead = true;
          part({ kind: 'ring', x: o.x, y: o.y, vx: 0, vy: 0, life: 0.4, size: 30, color: '#5affc8', glow: true });
        }
        applyGear(pk.gk);
        break;
      case 'weapon': {
        const w = WEAPONS[pk.wi], st = p.ws[pk.wi];
        st.owned = true;
        st.ammo = w.start;
        selectWeapon(pk.wi, true);
        banner('NEW WEAPON', w.name, w.color, 2.2, `EQUIPPED - SLOT ${(pk.wi + 1) % 10}`, true);
        A.sfx('weapon');
        shake = Math.min(30, shake + 6);
        break;
      }
      case 'upgrade': {
        let i = p.cur;
        if (p.ws[i].lvl >= 5) {
          const opts = p.ws.map((s, k) => k).filter(k => p.ws[k].owned && p.ws[k].lvl < 5);
          i = opts.length ? choose(opts) : -1;
        }
        if (i >= 0) {
          const st = p.ws[i];
          st.lvl++;
          if (WEAPONS[i].ammoMax !== Infinity) st.ammo = WEAPONS[i].ammoMax;
          banner('WEAPON UPGRADE', `${WEAPONS[i].name} LV ${st.lvl + 1}`, '#5ad1ff', 2, '+25% DAMAGE', true);
        } else {
          score += 2000;
          floatText(p.x, p.y - 24, '+2000', '#5ad1ff', 12);
        }
        A.sfx('upgrade');
        break;
      }
    }
  }

  // ======================================================================= waves
  // acid globs fall from the ceiling around (and ahead of) the soldier, leaving pools
  function acidRain() {
    acidT = rand(1.3, 2.1) * (wave > 14 ? 0.75 : 1);
    const p = player;
    for (let i = 0; i < 2; i++) {
      const tx = clamp(p.x + p.vx * 0.9 + rand(-170, 170), WALL + 40, AW - WALL - 40), ty = clamp(p.y + p.vy * 0.9 + rand(-170, 170), WALL + 40, AH - WALL - 40);
      const sx = tx + rand(-260, 260), sy = ty - 520, dur = rand(1.1, 1.4);
      eshots.push({ lob: 'gas', x: sx, y: sy, sx, sy, tx, ty, t: 0, dur, vx: 0, vy: 0, r: 9, dmg: 0, life: dur, color: '#9dff3a' });
    }
  }

  function startWave(n) {
    wave = n;
    waveActive = true;
    if (n > profile.bestWave) { profile.bestWave = n; checkUnlocks(); }
    placeBarrels(n > 10 ? 8 : 6);
    eventT = rand(14, 20);
    player.frenzy = 0;
    SC = waveScale(n);
    const boss = n % 5 === 0;
    const avail = INTRO_ORDER.filter(t => ET[t].first <= n);
    const newType = INTRO_ORDER.find(t => ET[t].first === n);
    // a twist roughly every other wave from 6 on, never twice in a row, never on boss waves
    waveMod = null;
    if (!boss && n >= 6 && !lastMod && (n === 7 || Math.random() < 0.55)) waveMod = choose(MOD_KEYS.filter(k => MODS[k].from <= n));
    if (forceMod) { waveMod = forceMod; forceMod = null; }
    lastMod = waveMod;
    acidT = 2.5;
    let count = Math.round(12 + n * 4 + n * n * 0.1);
    if (boss) count = Math.round(count * 0.55);
    if (waveMod === 'swarm') { count = Math.round(count * 1.8); SC = { ...SC, hp: SC.hp * 0.55 }; }
    const swarmW = t => (waveMod !== 'swarm' ? 1 : t === 'crawler' ? 3 : t === 'leaper' ? 2 : 0.5);
    const weights = avail.map(t => (t === newType ? WEIGHT[t] * 2 + 2 : WEIGHT[t]) * swarmW(t));
    const total = weights.reduce((a, b) => a + b, 0);
    spawnQueue = [];
    for (let i = 0; i < count; i++) {
      let r = Math.random() * total, k = 0;
      while (r > weights[k] && k < weights.length - 1) { r -= weights[k]; k++; }
      spawnQueue.push({ type: avail[k], elite: false });
    }
    if (boss) {
      const q = 1 + Math.floor((n - 5) / 10);
      const bt = ARENA_BOSS[Math.max(0, ARENAS.indexOf(arena))];
      for (let i = 0; i < q; i++) spawnQueue.splice(Math.min(spawnQueue.length, 4 + i * 12), 0, { type: bt, elite: i === 0 });
    } else if (n >= 2) {
      const it = spawnQueue[Math.floor(count * rand(0.3, 0.6))];
      it.elite = true;
      if (n >= 4) it.affix = rollAffixes(it.type, n >= 14 ? 2 : 1);
    }
    if (!boss && n >= 6) {
      // champions: affixed, tougher, no weapon - they drop a power-up
      const champs = Math.min(3, 1 + Math.floor((n - 6) / 6));
      const big = avail.filter(t => t !== 'crawler');
      for (let i = 0; i < champs; i++) {
        const type = choose(big.length ? big : avail);
        spawnQueue.splice(Math.floor(spawnQueue.length * rand(0.2, 0.85)), 0, { type, elite: false, champ: true, affix: rollAffixes(type, n >= 16 ? 2 : 1) });
      }
    }
    if (waveMod === 'bounty') {
      const type = choose(avail.filter(t => t !== 'crawler'));
      spawnQueue.splice(Math.floor(spawnQueue.length * 0.25), 0, { type, elite: false, champ: true, bounty: true, affix: rollAffixes(type, 2) });
    }
    punchZoom(boss ? 0.09 : 0.05); A.duck(0.3, 0.35, 0.7);
    const M = waveMod && MODS[waveMod];
    if (boss) { const bt = ET[ARENA_BOSS[Math.max(0, ARENAS.indexOf(arena))]]; banner(`WAVE ${n}`, bt.intro, bt.color, 2.8); }
    else if (newType) banner(`WAVE ${n}`, `NEW THREAT: ${ET[newType].name}`, '#ff4f6d', 2.8, M ? `${M.name}: ${M.desc}` : ET[newType].desc);
    else if (M) banner(`WAVE ${n}`, M.name, M.color, 2.8, M.desc);
    else banner(`WAVE ${n}`, choose(TAUNTS), '#ff4f6d', 2.4);
    if (waveMod === 'ambush') for (let i = Math.min(spawnQueue.length, 4 + Math.floor(n / 3)); i > 0; i--) spawnFromQueue(spawnQueue.shift());
    if (carrierWeapon(n) !== undefined && !boss) floatText(player.x, player.y - 40, 'A GOLDEN CARRIER HAS A WEAPON', '#ffd23a', 9);
    A.sfx('alarm');
    music(boss ? 'boss' : 'wave', intensityFor(n), boss ? 168 : bpmFor(n));
  }

  function waveCleared() {
    waveActive = false;
    interTimer = 4.5;
    const modded = waveMod;
    waveMod = null;
    const bonus = Math.round(wave * 150 * (modded ? 1.5 : 1));
    if (modded) { run.mods++; profile.mods++; checkUnlocks(); }
    saveProfile();
    score += bonus;
    banner(`WAVE ${wave} CLEARED`, `+${bonus} BONUS`, '#7cff9a', 2.6, modded ? `${MODS[modded].name} SURVIVED - POWER-UP DROPPED` : '');
    if (modded && player) spawnPickup('power', player.x + rand(-120, 120), player.y + rand(-120, 120), choose(['overdrive', 'aegis', 'chrono', 'nova']));
    punchZoom(0.035);
    if (player) ripple(player.x, player.y, 700, 0.02, 0.8);
    music('break', 1, 140);
    A.sfx('clear');
    const p = player;
    spawnPickup('ammo', p.x + rand(-160, 160), p.y + rand(-160, 160));
    if (p.hp < 70) spawnPickup('med', p.x + rand(-160, 160), p.y + rand(-160, 160));
    if (wave % 5 === 0) {
      // after every boss the squad relocates to the next arena
      relo = { t: 0, done: false, next: ARENAS[Math.floor(wave / 5) % ARENAS.length] };
      interTimer = 8;
    } else if (wave % 2 === 1) {
      supplyDrop();
      interTimer = 6.5;
    }
  }

  let relo = null; // arena transition
  function updateRelocation(rdt) {
    if (!relo) return;
    relo.t += rdt;
    if (!relo.done && relo.t >= 0.8) {
      relo.done = true;
      const keep = player;
      buildArena(relo.next);
      keep.x = arena.start[0] * AW; keep.y = arena.start[1] * AH;
      for (const d of keep.drones) { d.x = keep.x; d.y = keep.y; }
      pickups = []; bullets = []; eshots = []; particles = []; beams = []; shocks = []; fires = []; booms = [];
      cam.x = keep.x; cam.y = keep.y;
      banner(arena.name, arena.sub, arena.accent, 2.6, '', true);
      supplyDrop();
    }
    if (relo.t >= 1.8) relo = null;
  }

  // ======================================================================= game flow
  function checkUnlocks() {
    for (const k of KITS) {
      if (kitOpen(k) || !k.goal) continue;
      const [have, need] = k.goal(profile);
      if (have < need) continue;
      profile.unlocked.push(k.id);
      if (state === 'play') {
        run.unlocks.push(k.name);
        banner('KIT UNLOCKED', k.name, k.color, 2.6, `${k.desc} - PICK IT ON THE MENU`, true);
        A.sfx('weapon');
      }
      saveProfile();
    }
  }

  function applyKit(kit) {
    const p = player;
    for (const id of kit.weapons || []) {
      const i = WEAPONS.findIndex(w => w.id === id), st = p.ws[i];
      st.owned = true; st.ammo = WEAPONS[i].start;
    }
    if (kit.weapons) selectWeapon(WEAPONS.findIndex(w => w.id === kit.weapons[0]), true);
    for (const k of kit.gear || []) applyGear(k, true);
    for (const k of kit.perks || []) applyGear(k, true);
  }

  function startGame() {
    relo = null; entry = null; highlight = -1; optionsOpen = false;
    buildArena(ARENAS[0]);
    player = newPlayer();
    enemies = []; bullets = []; eshots = []; particles = []; pickups = []; beams = []; banners = []; shocks = []; fires = []; booms = [];
    wave = 0; waveActive = false; interTimer = 2.5; spawnQueue = []; SC = waveScale(1);
    waveMod = null; lastMod = null; modDark = 1; modRed = 0;
    score = 0; kills = 0; combo = 0; comboTimer = 0; mult = 1; run = newRun();
    hud = newHud();
    const kit = NO_SAVE ? KITS[0] : KITS[profile.kit] && kitOpen(KITS[profile.kit]) ? KITS[profile.kit] : KITS[0];
    applyKit(kit);
    shake = 0; timeScale = 1; slowT = 0; hurtFlash = 0; aberr = 0; gameTime = 0;
    zoomPunch = 0; zoomCur = 0; ripples = [];
    cam.x = player.x; cam.y = player.y;
    mouse.down = false;
    state = 'play';
    banner('GET READY', 'SURVIVE AS LONG AS YOU CAN', '#5ad1ff', 2.6, kit.id === 'standard' ? '' : `${kit.name} KIT - ${kit.desc}`);
    music('break', 1, 140);
  }

  function deploy() {
    if (state === 'menu') {
      if (dive) return;
      if (!kitOpen(KITS[profile.kit] || KITS[0])) { A.sfx('empty'); return; }
      dive = { t: 0 };
      A.sfx('dash'); A.duck(0.5, 0.5, 0.8);
      return;
    }
    if (!kitOpen(KITS[profile.kit] || KITS[0])) { A.sfx('empty'); return; }
    startGame(); fadeIn = 0.7;
  }

  function setPaused(on) {
    if (on && state === 'play') { state = 'paused'; A.suspend(); mouse.down = false; touchReset(); }
    else if (!on && state === 'paused') { state = 'play'; A.resume(); lastFrame = performance.now(); }
  }

  // the boot console's answer powers the game on; keyboard, gamepad and clicks route through it
  function powerOn() {
    if (powered) return;
    if (boot.active && !boot.accepted) { bootAccept(); return; }
    powerUp();
  }
  function powerUp() {
    if (powered) return;
    powered = true;
    if (A.init()) music('menu', 1, 138);
  }

  // ======================================================================= settings
  const settings = { music: 7, sfx: 8, ost: 1, shake: 2, bright: 1, fx: 2, crt: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem('p88-settings'));
    if (saved) Object.assign(settings, saved);
    else if (TOUCH) settings.fx = 1; // phones start on LOW post FX; they can raise it in options
  } catch (e) { /* defaults */ }
  const OPTS = [
    { key: 'music', label: 'MUSIC VOLUME', max: 10 },
    { key: 'sfx', label: 'SFX VOLUME', max: 10 },
    { key: 'ost', label: 'SOUNDTRACK', max: 1, names: ['SYNTH', 'STUDIO'] },
    { key: 'shake', label: 'SCREEN SHAKE', max: 2, names: ['OFF', 'LOW', 'FULL'] },
    { key: 'bright', label: 'BRIGHTNESS', max: 2, names: ['DARK', 'NORMAL', 'BRIGHT'] },
    { key: 'fx', label: 'POST FX', max: 2, names: ['OFF', 'LOW', 'HIGH'] },
    { key: 'crt', label: 'SCANLINES', max: 1, names: ['OFF', 'ON'] },
  ];
  let optSel = 0, optionsOpen = false, optRects = [];
  function applySettings(save = true) {
    if (A.setVolumes) A.setVolumes(settings.music / 7, settings.sfx / 8);
    if (A.setSoundtrack) A.setSoundtrack(settings.ost ? 'studio' : 'synth');
    if (save) try { localStorage.setItem('p88-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  applySettings(false);
  function changeOpt(i, d) {
    const o = OPTS[i];
    settings[o.key] = clamp(settings[o.key] + d, 0, o.max);
    applySettings();
    A.sfx('switch');
  }
  const shakeMul = () => [0, 0.4, 1][settings.shake];

  // ======================================================================= high scores (arcade style)
  const DEFAULT_SCORES = [['RAD', 60000, 12], ['ZAP', 45000, 10], ['MAX', 35000, 9], ['NEO', 26000, 8], ['KAT', 19000, 7],
    ['JET', 13000, 6], ['VOX', 9000, 5], ['BIT', 6000, 4], ['REX', 3500, 3], ['ACE', 1500, 2]].map(([name, score, wave]) => ({ name, score, wave }));
  let scores = DEFAULT_SCORES;
  try { const sv = JSON.parse(localStorage.getItem('p88-scores')); if (Array.isArray(sv) && sv.length) scores = sv; } catch (e) { /* defaults */ }
  let entry = null;      // initials entry state after a qualifying run
  let highlight = -1;    // rank of the score just entered
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const qualifies = sc => sc > 0 && (scores.length < 10 || sc > scores[scores.length - 1].score);
  function beginEntry() {
    highlight = -1;
    if (!qualifies(score)) { entry = null; return; }
    let last = 'AAA';
    try { last = localStorage.getItem('p88-initials') || 'AAA'; } catch (e) { /* ignore */ }
    entry = { letters: last.split('').map(c => Math.max(0, LETTERS.indexOf(c))), pos: 0, done: false };
  }
  function confirmEntry() {
    const name = entry.letters.map(i => LETTERS[i]).join('');
    const rec = { name, score, wave };
    scores.push(rec);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 10);
    highlight = scores.indexOf(rec);
    entry.done = true;
    overT = 0.6;
    try { localStorage.setItem('p88-scores', JSON.stringify(scores)); localStorage.setItem('p88-initials', name); } catch (e) { /* ignore */ }
    A.sfx('gear');
  }
  function entryKey(code, ch) {
    const L = LETTERS.length;
    if (ch && /^[a-z0-9]$/i.test(ch)) { entry.letters[entry.pos] = LETTERS.indexOf(ch.toUpperCase()); entry.pos = Math.min(2, entry.pos + 1); A.sfx('switch'); return; }
    if (code === 'ArrowUp') entry.letters[entry.pos] = (entry.letters[entry.pos] + 1) % L;
    else if (code === 'ArrowDown') entry.letters[entry.pos] = (entry.letters[entry.pos] + L - 1) % L;
    else if (code === 'ArrowLeft' || code === 'Backspace') entry.pos = Math.max(0, entry.pos - 1);
    else if (code === 'ArrowRight') entry.pos = Math.min(2, entry.pos + 1);
    else if (code === 'Enter') { confirmEntry(); return; }
    else return;
    A.sfx('switch');
  }
  function entryTap(x, y) {
    const r = (entry.rects || []).find(q => x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h);
    if (!r) return false;
    if (r.kind === 'ok') { confirmEntry(); return true; }
    entry.pos = r.i;
    const L = LETTERS.length;
    if (r.kind === 'up') entry.letters[r.i] = (entry.letters[r.i] + 1) % L;
    if (r.kind === 'down') entry.letters[r.i] = (entry.letters[r.i] + L - 1) % L;
    A.sfx('switch');
    return true;
  }
  const canRestart = () => overT > 1 && (!entry || entry.done);

  // ======================================================================= input
  function earlyCall() {
    if (waveActive || wave <= 0 || interTimer <= 0.3 || relo) return;
    const bonus = Math.round(interTimer * 25 * wave);
    score += bonus;
    run.early++;
    floatText(player.x, player.y - 30, `EARLY CALL +${bonus}`, '#ffd23a', 10);
    // calling with real breathing room left pays a power-up
    if (interTimer >= 2.5) {
      // out of magnet range, so the player picks when to take it (power-ups still expire)
      const a = rand(0, TAU);
      spawnPickup('power', player.x + Math.cos(a) * 210, player.y + Math.sin(a) * 210, choose(['overdrive', 'overdrive', 'aegis', 'chrono', 'nova']));
      floatText(player.x, player.y - 46, 'POWER-UP DROPPED', '#ff7ad8', 9);
    }
    interTimer = 0;
  }
  function optionsKey(code) {
    if (code === 'ArrowUp' || code === 'KeyW') optSel = (optSel + OPTS.length - 1) % OPTS.length;
    else if (code === 'ArrowDown' || code === 'KeyS') optSel = (optSel + 1) % OPTS.length;
    else if (code === 'ArrowLeft' || code === 'KeyA') changeOpt(optSel, -1);
    else if (code === 'ArrowRight' || code === 'KeyD') changeOpt(optSel, 1);
  }

  addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
    if (boot.active) { if (!e.repeat) bootKey(e); return; }
    keys[e.code] = true;
    if (e.repeat) return;
    pad.using = false; touch.using = false;
    if (state === 'menu') {
      if (dive) return;
      if (!powered) { powerOn(); return; }
      if (optionsOpen) { if (e.code === 'Escape' || e.code === 'KeyO' || e.code === 'Enter') optionsOpen = false; else optionsKey(e.code); return; }
      if (e.code === 'Enter' || e.code === 'Space') deploy();
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleKit(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleKit(1);
      if (e.code === 'KeyO') optionsOpen = true;
      if (e.code === 'KeyM') A.toggleMusic();
      if (e.code === 'KeyN') A.nextTrack();
      return;
    }
    if (state === 'over') {
      if (entry && !entry.done) { if (overT > 0.6) entryKey(e.code, e.key); return; }
      if (canRestart() && (e.code === 'Enter' || e.code === 'Space')) deploy();
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleKit(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleKit(1);
      return;
    }
    if (e.code === 'KeyM') A.toggleMusic();
    if (e.code === 'KeyN' && state === 'play') A.nextTrack();
    if (state === 'play') {
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); selectWeapon(n === 0 ? 9 : n - 1); }
      if (e.code === 'KeyQ') selectWeapon(player.prev);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashQueued = true;
      if (e.code === 'Escape' || e.code === 'KeyP') setPaused(true);
      if (e.code === 'KeyF' || e.code === 'Enter') earlyCall();
    } else if (state === 'paused') {
      if (e.code === 'Escape' || e.code === 'KeyP') setPaused(false);
      else optionsKey(e.code);
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('mousemove', e => {
    if (performance.now() - touch.last < 800) return; // browsers fire a fake mousemove after a tap
    mouse.x = e.clientX; mouse.y = e.clientY; pad.using = false; touch.using = false;
  });

  function clickOptions(x, y) {
    for (const r of optRects) {
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      optSel = r.i;
      changeOpt(r.i, x < r.x + r.w / 2 ? -1 : 1);
      return true;
    }
    return false;
  }
  // menus, pause and game over share one tap/click path; x, y are CSS px
  const inRect = (r, x, y) => r && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  function pointerDown(cx, cy, isTouch) {
    // UI rects live in the scaled UI space
    const x = cx / UIS, y = cy / UIS;
    if (state === 'menu') {
      if (!powered) { if (!isTouch) powerOn(); return; }
      if (dive) return;
      if (optionsOpen) { if (!clickOptions(x, y)) optionsOpen = false; return; }
      if (inRect(menuOptRect, x, y)) { optionsOpen = true; return; }
      if (kitRects && inRect(kitRects.l, x, y)) { cycleKit(-1); return; }
      if (kitRects && inRect(kitRects.r, x, y)) { cycleKit(1); return; }
      if (kitRects && inRect(kitRects.box, x, y)) return;
      deploy();
      return;
    }
    if (state === 'over') {
      if (entry && !entry.done) {
        if (overT <= 0.6) return;
        if (entryTap(x, y)) return;
        if (!isTouch) confirmEntry(); // mouse: click anywhere confirms, as before
        return;
      }
      if (kitRects && inRect(kitRects.l, x, y)) { cycleKit(-1); return; }
      if (kitRects && inRect(kitRects.r, x, y)) { cycleKit(1); return; }
      if (canRestart()) deploy();
      return;
    }
    if (state === 'paused') { if (!clickOptions(x, y)) setPaused(false); return; }
  }
  cvs.addEventListener('mousedown', e => {
    if (performance.now() - touch.last < 800) return; // compatibility mouse event after a tap
    mouse.x = e.clientX; mouse.y = e.clientY;
    pad.using = false; touch.using = false;
    if (state !== 'play') { pointerDown(e.clientX, e.clientY, false); return; }
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) dashQueued = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  cvs.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => { if (state === 'play' && Math.abs(e.deltaY) > 2) cycleWeapon(Math.sign(e.deltaY)); }, { passive: true });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    setPaused(true);
  });

  // ---------------------------------------------------------------- gamepad (twin-stick)
  // left stick move, right stick aim + fire, RT/RB fire, LT/A dash, LB/B previous weapon,
  // Y / d-pad left-right cycle weapons, X early call, Start pause, Back next track
  const pad = { connected: false, using: false, move: [0, 0], aim: null, aimActive: false, fire: false, prev: [] };
  function pollPad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of list) if (g && g.connected) { gp = g; break; }
    if (!gp) { pad.connected = false; pad.fire = false; pad.move = [0, 0]; pad.aimActive = false; return; }
    pad.connected = true;
    const dz = v => (Math.abs(v) < 0.2 ? 0 : v);
    const ax = gp.axes;
    pad.move = [dz(ax[0] || 0), dz(ax[1] || 0)];
    const rx = ax[2] || 0, ry = ax[3] || 0, rm = Math.hypot(rx, ry);
    pad.aimActive = rm > 0.35;
    if (pad.aimActive) pad.aim = Math.atan2(ry, rx);
    const btn = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const hit = i => btn(i) && !pad.prev[i];
    pad.fire = btn(7) || btn(5) || rm > 0.6;
    if (pad.move[0] || pad.move[1] || pad.aimActive || gp.buttons.some(b => b.pressed)) pad.using = true;

    const dU = hit(12), dD = hit(13), dL = hit(14), dR = hit(15), a = hit(0), b = hit(1), start = hit(9);
    if (state === 'menu') {
      if (optionsOpen) {
        if (dU) optionsKey('ArrowUp'); if (dD) optionsKey('ArrowDown'); if (dL) optionsKey('ArrowLeft'); if (dR) optionsKey('ArrowRight');
        if (b || start || a) optionsOpen = false;
      } else if (a || start) { if (!powered) powerOn(); else deploy(); }
      else if (hit(3)) optionsOpen = true;
      else if (powered && (dL || hit(4))) cycleKit(-1);
      else if (powered && (dR || hit(5))) cycleKit(1);
    } else if (state === 'over') {
      if (entry && !entry.done) {
        if (overT > 0.6) { if (dU) entryKey('ArrowUp'); if (dD) entryKey('ArrowDown'); if (dL) entryKey('ArrowLeft'); if (dR) entryKey('ArrowRight'); if (a || start) confirmEntry(); }
      } else if ((a || start) && canRestart()) deploy();
      else if (dL || hit(4)) cycleKit(-1);
      else if (dR || hit(5)) cycleKit(1);
    } else if (state === 'paused') {
      if (dU) optionsKey('ArrowUp'); if (dD) optionsKey('ArrowDown'); if (dL) optionsKey('ArrowLeft'); if (dR) optionsKey('ArrowRight');
      if (start || b) setPaused(false);
    } else if (state === 'play') {
      if (hit(6) || a) dashQueued = true;
      if (hit(4) || b) selectWeapon(player.prev);
      if (hit(3) || dR) cycleWeapon(1);
      if (dL) cycleWeapon(-1);
      if (hit(2)) earlyCall();
      if (hit(8)) A.nextTrack();
      if (start) setPaused(true);
    }
    pad.prev = gp.buttons.map((_, i) => btn(i));
  }
  addEventListener('gamepadconnected', () => { pad.using = true; floatText(player ? player.x : 0, player ? player.y - 40 : 0, 'GAMEPAD CONNECTED', '#5affc8', 9); });

  // ---------------------------------------------------------------- touch (on-screen twin-stick)
  // left half: floating move stick (double-tap it to dash); right half: floating aim stick that
  // fires once pushed past its dead zone. Buttons: dash, swap, pause; the weapon bar and the
  // "bring it on" line under the wave timer are tappable too. Positions are CSS px.
  const touch = {
    using: TOUCH, last: -1e9,
    move: [0, 0], aim: 0, aimActive: false, fire: false,
    ids: new Map(), // touch identifier -> { role, bx, by, x, y }
    lastMoveEnd: -1e9, lastMoveX: 0, lastMoveY: 0, flash: {},
  };
  const STICK_R = 58;
  function touchLayout() {
    const r = W - safe.r - 16, b = H - safe.b - 12, l = safe.l + 16;
    const top = (hud && hud.rightBottom ? hud.rightBottom * UIS : 80) + 8;
    return {
      dash: { x: r - 42, y: b - 150, r: 38 },
      swap: { x: r - 128, y: b - 200, r: 27 },
      pause: { x: r - 22, y: top + 22, r: 22 },
      moveHome: { x: l + 96, y: b - 92 },
      aimHome: { x: r - 120, y: b - 88 },
    };
  }
  const inCirc = (c, x, y, pad0 = 10) => (x - c.x) ** 2 + (y - c.y) ** 2 < (c.r + pad0) ** 2;
  function stickVec(t) {
    let dx = t.x - t.bx, dy = t.y - t.by;
    const d = Math.hypot(dx, dy);
    // dragging past the rim pulls the base along, so the thumb never loses the stick
    if (d > STICK_R) { const k = (d - STICK_R) / d; t.bx += dx * k; t.by += dy * k; dx = t.x - t.bx; dy = t.y - t.by; }
    return [dx / STICK_R, dy / STICK_R];
  }
  function touchStick(t) {
    const [vx, vy] = stickVec(t), m = Math.hypot(vx, vy);
    if (t.role === 'move') {
      if (m < 0.12) touch.move = [0, 0];
      else { const k = Math.min(1, (m - 0.12) / 0.75) / m; touch.move = [vx * k, vy * k]; }
    } else if (t.role === 'aim') {
      touch.aimActive = m > 0.22;
      touch.fire = touch.aimActive;
      if (touch.aimActive) touch.aim = Math.atan2(vy, vx);
    }
  }
  // a gentle pull toward the alien nearest the aim line: thumbs are much less precise than a mouse
  function assistAim(p, a) {
    let best = null, bd = 0.2;
    for (const e of enemies) {
      if (e.dead || e.under || (e.type === 'phantom' && e.cloaked)) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy > 720 * 720) continue;
      const ea = Math.atan2(dy, dx), da = Math.abs(angDiff(a, ea));
      if (da < bd) { bd = da; best = ea; }
    }
    return best === null ? a : a + angDiff(a, best) * 0.6;
  }
  function touchStart(e) {
    e.preventDefault();
    touch.last = performance.now();
    if (!touch.using) { touch.using = true; pad.using = false; }
    if (state !== 'play' && wantFS && !isFS()) goFullscreen().then(ok => { if (ok) lockLandscape(); });
    for (const ct of e.changedTouches) {
      const x = ct.clientX, y = ct.clientY;
      if (state !== 'play') {
        if (touch.ids.size === 0) pointerDown(x, y, true);
        touch.ids.set(ct.identifier, { role: 'ui', bx: x, by: y, x, y });
        continue;
      }
      const L = touchLayout(), ux = x / UIS, uy = y / UIS;
      const take = role => touch.ids.set(ct.identifier, { role, bx: x, by: y, x, y });
      if (inCirc(L.pause, x, y)) { take('btn'); setPaused(true); continue; }
      if (inCirc(L.dash, x, y, 14)) { take('btn'); dashQueued = true; touch.flash.dash = 0.15; continue; }
      if (inCirc(L.swap, x, y)) { take('btn'); cycleWeapon(1); touch.flash.swap = 0.15; continue; }
      if (hud && inRect(hud.callRect, ux, uy)) { take('btn'); earlyCall(); continue; }
      const slot = hud && hud.slotRects && hud.slotRects.find(r => inRect(r, ux, uy));
      if (slot) { take('btn'); selectWeapon(slot.i); continue; }
      const roles = [...touch.ids.values()].map(t => t.role);
      if (x < W / 2 && !roles.includes('move')) {
        const now = performance.now();
        if (now - touch.lastMoveEnd < 280 && Math.hypot(x - touch.lastMoveX, y - touch.lastMoveY) < 70) dashQueued = true;
        // keep the base far enough from the edges that the whole stick fits
        take('move');
        const t = touch.ids.get(ct.identifier);
        t.bx = clamp(x, safe.l + STICK_R + 6, W / 2 - STICK_R); t.by = clamp(y, STICK_R + 6, H - safe.b - STICK_R - 6);
        touchStick(t);
      } else if (x >= W / 2 && !roles.includes('aim')) {
        take('aim');
        const t = touch.ids.get(ct.identifier);
        t.bx = clamp(x, W / 2 + STICK_R, W - safe.r - STICK_R - 6); t.by = clamp(y, STICK_R + 6, H - safe.b - STICK_R - 6);
        touchStick(t);
      } else take('btn');
    }
  }
  function touchMove(e) {
    e.preventDefault();
    touch.last = performance.now();
    for (const ct of e.changedTouches) {
      const t = touch.ids.get(ct.identifier);
      if (!t) continue;
      t.x = ct.clientX; t.y = ct.clientY;
      if (t.role === 'move' || t.role === 'aim') touchStick(t);
    }
  }
  function touchEnd(e) {
    e.preventDefault();
    touch.last = performance.now();
    for (const ct of e.changedTouches) {
      const t = touch.ids.get(ct.identifier);
      if (!t) continue;
      touch.ids.delete(ct.identifier);
      if (t.role === 'move') { touch.move = [0, 0]; touch.lastMoveEnd = performance.now(); touch.lastMoveX = t.x; touch.lastMoveY = t.y; }
      if (t.role === 'aim') { touch.aimActive = false; touch.fire = false; }
    }
  }
  function touchReset() { touch.ids.clear(); touch.move = [0, 0]; touch.aimActive = false; touch.fire = false; }
  cvs.addEventListener('touchstart', touchStart, { passive: false });
  cvs.addEventListener('touchmove', touchMove, { passive: false });
  cvs.addEventListener('touchend', touchEnd, { passive: false });
  cvs.addEventListener('touchcancel', touchEnd, { passive: false });

  function drawTouch(rdt) {
    if (!touch.using || state !== 'play' || !player) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const L = touchLayout();
    for (const k in touch.flash) touch.flash[k] = Math.max(0, touch.flash[k] - rdt);
    const active = role => [...touch.ids.values()].find(t => t.role === role);
    const stick = (role, home, color, label) => {
      const t = active(role);
      const bx = t ? t.bx : home.x, by = t ? t.by : home.y;
      ctx.globalAlpha = t ? 0.9 : 0.32;
      ctx.fillStyle = 'rgba(8,4,22,0.35)'; ctx.beginPath(); ctx.arc(bx, by, STICK_R, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, STICK_R, 0, TAU); ctx.stroke();
      let kx = bx, ky = by;
      if (t) { const d = Math.hypot(t.x - bx, t.y - by), k = d > STICK_R ? STICK_R / d : 1; kx = bx + (t.x - bx) * k; ky = by + (t.y - by) * k; }
      ctx.fillStyle = hexA(color, t ? 0.45 : 0.25); ctx.beginPath(); ctx.arc(kx, ky, 25, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(kx, ky, 25, 0, TAU); ctx.stroke();
      if (!t) utext(label, bx, by + STICK_R + 8, 10, color, 'center', 'top', 700, 2);
      ctx.globalAlpha = 1;
    };
    stick('move', L.moveHome, '#5affc8', 'MOVE');
    stick('aim', L.aimHome, '#ff7ad8', 'AIM + FIRE');
    const p = player;
    const btn = (c, color, label, alpha, fill = 1) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(8,4,22,0.5)'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();
      if (fill < 1) { ctx.fillStyle = hexA(color, 0.2); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, c.r, -Math.PI / 2, -Math.PI / 2 + TAU * fill); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, -Math.PI / 2, -Math.PI / 2 + TAU * fill); ctx.stroke();
      if (label) utext(label, c.x, c.y + 1, Math.round(c.r * 0.36), color, 'center', 'middle', 700, 1);
      ctx.globalAlpha = 1;
    };
    const dashMax = 1.0 - 0.15 * p.gear.boots, dr = clamp(1 - p.dashCd / dashMax, 0, 1);
    btn(L.dash, dr >= 1 ? '#5ad1ff' : '#3a7a9a', 'DASH', touch.flash.dash > 0 ? 1 : dr >= 1 ? 0.85 : 0.55, dr);
    const owned = p.ws.filter(st => st.owned && st.ammo > 0).length;
    btn(L.swap, '#ffd23a', 'SWAP', owned > 1 ? (touch.flash.swap > 0 ? 1 : 0.7) : 0.25);
    btn(L.pause, '#ff7ad8', '', 0.7);
    ctx.fillStyle = '#ff7ad8'; ctx.globalAlpha = 0.85;
    ctx.fillRect(L.pause.x - 6, L.pause.y - 7, 4, 14); ctx.fillRect(L.pause.x + 2, L.pause.y - 7, 4, 14);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- fullscreen + landscape
  const docEl = document.documentElement;
  const canFS = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
  const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  let wantFS = false;
  function goFullscreen() {
    if (!canFS) return Promise.resolve(false);
    if (isFS()) return Promise.resolve(true);
    try {
      const r = docEl.requestFullscreen ? docEl.requestFullscreen({ navigationUI: 'hide' }) : docEl.webkitRequestFullscreen();
      return Promise.resolve(r).then(() => true, () => false);
    } catch (e) { return Promise.resolve(false); }
  }
  // only works in fullscreen, and not at all on iPhone: then we ask the player to turn the device
  function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape').then(() => true, () => false);
    } catch (e) { /* unsupported */ }
    return Promise.resolve(false);
  }
  const rotateEl = document.getElementById('rotate');
  let booted = false;
  function checkOrientation() {
    const need = TOUCH && booted && innerHeight > innerWidth;
    if (rotateEl) rotateEl.classList.toggle('on', need);
    if (need) { if (state === 'play') setPaused(true); touchReset(); }
  }

  // ======================================================================= boot console
  // "PROTOCOL NUMBER:" with a single answer, 88. The tap that answers it is the user gesture
  // the browser needs for audio, fullscreen and the landscape lock; on a phone held upright the
  // console then turns a quarter and the device follows it into landscape.
  const bootEl = document.getElementById('boot');
  const bootScr = document.getElementById('bootScreen');
  const bootLog = document.getElementById('bootLog');
  const boot = { active: !!bootEl, ready: false, accepted: false, digits: 0, waitLand: false, timers: [], skip: null };
  const BOOT_LINES = [
    ['P88 TACTICAL OS  v8.8', 'hot'],
    ['(C) 2088 ORBITAL DEFENSE CMD', 'dim'],
    ['', ''],
    ['MEMORY CHECK ........ OK', ''],
    ['WEAPON UPLINK ....... OK', ''],
    ['HOSTILE SIGNATURES .. 4812', 'warn'],
    ['', ''],
    ['> AUTHORIZATION REQUIRED', ''],
  ];
  const bootLater = (fn, ms) => boot.timers.push(setTimeout(fn, ms));
  function bootLine(str, cls) {
    const el = document.createElement('div');
    if (cls) el.className = cls;
    el.textContent = str || ' ';
    bootLog.appendChild(el);
    return el;
  }
  function bootPromptOn() {
    if (boot.ready) return;
    boot.ready = true;
    for (const t of boot.timers) clearTimeout(t);
    boot.timers = [];
    bootLog.textContent = '';
    for (const [str, cls] of BOOT_LINES) bootLine(str, cls);
    document.getElementById('bootPrompt').classList.add('on');
    document.getElementById('bootHint').textContent = TOUCH ? 'TAP TO ANSWER' : 'TYPE 88 OR CLICK';
    bootLater(() => { document.getElementById('bootAnswer').classList.add('on'); if (!TOUCH) document.getElementById('boot88').focus({ preventScroll: true }); }, 220);
  }
  function bootType() {
    // types the log a character at a time; any tap or key skips straight to the prompt
    let li = 0, ci = 0, el = null;
    const step = () => {
      if (boot.ready) return;
      if (li >= BOOT_LINES.length) { bootPromptOn(); return; }
      const [str, cls] = BOOT_LINES[li];
      if (!el) el = bootLine('', cls);
      if (ci < str.length) { ci = Math.min(str.length, ci + 2); el.textContent = str.slice(0, ci); bootLater(step, 16); }
      else { li++; ci = 0; el = null; bootLater(step, str ? 110 : 40); }
    };
    bootLater(step, 350);
  }
  function bootInput(str) { document.getElementById('bootInput').textContent = str; }
  function bootKey(e) {
    e.preventDefault();
    if (boot.accepted) return;
    if (!boot.ready) { bootPromptOn(); return; }
    if (e.key === '8') { boot.digits++; bootInput('88'.slice(0, boot.digits)); if (boot.digits >= 2) bootAccept(); }
    else if (e.code === 'Enter' || e.code === 'Space') bootAccept();
    else if (e.code === 'Backspace') { boot.digits = 0; bootInput(''); }
  }
  function bootAccept() {
    if (!boot.active || boot.accepted) return;
    boot.accepted = true;
    // still inside the tap / key handler: fullscreen has to be asked for right now
    const fsP = TOUCH ? (wantFS = canFS, goFullscreen()) : Promise.resolve(false);
    bootPromptOn();
    document.getElementById('boot88').classList.add('hit');
    document.getElementById('bootAnswer').classList.remove('on');
    // the answered prompt becomes a log line, so the replies print under it
    document.getElementById('bootPrompt').style.display = 'none';
    bootLine('> PROTOCOL NUMBER: 88', 'hot');
    powerUp();
    A.sfx('switch');
    const turn = TOUCH && innerHeight > innerWidth;
    setTimeout(() => bootLine('> ACCESS GRANTED', 'hot'), 160);
    setTimeout(() => bootLine(turn ? '> SWITCHING TO COMBAT VIEW' : '> DEPLOYING PROTOCOL 88', ''), 420);
    if (!turn) {
      fsP.then(ok => { if (ok) lockLandscape(); });
      setTimeout(bootOff, 900);
      return;
    }
    setTimeout(() => {
      // the console's box takes landscape proportions and turns a quarter clockwise, which is
      // how landscape looks on a phone still held upright
      A.sfx('dash');
      bootScr.style.width = innerHeight + 'px'; bootScr.style.height = innerWidth + 'px';
      bootScr.classList.add('rot');
    }, 760);
    setTimeout(() => {
      boot.waitLand = true;
      if (innerWidth > innerHeight) { bootLanded(); return; }
      fsP.then(ok => (ok ? lockLandscape() : false)).then(locked => {
        // no lock (iPhone, or fullscreen refused): the player turns the phone themselves
        setTimeout(() => { if (boot.waitLand) bootLine(locked ? '> ROTATING...' : '> ROTATE DEVICE  >>', 'warn'); }, locked ? 600 : 0);
      });
    }, 1700);
  }
  // the screen is landscape now: drop the CSS turn in the same frame, so the console stays put
  function bootLanded() {
    if (!boot.waitLand) return;
    boot.waitLand = false;
    bootScr.classList.add('snap');
    bootScr.classList.remove('rot');
    bootScr.style.width = bootScr.style.height = '';
    void bootScr.offsetWidth;
    bootScr.classList.remove('snap');
    setTimeout(bootOff, 450);
  }
  function bootOff() {
    A.sfx('thud');
    bootScr.classList.add('off');
    bootEl.classList.add('gone');
    setTimeout(() => {
      bootEl.classList.add('hidden');
      boot.active = false; booted = true;
      checkOrientation();
    }, 800);
  }
  function bootSkip() {
    if (!bootEl) return;
    for (const t of boot.timers) clearTimeout(t);
    bootEl.classList.add('hidden');
    boot.active = false; boot.accepted = true; booted = true;
  }
  onResizeHook = () => {
    if (boot.waitLand && innerWidth > innerHeight) bootLanded();
    else if (bootScr && bootScr.classList.contains('rot')) { bootScr.style.width = innerHeight + 'px'; bootScr.style.height = innerWidth + 'px'; }
    checkOrientation();
  };
  if (bootEl) {
    if (NO_SAVE) bootSkip(); // ?bot runs straight into the game
    else {
      document.getElementById('boot88').addEventListener('click', e => { e.preventDefault(); if (boot.ready) bootAccept(); else bootPromptOn(); });
      bootEl.addEventListener('pointerdown', e => {
        if (e.pointerType === 'touch') { touch.last = performance.now(); touch.using = true; }
        if (!boot.ready) bootPromptOn();
      });
      bootEl.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
      bootType();
    }
  } else booted = true;

  // ======================================================================= update
  function update(dt, rdt) {
    beatPulse = Math.max(0, beatPulse - rdt * 4);
    snarePulse = Math.max(0, snarePulse - rdt * 5);
    hurtFlash = Math.max(0, hurtFlash - rdt * 2.2);
    aberr = Math.max(0, aberr - rdt * 2.6);
    for (const r of ripples) r.t += rdt;
    ripples = ripples.filter(r => r.t < r.dur);
    shake *= Math.exp(-rdt * 9);
    camKick.x *= Math.exp(-rdt * 14); camKick.y *= Math.exp(-rdt * 14);
    for (const v of vents) v.pulse = Math.max(0, v.pulse - rdt * 2.5);

    // keep the game alive even if Web Audio is unavailable or blocked
    if ((sim.fakeBeat || !A.running()) && (state === 'play' || state === 'menu')) {
      fbBeat += dt;
      if (fbBeat >= 60 / curBpm) { fbBeat -= 60 / curBpm; fbCount++; onBeat({ beat: fbCount % 4, kick: true, snare: fbCount % 2 === 1 }); }
    }

    if (state === 'menu') { const dk = dive ? dive.t / 0.62 : 0; menuT += rdt * (1 + dk * dk * 14); return; }
    if (state === 'over') { overT += rdt; }
    if (state !== 'play' && state !== 'dying' && state !== 'over') return;

    gameTime += dt;
    if (state === 'play') {
      updatePlayer(dt);
      comboTimer -= dt;
      if (comboTimer <= 0 && combo) {
        if (combo >= 18) floatText(player.x, player.y - 40, `COMBO ENDED - ${combo}`, '#8a8ab0', 9);
        combo = 0; mult = 1; player.streakLvl = 0;
      }
    } else if (state === 'dying') {
      dyingT -= rdt;
      if (dyingT <= 0) { state = 'over'; overT = 0; }
    }

    hunt = waveActive && !spawnQueue.length && enemies.length <= 4;
    const edt = player && player.chrono > 0 ? dt * 0.4 : dt;
    // commanders rally nearby aliens and the blood moon speeds everyone up: both just run their clock faster
    const cmds = enemies.filter(e => !e.dead && hasAff(e, 'commander'));
    const moon = waveMod === 'bloodmoon' && waveActive ? 1.2 : 1;
    for (const e of enemies) {
      if (e.dead) continue;
      e.rally = false;
      if (cmds.length && !isBoss(e)) for (const c of cmds) if (c !== e && (c.x - e.x) ** 2 + (c.y - e.y) ** 2 < 240 * 240) { e.rally = true; break; }
      if (e.frozeT > 0) e.frozeT -= dt;
      updateEnemy(e, edt * moon * (e.rally ? 1.3 : 1) * (e.frozeT > 0 ? 0.3 : 1));
    }
    if (state === 'play' && waveActive && waveMod === 'acid' && (acidT -= dt) <= 0) acidRain();
    modDark += ((waveMod === 'blackout' && waveActive ? 0.3 : 1) - modDark) * Math.min(1, rdt * 1.5);
    modRed += ((waveMod === 'bloodmoon' && waveActive ? 1 : 0) - modRed) * Math.min(1, rdt * 1.5);
    separate();
    updateBullets(dt);
    updateEShots(edt);
    updateShocks(edt);
    if (player) { updatePerks(dt); updateArena(dt); }
    updateRelocation(rdt);
    compact(enemies);

    for (const pk of pickups) {
      pk.t += dt; pk.life -= dt;
      if (pk.life <= 0) { pk.dead = true; continue; }
      if (pk.drop > 0) {
        pk.drop -= dt;
        if (pk.drop <= 0) {
          shake = Math.min(30, shake + 4); A.sfx('thud');
          for (let i = 0; i < 8; i++) { const a = rand(0, TAU); part({ kind: 'smoke', x: pk.x, y: pk.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.6, size: 12, drag: 3, color: '90,90,100' }); }
        }
        continue;
      }
      if (state !== 'play') continue;
      const dx = player.x - pk.x, dy = player.y - pk.y, d = Math.hypot(dx, dy) || 1;
      const mR = player.perk.scavenger ? 320 : 120;
      if (pk.kind !== 'gear' && d < mR) { const s = (1 - d / mR) * 600 + 80; pk.x += (dx / d) * s * dt; pk.y += (dy / d) * s * dt; }
      if (d < player.r + (pk.kind === 'gear' ? 24 : 18)) collect(pk);
    }
    compact(pickups);

    for (const q of particles) {
      q.life -= dt;
      if (q.life <= 0) {
        q.dead = true;
        if (q.kind === 'gib' && q.splat) splat(q.x, q.y, q.size * 1.3, q.splat, 3);
        if (q.kind === 'shell' && q.x > WALL && q.x < AW - WALL && q.y > WALL && q.y < AH - WALL) {
          const z = q.size || 1;
          fctx.save(); fctx.translate(q.x, q.y); fctx.rotate(q.rot);
          fctx.globalAlpha = 0.45; fctx.fillStyle = q.color; fctx.fillRect(-2.5 * z, -1 * z, 5 * z, 2 * z);
          fctx.restore();
        }
        continue;
      }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.drag) { const k = Math.exp(-q.drag * dt); q.vx *= k; q.vy *= k; }
      if (q.vr) q.rot += q.vr * dt;
    }
    compact(particles);
    for (const b of beams) { b.life -= dt; if (b.life <= 0) b.dead = true; }
    compact(beams);

    if (state === 'play') {
      if (!waveActive) {
        interTimer -= dt;
        if (interTimer <= 0) startWave(wave + 1);
      } else if (!spawnQueue.length && !enemies.length) {
        waveCleared();
      }
    }

    // camera
    if (player) {
      const mw = mouseWorld();
      const lx = clamp((mw.x - player.x) * 0.22, -180, 180), ly = clamp((mw.y - player.y) * 0.22, -140, 140);
      const k = 1 - Math.exp(-rdt * 9);
      cam.x = lerp(cam.x, player.x + (state === 'play' ? lx : 0), k);
      cam.y = lerp(cam.y, player.y + (state === 'play' ? ly : 0), k);
      const hw = W / 2 / VIEW, hh = H / 2 / VIEW;
      cam.x = AW + 120 > hw * 2 ? clamp(cam.x, hw - 60, AW - hw + 60) : AW / 2;
      cam.y = AH + 120 > hh * 2 ? clamp(cam.y, hh - 60, AH - hh + 60) : AH / 2;
    }
  }

  function impact(b) {
    if (b.kind === 'rocket') { explode(b.x, b.y, b.splash, b.dmg, 'player'); return; }
    if (b.kind === 'flame') return;
    sparks(b.x, b.y, b.color, 4, 220, Math.atan2(-b.vy, -b.vx), 0.9);
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      if (b.dead) continue;
      b.px = b.x; b.py = b.y;
      if (b.kind === 'flame') { const k = Math.exp(-dt * 2.6); b.vx *= k; b.vy *= k; b.r += dt * 46; }
      if (b.kind === 'rocket') {
        b.vx *= 1 + dt * 1.2; b.vy *= 1 + dt * 1.2;
        part({ kind: 'smoke', x: b.x, y: b.y, vx: rand(-20, 20), vy: rand(-20, 20), life: rand(0.4, 0.7), size: rand(6, 10), drag: 2, color: '90,90,90' });
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; if (b.kind === 'rocket') impact(b); continue; }
      if (b.kind === 'saw') {
        // ripper discs ricochet off walls and pillars
        b.rot += dt * 30;
        let bounced = false;
        if (b.x < WALL + b.r || b.x > AW - WALL - b.r) { b.vx = -b.vx; b.x = clamp(b.x, WALL + b.r, AW - WALL - b.r); bounced = true; }
        if (b.y < WALL + b.r || b.y > AH - WALL - b.r) { b.vy = -b.vy; b.y = clamp(b.y, WALL + b.r, AH - WALL - b.r); bounced = true; }
        for (const pl of pillars) {
          const dx = b.x - pl.x, dy = b.y - pl.y, dd = Math.hypot(dx, dy) || 1;
          if (dd < pl.r + b.r) {
            const nx = dx / dd, ny = dy / dd, dot = b.vx * nx + b.vy * ny;
            if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
            b.x = pl.x + nx * (pl.r + b.r); b.y = pl.y + ny * (pl.r + b.r);
            bounced = true;
          }
        }
        if (bounced) {
          sparks(b.x, b.y, b.color, 6, 260);
          A.sfx('ricochet');
          b.hits.clear();
          if (--b.bounces < 0) { b.dead = true; continue; }
        }
      } else {
        if (b.x < WALL || b.x > AW - WALL || b.y < WALL || b.y > AH - WALL) { b.dead = true; impact(b); continue; }
        let blocked = false;
        for (const pl of pillars) {
          if (segCircle(b.px, b.py, b.x, b.y, pl.x, pl.y, pl.r)) { blocked = true; break; }
        }
        if (blocked) { b.dead = true; impact(b); continue; }
      }
      let hitB = null;
      for (const br of barrels) if (!br.dead && br.drop <= 0 && segCircle(b.px, b.py, b.x, b.y, br.x, br.y, br.r + b.r)) { hitB = br; break; }
      if (hitB) {
        if (b.kind === 'rocket') { b.dead = true; explode(b.x, b.y, b.splash, b.dmg, 'player'); continue; }
        damageBarrel(hitB, b.dmg);
        if (b.kind !== 'flame' && b.kind !== 'saw') { b.dead = true; impact(b); continue; }
      }
      const reach = Math.abs(b.x - b.px) + Math.abs(b.y - b.py) + b.r;
      for (const e of enemies) {
        if (e.dead || e.under) continue;
        if (b.hits && b.hits.has(e)) continue;
        const rr = e.r + b.r;
        if (Math.abs(e.x - b.x) > rr + reach || Math.abs(e.y - b.y) > rr + reach) continue;
        if (!segCircle(b.px, b.py, b.x, b.y, e.x, e.y, rr)) continue;
        if (b.kind === 'rocket') { b.dead = true; explode(b.x, b.y, b.splash, b.dmg, 'player'); break; }
        // warden energy shield blocks bullets and discs from the front
        if (e.type === 'warden' && (b.kind === 'bullet' || b.kind === 'saw') && Math.abs(angDiff(e.angle, Math.atan2(-b.vy, -b.vx))) < 1.15) {
          e.shieldFlash = 0.15;
          sparks(b.x, b.y, '#7ad8ff', 4, 240, Math.atan2(-b.vy, -b.vx), 0.7);
          A.sfx('block');
          if (b.kind === 'saw') {
            const nx = Math.cos(e.angle), ny = Math.sin(e.angle), dot = b.vx * nx + b.vy * ny;
            if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
            b.hits.add(e);
            continue;
          }
          b.dead = true;
          break;
        }
        const sp = Math.hypot(b.vx, b.vy) || 1;
        damageEnemy(e, b.kind === 'flame' ? b.dmg * (0.5 + b.life / b.max) : b.dmg, b.vx / sp, b.vy / sp, b.knock, b.src);
        if (b.kind === 'flame') { e.burn = Math.max(e.burn, 1.6); e.burnSrc = 'flamer'; b.hits.add(e); continue; }
        perkHit(e, b.ign);
        if (b.kind === 'saw') { b.hits.add(e); continue; }
        part({ kind: 'flash', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.05, size: 10 + b.r * 2, color: '#ffffff', glow: true });
        if (b.pierce > 0) { b.pierce--; (b.hits || (b.hits = new Set())).add(e); }
        else if (b.rico > 0 && bounceBullet(b, e)) break;
        else { b.dead = true; break; }
      }
    }
    compact(bullets);
  }

  function updateEShots(dt) {
    for (const s of eshots) {
      if (s.dead) continue; // erased this frame (nova, kinetic dash)
      if (s.lob) {
        s.t += dt;
        const f = Math.min(1, s.t / s.dur);
        s.x = lerp(s.sx, s.tx, f); s.y = lerp(s.sy, s.ty, f);
        if (f >= 1) { s.dead = true; landLob(s); }
        continue;
      }
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      let hit = s.life <= 0 || s.x < WALL || s.x > AW - WALL || s.y < WALL || s.y > AH - WALL;
      if (!hit) for (const pl of pillars) if (Math.hypot(s.x - pl.x, s.y - pl.y) < pl.r + s.r) { hit = true; break; }
      if (!hit) for (const br of barrels) if (!br.dead && br.drop <= 0 && Math.hypot(s.x - br.x, s.y - br.y) < br.r + s.r) { damageBarrel(br, 12); hit = true; break; }
      if (!hit && state === 'play' && Math.hypot(s.x - player.x, s.y - player.y) < s.r + player.r) {
        hurtPlayer(s.dmg, s);
        hit = true;
      }
      if (hit) {
        s.dead = true;
        blood(s.x, s.y, s.color, 6, 140);
      } else if (Math.random() < 0.3) {
        part({ kind: 'dot', x: s.x, y: s.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.3, size: 2.5, color: s.color, drag: 2 });
      }
    }
    compact(eshots);
  }

  // ======================================================================= render: world
  let curlLegs = false;
  function legs(n, r, len, ph, col, lw, spreadX) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        const bx = lerp(spreadX, -spreadX, f), by = s * r * 0.3;
        let a1, a2, L1 = len * 0.55, L2 = len * 0.6;
        if (curlLegs) {
          const base = lerp(0.9, -0.2, f);
          a1 = s * (Math.PI / 2 - base); a2 = a1 + s * 2.2; L1 *= 0.65; L2 *= 0.55;
        } else {
          // alternating tripod gait: one tripod plants while the other swings forward, lifted
          const cyc = ph + ((i + (s > 0 ? 1 : 0)) % 2 ? Math.PI : 0);
          const lift = Math.max(0, Math.cos(cyc));
          const base = lerp(0.6, -0.6, f) + Math.sin(cyc) * 0.42;
          a1 = s * (Math.PI / 2 - base);
          a2 = s * (Math.PI / 2 - base * 1.7) - s * lift * 0.5;
          L2 *= 1 - lift * 0.25;
        }
        const kx = bx + Math.cos(a1) * L1, ky = by + Math.sin(a1) * L1;
        ctx.moveTo(bx, by); ctx.lineTo(kx, ky);
        ctx.lineTo(kx + Math.cos(a2) * L2, ky + Math.sin(a2) * L2);
      }
    }
    ctx.stroke();
  }
  // rotate a body section (abdomen, tail) around a joint
  function seg(jx, rot, fn) { ctx.save(); ctx.translate(jx, 0); ctx.rotate(rot); ctx.translate(-jx, 0); fn(); ctx.restore(); }
  const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  function mandibles(r, x0, open, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath();
    for (const sy of [-1, 1]) {
      ctx.moveTo(x0, sy * r * 0.2);
      ctx.quadraticCurveTo(x0 + r * 0.45, sy * r * (0.3 + open * 0.5), x0 + r * 0.38, sy * r * (0.02 + open * 0.45));
    }
    ctx.stroke();
  }

  function phantomAlpha(e) {
    if (!e.cloaked) return 0.9;
    if (!player || state !== 'play') return 0.12;
    const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy);
    if (d < 170) return 0.55;
    if (d < 700 && Math.abs(angDiff(player.angle, Math.atan2(dy, dx))) < 0.5) return 0.4;
    return 0.06;
  }

  function drawEnemy(e) {
    const T = ET[e.type];
    const r = e.r;
    const sc = e.spawnT > 0 ? Math.max(0.05, easeOutBack(1 - e.spawnT / 0.45)) : 1;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.under) {
      const sh = e.st === 'emerge' ? rand(-3, 3) : 0;
      const big = e.st === 'emerge' ? 1.3 : 1;
      ctx.fillStyle = '#2a1c0c'; ell(sh, 0, r * 1.3 * big, r * 1.0 * big);
      ctx.fillStyle = '#5a3e1e'; ell(sh - 2, -2, r * 1.05 * big, r * 0.78 * big);
      ctx.strokeStyle = '#1a1006'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(sh - r * 0.5, -r * 0.2); ctx.lineTo(sh, r * 0.1); ctx.lineTo(sh + r * 0.4, -r * 0.3);
      ctx.moveTo(sh, r * 0.1); ctx.lineTo(sh + r * 0.1, r * 0.5); ctx.stroke();
      ctx.restore();
      return;
    }
    const alt = e.fly && !e.corpse ? 1 + Math.sin(e.t * 5 + e.phase) * 0.3 : 0;
    if (!e.corpse && !noBlob) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (e.fly) ell(10 + alt * 6, 16 + alt * 8, r * 0.9 * sc * (1.1 - alt * 0.15), r * 0.6 * sc * (1.1 - alt * 0.15));
      else ell(4, 6, r * 1.15 * sc, r * 0.85 * sc);
    }
    const mv = e.corpse ? 0 : clamp(Math.hypot(e.vx, e.vy) / Math.max(40, e.speed), 0, 1.6);
    if (alt) ctx.translate(0, -alt * 4);
    ctx.rotate(e.angle + Math.sin(e.walk) * 0.07 * Math.min(1, mv));
    let sx = 1, sy = 1;
    if (!e.corpse) {
      if (e.st === 'lunge' || e.st === 'charge' || e.st === 'dive' || e.st === 'leap') { sx = 1.28; sy = 0.8; }            // stretch at speed
      else if (e.st === 'wind' || e.st === 'emerge' || e.st === 'barrage' || (e.type === 'boomer' && e.fuse > 0)) {          // anticipation crouch + tremble
        const tr = Math.sin(e.t * 50) * 0.04; sx = 0.84 + tr; sy = 1.14 - tr;
      }
      if (e.hitT > 0) { const k = e.hitT / 0.12; sx *= 1 - 0.2 * k; sy *= 1 + 0.16 * k; }                                   // flinch
      const br = Math.sin(e.t * (e.type === 'boomer' ? 6 : 3.5) + e.phase) * (e.type === 'boomer' ? 0.05 : 0.025);            // breathing
      sx *= 1 + br; sy *= 1 - br * 0.6;
      if (e.biteT > 0) ctx.translate(r * 0.4 * Math.sin((1 - e.biteT / 0.18) * Math.PI), 0);                                // bite lunge
    }
    ctx.scale(sc * sx, sc * sy);
    // abdomens swing with the gait and lag behind turns
    const tail = e.corpse ? (e.phase > Math.PI ? 0.4 : -0.4) : clamp(-(e.av || 0) * 0.1, -0.55, 0.55) + Math.sin(e.walk) * 0.14 * Math.min(1, mv);
    const chomp = e.near && !e.corpse ? 0.35 + Math.sin(e.t * 28) * 0.3 : 0.1;
    curlLegs = !!e.corpse;
    if (e.type === 'phantom') ctx.globalAlpha = phantomAlpha(e);
    const fl = e.flash > 0;
    const body = fl ? '#ffffff' : T.body, dk = fl ? '#d8d8d8' : T.dark;
    const ph = e.walk;
    if (e.type === 'burrower' && e.st === 'dig') { const k = Math.max(0.3, e.stT / 0.5); ctx.scale(k, k); }
    switch (e.type) {
      case 'burrower': {
        legs(3, r, r * 1.2, ph, dk, 3.5, r * 0.45);
        ctx.fillStyle = dk; ell(-r * 0.5, 0, r * 0.95, r * 0.75);
        ctx.fillStyle = body;
        for (let i = 0; i < 3; i++) ell(-r * 0.9 + i * r * 0.45, 0, r * 0.42, r * 0.62);
        ctx.fillStyle = dk; ell(r * 0.6, 0, r * 0.5, r * 0.55);
        // shovel claws
        ctx.fillStyle = fl ? '#fff' : '#c8b088';
        for (const sy of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(r * 0.8, sy * r * 0.3); ctx.lineTo(r * 1.55, sy * r * 0.55); ctx.lineTo(r * 1.35, sy * r * 0.1); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'warden': {
        legs(3, r, r * 1.3, ph, dk, 4.5, r * 0.5);
        ctx.fillStyle = dk; ell(-r * 0.2, 0, r * 1.0, r * 0.85);
        ctx.fillStyle = body; ell(-r * 0.25, 0, r * 0.85, r * 0.7);
        ctx.strokeStyle = dk; ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(-r * 0.1 - i * r * 0.4, 0, r * 0.6, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke(); }
        ctx.fillStyle = dk; ell(r * 0.55, 0, r * 0.42, r * 0.45);
        // shield emitter arms
        ctx.strokeStyle = fl ? '#fff' : '#7a9ac8'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
        ctx.moveTo(r * 0.4, -r * 0.6); ctx.lineTo(r * 1.15, -r * 0.95);
        ctx.moveTo(r * 0.4, r * 0.6); ctx.lineTo(r * 1.15, r * 0.95); ctx.stroke();
        // the shield plate itself
        ctx.strokeStyle = e.shieldFlash > 0 ? '#ffffff' : 'rgba(120,220,255,0.75)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.45, -1.05, 1.05); ctx.stroke();
        break;
      }
      case 'hatcher': {
        legs(4, r, r * 1.15, ph, dk, 4, r * 0.4);
        const sw = 1 + Math.sin(e.t * 3) * 0.05 + (e.cd < 0.6 ? (0.6 - Math.max(0, e.cd)) * 0.25 : 0);
        seg(-r * 0.05, tail * 0.6, () => {
        ctx.fillStyle = dk; ell(-r * 0.45, 0, r * 1.1 * sw, r * 0.95 * sw);
        ctx.fillStyle = fl ? '#fff' : '#b8a848'; ell(-r * 0.5, 0, r * 0.95 * sw, r * 0.8 * sw);
        ctx.fillStyle = fl ? '#ddd' : '#e8dc90';
        for (let i = 0; i < 6; i++) circ(-r * 0.5 + Math.cos(i * 1.05 + 0.3) * r * 0.45 * sw, Math.sin(i * 1.05 + 0.3) * r * 0.4 * sw, r * 0.15);
        });
        ctx.fillStyle = body; ell(r * 0.5, 0, r * 0.38, r * 0.4);
        ctx.fillStyle = dk; ell(r * 0.85, 0, r * 0.25, r * 0.22);
        break;
      }
      case 'egg': {
        const wob = e.hatch < 1 ? Math.sin(e.t * 40) * 0.12 : 0;
        ctx.rotate(wob);
        ctx.fillStyle = dk; ell(0, 0, r * 1.05, r * 1.25);
        ctx.fillStyle = fl ? '#fff' : body; ell(0, 0, r * 0.9, r * 1.1);
        ctx.strokeStyle = 'rgba(120,40,40,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i < 4; i++) { ctx.moveTo(0, -r * 1.0); ctx.quadraticCurveTo((i - 1.5) * r * 0.6, 0, (i - 1.5) * r * 0.3, r * 1.0); }
        ctx.stroke();
        break;
      }
      case 'mite': {
        legs(3, r, r * 1.3, ph * 1.6, dk, 1.5, r * 0.4);
        ctx.fillStyle = dk; circ(0, 0, r);
        ctx.fillStyle = body; circ(-r * 0.1, 0, r * 0.8);
        ctx.fillStyle = dk; ell(r * 0.8, 0, r * 0.35, r * 0.3);
        mandibles(r, r * 0.95, chomp, dk, 1.2);
        break;
      }
      case 'wasp': {
        const flap = e.corpse ? -0.4 : Math.sin(e.t * 70) * 0.35;
        ctx.fillStyle = 'rgba(220,240,255,0.35)';
        for (const sy of [-1, 1]) {
          ctx.save(); ctx.rotate(sy * (1.2 + flap)); ell(r * 0.9, 0, r * 1.1, r * 0.35); ctx.restore();
          ctx.save(); ctx.rotate(sy * (1.9 + flap)); ell(r * 0.7, 0, r * 0.8, r * 0.28); ctx.restore();
        }
        seg(-r * 0.15, e.st === 'dive' ? 0 : tail + Math.sin(e.t * 6) * 0.15, () => {
          if (e.st === 'dive') ctx.scale(0.75, 1);
          ctx.fillStyle = dk; ell(-r * 0.75, 0, r * 0.85, r * 0.5);
          ctx.fillStyle = body;
          for (let i = 0; i < 3; i++) ell(-r * 0.45 - i * r * 0.32, 0, r * 0.14, r * 0.48);
          ctx.fillStyle = dk; ctx.beginPath(); ctx.moveTo(-r * 1.55, 0); ctx.lineTo(-r * 2.1, 0); ctx.lineTo(-r * 1.55, r * 0.12); ctx.fill();
        });
        ctx.fillStyle = body; ell(r * 0.2, 0, r * 0.45, r * 0.4);
        ctx.fillStyle = dk; ell(r * 0.7, 0, r * 0.32, r * 0.3);
        break;
      }
      case 'crawler': {
        legs(3, r, r * 1.5, ph, dk, 2.5, r * 0.5);
        seg(-r * 0.2, tail, () => {
          ctx.fillStyle = dk; ell(-r * 0.75, 0, r * 0.8, r * 0.62);
          ctx.fillStyle = body; ell(-r * 0.7, 0, r * 0.68, r * 0.5);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-r * 0.35 - i * r * 0.32, 0, r * 0.45, -1, 1); ctx.stroke(); }
        });
        ctx.fillStyle = dk; ell(r * 0.1, 0, r * 0.6, r * 0.55);
        ctx.fillStyle = body; ell(r * 0.1, 0, r * 0.48, r * 0.43);
        ctx.fillStyle = dk; ell(r * 0.78, 0, r * 0.42, r * 0.38);
        mandibles(r, r * 0.98, chomp, body, 2);
        break;
      }
      case 'leaper': {
        legs(2, r, r * 2.3, ph * 0.7, dk, 2.5, r * 0.55);
        seg(-r * 0.1, tail * 1.2, () => {
          ctx.fillStyle = dk; ell(-r * 0.6, 0, r * 0.9, r * 0.45);
          ctx.fillStyle = body; ell(-r * 0.55, 0, r * 0.75, r * 0.34);
          ctx.strokeStyle = body; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(-r * 1.4, 0); ctx.quadraticCurveTo(-r * 1.8, Math.sin(e.t * 9) * r * 0.4, -r * 2.1, Math.sin(e.t * 9 - 1) * r * 0.5); ctx.stroke();
        });
        ctx.fillStyle = body; ell(r * 0.35, 0, r * 0.55, r * 0.4);
        ctx.fillStyle = dk; ell(r * 0.95, 0, r * 0.35, r * 0.3);
        mandibles(r * 0.8, r * 1.15, chomp, body, 1.5);
        break;
      }
      case 'spitter': {
        legs(4, r, r * 1.25, ph, dk, 2.5, r * 0.5);
        const puff = 1 + Math.sin(e.t * 5) * 0.06 + (0.4 - clamp(e.cd, 0, 0.4)) * 0.4;
        seg(-r * 0.05, tail * 0.7, () => {
        ctx.fillStyle = dk; ell(-r * 0.55, 0, r * 1.0 * puff, r * 0.85 * puff);
        ctx.fillStyle = fl ? '#fff' : '#a659d8'; ell(-r * 0.6, 0, r * 0.82 * puff, r * 0.68 * puff);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 4; i++) circ(-r * 0.6 + Math.cos(i * 1.7) * r * 0.4, Math.sin(i * 1.7) * r * 0.35, r * 0.12);
        });
        ctx.fillStyle = body; ell(r * 0.45, 0, r * 0.45, r * 0.4);
        ctx.fillStyle = dk; ell(r * 0.85, 0, r * 0.28, r * 0.22);
        break;
      }
      case 'brute': {
        legs(3, r, r * 1.3, ph, dk, 6, r * 0.55);
        ctx.strokeStyle = dk; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath();
        ctx.moveTo(r * 0.5, -r * 0.5); ctx.quadraticCurveTo(r * 1.4, -r * 0.8, r * 1.4, -r * 0.15);
        ctx.moveTo(r * 0.5, r * 0.5); ctx.quadraticCurveTo(r * 1.4, r * 0.8, r * 1.4, r * 0.15);
        ctx.stroke();
        ctx.fillStyle = dk; ell(-r * 0.1, 0, r * 1.05, r * 0.92);
        ctx.fillStyle = body; ell(-r * 0.12, 0, r * 0.92, r * 0.8);
        ctx.strokeStyle = dk; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(r * 0.2 - i * r * 0.45, 0, r * 0.7, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke(); }
        ctx.fillStyle = fl ? '#fff' : '#c25a35'; ell(r * 0.65, 0, r * 0.42, r * 0.48);
        if (e.st === 'wind') { ctx.fillStyle = 'rgba(255,80,0,0.4)'; ell(0, 0, r * 1.1, r * 1); }
        break;
      }
      case 'boomer': {
        legs(3, r, r * 0.9, ph, dk, 2.5, r * 0.45);
        const pul = 1 + Math.sin(e.t * (e.fuse > 0 ? 40 : 6)) * 0.07;
        ctx.fillStyle = dk; circ(0, 0, r * pul);
        ctx.fillStyle = e.fuse > 0 && Math.sin(e.t * 40) > 0 ? '#ffffff' : body; circ(0, 0, r * 0.86 * pul);
        ctx.strokeStyle = fl ? '#fff' : '#ff7a1a'; ctx.lineWidth = 1.6; ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26 + 0.3;
          ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
          ctx.quadraticCurveTo(Math.cos(a + 0.4) * r * 0.5, Math.sin(a + 0.4) * r * 0.5, Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        }
        ctx.stroke();
        ctx.fillStyle = dk; ell(r * 0.8, 0, r * 0.32, r * 0.28);
        break;
      }
      case 'phantom': {
        legs(2, r, r * 1.9, ph, dk, 2, r * 0.4);
        ctx.fillStyle = dk; ell(-r * 0.3, 0, r * 1.0, r * 0.5);
        ctx.fillStyle = body; ell(-r * 0.3, 0, r * 0.85, r * 0.38);
        ctx.fillStyle = dk; ell(r * 0.75, 0, r * 0.4, r * 0.32);
        ctx.strokeStyle = body; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = -1; i <= 1; i++) { ctx.moveTo(-r * 1.2, i * r * 0.2); ctx.lineTo(-r * 2.1, i * r * 0.35 + Math.sin(e.t * 7 + i) * r * 0.3); }
        ctx.stroke();
        break;
      }
      case 'specimen': {
        // tentacles
        ctx.strokeStyle = dk; ctx.lineWidth = 6; ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.3, w = Math.sin(e.t * 4 + i) * 0.35;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
          ctx.quadraticCurveTo(Math.cos(a + w) * r * 1.2, Math.sin(a + w) * r * 1.2, Math.cos(a - w) * r * 1.55, Math.sin(a - w) * r * 1.55);
          ctx.stroke();
        }
        const pul = 1 + Math.sin(e.t * 3) * 0.04;
        ctx.fillStyle = dk; ell(0, 0, r * 1.05 * pul, r * 0.95 * pul);
        ctx.fillStyle = fl ? '#fff' : 'rgba(90,200,120,0.9)'; ell(-r * 0.05, 0, r * 0.9 * pul, r * 0.8 * pul);
        ctx.fillStyle = 'rgba(20,60,30,0.6)';
        for (let i = 0; i < 5; i++) circ(Math.cos(i * 1.3 + 1) * r * 0.45, Math.sin(i * 1.3 + 1) * r * 0.45, r * 0.16);
        ctx.strokeStyle = fl ? '#fff' : '#c8ff6a'; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-r * 0.3, 0); ctx.quadraticCurveTo(Math.cos(i * 1.6) * r * 0.5, Math.sin(i * 1.6) * r * 0.2, Math.cos(i * 1.6 + 0.5) * r * 0.75, Math.sin(i * 1.6 + 0.5) * r * 0.75); ctx.stroke(); }
        ctx.fillStyle = dk; ell(r * 0.7, 0, r * 0.38, r * 0.5);
        break;
      }
      case 'titan': {
        legs(5, r, r * 1.35, ph, dk, 9, r * 0.6);
        const sw = 1 + Math.sin(e.t * 2) * 0.04 + (e.st === 'barrage' ? 0.06 : 0);
        seg(-r * 0.05, tail * 0.5, () => {
        ctx.fillStyle = dk; ell(-r * 0.6, 0, r * 1.15 * sw, r * 0.95 * sw);
        ctx.fillStyle = fl ? '#fff' : '#c8a848'; ell(-r * 0.65, 0, r * 1.0 * sw, r * 0.82 * sw);
        ctx.fillStyle = fl ? '#ddd' : '#f0e4a0';
        for (let i = 0; i < 9; i++) circ(-r * 0.65 + Math.cos(i * 0.7) * r * 0.55 * sw, Math.sin(i * 0.7) * r * 0.5 * sw, r * 0.13);
        });
        ctx.fillStyle = dk; ell(r * 0.35, 0, r * 0.62, r * 0.6);
        ctx.fillStyle = body; ell(r * 0.35, 0, r * 0.52, r * 0.5);
        ctx.strokeStyle = dk; ctx.lineWidth = 4;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(r * 0.35, 0, r * (0.2 + i * 0.12), -1.2, 1.2); ctx.stroke(); }
        ctx.fillStyle = dk; ell(r * 0.95, 0, r * 0.32, r * 0.36);
        break;
      }
      case 'behemoth': {
        // arms
        ctx.fillStyle = dk;
        for (const sy of [-1, 1]) { ell(r * 0.45, sy * r * 0.85, r * 0.45, r * 0.3); ell(r * 0.95, sy * r * 0.8, r * 0.3, r * 0.26); }
        ctx.fillStyle = dk; ell(0, 0, r * 1.0, r * 0.9);
        ctx.fillStyle = fl ? '#fff' : body;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, rr = r * (0.82 + (i % 2) * 0.08); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
        // lava cracks
        ctx.strokeStyle = fl ? '#fff' : (e.st === 'wind' ? '#ffe08a' : '#ff7a1a'); ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.2; ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15); ctx.lineTo(Math.cos(a + 0.2) * r * 0.45, Math.sin(a + 0.2) * r * 0.45); ctx.lineTo(Math.cos(a - 0.1) * r * 0.78, Math.sin(a - 0.1) * r * 0.78); }
        ctx.stroke();
        ctx.fillStyle = dk; ell(r * 0.72, 0, r * 0.32, r * 0.4);
        break;
      }
      case 'queen': {
        legs(4, r, r * 1.5, ph, dk, 7, r * 0.6);
        seg(-r * 0.4, tail * 0.6, () => {
          ctx.fillStyle = dk; ell(-r * 1.15, 0, r * 0.95, r * 0.78);
          ctx.fillStyle = fl ? '#fff' : '#c43a8a'; ell(-r * 1.15, 0, r * 0.82, r * 0.66);
          ctx.strokeStyle = dk; ctx.lineWidth = 3;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 - i * r * 0.3, 0, r * 0.62, Math.PI * 0.65, Math.PI * 1.35); ctx.stroke(); }
        });
        ctx.fillStyle = dk; ell(-r * 0.1, 0, r * 0.7, r * 0.62);
        ctx.fillStyle = body; ell(-r * 0.1, 0, r * 0.6, r * 0.52);
        ctx.fillStyle = dk; ell(r * 0.65, 0, r * 0.45, r * 0.5);
        ctx.fillStyle = fl ? '#fff' : '#e0c050';
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.45;
          ctx.beginPath();
          ctx.moveTo(r * 0.55 + Math.cos(Math.PI + a) * r * 0.2, Math.sin(Math.PI + a) * r * 0.5);
          ctx.lineTo(r * 0.55 + Math.cos(Math.PI + a) * r * 0.75, Math.sin(Math.PI + a) * r * 0.95);
          ctx.lineTo(r * 0.55 + Math.cos(Math.PI + a + 0.2) * r * 0.2, Math.sin(Math.PI + a + 0.2) * r * 0.5);
          ctx.fill();
        }
        ctx.strokeStyle = body; ctx.lineWidth = 4; ctx.beginPath();
        ctx.moveTo(r * 0.9, -r * 0.3); ctx.quadraticCurveTo(r * 1.5, -r * 0.45, r * 1.4, -r * 0.05);
        ctx.moveTo(r * 0.9, r * 0.3); ctx.quadraticCurveTo(r * 1.5, r * 0.45, r * 1.4, r * 0.05);
        ctx.stroke();
        break;
      }
    }
    if (e.elite && !T.boss) {
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 1.15, r * 0.9, 0, 0, TAU); ctx.stroke();
    }
    if (e.affix && !e.corpse) {
      // one dashed ring per affix, counter-rotating
      e.affix.forEach((k, i) => {
        ctx.strokeStyle = AFFIX[k].color; ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]); ctx.lineDashOffset = e.t * (i ? -40 : 40);
        ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * (1.32 + i * 0.2), r * (1.05 + i * 0.2), 0, 0, TAU); ctx.stroke();
      });
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    ctx.restore();
    if (!e.corpse && !T.boss && e.hp < e.maxHp && (e.maxHp > 120 || e.elite || e.champ)) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - w / 2, e.y - r - 12, w, 4);
      ctx.fillStyle = e.elite ? '#ffd23a' : e.champ ? AFFIX[e.affix[0]].color : '#ff5a3a'; ctx.fillRect(e.x - w / 2, e.y - r - 12, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  function eyePositions(e) {
    const r = e.r, c = Math.cos(e.angle), s = Math.sin(e.angle);
    const hx = { crawler: 0.95, leaper: 1.1, spitter: 0.92, brute: 0.85, boomer: 0.92, phantom: 0.9, queen: 0.85, burrower: 0.8, warden: 0.75, hatcher: 0.9, mite: 0.9, wasp: 0.85, egg: 0, specimen: 0.8, titan: 1.05, behemoth: 0.82 }[e.type];
    const sp = { crawler: 0.17, leaper: 0.14, spitter: 0.12, brute: 0.22, boomer: 0.14, phantom: 0.16, queen: 0.22, burrower: 0.2, warden: 0.2, hatcher: 0.12, mite: 0.2, wasp: 0.15, egg: 0, specimen: 0.25, titan: 0.18, behemoth: 0.2 }[e.type];
    const fx = e.x + c * r * hx, fy = e.y + s * r * hx;
    return [[fx - s * r * sp, fy + c * r * sp], [fx + s * r * sp, fy - c * r * sp]];
  }

  function drawGun(w, L, spin) {
    const p = player;
    const hot = (w.id === 'smg' || w.id === 'minigun') ? p.heat : 0;
    ctx.fillStyle = hot > 0.3 ? `rgb(${Math.round(42 + hot * 120)},${Math.round(45 + hot * 25)},${Math.round(51 - hot * 20)})` : '#2a2d33';
    switch (w.id) {
      case 'shotgun': {
        ctx.fillRect(4, 1, L, 8);
        const pump = p.pumpT > 0 ? Math.sin((1 - p.pumpT / 0.4) * Math.PI) * 7 : 0;
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(12 - pump, 0, 8, 10);
        break;
      }
      case 'rocket':
        ctx.fillStyle = '#4a5a3a'; ctx.fillRect(-8, -1, L + 8, 12); ctx.fillStyle = '#2a2d33'; ctx.fillRect(L - 4, -2, 6, 14); break;
      case 'flamer':
        ctx.fillRect(4, 2, L, 6); ctx.fillStyle = '#8a3a1a'; ctx.fillRect(-2, 0, 10, 10); ctx.fillStyle = '#444'; ctx.fillRect(L, 1, 4, 8); break;
      case 'rail':
        ctx.fillRect(2, 1, L, 8);
        { const ch = clamp(1 - p.fireCd * w.rate, 0, 1); ctx.fillStyle = w.color; for (let i = 0; i < 3; i++) { ctx.globalAlpha = ch > i / 3 ? 1 : 0.25; ctx.fillRect(10 + i * 7, 0, 3, 10); } ctx.globalAlpha = 1; }
        break;
      case 'minigun':
        ctx.fillRect(0, -1, 14, 12);
        for (let k = 0; k < 3; k++) { ctx.fillStyle = k === 1 ? '#3a3e46' : '#2a2d33'; ctx.fillRect(12, 0.5 + ((k + spin) % 3) * 3, L - 10, 2.4); }
        break;
      case 'saw':
        ctx.fillRect(2, 0, L - 4, 10);
        if (p.fireCd < 0.12 || !(mouse.down || pad.fire)) { ctx.fillStyle = '#c8ff3a'; circ(L - 2, 5, 6); ctx.fillStyle = '#2a2d33'; circ(L - 2, 5, 2); }
        break;
      case 'arc':
        ctx.fillRect(2, 1, L - 6, 8);
        ctx.fillStyle = '#8ab8ff'; ctx.fillRect(L - 6, -1, 8, 2.5); ctx.fillRect(L - 6, 8.5, 8, 2.5);
        for (let i = 0; i < 3; i++) ctx.fillRect(6 + i * 4, 0, 2, 10);
        break;
      default:
        ctx.fillRect(4, 2, L, 6);
    }
    if (w.id !== 'rail' && w.id !== 'arc') { ctx.fillStyle = w.color; ctx.fillRect(8, 3.5, L * 0.35, 1.5); }
  }

  // ground ring under the soldier so they never get lost in a swarm; the bright notch shows aim
  function drawPlayerRing(glowPass) {
    const p = player;
    if (!p || state === 'dying' || state === 'over') return;
    const r = 27 + p.gear.armor, a = p.angle;
    ctx.lineCap = 'round';
    ctx.strokeStyle = glowPass ? 'rgba(90,240,255,0.16)' : 'rgba(90,240,255,0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, a + 0.42, a + TAU - 0.42); ctx.stroke();
    ctx.strokeStyle = glowPass ? 'rgba(200,255,255,0.5)' : '#bff8ff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, a - 0.26, a + 0.26); ctx.stroke();
    if (!glowPass && p.hp < 35) {
      ctx.strokeStyle = `rgba(255,60,80,${(0.35 + Math.sin(gameTime * 8) * 0.25).toFixed(3)})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, TAU); ctx.stroke();
    }
  }

  function drawPlayer() {
    const p = player;
    if (state === 'dying' || state === 'over') return;
    const G = p.gear;
    const spd = Math.hypot(p.vx, p.vy), mvk = Math.min(1, spd / 300);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (!noBlob) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ell(3, 5, 17 + G.armor, 14 + G.armor); }
    if (p.hitT > 0) ctx.translate(rand(-2.5, 2.5), rand(-2.5, 2.5));
    if (p.invuln > 0 && p.dash <= 0 && p.aegis <= 0 && Math.floor(gameTime * 30) % 2) ctx.globalAlpha = 0.45;

    // legs: face the direction of travel and stride
    ctx.save();
    ctx.rotate(p.legA);
    const stride = Math.sin(p.walk) * 7 * mvk;
    ctx.fillStyle = G.boots ? '#3a3320' : '#1b2a30';
    ctx.fillRect(-4 + stride, -10, 10 + G.boots, 7); ctx.fillRect(-4 - stride, 3, 10 + G.boots, 7);
    if (G.boots) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(-4 + stride, -8, 2 + G.boots, 3); ctx.fillRect(-4 - stride, 5, 2 + G.boots, 3); }
    ctx.restore();

    // upper body: aims, sways with the stride, leans into a dash, shoved back by recoil
    ctx.rotate(p.angle + Math.sin(p.walk) * 0.09 * mvk + p.kickA);
    if (p.dash > 0) ctx.scale(1.2, 0.85);
    const breathe = 1 + Math.sin(gameTime * 3) * 0.018 * (1 - mvk);
    const bob = 1 + Math.abs(Math.sin(p.walk)) * 0.04 * mvk;
    ctx.scale(breathe * bob, breathe * bob);
    ctx.translate(-p.recoil * 0.45, 0);
    ctx.fillStyle = '#24343a'; ctx.fillRect(-18, -9, 9, 18);
    if (G.vital) {
      ctx.fillStyle = '#0e2e18'; ctx.fillRect(-21, -10, 6, 20);
      ctx.fillStyle = '#5dff8a';
      for (let i = 0; i < G.vital; i++) ctx.fillRect(-20, -8.5 + i * 4.5, 4, 3);
    }
    if (G.shield) {
      ctx.fillStyle = '#16323e'; circ(-12, 0, 4 + G.shield);
      ctx.fillStyle = '#5ad1ff'; circ(-12, 0, 1.5 + G.shield * 0.7);
    }
    if (WEAPONS[p.cur].id === 'flamer') { ctx.fillStyle = '#8a3a1a'; circ(-15, -5, 5); circ(-15, 5, 5); }
    ctx.fillStyle = '#2e5f6a'; ell(-1, 0, 10, 15);
    ctx.fillStyle = '#3f8a94'; ell(0, 0, 7, 11);
    if (G.armor >= 2) {
      ctx.fillStyle = '#7a8498'; ell(1, 0, 7.5, 12);
      ctx.strokeStyle = '#4a5468'; ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-3, i * 5); ctx.lineTo(6, i * 5); ctx.stroke(); }
      if (G.armor >= 3) { ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(1, 0, 7.5, 12, 0, 0, TAU); ctx.stroke(); }
    }
    // gun (dips and comes back up on weapon swap)
    const w = WEAPONS[p.cur];
    ctx.save();
    if (p.swapT > 0) { const k = p.swapT / 0.28; ctx.translate(-k * 6, k * 5); ctx.rotate(k * 0.9); }
    drawGun(w, w.len - p.recoil, Math.floor(gameTime * 40 * p.spin));
    ctx.fillStyle = '#1f2b30'; circ(8 - p.recoil * 0.3, 6, 3.5); circ(15 - p.recoil * 0.5, 5, 3);
    ctx.restore();
    // shoulders roll opposite to the stride
    const pw = 5 + G.armor * 1.3, ph = 4 + G.armor * 0.7, po = 12 + G.armor * 0.6, roll = Math.sin(p.walk) * 1.6 * mvk;
    ctx.fillStyle = G.armor >= 3 ? '#c8b060' : G.armor ? '#9aa4b8' : '#4aa3ad';
    ell(roll, -po, pw, ph); ell(-roll, po, pw, ph);
    if (G.armor) {
      ctx.strokeStyle = '#3a4252'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(roll, -po, pw, ph, 0, 0, TAU); ctx.ellipse(-roll, po, pw, ph, 0, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#1c2a2f'; circ(1, 0, 7.5);
    ctx.fillStyle = G.armor ? '#5a6478' : '#3c7c86'; circ(0, 0, 6.5);
    if (G.armor >= 3) { ctx.fillStyle = '#ff3a4a'; ctx.fillRect(-8, -1.3, 10, 2.6); }
    ctx.fillStyle = '#7ff6ff'; ctx.fillRect(3, -4, 3, 8);
    if (p.hitT > 0) { ctx.globalAlpha = p.hitT * 2.5; ctx.fillStyle = '#ff2a3a'; ell(0, 0, 12, 16); ctx.globalAlpha = 1; }
    ctx.restore();

    // sentry drones
    for (const d of p.drones) {
      ctx.save(); ctx.translate(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ell(6, 10, 8, 5);
      ctx.rotate(d.aim);
      ctx.fillStyle = '#2a2d36'; circ(0, 0, 8);
      ctx.fillStyle = '#4a4e5c'; circ(-1, -1, 5.5);
      ctx.fillStyle = '#16181e'; ctx.fillRect(4, -1.5, 9, 3);
      ctx.fillStyle = '#ff7ad8'; circ(0, 0, 2);
      ctx.restore();
    }
  }

  const FLASH = { pistol: [16, 3], smg: [12, 2], shotgun: [30, 5], rifle: [20, 2], rocket: [20, 4], rail: [26, 6], minigun: [15, 3], saw: [10, 2], arc: [16, 4], flamer: [0, 0] };
  function drawWeaponFx(p) {
    const w = WEAPONS[p.cur], m = muzzlePos(), a = p.angle + p.kickA;
    if (p.muzzle > 0 && w.kind !== 'flame') {
      const [len, prongs] = FLASH[w.id];
      glow(w.color, m.x, m.y, len * 1.8, 0.9);
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(a + p.flashRot * 0.3);
      ctx.fillStyle = w.color; ctx.globalAlpha = 0.9;
      // star-shaped flash: long forward prong, shorter side prongs
      ctx.beginPath();
      const pts = prongs * 2 + 2;
      for (let i = 0; i < pts; i++) {
        const t = (i / pts) * TAU, fwd = Math.max(0, Math.cos(t));
        const rr = i % 2 ? len * 0.18 : len * (0.35 + fwd * fwd * 0.9) * rand(0.8, 1.15);
        ctx.lineTo(Math.cos(t) * rr * (w.id === 'shotgun' ? 1.1 : 1), Math.sin(t) * rr * (w.id === 'shotgun' ? 1.5 : 1));
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; circ(0, 0, len * 0.18);
      ctx.restore();
      if (w.kind === 'rocket') glow('#ff9a3a', p.x - Math.cos(a) * 22, p.y - Math.sin(a) * 22, 30, 0.9); // backblast
    }
    if (w.id === 'flamer') glow(Math.random() < 0.5 ? '#5ab0ff' : '#ff9a2e', m.x, m.y, 7 + Math.random() * 3, 0.9); // pilot light
    if (p.heat > 0.15) glow('#ff6a1a', m.x - Math.cos(a) * 8, m.y - Math.sin(a) * 8, 8 + p.heat * 10, p.heat * 0.8);
    if (w.id === 'rail') { const ch = clamp(1 - p.fireCd * w.rate, 0, 1); glow(w.color, m.x - Math.cos(a) * 14, m.y - Math.sin(a) * 14, 8 + ch * 10, 0.25 + ch * 0.6); }
    if (w.id === 'arc' && Math.random() < 0.15) sparks(m.x, m.y, w.color, 1, 120);
  }

  function drawPlayerGlow() {
    const p = player;
    if (!p || state === 'dying' || state === 'over') return;
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    if (p.gear.vital) glow('#5dff8a', p.x - ca * 18, p.y - sa * 18, 8 + p.gear.vital * 2, 0.45 + beatPulse * 0.3);
    if (p.gear.boots && p.moving) {
      glow('#ffd23a', p.x - ca * 2 + sa * 7, p.y - sa * 2 - ca * 7, 7, 0.5);
      glow('#ffd23a', p.x - ca * 2 - sa * 7, p.y - sa * 2 + ca * 7, 7, 0.5);
    }
    if (p.shieldMax > 0 && p.shield > 0) {
      const f = p.shield / p.shieldMax;
      const R = 27 + p.gear.armor;
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(90,209,255,${Math.min(1, 0.2 + f * 0.45 + p.shieldHit * 3).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.stroke();
      // rotating hex segments
      for (let i = 0; i < 6; i++) {
        const a = gameTime * 0.8 + (i * TAU) / 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, R + 3, a, a + 0.5 * f); ctx.stroke();
      }
      if (p.shieldHit > 0) glow('#5ad1ff', p.x, p.y, R * 1.4, p.shieldHit * 2);
    }
    if (p.aegis > 0) {
      const blink = p.aegis < 1.5 && Math.floor(gameTime * 10) % 2;
      if (!blink) {
        glow('#ffd23a', p.x, p.y, 48, 0.35);
        ctx.strokeStyle = 'rgba(255,210,58,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 34 + Math.sin(gameTime * 12) * 2, 0, TAU); ctx.stroke();
      }
    }
    if (p.chrono > 0) {
      ctx.strokeStyle = 'rgba(122,216,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, TAU); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12;
        ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * 36, p.y + Math.sin(a) * 36); ctx.lineTo(p.x + Math.cos(a) * 41, p.y + Math.sin(a) * 41); ctx.stroke();
      }
      const h = -gameTime * 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(h) * 30, p.y + Math.sin(h) * 30); ctx.stroke();
    }
    for (const d of p.drones) {
      glow('#ff7ad8', d.x, d.y, 12, 0.5);
      if (d.flash > 0) glow('#ffffff', d.x + Math.cos(d.aim) * 13, d.y + Math.sin(d.aim) * 13, 10, 1);
    }
  }

  function drawPickup(pk) {
    if (pk.life < 3 && Math.floor(pk.t * 10) % 2) return;
    const bob = Math.sin(pk.t * 4) * 3;
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ell(2, 10, 14, 6);
    ctx.translate(0, bob);
    if (pk.kind === 'gear' && pk.drop > 0) {
      const k = clamp(pk.drop / 0.8, 0, 1);
      ctx.translate(0, -k * 120); ctx.scale(1 + k * 0.8, 1 + k * 0.8); ctx.globalAlpha = 1 - k * 0.4;
    }
    switch (pk.kind) {
      case 'gear': {
        const info = gearInfo(pk.gk);
        if (isPerk(pk.gk)) {
          // perk crate: hexagonal pod with a spinning ring, so it reads differently from stat gear
          const hex = r => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); };
          ctx.fillStyle = '#1e1a2a'; hex(20); ctx.fill();
          ctx.strokeStyle = info.color; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.fillStyle = '#100c18'; hex(13); ctx.fill();
          ctx.strokeStyle = hexA(info.color, 0.55); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, 25, pk.t * 2, pk.t * 2 + 1.4); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 25, pk.t * 2 + Math.PI, pk.t * 2 + Math.PI + 1.4); ctx.stroke();
          ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = info.color;
          ctx.fillText(info.icon, 1, 1);
          if (!(pk.drop > 0)) {
            const lv = player.perk[pk.gk];
            ctx.font = font(7); ctx.fillStyle = '#000'; ctx.fillText(info.name, 1, -33); ctx.fillStyle = info.color; ctx.fillText(info.name, 0, -34);
            ctx.font = font(6); ctx.fillStyle = '#c8d0e8'; ctx.fillText(crateDesc(pk.gk), 0, 32);
            ctx.fillStyle = info.color; ctx.fillText(lv ? `PERK LV ${lv + 1}` : 'NEW PERK', 0, 42);
            if (synergy(player, pk.gk) || (info.needs && !lv)) { ctx.fillStyle = Math.sin(pk.t * 6) > -0.4 ? '#ffd23a' : '#fff6c8'; ctx.fillText('SYNERGY', 0, -44); }
          }
          break;
        }
        ctx.fillStyle = '#262a34'; ctx.fillRect(-18, -15, 36, 30);
        ctx.strokeStyle = '#4a505e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, -15); ctx.lineTo(18, 15); ctx.moveTo(18, -15); ctx.lineTo(-18, 15); ctx.stroke();
        ctx.fillStyle = '#16181e'; ctx.fillRect(-11, -9, 22, 18);
        ctx.strokeStyle = info.color; ctx.lineWidth = 2.5; ctx.strokeRect(-18, -15, 36, 30);
        ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = info.color;
        ctx.fillText(info.icon, 1, 1);
        if (!(pk.drop > 0)) {
          const lvl = GEAR[pk.gk] ? `LV ${player.gear[pk.gk] + 1}` : '';
          ctx.font = font(7); ctx.fillStyle = '#000'; ctx.fillText(info.name, 1, -27); ctx.fillStyle = info.color; ctx.fillText(info.name, 0, -28);
          ctx.font = font(6); ctx.fillStyle = '#c8d0e8'; ctx.fillText(info.desc, 0, 26);
          if (lvl) { ctx.fillStyle = info.color; ctx.fillText(lvl, 0, 36); }
        }
        break;
      }
      case 'power': {
        const P = POWER[pk.wi];
        ctx.fillStyle = P.color; circ(0, 0, 11);
        ctx.fillStyle = '#16181e'; circ(0, 0, 8);
        ctx.fillStyle = P.color; ctx.strokeStyle = P.color; ctx.lineWidth = 2;
        if (pk.wi === 'overdrive') { ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(-4, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 7); ctx.lineTo(4, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill(); }
        else if (pk.wi === 'aegis') { ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, -3); ctx.lineTo(4, 3); ctx.lineTo(0, 6); ctx.lineTo(-4, 3); ctx.lineTo(-5, -3); ctx.closePath(); ctx.fill(); }
        else if (pk.wi === 'chrono') { ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.moveTo(0, 0); ctx.lineTo(0, -4); ctx.moveTo(0, 0); ctx.lineTo(3, 1); ctx.stroke(); }
        else { for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(-Math.cos(a) * 6, -Math.sin(a) * 6); ctx.stroke(); } }
        break;
      }
      case 'med':
        ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-12, -10, 24, 20);
        ctx.fillStyle = '#e02a3a'; ctx.fillRect(-3, -7, 6, 14); ctx.fillRect(-7, -3, 14, 6);
        break;
      case 'ammo':
        ctx.fillStyle = '#4a5228'; ctx.fillRect(-13, -9, 26, 18);
        ctx.fillStyle = '#d8b04a'; for (let i = 0; i < 4; i++) ctx.fillRect(-9 + i * 5, -6, 3, 9);
        ctx.fillStyle = '#2a2e14'; ctx.fillRect(-13, 4, 26, 5);
        break;
      case 'overdrive':
        ctx.fillStyle = '#ff2a4a'; circ(0, 0, 10);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 8); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill();
        break;
      case 'weapon': {
        const w = WEAPONS[pk.wi];
        ctx.rotate(Math.sin(pk.t * 2) * 0.15);
        ctx.fillStyle = '#3a3010'; ctx.fillRect(-18, -12, 36, 24);
        ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 2.5; ctx.strokeRect(-18, -12, 36, 24);
        ctx.fillStyle = w.color; ctx.fillRect(-12, -3, 24, 6);
        ctx.rotate(-Math.sin(pk.t * 2) * 0.15);
        ctx.font = font(8); ctx.textAlign = 'center'; ctx.fillStyle = '#ffd23a';
        ctx.fillText(w.short, 0, -22);
        break;
      }
      case 'upgrade':
        ctx.fillStyle = '#103a4a'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, 0); ctx.lineTo(0, 14); ctx.lineTo(-13, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#5ad1ff'; ctx.fillRect(-2, -7, 4, 14); ctx.fillRect(-7, -2, 14, 4);
        break;
    }
    ctx.restore();
  }

  function drawTempPools() {
    for (const pl of pools) {
      if (!pl.temp) continue;
      ctx.globalAlpha = Math.min(1, pl.life * 0.8, (5 - pl.life) * 4);
      drawPoolFloor(ctx, pl);
      ctx.globalAlpha = 1;
    }
  }
  function lobHeight(s) { const f = Math.min(1, s.t / s.dur); return Math.sin(f * Math.PI) * 90; }
  function drawLob(s) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ell(s.x, s.y, 9, 6);
    const h = lobHeight(s);
    ctx.fillStyle = s.color; circ(s.x, s.y - h, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; circ(s.x + 2, s.y - h + 2, 4);
  }

  function octagon(pl, c1, c2, c3) {
    ctx.fillStyle = c1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; ctx.lineTo(pl.x + Math.cos(a) * pl.r, pl.y + Math.sin(a) * pl.r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; ctx.lineTo(pl.x - 3 + Math.cos(a) * pl.r * 0.84, pl.y - 4 + Math.sin(a) * pl.r * 0.84); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c3; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#16181e'; circ(pl.x - 3, pl.y - 4, pl.r * 0.42);
  }

  function drawBarrel(b) {
    const B = BARREL[arena.style];
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.drop > 0) { const k = clamp(b.drop / 0.9, 0, 1); ctx.translate(0, -k * 140); ctx.globalAlpha = 1 - k * 0.5; }
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ell(3, 6, b.r * 1.05, b.r * 0.7);
    const hot = b.hitT > 0, crit = b.hp < b.max && Math.sin(gameTime * 24) > 0;
    if (arena.style === 'organic') {
      ctx.fillStyle = hot ? '#ffffff' : B.body; ell(0, 0, b.r * 1.05, b.r * 0.95);
      ctx.fillStyle = crit ? '#ffffff' : B.color; ctx.globalAlpha *= 0.7; ell(-3, -3, b.r * 0.55, b.r * 0.45); ctx.globalAlpha = 1;
      ctx.strokeStyle = B.band; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, b.r * 0.8, i * 2.1 + gameTime, i * 2.1 + gameTime + 0.9); ctx.stroke(); }
    } else {
      ctx.fillStyle = hot ? '#ffffff' : B.body; circ(0, 0, b.r);
      ctx.strokeStyle = crit ? '#ffffff' : B.band; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, b.r - 3, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#111'; circ(0, 0, b.r * 0.42);
      ctx.fillStyle = crit ? '#ffffff' : B.color;
      // hazard trefoil
      for (let i = 0; i < 3; i++) { const a = i * TAU / 3 - Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, b.r * 0.36, a - 0.45, a + 0.45); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ell(-b.r * 0.4, -b.r * 0.45, b.r * 0.3, b.r * 0.16);
    }
    ctx.restore();
  }

  function drawPad(pd) {
    const c = pd.st === 'cool' ? '#4a4a60' : '#5affc8';
    ctx.save(); ctx.translate(pd.x, pd.y);
    ctx.fillStyle = '#12161c'; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + Math.PI / 8; ctx.lineTo(Math.cos(a) * pd.r, Math.sin(a) * pd.r); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = hexA(c, 0.6); ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = hexA(c, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, pd.r * 0.62, 0, TAU); ctx.stroke();
    if (pd.st === 'ready' && pd.prog > 0) { ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, pd.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * pd.prog); ctx.stroke(); }
    if (pd.st === 'active') { ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, pd.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (pd.t / 20)); ctx.stroke(); }
    if (pd.st === 'cool') { ctx.strokeStyle = '#6a6a88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, pd.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - pd.t / 40)); ctx.stroke(); }
    ctx.restore();
  }

  function drawTurret(pd) {
    const up = pd.st === 'active';
    ctx.save(); ctx.translate(pd.x, pd.y);
    ctx.fillStyle = up ? '#2a3a40' : '#1c2228'; circ(0, 0, 13);
    ctx.rotate(pd.aim);
    ctx.fillStyle = up ? '#5affc8' : '#3a4a50';
    ctx.fillRect(4, -4, up ? 22 : 12, 3); ctx.fillRect(4, 1, up ? 22 : 12, 3);
    ctx.fillStyle = up ? '#3a5a60' : '#2a3036'; ctx.fillRect(-8, -7, 14, 14);
    if (up && pd.flash > 0) { ctx.fillStyle = '#e8fff8'; circ(28, 0, 5); }
    ctx.restore();
  }

  function drawPillars() {
    for (const pl of pillars) {
      switch (arena.pillar) {
        case 'tank':
          ctx.fillStyle = '#1a2626'; circ(pl.x, pl.y, pl.r);
          ctx.fillStyle = 'rgba(60,255,190,0.22)'; circ(pl.x - 2, pl.y - 3, pl.r * 0.8);
          ctx.fillStyle = 'rgba(10,40,30,0.85)'; ell(pl.x - 2 + Math.sin(gameTime + pl.seed) * 3, pl.y - 3, pl.r * 0.35, pl.r * 0.45);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(pl.x - 2, pl.y - 3, pl.r * 0.62, 3.6, 4.6); ctx.stroke();
          ctx.strokeStyle = '#4a6a68'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r - 2, 0, TAU); ctx.stroke();
          break;
        case 'sac': {
          ctx.fillStyle = '#2a0a26';
          ctx.beginPath();
          for (let i = 0; i <= 20; i++) {
            const a = (i / 20) * TAU, rr = pl.r * (1 + Math.sin(a * 3 + pl.seed) * 0.12 + Math.sin(a * 7 + pl.seed * 2) * 0.06 + Math.sin(gameTime * 2 + pl.seed) * 0.02);
            ctx.lineTo(pl.x + Math.cos(a) * rr, pl.y + Math.sin(a) * rr);
          }
          ctx.fill();
          ctx.fillStyle = '#4e1646'; ell(pl.x - 4, pl.y - 5, pl.r * 0.72, pl.r * 0.66);
          ctx.fillStyle = '#12040f';
          for (let i = 0; i < 4; i++) circ(pl.x + Math.cos(i * 1.6 + pl.seed) * pl.r * 0.4, pl.y + Math.sin(i * 1.6 + pl.seed) * pl.r * 0.4, pl.r * 0.1);
          break;
        }
        case 'reactor':
          if (pl.r > 80) {
            ctx.fillStyle = '#1e1610'; circ(pl.x, pl.y, pl.r);
            ctx.strokeStyle = '#5a4430'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r * 0.85, 0, TAU); ctx.stroke();
            ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 6; ctx.setLineDash([14, 14]);
            ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r * 0.97, gameTime * 0.3, gameTime * 0.3 + TAU); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#0c0804'; circ(pl.x, pl.y, pl.r * 0.6);
          } else octagon(pl, '#2a2018', '#3e3024', '#6a4a30');
          break;
        default:
          octagon(pl, '#20232b', '#353a46', '#4c5363');
      }
    }
  }

  function drawWalls() {
    ctx.fillStyle = arena.wall;
    ctx.fillRect(-800, -800, AW + 1600, 800 + WALL);
    ctx.fillRect(-800, AH - WALL, AW + 1600, 800 + WALL);
    ctx.fillRect(-800, 0, 800 + WALL, AH);
    ctx.fillRect(AW - WALL, 0, 800 + WALL, AH);
    ctx.fillStyle = arena.wallPanel;
    for (let x = 0; x < AW; x += 120) { ctx.fillRect(x + 4, 6, 112, WALL - 12); ctx.fillRect(x + 4, AH - WALL + 6, 112, WALL - 12); }
    for (let y = 0; y < AH; y += 120) { ctx.fillRect(6, y + 4, WALL - 12, 112); ctx.fillRect(AW - WALL + 6, y + 4, WALL - 12, 112); }
    ctx.strokeStyle = '#4a505e'; ctx.lineWidth = 4;
    ctx.strokeRect(WALL, WALL, AW - 2 * WALL, AH - 2 * WALL);
  }

  function particleVisible(q, x0, y0, x1, y1) { return q.x > x0 && q.x < x1 && q.y > y0 && q.y < y1; }

  function drawParticlesBase(x0, y0, x1, y1) {
    for (const q of particles) {
      if (q.glow || !particleVisible(q, x0, y0, x1, y1)) continue;
      const f = q.life / q.max;
      switch (q.kind) {
        case 'dot':
          ctx.fillStyle = q.color; ctx.globalAlpha = Math.min(1, f * 1.5);
          circ(q.x, q.y, q.size * (0.5 + f * 0.5));
          break;
        case 'gib':
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
          ctx.fillStyle = q.color; ctx.fillRect(-q.size, -q.size * 0.6, q.size * 2, q.size * 1.2);
          ctx.restore();
          break;
        case 'shell':
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
          ctx.fillStyle = q.color; ctx.globalAlpha = Math.min(1, f * 3); ctx.fillRect(-2.5 * (q.size || 1), -1 * (q.size || 1), 5 * (q.size || 1), 2 * (q.size || 1));
          ctx.restore();
          break;
        case 'smoke':
          ctx.fillStyle = `rgba(${q.color},${(f * 0.35).toFixed(3)})`;
          circ(q.x, q.y, q.size * (1.6 - f * 0.6));
          break;
        case 'after':
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a);
          ctx.globalAlpha = f * 0.35; ctx.fillStyle = '#5ad1ff'; ell(0, 0, 10, 15);
          ctx.restore();
          break;
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawParticlesGlow(x0, y0, x1, y1) {
    for (const q of particles) {
      if (!q.glow || !particleVisible(q, x0 - 200, y0 - 200, x1 + 200, y1 + 200)) continue;
      const f = q.life / q.max;
      switch (q.kind) {
        case 'spark':
          ctx.strokeStyle = q.color; ctx.globalAlpha = f; ctx.lineWidth = q.size;
          ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'fire': {
          const col = f > 0.6 ? '#ffd27a' : f > 0.3 ? '#ff7a1a' : '#a02a0a';
          glow(col, q.x, q.y, q.size * (1.4 - f * 0.4), f);
          break;
        }
        case 'ring':
          ctx.strokeStyle = q.color; ctx.globalAlpha = f; ctx.lineWidth = 3 * f + 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.2 - f), 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'flash':
          glow(q.color, q.x, q.y, q.size, f);
          break;
        case 'ghost': {
          const k = 1 + (1 - f) * 0.45, sz = q.size * k;
          ctx.globalAlpha = f * f * 0.85;
          ctx.drawImage(q.cv, 0, 0, q.size, q.size, q.x - sz / 2, q.y - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
          break;
        }
        case 'ember':
          glow(q.color, q.x, q.y, q.size * 3, f * 0.9);
          ctx.fillStyle = '#fff4d0'; ctx.globalAlpha = f; circ(q.x, q.y, q.size * 0.5); ctx.globalAlpha = 1;
          break;
      }
    }
  }

  function buildLights(x0, y0, x1, y1) {
    lights.length = 0;
    const L = (x, y, r, i, c = WHITE_L, pl = false) => { if (lights.length < 90 && x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r) lights.push({ x, y, r, i, c, pl }); };
    if (player && state !== 'dying' && state !== 'over') {
      L(player.x, player.y, 250, 0.9, SUIT_L, true);
      if (player.muzzle > 0) { const m = muzzlePos(); L(m.x, m.y, 260, 0.85, lc(WEAPONS[player.cur].color, 0.55), true); }
      if (player.overdrive > 0) L(player.x, player.y, 340, 0.4, lc('#ff2a4a'), true);
    }
    for (const q of particles) if (q.kind === 'flash') L(q.x, q.y, q.size * 3, q.life / q.max, lc(q.color));
    for (const b of bullets) if (b.kind === 'rocket') L(b.x, b.y, 120, 0.7, lc('#ff8a2a'));
    let fl = 0;
    for (const b of bullets) if (b.kind === 'flame' && (fl++ % 4 === 0)) L(b.x, b.y, 110, 0.35, lc('#ff7a1a', 0.15));
    for (const v of vents) if (v.pulse > 0.05) L(v.x, v.y, 160 * v.pulse, 0.6 * v.pulse, lc(arena.vent));
    for (const pd of pads) if (pd.st === 'active') L(pd.x, pd.y, 120, 0.4 + (pd.flash > 0 ? 0.4 : 0), lc('#5affc8'));
    for (let i = 0; i < fires.length; i += 3) { const f = fires[i]; L(f.x, f.y, 100, 0.4 * Math.min(1, (f.life / f.max) * 2), lc('#ff7a1a', 0.15)); }
    for (const e of enemies) {
      if (e.burn > 0) L(e.x, e.y, 80, 0.45, lc('#ff7a1a', 0.15));
      else if (isBoss(e)) L(e.x, e.y, 200, 0.4, lc(ET[e.type].color || ET[e.type].eye));
      else if (e.elite) L(e.x, e.y, 100, 0.4, lc('#ffd23a'));
      else if (e.affix) L(e.x, e.y, 100, 0.4, lc(AFFIX[e.affix[0]].color));
      else if (e.type === 'boomer') L(e.x, e.y, 60, e.fuse > 0 ? 0.7 : 0.25, lc('#ffaa22'));
    }
    for (const s of eshots) L(s.x, s.y, 45, 0.35, lc(s.color));
    for (const pk of pickups) L(pk.x, pk.y, pk.kind === 'weapon' ? 110 : 60, 0.5, lc(pk.kind === 'med' ? '#ff4a5a' : pk.kind === 'upgrade' ? '#5ad1ff' : '#ffd23a'));
    for (const b of beams) {
      const f = b.life / b.max, c = lc(b.color);
      if (b.kind === 'bolt') { for (let k = 0; k < b.pts.length; k += 4) L(b.pts[k][0], b.pts[k][1], 120, f * 0.8, c); }
      else for (let k = 0; k <= 4; k++) L(lerp(b.x0, b.x1, k / 4), lerp(b.y0, b.y1, k / 4), 140, f * 0.8, c);
    }
    for (const pl of pools) L(pl.x, pl.y, pl.r * 1.5, 0.28, lc(pl.kind === 'slime' ? '#3aff6a' : pl.kind === 'acid' ? '#b8ff3a' : '#ff9a2a', 0.1));
    for (const e of enemies) if (e.beams) for (const b of e.beams) if (b.on) for (let k = 1; k <= 4; k++) L(e.x + Math.cos(b.a) * k * 130, e.y + Math.sin(b.a) * k * 130, 140, 0.6, lc('#ff7a1e', 0.2));
    for (const sh of shocks) if (sh.r > 0) L(sh.x, sh.y, sh.r + 40, 0.25, lc(sh.color));
    for (const pl of pillars) {
      if (arena.pillar === 'reactor' && pl.r > 80) L(pl.x, pl.y, 360, 0.75, lc('#ff8a1a', 0.15));
      else if (arena.pillar === 'tank') L(pl.x, pl.y, 110, 0.4, lc('#3affb0'));
      else if (arena.pillar === 'sac') L(pl.x, pl.y, 90, 0.18, lc('#ff3af0'));
    }
    if (player) for (const d of player.drones) L(d.x, d.y, 70, 0.35, lc('#5affff'));
  }

  // Colored light map, multiplied over the world. Ambient is tinted per arena; every light
  // adds its own color. The soldier's suit lamp, flashlight and muzzle flash go to a
  // separate layer first so pillars can cut real shadows out of them.
  const plc = document.createElement('canvas');
  const pctx = plc.getContext('2d');
  function playerLightAt(x, y) {
    const p = player, d = Math.hypot(x - p.x, y - p.y);
    let f = Math.max(0, 1 - d / 250) * 0.9;
    if (Math.abs(angDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < 0.48) {
      const t = d / 720;
      f += t < 0.55 ? lerp(0.95, 0.75, t / 0.55) : t < 1 ? lerp(0.75, 0, (t - 0.55) / 0.45) : 0;
    }
    return Math.min(1, f);
  }
  function lightGrad(g, l) {
    const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    gr.addColorStop(0, `rgba(${l.c},${Math.min(1, l.i).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${l.c},0)`);
    g.fillStyle = gr;
    g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  function drawLighting(tx, ty) {
    const dw = dark.width, dh = dark.height;
    if (plc.width !== dw || plc.height !== dh) { plc.width = dw; plc.height = dh; }
    const lvl = (1 - [0.8, 0.7, 0.56][settings.bright] + beatPulse * 0.07 + snarePulse * 0.04) * modDark;
    const am = arena.amb || [1, 1, 1], m = [am[0] * (1 + modRed * 0.45), am[1] * (1 - modRed * 0.3), am[2] * (1 - modRed * 0.35)];
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = `rgb(${m.map(v => Math.round(clamp(lvl * v * 255, 0, 255))).join(',')})`;
    dctx.fillRect(0, 0, dw, dh);
    dctx.globalCompositeOperation = 'lighter';
    dctx.setTransform(DS * VIEW, 0, 0, DS * VIEW, DS * tx, DS * ty);
    for (const l of lights) if (!l.pl) lightGrad(dctx, l);

    if (player && state !== 'dying' && state !== 'over') {
      const p = player;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, dw, dh);
      pctx.setTransform(DS * VIEW, 0, 0, DS * VIEW, DS * tx, DS * ty);
      pctx.globalCompositeOperation = 'lighter';
      for (const l of lights) if (l.pl) lightGrad(pctx, l);
      if (state === 'play') {
        const R = 720, half = 0.48;
        const g = pctx.createRadialGradient(p.x, p.y, 20, p.x, p.y, R);
        g.addColorStop(0, `rgba(${SUIT_L},0.95)`); g.addColorStop(0.55, `rgba(${SUIT_L},0.75)`); g.addColorStop(1, `rgba(${SUIT_L},0)`);
        pctx.fillStyle = g;
        pctx.beginPath(); pctx.moveTo(p.x, p.y); pctx.arc(p.x, p.y, R, p.angle - half, p.angle + half); pctx.closePath(); pctx.fill();
      }
      // pillar shadows: the quad behind each pillar's tangent points, pushed far out
      pctx.globalCompositeOperation = 'destination-out';
      pctx.fillStyle = '#000';
      const FAR = 2400;
      for (const pl of pillars) {
        const dx = pl.x - p.x, dy = pl.y - p.y, d = Math.hypot(dx, dy);
        if (d <= pl.r + 4 || d > 900) continue;
        const a = Math.atan2(dy, dx), h = Math.asin(pl.r / d), tl = Math.sqrt(d * d - pl.r * pl.r);
        const a1 = a - h, a2 = a + h;
        pctx.beginPath();
        pctx.moveTo(p.x + Math.cos(a1) * tl, p.y + Math.sin(a1) * tl);
        pctx.lineTo(p.x + Math.cos(a1) * FAR, p.y + Math.sin(a1) * FAR);
        pctx.lineTo(p.x + Math.cos(a2) * FAR, p.y + Math.sin(a2) * FAR);
        pctx.lineTo(p.x + Math.cos(a2) * tl, p.y + Math.sin(a2) * tl);
        pctx.closePath(); pctx.fill();
      }
      // pillar tops stay lit: refill each disk with the lamp's strength at its centre
      for (const pl of pillars) {
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d <= pl.r + 4 || d > 900) continue;
        pctx.globalCompositeOperation = 'destination-out';
        pctx.beginPath(); pctx.arc(pl.x, pl.y, pl.r, 0, TAU); pctx.fill();
        pctx.globalCompositeOperation = 'lighter';
        pctx.fillStyle = `rgba(${SUIT_L},${(playerLightAt(pl.x, pl.y) * 0.85).toFixed(3)})`;
        pctx.beginPath(); pctx.arc(pl.x, pl.y, pl.r, 0, TAU); pctx.fill();
        pctx.fillStyle = '#000';
      }
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      if (canFilter) dctx.filter = 'blur(1.5px)';
      dctx.drawImage(plc, 0, 0);
      dctx.filter = 'none';
    }
    dctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(dark, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function renderWorld() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    shX = (Math.random() * 2 - 1) * shake * 0.5 * shakeMul();
    shY = (Math.random() * 2 - 1) * shake * 0.5 * shakeMul();
    const tx = W / 2 + shX + camKick.x * VIEW - cam.x * VIEW, ty = H / 2 + shY + camKick.y * VIEW - cam.y * VIEW;
    const setWorld = () => ctx.setTransform(DPR * VIEW, 0, 0, DPR * VIEW, DPR * tx, DPR * ty);
    const x0 = cam.x - W / 2 / VIEW - 60, x1 = cam.x + W / 2 / VIEW + 60;
    const y0 = cam.y - H / 2 / VIEW - 60, y1 = cam.y + H / 2 / VIEW + 60;
    const vis = (o, m) => o.x > x0 - m && o.x < x1 + m && o.y > y0 - m && o.y < y1 + m;
    setWorld();

    const sx = clamp(x0, 0, AW), sy = clamp(y0, 0, AH), ex = clamp(x1, 0, AW), ey = clamp(y1, 0, AH);
    if (ex > sx && ey > sy) ctx.drawImage(floor, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

    for (const pk of pickups) if (vis(pk, 40)) drawPickup(pk);
    drawParticlesBase(x0, y0, x1, y1);
    drawTempPools();
    for (const f of fires) {
      if (!vis(f, f.r)) continue;
      const k = f.life / f.max;
      ctx.globalAlpha = 0.45 * Math.min(1, k * 2);
      ctx.fillStyle = '#3a1004'; ell(f.x, f.y, f.r * 0.8, f.r * 0.6);
      ctx.fillStyle = '#c0400a'; ctx.globalAlpha *= 0.7; ell(f.x, f.y, f.r * 0.45, f.r * 0.32);
      ctx.globalAlpha = 1;
    }
    for (const pd of pads) if (vis(pd, 80)) drawPad(pd);
    drawPlayerRing(false);
    const actors = settings.fx > 0;
    if (actors) { beginActors(); setWorld(); }
    for (const b of barrels) if (!b.dead && vis(b, 140)) drawBarrel(b);
    for (const pd of pads) if (vis(pd, 80)) drawTurret(pd);
    for (const e of enemies) if (!isBoss(e) && !e.fly && vis(e, e.r * 2)) drawEnemy(e);
    for (const e of enemies) if (isBoss(e) && vis(e, e.r * 2.5)) drawEnemy(e);
    if (player) drawPlayer();
    if (actors) { endActors(tx, ty); setWorld(); }
    for (const sh of eshots) if (sh.lob && vis(sh, 40)) drawLob(sh);
    drawPillars();
    for (const e of enemies) if (e.fly && vis(e, e.r * 2)) drawEnemy(e);
    drawWalls();

    buildLights(x0, y0, x1, y1);
    drawLighting(tx, ty);
    if (actors) { liftActors(); drawRim(tx, ty); }

    // ---- additive glow pass (drawn over the darkness so it pops)
    setWorld();
    ctx.globalCompositeOperation = 'lighter';
    const na = 0.22 + beatPulse * 0.45;
    ctx.strokeStyle = `rgba(${arena.neonA},${na.toFixed(3)})`; ctx.lineWidth = 3;
    ctx.strokeRect(WALL + 3, WALL + 3, AW - 2 * WALL - 6, AH - 2 * WALL - 6);
    ctx.strokeStyle = `rgba(${arena.neonB},${(0.12 + snarePulse * 0.35).toFixed(3)})`; ctx.lineWidth = 2;
    ctx.strokeRect(WALL + 9, WALL + 9, AW - 2 * WALL - 18, AH - 2 * WALL - 18);
    for (const v of vents) if (vis(v, 120)) glow(arena.vent, v.x, v.y, 46 + v.pulse * 80, 0.18 + v.pulse * 0.8);
    pillars.forEach((pl, i) => {
      if (!vis(pl, 60)) return;
      const na2 = (0.35 + beatPulse * 0.5).toFixed(3);
      if (arena.pillar === 'tank') { glow('#3affb0', pl.x, pl.y, pl.r * 1.3, 0.25 + beatPulse * 0.2); return; }
      if (arena.pillar === 'sac') { glow('#ff3af0', pl.x, pl.y, pl.r * 1.2, 0.12 + beatPulse * 0.15); return; }
      if (arena.pillar === 'reactor' && pl.r > 80) {
        glow('#ff8a1a', pl.x, pl.y, pl.r * 1.1, 0.55 + beatPulse * 0.35);
        glow('#ffe08a', pl.x, pl.y, pl.r * 0.45, 0.8);
        return;
      }
      ctx.strokeStyle = i % 2 ? `rgba(${arena.neonB},${na2})` : `rgba(${arena.neonA},${na2})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(pl.x - 3, pl.y - 4, pl.r * 0.55, 0, TAU); ctx.stroke();
    });
    for (const pl of pools) {
      if (!vis(pl, pl.r)) continue;
      const c = pl.kind === 'slime' ? '#3aff6a' : pl.kind === 'acid' ? '#b8ff3a' : '#ff9a2a';
      glow(c, pl.x, pl.y, pl.r * 1.15, 0.16 + beatPulse * 0.1 + Math.sin(gameTime * 2 + pl.x) * 0.04);
      if (Math.random() < 0.08) part({ kind: 'ring', x: pl.x + rand(-pl.r, pl.r) * 0.6, y: pl.y + rand(-pl.r, pl.r) * 0.6, vx: 0, vy: 0, life: 0.4, size: rand(4, 9), color: c, glow: true });
    }
    for (const f of fires) {
      if (!vis(f, f.r * 2)) continue;
      const k = f.life / f.max;
      glow(k > 0.5 ? '#ff8a2a' : '#c0300a', f.x, f.y, f.r * 1.5, (0.3 + Math.sin(gameTime * 17 + f.ph) * 0.08) * Math.min(1, k * 2.5));
    }
    const BC = BARREL[arena.style];
    for (const b of barrels) if (!b.dead && b.drop <= 0 && vis(b, 40)) glow(BC.color, b.x, b.y, 24, 0.22 + Math.sin(gameTime * 3 + b.ph) * 0.08 + (b.hp < b.max ? 0.3 : 0));
    for (const pd of pads) {
      if (!vis(pd, 120)) continue;
      const c = pd.st === 'cool' ? '#6a6a88' : '#5affc8';
      glow(c, pd.x, pd.y, pd.r * 1.6, pd.st === 'active' ? 0.35 + pd.flash * 6 : pd.st === 'ready' ? 0.18 + beatPulse * 0.15 + pd.prog * 0.4 : 0.06);
      ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = c;
      const near = player && Math.hypot(player.x - pd.x, player.y - pd.y) < 260;
      const label = pd.st === 'active' ? `TURRET ${Math.ceil(pd.t)}S` : pd.st === 'cool' ? `RECHARGING ${Math.ceil(pd.t)}S` : near ? 'STAND HERE TO DEPLOY' : 'TURRET';
      ctx.globalAlpha = pd.st === 'ready' && !near ? 0.6 : 0.9; ctx.fillText(label, pd.x, pd.y - pd.r - 14); ctx.globalAlpha = 1;
    }
    for (const pl of pillars) if (pl.leak > 0 && vis(pl, pl.r * 3)) {
      const c = arena.style === 'lab' ? '#9ae6ff' : arena.style === 'organic' ? '#ff4ad0' : '#ffe08a';
      glow(c, pl.x, pl.y, pl.r * (1.4 + (Math.sin(gameTime * 30) > 0 ? 0.4 : 0)), 0.8);
    }
    for (const b of booms) {
      if (!b.hostile || !vis(b, b.R)) continue;
      const f = 1 - b.t / b.max, blink = Math.sin(f * f * 40) > 0;
      ctx.strokeStyle = b.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.35 + f * 0.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.R, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, b.R * f, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      glow(b.color, b.x, b.y, 30 + f * 30, blink ? 0.9 : 0.4);
    }
    for (const pk of pickups) {
      if (!vis(pk, 60)) continue;
      const c = pk.kind === 'gear' ? gearInfo(pk.gk).color : pk.kind === 'power' ? POWER[pk.wi].color : { med: '#ff4a5a', ammo: '#ffd23a', weapon: '#ffd23a', upgrade: '#5ad1ff' }[pk.kind];
      glow(c, pk.x, pk.y, pk.kind === 'weapon' ? 46 : 28, 0.3 + Math.sin(pk.t * 5) * 0.12);
    }
    for (const b of bullets) {
      if (!vis(b, 40)) continue;
      if (b.kind === 'saw') {
        glow(b.color, b.x, b.y, 18, 0.4);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.color; ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rr = i % 2 ? b.r * 0.6 : b.r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#203000'; circ(0, 0, 2.5);
        ctx.restore();
        continue;
      }
      if (b.kind === 'flame') {
        const f = b.life / b.max;
        const fresh = clamp((1 - f) * 4, 0, 1); // ramps in over the first quarter of its life
        glow(f > 0.6 ? '#ffd07a' : f > 0.3 ? '#ff8a2a' : '#c0300a', b.x, b.y, b.r * 2, Math.min(0.8, f + 0.15) * (0.3 + fresh * 0.7));
      } else if (b.kind === 'rocket') {
        const a = Math.atan2(b.vy, b.vx);
        glow('#ff8a2a', b.x - Math.cos(a) * 10, b.y - Math.sin(a) * 10, 26, 0.9);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        ctx.fillStyle = '#ffe0c0'; ctx.fillRect(-7, -3, 14, 6);
        ctx.restore();
      } else {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const tl = Math.min(30, sp * 0.025);
        ctx.strokeStyle = b.color; ctx.lineCap = 'round';
        ctx.globalAlpha = 0.35; ctx.lineWidth = b.r * 2.6;
        ctx.beginPath(); ctx.moveTo(b.x - (b.vx / sp) * tl * 1.4, b.y - (b.vy / sp) * tl * 1.4); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = b.r * 0.9;
        ctx.beginPath(); ctx.moveTo(b.x - (b.vx / sp) * tl, b.y - (b.vy / sp) * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (const s of eshots) {
      if (s.lob) {
        const f = Math.min(1, s.t / s.dur), R = s.lob === 'gas' ? 65 : 70;
        ctx.strokeStyle = s.lob === 'gas' ? `rgba(160,255,60,${(0.3 + f * 0.5).toFixed(3)})` : `rgba(255,90,40,${(0.3 + f * 0.6).toFixed(3)})`;
        ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(s.tx, s.ty, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(s.tx, s.ty, R * f, 0, TAU); ctx.stroke();
        glow(s.color, s.x, s.y - lobHeight(s), 22, 0.8);
        continue;
      }
      if (!vis(s, 30)) continue;
      glow(s.color, s.x, s.y, s.r * 3, 0.9);
      ctx.fillStyle = '#f0ffd0'; circ(s.x, s.y, s.r * 0.5);
    }
    for (const e of enemies) {
      if (!vis(e, e.r * 3)) continue;
      const T = ET[e.type];
      const sc = e.spawnT > 0 ? 1 - e.spawnT / 0.45 : 1;
      let ea = 1;
      if (e.type === 'phantom') ea = e.cloaked ? Math.max(0.25, phantomAlpha(e) * 1.5) : 1;
      if (e.under) continue;
      if (e.type === 'warden') {
        ctx.strokeStyle = e.shieldFlash > 0 ? 'rgba(255,255,255,0.9)' : 'rgba(90,200,255,0.45)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.45, e.angle - 1.05, e.angle + 1.05); ctx.stroke();
      }
      if (e.type === 'egg') { if (e.hatch < 1.2) glow('#ffe060', e.x, e.y, e.r * 2, 0.4 + Math.sin(e.t * 30) * 0.2); continue; }
      for (const [ex, ey] of eyePositions(e)) {
        glow(T.eye, ex, ey, (T.boss ? 12 : 7) * sc, 0.9 * ea);
        ctx.fillStyle = T.eye; ctx.globalAlpha = ea; circ(ex, ey, (T.boss ? 3 : 1.6) * sc); ctx.globalAlpha = 1;
      }
      if (e.elite && !T.boss) glow('#ffd23a', e.x, e.y, e.r * 2.6, 0.32 + Math.sin(e.t * 6) * 0.14);
      if (e.affix) {
        const c = AFFIX[e.affix[0]].color;
        if (!e.elite) glow(c, e.x, e.y, e.r * 2.4, 0.26 + Math.sin(e.t * 6) * 0.1);
        if (hasAff(e, 'commander')) {
          ctx.strokeStyle = c; ctx.globalAlpha = 0.16 + beatPulse * 0.14; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.lineDashOffset = -e.t * 20;
          ctx.beginPath(); ctx.arc(e.x, e.y, 240, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        // name tag
        const tag = (e.bounty ? 'BOUNTY · ' : '') + e.affix.map(k => AFFIX[k].name).join(' ');
        ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = e.bounty ? MODS.bounty.color : c; ctx.globalAlpha = 0.9;
        ctx.fillText(tag, e.x, e.y - e.r * 1.4 - 12); ctx.globalAlpha = 1;
      }
      if (e.rally) glow(AFFIX.commander.color, e.x, e.y, e.r * 1.7, 0.18);
      if (e.frozeT > 0) glow('#9ae6ff', e.x, e.y, e.r * 1.9, 0.4);
      if (e.type === 'spitter') glow('#b04dff', e.x - Math.cos(e.angle) * e.r * 0.6, e.y - Math.sin(e.angle) * e.r * 0.6, e.r * 1.1, 0.2 + Math.sin(e.t * 5) * 0.08);
      if (e.type === 'boomer') glow('#ffaa22', e.x, e.y, e.r * 2.2, e.fuse > 0 ? 0.9 : 0.3);
      if (e.type === 'queen') glow('#ff3af0', e.x - Math.cos(e.angle) * e.r * 1.1, e.y - Math.sin(e.angle) * e.r * 1.1, e.r * 1.6, 0.35 + Math.sin(e.t * 4) * 0.12);
      if (e.burn > 0) glow('#ff7a1a', e.x, e.y, e.r * 2, 0.45);
      if (e.st === 'wind') glow(e.type === 'brute' ? '#ff5a00' : '#5affff', e.x, e.y, e.r * 2.4, 0.5);
    }
    for (const sh of shocks) {
      if (sh.r <= 0) continue;
      const f = 1 - sh.r / sh.max;
      ctx.strokeStyle = sh.color; ctx.globalAlpha = 0.25 + f * 0.6; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.globalAlpha = f;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const e of enemies) {
      if (e.type === 'specimen') glow('#7aff5a', e.x, e.y, e.r * 1.6, 0.25 + Math.sin(e.t * 3) * 0.1);
      if (e.type === 'titan' && e.st === 'barrage') glow('#ffb02a', e.x, e.y, e.r * 2, 0.4);
      if (e.type === 'behemoth') {
        glow('#ff7a1a', e.x, e.y, e.r * 1.5, (e.st === 'wind' ? 0.8 : 0.35) + beatPulse * 0.2);
        if (e.beams) for (const b of e.beams) {
          const x1 = e.x + Math.cos(b.a) * 560, y1 = e.y + Math.sin(b.a) * 560;
          ctx.lineCap = 'round';
          if (!b.on) { ctx.strokeStyle = 'rgba(255,60,30,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]); continue; }
          ctx.strokeStyle = 'rgba(255,120,30,0.55)'; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = '#ffe8a0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(x1, y1); ctx.stroke();
          if (Math.random() < 0.5) sparks(x1 - Math.cos(b.a) * rand(0, 500), y1 - Math.sin(b.a) * rand(0, 500), '#ffb020', 1, 120);
        }
      }
    }
    for (const b of beams) {
      const f = b.life / b.max;
      ctx.lineCap = 'round';
      const path = () => {
        ctx.beginPath();
        if (b.kind === 'bolt') { ctx.moveTo(b.pts[0][0], b.pts[0][1]); for (const [x, y] of b.pts) ctx.lineTo(x, y); }
        else { ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); }
      };
      ctx.lineJoin = 'round';
      ctx.strokeStyle = b.color; ctx.globalAlpha = f * 0.6; ctx.lineWidth = b.w * 2 * f + 2;
      path(); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = f; ctx.lineWidth = (b.kind === 'bolt' ? 1.5 : 3) * f + 1;
      path(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawParticlesGlow(x0, y0, x1, y1);
    drawPlayerGlow();
    drawPlayerRing(true);
    if (player && state === 'play') {
      const p = player;
      drawWeaponFx(p);
      const vx = p.x + Math.cos(p.angle) * 4, vy = p.y + Math.sin(p.angle) * 4;
      glow('#7ff6ff', vx, vy, 10, 0.6);
      if (p.overdrive > 0) glow('#ff2a4a', p.x, p.y, 44, 0.3 + Math.sin(gameTime * 20) * 0.1);
    }
    ctx.globalCompositeOperation = 'source-over';

    if (settings.fx > 0) drawRipples(tx, ty);

    // floating texts on top
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const q of particles) {
      if (q.kind !== 'text') continue;
      const f = q.life / q.max;
      ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = font(q.size);
      ctx.fillStyle = '#000'; ctx.fillText(q.text, q.x + 2, q.y + 2);
      ctx.fillStyle = q.color; ctx.fillText(q.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
  }

  // ======================================================================= render: HUD
  function panel(x, y, w, h, border) {
    ctx.fillStyle = 'rgba(6,4,16,0.72)'; ctx.fillRect(x, y, w, h);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  }
  function text(str, x, y, size, color, align = 'left', base = 'top', shadow = true) {
    ctx.font = font(size); ctx.textAlign = align; ctx.textBaseline = base;
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillText(str, x + 2, y + 2); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }

  // ---------------------------------------------------------------- HUD kit
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  // tech panel: gradient glass, chamfered corner, accent edge fading out to the right
  function hudPanel(x, y, w, h, accent, cut = 10) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w - cut, y); ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x + cut, y + h); ctx.lineTo(x, y + h - cut); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(24,12,48,0.84)'); g.addColorStop(1, 'rgba(6,4,18,0.74)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    if (!accent) return;
    const ag = ctx.createLinearGradient(x, 0, x + w, 0);
    ag.addColorStop(0, hexA(accent, 0.95)); ag.addColorStop(0.6, hexA(accent, 0.35)); ag.addColorStop(1, hexA(accent, 0));
    ctx.fillStyle = ag; ctx.fillRect(x, y, w - cut, 2);
    // accent stroke along the bottom-left chamfer
    ctx.strokeStyle = hexA(accent, 0.8); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 0.75, y + h - cut - 4); ctx.lineTo(x + 0.75, y + h - cut); ctx.lineTo(x + cut, y + h - 0.75); ctx.lineTo(x + cut + 4, y + h - 0.75); ctx.stroke();
  }
  // UI-font text with optional tracking (letter spacing) and a soft drop shadow
  function utext(str, x, y, size, color, align = 'left', base = 'top', wt = 600, track = 0, shadow = true) {
    ctx.font = ufont(size, wt); ctx.textAlign = align; ctx.textBaseline = base;
    if (track) ctx.letterSpacing = track + 'px';
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(str, x + 1, y + 1); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    if (track) ctx.letterSpacing = '0px';
  }
  // smooth bar: dark track, lingering "lost" trail, gradient fill, gloss line and ticks
  function hudBar(x, y, w, h, frac, trail, color, ticks = 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, h);
    if (trail > frac) { ctx.fillStyle = 'rgba(255,90,110,0.85)'; ctx.fillRect(x + w * frac, y, w * (trail - frac), h); }
    if (frac > 0) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, hexA(color, 0.55)); g.addColorStop(1, color);
      ctx.fillStyle = g; ctx.fillRect(x, y, w * frac, h);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, w * frac, Math.max(1, h * 0.22));
    }
    if (ticks) {
      ctx.fillStyle = 'rgba(6,4,18,0.75)';
      for (let i = 1; i < ticks; i++) ctx.fillRect(x + Math.round((w * i) / ticks) - 1, y, 2, h);
    }
  }
  function newHud() {
    return { hpTrail: 1, hpHold: 0, lastHp: -1, scoreShown: 0, scorePop: 0, lastScore: 0, multPop: 0, lastMult: 1,
      slotX: {}, slotT: {}, raise: {}, owned: null, bossTrail: 1 };
  }
  let hud = newHud();

  function drawHUD(rdt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const p = player;
    const small = W < 900;
    // notch / home-indicator insets in UI units; tap targets are rebuilt every frame
    const SL = safe.l / UIS, SR = safe.r / UIS, SB = safe.b / UIS;
    hud.callRect = null; hud.slotRects = [];

    // vignettes
    if (hurtFlash > 0 || (p.hp < 35 && state === 'play')) {
      const low = p.hp < 35 && state === 'play' ? (0.25 + Math.sin(gameTime * 8) * 0.12) : 0;
      const a = Math.max(hurtFlash * 0.6, low);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255,0,30,0)'); g.addColorStop(1, `rgba(255,0,30,${a.toFixed(3)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (p.overdrive > 0) {
      ctx.strokeStyle = `rgba(255,40,70,${(0.35 + Math.sin(gameTime * 14) * 0.15).toFixed(3)})`;
      ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8);
    }
    if (p.chrono > 0) { ctx.fillStyle = 'rgba(70,160,255,0.08)'; ctx.fillRect(0, 0, W, H); }
    if (p.aegis > 0) { ctx.strokeStyle = 'rgba(255,210,58,0.35)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6); }

    // ---- vitals card
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    if (hud.lastHp < 0) { hud.lastHp = p.hp; hud.hpTrail = frac; }
    if (p.hp < hud.lastHp) hud.hpHold = 0.45;
    hud.lastHp = p.hp;
    if (frac >= hud.hpTrail) hud.hpTrail = frac;
    else if ((hud.hpHold -= rdt) <= 0) hud.hpTrail = Math.max(frac, hud.hpTrail - rdt * 0.9);
    const gearOwned = GEAR_KEYS.filter(k => p.gear[k] > 0);
    const perksOwned = PERK_KEYS.filter(k => p.perk[k] > 0);
    const powers = Object.keys(POWER).filter(k => p[k] > 0 && POWER[k].dur > 0);
    const cw = small ? 240 : 290;
    // lay out gear chips, perk chips and timed power-ups left to right, wrapping into rows
    const chips = [];
    {
      const maxX = cw - 24;
      let cx = 0, row = 0;
      const put = (w, item, gapBefore = 0) => {
        if (cx && cx + gapBefore + w > maxX) { cx = 0; row++; } else cx += cx ? gapBefore : 0;
        chips.push({ ...item, x: cx, row, w });
        cx += w + 4;
      };
      for (const k of gearOwned) put(24, { kind: 'gear', k });
      perksOwned.forEach((k, i) => put(24, { kind: 'perk', k }, i === 0 && gearOwned.length ? 6 : 0));
      ctx.font = ufont(11, 700); ctx.letterSpacing = '1px';
      powers.forEach((k, i) => put(Math.min(maxX, ctx.measureText(POWER[k].name).width + 18), { kind: 'power', k }, i === 0 && chips.length ? 6 : 0));
      ctx.letterSpacing = '0px';
    }
    const rows = chips.length ? chips[chips.length - 1].row + 1 : 0;
    const ch = 64 + (rows ? rows * 28 + 4 : 0);
    const jit = hurtFlash > 0.05 ? Math.sin(gameTime * 90) * hurtFlash * 3 : 0;
    const hx = 16 + SL + jit, hy = 16;
    hudPanel(hx, hy, cw, ch, '#ff4f8a');
    const hc = frac > 0.6 ? '#3dff9a' : frac > 0.3 ? '#ffd23a' : (Math.sin(gameTime * 12) > 0 ? '#ff3a4a' : '#c01a30');
    utext('VITALS', hx + 12, hy + 9, 11, '#ff8ab0', 'left', 'top', 700, 2);
    text(String(Math.ceil(p.hp)), hx + cw - 14 - (p.maxHp > 100 ? 34 : 0), hy + 8, 13, hc, 'right');
    if (p.maxHp > 100) utext(`/${p.maxHp}`, hx + cw - 14, hy + 9, 11, '#7a9a8a', 'right', 'top', 600);
    const bx = hx + 12, bwid = cw - 24;
    if (p.shieldMax > 0) {
      const sf = p.shield / p.shieldMax;
      ctx.fillStyle = 'rgba(90,209,255,0.14)'; ctx.fillRect(bx, hy + 27, bwid, 3);
      ctx.fillStyle = p.shieldHit > 0 ? '#ffffff' : '#5ad1ff'; ctx.fillRect(bx, hy + 27, bwid * sf, 3);
    }
    hudBar(bx, hy + 31, bwid, 12, frac, hud.hpTrail, hc, 10);
    // dash
    const dr = clamp(1 - p.dashCd / (1.0 - 0.15 * p.gear.boots), 0, 1);
    utext('DASH', bx, hy + 49, 10, dr >= 1 ? '#7ae0ff' : '#4a6a7a', 'left', 'top', 700, 2);
    hudBar(bx + 42, hy + 52, 70, 4, dr, 0, dr >= 1 ? '#5ad1ff' : '#2a6a8a');
    if (dr >= 1) utext('READY', bx + 120, hy + 49, 10, '#5ad1ff', 'left', 'top', 600, 1);
    // gear chips, perk chips, timed power-ups
    for (const c of chips) {
      const gx = bx + c.x, gy = hy + 64 + c.row * 28;
      if (c.kind === 'gear') {
        const G = GEAR[c.k];
        ctx.fillStyle = hexA(G.color, 0.1); ctx.fillRect(gx, gy, 24, 24);
        ctx.strokeStyle = hexA(G.color, 0.8); ctx.lineWidth = 1; ctx.strokeRect(gx + 0.5, gy + 0.5, 23, 23);
        text(G.icon, gx + 12, gy + 6, 9, G.color, 'center', 'top', false);
        for (let l = 0; l < G.max; l++) { ctx.fillStyle = l < p.gear[c.k] ? G.color : 'rgba(255,255,255,0.15)'; ctx.fillRect(gx + 2 + l * 5, gy + 19, 4, 2); }
      } else if (c.kind === 'perk') {
        // perk chips have clipped corners and a charge bar where the perk has one
        const P = PERKS[c.k], lv = p.perk[c.k];
        ctx.beginPath(); ctx.moveTo(gx + 5, gy); ctx.lineTo(gx + 24, gy); ctx.lineTo(gx + 24, gy + 19); ctx.lineTo(gx + 19, gy + 24); ctx.lineTo(gx, gy + 24); ctx.lineTo(gx, gy + 5); ctx.closePath();
        ctx.fillStyle = hexA(P.color, 0.16); ctx.fill();
        ctx.strokeStyle = hexA(P.color, 0.9); ctx.lineWidth = 1; ctx.stroke();
        text(P.icon, gx + 12, gy + 6, 9, P.color, 'center', 'top', false);
        for (let l = 0; l < P.max; l++) { ctx.fillStyle = l < lv ? P.color : 'rgba(255,255,255,0.15)'; ctx.fillRect(gx + 3 + l * 5, gy + 19, 4, 2); }
        let charge = -1;
        if (c.k === 'static') charge = p.staticN / (lv > 1 ? 8 : 12);
        else if (c.k === 'frenzy') charge = frenzyBonus() / (lv > 1 ? 0.5 : 0.3);
        if (charge >= 0) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(gx + 21, gy + 3, 2, 14); ctx.fillStyle = P.color; ctx.fillRect(gx + 21, gy + 3 + 14 * (1 - charge), 2, 14 * charge); }
      } else {
        const P = POWER[c.k];
        ctx.fillStyle = hexA(P.color, 0.14); ctx.fillRect(gx, gy, c.w, 24);
        utext(P.name, gx + 9, gy + 4, 11, P.color, 'left', 'top', 700, 1);
        hudBar(gx + 4, gy + 19, c.w - 8, 2, clamp(p[c.k] / P.dur, 0, 1), 0, P.color);
      }
    }

    // ---- wave header
    const wsz = (small ? 15 : 21) + beatPulse * 2;
    const wtxt = wave > 0 ? `WAVE ${wave}` : 'GET READY';
    ctx.font = font(wsz); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(18,0,42,0.9)'; ctx.fillText(wtxt, W / 2 + 3, 17);
    const wg = ctx.createLinearGradient(0, 14, 0, 14 + wsz);
    wg.addColorStop(0, '#ffe7a0'); wg.addColorStop(0.5, '#ff6a8a'); wg.addColorStop(1, '#c04dff');
    ctx.fillStyle = wg; ctx.fillText(wtxt, W / 2, 14);
    const sy0 = 22 + wsz;
    if (state === 'play') {
      if (waveActive) {
        const rem = spawnQueue.length + enemies.length;
        if (hunt) utext(`LAST ${rem}  ·  HUNT THEM DOWN`, W / 2, sy0, 13, Math.sin(gameTime * 8) > 0 ? '#ffd23a' : '#ff8a3a', 'center', 'top', 700, 2);
        else utext(`${rem} HOSTILES`, W / 2, sy0, 13, '#c9b8ff', 'center', 'top', 600, 3);
        if (waveMod) {
          const M = MODS[waveMod], bt = enemies.find(e => e.bounty && !e.dead);
          const line = bt ? `BOUNTY  ·  ${Math.ceil(bt.bountyT)}S` : M.name;
          const urgent = bt && bt.bountyT < 10 && Math.sin(gameTime * 10) > 0;
          utext(line, W / 2, sy0 + 17, 12, urgent ? '#ffffff' : M.color, 'center', 'top', 700, 3);
        }
      } else if (interTimer > 0) {
        utext(`NEXT WAVE IN ${Math.ceil(interTimer)}`, W / 2, sy0, 13, '#7cff9a', 'center', 'top', 600, 3);
        if (wave > 0) {
          const lbl = `${touch.using ? 'TAP' : pad.connected && pad.using ? '[X]' : '[F]'}  BRING IT ON${interTimer >= 2.5 ? '  ·  EARN A POWER-UP' : ''}`;
          if (touch.using && !relo) {
            // a real button on touch screens
            ctx.font = ufont(11, 700); ctx.letterSpacing = '2px';
            const tw = ctx.measureText(lbl).width; ctx.letterSpacing = '0px';
            hud.callRect = { x: W / 2 - tw / 2 - 16, y: sy0 + 9, w: tw + 32, h: 30 };
            hudPanel(hud.callRect.x, hud.callRect.y, hud.callRect.w, hud.callRect.h, '#ffd23a', 8);
            utext(lbl, W / 2, sy0 + 18, 11, '#ffd23a', 'center', 'top', 700, 2);
          } else utext(lbl, W / 2, sy0 + 17, 11, '#ffd23a', 'center', 'top', 700, 2);
        }
      }
    }

    // ---- score card
    if (score > hud.lastScore) hud.scorePop = 1;
    hud.lastScore = score;
    hud.scoreShown += (score - hud.scoreShown) * Math.min(1, rdt * 9);
    if (Math.abs(score - hud.scoreShown) < 1) hud.scoreShown = score;
    hud.scorePop = Math.max(0, hud.scorePop - rdt * 4);
    if (mult > hud.lastMult) hud.multPop = 1;
    hud.lastMult = mult;
    hud.multPop = Math.max(0, hud.multPop - rdt * 3);
    const sw2 = small ? 172 : 206, sx = W - 16 - SR - sw2, sy = 16, sh = 62;
    hud.rightBottom = sy + sh; // the touch pause button sits under the right-hand cards
    hudPanel(sx, sy, sw2, sh, '#5ad1ff');
    utext('SCORE', sx + 12, sy + 9, 11, '#7ae0ff', 'left', 'top', 700, 2);
    const sc = String(Math.round(hud.scoreShown)).padStart(8, '0');
    text(sc, sx + sw2 - 14, sy + 24, small ? 13 : 16, hud.scorePop > 0.5 ? '#fff6c8' : '#ffffff', 'right');
    utext(`KILLS ${kills}`, sx + 12, sy + 44, 11, '#9a9ab8', 'left', 'top', 600, 1);
    if (mult > 1) {
      const mc = mult >= 6 ? '#ff3af0' : mult >= 3 ? '#ffd23a' : '#7cff9a';
      const ms = 12 * (1 + hud.multPop * 0.6 + beatPulse * 0.12);
      ctx.save();
      ctx.translate(sx + sw2 - 14, sy + 49);
      text(`x${mult}`, 0, 0, ms, mc, 'right', 'middle');
      ctx.restore();
      utext(`+${Math.round(comboBonus() * 100)}% DMG`, sx + sw2 - 62, sy + 44, 11, mc, 'right', 'top', 700, 1);
      const cf = clamp(comboTimer / 1.8, 0, 1);
      ctx.fillStyle = hexA(mc, 0.85); ctx.fillRect(sx + 1, sy + sh - 3, (sw2 - 11) * cf, 2);
    }

    // ---- minimap (left out on short touch screens, where that corner belongs to the buttons)
    if (!small && !(TOUCH && H < 640)) {
      const mw = sw2, mh = (mw * AH) / AW, mx = sx, my = sy + sh + 8;
      hud.rightBottom = my + mh + 20;
      hudPanel(mx, my, mw, mh, '#ff3af0', 8);
      const k = mw / AW;
      ctx.save();
      ctx.beginPath(); ctx.rect(mx + 1, my + 2, mw - 2, mh - 3); ctx.clip();
      ctx.strokeStyle = 'rgba(255,58,240,0.07)'; ctx.lineWidth = 1;
      for (let gx2 = 1; gx2 < 8; gx2++) { ctx.beginPath(); ctx.moveTo(mx + (mw * gx2) / 8, my); ctx.lineTo(mx + (mw * gx2) / 8, my + mh); ctx.stroke(); }
      for (let gy2 = 1; gy2 < 6; gy2++) { ctx.beginPath(); ctx.moveTo(mx, my + (mh * gy2) / 6); ctx.lineTo(mx + mw, my + (mh * gy2) / 6); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.strokeRect(mx + WALL * k, my + WALL * k, (AW - 2 * WALL) * k, (AH - 2 * WALL) * k);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (const pl of pillars) circ(mx + pl.x * k, my + pl.y * k, Math.max(1.5, pl.r * k));
      // camera view
      const vw = (W / VIEW) * k, vh = (H / VIEW) * k;
      ctx.strokeStyle = 'rgba(90,209,255,0.35)';
      ctx.strokeRect(mx + cam.x * k - vw / 2, my + cam.y * k - vh / 2, vw, vh);
      for (const e of enemies) {
        if (e.type === 'phantom' && e.cloaked) continue;
        const c = isBoss(e) ? ET[e.type].color : e.elite ? '#ffd23a' : '#ff4a5a';
        const s2 = isBoss(e) ? 5 : e.elite ? 3.5 : 2;
        if (isBoss(e) || e.elite) { ctx.globalAlpha = 0.35; ctx.fillStyle = c; circ(mx + e.x * k, my + e.y * k, s2 * 1.4); ctx.globalAlpha = 1; }
        ctx.fillStyle = c; ctx.fillRect(mx + e.x * k - s2 / 2, my + e.y * k - s2 / 2, s2, s2);
      }
      for (const pk of pickups) { ctx.fillStyle = pk.kind === 'weapon' ? '#ffd23a' : pk.kind === 'gear' ? '#5affc8' : '#5dff8a'; ctx.fillRect(mx + pk.x * k - 1.5, my + pk.y * k - 1.5, 3, 3); }
      // soldier as an arrow pointing where they aim
      ctx.save(); ctx.translate(mx + p.x * k, my + p.y * k); ctx.rotate(p.angle);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-1.5, 0); ctx.lineTo(-3, 3.5); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.restore();
      utext(arena.name, mx + 10, my + mh + 5, 10, '#8a7ab0', 'left', 'top', 700, 2);
    }

    // ---- weapon bar: only what you carry; new guns slide in, the active one lifts
    if (!hud.owned) hud.owned = p.ws.map(st => st.owned);
    const own = [];
    p.ws.forEach((st, i) => {
      if (!st.owned) return;
      own.push(i);
      if (!hud.owned[i]) { hud.owned[i] = true; hud.slotT[i] = 0; }
    });
    // on touch the bar stays between the two thumb zones
    const barRoom = touch.using ? W - 2 * (190 / UIS) : W - 32;
    const bwS = Math.min(small ? 76 : 94, barRoom / Math.max(1, own.length)), bh = small ? 46 : 52;
    const bx0 = W / 2 - (own.length * bwS) / 2, by = H - bh - 14 - SB;
    own.forEach((i, j) => {
      const tx2 = bx0 + j * bwS;
      hud.slotX[i] = hud.slotX[i] === undefined ? tx2 : lerp(hud.slotX[i], tx2, Math.min(1, rdt * 12));
      hud.slotT[i] = Math.min(1, (hud.slotT[i] === undefined ? 1 : hud.slotT[i]) + rdt * 2.2);
      hud.raise[i] = lerp(hud.raise[i] || 0, i === p.cur ? 1 : 0, Math.min(1, rdt * 14));
    });
    for (const i of own) {
      const w = WEAPONS[i], st = p.ws[i], cur = i === p.cur;
      const t = hud.slotT[i], e = 1 - Math.pow(1 - t, 3);
      const x = hud.slotX[i] + 2, y = by - hud.raise[i] * 6 + (1 - e) * 40, ww = bwS - 4;
      hud.slotRects.push({ i, x, y: by - 6, w: ww, h: bh + 6 });
      ctx.save();
      ctx.globalAlpha = e;
      hudPanel(x, y, ww, bh, cur ? w.color : null, 8);
      if (cur) {
        const g = ctx.createLinearGradient(0, y, 0, y + bh);
        g.addColorStop(0, hexA(w.color, 0.22)); g.addColorStop(1, hexA(w.color, 0.02));
        ctx.fillStyle = g; ctx.fillRect(x, y + 2, ww - 8, bh - 2);
      }
      if (t < 1) { ctx.fillStyle = `rgba(255,255,255,${((1 - t) * 0.6).toFixed(3)})`; ctx.fillRect(x, y, ww, bh); }
      if (ww < 64) {
        // narrow slots (a full touch bar): big slot number in the gun's colour, the current gun's name above the bar
        for (let l = 0; l < st.lvl; l++) { ctx.fillStyle = '#5ad1ff'; ctx.fillRect(x + ww / 2 - 6 + l * 5, y + 5, 3, 3); }
        text(String((i + 1) % 10), x + ww / 2, y + 14, 11, cur ? w.color : hexA(w.color, 0.55), 'center', 'top', false);
        if (cur) utext(w.short, x + ww / 2, y - 16, 11, w.color, 'center', 'top', 700, 1);
      } else {
        text(String((i + 1) % 10), x + 6, y + 6, 7, cur ? w.color : '#6a6a88', 'left', 'top', false);
        for (let l = 0; l < st.lvl; l++) { ctx.fillStyle = '#5ad1ff'; ctx.fillRect(x + ww - 14 - l * 5, y + 6, 3, 3); }
        utext(w.short, x + ww / 2, y + 17, small ? 11 : 12, cur ? '#ffffff' : '#a8a8c4', 'center', 'top', 700, 1);
      }
      const inf = st.ammo === Infinity;
      const lowA = !inf && st.ammo < w.ammoMax * 0.2;
      const ac = st.ammo === 0 ? '#ff3a4a' : lowA ? '#ffb020' : w.color;
      utext(inf ? '∞' : String(st.ammo), x + ww / 2, y + bh - 19, inf ? 15 : 12, ac, 'center', 'top', 700, 0);
      if (!inf) hudBar(x + 6, y + bh - 5, ww - 12, 2, clamp(st.ammo / w.ammoMax, 0, 1), 0, ac);
      ctx.restore();
    }

    // ---- boss bar
    const queens = enemies.filter(isBoss);
    if (queens.length) {
      let hp = 0, mx = 0;
      for (const q of queens) { hp += Math.max(0, q.hp); mx += q.maxHp; }
      const bf = hp / mx;
      hud.bossTrail = bf > hud.bossTrail ? bf : Math.max(bf, hud.bossTrail - rdt * 0.25);
      const qw = clamp(W - 2 * (40 + Math.max(cw, sw2)), 200, 520), qx = W / 2 - qw / 2, qy = 64 + (small ? 0 : 6);
      const BT = ET[queens[0].type];
      const enr = queens.some(q => q.hp < q.maxHp * 0.5);
      hudPanel(qx - 10, qy - 4, qw + 20, 34, BT.color, 8);
      utext(BT.name + (enr ? '  ·  ENRAGED' : ''), W / 2, qy + 2, 12, enr && Math.sin(gameTime * 8) > 0 ? '#ffffff' : BT.color, 'center', 'top', 700, 3);
      hudBar(qx, qy + 18, qw, 7, bf, hud.bossTrail, BT.color, 4);
    } else hud.bossTrail = 1;

    // carrier / boss off-screen markers
    for (const e of enemies) {
      if (!e.elite && !e.champ && !isBoss(e) && !hunt) continue;
      const sx = (e.x - cam.x) * VIEW + W / 2, sy = (e.y - cam.y) * VIEW + H / 2;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const px = clamp(sx, 40, W - 40), py = clamp(sy, 90, H - 80);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = isBoss(e) ? ET[e.type].color : e.elite || e.bounty ? '#ffd23a' : e.champ ? AFFIX[e.affix[0]].color : '#ff5a3a';
      ctx.globalAlpha = 0.6 + Math.sin(gameTime * 8) * 0.3;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (const pk of pickups) {
      if (pk.kind !== 'weapon') continue;
      const sx = (pk.x - cam.x) * VIEW + W / 2, sy = (pk.y - cam.y) * VIEW + H / 2;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      ctx.save(); ctx.translate(clamp(sx, 40, W - 40), clamp(sy, 90, H - 80)); ctx.rotate(a);
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }

    if (bx0 > 170 && !touch.using) utext(A.musicMuted ? 'M  MUSIC OFF' : 'M  MUSIC ON', 16 + SL, H - 26 - SB, 11, '#5a5a7a', 'left', 'top', 600, 2, false);

    drawNowPlaying(rdt, 16 + SL, hy + ch + 10);
    if (relo) {
      const a = relo.t < 0.8 ? relo.t / 0.8 : Math.max(0, 1 - (relo.t - 0.8) / 1.0);
      ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`; ctx.fillRect(0, 0, W, H);
      if (relo.t < 0.9) text('RELOCATING...', W / 2, H / 2, 14, '#5affc8', 'center', 'middle');
    }
    drawBanners(rdt);
  }

  // cassette-style "now playing" card that slides in when a new track starts
  function drawNowPlaying(rdt, x, y) {
    const np = nowPlaying;
    if (!np || A.musicMuted) return;
    np.t += rdt;
    const dur = 4.2;
    if (np.t > dur) return;
    const slide = np.t < 0.35 ? 1 - Math.pow(1 - np.t / 0.35, 3) : np.t > dur - 0.5 ? (dur - np.t) / 0.5 : 1;
    const label = np.mode === 'boss' ? 'BOSS THEME' : np.mode === 'break' ? 'INTERMISSION' : np.key ? `NOW PLAYING  +${np.key} KEY` : 'NOW PLAYING';
    ctx.font = font(10);
    const w = Math.max(ctx.measureText(np.name).width, 110) + 96, h = 40;
    const px = x - (1 - slide) * (w + x + 10);
    ctx.save();
    ctx.globalAlpha = clamp(slide, 0, 1);
    hudPanel(px, y, w, h, np.mode === 'boss' ? '#ff3af0' : '#5ad1ff', 8);
    // tape reels spinning to the beat
    for (const rx of [px + 14, px + 34]) {
      ctx.strokeStyle = '#ff7ad8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(rx, y + 20, 7, 0, TAU); ctx.stroke();
      const a = gameTime * 6 + menuT * 6;
      ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * 7, y + 20 + Math.sin(a) * 7); ctx.lineTo(rx - Math.cos(a) * 7, y + 20 - Math.sin(a) * 7); ctx.stroke();
    }
    utext(label, px + 50, y + 5, 10, np.mode === 'boss' ? '#ff3af0' : '#5ad1ff', 'left', 'top', 700, 2, false);
    text(np.name, px + 50, y + 19, 10, '#ffffff', 'left', 'top');
    // equaliser bars
    for (let i = 0; i < 5; i++) {
      const bh = 3 + Math.abs(Math.sin(i * 1.7 + (gameTime + menuT) * 9)) * 8 * (0.4 + beatPulse * 0.6);
      ctx.fillStyle = '#5affc8'; ctx.fillRect(px + w - 32 + i * 5, y + h - 6 - bh, 3, bh);
    }
    ctx.restore();
  }

  // banner: a band wipes across the screen, the title slides in with its letters settling,
  // a glint sweeps over it, then the band folds shut
  function drawBanners(rdt) {
    const b = banners[0];
    if (!b) return;
    b.t += rdt;
    if (b.t >= b.dur) { banners.shift(); return; }
    const t = b.t, ein = 1 - Math.pow(1 - clamp(t / 0.28, 0, 1), 3);
    const out = t > b.dur - 0.35 ? clamp((b.dur - t) / 0.35, 0, 1) : 1;
    const ts = Math.min(40, W / 20);
    const y = H * 0.3;
    const fullH = ts * 2.9 + (b.sub2 ? 22 : 0), bandH = fullH * out, top = y - ts * 0.9 + (fullH - bandH) / 2;
    ctx.save();
    // band
    const bw = W * ein;
    const bg = ctx.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, 'rgba(8,2,20,0.25)'); bg.addColorStop(0.5, 'rgba(8,2,20,0.62)'); bg.addColorStop(1, 'rgba(8,2,20,0.25)');
    ctx.fillStyle = bg; ctx.fillRect(0, top, bw, bandH);
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.85 * out; ctx.fillRect(0, top, bw, 2); ctx.fillRect(W - bw, top + bandH - 2, bw, 2);
    if (ein < 1) { // leading edge of the wipe
      ctx.globalAlpha = 1 - ein; ctx.fillStyle = '#ffffff'; ctx.fillRect(bw - 3, top, 3, bandH);
    }
    ctx.globalAlpha = clamp(ein * 1.4, 0, 1) * out;
    // title
    const slide = (1 - ein) * W * 0.12;
    ctx.translate(W / 2 + slide, y);
    ctx.font = font(ts); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = ((1 - ein) * 14).toFixed(1) + 'px';
    const tw = ctx.measureText(b.title).width;
    ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(b.title, 0, 0);
    const gp = clamp((t - 0.25) / 0.6, 0, 1) * 1.4 - 0.2; // glint position across the word
    const tg = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
    tg.addColorStop(0, b.color);
    if (gp > 0.02 && gp < 0.98) { tg.addColorStop(Math.max(0.01, gp - 0.08), b.color); tg.addColorStop(gp, '#ffffff'); tg.addColorStop(Math.min(0.99, gp + 0.08), b.color); }
    tg.addColorStop(1, b.color);
    ctx.fillStyle = tg; ctx.fillText(b.title, 0, 0);
    ctx.letterSpacing = '0px';
    if (b.sub) { ctx.font = font(Math.min(13, W / 60)); ctx.fillStyle = '#ffffff'; ctx.fillText(b.sub, -slide * 0.5, ts * 1.05); }
    if (b.sub2) { ctx.font = ufont(Math.min(14, W / 55), 600); ctx.letterSpacing = '2px'; ctx.fillStyle = '#c8c0e8'; ctx.fillText(b.sub2, -slide * 0.3, ts * 1.05 + 24); ctx.letterSpacing = '0px'; }
    ctx.restore();
  }

  function drawCursor() {
    if (touch.using && !(state === 'play' && touch.aimActive)) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const x = mouse.x, y = mouse.y;
    if (state === 'play' && player) {
      const w = WEAPONS[player.cur];
      const gap = 6 + w.spread * 30 + player.recoil * 1.2;
      ctx.strokeStyle = w.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - gap - 7, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 7, y);
      ctx.moveTo(x, y - gap - 7); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 7);
      ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 2, 2);
    } else {
      ctx.strokeStyle = '#ff3af0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // ======================================================================= render: screens
  function chromeTitle(str, x, y, size) {
    ctx.font = font(size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#f4fbff'); g.addColorStop(0.46, '#6fd8ff'); g.addColorStop(0.52, '#1a2a6a'); g.addColorStop(1, '#ff5ad8');
    ctx.fillStyle = '#ff2a8a'; ctx.fillText(str, x + 5, y + 5);
    ctx.lineWidth = 6; ctx.strokeStyle = '#12002a'; ctx.strokeText(str, x, y);
    ctx.fillStyle = g; ctx.fillText(str, x, y);
  }

  function drawMenu(rdt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const dk = dive ? clamp(dive.t / 0.62, 0, 1) : 0, dk2 = dk * dk;
    const hz = H * (0.56 - 0.62 * dk2); // the camera pitches down into the grid
    let g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, '#05010f'); g.addColorStop(0.55, '#1c0636'); g.addColorStop(1, '#4a0c48');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz);
    for (let i = 0; i < 90; i++) {
      const sx = ((i * 7919) % 1000) / 1000 * W, sy = ((i * 104729) % 1000) / 1000 * hz * 0.8;
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.5 * Math.abs(Math.sin(menuT * 1.5 + i))).toFixed(2)})`;
      ctx.fillRect(sx, sy, 2, 2);
    }
    const sr = Math.min(W, H) * 0.22, scx = W / 2, scy = hz - sr * 0.3;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
    g = ctx.createLinearGradient(0, scy - sr, 0, scy + sr);
    g.addColorStop(0, '#ffe96a'); g.addColorStop(0.5, '#ff8a3a'); g.addColorStop(1, '#ff1f8e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(scx, scy, sr * (1 + beatPulse * 0.02), 0, TAU); ctx.fill();
    ctx.fillStyle = '#3c0a44';
    for (let i = 0; i < 7; i++) ctx.fillRect(scx - sr - 4, scy + sr * (0.04 + i * 0.13), sr * 2 + 8, 2 + i * 1.7);
    ctx.restore();
    ctx.fillStyle = '#12021e';
    ctx.beginPath(); ctx.moveTo(0, hz);
    for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, hz - (Math.sin(x * 0.013) + Math.sin(x * 0.031 + 1) + 2) * H * 0.018);
    ctx.lineTo(W, hz); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#07010e'; ctx.fillRect(0, hz, W, H - hz);
    ctx.strokeStyle = `rgba(255,40,180,${(0.5 + beatPulse * 0.45).toFixed(3)})`; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = -24; i <= 24; i++) { ctx.moveTo(W / 2 + i * W * 0.012, hz); ctx.lineTo(W / 2 + i * W * 0.11, H); }
    const off = (menuT * 1.2) % 1;
    for (let k = 0; k < 14; k++) {
      const f = (k + off) / 14;
      const y = hz + (H - hz) * Math.pow(f, 2.2);
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ff3af0'; ctx.fillRect(0, hz - 1, W, 2);
    ctx.globalAlpha = 1 - clamp(dk * 1.8, 0, 1);

    const ts = Math.min(64, W / 13);
    chromeTitle('PROTOCOL 88', W / 2, H * 0.17, ts * (1 + beatPulse * 0.02));
    text('SURVIVE THE SWARM', W / 2, H * 0.17 + ts * 0.9, Math.min(14, W / 55), '#ffd84a', 'center');

    const blink = Math.sin(menuT * 5) > -0.3;
    const locked = powered && !kitOpen(KITS[profile.kit] || KITS[0]);
    if (powered) drawKitPicker();
    if (locked) text('KIT LOCKED - PICK ANOTHER', W / 2, H * 0.62, Math.min(14, W / 50), '#ff5a6a', 'center');
    else if (blink) text(powered ? (touch.using ? 'TAP TO DEPLOY' : 'CLICK TO DEPLOY') : 'CLICK TO POWER ON', W / 2, H * 0.62, Math.min(18, W / 40), powered ? '#5affc8' : '#ffffff', 'center');

    // attract mode: alternate between controls and the high-score table
    const showScores = Math.floor(menuT / 7) % 2 === 1;
    const cs = Math.min(9, W / 100);
    const cy0 = H * 0.68;
    if (showScores) drawScoreTable(W / 2, cy0, cs);
    else {
      const lines = touch.using
        ? [['LEFT THUMB', 'MOVE'], ['RIGHT THUMB', 'AIM + FIRE'], ['DASH / DOUBLE-TAP LEFT', 'DASH'], ['SWAP / TAP THE BAR', 'WEAPONS'], ['TAP WAVE TIMER', 'EARLY CALL'], ['II BUTTON', 'PAUSE / OPTIONS']]
        : pad.connected && pad.using
        ? [['LEFT STICK', 'MOVE'], ['RIGHT STICK', 'AIM + FIRE'], ['RT / RB', 'FIRE'], ['LT / A', 'DASH'], ['Y / D-PAD', 'WEAPONS'], ['X', 'EARLY CALL'], ['START', 'PAUSE / OPTIONS']]
        : [['WASD', 'MOVE'], ['MOUSE', 'AIM'], ['CLICK', 'FIRE'], ['SPACE / RMB', 'DASH'], ['1-0 / WHEEL / Q', 'WEAPONS'], ['F', 'EARLY CALL'], ['ESC', 'PAUSE / OPTIONS'], ['M / N', 'MUSIC / NEXT TRACK']];
      lines.forEach(([k, v], i) => {
        utext(k, W / 2 - 14, cy0 + i * (cs + 9), cs * 1.55, '#ff7ad8', 'right', 'top', 700, 2);
        utext(v, W / 2 + 14, cy0 + i * (cs + 9), cs * 1.55, '#d8d0ff', 'left', 'top', 600, 2);
      });
    }
    drawNowPlaying(rdt, 16, H - 60);
    // options button
    const ol = touch.using ? 'OPTIONS' : pad.connected && pad.using ? '[Y] OPTIONS' : '[O] OPTIONS';
    ctx.font = font(9);
    const ow = ctx.measureText(ol).width + 24;
    const obh = touch.using ? 40 : 28, oy = H - obh - 16 - safe.b / UIS;
    menuOptRect = { x: W - ow - 16 - safe.r / UIS, y: oy, w: ow, h: obh };
    panel(menuOptRect.x, menuOptRect.y, ow, obh, '#ff7ad8');
    text(ol, menuOptRect.x + ow / 2, menuOptRect.y + obh / 2 - 5, 9, '#ff7ad8', 'center', 'top', false);
    if (optionsOpen) {
      ctx.fillStyle = 'rgba(4,2,12,0.82)'; ctx.fillRect(0, 0, W, H);
      chromeTitle('OPTIONS', W / 2, H * 0.2, Math.min(42, W / 16));
      const bottom = drawOptions(H * 0.3);
      utext(touch.using ? 'TAP OUTSIDE TO CLOSE' : 'ESC / CLICK OUTSIDE TO CLOSE', W / 2, Math.max(H * 0.8, bottom + 12), 12, '#8a8ab0', 'center', 'top', 600, 2);
    }
    ctx.globalAlpha = 1;
    if (dk > 0) {
      // neon flash as we hit the grid, then black
      ctx.fillStyle = `rgba(255,58,240,${(Math.max(0, dk - 0.55) * 1.2).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(7,1,14,${Math.pow(Math.max(0, dk - 0.7) / 0.3, 1.5).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    }
  }

  let kitRects = null;
  function cycleKit(d) {
    profile.kit = (profile.kit + d + KITS.length) % KITS.length;
    saveProfile();
    A.sfx('switch');
  }
  function drawKitPicker() {
    const k = KITS[profile.kit] || KITS[0], open = kitOpen(k);
    const w = Math.min(480, W - 40), h = 96, x = W / 2 - w / 2, y = H * 0.33;
    ctx.fillStyle = 'rgba(6,2,16,0.72)'; ctx.fillRect(x, y, w, h);
    hudPanel(x, y, w, h, open ? k.color : '#5a5a7a');
    utext(`STARTING KIT  ·  ${profile.kit + 1} / ${KITS.length}  ·  ${profile.unlocked.length} UNLOCKED`, W / 2, y + 10, 11, '#8a8ab0', 'center', 'top', 700, 2);
    text(k.name, W / 2, y + 30, Math.min(14, w / 24), open ? k.color : '#6a6a88', 'center');
    if (open) utext(k.desc, W / 2, y + 56, 13, '#d8d0ff', 'center', 'top', 600, 1);
    else {
      const [have, need] = k.goal(profile), f = clamp(have / need, 0, 1);
      utext(`LOCKED  ·  ${k.req}`, W / 2, y + 52, 12, '#ff8a9a', 'center', 'top', 700, 1);
      hudBar(x + 70, y + 74, w - 190, 5, f, 0, k.color);
      utext(`${Math.min(have, need)} / ${need}`, x + w - 110, y + 69, 11, '#d8d0ff', 'left', 'top', 600, 0);
    }
    const pulse = 0.6 + Math.sin(menuT * 6) * 0.4;
    ctx.globalAlpha *= pulse; text('<', x + 22, y + h / 2, 16, '#ffffff', 'center', 'middle'); text('>', x + w - 22, y + h / 2, 16, '#ffffff', 'center', 'middle'); ctx.globalAlpha /= pulse;
    utext(touch.using ? 'TAP  <  >  TO CHANGE KIT' : pad.connected && pad.using ? 'D-PAD / BUMPERS TO CHANGE KIT' : 'A / D OR ARROWS TO CHANGE KIT', W / 2, y + h + 8, 11, '#8a8ab0', 'center', 'top', 600, 2);
    kitRects = { l: { x, y, w: 64, h }, r: { x: x + w - 64, y, w: 64, h }, box: { x, y, w, h } };
  }

  function drawScoreTable(cx, y, size, hl = -1) {
    const rowH = size + 10;
    text('- TOP 10 -', cx, y, size + 2, '#ffd23a', 'center');
    scores.forEach((r, i) => {
      const yy = y + (i + 1.4) * rowH;
      const on = i === hl;
      const col = on ? (Math.sin(menuT * 10 + overT * 10) > 0 ? '#5affc8' : '#ffffff') : i === 0 ? '#ff7ad8' : '#d8d0ff';
      text(`${String(i + 1).padStart(2, ' ')}.`, cx - size * 13, yy, size, col, 'left', 'top');
      text(r.name, cx - size * 8, yy, size, col, 'left', 'top');
      text(String(r.score).padStart(8, '0'), cx - size * 2.5, yy, size, col, 'left', 'top');
      text(`W${r.wave}`, cx + size * 9, yy, size, col, 'left', 'top');
    });
  }

  function drawOptions(y0) {
    optRects = [];
    const w = Math.min(560, W - 40), x = W / 2 - w / 2;
    const gap = 8, rh = clamp(Math.floor(H * 0.42 / OPTS.length) - gap, 28, 46), cy = rh / 2;
    OPTS.forEach((o, i) => {
      const y = y0 + i * (rh + gap), sel = i === optSel;
      panel(x, y, w, rh, sel ? '#5affc8' : 'rgba(255,255,255,0.15)');
      optRects.push({ x, y, w, h: rh, i });
      utext(o.label, x + 18, y + cy, 15, sel ? '#5affc8' : '#d8d0ff', 'left', 'middle', 700, 2, false);
      const v = settings[o.key];
      const vx = x + w - 230;
      text('<', vx, y + cy, 12, sel ? '#ffffff' : '#6a6a88', 'left', 'middle', false);
      text('>', x + w - 26, y + cy, 12, sel ? '#ffffff' : '#6a6a88', 'left', 'middle', false);
      if (o.names) utext(o.names[v], vx + 100, y + cy, 15, '#ffd23a', 'center', 'middle', 700, 2, false);
      else for (let k = 0; k < o.max; k++) { ctx.fillStyle = k < v ? '#ffd23a' : 'rgba(255,255,255,0.12)'; ctx.fillRect(vx + 26 + k * 15, y + cy - 8, 11, 16); }
    });
    const bottom = y0 + OPTS.length * (rh + gap);
    utext(touch.using ? 'TAP THE LEFT / RIGHT HALF OF A ROW TO CHANGE IT' : 'ARROWS / D-PAD TO CHANGE  ·  CLICK LEFT / RIGHT HALF OF A ROW', W / 2, bottom + 4, 12, '#8a8ab0', 'center', 'top', 600, 1);
    return bottom + 20;
  }

  // the run's perks and gear, in the free column left of the options (wide screens only)
  function drawBuild(y0) {
    const p = player;
    if (!p) return;
    const colW = W / 2 - Math.min(560, W - 40) / 2 - 48;
    if (colW < 230) return;
    const items = [
      ...PERK_KEYS.filter(k => p.perk[k] > 0).map(k => ({ info: PERKS[k], lv: p.perk[k], desc: PERKS[k].desc.slice(0, p.perk[k]).join(' · ') })),
      ...GEAR_KEYS.filter(k => p.gear[k] > 0).map(k => ({ info: GEAR[k], lv: p.gear[k], desc: GEAR[k].desc })),
    ];
    const x = 24 + Math.max(0, colW - 330);
    utext('YOUR BUILD', x, y0, 14, '#5affc8', 'left', 'top', 700, 3);
    if (!items.length) { utext('NOTHING YET - GRAB SUPPLY DROPS', x, y0 + 26, 12, '#8a8ab0', 'left', 'top', 600, 1); return; }
    const rh = clamp(Math.floor((H * 0.56) / items.length), 26, 40);
    items.forEach((it, i) => {
      const y = y0 + 26 + i * rh, c = it.info.color;
      ctx.fillStyle = hexA(c, 0.12); ctx.fillRect(x, y, 22, 22);
      ctx.strokeStyle = hexA(c, 0.8); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 21, 21);
      text(it.info.icon, x + 11, y + 6, 9, c, 'center', 'top', false);
      utext(`${it.info.name}${it.info.max > 1 ? `  LV ${it.lv}` : ''}`, x + 30, y + 1, 12, c, 'left', 'top', 700, 1, false);
      if (rh >= 34) utext(it.desc, x + 30, y + 16, 10, '#b8b0d8', 'left', 'top', 600, 0, false);
    });
  }

  function drawPause() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = 'rgba(4,2,12,0.78)'; ctx.fillRect(0, 0, W, H);
    chromeTitle('PAUSED', W / 2, H * 0.16, Math.min(48, W / 14));
    utext(touch.using ? 'TAP OUTSIDE TO RESUME' : pad.connected && pad.using ? 'START / B TO RESUME' : 'ESC TO RESUME', W / 2, H * 0.16 + 38, 14, '#ffffff', 'center', 'top', 700, 3);
    const fy = Math.max(H * 0.84, drawOptions(H * 0.27) + 16);
    drawBuild(H * 0.27);
    const help = touch.using
      ? ['LEFT THUMB MOVE   ·   RIGHT THUMB AIM + FIRE   ·   DASH BUTTON OR DOUBLE-TAP LEFT', 'SWAP OR TAP THE WEAPON BAR   ·   TAP THE WAVE TIMER TO CALL EARLY']
      : ['WASD MOVE   ·   MOUSE AIM   ·   CLICK FIRE   ·   SPACE DASH   ·   F EARLY CALL', '1-0 / WHEEL / Q WEAPONS   ·   M MUSIC   ·   N NEXT TRACK'];
    utext(help[0], W / 2, fy, 13, '#b8b0d8', 'center', 'top', 600, 1);
    utext(help[1], W / 2, fy + Math.max(18, H * 0.04), 13, '#b8b0d8', 'center', 'top', 600, 1);
  }

  // ---- run report
  const SRC = {
    drone: { name: 'SENTRY DRONES', color: '#ff7ad8' },
    perk:  { name: 'PERKS', color: '#ffcf3a' },
    power: { name: 'POWER-UPS', color: '#ff2a4a' },
    alien: { name: 'ALIEN BLASTS', color: '#7bd12a' }, // boomers and volatile elites hitting their own
    barrel: { name: 'BARRELS', color: '#ff9a3a' },
    turret: { name: 'TURRETS', color: '#5affc8' },
  };
  const srcInfo = k => { const w = WEAPONS.find(w => w.id === k); return w ? { name: w.short, color: w.color } : SRC[k] || { name: 'OTHER', color: '#8a8ab0' }; };
  const BOSS_TIP = 'WATCH THE WIND-UP AND DASH THROUGH ITS ATTACKS';
  const TIPS = {
    crawler: 'CRAWLERS COME IN NUMBERS - KEEP MOVING, DASH THROUGH GAPS',
    leaper: 'LEAPERS CROUCH BEFORE THEY POUNCE - SIDESTEP THEN',
    spitter: 'SPITTERS AIM WHERE YOU ARE HEADING - CHANGE DIRECTION',
    brute: 'BRUTES CHARGE IN A STRAIGHT LINE - DASH SIDEWAYS',
    boomer: 'POP BOOMERS AT RANGE, IDEALLY INSIDE A CROWD',
    phantom: 'PHANTOMS SHOW UP IN YOUR FLASHLIGHT - SWEEP YOUR AIM',
    burrower: 'BURROWERS SURFACE UNDER YOU - WATCH THE DIRT TRAIL, KEEP MOVING',
    warden: 'WARDENS TURN SLOWLY - CIRCLE TO THEIR BACK',
    hatcher: 'KILL HATCHERS FAST - EACH ONE BURSTS INTO MITES',
    wasp: 'STINGERS FLY OVER COVER - STRAFE INSTEAD OF HIDING',
    mite: 'MITES DIE TO ANY SPLASH - ROCKETS AND FLAMES CLEAR THEM',
    egg: 'SHOOT EGGS BEFORE THEY HATCH',
    queen: BOSS_TIP, specimen: BOSS_TIP, titan: BOSS_TIP, behemoth: BOSS_TIP,
    'ACID POOL': 'STAY OUT OF THE PUDDLES - THEY IGNORE DASH I-FRAMES',
    'ACID PUDDLE': 'STAY OUT OF THE PUDDLES - THEY IGNORE DASH I-FRAMES',
    PLASMA: 'PLASMA POOLS BURN FAST - NEVER FIGHT INSIDE ONE',
    'EXPLOSIVE BARREL': 'BARRELS HURT YOU TOO - SET THEM OFF FROM RANGE',
    'VENT FLARE': 'VENT FLARES LAND WHERE YOU ARE HEADING - CHANGE DIRECTION',
    'CORE FLARE': 'DASH THROUGH THE CORE FLARE - DASH I-FRAMES IGNORE IT',
  };
  const killerName = k => (k && ET[k] ? ET[k].name : k || 'UNKNOWN');
  const killerTip = k => TIPS[k] || (k && k.startsWith('VOLATILE') ? 'VOLATILE ELITES BLOW UP AFTER DEATH - LEAVE THE RING' : '');
  const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // draws the report in a box at (x, y), w wide, no taller than maxH; returns its height
  function drawRunReport(x, y, w, maxH) {
    const p = player;
    const tiles = [
      ['TIME', fmtTime(run.time || 0)], ['KILLS', String(kills)], ['BEST COMBO', String(run.bestCombo)], ['DODGES', String(run.dodges)],
      ['ELITES', String(run.elites + run.champs)], ['BOSSES', String(run.bosses)], ['DMG TAKEN', String(Math.round(run.taken))], ['EARLY CALLS', String(run.early)],
    ];
    const srcs = Object.entries(run.dmg).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
    const total = srcs.reduce((a, [, v]) => a + v, 0) || 1;
    const killer = run.killedBy, tip = killerTip(killer);
    const build = [...PERK_KEYS.filter(k => p.perk[k] > 0).map(k => PERKS[k]), ...GEAR_KEYS.filter(k => p.gear[k] > 0).map(k => GEAR[k])];
    // fit the damage bars into whatever height is left
    const fixed = 30 + 2 * 44 + 30 + (killer ? 44 + (tip ? 16 : 0) : 0) + (build.length ? 34 : 0) + 14 + (run.unlocks.length ? 30 : 0);
    const nBars = clamp(Math.floor((maxH - fixed) / 22), 0, Math.min(6, srcs.length));
    const h = fixed + nBars * 22 - (nBars ? 0 : 30);
    hudPanel(x, y, w, h, '#ff4f6d');
    let cy = y + 12;
    utext('RUN REPORT', x + 14, cy, 13, '#ff8ab0', 'left', 'top', 700, 3);
    if (run.mods || run.bounties) utext(`${run.mods} TWIST${run.mods === 1 ? '' : 'S'} SURVIVED${run.bounties ? `  ·  ${run.bounties} BOUNTY` : ''}`, x + w - 14, cy + 1, 11, '#ffd23a', 'right', 'top', 700, 1);
    cy += 26;
    if (run.unlocks.length) {
      ctx.fillStyle = 'rgba(255,210,58,0.1)'; ctx.fillRect(x + 14, cy, w - 28, 24);
      utext(`KIT UNLOCKED: ${run.unlocks.join(', ')}`, x + 24, cy + 5, 12, Math.sin(overT * 6) > -0.4 ? '#ffd23a' : '#fff6c8', 'left', 'top', 700, 1, false);
      cy += 30;
    }
    const tw = (w - 28) / 4;
    tiles.forEach(([label, val], i) => {
      const tx = x + 14 + (i % 4) * tw, ty = cy + Math.floor(i / 4) * 44;
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(tx, ty, tw - 6, 38);
      utext(label, tx + 8, ty + 4, 10, '#8a8ab0', 'left', 'top', 700, 2, false);
      text(val, tx + 8, ty + 19, 12, '#ffffff', 'left', 'top', false);
    });
    cy += 2 * 44 + 4;
    if (nBars) {
      utext('DAMAGE DEALT', x + 14, cy, 11, '#7ae0ff', 'left', 'top', 700, 2);
      utext('KILLS', x + w - 14, cy, 11, '#7ae0ff', 'right', 'top', 700, 2);
      cy += 20;
      const top = srcs[0][1];
      for (const [k, v] of srcs.slice(0, nBars)) {
        const info = srcInfo(k), bw = w - 28 - 150;
        utext(info.name, x + 14, cy + 2, 11, info.color, 'left', 'top', 700, 1, false);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + 120, cy + 5, bw, 8);
        ctx.fillStyle = info.color; ctx.fillRect(x + 120, cy + 5, bw * (v / top), 8);
        utext(`${Math.round((v / total) * 100)}%`, x + 120 + bw + 8, cy + 2, 11, '#d8d0ff', 'left', 'top', 600, 0, false);
        utext(String(run.kills[k] || 0), x + w - 14, cy + 2, 11, '#ffffff', 'right', 'top', 700, 0, false);
        cy += 22;
      }
      cy += 8;
    }
    if (killer) {
      ctx.fillStyle = 'rgba(255,40,60,0.08)'; ctx.fillRect(x + 14, cy, w - 28, 36 + (tip ? 16 : 0));
      utext('KILLED BY', x + 24, cy + 6, 10, '#ff8a9a', 'left', 'top', 700, 2, false);
      text(killerName(killer), x + 24, cy + 20, 11, '#ff3a4a', 'left', 'top', false);
      if (tip) utext(tip, x + 24, cy + 37, 11, '#d8d0ff', 'left', 'top', 600, 0, false);
      cy += 44 + (tip ? 16 : 0);
    }
    if (build.length) {
      let bx = x + 14;
      for (const b of build) {
        if (bx + 22 > x + w - 14) break;
        ctx.fillStyle = hexA(b.color, 0.14); ctx.fillRect(bx, cy, 22, 22);
        ctx.strokeStyle = hexA(b.color, 0.8); ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, cy + 0.5, 21, 21);
        text(b.icon, bx + 11, cy + 6, 9, b.color, 'center', 'top', false);
        bx += 26;
      }
    }
    return h;
  }

  function drawGameOver() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const a = clamp(overT * 1.5, 0, 0.85);
    ctx.fillStyle = `rgba(20,0,6,${a.toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    if (overT < 0.2) return;
    const ts = Math.min(56, W / 12);
    ctx.font = font(ts); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText('YOU DIED', W / 2, H * 0.12);
    ctx.fillStyle = '#ff2a3a'; ctx.fillText('YOU DIED', W / 2, H * 0.12);
    text(`WAVE ${wave}   SCORE ${String(score).padStart(8, '0')}   KILLS ${kills}`, W / 2, H * 0.12 + ts * 0.8, Math.min(11, W / 70), '#ffd23a', 'center');
    if (entry && !entry.done) {
      text('NEW HIGH SCORE!', W / 2, H * 0.36, Math.min(22, W / 30), Math.sin(overT * 8) > 0 ? '#5affc8' : '#ffffff', 'center');
      text('ENTER YOUR INITIALS', W / 2, H * 0.36 + 36, 10, '#d8d0ff', 'center');
      const bs = 54, gap = 18, x0 = W / 2 - (3 * bs + 2 * gap) / 2, y = H * 0.36 + 80;
      // arrows above and below each letter and an OK button, so it works by tap or click too
      entry.rects = [];
      for (let i = 0; i < 3; i++) {
        const x = x0 + i * (bs + gap), sel = i === entry.pos;
        panel(x, y, bs, bs + 8, sel ? '#5affc8' : 'rgba(255,255,255,0.2)');
        text(LETTERS[entry.letters[i]], x + bs / 2, y + bs / 2 + 4, 30, sel ? '#5affc8' : '#ffffff', 'center', 'middle');
        if (sel && Math.sin(overT * 10) > 0) { ctx.fillStyle = '#5affc8'; ctx.fillRect(x + 10, y + bs, bs - 20, 3); }
        const ac = sel ? '#5affc8' : '#8a8ab0';
        ctx.fillStyle = ac;
        ctx.beginPath(); ctx.moveTo(x + bs / 2, y - 22); ctx.lineTo(x + bs / 2 - 9, y - 10); ctx.lineTo(x + bs / 2 + 9, y - 10); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + bs / 2, y + bs + 30); ctx.lineTo(x + bs / 2 - 9, y + bs + 18); ctx.lineTo(x + bs / 2 + 9, y + bs + 18); ctx.closePath(); ctx.fill();
        entry.rects.push({ i, kind: 'up', x, y: y - 34, w: bs, h: 32 }, { i, kind: 'down', x, y: y + bs + 10, w: bs, h: 32 }, { i, kind: 'box', x, y, w: bs, h: bs + 8 });
      }
      const okW = 120, okX = W / 2 - okW / 2, okY = y + bs + 50;
      panel(okX, okY, okW, 36, '#5affc8');
      text('OK', W / 2, okY + 18, 12, '#5affc8', 'center', 'middle', false);
      entry.rects.push({ kind: 'ok', x: okX, y: okY, w: okW, h: 36 });
      text(touch.using ? 'TAP THE ARROWS TO PICK  -  OK TO CONFIRM' : pad.connected && pad.using ? 'D-PAD TO PICK  -  A TO CONFIRM' : 'TYPE OR USE ARROWS  -  ENTER TO CONFIRM', W / 2, okY + 52, 8, '#8a8ab0', 'center');
      return;
    }
    if (newRecord && Math.sin(overT * 8) > -0.3) text('NEW PERSONAL BEST!', W / 2, H * 0.12 + ts * 0.8 + 24, 10, '#5affc8', 'center');
    // report and top-10 side by side on wide screens; stacked (table only if it fits) otherwise
    const ry = H * 0.25, room = H * 0.86 - ry;
    if (W >= 1000) {
      const rw = Math.min(470, W * 0.4);
      drawRunReport(W / 2 - 30 - rw, ry, rw, room);
      drawScoreTable(W / 2 + 40 + 11 * 12, ry + 6, 11, highlight);
    } else {
      const rw = Math.min(470, W - 32);
      const rh = drawRunReport(W / 2 - rw / 2, ry, rw, room);
      const ts2 = Math.min(10, W / 70);
      if (room - rh - 24 > 11.4 * (ts2 + 10)) drawScoreTable(W / 2, ry + rh + 24, ts2, highlight);
    }
    // kit for the next run, switchable right here
    const k = KITS[profile.kit] || KITS[0], open = kitOpen(k), ky = H * 0.88 - 30;
    const kl = `NEXT KIT:  ${k.name}${open ? '' : '  (LOCKED)'}`;
    ctx.font = ufont(13, 700);
    const kw = ctx.measureText(kl).width + 90;
    utext(kl, W / 2, ky, 13, open ? k.color : '#ff5a6a', 'center', 'top', 700, 2);
    text('<', W / 2 - kw / 2, ky + 1, 12, '#ffffff', 'center', 'top');
    text('>', W / 2 + kw / 2, ky + 1, 12, '#ffffff', 'center', 'top');
    kitRects = { l: { x: W / 2 - kw / 2 - 30, y: ky - 12, w: 60, h: 40 }, r: { x: W / 2 + kw / 2 - 30, y: ky - 12, w: 60, h: 40 } };
    if (canRestart() && Math.sin(overT * 5) > -0.3) text(!open ? 'KIT LOCKED - PICK ANOTHER' : touch.using ? 'TAP TO REDEPLOY' : pad.connected && pad.using ? 'PRESS A TO REDEPLOY' : 'CLICK TO REDEPLOY', W / 2, H * 0.88, Math.min(16, W / 45), open ? '#ffffff' : '#ff5a6a', 'center');
  }

  // ======================================================================= loop
  // screen UI drawn at UIS: inside, W/H are the scaled layout size and VIEW maps world to it
  function uiDraw(fn) {
    const w = W, h = H, d = DPR, v = VIEW;
    W = w / UIS; H = h / UIS; DPR = d * UIS; VIEW = v / UIS;
    try { fn(); } finally { W = w; H = h; DPR = d; VIEW = v; }
  }
  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame); // first, so one frame that throws can't stop the game for good
    const rdt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (slowT > 0) { slowT -= rdt; if (slowT <= 0) timeScale = 1; }
    const dt = rdt * timeScale;
    zoomPunch *= Math.exp(-rdt * 1.8);
    zoomCur += (zoomPunch - zoomCur) * Math.min(1, rdt * 9);
    if (dive && (dive.t += rdt) >= 0.62) { dive = null; startGame(); fadeIn = 1; }
    fadeIn = Math.max(0, fadeIn - rdt / 0.8);
    VIEW = VIEW_BASE * (1 + zoomCur + fadeIn * fadeIn * 0.4);
    pollPad();
    const steps = state === 'paused' || state === 'menu' ? 1 : sim.speed;
    for (let i = 0; i < steps; i++) {
      if (sim.onTick) sim.onTick(dt);
      update(dt, rdt);
    }
    if (state === 'menu') {
      uiDraw(() => drawMenu(rdt));
      postWorld(true);
    } else {
      renderWorld();
      postWorld(false);
      uiDraw(() => {
        drawHUD(rdt);
        if (fadeIn > 0) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = `rgba(7,1,14,${Math.pow(fadeIn, 1.6).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
        if (state === 'paused') drawPause();
        if (state === 'over') drawGameOver();
      });
      drawTouch(rdt);
    }
    postScreen(rdt);
    drawCursor();
  }
  requestAnimationFrame(frame);

  // debug hook for automated testing
  if (/[?&](debug|bot)\b/.test(location.search)) window.__p88 = {
    get state() { return state; },
    get wave() { return wave; },
    get enemies() { return enemies.length; },
    get player() { return player; },
    start: () => { bootSkip(); powerUp(); startGame(); },
    touch,
    skipTo: n => { spawnQueue = []; for (const e of enemies) e.dead = true; compact(enemies); wave = n - 1; waveActive = false; interTimer = 0.1; },
    god: () => { if (player) { player.hp = 1e9; player.maxHp = 1e9; } },
    list: () => enemies,
    pickups: () => pickups,
    toScreen: (x, y) => ({ x: (x - cam.x) * VIEW + W / 2, y: (y - cam.y) * VIEW + H / 2 }),
    // --- autoplay / simulation access
    sim,
    keys,
    mouse,
    WEAPONS,
    get waveActive() { return waveActive; },
    get queued() { return spawnQueue.length; },
    get score() { return score; },
    set score(v) { score = v; },
    eshots: () => eshots,
    aim: (x, y) => { mouse.x = (x - cam.x) * VIEW + W / 2; mouse.y = (y - cam.y) * VIEW + H / 2; },
    select: i => selectWeapon(i, true),
    dash: () => { dashQueued = true; },
    restart: () => startGame(),
    pools: () => pools,
    zoom: z => { VIEW = VIEW_BASE = z; },
    aberr: v => { aberr = v; },
    gear: k => applyGear(k), // gear or perk key
    drop: () => supplyDrop(),
    mod: k => { forceMod = k; }, // modifier for the next wave
    champ: (type, affix, bounty) => { const a = rand(0, TAU), e = makeEnemy(type, player.x + Math.cos(a) * 320, player.y + Math.sin(a) * 320, false); applyAffix(e, { affix, champ: true, bounty }); enemies.push(e); return e; },
    get waveMod() { return waveMod; },
    get profile() { return profile; },
    get run() { return run; },
    barrels: () => barrels,
    pads: () => pads,
    event: () => arenaEvent(),
    get combo() { return { combo, mult, comboTimer }; },
    unlockAll: () => { profile.unlocked = KITS.map(k => k.id); saveProfile(); },
    PERKS,
    arena: i => { buildArena(ARENAS[i]); player.x = arena.start[0] * AW; player.y = arena.start[1] * AH; cam.x = player.x; cam.y = player.y; },
    give: () => { player.ws.forEach((st, i) => { st.owned = true; if (WEAPONS[i].ammoMax !== Infinity) st.ammo = WEAPONS[i].ammoMax; }); },
    spawn: (type, n = 1) => { for (let i = 0; i < n; i++) { const a = rand(0, TAU); enemies.push(makeEnemy(type, player.x + Math.cos(a) * 300, player.y + Math.sin(a) * 300, false)); } },
    power: k => collect({ kind: 'power', wi: k, x: player.x, y: player.y }),
  };
  if (/[?&]bot\b/.test(location.search)) {
    const s = document.createElement('script');
    s.src = 'tools/autoplay.js?v=6';
    document.body.appendChild(s);
  }
})();
