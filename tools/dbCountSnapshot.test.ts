// union finding U2 (review-union.md, fix wave 1): tools/gate.ts's owner-db
// precheck used to hardcode DB_PATH = "data/girlchess.db" resolved against
// process.cwd() -- a path that exists in NO worktree but the main one. Every
// gate run from inside a worktree hit `if (!existsSync(DB_PATH)) return
// undefined` and printed a bare "ok", indistinguishable in the transcript
// from a check that had actually opened and counted her db. checkOwnerDb
// (moved here alongside resolveRealDbPath, both now shared with
// tools/truth-check.ts and tools/gate.ts) fixes that by reusing the SAME
// live-db-first resolution truth-check.ts already had, and by making
// "skipped because no db anywhere" a status distinct from "ok because it
// ran and passed" -- the whole point of the fix.
//
// These tests build tiny throwaway sqlite dbs under os.tmpdir() (never
// touch data/girlchess.db) and call checkOwnerDb directly -- no process
// spawn, no gate.ts script execution.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  checkOwnerDb,
  resolveRealDbPath,
  countDbSnapshot,
  checkDbIntact,
  deriveMainWorktreeDbFromGit,
  NoDbFoundError,
  MIN_FINISHED_GAMES,
  countFinishedGamesReadonly,
} from "./dbCountSnapshot";

const tmpDirs: string[] = [];
afterEach(() => {
  delete process.env.GC_DB_PATH;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// The other helper in this file (makeDb, below) always writes to a fresh
// tmpdir under a fixed "girlchess.db" name -- it has no way to target a
// caller-chosen path (root/data/girlchess.db vs root/data/girlchess-demo.db
// vs an empty one), which the demo-fallback tests below need. This one is
// path-controlled and games-only (resolveRealDbPath's demo-fallback check
// only ever reads the games table).
function writeTinyDb(p: string, games: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY)");
  for (let i = 0; i < games; i++) db.prepare("INSERT INTO games DEFAULT VALUES").run();
  db.close();
}

// Games-only, like writeTinyDb, but with an ended_at column so callers can
// mark a chosen number of rows "finished" -- the shape resolveRealDbPath's
// under-five-finished-games fallback reads (SELECT COUNT(*) FROM games
// WHERE ended_at IS NOT NULL). Unfinished rows get a NULL ended_at, the
// same as an in-progress game in the real schema.
function writeTinyDbWithFinished(p: string, totalGames: number, finishedGames: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY, ended_at TEXT)");
  const ins = db.prepare("INSERT INTO games(ended_at) VALUES (?)");
  for (let i = 0; i < totalGames; i++) {
    ins.run(i < finishedGames ? new Date().toISOString() : null);
  }
  db.close();
}

function makeDb(games: number, moves: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-owner-"));
  tmpDirs.push(dir);
  const p = path.join(dir, "girlchess.db");
  const db = new Database(p);
  db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY);");
  db.exec("CREATE TABLE moves(id INTEGER PRIMARY KEY);");
  const insG = db.prepare("INSERT INTO games DEFAULT VALUES");
  for (let i = 0; i < games; i++) insG.run();
  const insM = db.prepare("INSERT INTO moves DEFAULT VALUES");
  for (let i = 0; i < moves; i++) insM.run();
  db.close();
  return p;
}

describe("checkOwnerDb: the gate's owner-db precheck runs from any worktree", () => {
  it("status 'ok' with real counts when the main-worktree db is reachable -- the exact tell U2 found missing", () => {
    const mainDb = makeDb(160, 1668);
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-repo-"));
    tmpDirs.push(repoDir);

    const result = checkOwnerDb(repoDir, mainDb);
    expect(result.status).toBe("ok");
    // The parenthetical gate.ts's own header names as the tell a real check
    // ran: "(N games, N moves, integrity ok)". A bare "ok" (no counts) is
    // exactly what a silently-skipped check used to print.
    expect(result.detail).toMatch(/160 games, 1668 moves, integrity ok$/);
  });

  it("status 'skipped' (never 'ok') when no db is reachable anywhere -- fresh clone / CI, the legitimate case", () => {
    const missingMainDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-nomain-")), "girlchess.db");
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-repo-"));
    tmpDirs.push(repoDir);

    const result = checkOwnerDb(repoDir, missingMainDb);
    expect(result.status).toBe("skipped");
    expect(result.status).not.toBe("ok");
    expect(result.detail).toMatch(/no usable db found/);
  });

  it("status 'fail' when the resolved db's games table is empty", () => {
    const mainDb = makeDb(0, 0);
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-repo-"));
    tmpDirs.push(repoDir);

    const result = checkOwnerDb(repoDir, mainDb);
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/EMPTY/);
  });

  it("status 'fail' when integrity_check does not return ok", () => {
    const mainDb = makeDb(5, 20);
    // Corrupt it surgically, not by truncation: SQLite's header at offset
    // 32-35 (big-endian uint32) names the first freelist trunk page.
    // Pointing it at a page number that doesn't exist leaves page 1 (the
    // schema) intact and the file openable, but PRAGMA integrity_check
    // reports the structural problem as text rather than the whole open
    // throwing "database disk image is malformed" -- which is what a full
    // truncation/byte-flip produces, and which is a different (still-real)
    // failure mode this test isn't the one to cover.
    const buf = fs.readFileSync(mainDb);
    buf.writeUInt32BE(9999, 32);
    fs.writeFileSync(mainDb, buf);
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-repo-"));
    tmpDirs.push(repoDir);

    const result = checkOwnerDb(repoDir, mainDb);
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/integrity_check returned/);
  });

  it("union finding (review-union.md, fix wave 2): an unexpected internal error (not 'no db anywhere') does NOT return 'skipped'", () => {
    // Reproduces the exact false green found by probing checkOwnerDb: pass
    // repoRoot as undefined (a programming error, not "no db exists") with
    // a genuinely-missing main worktree db so resolution falls through to
    // the local-copy branch, where `path.join(undefined, "data",
    // "girlchess.db")` throws a Node TypeError -- NOT the "no usable db
    // found anywhere" condition. Before the fix, the catch block in
    // checkOwnerDb treated every error identically and returned 'skipped',
    // which does not fail the gate: a bug silently disabled the owner-db
    // check while the gate still printed PASS. This must now come back as
    // 'fail', never 'skipped'.
    const missingMainDb = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-nomain-")),
      "girlchess.db"
    );
    const result = checkOwnerDb(undefined as unknown as string, missingMainDb);
    expect(result.status).not.toBe("skipped");
    expect(result.status).toBe("fail");
  });

  it("opens the db readonly only -- never a write handle, not even to count rows", () => {
    // Every path checkOwnerDb can take (ok, fail-empty, fail-integrity)
    // routes through countDbSnapshot, which is the only place this module
    // opens the real db -- and better-sqlite3 silently tolerates a
    // readonly:false request against a permission-readonly file (it just
    // fails on the first actual WRITE, and this code never writes), so a
    // behavioral chmod test can't distinguish the two. A static source
    // check on the actual instrument is the real guarantee: the literal
    // `{ readonly: true }` must be present at every `new Database(` call
    // in this file, with no other options object shape that could smuggle
    // a write-capable handle in.
    const src = fs.readFileSync(path.join(__dirname, "dbCountSnapshot.ts"), "utf8");
    const opens = [...src.matchAll(/new Database\(([^)]*)\)/g)].map((m) => m[1]);
    expect(opens.length).toBeGreaterThan(0);
    for (const args of opens) {
      expect(args).toMatch(/\{\s*readonly:\s*true\s*\}/);
    }
  });
});

// Re-exercise resolveRealDbPath/countDbSnapshot/checkDbIntact are reachable
// from this module without importing truth-check.ts (which runs
// resolveRealDbPath(REPO_ROOT) as a top-level side effect on import) --
// this is the actual mechanism that makes checkOwnerDb safe for gate.ts to
// import in-process.
describe("resolveRealDbPath/countDbSnapshot/checkDbIntact are importable from ./dbCountSnapshot directly", () => {
  it("resolveRealDbPath is the same function truth-check.ts re-exports (single resolver, not two)", () => {
    const mainDb = makeDb(1, 1);
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-repo-"));
    tmpDirs.push(repoDir);
    const r = resolveRealDbPath(repoDir, mainDb);
    expect(r.path).toBe(mainDb);
    expect(r.source).toMatch(/main worktree/);
  });

  it("countDbSnapshot/checkDbIntact remain usable directly (no regression from the move)", () => {
    const before = countDbSnapshot(makeDb(2, 4));
    expect(before.games).toBe(2);
    expect(checkDbIntact(before, { games: 3, moves: 5, integrity: "ok" })).toBeUndefined();
  });
});

// union finding (review-union.md, fix wave 2): MAIN_WORKTREE_DB used to be a
// hardcoded absolute path containing the vault path -- fragile against the
// repo moving again (it already has, twice: 2026-07-28 owner reorg, and an
// agent displacement on 2026-07-29). deriveMainWorktreeDbFromGit derives the
// same path from `git rev-parse --path-format=absolute --git-common-dir`
// (the shared .git dir; its parent is the main worktree) instead.
describe("deriveMainWorktreeDbFromGit: the main-worktree db path comes from git, not a hardcoded string", () => {
  it("resolves to the real main worktree's data/girlchess.db when run from THIS worktree (not the main one)", () => {
    // This test file itself runs from inside a worktree (wt-union), not the
    // main worktree -- proving the derivation works from a linked worktree,
    // which is the actual case that matters (every gate run happens from a
    // worktree, never from the main checkout).
    const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
    const derived = deriveMainWorktreeDbFromGit(thisFileDir);
    expect(derived).not.toBeNull();

    const gitCommonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: thisFileDir, encoding: "utf8" }
    ).trim();
    const expectedMainWorktreeRoot = path.dirname(gitCommonDir);
    expect(derived).toBe(path.join(expectedMainWorktreeRoot, "data", "girlchess.db"));
  });

  it("returns null (not a throw) when repoRoot is not inside any git working tree", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbcount-nongit-"));
    tmpDirs.push(nonGitDir);
    expect(deriveMainWorktreeDbFromGit(nonGitDir)).toBeNull();
  });

  it("resolveRealDbPath uses git derivation when mainWorktreeDb is omitted: the owner's live db if it exists, else the committed demo db", () => {
    const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
    // resolveRealDbPath anchors its local/demo fallback paths on its
    // repoRoot argument, exactly as every production caller (gate.ts,
    // truth-check.ts, replay-check.ts) does -- that argument must be the
    // checkout root (the directory holding data/), not tools/ itself, or
    // the fallback paths become the nonexistent tools/data/....
    const repoRoot = path.resolve(thisFileDir, "..");
    // Git derivation itself works from any subdirectory -- that's what this
    // half tests -- so it still takes thisFileDir. It returns null when no
    // .git is reachable at all (rarer than a real clone, which always has
    // one, but resolveRealDbPath must survive it regardless -- production
    // code already treats a null derivation the same as a derived path
    // whose file doesn't exist, falling through to local/demo), so this
    // does not assert derived is non-null; it only uses it when present.
    const derived = deriveMainWorktreeDbFromGit(thisFileDir);
    const result = resolveRealDbPath(repoRoot);
    if (derived != null && fs.existsSync(derived)) {
      // Since 885e36d, resolveRealDbPath defers to the committed demo db
      // when the personal db has fewer than MIN_FINISHED_GAMES finished
      // games, so the expectation here must follow the real state of the
      // checkout's own db rather than assuming it always qualifies.
      const finished = countFinishedGamesReadonly(derived) ?? 0;
      if (finished >= MIN_FINISHED_GAMES) {
        expect(result.source).toMatch(/main worktree/);
        expect(result.path).toBe(derived);
        expect(result.writable).toBe(true);
      } else {
        expect(result.source).toMatch(
          /committed demo db \(your own database at .* has \d+ finished games?; the checks need at least 5\)/
        );
        expect(result.path.endsWith("girlchess-demo.db")).toBe(true);
        expect(result.writable).toBe(false);
      }
    } else {
      // A fresh clone, CI, or a .git-less copy: no owner db anywhere, the
      // committed demo db carries the rules.
      expect(result.source).toMatch(/committed demo db/);
      expect(result.path).toBe(path.join(repoRoot, "data", "girlchess-demo.db"));
      expect(result.writable).toBe(false);
    }
    expect(fs.existsSync(result.path)).toBe(true);
  });
});

describe("resolveRealDbPath: committed demo db fallback (fresh clone / CI)", () => {
  const tmp: string[] = [];
  afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const missingMain = "/nonexistent/main/data/girlchess.db";

  it("falls back to data/girlchess-demo.db when neither the main worktree db nor a local copy exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-demo-fallback-"));
    tmp.push(root);
    writeTinyDb(path.join(root, "data", "girlchess-demo.db"), 3);
    const r = resolveRealDbPath(root, missingMain);
    expect(r.path).toBe(path.join(root, "data", "girlchess-demo.db"));
    expect(r.source).toMatch(/committed demo db/);
    expect(r.source).toMatch(/3 games/);
    // The demo db is a fixture, not her real history: tools that write must
    // refuse it (coach-backfill, backfill-move-side), so it must come back
    // marked non-writable structurally, not by re-parsing `source`.
    expect(r.writable).toBe(false);
  });

  it("still throws NoDbFoundError when the demo db has no games", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-demo-empty-"));
    tmp.push(root);
    writeTinyDb(path.join(root, "data", "girlchess-demo.db"), 0);
    expect(() => resolveRealDbPath(root, missingMain)).toThrow(NoDbFoundError);
  });

  it("prefers a local worktree copy with games over the demo db", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-demo-local-"));
    tmp.push(root);
    writeTinyDb(path.join(root, "data", "girlchess.db"), 2);
    writeTinyDb(path.join(root, "data", "girlchess-demo.db"), 3);
    const r = resolveRealDbPath(root, missingMain);
    expect(r.path).toBe(path.join(root, "data", "girlchess.db"));
    expect(r.source).toMatch(/local worktree copy/);
    expect(r.writable).toBe(true);
  });

  it("a personal db under MIN_FINISHED_GAMES defers to the committed demo db (a fresh clone that has played one game must not run the checkers against a 1-game corpus)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-personal-under-floor-"));
    tmp.push(root);
    const personalPath = path.join(root, "data", "girlchess.db");
    writeTinyDbWithFinished(personalPath, 3, 1);
    writeTinyDb(path.join(root, "data", "girlchess-demo.db"), 51);
    const r = resolveRealDbPath(root, missingMain);
    expect(r.path).toBe(path.join(root, "data", "girlchess-demo.db"));
    expect(r.writable).toBe(false);
    expect(r.source).toBe(
      `committed demo db (your own database at ${personalPath} has 1 finished game; the checks need at least ${MIN_FINISHED_GAMES})`
    );
  });

  it("a personal db at or above MIN_FINISHED_GAMES resolves to itself, demo db present or not", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-personal-at-floor-"));
    tmp.push(root);
    const personalPath = path.join(root, "data", "girlchess.db");
    writeTinyDbWithFinished(personalPath, 5, 5);
    writeTinyDb(path.join(root, "data", "girlchess-demo.db"), 51);
    const r = resolveRealDbPath(root, missingMain);
    expect(r.path).toBe(personalPath);
    expect(r.writable).toBe(true);
    expect(r.source).toMatch(/local worktree copy/);
  });

  it("GC_DB_PATH pointing at a file named girlchess-demo.db is never writable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-override-demo-"));
    tmp.push(root);
    const demo = path.join(root, "data", "girlchess-demo.db");
    writeTinyDb(demo, 2);
    const saved = process.env.GC_DB_PATH;
    process.env.GC_DB_PATH = demo;
    try {
      const r = resolveRealDbPath(root, missingMain);
      expect(r.source).toMatch(/GC_DB_PATH/);
      expect(r.writable).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.GC_DB_PATH;
      else process.env.GC_DB_PATH = saved;
    }
  });

  it("GC_DB_PATH pointing at any other basename stays writable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gc-override-other-"));
    tmp.push(root);
    const work = path.join(root, "demo-side-work.db");
    writeTinyDb(work, 2);
    const saved = process.env.GC_DB_PATH;
    process.env.GC_DB_PATH = work;
    try {
      expect(resolveRealDbPath(root, missingMain).writable).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.GC_DB_PATH;
      else process.env.GC_DB_PATH = saved;
    }
  });
});
