#!/bin/bash
# Identifier scan for the committed demo db. Reads every TEXT value in every
# table and greps it for shapes that should never ship: absolute home paths,
# email addresses, phone numbers, API-key prefixes. Generic patterns live
# here; anything owner-specific (a name, a handle) comes from an OPTIONAL
# second argument, a file outside this repo with one extended regex per
# line, so the public tool never names the person it protects.
# Exit 0 on zero hits, 1 otherwise. Readonly throughout.
set -euo pipefail
DB="${1:?usage: demo-db-scan.sh <db> [extra-patterns-file]}"
EXTRA="${2:-}"
# The phone shape is digit-bounded (3-3-4 grouping, no run of 8+ bare digits)
# so ISO timestamps (2026-08-26 14:03:11) and long integers do not match.
PAT='/Users/|/home/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(^|[^0-9])(\+[0-9]{1,3}[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}([^0-9]|$)|sk-ant-|AKIA[0-9A-Z]{12}|ghp_[A-Za-z0-9]{20,}'
if [ -n "$EXTRA" ]; then
  [ -f "$EXTRA" ] || { echo "extra patterns file not found: $EXTRA"; exit 2; }
  while IFS= read -r line; do [ -n "$line" ] && PAT="$PAT|$line"; done < "$EXTRA"
fi
hits=0; values=0; columns=0
for table in $(sqlite3 -readonly "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); do
  for col in $(sqlite3 -readonly "$DB" "SELECT name FROM pragma_table_info('$table') WHERE type LIKE '%TEXT%' OR type = ''"); do
    columns=$((columns+1))
    n="$(sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM \"$table\" WHERE \"$col\" IS NOT NULL")"
    values=$((values+n))
    c="$(sqlite3 -readonly -newline $'\x1e' "$DB" "SELECT \"$col\" FROM \"$table\" WHERE \"$col\" IS NOT NULL" | tr $'\x1e' '\n' | grep -icE "$PAT" || true)"
    if [ "$c" != "0" ]; then echo "$table.$col: $c"; hits=$((hits+c)); fi
  done
done
echo "scan: $hits hits over $values text values in $columns columns"
[ "$hits" = "0" ]
