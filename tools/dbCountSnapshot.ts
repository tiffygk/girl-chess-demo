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
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

// The committed demo db is a fixture. No resolution branch, including the
// GC_DB_PATH override, may hand it to a tool that writes (final review of
// the 2026-09-04 security round).
// server/store/db.ts exports its own DEMO_DB_BASENAME of the same name and
// value; the two stay separate because tools/ must not import server/store
// at load time.
export const DEMO_DB_BASENAME = "girlchess-demo.db";

// Mirrors replay-check.ts's REGEN_MIN_CANDIDATES floor (tools/replay-check.ts,
// ~line 485): the rule-checkers need enough finished games to say anything.
// A fresh clone that has played one game of its own would otherwise run
// truth-check/replay-check against that 1-game personal db instead of the
// 51-game committed corpus, and replay-check's own floor then fails outright
// (its regen-candidate count comes from those finished games). Below this
// floor, resolveRealDbPath prefers the committed demo db over a personal db
// that exists but is too small to check.
export const MIN_FINISHED_GAMES = 5;

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
//
// union finding (review-union.md, fix wave 2): this used to be a HARDCODED
// ABSOLUTE PATH containing the vault path. That is fragile on its face --
// this repo has already moved once (the 2026-07-28 owner reorg made the old
// ~/girl-chess path dead) and was displaced again by an agent on
// 2026-07-29 (CLAUDE.md's Directory rule) -- and a silent move means
// resolution falls through to the local-worktree-copy branch (or throws)
// with no signal beyond a changed `source` string nobody is watching in
// real time. Deriving the path from git instead means it self-corrects the
// moment the repo moves: `git rev-parse --path-format=absolute
// --git-common-dir` returns the shared .git directory regardless of which
// worktree asks, and that directory's PARENT is always the main worktree
// root (git puts the shared .git at <mainWorktreeRoot>/.git; linked
// worktrees get <mainWorktreeRoot>/.git/worktrees/<name> instead, which is
// why --git-common-dir -- not --git-dir -- is the one that always points
// back to the shared root). No hardcoded fallback path: a public repo must
// not name the owner's home directory, and a fresh clone's own
// data/girlchess.db is the only sensible answer when git cannot tell us
// otherwise (resolveRealDbPath falls further back from there, to
// data/girlchess-demo.db, when even that local copy is empty or missing).
//
// Pure with respect to program state (spawns `git`, touches no files) and
// never throws -- returns null so callers can fall back rather than crash.
// Exported for direct unit testing (tools/dbCountSnapshot.test.ts proves
// this resolves correctly from a LINKED worktree, not just the main one,
// since that's the only case that actually matters: every real caller runs
// from inside a worktree).
export function deriveMainWorktreeDbFromGit(repoRoot: string): string | null {
  try {
    const gitCommonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();
    if (!gitCommonDir) return null;
    const mainWorktreeRoot = path.dirname(gitCommonDir);
    return path.join(mainWorktreeRoot, "data", "girlchess.db");
  } catch {
    return null;
  }
}

function resolveMainWorktreeDbDefault(repoRoot: string): string {
  return deriveMainWorktreeDbFromGit(repoRoot) ?? path.join(repoRoot, "data", "girlchess.db");
}

export interface DbResolution {
  path: string;
  source: string;
  // Fix round 2026-09-04: the committed demo db is a fixture that ships in
  // git, not her real history. Any tool about to open a write handle must
  // check this structurally (never by re-parsing `source`) and refuse when
  // it is false.
  writable: boolean;
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

// Same shape as countGamesReadonly, but counts only games that have
// actually ended -- the population MIN_FINISHED_GAMES gates on and the one
// replay-check's own regen-candidate count is drawn from. Same
// null-vs-missing/unreadable distinction as countGamesReadonly.
function countFinishedGamesReadonly(p: string): number | null {
  if (!fs.existsSync(p)) return null;
  try {
    const db = new Database(p, { readonly: true });
    try {
      return (
        db.prepare("SELECT COUNT(*) c FROM games WHERE ended_at IS NOT NULL").get() as {
          c: number;
        }
      ).c;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// union finding (review-union.md, fix wave 2): a dedicated error subclass
// so callers can tell "no usable db exists anywhere" (the legitimate
// fresh-clone/CI case) apart from every OTHER way this function can throw,
// STRUCTURALLY (instanceof), not by matching on the message text -- a
// substring match on an English sentence is itself fragile and would break
// silently the moment someone rewords the throw. This is the ONLY place
// this module throws this type; any other exception surfacing from
// resolveRealDbPath (a TypeError from a bad argument, a permissions error,
// anything unanticipated) is deliberately a plain Error so it is NOT
// mistaken for this one.
export class NoDbFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoDbFoundError";
  }
}

export function resolveRealDbPath(
  repoRoot: string,
  mainWorktreeDb: string = resolveMainWorktreeDbDefault(repoRoot)
): DbResolution {
  if (process.env.GC_DB_PATH) {
    const p = process.env.GC_DB_PATH;
    return { path: p, source: "GC_DB_PATH override", writable: path.basename(p) !== DEMO_DB_BASENAME };
  }
  const demo = path.join(repoRoot, "data", DEMO_DB_BASENAME);

  // Below-the-floor helper for the two personal-db branches below: a
  // personal db that exists and has games is still too small a population
  // for the rule-checkers once it has fewer than MIN_FINISHED_GAMES
  // finished games -- a stranger who has played one game of their own must
  // not have the checkers run against that 1-game corpus and fail on
  // replay-check's own floor. Only defers when the committed demo db is
  // actually there with games; otherwise falls through to the personal db
  // unchanged (existing behavior, checked further down / by the throw).
  const deferToDemoBelowFloor = (personalPath: string): DbResolution | undefined => {
    const finished = countFinishedGamesReadonly(personalPath);
    if (finished == null || finished >= MIN_FINISHED_GAMES) return undefined;
    const demoGames = countGamesReadonly(demo);
    if (demoGames == null || demoGames === 0) return undefined;
    return {
      path: demo,
      source: `committed demo db (your own database at ${personalPath} has ${finished} finished game${finished === 1 ? "" : "s"}; the checks need at least ${MIN_FINISHED_GAMES})`,
      writable: false,
    };
  };

  if (fs.existsSync(mainWorktreeDb)) {
    const deferred = deferToDemoBelowFloor(mainWorktreeDb);
    if (deferred) return deferred;
    return { path: mainWorktreeDb, source: "main worktree (live db, source of truth)", writable: true };
  }
  const local = path.join(repoRoot, "data", "girlchess.db");
  const localGames = countGamesReadonly(local);
  if (localGames != null && localGames > 0) {
    const deferred = deferToDemoBelowFloor(local);
    if (deferred) return deferred;
    return {
      path: local,
      source: `local worktree copy (main worktree db not found at ${mainWorktreeDb}; verified ${localGames} games by count, not hash)`,
      writable: true,
    };
  }
  // Security round 2026-09-04: a fresh clone or CI has no owner db anywhere,
  // but it does have the committed demo db (51 finished games with full move
  // lists, the exact shape truth-check and replay-check operate on). Run the
  // rules against that rather than crash. The owner's live db and a local
  // copy both still win when present.
  const demoGames = countGamesReadonly(demo);
  if (demoGames != null && demoGames > 0) {
    return {
      path: demo,
      source: `committed demo db (no personal database at ${local}; verified ${demoGames} games by count, not hash)`,
      writable: false,
    };
  }
  throw new NoDbFoundError(
    `no usable db found: main worktree db missing at ${mainWorktreeDb}, and local ${local} is ` +
      `${localGames == null ? "missing or unreadable" : "empty (0 games)"} -- and no committed demo db with games at ${demo}`
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
    // union finding (review-union.md, fix wave 2): this used to return
    // 'skipped' for ANY error resolveRealDbPath threw, on the claim that
    // "no usable db found anywhere" was its only throw path. That claim was
    // false -- demonstrated by calling checkOwnerDb with repoRoot undefined,
    // which throws a Node TypeError from path.join deep inside the local-
    // copy fallback, nowhere near "no db exists". 'skipped' does not fail
    // the gate, so that bug silently disabled this entire check while `npm
    // run gate` kept printing PASS: a BUG routed to the one status that
    // passes. Only a genuine NoDbFoundError -- checked structurally via
    // instanceof, never by matching on the message text, which would break
    // the moment someone rewords the throw -- is the legitimate fresh-
    // clone/CI case and gets 'skipped'. Anything else is a failure that
    // must be surfaced, not swallowed.
    if (err instanceof NoDbFoundError) {
      return { status: "skipped", detail: err.message };
    }
    return {
      status: "fail",
      detail: `owner-db resolution failed unexpectedly (not "no db anywhere"): ${(err as Error).message}`,
    };
  }
  const snap = countDbSnapshot(resolution.path); // readonly open, nothing else, ever
  if (snap.integrity !== "ok") {
    return { status: "fail", detail: `sqlite integrity_check returned "${snap.integrity}"` };
  }
  if (snap.games === 0) {
    return { status: "fail", detail: "the games table is EMPTY -- her history is gone" };
  }
  return {
    status: "ok",
    detail: `${resolution.source}: ${snap.games} games, ${snap.moves} moves, integrity ok`,
  };
}
