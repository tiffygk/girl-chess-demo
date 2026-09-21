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
  brew list lc0 &>/dev/null || { say "installing lc0 (runs the human-like opponent)..."; brew install lc0; }
fi

# Stockfish is a pinned release binary, not a brew install: a Homebrew bump
# to a new major version used to turn every PR red with no code change. This
# repo downloads the official Stockfish 19 release asset once, verifies its
# sha256 against tools/engines-sha256.txt BEFORE extracting, and installs
# only the verified binary at engines/stockfish. Upgrading is a deliberate
# PR that bumps the pin (see .claude/rules/data-and-gate.md's Engine-version
# rule), never a silent brew bump. GC_ENGINE_DIR and GC_ENGINES_SHA256_FILE
# exist for tests; production always uses the defaults.
say "--- installing the pinned stockfish engine"
ENGINE_DIR="${GC_ENGINE_DIR:-engines}"
ENGINES_SHA_FILE="${GC_ENGINES_SHA256_FILE:-tools/engines-sha256.txt}"
SF_BIN="$ENGINE_DIR/stockfish"
mkdir -p "$ENGINE_DIR"

stockfish_answers_19() {
  # $1 = path to a candidate stockfish binary
  local out
  out="$(printf "uci\nquit\n" | "$1" 2>/dev/null || true)"
  case "$out" in
    *"id name Stockfish 19"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -x "$SF_BIN" ] && stockfish_answers_19 "$SF_BIN"; then
  say "stockfish OK (Stockfish 19, pinned)"
else
  ARCH="$(uname -m)"
  case "$ARCH" in
    # macOS ships one universal Mach-O binary covering both architectures,
    # so both branches name the same asset; this stays a case statement (not
    # a bare literal) so the asset name is never taken from anything but a
    # fixed list this script controls.
    arm64) ASSET="stockfish-macos-universal.tar.gz" ;;
    x86_64) ASSET="stockfish-macos-universal.tar.gz" ;;
    *) fail "girl chess does not have a pinned Stockfish 19 build for $ARCH. build Stockfish 19 yourself (https://github.com/official-stockfish/Stockfish) and put the binary at $SF_BIN." ;;
  esac

  engine_expected_sha() { awk -v f="$1" '$2==f{print $1}' "$ENGINES_SHA_FILE" 2>/dev/null; }
  # Unlike checksum_ok() for the weights below, a missing row here is a
  # failure, not "nothing to check": the engine is executable code, not a
  # data file, so an unverifiable download must never be installed.
  exp_sha="$(engine_expected_sha "$ASSET")"
  [ -n "$exp_sha" ] || fail "$ASSET has no entry in $ENGINES_SHA_FILE, so it cannot be verified. run ./setup.sh from the girl-chess-demo folder, or restore the file from git."

  TAR="$ENGINE_DIR/.download-$ASSET"
  rm -f "$TAR"
  say "downloading the pinned stockfish 19 ($ASSET)"
  curl -fL --progress-bar --retry 2 --retry-delay 2 --connect-timeout 20 -o "$TAR" \
    "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/$ASSET" \
    || { rm -f "$TAR"; fail "stockfish 19 did not download correctly. check your internet connection and run ./setup.sh again."; }

  actual_sha="$(shasum -a 256 "$TAR" | awk '{print $1}')"
  if [ "$actual_sha" != "$exp_sha" ]; then
    rm -f "$TAR"
    fail "$ASSET did not match its expected checksum in $ENGINES_SHA_FILE; refusing to install an unverified stockfish binary. the upstream file may have changed; open an issue at github.com/tiffygk/girl-chess-demo and do not run the game with an unverified engine."
  fi

  # The release tar holds the whole source tree; the one entry directly
  # inside stockfish/ that starts with "stockfish" is the binary, whatever
  # its exact name (e.g. stockfish-macos-universal).
  ENTRY="$(tar tzf "$TAR" | grep -E '^stockfish/stockfish[^/]*$' | head -n1)"
  if [ -z "$ENTRY" ]; then
    rm -f "$TAR"
    fail "$ASSET does not contain a stockfish binary at the expected path."
  fi

  TMPX="$(mktemp -d)"
  tar xzf "$TAR" -C "$TMPX" "$ENTRY"
  rm -f "$TAR"
  mv "$TMPX/$ENTRY" "$SF_BIN"
  rm -rf "$TMPX"
  chmod +x "$SF_BIN"

  stockfish_answers_19 "$SF_BIN" || { rm -f "$SF_BIN"; fail "the downloaded stockfish binary does not answer as Stockfish 19."; }
  say "stockfish OK (Stockfish 19, pinned)"
fi

mkdir -p weights
BASE="https://github.com/CSSLab/maia-chess/releases/download/v1.0"
ELOS=(1100 1200 1300 1400 1500 1600 1700 1800 1900)
# The checksum table lives at tools/weights-sha256.txt (one line per file, the
# same "<sha256>  <path>" format `shasum -a 256` prints); override with
# GC_WEIGHTS_SHA256_FILE for tests. A downloaded file that is valid gzip but
# does not match its expected checksum has been tampered with or corrupted
# in a way `gzip -t` cannot see -- gzip only proves the bytes decompress, not
# that they are the right bytes.
SHA_FILE="${GC_WEIGHTS_SHA256_FILE:-tools/weights-sha256.txt}"
[ -s "$SHA_FILE" ] || fail "tools/weights-sha256.txt is missing, so the opponent files cannot be verified. run ./setup.sh from the girl-chess-demo folder, or restore the file from git."
valid() { gzip -t "$1" 2>/dev/null; }
expected_sha() { awk -v f="weights/maia-$1.pb.gz" '$2==f{print $1}' "$SHA_FILE" 2>/dev/null; }
checksum_ok() {
  # $1 = file to check, $2 = elo. No entry for this elo in the table is not
  # a failure here -- it means nothing to check against.
  local exp actual
  exp="$(expected_sha "$2")"
  [ -n "$exp" ] || return 0
  actual="$(shasum -a 256 "$1" | awk '{print $1}')"
  [ "$actual" = "$exp" ]
}
present=0
for elo in "${ELOS[@]}"; do
  f="weights/maia-$elo.pb.gz"
  [ -f "$f" ] && valid "$f" && checksum_ok "$f" "$elo" && present=$((present+1)) || true
done
if [ "$present" = "9" ]; then
  say "all 9 opponent files already present"
else
  n=0
  for elo in "${ELOS[@]}"; do
    n=$((n+1))
    f="weights/maia-$elo.pb.gz"
    if [ -f "$f" ] && valid "$f" && checksum_ok "$f" "$elo"; then continue; fi
    if [ -f "$f" ]; then
      if ! valid "$f"; then
        say "maia-$elo is damaged (a download was interrupted); fetching it again"
      else
        say "maia-$elo does not match the expected file (wrong bytes, not an interrupted download); fetching it again"
      fi
    fi
    say "downloading maia-$elo ($n of 9)"
    ok=0
    # each curl call below retries twice on its own (--retry 2), so a person
    # may see more than three HTTP attempts before the "3 tries" sentence.
    for attempt in 1 2 3; do
      if curl -fL --progress-bar --retry 2 --retry-delay 2 --connect-timeout 20 -o "$f.part" "$BASE/maia-$elo.pb.gz" && valid "$f.part"; then
        mv "$f.part" "$f"; ok=1; break
      fi
      rm -f "$f.part"
    done
    [ "$ok" = "1" ] || fail "maia-$elo did not download correctly after 3 tries. check your internet connection and run ./setup.sh again."

    if ! checksum_ok "$f" "$elo"; then
      say "maia-$elo did not match its expected checksum; downloading it again"
      rm -f "$f"
      if curl -fL --progress-bar --retry 2 --retry-delay 2 --connect-timeout 20 -o "$f.part" "$BASE/maia-$elo.pb.gz" && valid "$f.part" && checksum_ok "$f.part" "$elo"; then
        mv "$f.part" "$f"
      else
        rm -f "$f.part"
        fail "maia-$elo still does not match the expected checksum after a second download, so it was removed. the upstream file may have changed; open an issue at github.com/tiffygk/girl-chess-demo and do not run the game with unverified opponent files."
      fi
    fi
  done
fi

say "--- checking lc0 answers"
lc0_out="$(printf "uci\nquit\n" | lc0 --weights=weights/maia-1100.pb.gz 2>/dev/null || true)"
case "$lc0_out" in
  *uciok*) say "lc0 + maia OK" ;;
  *) fail "lc0 could not load weights/maia-1100.pb.gz. try: brew reinstall lc0, then delete the weights folder and run ./setup.sh again." ;;
esac
say "setup complete. next: npm run dev, then open the address it prints."
