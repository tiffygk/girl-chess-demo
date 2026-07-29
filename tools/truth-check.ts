// tools/truth-check.ts
//
// Coach truth-speed round (2026-07-27) -- verification gate for exit
// criterion 2 of the approved plan. The owner's playtest report, verbatim:
// she played the engine's own recommended move (queen f6, checkmate; king
// to h1) and the debrief still asked "what may have happened if instead
// ...", forcing her to go check chat to find out whether she'd already done
// it. Waves A1 (src/review/followedBest.ts) and C1 (src/review/
// turningPointNote.ts) shipped the fix: a turning-point note must NOT
// render a counterfactual (whatMayHaveHappened) when followedBest says she
// played the recommended move.
//
// This script proves the fix against the owner's REAL play history (not a
// synthetic fixture): every finished game in a WAL-safe scratch copy of
// data/girlchess.db, every turning line reconstructed the same way the app
// does, run through the SAME shipped modules (imported, never
// reimplemented) that the debrief actually calls:
//   - src/review/followedBest.ts     (followedBest)
//   - src/review/turningPointNote.ts (buildTurningPointNote)
//
// TurningLine assembly itself mirrors the read-only half of
// server/game/manager.ts's getTurningLines. That method can't be imported
// standalone -- it's a private method on GameManager, whose constructor
// spawns a live Stockfish process (`new StockfishEvaluator()`) and wires up
// Maia/coach backends, none of which this read-only check may start. The
// mirrored piece here (SQL read of already-persisted best_move/pv columns +
// a chess.js replay of an already-computed pv string) is pure data
// plumbing, not any part of the counterfactual-suppression logic under
// test -- it is exactly what getTurningLines does, documented inline at
// each divergence point. The `threat` field is intentionally omitted: it's
// verdict-derived display data, never consumed by followedBest/
// opportunity/turningPointNote.
//
// Isolation (same hard rule + pattern as tools/coach-eval/run.ts):
//   - NEVER opens data/girlchess.db directly. Copies it (+ -wal/-shm
//     siblings, so rows still sitting in the WAL are not silently
//     dropped) to a gitignored scratch path under
//     tools/.truth-check-scratch/, and calls openDb() only on that copy.
//   - Asserts the opened db's own resolved file (PRAGMA database_list)
//     equals the scratch path -- aborts before reading anything if not.
//   - Records sha256 of the real db before and after the run; throws if
//     they differ.
//   - Never deletes/checkpoints the real db, starts no server, spawns no
//     engine process.
//
// Run: npx tsx tools/truth-check.ts
// Exit code 0 iff every must-be-0 count below is actually 0.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import Database from "better-sqlite3";
import {
  openDb,
  getGameMoves,
  getTurningPoints,
  getMoveEvalsByPlies,
  listFinishedGames,
} from "../server/store/db";
import { moveEndpoints } from "../server/annotator/moveEndpoints";
import { followedBest } from "../src/review/followedBest";
import { buildTurningPointNote } from "../src/review/turningPointNote";
import type { TurningLine, TurningPoint, MoveClassification, SummaryMove } from "../src/game/api";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

// The owner plays on the MAIN worktree; every OTHER worktree (this one
// included) has no data/girlchess.db of its own by default. Without this,
// `npm run gate` inside a worktree throws "real db not found" instead of
// checking her real history.
//
// Fix-wave F2 (2026-07-29): the old order tried <repoRoot>/data/
// girlchess.db BEFORE the main worktree, with no freshness or size check --
// data/* is gitignored, so a stale/demo snapshot dropped in a worktree
// (exactly the state Task 0 itself found and deleted) silently became the
// entire corpus every downstream check ran against, and printed nothing to
// say so. Resolution is now live-db-first:
//   1. GC_DB_PATH env override -- an explicit escape hatch (tests, CI).
//   2. the main worktree's db -- the source of truth whenever it exists.
//      Never written to (see copyScratchDb below); only ever the COPY
//      SOURCE for a WAL-safe scratch snapshot.
//   3. <repoRoot>/data/girlchess.db -- last resort, only when the main
//      worktree db is genuinely absent (a fresh clone, CI, a worktree
//      deliberately given its own copy), and only once it proves itself
//      non-empty by COUNTING games (never by hashing -- the project's
//      standing rule for her db).
// Every caller of resolveRealDbPath is expected to log the returned
// `source` once, at the top of its run, so a stale read is visible instead
// of silent.
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

const dbResolution = resolveRealDbPath(REPO_ROOT);
const REAL_DB_PATH = dbResolution.path;
const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".truth-check-scratch", "girlchess.db");

export function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

// Same WAL-safe copy tools/coach-eval/run.ts uses: a plain `cp` of the .db
// alone misses rows still sitting in the -wal file (SQLite hasn't
// checkpointed them into the main file yet) -- the newest games would
// silently vanish from this check. Copying all three siblings and letting
// SQLite's own WAL replay do the reconciliation on open is the only correct
// way to snapshot a live WAL-mode db.
export function copyScratchDb(sourcePath: string, destPath: string) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = sourcePath + suffix;
    const dest = destPath + suffix;
    if (fs.existsSync(dest)) fs.rmSync(dest);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

// Mirrors manager.ts's private `pvLine` exactly: replays a persisted pv
// (space-separated UCI, e.g. "g1f3 b8c6 f1c4") -- or a lone bestMove when
// pv is absent -- from fenBefore through chess.js, collecting SANs as it
// goes. Stops at the first illegal/malformed step rather than throwing, so
// a corrupted pv degrades to a shorter true line instead of failing the
// whole game. Pure data plumbing (replaying an already-computed engine
// line), not the counterfactual-suppression logic this gate exists to
// verify.
export function reconstructPvLine(
  fenBefore: string,
  ev: { bestMove: string | null; pv: string | null } | undefined
): { pvSans: string[]; bestSan?: string; bestFromTo?: { from: string; to: string } } {
  if (!ev) return { pvSans: [] };
  const uciList =
    ev.pv && ev.pv.trim().length > 0 ? ev.pv.trim().split(/\s+/) : ev.bestMove ? [ev.bestMove] : [];
  if (uciList.length === 0) return { pvSans: [] };

  const replay = new Chess(fenBefore);
  const pvSans: string[] = [];
  let bestFromTo: { from: string; to: string } | undefined;
  for (const uci of uciList) {
    if (uci.length < 4) break;
    let mv;
    try {
      mv = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" });
    } catch {
      mv = null;
    }
    if (!mv) break;
    pvSans.push(mv.san);
    if (!bestFromTo) bestFromTo = { from: mv.from, to: mv.to };
  }
  return { pvSans, bestSan: pvSans[0], bestFromTo };
}

export interface RawTurningPointRow {
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  ply: number;
  san: string;
  label: string;
  punish_san: string | null;
  delta_p: number;
  low_confidence: number | null;
  kind: TurningPoint["kind"];
  ply_end: number | null;
  missed_punish: number | null;
  crossed_advantage: number | null;
  end_kind: string | null;
  // F9 (review-2.md LOW, fix wave 2026-07-29): were never mapped, so the
  // truth gate reconstructed an unconverted/missed-win point without the
  // number those points' claims rest on ("you had mate in twelve there
  // instead", "this slipped N times").
  mate_in: number | null;
  missed_count: number | null;
}

export function toTurningPoint(r: RawTurningPointRow): TurningPoint {
  return {
    rank: r.rank,
    ply: r.ply,
    san: r.san,
    label: r.label,
    punishSan: r.punish_san ?? undefined,
    deltaP: r.delta_p,
    lowConfidence: !!r.low_confidence,
    kind: r.kind,
    missedPunish: r.missed_punish == null ? undefined : !!r.missed_punish,
    plyEnd: r.ply_end ?? undefined,
    crossedAdvantage: r.crossed_advantage == null ? undefined : !!r.crossed_advantage,
    endKind: r.end_kind ?? undefined,
    mateIn: r.mate_in ?? undefined,
    missedCount: r.missed_count ?? undefined,
  };
}

interface LineId {
  gameId: number;
  ply: number;
}

function fmtLineId(l: LineId): string {
  return `game ${l.gameId} ply ${l.ply}`;
}

async function main() {
  console.log(`[truth-check] db source: ${REAL_DB_PATH} (${dbResolution.source})`);
  if (!fs.existsSync(REAL_DB_PATH)) {
    throw new Error(`real db not found at ${REAL_DB_PATH} -- nothing to copy from`);
  }

  const beforeHash = sha256File(REAL_DB_PATH);
  copyScratchDb(REAL_DB_PATH, SCRATCH_DB_PATH);
  console.log(`[truth-check] copied ${REAL_DB_PATH} -> ${SCRATCH_DB_PATH}`);

  const dbHandle = openDb(SCRATCH_DB_PATH);
  const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(SCRATCH_DB_PATH)) {
    throw new Error(
      `db isolation violated: openDb resolved to "${resolved}", expected scratch path "${SCRATCH_DB_PATH}". Aborting before any read.`
    );
  }
  console.log(`[truth-check] db isolation confirmed: ${resolved}`);

  // Static gate check: DebriefPage.tsx must render note.nextTime behind a
  // truthy guard (`{note.nextTime && ...}`) for "next time: undefined" to
  // be structurally impossible regardless of the data below. If that guard
  // ever disappears, every line whose nextTime came back absent becomes a
  // real violation -- counted below rather than assumed away.
  const debriefPageSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "review", "DebriefPage.tsx"), "utf8");
  const nextTimeGateOk = /\{note\.nextTime\s*&&/.test(debriefPageSrc);
  if (!nextTimeGateOk) {
    console.warn(
      "[truth-check] WARNING: DebriefPage.tsx's note.nextTime render no longer appears truthy-gated -- every absent nextTime below is now a counted violation."
    );
  }

  const games = listFinishedGames(1_000_000) as { id: number }[];

  let totalLines = 0;
  let followedCount = 0;
  const counterfactualViolations: LineId[] = [];
  const nextTimeViolations: LineId[] = [];
  const opportunityCounts = new Map<string, number>();
  let opportunityUndefinedCount = 0;
  const keepsInitiativeLines: LineId[] = [];

  for (const game of games) {
    const gameId = game.id;
    const movesRows = getGameMoves(gameId) as {
      ply: number;
      san: string;
      classification: string | null;
    }[];
    if (movesRows.length === 0) continue;

    const gameSans: SummaryMove[] = movesRows.map((r) => ({ ply: r.ply, san: r.san }));
    const classifications: MoveClassification[] = movesRows
      .filter((r) => r.classification != null)
      .map((r) => ({ ply: r.ply, classification: r.classification as string }));

    const tpRows = getTurningPoints(gameId) as RawTurningPointRow[];
    if (tpRows.length === 0) continue;

    // Same seed-ply set + batched eval read as getTurningLines: the player-
    // to-move seed for turning point t.ply is t.ply - (t.ply % 2).
    const seedPlies = Array.from(new Set(tpRows.map((t) => t.ply - (t.ply % 2)).filter((p) => p >= 1)));
    const evals = getMoveEvalsByPlies(gameId, seedPlies);
    const evalByPly = new Map(evals.map((e) => [e.ply, e]));

    for (const row of tpRows) {
      const tp = toTurningPoint(row);

      const before = new Chess();
      for (let i = 0; i < tp.ply - 1 && i < gameSans.length; i++) before.move(gameSans[i].san);
      const fenBefore = before.fen();
      const playedFromTo = moveEndpoints(fenBefore, tp.san) ?? undefined;

      const seedPly = tp.ply - (tp.ply % 2);
      let pvSans: string[] = [];
      let bestSan: string | undefined;
      let bestFromTo: { from: string; to: string } | undefined;
      if (seedPly >= 1) {
        const seed = new Chess();
        for (let i = 0; i < seedPly && i < gameSans.length; i++) seed.move(gameSans[i].san);
        const fenSeed = seed.fen();
        const pv = reconstructPvLine(fenSeed, evalByPly.get(seedPly));
        pvSans = pv.pvSans;
        bestSan = pv.bestSan;
        bestFromTo = pv.bestFromTo;
      }

      const line: TurningLine = { ply: tp.ply, pvSans };
      if (playedFromTo) line.playedFromTo = playedFromTo;
      if (bestSan) line.bestSan = bestSan;
      if (bestFromTo) line.bestFromTo = bestFromTo;

      const fb = followedBest(line, gameSans);
      const cls = classifications.find((c) => c.ply === tp.ply);
      const note = buildTurningPointNote(tp, cls, line, gameSans);

      totalLines++;
      const lineId: LineId = { gameId, ply: tp.ply };

      if (fb?.followed) {
        followedCount++;
        if (note.whatMayHaveHappened) counterfactualViolations.push(lineId);
      }

      if (!nextTimeGateOk && note.nextTime === undefined) {
        nextTimeViolations.push(lineId);
      }

      if (note.opportunity === undefined) {
        opportunityUndefinedCount++;
      } else {
        opportunityCounts.set(note.opportunity, (opportunityCounts.get(note.opportunity) ?? 0) + 1);
        if (note.opportunity === "keeps the initiative") keepsInitiativeLines.push(lineId);
      }
    }
  }

  const afterHash = sha256File(REAL_DB_PATH);
  if (afterHash !== beforeHash) {
    throw new Error(
      `data/girlchess.db changed during this run (sha256 before=${beforeHash} after=${afterHash}) -- isolation was violated. Investigate immediately; do not trust this run's results.`
    );
  }
  console.log(`[truth-check] real db unchanged (sha256 ${afterHash.slice(0, 12)}...)`);

  console.log("\n[truth-check] ---- report ----");
  console.log(`games examined (finished): ${games.length}`);
  console.log(`total turning lines examined: ${totalLines}`);
  console.log(`followed === true: ${followedCount} / ${totalLines}`);
  console.log(
    `VIOLATIONS (followed=true AND whatMayHaveHappened present): ${counterfactualViolations.length} (must be 0)`
  );
  console.log(
    `VIOLATIONS (nextTime absent but render ungated -> "next time: undefined"): ${nextTimeViolations.length} (must be 0)`
  );
  console.log(`opportunity: undefined (no provable claim): ${opportunityUndefinedCount}`);
  console.log("opportunity distribution (non-undefined):");
  for (const [outcome, count] of [...opportunityCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${outcome}`);
  }
  console.log(`VIOLATIONS ("keeps the initiative" still present): ${keepsInitiativeLines.length} (must be 0)`);

  const ok =
    counterfactualViolations.length === 0 && nextTimeViolations.length === 0 && keepsInitiativeLines.length === 0;

  if (!ok) {
    console.log("\n[truth-check] FAILING LINES:");
    if (counterfactualViolations.length > 0) {
      console.log("  counterfactual-on-played-move:");
      for (const l of counterfactualViolations) console.log(`    ${fmtLineId(l)}`);
    }
    if (nextTimeViolations.length > 0) {
      console.log("  next-time-undefined-rendered:");
      for (const l of nextTimeViolations) console.log(`    ${fmtLineId(l)}`);
    }
    if (keepsInitiativeLines.length > 0) {
      console.log('  "keeps the initiative" still present:');
      for (const l of keepsInitiativeLines) console.log(`    ${fmtLineId(l)}`);
    }
  }

  console.log(`\n[truth-check] VERDICT: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

// Guard main() behind a direct-execution check (the ESM equivalent of
// Python's `if __name__ == "__main__"`) so tools/truth-check.test.ts can
// import this module's pure helpers (reconstructPvLine, toTurningPoint)
// without triggering a real db copy/open as a side effect of import.
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("[truth-check] error:", err);
    process.exit(1);
  });
}
