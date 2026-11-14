// Protocol 88 - controller haptics.
//
// Rumble: the game queues short "pulses" (strong = the heavy low motor, weak = the light high
// motor, a length, optional delay and fade). Every frame tick() mixes the live pulses (loudest
// wins) and drives the pad through the Gamepad API's vibrationActuator (Chrome / Edge / Safari),
// or Firefox's hapticActuators as a fallback.
//
// DualSense adaptive triggers: browsers don't expose them through the Gamepad API, so the player
// pairs the controller once over WebHID (Chrome / Edge, from Options). After that the page talks
// to it directly with DualSense output reports (USB report 0x02, Bluetooth report 0x31 + CRC32):
// the trigger resistance follows the weapon in hand, and the rumble goes through the same reports.
// Chrome remembers the pairing, so later visits reconnect without asking.
window.HAPTICS = (() => {
  const HID = 'hid' in navigator;
  let gain = 1;
  const pulses = [];
  const last = { s: 0, w: 0, t: 0 };

  // ------------------------------------------------------------------ rumble mixer
  // s, w: 0..1, ms: length; o.delay (ms) starts it later, o.fade = false holds it flat
  function rumble(s, w, ms, o = {}) {
    if (gain <= 0) return;
    pulses.push({ s, w, t0: performance.now() + (o.delay || 0), dur: ms, fade: o.fade !== false });
    if (pulses.length > 48) pulses.shift();
  }
  function level(now) {
    let s = 0, w = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], age = now - p.t0;
      if (age >= p.dur) { pulses.splice(i, 1); continue; }
      if (age < 0) continue;
      const k = p.fade ? 1 - age / p.dur : 1;
      if (p.s * k > s) s = p.s * k;
      if (p.w * k > w) w = p.w * k;
    }
    return [Math.min(1, s * gain), Math.min(1, w * gain)];
  }
  function stop() { pulses.length = 0; }

  function padRumble(gp, s, w, now) {
    const act = gp.vibrationActuator;
    if (act && act.playEffect) {
      if (!s && !w) { if (act.reset) act.reset().catch(() => {}); else act.playEffect('dual-rumble', { duration: 0, strongMagnitude: 0, weakMagnitude: 0 }).catch(() => {}); return; }
      act.playEffect('dual-rumble', { startDelay: 0, duration: 110, strongMagnitude: s, weakMagnitude: w }).catch(() => {});
    } else if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) {
      gp.hapticActuators[0].pulse(Math.max(s, w), s || w ? 110 : 0);
    }
  }

  // gp: the Gamepad in use (or null)
  function tick(gp) {
    const now = performance.now();
    const [s, w] = level(now);
    const off = !s && !w, wasOff = !last.s && !last.w;
    if (off && wasOff) return;
    const changed = Math.abs(s - last.s) > 0.04 || Math.abs(w - last.w) > 0.04 || off !== wasOff;
    if (!changed && now - last.t < 70) return; // a held level is re-sent before its 110 ms run out
    const jump = s > last.s + 0.1 || w > last.w + 0.1;
    if (!off && !jump && now - last.t < 33) return; // fades update at ~30 Hz; a new hit goes out at once
    last.s = s; last.w = w; last.t = now;
    if (ds.dev) dsMotors(s, w);
    else if (gp) padRumble(gp, s, w, now);
  }

  // ------------------------------------------------------------------ DualSense trigger effects
  // positions are the trigger's 10 travel zones (0 = released, 9 = fully pulled), strengths 1..8
  const FX = {
    off: () => [0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    // steady resistance from `pos` to the end of the pull
    feedback(pos, str) {
      const f = (str - 1) & 7;
      let zones = 0, force = 0;
      for (let i = pos; i < 10; i++) { zones |= 1 << i; force += f * 2 ** (3 * i); }
      return [0x21, zones & 0xff, zones >> 8, force & 0xff, (force >>> 8) & 0xff, (force >>> 16) & 0xff, (force >>> 24) & 0xff, 0, 0, 0, 0];
    },
    // a wall between `start` and `end` (2..8) that gives way with a snap - a gun's sear
    weapon(start, end, str) {
      const z = (1 << start) | (1 << end);
      return [0x25, z & 0xff, z >> 8, (str - 1) & 7, 0, 0, 0, 0, 0, 0, 0];
    },
    // the trigger buzzes at `freq` Hz once pulled past `pos`
    vibration(pos, amp, freq) {
      const a = (amp - 1) & 7;
      let zones = 0, ampl = 0;
      for (let i = pos; i < 10; i++) { zones |= 1 << i; ampl += a * 2 ** (3 * i); }
      return [0x26, zones & 0xff, zones >> 8, ampl & 0xff, (ampl >>> 8) & 0xff, (ampl >>> 16) & 0xff, (ampl >>> 24) & 0xff, 0, 0, freq & 0xff, 0];
    },
  };

  const ds = {
    dev: null, bt: false, seq: 0,
    want: { r: FX.off(), l: FX.off(), s: 0, w: 0 },   // what the controller should be doing
    sent: { r: '', l: '', s: -1, w: -1 },              // what it was last told
    busy: false, failed: false,
  };
  let enabled = false;

  function setTriggers(r, l) {
    if (!ds.dev) return;
    ds.want.r = r || FX.off(); ds.want.l = l || FX.off();
    dsFlush();
  }
  function dsMotors(s, w) {
    ds.want.s = Math.round(s * 255); ds.want.w = Math.round(w * 255);
    dsFlush();
  }

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // one report at a time; whatever changed while it was in flight goes out right after
  async function dsFlush() {
    if (!ds.dev || ds.busy) return;
    const W = ds.want, S = ds.sent;
    const rk = W.r.join(), lk = W.l.join();
    const trig = rk !== S.r || lk !== S.l, mot = W.s !== S.s || W.w !== S.w;
    if (!trig && !mot) return;
    const c = new Uint8Array(47);
    if (mot) { c[0] |= 0x03; c[2] = W.w; c[3] = W.s; }  // compatible vibration + haptics select; right motor = weak
    if (trig) { c[0] |= 0x0c; c.set(W.r, 10); c.set(W.l, 21); }
    S.r = rk; S.l = lk; S.s = W.s; S.w = W.w;
    ds.busy = true;
    try {
      if (ds.bt) {
        const d = new Uint8Array(77);
        d[0] = ds.seq << 4; ds.seq = (ds.seq + 1) & 15;
        d[1] = 0x10;
        d.set(c, 2);
        const crc = crc32([0xa2, 0x31, ...d.subarray(0, 73)]);
        d[73] = crc & 0xff; d[74] = (crc >>> 8) & 0xff; d[75] = (crc >>> 16) & 0xff; d[76] = crc >>> 24;
        await ds.dev.sendReport(0x31, d);
      } else {
        await ds.dev.sendReport(0x02, c);
      }
    } catch (e) {
      if (!ds.failed) console.warn('[haptics] DualSense report failed', e);
      ds.failed = true;
    }
    ds.busy = false;
    dsFlush();
  }

  const isDS = d => d.vendorId === 0x054c && (d.productId === 0x0ce6 || d.productId === 0x0df2); // DualSense, DualSense Edge
  async function open(dev) {
    try {
      if (!dev.opened) await dev.open();
    } catch (e) { console.warn('[haptics] could not open the DualSense', e); return false; }
    const outs = dev.collections.flatMap(c => (c.outputReports || []).map(r => r.reportId));
    ds.dev = dev; ds.bt = !outs.includes(0x02); ds.failed = false;
    ds.sent = { r: '', l: '', s: -1, w: -1 };
    ds.want = { r: FX.off(), l: FX.off(), s: 0, w: 0 };
    dsFlush();
    return true;
  }
  async function release() {
    const dev = ds.dev;
    if (!dev) return;
    ds.want = { r: FX.off(), l: FX.off(), s: 0, w: 0 };
    while (ds.busy) await new Promise(r => setTimeout(r, 10));
    await dsFlush();
    ds.dev = null;
    try { await dev.close(); } catch (e) { /* already gone */ }
  }

  // turn the trigger feature on or off. On: reconnects a controller paired before; with
  // `ask` (only from a click or key press - the browser's rule) it opens the device chooser.
  async function enableTriggers(on, ask) {
    enabled = on;
    if (!HID) return false;
    if (!on) { await release(); return false; }
    if (ds.dev) return true;
    try {
      const known = (await navigator.hid.getDevices()).filter(isDS);
      if (known.length && await open(known[0])) return true;
      if (!ask) return false;
      const picked = (await navigator.hid.requestDevice({ filters: [{ vendorId: 0x054c, productId: 0x0ce6 }, { vendorId: 0x054c, productId: 0x0df2 }] })).filter(isDS);
      return picked.length ? open(picked[0]) : false;
    } catch (e) {
      console.warn('[haptics] pairing failed', e);
      return false;
    }
  }
  if (HID) {
    navigator.hid.addEventListener('connect', e => { if (enabled && !ds.dev && isDS(e.device)) open(e.device); });
    navigator.hid.addEventListener('disconnect', e => { if (e.device === ds.dev) ds.dev = null; });
  }
  // never leave the triggers stiff after the page goes away
  addEventListener('pagehide', () => { if (ds.dev) { ds.want.r = FX.off(); ds.want.l = FX.off(); ds.want.s = ds.want.w = 0; dsFlush(); } });

  return {
    rumble, tick, stop, FX, setTriggers, enableTriggers,
    setGain(g) { gain = g; if (g <= 0) stop(); },
    get hid() { return HID; },
    get paired() { return !!ds.dev; },
  };
})();
