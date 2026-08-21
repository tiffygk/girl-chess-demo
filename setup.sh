#!/bin/bash
set -euo pipefail
echo "girl-chess setup"
command -v brew >/dev/null || { echo "Homebrew required: https://brew.sh"; exit 1; }
brew list stockfish &>/dev/null || brew install stockfish
brew list lc0 &>/dev/null || brew install lc0
mkdir -p weights
BASE="https://github.com/CSSLab/maia-chess/releases/download/v1.0"
for elo in 1100 1200 1300 1400 1500 1600 1700 1800 1900; do
  f="weights/maia-$elo.pb.gz"
  [ -f "$f" ] || curl -fL -o "$f" "$BASE/maia-$elo.pb.gz"
done
echo "--- sanity: stockfish uci handshake"
printf "uci\nquit\n" | stockfish | grep -q uciok && echo "stockfish OK"
echo "--- sanity: lc0 loads maia-1100"
printf "uci\nquit\n" | lc0 --weights=weights/maia-1100.pb.gz 2>/dev/null | grep -q uciok && echo "lc0+maia OK"
echo "setup complete"
