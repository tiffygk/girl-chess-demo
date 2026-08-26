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
sf_out="$(printf "uci\nquit\n" | stockfish 2>/dev/null || true)"
case "$sf_out" in
  *uciok*) echo "stockfish OK" ;;
  *) echo "stockfish did not answer the uci handshake. try: brew reinstall stockfish"; exit 1 ;;
esac
echo "--- sanity: lc0 loads maia-1100"
lc0_out="$(printf "uci\nquit\n" | lc0 --weights=weights/maia-1100.pb.gz 2>/dev/null || true)"
case "$lc0_out" in
  *uciok*) echo "lc0+maia OK" ;;
  *) echo "lc0 did not load weights/maia-1100.pb.gz. try: brew reinstall lc0, then delete weights/ and rerun"; exit 1 ;;
esac
echo "setup complete"
