// Shared, dependency-free count-based isolation check for her live db.
//
// Fix-wave F5 (2026-07-29): a sha256 before/after of her LIVE db throws the
// moment she plays a move and SQLite folds its write-ahead log into the
// main file -- no data touched at all, hash moves anyway. gate.ts's own
// header documents removing exactly this pattern from the owner-db check
// for the same reason. The project's standing rule: COUNT games and moves,
// ask sqlite for its own integrity_check, readonly, never a hash. Counts
// only ever go UP while she plays -- a real isolation violation (a script
// writing to, or corrupting, her live db) is a DECREASE or a broken
// integrity_check, never a same-or-higher count.
//
// Lives in its own module (not inside replay-check.ts or truth-check.ts)
// specifically so both tools/replay-check.ts and tools/truth-check.ts can
// import it without creating an import cycle: replay-check.ts already
// imports resolveRealDbPath/copyScratchDb/reconstructPvLine FROM
// truth-check.ts, so truth-check.ts importing this check back from
// replay-check.ts would form a cycle. One shared, standalone home; two
// callers; no reimplementation.
import Database from "better-sqlite3";

export interface DbCountSnapshot {
  games: number;
  moves: number;
  integrity: string;
}

export function countDbSnapshot(p: string): DbCountSnapshot {
  const db = new Database(p, { readonly: true });
  try {
    const integrity = (db.pragma("integrity_check") as { integrity_check: string }[])[0]
      .integrity_check;
    const games = (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
    const moves = (db.prepare("SELECT COUNT(*) c FROM moves").get() as { c: number }).c;
    return { games, moves, integrity };
  } finally {
    db.close();
  }
}

// Pure, exported for tools/replay-check.test.ts and tools/truth-check.test.ts.
// Returns a reason string (not a throw) so a test can assert on the
// message without wrapping every case in try/catch.
export function checkDbIntact(before: DbCountSnapshot, after: DbCountSnapshot): string | undefined {
  if (after.integrity !== "ok") {
    return `data/girlchess.db integrity_check returned "${after.integrity}" after this run -- investigate immediately`;
  }
  if (after.games < before.games || after.moves < before.moves) {
    return (
      `data/girlchess.db lost rows during this run (games ${before.games} -> ${after.games}, ` +
      `moves ${before.moves} -> ${after.moves}) -- isolation was violated. Investigate immediately; do not trust this run's results.`
    );
  }
  return undefined;
}
