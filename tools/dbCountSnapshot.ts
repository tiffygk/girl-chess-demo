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
//
// union finding 2 (review-union.md, fix wave 1): resolveRealDbPath used to
// live in truth-check.ts, which runs `resolveRealDbPath(REPO_ROOT)` as
// top-level module code the instant the module is IMPORTED, not just when
// it's run as a script. That's fine for replay-check.ts (which only ever
// runs truth-check.ts's exports inside its own standalone-script
// subprocess), but it makes truth-check.ts unsafe for tools/gate.ts to
// import directly: gate.ts needs to catch the "no db anywhere" case
// in-process and print SKIPPED, and a static import throwing during module
// evaluation happens before any of gate.ts's own try/catch runs. Moving
// resolveRealDbPath here -- a dependency-free module with no top-level
// execution -- lets gate.ts import it (and the checkOwnerDb wrapper below)
// without dragging in truth-check.ts's eager db resolution. truth-check.ts
// and replay-check.ts still get it via re-export, so neither of their
// import lines had to change.
import fs from "fs";
import path from "path";
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

// The owner plays on the MAIN worktree; every OTHER worktree has no
// data/girlchess.db of its own by default. Without this, a tool run from
// inside a worktree throws "real db not found" instead of checking her
// real history.
//
// Fix-wave F2 (2026-07-29): the old order tried <repoRoot>/data/
// girlchess.db BEFORE the main worktree, with no freshness or size check --
// data/* is gitignored, so a stale/demo snapshot dropped in a worktree
// silently became the entire corpus every downstream check ran against,
// and printed nothing to say so. Resolution is live-db-first:
//   1. GC_DB_PATH env override -- an explicit escape hatch (tests, CI).
//   2. the main worktree's db -- the source of truth whenever it exists.
//      Never written to (see copyScratchDb in truth-check.ts); only ever
//      the COPY SOURCE for a WAL-safe scratch snapshot.
//   3. <repoRoot>/data/girlchess.db -- last resort, only when the main
//      worktree db is genuinely absent (a fresh clone, CI, a worktree
//      deliberately given its own copy), and only once it proves itself
//      non-empty by COUNTING games (never by hashing).
// Every caller is expected to log the returned `source` once, at the top
// of its run, so a stale read is visible instead of silent.
const MAIN_WORKTREE_DB =
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/data/girlchess.db";

export interface DbResolution {
  path: string;
  source: string;
}

// Readonly, count-based, never a hash. Returns null (not 0) when the file
// is missing or not a real/openable sqlite db, so "0 games" and "not a db"
// are distinguishable in the caller's error message.
function countGamesReadonly(p: string): number | null {
  if (!fs.existsSync(p)) return null;
  try {
    const db = new Database(p, { readonly: true });
    try {
      return (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function resolveRealDbPath(
  repoRoot: string,
  mainWorktreeDb: string = MAIN_WORKTREE_DB
): DbResolution {
  if (process.env.GC_DB_PATH) {
    return { path: process.env.GC_DB_PATH, source: "GC_DB_PATH override" };
  }
  if (fs.existsSync(mainWorktreeDb)) {
    return { path: mainWorktreeDb, source: "main worktree (live db, source of truth)" };
  }
  const local = path.join(repoRoot, "data", "girlchess.db");
  const localGames = countGamesReadonly(local);
  if (localGames != null && localGames > 0) {
    return {
      path: local,
      source: `local worktree copy (main worktree db not found at ${mainWorktreeDb}; verified ${localGames} games by count, not hash)`,
    };
  }
  throw new Error(
    `no usable db found: main worktree db missing at ${mainWorktreeDb}, and local ${local} is ` +
      `${localGames == null ? "missing or unreadable" : "empty (0 games)"} -- nothing to copy from`
  );
}

export type OwnerDbCheckStatus = "ok" | "skipped" | "fail";

export interface OwnerDbCheckResult {
  status: OwnerDbCheckStatus;
  // "ok": "N games, N moves, integrity ok". "skipped": why no db was
  // reachable at all. "fail": the specific integrity/emptiness problem.
  detail: string;
}

// union finding U2 (review-union.md, fix wave 1): tools/gate.ts's owner-db
// precheck used to hardcode DB_PATH = "data/girlchess.db" resolved against
// process.cwd() -- a path that exists in exactly zero git worktrees in this
// repo (the main worktree's cwd is the only place it would resolve). Every
// gate run from ANY worktree hit `if (!existsSync(DB_PATH)) return
// undefined` and printed a bare "ok" indistinguishable from a check that
// had actually verified her history. This wraps the SAME resolution
// resolveRealDbPath/truth-check.ts already uses (never a second resolver)
// so the gate's precheck finds the real db from any worktree, and makes
// "skipped because no db anywhere" a status the caller cannot confuse with
// "ok because it ran and passed" -- that distinction is the whole point of
// the fix. Pure and side-effect-free beyond the readonly db open, so it is
// directly unit-testable without spawning gate.ts's own process.
export function checkOwnerDb(repoRoot: string, mainWorktreeDb?: string): OwnerDbCheckResult {
  let resolution: DbResolution;
  try {
    resolution = resolveRealDbPath(repoRoot, mainWorktreeDb);
  } catch (err) {
    // resolveRealDbPath's only throw path is "no usable db found anywhere"
    // -- a fresh clone or CI, the legitimate case the old gate.ts comment
    // named. That is NOT the same thing as "ok": the check did not run,
    // and must say so rather than printing a bare ok that reads identically
    // to a check that verified her history.
    return { status: "skipped", detail: (err as Error).message };
  }
  const snap = countDbSnapshot(resolution.path); // readonly open, nothing else, ever
  if (snap.integrity !== "ok") {
    return { status: "fail", detail: `sqlite integrity_check returned "${snap.integrity}"` };
  }
  if (snap.games === 0) {
    return { status: "fail", detail: "the games table is EMPTY -- her history is gone" };
  }
  return { status: "ok", detail: `${snap.games} games, ${snap.moves} moves, integrity ok` };
}
