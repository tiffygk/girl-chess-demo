// tools/coach-backfill.ts
//
// Regenerates a real answer for a coach trace that fell back to a template
// ONLY because the backend was actually down at the time -- owner decision
// (2026-08-26, coach-truth-continuation round): "backfill fires from a
// command she runs, not automatically. No surprise model calls," and
// "backfill covers chat replies as well as narration/nudges."
//
// advice_traces is insert-only for content today, and chat_messages.trace_id
// points at a specific row id -- inserting a fresh row for a regenerated
// answer would orphan that pointer and duplicate her conversation. This tool
// UPDATES the failed row in place (updateAdviceTraceOutput, server/store/
// db.ts) and stamps backfilled_at, so the history stays honest: created_at
// still says when she actually asked, backfilled_at says when the answer was
// filled in later.
//
// ---- the selection predicate (verified against her real history, not just
// the plan that first described it) --------------------------------------
//
// The plan this tool was built from said: "a row is backfillable when
// source = 'template' AND (cause = 'backend-down' OR output LIKE '[backend
// error]%')". Taken literally against her real db that selects ~70 rows,
// not five -- every claude-cli/agent-sdk TIMEOUT ("...timed out after
// 15000ms") and every deliberate templates-only voice pick (noBackend's
// unconditional "no coach backend available" throw, backend = 'none') also
// starts with "[backend error]", and `cause` is NULL on every historical row
// (the column did not exist in her real db file until this very migration
// runs against it -- confirmed by querying it directly, 2026-08-27). Two
// more conditions, both verified against her real rows 267-271 (the only
// five that should ever come back from a real-history dry run) and nothing
// else across her full ~190-game corpus:
//   - `backend != 'none'`: noBackend.generate() throws synchronously and
//     unconditionally, by design (types.ts) -- every row it produces reads
//     as "[backend error] no coach backend available" regardless of whether
//     the cause was a genuine outage or a deliberate "templates only" voice
//     pick (server/game/manager.ts's pickCoachBackend: pref "template" goes
//     straight to noBackend, no probe). A real backend name in this column
//     means claude-cli/ollama/agent-sdk was actually invoked and actually
//     threw -- that is the only shape a genuine outage can take.
//   - `output NOT LIKE '%timed out%'`: a timeout means the backend was
//     reachable but slow, not down (see isTimeoutError, server/coach/
//     index.ts) -- narrate()/chat() already treat these as a different
//     cause ("timeout", never "backend-down") and never report the backend
//     unhealthy for one. Backfilling a timeout is a different, weaker claim
//     ("this would have been faster") than backfilling an outage ("this
//     never got an answer at all"), and out of scope for this tool.
// `cause = 'backend-down'` is kept as an OR arm (not simplified to a
// cause-only check) because narrate() records no cause at all -- two of her
// five real outage rows (267, 268) are nudges, so cause is NULL on every one
// of the five rows this tool must actually select today. The column only
// starts getting populated once this round's Task 7 code runs against the
// live db; the OR arm is what makes this tool correct on day one AND correct
// a year from now, without a rewrite.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import {
  openDb,
  getGame,
  getGameMoves,
  getTurningPoints,
  insertTurningPoints,
  getAllChatMessages,
  getAllAdviceTraces,
  getAdviceTraceById,
  updateAdviceTraceOutput,
  deleteAdviceTraceById,
} from "../server/store/db";
import { narrate, type CoachFactList } from "../server/coach/index";
import { chat, assembleChatFactList, type ChatContext, type ChatFactList, type ChatPerPlyInput } from "../server/coach/chat";
import { deriveChatOutcome } from "../server/game/manager";
import { computeTurningPoints, TP_ALGO_VERSION, type MoveEval } from "../server/annotator/turningPoints";
import type { CoachBackend } from "../server/coach/backends/types";
import { agentSdkBackend } from "../server/coach/backends/agent-sdk";
import { resolveRealDbPath, copyScratchDb } from "./truth-check";
import { backupLiveDb } from "./db-backup";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".coach-backfill-scratch", "girlchess.db");

const BACKEND_ERROR_PREFIX = "[backend error]";

export interface FailedTrace {
  id: number;
  gameId: number;
  ply: number;
  kind: string;
  factsJson: string;
  output: string;
  source: string;
  backend: string;
  cause: string | null;
  createdAt: string;
}

function toFailedTrace(row: any): FailedTrace {
  return {
    id: row.id,
    gameId: row.game_id,
    ply: row.ply,
    kind: row.kind,
    factsJson: row.facts_json,
    output: row.output,
    source: row.source,
    backend: row.backend,
    cause: row.cause ?? null,
    createdAt: row.created_at,
  };
}

// See this file's header comment for the full derivation of every clause
// here -- each one is load-bearing and was falsified against her real
// history, not just transcribed from a plan.
export function findFailedTraces(gameId?: number): FailedTrace[] {
  return getAllAdviceTraces()
    .filter(
      (r: any) =>
        r.source === "template" &&
        r.backend !== "none" &&
        typeof r.output === "string" &&
        r.output.startsWith(BACKEND_ERROR_PREFIX) &&
        !r.output.includes("timed out") &&
        (r.cause == null || r.cause === "backend-down") &&
        (gameId == null || r.game_id === gameId)
    )
    .map(toFailedTrace);
}

// ---- narrate-kind regeneration (nudge/warning/narrate) --------------------
// facts_json is the exact CoachFactList narrate() was called with -- no
// rebuild needed, just replay it through the same function.

async function backfillNarrateTrace(row: FailedTrace, backend: CoachBackend): Promise<"regenerated" | "failed"> {
  let facts: CoachFactList;
  try {
    facts = JSON.parse(row.factsJson);
  } catch {
    return "failed"; // corrupt facts_json -- nothing safe to regenerate from
  }
  const result = await narrate(facts, backend, { gameId: row.gameId, ply: row.ply, kind: row.kind });
  return mergeRegeneration(row, result.traceId, result.source);
}

// ---- chat-kind regeneration ------------------------------------------------
// The plan this tool was built from said to recover the question via
// chat_messages.trace_id -- verified false against the actual code: a
// template (failed) reply is NEVER persisted to chat_messages (server/game/
// manager.ts, "B3b ... a failed (template) reply is no longer persisted into
// chat_messages"), so trace_id never points back to a row this tool needs to
// backfill in the first place. The USER's question IS always persisted,
// unconditionally, before the call that produced this row -- so the correct
// join is temporal: the last role='user' message in this game with
// created_at at or before this trace's own created_at. Verified against her
// real rows 269/270 (same game, same ply, 19 seconds apart, two separate
// questions) and 271: each resolves to a distinct, correct question.

// F4 fix (fix wave, 2026-08-27, review finding LOW-1): created_at is
// second-resolution, and a synchronous backend-down throw lands its trace
// row ~1s after the question that caused it (measured on her real data:
// msg 236 at 20:12:03 -> trace 269 at 20:12:04) -- but an IMMEDIATE re-ask
// can land in that SAME rounded second as the trace itself, and the old
// code (sort everything <= the trace's own timestamp, ties broken by
// ascending id, take the last) would then return the re-ask instead of the
// question that actually failed. A candidate strictly BEFORE the trace's
// own second is unambiguous and always correct to prefer over one that ties
// it; only when EVERY candidate ties the trace's own second (no earlier
// question exists at all) do we fall back to the earliest of those tied
// rows -- the one already in flight when the call that produced this trace
// started, not a later one asked into the same second after the failure.
export function findPrecedingQuestion(gameId: number, tsAtOrBefore: string): string | undefined {
  const messages = getAllChatMessages(gameId) as { role: string; text: string; created_at: string; id: number }[];
  const candidates = messages.filter((m) => m.role === "user" && m.created_at <= tsAtOrBefore);
  if (candidates.length === 0) return undefined;
  const strictlyBefore = candidates.filter((m) => m.created_at < tsAtOrBefore);
  if (strictlyBefore.length > 0) {
    strictlyBefore.sort((a, b) => (a.created_at === b.created_at ? a.id - b.id : a.created_at < b.created_at ? -1 : 1));
    return strictlyBefore[strictlyBefore.length - 1].text;
  }
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0].text;
}

interface MoveRow {
  ply: number;
  san: string;
  best_move: string | null;
  pv: string | null;
  eval_cp: number | null;
  eval_mate: number | null;
  // Wave B4 (2026-09-01 attribution round): the recorded party, read
  // straight off getGameMoves' `SELECT *` (moves.side). Nullable for a
  // pre-backfill row -- there should be none on her real db, only a fresh
  // dev database.
  side: "her" | "mallow" | null;
}

// F2 fix (fix wave, 2026-08-27, review finding HIGH-2): this used to mirror
// tools/coach-eval/run.ts's pvLine/truncatedMoves/buildPerPlyAnalysis
// exactly -- but run.ts carries the same fenAfter/own-eval off-by-one this
// file's buildPerPlyAnalysis used to have, and run.ts only feeds an eval
// harness while this tool writes to her real history, so pvLine and
// buildPerPlyAnalysis below were corrected to mirror manager.ts's chat()
// path (:1265-1301) instead -- see buildPerPlyAnalysis's own comment for
// the mapping. run.ts is unchanged; out of scope for this wave.
// truncatedMoves alone still mirrors run.ts's (trivial, no offset logic)
// and is reproduced here (module-private there, not exported) rather than
// imported.
function pvLine(
  fenBefore: string,
  ev: { bestMove: string | null; pv: string | null } | undefined
): { pvSans: string[]; bestSan?: string } {
  if (!ev) return { pvSans: [] };
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
  return rows.filter((r) => r.ply <= ply).map((r) => ({ ply: r.ply, san: r.san }));
}

// A ply's OWN best_move/pv is the eval of the position AFTER that ply
// (attachEval(ply) persists fenAfter(ply)'s eval -- see manager.ts:1265-1281's
// own documentation of this exact off-by-one, fixed there 2026-07-28), so it
// names the best move for whoever moves NEXT, not an alternative to the move
// just played. Mirrors manager.ts's chat()-path perPlyAnalysis loop
// (:1282-1301) exactly: replay from fenBefore, attach the PRIOR row's eval
// to the CURRENT ply, then carry this row's own eval forward as the prior
// for the next iteration. Ply 1 has no prior row, so pvLine(fenBefore,
// undefined) returns an honest empty line rather than a guess.
function buildPerPlyAnalysis(rows: MoveRow[], ply: number): ChatPerPlyInput[] {
  const truncated = rows.filter((r) => r.ply <= ply);
  const replay = new Chess();
  let priorEval: { bestMove: string | null; pv: string | null } | undefined;
  return truncated.map((r) => {
    const fenBefore = replay.fen();
    const mv = replay.move(r.san);
    const { pvSans, bestSan } = pvLine(fenBefore, priorEval);
    priorEval = { bestMove: r.best_move ?? null, pv: r.pv ?? null };
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

// F5 fix (fix wave, 2026-08-27, review finding LOW-2): mirrors
// GameManager.getSummary's own self-heal (manager.ts:498-546) WITHOUT
// constructing a GameManager -- that class's `evaluator = new
// StockfishEvaluator()` field initializer spawns a real stockfish child
// process the instant it is instantiated, before init() is ever called and
// with no way to opt out (see tools/rca-eval/suites/fm.ts's own comment for
// the same discovery, made the hard way). getTurningPoints already returns
// only the highest-version row set stored for a game; the v8 (lead-change)
// heal only ever ran from getSummary's own call path, so a game not opened
// in the app since the bump would otherwise ground a backfilled answer on
// stale (pre-v8) points her own debrief no longer shows. Reproduces just
// the heal-check slice -- read, compare version, recompute + persist +
// re-read if behind -- with no engine call anywhere.
function healedTurningPoints(gameId: number): any[] {
  let persisted = getTurningPoints(gameId) as any[];
  const persistedVersion = persisted.length > 0 ? (persisted[0].algo_version ?? 1) : TP_ALGO_VERSION;
  if (persisted.length > 0 && persistedVersion < TP_ALGO_VERSION) {
    const rows = getGameMoves(gameId) as MoveRow[];
    // Wave B4 (2026-09-01 attribution round): `side` threaded through so
    // computeTurningPoints reads the recorded party rather than
    // recomputing it from ply % 2 -- same fix as manager.ts's own heal
    // paths. `?? undefined` lets a pre-backfill row fall through to
    // computeTurningPoints' own omission path rather than guessing here.
    const evalMoves: MoveEval[] = rows.map((r) => ({
      ply: r.ply,
      san: r.san,
      evalCp: r.eval_cp,
      evalMate: r.eval_mate,
      bestMove: r.best_move ?? null,
      side: r.side ?? undefined,
    }));
    const game = getGame(gameId) as { result: string | null } | undefined;
    const healed = computeTurningPoints(evalMoves, game?.result ?? "");
    insertTurningPoints(
      gameId,
      healed.map((t) => ({
        rank: t.rank, ply: t.ply, san: t.san, label: t.label,
        punishSan: t.punishSan ?? null, deltaP: t.deltaP, lowConfidence: t.lowConfidence, kind: t.kind,
        plyEnd: t.plyEnd ?? null, missedPunish: t.missedPunish ?? false,
        crossedAdvantage: t.crossedAdvantage ?? false,
        mateIn: t.mateIn ?? null, missedCount: t.missedCount ?? null,
        endKind: t.endKind ?? null, anchorKind: t.anchorKind ?? null,
        leader: t.leader ?? null, leadMarginCp: t.leadMarginCp ?? null, leadNth: t.leadNth ?? null,
      })),
      TP_ALGO_VERSION
    );
    persisted = getTurningPoints(gameId);
  }
  return persisted;
}

// Rebuilds a ChatFactList fresh from current db state (getGameMoves ->
// truncate to the row's ply -> buildPerPlyAnalysis -> getTurningPoints ->
// assembleChatFactList) rather than trusting the row's OWN facts_json, the
// way the narrate-kind path does above. Deliberate asymmetry: facts_json for
// a chat row was serialized under whatever ChatFactList shape existed at
// call time, potentially months of schema drift ago, and replaying it as-is
// into today's chat()/validateChat risks a shape mismatch this function
// avoids by rebuilding from the same primitives the live app assembles from
// right now.
//
// F1 fix (fix wave, 2026-08-27, review finding HIGH-1): `finished`/`outcome`
// must describe the game AS OF this trace's own created_at, not the game's
// state TODAY. Mirrors manager.ts:1248 (`const finished = game.result !=
// null`) -- but that runs LIVE, so reading game.result there IS reading it
// "as of now" for that call. This tool runs long after the fact, so the
// faithful reconstruction compares this trace's own created_at against
// game.ended_at (stamped once, by finishGame -- server/store/db.ts): a
// trace created before the game's own ended_at was necessarily generated
// while the game was still live, no matter how long finished the game is by
// the time this tool runs. Concrete case: game 188 traces 269/270, asked at
// ply 20 while created_at (20:12:04) is well before ended_at (20:24:19, the
// game ran to ply 47) -- the old code read only game.result != null (true
// today) and fabricated "you won by resignation on ply 20". With the fix,
// finishedAtAsk is false, so status is "in-progress", outcome is omitted
// entirely, and turningPoints is omitted entirely too (never the whole
// finished game's set, which would otherwise ground the answer on plies
// 41/47 she had not yet played) -- exactly what manager.ts's chat() would
// have assembled had it been called live at that moment.
export function rebuildChatFacts(row: FailedTrace): ChatFactList | undefined {
  const game = getGame(row.gameId) as { result: string | null; end_reason?: string | null; ended_at?: string | null } | undefined;
  if (!game) return undefined;
  const moveRows = getGameMoves(row.gameId) as MoveRow[];
  const truncated = truncatedMoves(moveRows, row.ply);
  const perPly = buildPerPlyAnalysis(moveRows, row.ply);
  const finishedAtAsk = game.result != null && game.ended_at != null && row.createdAt >= game.ended_at;
  const turningPoints = finishedAtAsk
    ? healedTurningPoints(row.gameId).map((r) => ({
        ply: r.ply,
        san: r.san,
        label: r.label,
        punishSan: r.punish_san ?? undefined,
      }))
    : undefined;
  const outcome = finishedAtAsk
    ? deriveChatOutcome(game.result as string, game.end_reason ?? null, truncated[truncated.length - 1]?.san, truncated.length)
    : undefined;
  const ctx: ChatContext = { mode: finishedAtAsk ? "review" : "live" };
  return assembleChatFactList(truncated, ctx, turningPoints, perPly, {
    status: finishedAtAsk ? "finished" : "in-progress",
    outcome,
  });
}

async function backfillChatTrace(row: FailedTrace, backend: CoachBackend): Promise<"regenerated" | "skipped" | "failed"> {
  const question = findPrecedingQuestion(row.gameId, row.createdAt);
  if (!question) return "skipped"; // no recoverable question -- never invent her words
  const facts = rebuildChatFacts(row);
  if (!facts) return "failed";
  // Pass an empty history (plan, Step 4): the surrounding conversation is
  // already in her transcript, and re-feeding it risks the model answering
  // a LATER turn instead of the one this row actually failed to answer.
  const result = await chat(question, [], facts, backend, { gameId: row.gameId, ply: row.ply, kind: "chat" });
  return mergeRegeneration(row, result.traceId, result.source);
}

// Shared merge step for both kinds. narrate()/chat() are unconditional-
// insert (F40/completeness gates) -- there is no way to ask either for a
// generated answer without it writing its own advice_traces row first. That
// transient row is read back (its `output`/`backend`/`validated` are exactly
// what a real, non-backfilled call would have persisted -- no need to trust
// narrate()'s/chat()'s differently-shaped return values, which sometimes
// carry a client-facing correction chat.ts's own row does not persist) and
// then deleted, so the net row count for the game never grows -- "insert-
// only for content, but backfill updates in place" holds for the row this
// tool cares about, and the tool never leaves a second, orphaned row behind
// to prove it tried.
function mergeRegeneration(row: FailedTrace, transientTraceId: number, source: "model" | "template"): "regenerated" | "failed" {
  const written = getAdviceTraceById(transientTraceId);
  deleteAdviceTraceById(transientTraceId);
  if (source !== "model" || !written) return "failed"; // regeneration failed again -- never overwrite a real answer with a worse one
  updateAdviceTraceOutput(row.id, {
    output: written.output,
    source: written.source,
    backend: written.backend,
    validated: !!written.validated,
    cause: null,
  });
  return "regenerated";
}

export async function backfillTrace(row: FailedTrace, backend: CoachBackend): Promise<"regenerated" | "skipped" | "failed"> {
  if (row.kind === "chat") return backfillChatTrace(row, backend);
  return backfillNarrateTrace(row, backend);
}

// ---- CLI surface ------------------------------------------------------

function parseArgs(argv: string[]): { confirm: boolean; gameId?: number } {
  const confirm = argv.includes("--confirm");
  const gameIdx = argv.indexOf("--game");
  const gameId = gameIdx >= 0 && argv[gameIdx + 1] ? Number.parseInt(argv[gameIdx + 1], 10) : undefined;
  return { confirm, gameId };
}

function assertResolvedTo(dbHandle: ReturnType<typeof openDb>, expectedPath: string): void {
  const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(expectedPath)) {
    throw new Error(
      `db isolation violated: openDb resolved to "${resolved}", expected "${expectedPath}". Aborting before any read/write.`
    );
  }
}

async function main() {
  const { confirm, gameId } = parseArgs(process.argv.slice(2));
  const dbResolution = resolveRealDbPath(REPO_ROOT);

  if (!confirm) {
    // Dry run: NEVER opens the real file, not even readonly, not even for a
    // migration ALTER -- openDb() always runs migrateSchema, which is a
    // write. Copy-to-scratch is the same isolation contract tools/replay-
    // check.ts and tools/truth-check.ts already use for exactly this reason.
    copyScratchDb(dbResolution.path, SCRATCH_DB_PATH);
    const dbHandle = openDb(SCRATCH_DB_PATH);
    assertResolvedTo(dbHandle, SCRATCH_DB_PATH);
    console.log(`[coach-backfill] DRY RUN -- reading a scratch copy of ${dbResolution.path} (${dbResolution.source})`);
    const rows = findFailedTraces(gameId);
    console.log(`[coach-backfill] ${rows.length} row(s) would be backfilled${gameId != null ? ` (game ${gameId})` : ""}:`);
    for (const r of rows) {
      console.log(`  id=${r.id} game=${r.gameId} ply=${r.ply} kind=${r.kind} backend=${r.backend} output="${r.output.slice(0, 70)}"`);
    }
    console.log("[coach-backfill] dry run only -- nothing written. Re-run with --confirm to write.");
    return;
  }

  // --confirm: the one path that writes to her real history.
  if (!fs.existsSync(dbResolution.path)) {
    throw new Error(`refusing --confirm: resolved db path does not exist: ${dbResolution.path}`);
  }
  console.log("[coach-backfill] taking a counted backup before any write...");
  const backup = await backupLiveDb(REPO_ROOT);
  console.log(
    `[coach-backfill] backup: ${backup.dbPath} (${backup.snapshot.games} games, ${backup.snapshot.moves} moves, integrity ${backup.snapshot.integrity})`
  );

  const dbHandle = openDb(dbResolution.path);
  assertResolvedTo(dbHandle, dbResolution.path);
  console.log(`[coach-backfill] db isolation confirmed: writing to ${dbResolution.path} (${dbResolution.source})`);

  const rows = findFailedTraces(gameId);
  console.log(`[coach-backfill] ${rows.length} row(s) to backfill${gameId != null ? ` (game ${gameId})` : ""}`);
  for (const row of rows) {
    const before = row.output.slice(0, 70);
    const outcome = await backfillTrace(row, agentSdkBackend);
    if (outcome === "regenerated") {
      const after = (getAdviceTraceById(row.id).output as string).slice(0, 90);
      console.log(`  id=${row.id}: REGENERATED\n    before: ${before}\n    after:  ${after}`);
    } else {
      console.log(`  id=${row.id}: ${outcome.toUpperCase()} -- left untouched`);
    }
  }
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[coach-backfill] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
