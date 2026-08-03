// tools/highlight-lines-spot-check.ts
//
// Opponent-move-analysis plan (2026-08-03), Wave A -- the ground-truth
// calibration artifact the plan's checklist calls for: prints HighlightLine
// rows for 5 REAL mallow plies from the owner's actual play history, so
// bestSan/pv can be hand-verified against the stored pv text before this
// wave is called done. Per the plan (section 6): if the engine's stored pv
// and this module's bestSan ever disagree, that is a stop-the-wave bug, not
// noise.
//
// Isolation (same hard rule + pattern as tools/truth-check.ts /
// tools/coach-eval/run.ts): NEVER opens data/girlchess.db directly. Copies
// it (+ -wal/-shm siblings, so rows still sitting in the WAL aren't
// silently dropped) to a gitignored scratch path under
// tools/.highlight-lines-scratch/, and calls openDb() only on that copy.
// Counts games/moves and checks integrity_check before and after; aborts
// on a real shrink or a broken integrity_check -- counts are expected to
// GROW (she plays on the main worktree while this runs).
//
// buildHighlightLines is IMPORTED from server/annotator/highlightLines.ts,
// never reimplemented -- this script is a thin data-plumbing harness
// around the real production module, exactly the discipline
// truth-check.ts's own header documents for TurningLine.
//
// Run: npx tsx tools/highlight-lines-spot-check.ts
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { openDb, getGameMoves } from "../server/store/db";
import { buildHighlightLines, type HighlightMoveRow } from "../server/annotator/highlightLines";
import { resolveRealDbPath, copyScratchDb, reconstructPvLine } from "./truth-check";
import { countDbSnapshot, checkDbIntact } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

function toHighlightMoveRow(r: any): HighlightMoveRow {
  return {
    ply: r.ply,
    san: r.san,
    uci: r.uci ?? null,
    evalCp: r.eval_cp ?? null,
    evalMate: r.eval_mate ?? null,
    bestMove: r.best_move ?? null,
    pv: r.pv ?? null,
    highlighted: r.highlighted === 1,
    // Diagnostic query only, to LOCATE fixture rows to print for eyeballing
    // -- never a production decision path. The one production consumer
    // (manager.ts's getHighlightLines) derives `side` this exact same way,
    // once, at its own data-load remap; this script mirrors that, it does
    // not re-derive anything a shipped module already computed.
    side: (r.ply % 2 === 1 ? "her" : "mallow") as "her" | "mallow",
  };
}

function main() {
  const dbResolution = resolveRealDbPath(REPO_ROOT);
  const REAL_DB_PATH = dbResolution.path;
  const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".highlight-lines-scratch", "girlchess.db");

  console.log(`Real db resolved via: ${dbResolution.source}`);
  console.log(`Real db path: ${REAL_DB_PATH}`);

  const before = countDbSnapshot(REAL_DB_PATH);
  console.log(`Real db BEFORE: ${before.games} games, ${before.moves} moves, integrity ${before.integrity}`);

  copyScratchDb(REAL_DB_PATH, SCRATCH_DB_PATH);
  openDb(SCRATCH_DB_PATH);

  // Guard (same as truth-check.ts): assert the opened db's own resolved
  // file is really the scratch copy, never the real file, before reading
  // anything.
  const rawForCheck = new Database(SCRATCH_DB_PATH, { readonly: true });
  const dbList = rawForCheck.pragma("database_list") as { file: string }[];
  rawForCheck.close();
  const resolvedFile = dbList[0]?.file;
  if (!resolvedFile || path.resolve(resolvedFile) !== path.resolve(SCRATCH_DB_PATH)) {
    throw new Error(
      `Refusing to continue: opened db resolved to "${resolvedFile}", not the scratch copy "${SCRATCH_DB_PATH}".`
    );
  }

  const raw = new Database(SCRATCH_DB_PATH, { readonly: true });
  // Diagnostic-only query (see toHighlightMoveRow's comment): finds
  // finished games with at least one highlighted EVEN (mallow) ply, newest
  // first, so this script can pull real mallow rows without scanning every
  // game in the corpus.
  const candidateGameIds = (
    raw
      .prepare(
        `SELECT DISTINCT m.game_id AS gameId
         FROM moves m
         JOIN games g ON g.id = m.game_id
         WHERE m.highlighted = 1 AND m.ply % 2 = 0 AND g.result IS NOT NULL
         ORDER BY m.game_id DESC`
      )
      .all() as { gameId: number }[]
  ).map((r) => r.gameId);
  raw.close();

  console.log(`Finished games with >=1 highlighted mallow ply: ${candidateGameIds.length}`);

  const spotRows: { gameId: number; line: ReturnType<typeof buildHighlightLines>[number] }[] = [];
  for (const gameId of candidateGameIds) {
    if (spotRows.length >= 5) break;
    const rows = getGameMoves(gameId).map(toHighlightMoveRow);
    const lines = buildHighlightLines(rows, reconstructPvLine);
    for (const line of lines) {
      if (line.side !== "mallow") continue;
      spotRows.push({ gameId, line });
      if (spotRows.length >= 5) break;
    }
  }

  console.log(`\n=== ${spotRows.length} real mallow HighlightLine rows (hand-verify bestSan/pv against stored pv) ===\n`);
  for (const { gameId, line } of spotRows) {
    // Print the SEED ply's raw stored pv/best_move text too (not just the
    // module's derived bestSan/pvSans), so bestSan can be hand-checked
    // against the literal stored string -- the exact check the plan's
    // checklist and section 6 call for.
    const rawScratch = new Database(SCRATCH_DB_PATH, { readonly: true });
    const seedRow = rawScratch
      .prepare("SELECT best_move, pv FROM moves WHERE game_id = ? AND ply = ?")
      .get(gameId, line.ply - 1) as { best_move: string | null; pv: string | null } | undefined;
    rawScratch.close();

    console.log(`game ${gameId}, ply ${line.ply} (${line.side}), played ${line.san}`);
    console.log(`  seed (ply ${line.ply - 1}) stored best_move: ${seedRow?.best_move ?? "(none)"}, pv: "${seedRow?.pv ?? ""}"`);
    console.log(`  module bestSan: ${line.bestSan ?? "(none)"}, pvSans: [${line.pvSans.join(", ")}]`);
    console.log(`  matchedBest: ${line.matchedBest}, quality: ${line.quality}, gapCp: ${line.gapCp}, mateInvolved: ${line.mateInvolved}, decided: ${line.decided}`);
    console.log("");
  }

  if (spotRows.length < 5) {
    console.warn(`WARNING: only found ${spotRows.length} real mallow highlighted plies with a p-1 seed (need 5 for the plan's spot check).`);
  }

  const after = countDbSnapshot(REAL_DB_PATH);
  console.log(`Real db AFTER: ${after.games} games, ${after.moves} moves, integrity ${after.integrity}`);
  const problem = checkDbIntact(before, after);
  if (problem) {
    throw new Error(problem);
  }
  console.log("Real db isolation check: OK (counts did not shrink, integrity ok).");
}

main();
