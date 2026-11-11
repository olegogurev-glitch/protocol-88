'use strict';
/*
 * Autoplay bot for balance testing. Load the game with ?bot
 *   ?bot              watch the bot play at normal speed
 *   ?bot&speed=8      simulate 8x faster (uses the internal beat clock instead of audio)
 *   ?bot&runs=5       play 5 full runs, then print a summary to the console
 * Results are kept in window.__botResults.
 */
(() => {
  const G = window.__p88;
  const q = new URLSearchParams(location.search);
  const speed = Math.max(1, +q.get('speed') || 1);
  const runs = Math.max(1, +q.get('runs') || 1);
  const results = (window.__botResults = []);
  const PRIORITY = ['minigun', 'flamer', 'arc', 'rifle', 'saw', 'shotgun', 'smg', 'rocket', 'rail', 'pistol'];
  const idx = id => G.WEAPONS.findIndex(w => w.id === id);
  G.sim.speed = speed;
  G.sim.fakeBeat = speed > 1;

  let run = null, pickT = 0;

  function newRun() {
    run = { waves: [], t: 0, cur: null, lastHp: 100 };
    G.start();
  }

  function summarize() {
    const deaths = results.map(r => r.deathWave);
    const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
    console.log('[BOT] death waves:', deaths.join(', '), 'avg', avg.toFixed(1));
    window.__botSummary = { deaths, avg };
  }

  function finishRun() {
    results.push({
      deathWave: G.wave,
      time: Math.round(run.t),
      score: G.score,
      waves: run.waves.map(w => ({
        wave: w.wave, active: Math.round(w.active), dmg: Math.round(w.dmg), heal: Math.round(w.heal),
        minHp: Math.round(w.minHp), peak: w.peak, pistolT: Math.round(w.pistolT), firstHitT: w.firstHit,
      })),
    });
    if (results.length < runs) newRun();
    else { G.sim.onTick = null; G.sim.speed = 1; G.sim.fakeBeat = false; G.mouse.down = false; clearKeys(); summarize(); }
  }

  function clearKeys() { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) G.keys[k] = false; }

  G.sim.onTick = dt => {
    if (!run) return;
    if (G.state === 'over') { finishRun(); return; }
    if (G.state !== 'play') { clearKeys(); G.mouse.down = false; return; }
    const p = G.player;
    run.t += dt;

    // ---------------- stats
    if (!run.cur || run.cur.wave !== G.wave) {
      run.cur = { wave: G.wave, active: 0, dmg: 0, heal: 0, minHp: p.hp, peak: 0, pistolT: 0, firstHit: null };
      run.waves.push(run.cur);
    }
    const c = run.cur;
    if (G.waveActive) c.active += dt;
    const dh = p.hp - run.lastHp;
    if (dh < 0) { c.dmg -= dh; if (c.firstHit === null) c.firstHit = Math.round(c.active); } else c.heal += dh;
    run.lastHp = p.hp;
    c.minHp = Math.min(c.minHp, p.hp);
    c.peak = Math.max(c.peak, G.enemies);
    if (p.cur === 0 && G.waveActive && G.wave >= 4) c.pistolT += dt;

    // ---------------- target
    const E = G.list();
    let tgt = null, best = 1e9, tgtD = 1e9;
    for (const e of E) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if ((e.type === 'phantom' && e.cloaked && d > 200) || e.under) continue;
      const s = d - (e.elite ? 120 : 0) - (e.type === 'boomer' && d < 260 ? 160 : 0) - (e.type === 'leaper' && d < 300 ? 80 : 0);
      if (s < best) { best = s; tgt = e; tgtD = d; }
    }
    if (tgt && tgtD < 900) {
      const t = tgtD / 1100;
      G.aim(tgt.x + tgt.vx * t, tgt.y + tgt.vy * t);
      G.mouse.down = true;
    } else {
      G.mouse.down = false;
    }

    // ---------------- weapon choice (with hysteresis)
    pickT -= dt;
    if (pickT <= 0) {
      pickT = 0.6;
      for (const id of PRIORITY) {
        const i = idx(id), st = p.ws[i];
        if (!st.owned || st.ammo <= 0) continue;
        if (id === 'flamer' && tgtD > 240) continue;
        if (id === 'shotgun' && tgtD > 320) continue;
        if (i !== p.cur) G.select(i);
        break;
      }
    }

    // ---------------- movement: flee threats, dodge acid, grab pickups, stay off walls
    let mx = 0, my = 0, close = 0;
    for (const e of E) {
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const R = 260 + e.r * 3;
      if (d < R) {
        const heavy = e.type === 'brute' || e.type === 'boomer' || e.type === 'queen' || e.st === 'lunge' || e.st === 'charge';
        const w = (1 - d / R) ** 2 * (heavy ? 3 : 1);
        mx += (dx / d) * w * 3; my += (dy / d) * w * 3;
      }
      if (d < p.r + e.r + 30) close++;
    }
    for (const s of G.eshots()) {
      if (s.lob) {
        const dx = p.x - s.tx, dy = p.y - s.ty, d = Math.hypot(dx, dy) || 1;
        if (d < 110) { mx += (dx / d) * 3; my += (dy / d) * 3; }
        continue;
      }
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
      if (d > 220) continue;
      const sv = Math.hypot(s.vx, s.vy) || 1;
      if ((s.vx * dx + s.vy * dy) / (sv * d) < 0.7) continue; // not heading at us
      let px = -s.vy / sv, py = s.vx / sv;
      if (px * dx + py * dy < 0) { px = -px; py = -py; }
      mx += px * 2.5; my += py * 2.5;
    }
    for (const pk of G.pickups()) {
      if (pk.drop > 0) continue;
      const want = pk.kind === 'weapon' || pk.kind === 'upgrade' || pk.kind === 'gear' ? 3 : pk.kind === 'power' ? 1.5 : pk.kind === 'med' ? (p.hp < p.maxHp * 0.7 ? 2.2 : 0) : pk.kind === 'ammo' ? 1.2 : 1;
      if (!want) continue;
      const dx = pk.x - p.x, dy = pk.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d > 900) continue;
      mx += (dx / d) * want; my += (dy / d) * want;
    }
    for (const pl of G.pools()) {
      if (pl.kind === 'slime') continue;
      const dx = p.x - pl.x, dy = p.y - pl.y, d = Math.hypot(dx, dy) || 1;
      if (d < pl.r + 80) { const w = 4 * (1 - (d - pl.r) / 80); mx += (dx / d) * w; my += (dy / d) * w; }
    }
    const cx = 1400 - p.x, cy = 1000 - p.y, cd = Math.hypot(cx, cy) || 1;
    mx += (cx / cd) * Math.min(1.5, cd / 700); my += (cy / cd) * Math.min(1.5, cd / 700);
    // keep circling: add a tangential drift around the threat centre
    if (tgt) { const tx = p.x - tgt.x, ty = p.y - tgt.y, td = Math.hypot(tx, ty) || 1; mx += (-ty / td) * 0.6; my += (tx / td) * 0.6; }

    const ml = Math.hypot(mx, my);
    clearKeys();
    if (ml > 0.15) {
      const nx = mx / ml, ny = my / ml;
      if (nx < -0.38) G.keys.KeyA = true;
      if (nx > 0.38) G.keys.KeyD = true;
      if (ny < -0.38) G.keys.KeyW = true;
      if (ny > 0.38) G.keys.KeyS = true;
    }
    if (close >= 2 || (close >= 1 && p.hp < 40)) G.dash();
  };

  newRun();
})();
