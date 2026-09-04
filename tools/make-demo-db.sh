#!/bin/bash
# Regenerate data/girlchess-demo.db, the scrubbed play history committed so the
# debrief has real games to show on a fresh clone.
#
# The 2026-07-21 original was made by hand from a handoff brief, and two things
# went wrong that this script exists to prevent. Its curation step was optional
# and got skipped, so the demo carried 133 games and 625 moves, nearly all of
# them abandoned dev sessions. And it could only scrub tables that existed on
# the day it ran: coach_notes was added later and holds the owner's verbatim
# notes, so a hand-repeat of the old recipe would have published them.
#
# Reads the real db through a READONLY handle and never writes to it.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-data/girlchess.db}"
OUT="data/girlchess-demo.db"
TMP="$(mktemp -t girlchess-demo).db"
trap 'rm -f "$TMP"' EXIT

[ -f "$SRC" ] || { echo "no source db at $SRC"; exit 1; }

# Refuse to run mid-game: .backup on a live db is fine, but a half-played game
# in the demo is not what anyone wants to see.
live="$(sqlite3 -readonly "$SRC" "SELECT COUNT(*) FROM games g JOIN moves m ON m.game_id=g.id WHERE g.ended_at IS NULL AND m.moved_at > datetime('now','-30 minutes');")"
[ "$live" = "0" ] || { echo "a game looks in progress (moves in the last 30 min). try again later."; exit 1; }

# .backup, never cp: the real db runs in WAL mode and a raw file copy is torn.
sqlite3 -readonly "$SRC" ".backup '$TMP'"

# Fail closed on schema drift. Every table must be named below as scrubbed,
# filtered with its game, or deliberately kept. A table this script has never
# heard of is REFUSED rather than carried into the demo db whole. This is how
# coach_notes nearly shipped: it was added after the original hand recipe was
# written, so the recipe could not know to scrub it. Patching that one table
# fixed one instance; this covers the next one.
KNOWN="advice_traces chat_messages coach_notes game_events games mode_timers moves sessions turning_points verdicts"
actual="$(sqlite3 "$TMP" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")"
unknown=""
for t in $actual; do
  case " $KNOWN " in *" $t "*) ;; *) unknown="$unknown $t" ;; esac
done
if [ -n "$unknown" ]; then
  echo "REFUSING: table(s) this script does not know how to handle:$unknown"
  echo "Decide for each one whether it holds private data, then add it to KNOWN"
  echo "and give it a DELETE or a filter below. Do not just add it to KNOWN."
  exit 1
fi

sqlite3 "$TMP" <<'SQL'
BEGIN;
DELETE FROM chat_messages;                                    -- her coach conversations
DELETE FROM coach_notes;                                      -- her verbatim cross-game notes
DELETE FROM advice_traces WHERE output LIKE '[backend error]%'; -- failures, and the only rows carrying local paths
UPDATE advice_traces SET feedback_text = NULL;                -- keep the thumbs rating, drop the text she typed

CREATE TEMP TABLE keep AS
  SELECT g.id FROM games g
  WHERE g.ended_at IS NOT NULL
    AND (SELECT COUNT(*) FROM moves m WHERE m.game_id = g.id) >= 10;

DELETE FROM moves          WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM game_events    WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM verdicts       WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM advice_traces  WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM turning_points WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM chat_messages  WHERE game_id NOT IN (SELECT id FROM keep);
DELETE FROM games          WHERE id      NOT IN (SELECT id FROM keep);
COMMIT;
PRAGMA journal_mode=DELETE;
VACUUM;
SQL

# Assert the scrub actually happened rather than trusting that it did.
fail=0
check() { [ "$2" = "$3" ] || { echo "SCRUB CHECK FAILED: $1 is $2, expected $3"; fail=1; }; }
check "chat_messages"  "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM chat_messages;')" 0
check "coach_notes"    "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM coach_notes;')" 0
check "feedback_text"  "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM advice_traces WHERE feedback_text IS NOT NULL;')" 0
check "unfinished/short games" "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM games g WHERE g.ended_at IS NULL OR (SELECT COUNT(*) FROM moves m WHERE m.game_id=g.id) < 10;')" 0
check "integrity"      "$(sqlite3 "$TMP" 'PRAGMA integrity_check;')" "ok"
check "journal mode"   "$(sqlite3 "$TMP" 'PRAGMA journal_mode;')" "delete"
# Prove the readonly path works with NO sidecars present, which is the only
# state a fresh clone ever sees. Checking the pragma alone would not catch it.
rm -f "$TMP-wal" "$TMP-shm"
check "readonly open"  "$(sqlite3 -readonly "$TMP" 'SELECT COUNT(*) FROM games;' 2>/dev/null || echo FAILED)" "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM games;')"
# Same generic scan the publishing rules require before any push that
# changes the demo db; pass GC_SCAN_EXTRA_PATTERNS (a file outside the repo)
# to add owner-specific patterns.
check "identifier scan" "$(tools/demo-db-scan.sh "$TMP" ${GC_SCAN_EXTRA_PATTERNS:-} >/dev/null 2>&1 && echo 0 || echo 1)" 0
# The 2026-09-01 side column: a demo db without it cannot run replay-check's
# conversion rules on a fresh clone (found 2026-09-04).
check "moves.side populated" "$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM moves WHERE side IS NULL;' 2>/dev/null || echo missing)" 0
[ "$fail" = "0" ] || { echo "refusing to install a db that failed its own checks"; exit 1; }

rm -f "$OUT-wal" "$OUT-shm"
mv "$TMP" "$OUT"
trap - EXIT
sqlite3 -readonly "$OUT" "SELECT 'demo db written: '||(SELECT COUNT(*) FROM games)||' games, '||(SELECT COUNT(*) FROM moves)||' moves, '||(SELECT COUNT(*) FROM turning_points)||' turning points';"
