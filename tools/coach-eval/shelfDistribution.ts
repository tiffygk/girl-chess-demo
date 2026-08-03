// tools/coach-eval/shelfDistribution.ts
//
// OD-3b instrument repair (2026-08-03), TASK 1's own proof step: print the
// shelfCovered true/false distribution across the FULL fixture set (every
// arm, every question fixtures.ts declares), so the fix can be shown to
// produce a real mix rather than asserted to. Deliberately standalone from
// run.ts's main() -- this needs no coach backend, no model, no Stockfish,
// and makes zero coach calls, so it is safe to run at any time, including
// while a live game is in progress (unlike `npm run gate` or a real
// coach-eval run). It only ever opens a WAL-safe scratch COPY of
// data/girlchess.db (coach-eval skill rule 8), the same copyScratchDb
// discipline run.ts uses, and never opens the real path with a
// read/write handle (openDb always CREATE TABLE IF NOT EXISTS +
// migrateSchema's ALTER TABLE, so it must never touch the real file).
//
// Invoke: npx tsx tools/coach-eval/shelfDistribution.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openDb, getGameMoves } from "../../server/store/db";
import {
  FIXTURES,
  BASE_QUESTIONS,
  PENDING_QUESTIONS,
  AFFIRMATION_QUESTIONS,
  GENERAL_QUESTIONS,
  BOARD_REVIEW_QUESTIONS,
  FORK_QUESTIONS,
  MATE_QUESTIONS,
  LONG_QUESTIONS,
  GENERAL_THEORY_QUESTIONS,
  type Arm,
  type FixtureId,
} from "./fixtures";
import { shelfCovered, classifyDifficulty } from "./difficulty";

interface MoveRow {
  ply: number;
  best_move: string | null;
  pv: string | null;
  eval_mate: number | null;
}

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "../..");

function copyScratchDb(sourcePath: string, destPath: string) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = sourcePath + suffix;
    const dest = destPath + suffix;
    if (fs.existsSync(dest)) fs.rmSync(dest);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

interface Row {
  id: string;
  arm: Arm;
  ctx: FixtureId;
  pending?: unknown;
}

function allRows(): Row[] {
  return [
    ...BASE_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...PENDING_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx, pending: q.pending })),
    ...AFFIRMATION_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx, pending: q.pending })),
    ...GENERAL_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...BOARD_REVIEW_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...FORK_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...MATE_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...LONG_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
    ...GENERAL_THEORY_QUESTIONS.map((q) => ({ id: q.id, arm: q.arm, ctx: q.ctx })),
  ];
}

function main() {
  const realDbPath = path.join(REPO_ROOT, "data", "girlchess.db");
  const scratchDbPath = path.join(TOOL_DIR, ".scratch", "shelf-distribution.db");
  if (!fs.existsSync(realDbPath)) {
    throw new Error(`real db not found at ${realDbPath} -- nothing to copy from`);
  }
  copyScratchDb(realDbPath, scratchDbPath);
  console.log(`[shelf-distribution] readonly-intent scratch copy: ${realDbPath} -> ${scratchDbPath} (real db never opened directly)`);

  openDb(scratchDbPath);

  const rowsByGame = new Map<number, MoveRow[]>();
  const rows = allRows();

  let trueCount = 0;
  let falseCount = 0;
  const byArm = new Map<Arm, { true: number; false: number }>();
  const byDifficulty = new Map<string, number>();
  const gtLines: string[] = [];

  for (const q of rows) {
    const fixture = FIXTURES[q.ctx];
    if (!rowsByGame.has(fixture.gameId)) {
      rowsByGame.set(fixture.gameId, getGameMoves(fixture.gameId) as MoveRow[]);
    }
    const pinnedRow = rowsByGame.get(fixture.gameId)!.find((r) => r.ply === fixture.ply);
    const shelfSignal = {
      hasBestLine: !!(pinnedRow?.best_move || pinnedRow?.pv),
      hasMate: pinnedRow?.eval_mate != null,
      hasPendingMove: !!q.pending,
      arm: q.arm,
    };
    const covered = shelfCovered(shelfSignal);
    const difficulty = classifyDifficulty(shelfSignal);

    if (covered) trueCount++;
    else falseCount++;
    const armCounts = byArm.get(q.arm) ?? { true: 0, false: 0 };
    if (covered) armCounts.true++;
    else armCounts.false++;
    byArm.set(q.arm, armCounts);
    byDifficulty.set(difficulty, (byDifficulty.get(difficulty) ?? 0) + 1);

    if (q.arm === "general-theory") {
      gtLines.push(`  ${q.id} (${q.ctx}) -> shelfCovered=${covered} difficulty=${difficulty}`);
    }
  }

  console.log(`\n[shelf-distribution] TOTAL rows: ${rows.length}`);
  console.log(`[shelf-distribution] shelfCovered=true:  ${trueCount}`);
  console.log(`[shelf-distribution] shelfCovered=false: ${falseCount}`);
  console.log(
    `[shelf-distribution] ${trueCount > 0 && falseCount > 0 ? "MIX confirmed (both true and false present)" : "DEGENERATE -- still all one value"}`
  );

  console.log(`\n[shelf-distribution] by arm:`);
  for (const [arm, counts] of byArm.entries()) {
    console.log(`  ${arm.padEnd(15)} true=${counts.true} false=${counts.false}`);
  }

  console.log(`\n[shelf-distribution] by difficulty bucket:`);
  for (const [tag, count] of byDifficulty.entries()) {
    console.log(`  ${tag.padEnd(18)} ${count}`);
  }

  console.log(`\n[shelf-distribution] general-theory (gt-*) rows, per-question:`);
  for (const line of gtLines) console.log(line);
}

main();
