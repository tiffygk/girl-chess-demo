#!/bin/bash
# girl chess setup: installs the two chess engines and downloads the nine
# opponent files. Safe to run again: it only fetches what is missing or
# damaged. macOS + Homebrew only for now.
set -euo pipefail

say() { echo "$*"; }
fail() { echo "$*" >&2; exit 1; }

say "girl chess setup"
say "this takes about 2 to 10 minutes the first time (two engines, nine opponent files); later runs are seconds."

[ "$(uname)" = "Darwin" ] || fail "girl chess runs on macOS. Linux and Windows are not supported and not tested."
# on Linux you can install stockfish and lc0 yourself and rerun with SKIP_BREW=1 to fetch the opponent files, at your own risk.
if [ "${SKIP_BREW:-}" != "1" ]; then
  command -v brew >/dev/null || fail "Homebrew is not installed. install it from https://brew.sh (one command, about 5 minutes), then run ./setup.sh again."
  brew list stockfish &>/dev/null || { say "installing stockfish (the chess engine)..."; brew install stockfish; }
  brew list lc0 &>/dev/null || { say "installing lc0 (runs the human-like opponent)..."; brew install lc0; }
fi

mkdir -p weights
BASE="https://github.com/CSSLab/maia-chess/releases/download/v1.0"
ELOS=(1100 1200 1300 1400 1500 1600 1700 1800 1900)
valid() { gzip -t "$1" 2>/dev/null; }
present=0
for elo in "${ELOS[@]}"; do
  f="weights/maia-$elo.pb.gz"
  [ -f "$f" ] && valid "$f" && present=$((present+1)) || true
done
if [ "$present" = "9" ]; then
  say "all 9 opponent files already present"
else
  n=0
  for elo in "${ELOS[@]}"; do
    n=$((n+1))
    f="weights/maia-$elo.pb.gz"
    if [ -f "$f" ] && valid "$f"; then continue; fi
    [ -f "$f" ] && say "maia-$elo is damaged (a download was interrupted); fetching it again"
    say "downloading maia-$elo ($n of 9)"
    ok=0
    # each curl call below retries twice on its own (--retry 2), so a person
    # may see more than three HTTP attempts before the "3 tries" sentence.
    for attempt in 1 2 3; do
      if curl -fL --retry 2 --retry-delay 2 --connect-timeout 20 -o "$f.part" "$BASE/maia-$elo.pb.gz" && valid "$f.part"; then
        mv "$f.part" "$f"; ok=1; break
      fi
      rm -f "$f.part"
    done
    [ "$ok" = "1" ] || fail "maia-$elo did not download correctly after 3 tries. check your internet connection and run ./setup.sh again."
  done
fi

say "--- checking the engines answer"
sf_out="$(printf "uci\nquit\n" | stockfish 2>/dev/null || true)"
case "$sf_out" in
  *uciok*) say "stockfish OK" ;;
  *) fail "stockfish is installed but does not answer. try: brew reinstall stockfish, then ./setup.sh again." ;;
esac
lc0_out="$(printf "uci\nquit\n" | lc0 --weights=weights/maia-1100.pb.gz 2>/dev/null || true)"
case "$lc0_out" in
  *uciok*) say "lc0 + maia OK" ;;
  *) fail "lc0 could not load weights/maia-1100.pb.gz. try: brew reinstall lc0, then delete the weights folder and run ./setup.sh again." ;;
esac
say "setup complete. next: npm run dev, then open the address it prints."
