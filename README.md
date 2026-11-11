# Protocol 88

A fast top-down alien wave shooter with a procedural 80s rock × 8-bit soundtrack.
Vanilla JavaScript + Canvas 2D + Web Audio — no build step, no assets.

## Run

```bash
python3 -m http.server 8088
```

Then open <http://localhost:8088>. Click once to power on the audio, again to deploy.

## Controls

| Keyboard / mouse | Gamepad | Action |
|---|---|---|
| WASD | Left stick | Move |
| Mouse | Right stick | Aim (right stick also fires) |
| Click | RT / RB | Fire |
| Space / Shift / RMB | LT / A | Dash |
| 1–0, wheel, Q | Y, d-pad, LB / B | Weapons |
| F / Enter | X | Call the next wave early |
| Esc / P | Start | Pause + options |
| M / N | Back (next track) | Music on/off, next track |

## Project layout

- `index.html` — page shell. Bump the `?v=` on the script tags after changing code so browsers don't serve stale copies.
- `js/game.js` — gameplay, rendering, HUD, input.
- `js/audio.js` — the soundtrack sequencer (8 songs) and all sound effects.
- `tools/autoplay.js` — balance-testing bot.

## Testing tools

- `?bot` — watch an autoplay bot. `?bot&speed=8&runs=4` simulates four runs at 8× and logs the waves it died on.
- `?debug` — exposes `window.__p88` (god mode, skip waves, spawn aliens, give gear, switch arenas, zoom).
