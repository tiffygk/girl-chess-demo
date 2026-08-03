// tools/coach-eval/run.ts
//
// CLI entry point: executes ONE model over all fixtures/questions across all
// three arms (board-live, general, board-review -- Wave E1, coach-truth-
// speed round), writing raw json incrementally. Invoke via:
//
//   npx tsx tools/coach-eval/run.ts --model sonnet --wiring legacy
//   npx tsx tools/coach-eval/run.ts --model opus   --wiring legacy --out tools/coach-eval/runs/<ts>
//
// Flags:
//   --model sonnet|opus       required
//   --wiring legacy|threaded  required
//   --out <dir>               output dir (default: runs/<timestamp>)
//   --arm <name>              board-live|general|board-review|fork|mate|
//                             long|general-theory|numbers -- run only that
//                             arm's questions, without disturbing the
//                             others. Applied AFTER buildQuestionList()'s
//                             own drift assertion against the full,
//                             unfiltered TOTAL_QUESTION_COUNT.
//                             general-theory (round-3 fact-shelf coach
//                             round) is the isolated 10-question
//                             pure-chess-theory subset; e.g. `--arm
//                             general-theory` runs exactly those 10.
//                             numbers (coach-eval instrument improvements,
//                             2026-08-03) is the isolated 3-question
//                             numbers-asking subset, each pinned to a
//                             position with a known persisted eval_cp (see
//                             fixtures.ts's NUMBER_EVAL_FACTS).
//   --limit N                 smoke-test only: run the first N questions
//                             (of whatever --arm selected, or all arms)
//   --warmup N                N throwaway calls through the identical chat()
//                             path before the scored loop, to burn off
//                             in-process cold start. Logged to
//                             warmup-<model>[-rep<K>].json, printed DISCARDED,
//                             NEVER merged into raw. Default 0.
//   --rep K                   rep index for a multi-rep run. When present the
//                             raw file becomes raw-<model>-rep<K>.json (absent
//                             = the unchanged raw-<model>.json).
//
// ABBA convention (cold-start counterbalancing at the orchestration level):
// run the two models back-to-back per rep with the order flipped each block
// -- rep 1 = sonnet->opus, rep 2 = opus->sonnet, rep 3 = sonnet->opus -- so
// time-of-night drift lands on both models rather than systematically on one.
// Combined with --warmup, this removes the cold-start confound (see the v3
// plan's design decision D1).
//
// See README.md for the full baseline/post-fix invocation pair and the
// isolation rules this file enforces. This file NEVER opens
// data/girlchess.db -- it only ever copies it to a scratch path this tool
// owns, then calls openDb() on the copy.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import { openDb, getGame, getGameMoves, getTurningPoints } from "../../server/store/db";
// The product's own finished-game outcome derivation -- imported, never
// reimplemented (see reviewFacts below).
import { deriveChatOutcome } from "../../server/game/manager";

// Shape of a turning_points row as getTurningPoints returns it; mirrors the
// cast manager.ts's chatAbout does on the same query.
interface TurningPointRow {
  ply: number;
  san: string;
  label: string;
  punish_san: string | null;
}
import type { ChatContext, ChatPerPlyInput, ChatOutcome } from "../../server/coach/chat";
// Wave E1: CHAT_TIMEOUT_MS/CHAT_REVIEW_BUDGET_MS are the SAME constants
// manager.ts's own budgetMs = finished ? CHAT_REVIEW_BUDGET_MS :
// CHAT_TIMEOUT_MS derivation uses -- imported, never a second hardcoded
// copy. Static import is safe here (chat.ts does not import agent-sdk.ts,
// which is the one module whose module-load-time constant genuinely needs
// GC_COACH_MODEL set first -- see the dynamic import further down).
import { CHAT_TIMEOUT_MS, CHAT_REVIEW_BUDGET_MS } from "../../server/coach/chat";
// classifyIntent is the deterministic board/general router (Wave D). Every
// question in this harness -- board-live included -- is routed through the
// SAME function manager.ts calls on every real message, so the harness
// measures the production routing decision, not an assumed one.
import { classifyIntent } from "../../server/coach/intent";
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
  NUMBER_QUESTIONS,
  FORK_FIXTURE_IDS,
  MATE_FIXTURE_IDS,
  LONG_FIXTURE_IDS,
  ENGINE_BEST_UCI_BY_FIXTURE,
  NARR_HINT_LEVEL,
  NARR_HINT_TEXT,
  TOTAL_QUESTION_COUNT,
  type Fixture,
  type FixtureId,
  type QuestionTag,
  type PendingMove,
  type PendingTier,
  type Arm,
} from "./fixtures";
import type { AnswerRow } from "./score";
import { parseArgs, sha256File, timestamp } from "./util";
import type { CoachUsage } from "../../server/coach/backends/types";
import { classifyDifficulty, shelfCovered } from "./difficulty";

// Review fix F1 (Opus review of ab814d4..1c31dab, 2026-08-02): the exact
// shape of chat()'s exported function, via an `import type` query rather
// than retyping every param by hand -- so callChatWithTiming below can't
// silently drift from the real signature the way a hand-copied type could.
type ChatFn = typeof import("../../server/coach/chat").chat;

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "../..");

type Model = "sonnet" | "opus";
type Wiring = "legacy" | "threaded";

// Wave E1 fix: opus resolved to the stale "claude-opus-4-8" (Opus 4.8, the
// PREVIOUS Opus) since v3 -- the owner's ask is explicitly Opus 5 ("since
// Opus 5 just came out and it is much better than the previous Opus 4.8").
// A bake-off against the wrong model is worthless; both strings are now the
// exact, current, un-suffixed model IDs (see claude-api skill / shared/
// models.md: claude-sonnet-5, claude-opus-5 -- no date suffix on either).
const MODEL_ENV: Record<Model, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
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
// run.ts's main loop actually iterates. Wave E1 adds `arm`, read by main()
// for the --arm filter, the intent/budget derivation, and written onto every
// AnswerRow so render.ts/decide.ts can aggregate per arm.
interface EvalQuestion {
  id: string;
  arm: Arm;
  tag: QuestionTag;
  q: string;
  ctx: FixtureId;
  probe: boolean;
  pending?: PendingMove;
  pendingTier?: PendingTier;
}

function buildQuestionList(): EvalQuestion[] {
  const base: EvalQuestion[] = BASE_QUESTIONS.map((b) => ({ id: b.id, arm: b.arm, tag: b.tag, q: b.q, ctx: b.ctx, probe: b.probe }));
  const pending: EvalQuestion[] = PENDING_QUESTIONS.map((p) => ({
    id: p.id,
    arm: p.arm,
    tag: p.tag,
    q: p.q,
    ctx: p.ctx,
    probe: false,
    pending: p.pending,
    pendingTier: p.tier,
  }));
  const affirmation: EvalQuestion[] = AFFIRMATION_QUESTIONS.map((p) => ({
    id: p.id,
    arm: p.arm,
    tag: p.tag,
    q: p.q,
    ctx: p.ctx,
    probe: false,
    pending: p.pending,
    pendingTier: p.tier,
  }));
  // Wave E1 arms: general has no fixture-derived focus/pending at all (bare
  // context, see buildContext below); board-review reuses [dir]'s bare-
  // context shape too, just against a synthesized finished-game status.
  const general: EvalQuestion[] = GENERAL_QUESTIONS.map((g) => ({ id: g.id, arm: g.arm, tag: g.tag, q: g.q, ctx: g.ctx, probe: g.probe }));
  const boardReview: EvalQuestion[] = BOARD_REVIEW_QUESTIONS.map((r) => ({
    id: r.id,
    arm: r.arm,
    tag: r.tag,
    q: r.q,
    ctx: r.ctx,
    probe: r.probe,
  }));
  // RCA acceptance-evals round: fork (suite FH)/mate (suite NM)/long (suite
  // CE latency cells) -- same bare-context shape as [dir], graded as LIVE
  // mid-game questions (buildContext's fallthrough branch) even though the
  // underlying game has since finished; see fixtures.ts's midGameOfFinished
  // comment for why that's a deliberate, separate assertion from board-review.
  const fork: EvalQuestion[] = FORK_QUESTIONS.map((f) => ({ id: f.id, arm: f.arm, tag: f.tag, q: f.q, ctx: f.ctx, probe: f.probe }));
  const mate: EvalQuestion[] = MATE_QUESTIONS.map((m) => ({ id: m.id, arm: m.arm, tag: m.tag, q: m.q, ctx: m.ctx, probe: m.probe }));
  const long: EvalQuestion[] = LONG_QUESTIONS.map((l) => ({ id: l.id, arm: l.arm, tag: l.tag, q: l.q, ctx: l.ctx, probe: l.probe }));
  // Round-3 fact-shelf coach round: the isolated 10-question general-theory
  // arm -- same bare-context shape as "general" (buildContext's fallthrough
  // branch), just its own arm so it can be selected alone via --arm.
  const generalTheory: EvalQuestion[] = GENERAL_THEORY_QUESTIONS.map((g) => ({
    id: g.id,
    arm: g.arm,
    tag: g.tag,
    q: g.q,
    ctx: g.ctx,
    probe: g.probe,
  }));
  // coach-eval instrument improvements (2026-08-03): the isolated 3-question
  // numbers-asking arm -- same bare-context "dir" shape as fork/mate/long
  // (buildContext's fallthrough branch), just its own arm so it can be
  // selected alone via --arm numbers.
  const numbers: EvalQuestion[] = NUMBER_QUESTIONS.map((n) => ({
    id: n.id,
    arm: n.arm,
    tag: n.tag,
    q: n.q,
    ctx: n.ctx,
    probe: n.probe,
  }));
  const all = [...base, ...pending, ...affirmation, ...general, ...boardReview, ...fork, ...mate, ...long, ...generalTheory, ...numbers];
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
        // Wave 2 (item 6): identity is {branch, press} now. The coach-eval
        // harness only exercises text/bestSan/pvSans (the server never reads
        // the identity), so a full-reveal rung on the right branch stands in
        // for the old numeric level here.
        branch: "right",
        press: NARR_HINT_LEVEL,
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
        // ChatContext.pendingMove.tier is "silent" | "nudge" | "warning" --
        // narrower than this harness's own PendingTier, which also carries
        // "judge-in-flight" (no settled tier exists yet while judging is
        // in flight, same case the judged:false line below already special-
        // cases).
        tier: question.pendingTier === "judge-in-flight" ? undefined : question.pendingTier,
        judged: question.pendingTier === "judge-in-flight" ? false : true,
      };
    }
    return threaded;
  }

  // open / dir / general: bare context, no focus. board-review reuses this
  // same bare shape (its [dir]-sourced question text carries no focus
  // either) but reports mode "review" -- purely informational (chat.ts
  // never branches on ctx.mode; manager.ts derives status/budget from the
  // db's own finished state, which is why the REAL "finished" signal is
  // threaded through assembleChatFactList's outcomeInfo param below, not
  // through this field) -- kept truthful anyway so nothing in the context
  // object itself lies about which kind of question this is.
  return { mode: question.arm === "board-review" ? "review" : "live" };
}

// The board-review arm's finished-game facts, read from the db (eval-
// instrument-repair round, 2026-07-28). This REPLACES `boardReviewOutcome`,
// which synthesized the same fabricated `1-0 by resignation` for every row
// regardless of fixture, against games that were still in progress at the
// pinned ply. The coach then correctly discussed a resignation that never
// happened, and the owner -- grading the blinded read -- threw the whole arm
// out as unjudgeable.
//
// deriveChatOutcome is IMPORTED from server/game/manager.ts, not reimplemented
// here: the arm's whole point is to exercise the same finished-game path the
// app takes, so it must read games.result/end_reason exactly the way chatAbout
// does, including the "decisive result, null end_reason, last san has no #"
// resignation disambiguation. Same for turningPoints, which manager.ts passes
// only for a finished game -- omitting them here (as this file used to) meant
// the arm's fact list was missing something every real review chat carries.
function reviewFacts(fixture: Fixture, sans: { ply: number; san: string }[]): { status: "finished"; outcome?: ChatOutcome } {
  const game = getGame(fixture.gameId) as { result: string | null; end_reason?: string | null } | undefined;
  if (!game) throw new Error(`review fixture ${fixture.id} references game ${fixture.gameId}, which is not in the scratch db`);
  if (!game.result) {
    throw new Error(
      `review fixture ${fixture.id} points at game ${fixture.gameId}, which has NO result in the db -- the board-review arm ` +
        `must only ever run against genuinely finished games (this is the exact defect the 2026-07-28 rebuild removed). Aborting.`
    );
  }
  return {
    status: "finished",
    outcome: deriveChatOutcome(game.result, game.end_reason ?? null, sans[sans.length - 1]?.san, sans.length),
  };
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

// Review fix F1 (Opus review of ab814d4..1c31dab, 2026-08-02): the Task 1e
// instrument shipped only wiring onDelta -- ttfpMs was set to `ttfwMs`
// unconditionally, which was correct BEFORE Task 1c landed onAttemptStart/
// onValidateStart (65fb9fe predates 151e7fb) but was never updated once
// those hooks existed, silently leaving TTFP unmeasured through the exact
// instrument the plan's Measurement Matrix depends on to prove 1c's win
// ("TTFP p90 < 1s"). Wires onAttemptStart -> ttfpMs (the first status/
// progress signal, a real pipeline event) alongside the existing onDelta ->
// ttfwMs (the first validated word) -- both timestamped from the SAME
// ttfStart, both first-fire-only, exactly mirroring the ttfwMs pattern
// already proven correct. Extracted into its own function (rather than
// inlined in main()'s loop, where it lived before) so the timing wiring
// itself is directly unit-testable against a fake backend, independent of
// this file's db/fixture plumbing -- see run.test.ts.
export async function callChatWithTiming(
  chatFn: ChatFn,
  question: Parameters<ChatFn>[0],
  history: Parameters<ChatFn>[1],
  facts: Parameters<ChatFn>[2],
  backend: Parameters<ChatFn>[3],
  trace: Parameters<ChatFn>[4],
  baseOpts: NonNullable<Parameters<ChatFn>[5]>
): Promise<{
  outcome: { text: string; source: string; cause?: string; traceId?: number };
  ttfpMs: number | null;
  ttfwMs: number | null;
  usage: CoachUsage[];
}> {
  const ttfStart = performance.now();
  let ttfpMs: number | null = null;
  let ttfwMs: number | null = null;
  const onAttemptStart = () => {
    if (ttfpMs === null) ttfpMs = performance.now() - ttfStart;
  };
  const onDelta = () => {
    if (ttfwMs === null) ttfwMs = performance.now() - ttfStart;
  };
  // OD-3b (post-shelf eval instrumentation, 2026-08-02): one entry per
  // backend call chat() makes for this question, in attempt order -- so a
  // regen (2 attempts) leaves 2 entries and the real billed spend of BOTH
  // attempts stays visible, never just the one that produced the final
  // answer. Matches chat.usage.test.ts's own "fires once per attempt"
  // contract exactly; this array is that contract's raw log.
  const usage: CoachUsage[] = [];
  const onUsage = (u: CoachUsage) => {
    usage.push(u);
  };
  let outcome: { text: string; source: string; cause?: string; traceId?: number };
  try {
    outcome = await chatFn(question, history, facts, backend, trace, { ...baseOpts, onAttemptStart, onDelta, onUsage });
  } catch (err) {
    outcome = { text: "", source: "error", cause: err instanceof Error ? err.message : String(err) };
  }
  return { outcome, ttfpMs, ttfwMs, usage };
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
  const rep = args.rep ? Number.parseInt(args.rep, 10) : undefined;
  const repSuffix = rep ? `-rep${rep}` : "";
  const warmup = args.warmup ? Number.parseInt(args.warmup, 10) : 0;
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
    // Review fixtures (2026-07-28): fail fast, at startup, if the game this
    // fixture claims is finished is not actually finished in the db, or if
    // the pinned ply is not its real final ply. The whole rebuild of this arm
    // exists because a fabricated outcome was allowed to stand in for a real
    // one; the guard against that regressing lives here, against live data,
    // not only in a unit test against the fixture literals.
    if (fixture.finished) {
      const game = getGame(fixture.gameId) as { result: string | null } | undefined;
      if (!game?.result) {
        throw new Error(`review fixture ${fixture.id} claims game ${fixture.gameId} is finished, but the db has no result for it`);
      }
      if (rows.length !== fixture.ply) {
        throw new Error(
          `review fixture ${fixture.id} pins ply ${fixture.ply}, but game ${fixture.gameId} has ${rows.length} plies -- ` +
            `a review fixture must sit on the game's real FINAL ply`
        );
      }
    }
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

  // ---- fork-*/mate-*/long-* startup assertion (spec section 3: "New fixture
  // class with its own startup assertion (game finished, pinned ply real) --
  // do NOT weaken run.ts's existing review-arm final-ply assertion"). The
  // generic replay loop above already proves "pinned ply real" (the fen
  // wouldn't match otherwise); this proves the OTHER half -- the referenced
  // game genuinely has a result in the db -- without ever checking
  // rows.length === fixture.ply (these are mid-game plies on purpose).
  const midGameFixtureIds: FixtureId[] = [...FORK_FIXTURE_IDS, ...MATE_FIXTURE_IDS, ...LONG_FIXTURE_IDS];
  for (const id of midGameFixtureIds) {
    const fixture = FIXTURES[id];
    if (!fixture.midGameOfFinished) {
      throw new Error(`fixture ${id} is listed in a fork/mate/long id array but is missing midGameOfFinished:true`);
    }
    const game = getGame(fixture.gameId) as { result: string | null } | undefined;
    if (!game?.result) {
      throw new Error(
        `fork/mate/long fixture ${id} claims game ${fixture.gameId} is finished, but the db has no result for it -- ` +
          "this fixture class must only ever pin a ply inside a genuinely finished game"
      );
    }
  }
  console.log(`[coach-eval] all ${midGameFixtureIds.length} fork/mate/long fixtures confirmed to reference finished games`);

  // buildQuestionList()'s own drift assertion runs against the FULL,
  // unfiltered TOTAL_QUESTION_COUNT -- --arm filters AFTER that check, so a
  // single-arm re-run can never silently hide a fixture-count drift in one
  // of the other arms.
  const allQuestionsUnfiltered = buildQuestionList();

  // Wave E1: --arm <name> re-runs a single arm without disturbing the
  // others (a fresh --out dir per arm re-run is still the caller's job --
  // render.ts requires an identical row-id list across the sonnet/opus raw
  // files it discovers in one directory, so mixing a filtered and an
  // unfiltered run in the same --out would fail that check, correctly).
  const armFilter = args.arm as Arm | undefined;
  const VALID_ARMS: Arm[] = ["board-live", "general", "board-review", "fork", "mate", "long", "general-theory"];
  if (armFilter && !VALID_ARMS.includes(armFilter)) {
    throw new Error(`--arm must be one of ${VALID_ARMS.join("|")} (got ${JSON.stringify(args.arm)})`);
  }
  const allQuestions = armFilter ? allQuestionsUnfiltered.filter((q) => q.arm === armFilter) : allQuestionsUnfiltered;
  if (armFilter) console.log(`[coach-eval] --arm ${armFilter}: running ${allQuestions.length}/${allQuestionsUnfiltered.length} questions (this arm only)`);

  // --limit N: run only the first N questions. For cheap wiring smoke
  // tests only -- a real baseline/post-fix run must always cover all
  // questions in scope (all arms, or the single --arm-filtered arm) or it
  // is not comparable against the other model's run.
  const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
  const questions = limit && limit > 0 ? allQuestions.slice(0, limit) : allQuestions;
  if (limit) console.log(`[coach-eval] --limit ${limit}: running ${questions.length}/${allQuestions.length} questions (smoke-test mode, not a full run)`);
  fs.mkdirSync(outDir, { recursive: true });

  // ---- warmup pre-pass (cold-start control, design decision D1a) ---------
  // N throwaway calls through the identical chat() path, logged separately
  // and NEVER merged into the scored raw file. Removes in-process cold start
  // directly; the discarded rows still land in the scratch db's
  // advice_traces (scratch only -- harmless).
  if (warmup > 0) {
    const warmupPath = path.join(outDir, `warmup-${model}${repSuffix}.json`);
    const wq = allQuestions[0];
    const wFixture = FIXTURES[wq.ctx];
    const wRows = rowsByGame.get(wFixture.gameId)!;
    const wMoves = truncatedMoves(wRows, wFixture.ply);
    const wPerPly = buildPerPlyAnalysis(wRows, wFixture.ply);
    const wCtx = buildContext(wq, undefined, wiring);
    const warmupLog: { i: number; source: string; latencyMs: number }[] = [];
    for (let i = 1; i <= warmup; i++) {
      const facts = assembleChatFactList(wMoves, wCtx, undefined, wPerPly);
      const start = Date.now();
      let source = "model";
      try {
        source = (await chat(wq.q, [], facts, agentSdkBackend, { gameId: wFixture.gameId, ply: wFixture.ply, kind: "chat" })).source;
      } catch {
        source = "error";
      }
      warmupLog.push({ i, source, latencyMs: Date.now() - start });
      fs.writeFileSync(warmupPath, JSON.stringify(warmupLog, null, 2));
      console.log(`[coach-eval] warmup ${i}/${warmup} -> ${source} ${warmupLog[i - 1].latencyMs}ms (DISCARDED, not scored)`);
    }
  }

  const rawPath = path.join(outDir, `raw-${model}${repSuffix}.json`);
  const results: (AnswerRow & { model: Model; wiring: Wiring; measuredLatencyMs: number })[] = [];

  for (const question of questions) {
    const fixture = FIXTURES[question.ctx];
    const rows = rowsByGame.get(fixture.gameId)!;
    const gameMoves = truncatedMoves(rows, fixture.ply);
    const perPly = buildPerPlyAnalysis(rows, fixture.ply);
    const engineBest = ENGINE_BEST_UCI_BY_FIXTURE[fixture.id] ? engineBestForFixture(rows, fixture) : undefined;
    const ctx = buildContext(question, engineBest, wiring);

    // board-review is the only arm whose fixture is a finished game, and the
    // status/outcome/turningPoints facts now all come from the db, mirroring
    // manager.ts's chatAbout exactly (finished ? real facts : undefined).
    const finished = question.arm === "board-review";
    const outcomeInfo = finished ? reviewFacts(fixture, gameMoves) : undefined;
    const turningPoints = finished
      ? getTurningPoints(fixture.gameId).map((r: TurningPointRow) => ({
          ply: r.ply,
          san: r.san,
          label: r.label,
          punishSan: r.punish_san ?? undefined,
        }))
      : undefined;
    const facts = assembleChatFactList(gameMoves, ctx, turningPoints, perPly, outcomeInfo);
    const trace = { gameId: fixture.gameId, ply: fixture.ply, kind: "chat" };

    // Wave E1 (Wave F: ctx shape updated to match classifyIntent's new
    // signature): the SAME decisions manager.ts makes on every real message
    // -- hasFocus is true only when a hintFocus/turningPointFocus is
    // attached (only the "narr" tag ever sets one in this harness), and
    // hasPendingMove reads the SAME `ctx.pendingMove` field manager.ts reads
    // off body.context (not question.pending directly), so it correctly
    // stays false under "legacy" wiring, which never sets that field, and
    // true under "threaded" wiring whenever a pending move exists --
    // mirroring the real client/server contract instead of a second,
    // independent guess. budgetMs/status are the SAME db-derived
    // finished/live split manager.ts uses, never a client claim. Passing
    // these through chat()'s opts is what actually exercises the general
    // route's prompt/validator and the review budget -- omitting them (as
    // this file did before Wave E1) silently always measured the live
    // "board" path, regardless of arm.
    const hasFocus = question.tag === "narr";
    const hasPendingMove = !!ctx.pendingMove;
    const status: "in-progress" | "finished" = finished ? "finished" : "in-progress";
    const intent = classifyIntent(question.q, { hasFocus, hasPendingMove, status });
    const budgetMs = finished ? CHAT_REVIEW_BUDGET_MS : CHAT_TIMEOUT_MS;

    // OD-3b (post-shelf eval instrumentation, 2026-08-02): the shelf-
    // coverage/difficulty signal, read straight off the SAME pinned-ply
    // MoveRow engineBestForFixture already reads above -- best_move/pv
    // non-null means the engine has a concrete line for this position,
    // eval_mate non-null means it has a forced mate. `question.pending`
    // (not `ctx.pendingMove`, which is wiring-dependent -- see buildContext
    // above) is the same field score.ts's checkPendingAwareness and this
    // row's own `pending:` field below both key off, so "does this row
    // carry a pending move" means the same thing everywhere in this file.
    const pinnedRow = rows.find((r) => r.ply === fixture.ply);
    const shelfSignal = {
      hasBestLine: !!(pinnedRow?.best_move || pinnedRow?.pv),
      hasMate: pinnedRow?.eval_mate != null,
      hasPendingMove: !!question.pending,
      // OD-3b instrument repair (2026-08-03): the "general"/"general-theory"
      // arms pin `ctx` only so assembleChatFactList has a game to build a
      // context from -- the question itself doesn't concern that position
      // (see difficulty.ts's POSITION_AGNOSTIC_ARMS and its own comment for
      // why this field is what un-degenerates shelfCovered).
      arm: question.arm,
    };
    const difficulty = classifyDifficulty(shelfSignal);
    const isShelfCovered = shelfCovered(shelfSignal);

    const start = Date.now();
    // Task 1e (coach-truth-speed latency round, 2026-08-02) + review fix F1
    // (2026-08-02): callChatWithTiming wires ttfpMs to the first
    // onAttemptStart fire (the first real status/progress signal) and
    // ttfwMs to the first onDelta fire (the first validated word), both
    // timestamped with performance.now() (sub-ms, monotonic) from the same
    // start -- see its own doc comment above for the full rationale.
    const { outcome, ttfpMs, ttfwMs, usage } = await callChatWithTiming(
      chat,
      question.q,
      [],
      facts,
      agentSdkBackend,
      trace,
      { budgetMs, intent }
    );
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
      arm: question.arm,
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
      fixtureFen: fixture.fen,
      model,
      wiring,
      measuredLatencyMs,
      ttfpMs,
      ttfwMs,
      usage,
      difficulty,
      shelfCovered: isShelfCovered,
    };
    results.push(row);
    // Write incrementally -- a mid-run crash loses nothing (v1 lost the
    // whole run to a single crash; this rewrites the full array to disk
    // after every answer, which at 65 rows is cheap).
    fs.writeFileSync(rawPath, JSON.stringify(results, null, 2));
    const usageSummary =
      usage.length > 0
        ? `usage=${usage.map((u) => `in:${u.inputTokens}/out:${u.outputTokens}/think:${u.thinkingTokens ?? "n/a"}`).join(",")}`
        : "usage=none";
    console.log(
      `[coach-eval] [${results.length}/${questions.length}] ${question.id} [${question.arm}/${intent}] (${fixture.id}) -> ${outcome.source} ${latencyMs}ms regen=${regenCount} ttfw=${ttfwMs !== null ? Math.round(ttfwMs) + "ms" : "n/a"} difficulty=${difficulty} shelfCovered=${isShelfCovered} ${usageSummary}`
    );
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

// Review fix F1 (Opus review of ab814d4..1c31dab, 2026-08-02): guard main()
// behind an isMain check -- run.test.ts needs to import callChatWithTiming
// above without the CLI's own main() (which parses process.argv and copies
// the real db) executing as a side effect of that import. Same pattern
// tools/playtest-serve.ts and tools/db-backup.ts already use; `npx tsx
// tools/coach-eval/run.ts ...` still runs exactly as before (process.argv[1]
// resolves to this file's own path in that invocation).
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("[coach-eval] FAILED:", err);
    process.exitCode = 1;
  });
}
