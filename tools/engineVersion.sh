#!/bin/bash
# Asserts the installed stockfish is the version this repo's eval fixtures
# are baselined on. Exit 0 and print the id line if it matches; exit 1 and
# print the mismatch sentence (still after the id line) otherwise. Used by
# .github/workflows/gate.yml's "engine version" step; kept as its own script
# so tools/engineVersion.test.ts can exercise the exact logic CI runs.
set -euo pipefail

EXPECTED="Stockfish 19"

# Prefer the pinned engines/stockfish setup.sh installs by checksum (see
# server/engines/paths.ts's resolveStockfishPath), same preference order the
# server and doctor use; GC_STOCKFISH_BIN overrides for tests.
SF="${GC_STOCKFISH_BIN:-}"
if [ -z "$SF" ]; then
  if [ -x engines/stockfish ]; then SF=engines/stockfish; else SF=stockfish; fi
fi

out="$(printf "uci\nquit\n" | "$SF")"
id_line="$(printf '%s\n' "$out" | grep "^id name " || true)"
if [ -z "$id_line" ]; then
  echo "stockfish answered without an id name line; this repo's eval fixtures are baselined on $EXPECTED. the game works; eval tests may differ. see .claude/rules/data-and-gate.md"
  exit 1
fi
echo "$id_line"
name="${id_line#id name }"

case "$name" in
  *"$EXPECTED"*) ;;
  *)
    echo "stockfish $name installed; this repo's eval fixtures are baselined on $EXPECTED. the game works; eval tests may differ. see .claude/rules/data-and-gate.md"
    exit 1
    ;;
esac
