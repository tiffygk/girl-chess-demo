// WAL-safe backup + verify + refuse-if-stale restore-check for her live db.
//
// WHY THIS FILE EXISTS (2026-07-30 hard rule, see CLAUDE.md and
// .superpowers/sdd/rounds/2026-07-31-game160-rca/CONSTRAINTS.md):
// a document once told the owner to restore from a snapshot holding 1559
// moves while her live db held 1668 across the same 160 games, and
// asserted the copy would put things back "exactly as it was" -- following
// it would have silently discarded 109 of her real moves. That backup also
// lived inside `wt-phase`, an agent worktree deleted at round cleanup, so
// the named path would eventually stop existing too. This module is the
// structural fix, not a convention: backups always land in the MAIN
// worktree's data/backups/, are always verified by COUNTING (never size or
// hash -- a WAL checkpoint moves a hash with zero data changed, and a
// change sitting only in the log can leave a hash alone), and restoring
// from one whose move count is lower than live is refused loudly and
// non-zero, because that is precisely the failure this file exists to make
// impossible to repeat by accident.
//
// Reuses tools/dbCountSnapshot.ts (countDbSnapshot, resolveRealDbPath,
// deriveMainWorktreeDbFromGit) for every count and every path resolution
// rather than adding a second way to do either -- a duplicated rule that
// can drift is worse than the bug this file fixes.
//
// Run: npx tsx tools/db-backup.ts backup
//      npx tsx tools/db-backup.ts verify <path>
//      npx tsx tools/db-backup.ts restore-check <path>
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  countDbSnapshot,
  resolveRealDbPath,
  deriveMainWorktreeDbFromGit,
  type DbCountSnapshot,
} from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

// Backups belong ONLY in the MAIN worktree's data/backups/, never inside
// any wt-* agent worktree -- the stale backup that nearly cost her 109
// moves lived inside wt-phase for exactly this reason. This is a
// defense-in-depth guard on top of always deriving the dir from the main
// worktree in the first place: it exists so a caller that overrides the
// path (a test, or a future refactor) cannot silently write into a
// worktree by mistake.
export function assertNotInAgentWorktree(p: string): void {
  const offender = p.split(path.sep).find((seg) => /^wt-/.test(seg));
  if (offender) {
    throw new Error(
      `refusing to write a backup under "${offender}" -- that looks like an agent worktree, ` +
        `and worktrees get deleted at round cleanup. Backups belong ONLY in the MAIN worktree's ` +
        `data/backups/. Path was: ${p}`
    );
  }
}

// Reuses deriveMainWorktreeDbFromGit (tools/dbCountSnapshot.ts) rather than
// re-deriving the main worktree root a second way. mainWorktreeDb is an
// injectable override (same pattern as resolveRealDbPath's own second
// param) so tests can exercise this without a real git repo.
export function resolveMainWorktreeBackupsDir(
  repoRoot: string,
  mainWorktreeDb?: string
): string {
  const mainDb = mainWorktreeDb ?? deriveMainWorktreeDbFromGit(repoRoot);
  if (!mainDb) {
    throw new Error(
      `cannot resolve the main worktree's data/backups/ dir: not inside a git working tree (repoRoot=${repoRoot})`
    );
  }
  const dir = path.join(path.dirname(mainDb), "backups");
  assertNotInAgentWorktree(dir);
  return dir;
}

export interface BackupTriple {
  dbPath: string;
  walPath: string;
  shmPath: string;
  snapshot: DbCountSnapshot;
}

// Uses better-sqlite3's online backup API (sqlite3_backup_*) against a
// READONLY handle on the source -- the correct way to copy a db that may
// still be live-written by the app's own connection: SQLite replays any
// pending WAL frames into the copy transactionally as part of the backup,
// so the result is a single, fully self-consistent file with nothing
// missing, and the source is never opened for write. (Verified
// empirically against a temp db: a row inserted but not yet WAL-
// checkpointed on the source still lands correctly in the backup.)
//
// The .db+-wal+-shm triple CONSTRAINTS.md describes (matching the owner's
// existing verified backups, premerge-*/pre-game161-*) forms on its own:
// right after `.backup()`, only the .db file exists, but this function
// immediately self-verifies the copy by opening it (countDbSnapshot, via
// verifyBackup below) -- and opening ANY WAL-format sqlite file, even
// readonly, makes SQLite materialize the paired -shm (and an empty -wal)
// beside it, verified empirically against a temp db. So the triple is a
// deterministic side effect of the self-verify this function always does,
// not a separate manual step that could silently drift from what's
// actually being verified.
export async function backupLiveDb(
  repoRoot: string,
  opts: { sourceDb?: string; mainWorktreeDb?: string; now?: Date } = {}
): Promise<BackupTriple> {
  const sourceDb = opts.sourceDb ?? resolveRealDbPath(repoRoot).path;
  if (!fs.existsSync(sourceDb)) {
    throw new Error(`live db not found at ${sourceDb} -- refusing to back up nothing`);
  }

  const backupsDir = resolveMainWorktreeBackupsDir(repoRoot, opts.mainWorktreeDb);
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const dbPath = path.join(backupsDir, `girlchess-${stamp}.db`);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  const source = new Database(sourceDb, { readonly: true });
  try {
    await source.backup(dbPath);
  } finally {
    source.close();
  }

  // countDbSnapshot always opens {readonly: true} itself (see
  // dbCountSnapshot.ts) -- this is a fresh readonly open of the SAME
  // sourceDb file, taken as close to the backup as possible, never a
  // write handle.
  const sourceSnapshot = countDbSnapshot(sourceDb);
  const backupSnapshot = verifyBackup(dbPath, sourceSnapshot).backupSnapshot;

  return { dbPath, walPath, shmPath, snapshot: backupSnapshot };
}

export interface VerifyResult {
  backupSnapshot: DbCountSnapshot;
  referenceSnapshot: DbCountSnapshot;
}

// Fails loudly (throws) when the backup's own integrity_check isn't ok, or
// when its games/moves counts don't exactly match a given reference
// snapshot. Used both as backupLiveDb's own immediate self-check (the
// reference is the live snapshot taken in the same call, so equality is
// the correct expectation) and as the standalone `verify <path>` CLI
// command (the reference is resolved fresh against current live, so verify
// always checks against reality right now, never a stale number baked in
// at backup time).
export function verifyBackup(
  backupPath: string,
  referenceSnapshot: DbCountSnapshot
): VerifyResult {
  const backupSnapshot = countDbSnapshot(backupPath); // readonly-only, see dbCountSnapshot.ts
  if (backupSnapshot.integrity !== "ok") {
    throw new Error(
      `backup at ${backupPath} failed integrity_check: "${backupSnapshot.integrity}" -- do not trust this backup`
    );
  }
  if (
    backupSnapshot.games !== referenceSnapshot.games ||
    backupSnapshot.moves !== referenceSnapshot.moves
  ) {
    throw new Error(
      `backup at ${backupPath} does not match its reference: backup has ` +
        `${backupSnapshot.games} games / ${backupSnapshot.moves} moves, reference has ` +
        `${referenceSnapshot.games} games / ${referenceSnapshot.moves} moves`
    );
  }
  return { backupSnapshot, referenceSnapshot };
}

export interface RestoreCheckResult {
  backupSnapshot: DbCountSnapshot;
  liveSnapshot: DbCountSnapshot;
}

// Mechanizes the 2026-07-30 hard rule: a backup whose game or move count is
// LOWER than live is older than her play, and restoring it would silently
// discard real games -- exactly the 109-moves near-miss (a backup at 1559
// moves offered as a restore point while live held 1668). Refuses loudly
// and non-zero, naming both counts, rather than trusting an "exactly as it
// was" claim in a document.
export function restoreCheck(backupPath: string, liveDbPath: string): RestoreCheckResult {
  const backupSnapshot = countDbSnapshot(backupPath);
  const liveSnapshot = countDbSnapshot(liveDbPath);
  if (backupSnapshot.integrity !== "ok") {
    throw new Error(
      `REFUSING to restore ${backupPath}: integrity_check returned "${backupSnapshot.integrity}"`
    );
  }
  if (backupSnapshot.moves < liveSnapshot.moves || backupSnapshot.games < liveSnapshot.games) {
    const lostMoves = Math.max(0, liveSnapshot.moves - backupSnapshot.moves);
    const lostGames = Math.max(0, liveSnapshot.games - backupSnapshot.games);
    throw new Error(
      `REFUSING to restore ${backupPath}: it holds ${backupSnapshot.games} games / ` +
        `${backupSnapshot.moves} moves, but the live db currently holds ${liveSnapshot.games} games / ` +
        `${liveSnapshot.moves} moves. This backup is OLDER than her play -- restoring it would ` +
        `silently discard ${lostMoves} moves across ${lostGames} games.`
    );
  }
  return { backupSnapshot, liveSnapshot };
}

async function main() {
  const [, , cmd, arg] = process.argv;

  if (cmd === "backup") {
    const result = await backupLiveDb(REPO_ROOT);
    console.log(`[db-backup] wrote ${result.dbPath}`);
    console.log(
      `[db-backup] ${result.snapshot.games} games, ${result.snapshot.moves} moves, ` +
        `integrity ${result.snapshot.integrity} -- verified equal to live at backup time`
    );
    return;
  }

  if (cmd === "verify") {
    if (!arg) {
      console.error("usage: npx tsx tools/db-backup.ts verify <path>");
      process.exit(2);
      return;
    }
    const live = resolveRealDbPath(REPO_ROOT);
    const liveSnapshot = countDbSnapshot(live.path);
    const result = verifyBackup(arg, liveSnapshot);
    console.log(
      `[db-backup] verify OK: ${arg} matches live (${result.backupSnapshot.games} games, ` +
        `${result.backupSnapshot.moves} moves)`
    );
    return;
  }

  if (cmd === "restore-check") {
    if (!arg) {
      console.error("usage: npx tsx tools/db-backup.ts restore-check <path>");
      process.exit(2);
      return;
    }
    const live = resolveRealDbPath(REPO_ROOT);
    const result = restoreCheck(arg, live.path);
    console.log(
      `[db-backup] restore-check OK: ${arg} is not older than live (` +
        `${result.backupSnapshot.games} games / ${result.backupSnapshot.moves} moves vs live ` +
        `${result.liveSnapshot.games} games / ${result.liveSnapshot.moves} moves)`
    );
    return;
  }

  console.error("usage: npx tsx tools/db-backup.ts <backup | verify <path> | restore-check <path>>");
  process.exit(2);
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[db-backup] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
