#!/bin/zsh
# Rebuild music/*.mp3 from the licensed WAV masters in OST/ (both are kept out of git).
# Each track is loudness-normalised to -14 LUFS with a plain gain change and encoded to MP3 VBR (~190 kbps).
# Needs ffmpeg with libmp3lame. Run from anywhere: zsh tools/build-ost.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p music
TARGET=-14
while IFS='|' read -r orig slug title; do
  [ -f "OST/$orig" ] || { echo "missing: OST/$orig" >&2; exit 1; }
  lufs=$(ffmpeg -nostdin -hide_banner -nostats -i "OST/$orig" -af ebur128 -f null - 2>&1 | awk '/Integrated loudness/{f=1} f&&/I:/{print $2; exit}')
  gain=$(echo "$TARGET - ($lufs)" | bc)
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "OST/$orig" -af "volume=${gain}dB" -ar 44100 -ac 2 \
    -c:a libmp3lame -q:a 2 -map_metadata -1 -metadata title="$title" -metadata album="Protocol 88 OST" \
    -metadata comment="Source: $orig" "music/$slug.mp3"
  echo "$slug  (${lufs} LUFS, ${gain} dB)"
done <<'LIST'
8-bit.wav|last-transmission|Last Transmission
8 Bit Video Game Background Main.wav|first-contact|First Contact
8 Bit Gameplay Background Action Adventure Main.wav|lock-and-load|Lock and Load
(main).wav|neon-barricade|Neon Barricade
8 Bit Game Chiptune Melodic Dubstep Main.wav|plasma-heart|Plasma Heart
main.wav|blackout-protocol|Blackout Protocol
8-bit Chiptune (Main Version).wav|overclock|Overclock
8 bit melodic dubstep main.wav|starfall|Starfall
8 Bit Retro Game Dubstep Adventure Main.wav|gravity-well|Gravity Well
Main 3.wav|hyperdrive|Hyperdrive
main 4.wav|red-sector|Red Sector
8bit Metal.wav|iron-queen|Iron Queen
Main Version (1 min 49 sec).wav|mothership|Mothership
LIST
