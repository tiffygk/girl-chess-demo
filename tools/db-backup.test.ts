// Task K5a: backup + verify + refuse-if-stale for her live db.
//
// These tests build tiny throwaway sqlite dbs under os.tmpdir() (never
// touch data/girlchess.db) and call the module's exported functions
// directly -- no process spawn, no CLI invocation. One test (marked below)
// also reads the REAL stale fixture at
// ../wt-phase/data/backups/2026-07-30-phase/girlchess.db, readonly, never
// mutated -- the exact 109-moves-near-miss backup this task exists to make
// impossible to act on by accident.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  backupLiveDb,
  verifyBackup,
  restoreCheck,
  assertNotInAgentWorktree,
  resolveMainWorktreeBackupsDir,
} from "./db-backup";
import { countDbSnapshot } from "./dbCountSnapshot";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDb(games: number, moves: number, dir?: string): string {
  const d = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-"));
  if (!dir) tmpDirs.push(d);
  const p = path.join(d, "girlchess.db");
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY); CREATE TABLE moves(id INTEGER PRIMARY KEY);");
  const insG = db.prepare("INSERT INTO games DEFAULT VALUES");
  for (let i = 0; i < games; i++) insG.run();
  const insM = db.prepare("INSERT INTO moves DEFAULT VALUES");
  for (let i = 0; i < moves; i++) insM.run();
  db.close();
  return p;
}

// A "main worktree" fixture: <root>/data/girlchess.db, so
// resolveMainWorktreeBackupsDir's path.join(dirname(mainDb), "backups")
// lands at <root>/data/backups/ -- the real shape.
function makeMainWorktree(games: number, moves: number): { root: string; dbPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-main-"));
  tmpDirs.push(root);
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  const dbPath = makeDb(games, moves, dataDir);
  return { root, dbPath };
}

describe("(a) backupLiveDb: produces the .db+-wal+-shm triple under the MAIN worktree's data/backups/, readonly source, counts equal live", () => {
  it("writes all three files, and countDbSnapshot(copy) equals countDbSnapshot(live)", async () => {
    // Fix round 2 (2026-09-04): this test never touches the owner's real
    // live db. It used to reach it only because backupLiveDb's source
    // defaulted to resolveRealDbPath's resolution, and passing an
    // unreachable repoRoot ("/unused-repo-root") made git fail, which used
    // to fall through to the hardcoded FALLBACK_MAIN_WORKTREE_DB literal --
    // the owner's real path. That literal is gone (removed this round: a
    // public repo must not name the owner's home directory), so this test
    // now supplies its own fixture source db explicitly via opts.sourceDb,
    // exactly as opts.mainWorktreeDb already does for WHERE the backup gets
    // WRITTEN (an injected path under a throwaway tmp dir shaped like the
    // main worktree, never the real one). "live" for the equality check
    // below is that same fixture, counted fresh in this same test run --
    // never a hardcoded snapshot from whenever this test was authored,
    // which is exactly what silently went stale here before: two hardcoded
    // literals once asserted her games/moves count from authoring time and
    // broke on every clean checkout since, because her real count keeps
    // growing. The equality against a live count taken in the same run
    // already proves the WAL-inclusion contract; the literals were never
    // load-bearing, and now nothing here reads her db at all.
    const main = makeMainWorktree(161, 1721);
    const source = makeDb(7, 40);
    const result = await backupLiveDb("/unused-repo-root", {
      sourceDb: source,
      mainWorktreeDb: main.dbPath,
    });

    expect(fs.existsSync(result.dbPath)).toBe(true);
    expect(fs.existsSync(result.walPath)).toBe(true);
    expect(fs.existsSync(result.shmPath)).toBe(true);
    expect(path.dirname(result.dbPath)).toBe(path.join(main.root, "data", "backups"));

    const copySnapshot = countDbSnapshot(result.dbPath);
    const liveSnapshot = countDbSnapshot(source);
    expect(copySnapshot).toEqual(liveSnapshot);
  });

  it("never opens the source db read-write -- static check on the actual instrument, same discipline as dbCountSnapshot.test.ts", () => {
    const src = fs.readFileSync(path.join(__dirname, "db-backup.ts"), "utf8");
    // Every `new Database(sourceDb...)`-shaped open of the thing being
    // backed FROM must be readonly. (countDbSnapshot's own internal opens
    // are covered by dbCountSnapshot.test.ts; this file must not add a
    // second, unguarded open of the source.)
    const opens = [...src.matchAll(/new Database\(([^)]*)\)/g)].map((m) => m[1]);
    expect(opens.length).toBeGreaterThan(0);
    for (const args of opens) {
      expect(args).toMatch(/\{\s*readonly:\s*true\s*\}/);
    }
  });
});

describe("(b) verifyBackup: fails loudly on a count mismatch or integrity failure", () => {
  it("throws naming both counts when the backup's counts don't match the reference", () => {
    const backupPath = makeDb(160, 1559); // the exact stale shape from the incident
    const liveSnapshot = countDbSnapshot(makeDb(161, 1721));
    expect(() => verifyBackup(backupPath, liveSnapshot)).toThrow(
      /160 games \/ 1559 moves.*161 games \/ 1721 moves/s
    );
  });

  it("throws on integrity failure, distinct from a count mismatch", () => {
    const backupPath = makeDb(5, 20);
    // Corrupt surgically (same technique as dbCountSnapshot.test.ts): the
    // header's first-freelist-trunk-page pointer, offset 32-35 big-endian,
    // pointed at a nonexistent page -- file stays openable, integrity_check
    // reports the problem as text.
    const buf = fs.readFileSync(backupPath);
    buf.writeUInt32BE(9999, 32);
    fs.writeFileSync(backupPath, buf);
    const referenceSnapshot = countDbSnapshot(makeDb(5, 20));
    expect(() => verifyBackup(backupPath, referenceSnapshot)).toThrow(/integrity_check/);
  });

  it("does not throw when counts match and integrity is ok", () => {
    const backupPath = makeDb(12, 90);
    const referenceSnapshot = countDbSnapshot(backupPath);
    expect(() => verifyBackup(backupPath, referenceSnapshot)).not.toThrow();
  });
});

describe("(c) restoreCheck: REFUSES when the backup's move count is below live's -- the 109-moves near-miss, mechanized", () => {
  it("throws, naming both counts, when backup moves < live moves (synthetic, exact incident numbers)", () => {
    const backupPath = makeDb(160, 1559);
    const livePath = makeDb(160, 1668);
    expect(() => restoreCheck(backupPath, livePath)).toThrow(
      /1559 moves.*1668 moves.*OLDER than her play.*discard 109 moves/s
    );
  });

  it("throws when backup games < live games even if moves happen to tie", () => {
    const backupPath = makeDb(159, 1721);
    const livePath = makeDb(161, 1721);
    expect(() => restoreCheck(backupPath, livePath)).toThrow(/OLDER than her play/);
  });

  it("does NOT throw when the backup's counts are >= live's (a genuinely safe restore point)", () => {
    const backupPath = makeDb(161, 1721);
    const livePath = makeDb(160, 1600);
    const result = restoreCheck(backupPath, livePath);
    expect(result.backupSnapshot.moves).toBe(1721);
  });

  it("REAL FIXTURE: refuses to restore from the actual stale wt-phase backup against a live db shaped like her real corpus (160/1559 vs 161/1721) -- readonly, never mutated", () => {
    const staleFixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "wt-phase",
      "data",
      "backups",
      "2026-07-30-phase",
      "girlchess.db"
    );
    if (!fs.existsSync(staleFixture)) {
      // Sibling worktree may not exist in every environment this test runs
      // in (e.g. a fresh clone); the synthetic tests above already cover
      // the behavior. Skip rather than false-fail.
      return;
    }
    const staleSnapshot = countDbSnapshot(staleFixture);
    expect(staleSnapshot.games).toBe(160);
    expect(staleSnapshot.moves).toBe(1559);

    const livePath = makeDb(161, 1721);
    expect(() => restoreCheck(staleFixture, livePath)).toThrow(/OLDER than her play/);

    // Prove the fixture itself was never touched by this test.
    const staleSnapshotAfter = countDbSnapshot(staleFixture);
    expect(staleSnapshotAfter).toEqual(staleSnapshot);
  });
});

describe("(d) writing a backup path inside a wt-* worktree throws", () => {
  it("assertNotInAgentWorktree throws on any wt-* path segment", () => {
    expect(() => assertNotInAgentWorktree("/repo/wt-phase/data/backups")).toThrow(
      /agent worktree/
    );
    expect(() => assertNotInAgentWorktree("/repo/girl-chess-agents/wt-rca-k5a/data/backups")).toThrow(
      /agent worktree/
    );
  });

  it("assertNotInAgentWorktree does not throw on a real main-worktree-shaped path", () => {
    expect(() =>
      assertNotInAgentWorktree("/repo/girl-chess-agents/data/backups")
    ).not.toThrow();
  });

  it("resolveMainWorktreeBackupsDir throws when the resolved main db path is inside a wt-* worktree", () => {
    expect(() =>
      resolveMainWorktreeBackupsDir(
        "/unused",
        "/repo/girl-chess-agents/wt-phase/data/girlchess.db"
      )
    ).toThrow(/agent worktree/);
  });

  it("backupLiveDb refuses (throws, writes nothing) when the resolved backups dir is inside a wt-* worktree", async () => {
    const fakeWorktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-wt-fake-"));
    tmpDirs.push(fakeWorktreeRoot);
    const wtDir = path.join(fakeWorktreeRoot, "wt-fake");
    const dataDir = path.join(wtDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const sourceDb = makeDb(3, 5, dataDir);

    await expect(
      backupLiveDb("/unused-repo-root", { sourceDb, mainWorktreeDb: sourceDb })
    ).rejects.toThrow(/agent worktree/);

    expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(false);
  });
});
