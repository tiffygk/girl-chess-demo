// tools/coach-eval/run.ts
//
// CLI entry point: executes ONE model over all 65 fixtures/questions,
// writing raw json incrementally. Invoke via:
//
//   npx tsx tools/coach-eval/run.ts --model sonnet --wiring legacy
//   npx tsx tools/coach-eval/run.ts --model opus   --wiring legacy --out tools/coach-eval/runs/<ts>
//
// See README.md for the full baseline/post-fix invocation pair and the
// isolation rules this file enforces. This file NEVER opens
// data/girlchess.db -- it only ever copies it to a scratch path this tool
// owns, then calls openDb() on the copy.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import { openDb, getGame, getGameMoves } from "../../server/store/db";
import type { ChatContext, ChatPerPlyInput } from "../../server/coach/chat";
import {
  FIXTURES,
  BASE_QUESTIONS,
  PENDING_QUESTIONS,
  AFFIRMATION_QUESTIONS,
  ENGINE_BEST_UCI_BY_FIXTURE,
  NARR_HINT_LEVEL,
  NARR_HINT_TEXT,
  TOTAL_QUESTION_COUNT,
  type Fixture,
  type FixtureId,
  type QuestionTag,
  type PendingMove,
  type PendingTier,
} from "./fixtures";
import type { AnswerRow } from "./score";
import { parseArgs, sha256File, timestamp } from "./util";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "../..");

type Model = "sonnet" | "opus";
type Wiring = "legacy" | "threaded";

const MODEL_ENV: Record<Model, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-4-8",
};

interface MoveRow {
  ply: number;
  san: string;
  best_move: string | null;
  pv: string | null;
  eval_cp: number | null;
  eval_mate: number | null;
}

// Mirrors server/game/manager.ts's private pvLine method exactly (uci pv/
// best_move -> san, replayed from the given fen) -- duplicated here on
// purpose per the methodology's own note (scout-map §4): a harness that
// doesn't go through GameManager needs its own tiny UCI->SAN replay rather
// than reaching into a private class method.
function pvLine(fenBefore: string, ev: { bestMove: string | null; pv: string | null }): { pvSans: string[]; bestSan?: string } {
  const uciList = ev.pv && ev.pv.trim().length > 0 ? ev.pv.trim().split(/\s+/) : ev.bestMove ? [ev.bestMove] : [];
  if (uciList.length === 0) return { pvSans: [] };
  const replay = new Chess(fenBefore);
  const pvSans: string[] = [];
  for (const uci of uciList) {
    if (uci.length < 4) break;
    let mv;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors manager.ts's own pvLine cast verbatim
      mv = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" });
    } catch {
      mv = null;
    }
    if (!mv) break;
    pvSans.push(mv.san);
  }
  return { pvSans, bestSan: pvSans[0] };
}

function truncatedMoves(rows: MoveRow[], ply: number): { ply: number; san: string }[] {
  return rows.filter((r: MoveRow) => r.ply <= ply).map((r: MoveRow) => ({ ply: r.ply, san: r.san }));
}

function buildPerPlyAnalysis(rows: MoveRow[], ply: number): ChatPerPlyInput[] {
  const truncated = rows.filter((r) => r.ply <= ply);
  const replay = new Chess();
  return truncated.map((r) => {
    const mv = replay.move(r.san);
    const fenAfter = replay.fen();
    const { pvSans, bestSan } = pvLine(fenAfter, { bestMove: r.best_move, pv: r.pv });
    return {
      ply: r.ply,
      san: mv.san,
      evalCp: r.eval_cp,
      evalMate: r.eval_mate,
      bestSan: bestSan ?? null,
      pvSans,
    };
  });
}

function engineBestForFixture(rows: MoveRow[], fixture: Fixture): { pvSans: string[]; bestSan?: string } | undefined {
  const row = rows.find((r) => r.ply === fixture.ply);
  if (!row) return undefined;
  return pvLine(fixture.fen, { bestMove: row.best_move, pv: row.pv });
}

// A single normalized question, whatever bucket it came from -- the shape
// run.ts's main loop actually iterates.
interface EvalQuestion {
  id: string;
  tag: QuestionTag;
  q: string;
  ctx: FixtureId;
  probe: boolean;
  pending?: PendingMove;
  pendingTier?: PendingTier;
}

function buildQuestionList(): EvalQuestion[] {
  const base: EvalQuestion[] = BASE_QUESTIONS.map((b) => ({ id: b.id, tag: b.tag, q: b.q, ctx: b.ctx, probe: b.probe }));
  const pending: EvalQuestion[] = PENDING_QUESTIONS.map((p) => ({
    id: p.id,
    tag: p.tag,
    q: p.q,
    ctx: p.ctx,
    probe: false,
    pending: p.pending,
    pendingTier: p.tier,
  }));
  const affirmation: EvalQuestion[] = AFFIRMATION_QUESTIONS.map((p) => ({
    id: p.id,
    tag: p.tag,
    q: p.q,
    ctx: p.ctx,
    probe: false,
    pending: p.pending,
    pendingTier: p.tier,
  }));
  const all = [...base, ...pending, ...affirmation];
  if (all.length !== TOTAL_QUESTION_COUNT) {
    throw new Error(`question list drift: built ${all.length}, fixtures.ts declares ${TOTAL_QUESTION_COUNT}`);
  }
  return all;
}

// --wiring legacy: mirrors the CURRENT client gate (GamePage.tsx) exactly --
// only nudge/warning pending fixtures get herMove+tier; everything else
// (silent, judge-in-flight, no-pending) gets a bare live context. See the
// methodology's "representing the pending move on the CURRENT pipeline"
// section for why this is an honest baseline ceiling, not a harness bug.
//
// --wiring threaded: a forward-compat hook for R2 Task 1's not-yet-landed
// ChatContext.pendingMove field. Inert today (assembleChatFactList/
// validateChat don't read it), added as an extra JSON property so this
// becomes real the moment Task 1 defines the field -- no harness change
// needed then.
function buildContext(
  question: EvalQuestion,
  engineBest: { pvSans: string[]; bestSan?: string } | undefined,
  wiring: Wiring
): ChatContext {
  if (question.tag === "narr") {
    return {
      mode: "live",
      hintFocus: {
        level: NARR_HINT_LEVEL,
        text: NARR_HINT_TEXT,
        bestSan: engineBest?.bestSan,
        pvSans: engineBest?.pvSans,
      },
    };
  }

  if (question.tag === "pending" || question.tag === "affirmation") {
    const base: ChatContext = { mode: "live" };
    if (wiring === "legacy") {
      if (question.pending && (question.pendingTier === "warning" || question.pendingTier === "nudge")) {
        return { ...base, herMove: question.pending, tier: question.pendingTier };
      }
      return base;
    }
    // threaded (forward-compat, inert until R2 Task 1 lands)
    const threaded = base as ChatContext & { pendingMove?: unknown };
    if (question.pending) {
      threaded.pendingMove = {
        pieceKind: question.pending.pieceKind,
        from: question.pending.from,
        to: question.pending.to,
        san: question.pending.san,
        tier: question.pendingTier,
        judged: question.pendingTier === "judge-in-flight" ? false : true,
      };
    }
    return threaded;
  }

  // open / dir: bare context, no focus.
  return { mode: "live" };
}

function copyScratchDb(sourcePath: string, destPath: string) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = sourcePath + suffix;
    const dest = destPath + suffix;
    if (fs.existsSync(dest)) fs.rmSync(dest);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = args.model as Model;
  const wiring = args.wiring as Wiring;
  if (model !== "sonnet" && model !== "opus") {
    throw new Error(`--model must be "sonnet" or "opus" (got ${JSON.stringify(args.model)})`);
  }
  if (wiring !== "legacy" && wiring !== "threaded") {
    throw new Error(`--wiring must be "legacy" or "threaded" (got ${JSON.stringify(args.wiring)})`);
  }
  const outDir = args.out ? path.resolve(args.out) : path.join(TOOL_DIR, "runs", timestamp());

  // ---- DB isolation (hard rule) -----------------------------------------
  const realDbPath = path.join(REPO_ROOT, "data", "girlchess.db");
  const scratchDbPath = path.join(TOOL_DIR, ".scratch", `eval-${model}.db`);
  if (!fs.existsSync(realDbPath)) {
    throw new Error(`real db not found at ${realDbPath} -- nothing to copy from`);
  }
  const beforeHash = sha256File(realDbPath);
  copyScratchDb(realDbPath, scratchDbPath);
  console.log(`[coach-eval] copied ${realDbPath} -> ${scratchDbPath}`);

  // GC_COACH_MODEL MUST be set before agent-sdk.ts is ever imported --
  // AGENT_SDK_MODEL there is a module-load-time const. Dynamic import,
  // after this assignment, guarantees correctness regardless of whether
  // it's read once at import or per call.
  process.env.GC_COACH_MODEL = MODEL_ENV[model];
  console.log(`[coach-eval] model=${model} (GC_COACH_MODEL=${process.env.GC_COACH_MODEL}) wiring=${wiring}`);

  const dbHandle = openDb(scratchDbPath);
  const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(scratchDbPath)) {
    throw new Error(
      `db isolation violated: openDb resolved to "${resolved}", expected scratch path "${scratchDbPath}". Aborting before any coach call.`
    );
  }
  console.log(`[coach-eval] db isolation confirmed: ${resolved}`);

  // Explicitly pass agentSdkBackend to chat() rather than going through
  // pickCoachBackend (which defaults pref to "claude") -- the harness must
  // never silently fall back to a different backend than the one it just
  // pinned via GC_COACH_MODEL.
  const { agentSdkBackend } = await import("../../server/coach/backends/agent-sdk");
  const { chat, assembleChatFactList } = await import("../../server/coach/chat");
  const { getAdviceTraceById } = await import("../../server/store/db");

  // ---- fixture replay assertion ------------------------------------------
  const rowsByGame = new Map<number, MoveRow[]>();
  for (const fixture of Object.values(FIXTURES) as Fixture[]) {
    if (!getGame(fixture.gameId)) {
      throw new Error(`fixture ${fixture.id} references game ${fixture.gameId}, which does not exist in the scratch db`);
    }
    if (!rowsByGame.has(fixture.gameId)) {
      rowsByGame.set(fixture.gameId, getGameMoves(fixture.gameId) as MoveRow[]);
    }
    const rows = rowsByGame.get(fixture.gameId)!;
    const truncated = truncatedMoves(rows, fixture.ply);
    const replay = new Chess();
    for (const m of truncated) replay.move(m.san);
    if (replay.fen() !== fixture.fen) {
      throw new Error(
        `fixture drift -- db copy does not match pinned fixtures (${fixture.id}, game ${fixture.gameId}, ply ${fixture.ply}).\n` +
          `  expected: ${fixture.fen}\n  got:      ${replay.fen()}`
      );
    }
  }
  console.log(`[coach-eval] all ${Object.keys(FIXTURES).length} fixtures replay-verified against the scratch db`);

  // --limit N: run only the first N questions. For cheap wiring smoke
  // tests only -- a real baseline/post-fix run must always cover all 65
  // (fixtures.ts's TOTAL_QUESTION_COUNT) or it is not comparable against
  // the other model's run.
  const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
  const allQuestions = buildQuestionList();
  const questions = limit && limit > 0 ? allQuestions.slice(0, limit) : allQuestions;
  if (limit) console.log(`[coach-eval] --limit ${limit}: running ${questions.length}/${allQuestions.length} questions (smoke-test mode, not a full run)`);
  fs.mkdirSync(outDir, { recursive: true });
  const rawPath = path.join(outDir, `raw-${model}.json`);
  const results: (AnswerRow & { model: Model; wiring: Wiring; measuredLatencyMs: number })[] = [];

  for (const question of questions) {
    const fixture = FIXTURES[question.ctx];
    const rows = rowsByGame.get(fixture.gameId)!;
    const gameMoves = truncatedMoves(rows, fixture.ply);
    const perPly = buildPerPlyAnalysis(rows, fixture.ply);
    const engineBest = ENGINE_BEST_UCI_BY_FIXTURE[fixture.id] ? engineBestForFixture(rows, fixture) : undefined;
    const ctx = buildContext(question, engineBest, wiring);

    const facts = assembleChatFactList(gameMoves, ctx, undefined, perPly);
    const trace = { gameId: fixture.gameId, ply: fixture.ply, kind: "chat" };

    const start = Date.now();
    let outcome: { text: string; source: string; cause?: string; traceId?: number };
    try {
      outcome = await chat(question.q, [], facts, agentSdkBackend, trace);
    } catch (err) {
      outcome = { text: "", source: "error", cause: err instanceof Error ? err.message : String(err) };
    }
    const measuredLatencyMs = Date.now() - start;

    let regenCount = 0;
    let latencyMs = measuredLatencyMs;
    if (outcome.traceId != null) {
      const traceRow = getAdviceTraceById(outcome.traceId);
      if (traceRow) {
        regenCount = (traceRow.regen_count as number) ?? 0;
        latencyMs = (traceRow.latency_ms as number) ?? measuredLatencyMs;
      }
    }

    const row: AnswerRow & { model: Model; wiring: Wiring; measuredLatencyMs: number } = {
      id: question.id,
      fixtureId: fixture.id,
      question: question.q,
      tag: question.tag,
      probe: question.probe,
      text: outcome.text,
      source: outcome.source as AnswerRow["source"],
      cause: outcome.cause,
      regenCount,
      latencyMs,
      traceId: outcome.traceId,
      pending: question.pending,
      model,
      wiring,
      measuredLatencyMs,
    };
    results.push(row);
    // Write incrementally -- a mid-run crash loses nothing (v1 lost the
    // whole run to a single crash; this rewrites the full array to disk
    // after every answer, which at 65 rows is cheap).
    fs.writeFileSync(rawPath, JSON.stringify(results, null, 2));
    console.log(`[coach-eval] [${results.length}/${questions.length}] ${question.id} (${fixture.id}) -> ${outcome.source} ${latencyMs}ms regen=${regenCount}`);
  }

  const afterHash = sha256File(realDbPath);
  if (beforeHash !== afterHash) {
    throw new Error(
      `data/girlchess.db changed during this run (sha256 before=${beforeHash} after=${afterHash}) -- isolation was violated. Investigate immediately; do not trust this run's results.`
    );
  }
  console.log(`[coach-eval] real db unchanged (sha256 ${afterHash.slice(0, 12)}...)`);
  console.log(`[coach-eval] done: wrote ${results.length} rows to ${rawPath}`);
}

main().catch((err) => {
  console.error("[coach-eval] FAILED:", err);
  process.exitCode = 1;
});
