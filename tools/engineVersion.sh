#!/bin/bash
# Asserts the installed stockfish is the version this repo's eval fixtures
# are baselined on. Exit 0 and print the id line if it matches; exit 1 and
# print the mismatch sentence (still after the id line) otherwise. Used by
# .github/workflows/gate.yml's "engine version" step; kept as its own script
# so tools/engineVersion.test.ts can exercise the exact logic CI runs.
set -euo pipefail

EXPECTED="Stockfish 19"

id_line="$(printf "uci\nquit\n" | stockfish | grep "^id name ")"
echo "$id_line"
name="${id_line#id name }"

case "$name" in
  *"$EXPECTED"*) ;;
  *)
    echo "stockfish $name installed; this repo's eval fixtures are baselined on $EXPECTED. the game works; eval tests may differ. see .claude/rules/data-and-gate.md"
    exit 1
    ;;
esac
