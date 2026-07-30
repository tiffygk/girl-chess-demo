// tools/rca-eval/suites/db.ts
//
// Suite DB -- the database guarantees (spec section 3, K5a/K5b). Owner's
// ask verbatim: "especially on the database part." Every scenario is binary
// (zero model noise); gate is 7/7, so anything less is red -- a percentage
// would only exist to excuse a failure.
//
// Dispatch 6 (2026-07-31, post phase-A merge): K5a (tools/db-backup.ts) is
// now real code. DB-01/DB-02 are wired to call its exported functions
// directly (backupLiveDb/restoreCheck -- pure, already unit-tested in
// tools/db-backup.test.ts; no CLI subprocess spawn needed) against scratch
// dbs built the same way DB-03/04 already do, never yours. DB-06 (the
// gate's in-play guard) flipped green on its own the moment phase A's
// gate.ts merged -- verified here by re-running the SAME static source
// check unchanged, not by touching gate.ts. DB-03/DB-04/DB-05 remain
// legitimately red: K5b (the single-source db-path refactor) has not
// merged, and each of those checks a guarantee K5b -- not K5a -- ships.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator } from "../lib/assertRan";
import {
  resolveRealDbPath,
  deriveMainWorktreeDbFromGit,
  countDbSnapshot,
} from "../../dbCountSnapshot";
import { backupLiveDb, restoreCheck } from "../../db-backup";
import { copyScratchDb } from "../../truth-check";
import { seedScratchDb, seedMinimalGame, fakeWorktreeRoot, makeScratchDir, doctorMoveCount } from "../lib/scenarioDb";

// fileURLToPath (not new URL().pathname) -- this repo's own path contains
// spaces ("girl chess game"), which URL.pathname percent-encodes, silently
// breaking every path built from it. tools/gate.ts's own header uses the
// same fileURLToPath convention for exactly this reason.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB_BACKUP_TOOL = path.join(REPO_ROOT, "tools", "db-backup.ts");

// DB-05's scan: only counts a hit when the literal appears INSIDE a quoted
// string on a non-comment line (a real path-construction or user-facing
// message site), never inside a bare `//` comment -- several files in this
// codebase quote old buggy code inside a retrospective comment (see
// tools/gate.ts:24's own header, which quotes the exact literal it fixed
// away), and those must not be flagged for discussing history in prose.
// Every .test.ts/.md/.json file is excluded outright (tests, docs, and
// fixtures are not production path-construction code); tools/rca-eval/
// itself is excluded because this eval harness necessarily discusses the
// literal it is checking for in its own detail/report strings -- the same
// self-exemption dbCountSnapshot.ts/db.ts already get as the sanctioned
// home for db-path logic.
const DB05_ALLOWED_FILES = new Set(["server/store/db.ts", "tools/dbCountSnapshot.ts"]);
const DB05_SCAN_DIRS = ["server", "tools", "src"];
const DB05_EXCLUDED_DIR_PREFIX = path.join("tools", "rca-eval");
const QUOTED_LITERAL_RE = /["'`][^"'`]*girlchess\.db[^"'`]*["'`]/;

function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "runs") continue;
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function scanForHardcodedDbPath(): { file: string; line: number; text: string }[] {
  const violations: { file: string; line: number; text: string }[] = [];
  for (const rootRel of DB05_SCAN_DIRS) {
    const root = path.join(REPO_ROOT, rootRel);
    if (!fs.existsSync(root)) continue;
    const files: string[] = [];
    walk(root, files);
    for (const f of files) {
      const rel = path.relative(REPO_ROOT, f);
      if (rel.startsWith(DB05_EXCLUDED_DIR_PREFIX)) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".md") || rel.endsWith(".json")) continue;
      if (DB05_ALLOWED_FILES.has(rel)) continue;
      if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
      const lines = fs.readFileSync(f, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (line.trim().startsWith("//")) return; // retrospective/comment mentions don't count
        if (QUOTED_LITERAL_RE.test(line)) violations.push({ file: rel, line: i + 1, text: line.trim() });
      });
    }
  }
  return violations;
}

// DB-01: real backupLiveDb() call, sourceDb + mainWorktreeDb BOTH scratch
// (a genuinely fabricated db and a genuinely fabricated main-worktree-root
// path, neither touching data/girlchess.db, the real main worktree's
// data/backups/, or GC_DB_PATH's own fallback chain) -- "against a scratch
// db (never yours)" per the spec, for BOTH the copy's source and its
// destination, not just the destination.
async function db01(): Promise<EvalResult> {
  if (!fs.existsSync(DB_BACKUP_TOOL)) {
    return { id: "DB-01", verdict: "did-not-run", detail: "tools/db-backup.ts not found -- K5a has not merged; cannot run 'backup' or verify the .db+-wal+-shm triple." };
  }

  const sourcePath = seedScratchDb("db01-source");
  seedMinimalGame();
  const sourceSnapshot = countDbSnapshot(sourcePath);

  const fakeMain = makeScratchDir("db01-main");
  const fakeMainDb = path.join(fakeMain, "data", "girlchess.db");

  let result: Awaited<ReturnType<typeof backupLiveDb>>;
  try {
    result = await backupLiveDb(REPO_ROOT, { sourceDb: sourcePath, mainWorktreeDb: fakeMainDb });
  } catch (err) {
    return { id: "DB-01", verdict: "red", detail: `backupLiveDb threw unexpectedly against a well-formed scratch source: ${(err as Error).message}` };
  }

  const tripleOk = fs.existsSync(result.dbPath) && fs.existsSync(`${result.dbPath}-wal`) && fs.existsSync(`${result.dbPath}-shm`);
  const expectedDir = path.join(fakeMain, "data", "backups");
  const landsUnderMain = path.dirname(result.dbPath) === expectedDir;
  const noWtSegment = !result.dbPath.split(path.sep).some((seg) => /^wt-/.test(seg));
  const copySnapshot = countDbSnapshot(result.dbPath);
  const countsEqual = copySnapshot.games === sourceSnapshot.games && copySnapshot.moves === sourceSnapshot.moves && copySnapshot.integrity === "ok";

  if (tripleOk && landsUnderMain && noWtSegment && countsEqual) {
    return {
      id: "DB-01",
      verdict: "pass",
      detail: `backupLiveDb() wrote the .db+-wal+-shm triple to ${result.dbPath} under a main-worktree-shaped data/backups/ dir (never a wt-* path); source opened readonly (see db-backup.test.ts's own structural proof); countDbSnapshot(copy) equals countDbSnapshot(source): ${copySnapshot.games} games / ${copySnapshot.moves} moves, integrity ${copySnapshot.integrity}.`,
    };
  }
  return {
    id: "DB-01",
    verdict: "red",
    detail: `tripleOk=${tripleOk} landsUnderMain=${landsUnderMain} (got ${path.dirname(result.dbPath)}, expected ${expectedDir}) noWtSegment=${noWtSegment} countsEqual=${countsEqual} (source ${sourceSnapshot.games}g/${sourceSnapshot.moves}m, copy ${copySnapshot.games}g/${copySnapshot.moves}m)`,
  };
}

// DB-02: mechanizes the real 109-moves near-miss -- doctors a SCRATCH COPY
// (never the live db) down to a lower move count and asserts restoreCheck()
// refuses, naming both counts.
function db02(): EvalResult {
  if (!fs.existsSync(DB_BACKUP_TOOL)) {
    return { id: "DB-02", verdict: "did-not-run", detail: "tools/db-backup.ts not found -- K5a has not merged; 'restore-check' does not exist to run against a doctored scratch copy." };
  }

  const livePath = seedScratchDb("db02-live");
  seedMinimalGame(); // game 1: 2 moves
  const { gameId: gameId2 } = seedMinimalGame(); // game 2: 2 more moves -- live totals 2 games / 4 moves
  const liveSnapshot = countDbSnapshot(livePath);

  const backupDir = makeScratchDir("db02-backup");
  const backupPath = path.join(backupDir, "scratch.db");
  copyScratchDb(livePath, backupPath); // a genuine copy of live, doctored next -- never the live file itself mutated
  doctorMoveCount(backupPath, gameId2, 0); // drop game 2's moves in the COPY only -> backup now 2 games / 2 moves, stale against live's 4

  const backupSnapshotBeforeRestoreCheck = countDbSnapshot(backupPath);

  let threw = false;
  let message = "";
  try {
    restoreCheck(backupPath, livePath);
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }

  const namesBothCounts =
    message.includes(`${backupSnapshotBeforeRestoreCheck.games} games`) &&
    message.includes(`${backupSnapshotBeforeRestoreCheck.moves} moves`) &&
    message.includes(`${liveSnapshot.games} games`) &&
    message.includes(`${liveSnapshot.moves} moves`);

  if (threw && namesBothCounts) {
    return {
      id: "DB-02",
      verdict: "pass",
      detail: `restoreCheck() refused the doctored copy (${backupSnapshotBeforeRestoreCheck.games} games / ${backupSnapshotBeforeRestoreCheck.moves} moves) against live (${liveSnapshot.games} games / ${liveSnapshot.moves} moves), naming both counts: "${message}"`,
    };
  }
  return {
    id: "DB-02",
    verdict: "red",
    detail: `threw=${threw} namesBothCounts=${namesBothCounts} -- message: "${message}" (backup ${backupSnapshotBeforeRestoreCheck.games}g/${backupSnapshotBeforeRestoreCheck.moves}m vs live ${liveSnapshot.games}g/${liveSnapshot.moves}m)`,
  };
}

// DB-03: a real, runnable check against TODAY's code -- deliberately using
// GC_DB_PATH to point at a scratch db (never the real one), so "does
// opening the resolved path in read-write mode from a simulated worktree
// cwd throw" can be tested with zero risk to data/girlchess.db.
function db03(): EvalResult {
  const worktreeRoot = fakeWorktreeRoot();
  const scratchPath = seedScratchDb("db03");
  const prevGcDbPath = process.env.GC_DB_PATH;
  process.env.GC_DB_PATH = scratchPath;
  try {
    const resolution = resolveRealDbPath(worktreeRoot);
    let threw = false;
    let openErr: string | undefined;
    try {
      // The scenario: a read-write server open of the CANONICAL db from a
      // simulated linked-worktree cwd. No guard exists anywhere in the
      // codebase today that inspects cwd/worktree-ness before opening --
      // this is expected to succeed (not throw), which is the red.
      const raw = new Database(resolution.path);
      raw.close();
    } catch (err) {
      threw = true;
      openErr = (err as Error).message;
    }
    if (threw) {
      return { id: "DB-03", verdict: "pass", detail: `read-write open from a simulated worktree root threw as required: ${openErr}` };
    }
    return {
      id: "DB-03",
      verdict: "red",
      detail:
        "no worktree-write-refusal guard exists: a read-write open of the resolved db from a simulated " +
        "linked-worktree root (.git FILE) succeeded silently instead of throwing with db-backup/GC_DB_PATH " +
        "instructions. This is a K5b acceptance target, not yet implemented.",
    };
  } finally {
    if (prevGcDbPath === undefined) delete process.env.GC_DB_PATH;
    else process.env.GC_DB_PATH = prevGcDbPath;
  }
}

// DB-04: GC_DB_PATH precedence, both branches. The "nonzero db is used"
// branch already works today (GC_DB_PATH is checked first, unconditionally,
// in resolveRealDbPath); the "empty db is refused" branch does not exist --
// resolveRealDbPath returns ANY GC_DB_PATH value with no sanity check.
function db04(): EvalResult {
  const prevGcDbPath = process.env.GC_DB_PATH;
  try {
    // Branch A: nonzero-count scratch db via GC_DB_PATH is used.
    const nonzeroPath = seedScratchDb("db04-nonzero");
    seedMinimalGame();
    process.env.GC_DB_PATH = nonzeroPath;
    const resolutionA = resolveRealDbPath(REPO_ROOT);
    const usedNonzero = resolutionA.path === nonzeroPath;

    // Branch B: empty (0 games) scratch db via GC_DB_PATH should be refused.
    const emptyPath = seedScratchDb("db04-empty");
    process.env.GC_DB_PATH = emptyPath;
    let refused = false;
    let refusalErr: string | undefined;
    try {
      const resolutionB = resolveRealDbPath(REPO_ROOT);
      const snap = countDbSnapshot(resolutionB.path);
      if (snap.games === 0) {
        // resolveRealDbPath returned it anyway -- no refusal happened.
        refused = false;
      }
    } catch (err) {
      refused = true;
      refusalErr = (err as Error).message;
    }

    if (usedNonzero && refused) {
      return { id: "DB-04", verdict: "pass", detail: `nonzero GC_DB_PATH used (${nonzeroPath}); empty GC_DB_PATH refused (${refusalErr})` };
    }
    return {
      id: "DB-04",
      verdict: "red",
      detail:
        `nonzero-count branch ${usedNonzero ? "OK" : "FAILED"} (used=${usedNonzero}); ` +
        `empty-db-refused branch ${refused ? "OK" : "FAILED (resolveRealDbPath returned the empty scratch db with no sanity check)"}. ` +
        "This is a K5b acceptance target, not yet implemented.",
    };
  } finally {
    if (prevGcDbPath === undefined) delete process.env.GC_DB_PATH;
    else process.env.GC_DB_PATH = prevGcDbPath;
  }
}

function db05(): EvalResult {
  const violations = scanForHardcodedDbPath();
  if (violations.length === 0) {
    return { id: "DB-05", verdict: "pass", detail: "the literal 'girlchess.db' appears in zero source files outside dbCountSnapshot.ts/db.ts/migrations/docs." };
  }
  const list = violations.map((v) => `${v.file}:${v.line}`).join(", ");
  return {
    id: "DB-05",
    verdict: "red",
    detail: `${violations.length} hardcoded 'girlchess.db' path-construction site(s) outside the sanctioned files: ${list}. This is a K5b acceptance target, not yet implemented.`,
  };
}

// DB-06: a STATIC source check on tools/gate.ts -- deliberately never
// spawns/executes gate.ts (the harness's own safety rule bans "npm run
// gate" outright, and gate.ts's own owner-db precheck would open the real
// resolved db even readonly, which this suite has no business doing at
// all). Checked by reading gate.ts's own source text for the guard's
// signature strings.
function db06(): EvalResult {
  const gateSrc = fs.readFileSync(path.join(REPO_ROOT, "tools", "gate.ts"), "utf-8");
  const hasInPlayGuard = /owner may be playing/i.test(gateSrc);
  const hasAllowLiveFlag = /--allow-live/.test(gateSrc);
  if (hasInPlayGuard && hasAllowLiveFlag) {
    return { id: "DB-06", verdict: "pass", detail: "tools/gate.ts's source carries both the in-play guard message and the --allow-live override flag." };
  }
  return {
    id: "DB-06",
    verdict: "red",
    detail:
      `tools/gate.ts's source is missing ${!hasInPlayGuard ? "the in-play guard message" : ""}` +
      `${!hasInPlayGuard && !hasAllowLiveFlag ? " and " : ""}${!hasAllowLiveFlag ? "the --allow-live override flag" : ""} -- ` +
      "the twice-broken 'owner may be playing' hard rule is not yet mechanized into the gate. This is a K5a acceptance target, not yet implemented. " +
      "(Checked statically; gate.ts was never executed, per the harness's standing 'no npm run gate' rule.)",
  };
}

// DB-07: canonical resolution -- deriveMainWorktreeDbFromGit run from THIS
// real worktree (a genuine linked worktree, git-plumbing-verified, zero
// fabrication) must resolve to the MAIN worktree's data/girlchess.db, not
// this worktree's own; and server/index.ts's source must carry the
// NODE_ENV=test -> ":memory:" ternary. Both read-only; nothing is opened.
function db07(): EvalResult {
  const derived = deriveMainWorktreeDbFromGit(REPO_ROOT);
  const expectedSuffix = path.join("data", "girlchess.db");
  const resolvesToMainData = !!derived && derived.endsWith(expectedSuffix) && !derived.startsWith(REPO_ROOT);
  const indexSrc = fs.readFileSync(path.join(REPO_ROOT, "server", "index.ts"), "utf-8");
  const forcesMemoryInTest = /NODE_ENV\s*===\s*"test"\s*\?\s*":memory:"/.test(indexSrc);
  if (resolvesToMainData && forcesMemoryInTest) {
    return { id: "DB-07", verdict: "pass", detail: `derived main-worktree db path: ${derived}; server/index.ts forces :memory: under NODE_ENV=test.` };
  }
  return {
    id: "DB-07",
    verdict: "red",
    detail: `resolvesToMainData=${resolvesToMainData} (derived=${derived}); forcesMemoryInTest=${forcesMemoryInTest}`,
  };
}

export async function runDbSuite(): Promise<SuiteResult> {
  const results: EvalResult[] = [await db01(), db02(), db03(), db04(), db05(), db06(), db07()];
  assertDenominator(results, 7, "DB");
  return {
    suite: "DB",
    expectedCount: 7,
    results,
    ranAt: new Date().toISOString(),
    notes: [
      "DB-01/DB-02 now run for real against the merged tools/db-backup.ts (K5a): backupLiveDb()/restoreCheck() called directly, scratch dbs only, never data/girlchess.db.",
      "DB-03/DB-04/DB-05 executed for real against pre-K5b code and are expected red -- each checks a guarantee K5b (the single-source db-path refactor) has not shipped yet.",
      "DB-06 now passes for real: gate.ts's in-play guard merged with phase A; checked by the same static source scan as before, gate.ts itself untouched by this suite.",
      "DB-07 already passes: canonical path resolution and the NODE_ENV=test :memory: guard predate this round.",
    ],
  };
}
