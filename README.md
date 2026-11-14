# Protocol 88

A fast top-down alien wave shooter with a licensed 8-bit soundtrack (plus the original procedural 80s rock × 8-bit score as an option).
Vanilla JavaScript + Canvas 2D + Web Audio — no build step.

## Run

```bash
python3 -m http.server 8088
```

Then open <http://localhost:8088>. Click once to power on the audio, again to deploy.
It has to be served over HTTP: opened as a `file://` page the browser blocks the music files and the game falls back to the synth score.
Options → Soundtrack switches between STUDIO and SYNTH.

## Controls

| Keyboard / mouse | Gamepad | Action |
|---|---|---|
| WASD | Left stick | Move |
| Mouse | Right stick | Aim (right stick also fires) |
| Click | RT | Fire |
| Space / Shift / RMB | LT / A | Dash |
| 1–0, wheel, Q | LB / RB (previous / next), d-pad, Y, B (last weapon) | Weapons |
| F / Enter | X | Call the next wave early |
| Esc / P | Start | Pause + options |
| M / N | Back (next track) | Music on/off, next track |

## Controller haptics

Rumble works on any pad the browser can vibrate (Chrome, Edge, Safari): each weapon has its own kick, plus hits, explosions, boss slams, dodges, a low-health heartbeat and a long rumble on death. Options → RUMBLE sets OFF / LOW / FULL.
DualSense adaptive triggers (Chrome / Edge on a computer): Options → DUALSENSE TRIGGERS → ON, then click the row (or press Right on the keyboard) and pick the controller in the browser's device list. Browsers only open that list from a mouse click or a key press, never from a gamepad button. R2's resistance follows the weapon in hand, and L2 stiffens while the dash recharges. The browser remembers the pairing. The code is in `js/haptics.js`.

## Starting kits

Lifetime challenges unlock starting kits (a weapon plus gear or a perk). Pick one on the main menu or on the game-over screen with A / D, the arrow keys, the d-pad or the bumpers.
Progress lives in `localStorage` under `p88-profile`. Bot runs (`?bot`) never read or write any saved data (profile, best score, high scores, settings), so the bot can run as a live preview next to a real save.

## Languages

English and Russian. The game picks Russian when the browser's preferred language is Russian; Options → LANGUAGE switches at any time (saved with the other settings), and `?lang=ru` / `?lang=en` in the URL overrides both.
All text lives in English in the code and goes through `I18N.t()` when drawn; `js/i18n.js` holds the Russian table (templates use `{0}`, `{1}` slots). Russian swaps the UI face to Tektur, since Chakra Petch has no Cyrillic.

## Project layout

- `index.html` — page shell. Bump the `?v=` on the script tags after changing code so browsers don't serve stale copies.
- `js/game.js` — gameplay, rendering, HUD, input.
- `js/i18n.js` — translations (Russian) and language detection.
- `js/haptics.js` — controller rumble and DualSense trigger effects (WebHID).
- `js/audio.js` — the studio soundtrack player, the procedural synth score (8 songs) and all sound effects.
- `music/` — the studio soundtrack (MP3). Track names, roles and tempos are in the `OST` table in `js/audio.js`; sources in `music/CREDITS.md`.
  The tracks are licensed stock music (Envato Elements) for use in this game only; they are not licensed for reuse elsewhere.
  The WAV masters live in `OST/`, which is not in the repo. To rebuild the MP3s from them, run `zsh tools/build-ost.sh` (needs ffmpeg).
  If the MP3s are missing, the game plays the synth score.
- `tools/autoplay.js` — balance-testing bot.
- `tools/build-ost.sh` — converts the WAV masters in `OST/` into `music/*.mp3`.

## Testing tools

- `?bot` — watch an autoplay bot. `?bot&speed=8&runs=4` simulates four runs at 8× and logs the waves it died on.
- `?debug` — exposes `window.__p88` (god mode, skip waves, spawn aliens, give gear or perks with `gear(key)`, force a supply drop with `drop()`, force the next wave's modifier with `mod(key)`, spawn an affixed champion with `champ(type, [affixes])`, read the profile with `profile`, unlock every kit with `unlockAll()`, switch arenas, zoom).
