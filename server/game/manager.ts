import { Chess } from "chess.js";
import { MaiaOpponent } from "../engines/maia";
import { StockfishEvaluator } from "../engines/stockfish";
import {
  createGame, finishGame, recordMove, attachEval, logGameEvent, insertVerdict, getVerdicts,
  getGameMoves, getGame, insertTurningPoints, getTurningPoints, setMoveClassification,
  listFinishedGames, insertChatMessage, getChatMessages, getMoveEvalsByPlies,
  setMoveHighlighted, deleteGameRows,
} from "../store/db";
import { classifyMove, isAdviceLevel, DEFAULT_ADVICE_LEVEL } from "../annotator/classify";
import { adjudicatePosition } from "../annotator/adjudicate";
import { computeHint as computeHintFacts, type HintFacts } from "../annotator/hint";
import { moveEndpoints } from "../annotator/moveEndpoints";
import { deriveContinuation } from "../annotator/continuation";
import type { ThreatFacts, RecommendationFacts } from "../annotator/motifs";
// Increment 3b: panel-ruled turning points + move classifications. Reads
// STORED evals only (see persistGameSummary below) — never touches
// this.evaluator or the shared queue, same "engine math only" boundary as
// judgeMove's classify.ts/adjudicate.ts calls.
import { computeTurningPoints, TP_ALGO_VERSION, type TurningPoint } from "../annotator/turningPoints";
import { classifyMoves } from "../annotator/classifications";
// Increment 3a Wave 2: the coach's async narrate surface. Deliberately kept
// out of judgeMove above — see that method's own comment and
// classify.test.ts's scoped gate test, which pins this: judgeMove's own
// body must never reference coach, even though this file's top level now
// does for the sibling narrate() method below.
import { assembleFactList, narrate as narrateFacts } from "../coach";
import {
  chat as chatWithCoach, assembleChatFactList, CHAT_HISTORY_WINDOW, CHAT_MAX_LEN,
  CHAT_TIMEOUT_MS, CHAT_REVIEW_BUDGET_MS,
  type ChatContext, type ChatOutcome,
} from "../coach/chat";
// Wave D (coach-truth-speed round): the deterministic board/general router --
// computed here, server-side, from the user's own message text plus whether
// she opened chat from a specific on-screen moment (hasFocus below), never
// left to the model to decide (the owner's explicit choice; see intent.ts's
// header for why).
import { classifyIntent } from "../coach/intent";
import { claudeCliBackend } from "../coach/backends/claude-cli";
import { ollamaBackend } from "../coach/backends/ollama";
import { agentSdkBackend } from "../coach/backends/agent-sdk";
import { noBackend, type CoachBackend } from "../coach/backends/types";

interface LiveGame { chess: Chess; opponent: MaiaOpponent; ply: number; finished: boolean }

// Increment 3.91 (Task 2): the turning-lines endpoint's per-point shape —
// mirrored (hand-mirroring, same convention as TurningPoint's own
// server/client split) by src/game/api.ts's client-side TurningLine. Every
// from/to here is derived by chess.js REPLAY (moveEndpoints, or the pv
// replay loop in getTurningLines below) — never by parsing SAN/UCI text as
// truth. Optional fields are omitted (not fabricated as empty/zero values)
// when the underlying data isn't available for that ply.
export interface TurningLine {
  ply: number;
  playedFromTo?: { from: string; to: string };
  bestSan?: string;
  bestFromTo?: { from: string; to: string };
  pvSans: string[];
  threat?: { from: string; to: string };
}

// Playtest-calibrated draw-acceptance band: the computer accepts an offer
// when the position is within this many centipawns of dead equal. Starting
// value only — expect this to move once real playtest data comes in.
const DRAW_ACCEPT_CP_BAND = 60;

// Task 8 (inc 3.95, Fix 2), owner-calibratable starting value: how long a
// per-pref resolved backend is trusted before pickCoachBackend re-probes
// availability instead of reusing the cached entry. Before this, the Map
// cached forever — picking "ollama" before the daemon was running pinned
// that pref to noBackend/templates for the rest of the process's life, with
// no way back to ollama short of a server restart. A TTL means a daemon
// that comes up later self-heals the next time that pref is used, without
// giving up the "probe once, not on every call" cost savings the cache
// exists for in the first place.
export const BACKEND_CACHE_TTL_MS = 30000;

// Wave 2, item 5: coach's-corner narration budgets. The agent-sdk backend
// spins up a whole SDK session per call and is materially slower than the
// claude CLI / ollama, so it gets double the flat budget; every other
// resolved backend keeps the 15s narrate() has always used (its own default).
export const NARRATE_DEFAULT_BUDGET_MS = 15000;
export const NARRATE_AGENT_SDK_BUDGET_MS = 30000;

interface CachedBackend {
  backend: CoachBackend;
  cachedAt: number;
}

// B4a (2026-07-27, coach-truth-speed round): plain-language derivation of
// ChatOutcome from the db's own games.result/end_reason columns -- the only
// two columns finishGame ever writes (see store/db.ts). end_reason is
// non-null only for the /adjudicate "end the game" button path
// (decideAdjudication's "adjudicated" | "resigned" | "draw-adjudicated");
// the older resign()/offerDraw()/natural-gameOver paths all write a null
// end_reason, so a decisive result with no end_reason is disambiguated by
// the LAST played san itself: chess.js appends "#" to a checkmating move,
// so its absence means the game ended by the player's own resign() button
// (v1's only other way a decisive game with no end_reason ends). Read-only
// over already-persisted columns -- no engine call, no re-derivation of
// game state.
//
// Exported 2026-07-28 (eval-instrument-repair round) so tools/coach-eval's
// board-review arm derives its finished-game outcome through the SAME
// function the product uses, against its own scratch db copy, instead of the
// fabricated `1-0 by resignation` wrapper it used to synthesize. Still called
// from exactly one place in production (chatAbout below); the export exists
// for the harness, not for a second runtime call site.
export function deriveChatOutcome(
  result: string | null,
  endReason: string | null,
  lastSan: string | undefined,
  finalPly: number
): ChatOutcome | undefined {
  if (!result) return undefined;
  const winner: "you" | "mallow" | "draw" = result === "1-0" ? "you" : result === "0-1" ? "mallow" : "draw";
  let how: string;
  if (endReason === "adjudicated") how = "adjudicated win";
  else if (endReason === "resigned") how = "adjudicated resignation";
  else if (endReason === "draw-adjudicated") how = "adjudicated draw";
  else if (lastSan?.endsWith("#")) how = "checkmate";
  else how = winner === "draw" ? "draw" : "resignation";
  return { result, winner, how, finalPly };
}

// H3 fix, logic-only half (union review, 2026-07-31): judgeMove's
// insertVerdict call used to store `verdict.threat` alone
// (`JSON.stringify(verdict.threat)` or null) — conversionCopy was on the
// wire (returned to the caller) but never persisted, so a rewind or a Lab
// audit could never recover what she was actually told on a conversion
// nudge. Merges the two FLAT, never nested: manager.ts's own threatForPly
// reads facts_json as `Partial<ThreatFacts>` and expects
// refutationFromSquare/refutationToSquare at the TOP level, so nesting
// threat under its own key would silently break that reader. The extra
// `conversionCopy` key is simply additional data threatForPly's own
// (unvalidated) cast ignores — harmless by construction, not by luck.
// Pure and exported so it's unit-testable without a real evaluator or a
// crafted mate position (see manager.test.ts) — the JSON shape is the only
// thing this function is responsible for; classify.ts already owns
// deciding what conversionCopy/threat actually say.
export function buildVerdictFactsJson(
  threat: ThreatFacts | undefined,
  conversionCopy: string | undefined
): string | null {
  if (!threat && !conversionCopy) return null;
  // JSON.stringify drops an undefined-valued key automatically, so a
  // conversionCopy-less verdict serializes identically to the old
  // `JSON.stringify(verdict.threat)` shape — no migration, no reader change
  // needed for the common (non-conversion) case.
  return JSON.stringify({ ...(threat ?? {}), conversionCopy });
}

export class GameManager {
  private games = new Map<number, LiveGame>();
  private evaluator = new StockfishEvaluator();
  private opponents = new Map<number, MaiaOpponent>();
  // Task 5 (F17): probed once PER PREF, cached in a Map keyed by the pref
  // string — never a single shared member. A single member would race: two
  // concurrent requests carrying different backendPref values (e.g. one
  // player narration asking for "claude" while a chat call asks for
  // "template") would clobber each other's resolved backend mid-flight.
  // Keying by pref means each preference resolves and caches independently,
  // and repeat calls with the same pref skip re-probing until the entry
  // ages past BACKEND_CACHE_TTL_MS (Task 8, Fix 2).
  private coachBackends = new Map<string, CachedBackend>();
  // Task 8 (inc 3.95, Fix 2): injectable clock — production code never calls
  // Date.now() directly anywhere in this class, only through this seam, so
  // manager.test.ts can advance time deterministically past
  // BACKEND_CACHE_TTL_MS instead of sleeping for real in a test. Defaults to
  // the real wall clock; setClockForTesting below is the only thing that
  // ever overrides it.
  private clock: () => number = () => Date.now();

  async init() { await this.evaluator.init(); }

  // Test-teardown seam (gate-determinism fix, 2026-07-31): `evaluator`'s
  // field initializer above constructs a REAL StockfishEvaluator, which in
  // turn spawns the real `stockfish` binary SYNCHRONOUSLY in UciEngine's
  // constructor -- before init() ever runs, before any game exists. Three
  // real test files learned that the hard way: server/coach/chat.test.ts's
  // "GameManager.chat (F16 integration)" describe block called
  // `new GameManager()` in a per-TEST beforeEach (21 tests, so 21 spawned
  // processes) on the documented-but-wrong assumption that "no gm.init()
  // here" meant the real engine never starts; server/game/manager.test.ts's
  // single file-level `gm` and server/index.ts's module-level `gm` (shared
  // by index.test.ts and index.stream.test.ts) each leaked one more. None
  // of the four ever killed what they spawned. Vitest's fork-pool workers
  // are reused across many test FILES rather than respawned per file
  // (confirmed by watching `ps` mid-run: the worker count stayed at the
  // pool size while spawned `stockfish` processes kept accumulating), so
  // every leaked process survives for the rest of that worker's run, not
  // just its own file -- competing for real CPU with whichever test
  // happens to run later in the same worker. That is the load-sensitivity
  // that made server/index.stream.test.ts's "done frame" test flake with
  // "socket hang up" under the full suite while passing 3/3 in isolation
  // (where nothing else in the process had leaked anything yet). shutdown()
  // is the missing teardown -- quit the evaluator and every cached
  // opponent so nothing outlives its own test file. Unused in production
  // (the real server process runs until it's killed).
  shutdown(): void {
    this.evaluator.quit();
    for (const o of this.opponents.values()) o.quit();
  }

  // Test/observability seam only: lets a test verify shutdown() actually
  // terminates the real spawned OS process, not just that this wrapper
  // flags itself dead. No production call site.
  getEvaluatorPidForTesting(): number | undefined {
    return this.evaluator.pid;
  }

  // Test seam only (Task 8, Fix 2): lets manager.test.ts control "now" for
  // the backend cache's TTL check below without a real sleep. Unused in
  // production.
  setClockForTesting(clock: () => number) {
    this.clock = clock;
  }

  // pref semantics (panel A4/A5): "template" is a first-class choice with NO
  // probe (always noBackend); "ollama" is ollama-if-available else
  // noBackend (no claude-cli fallback — an explicit "local only" request
  // shouldn't quietly upgrade to the cloud backend); "agent-sdk" (warm-
  // coach-backend round, Task 3) is agent-sdk -> claude-cli -> ollama ->
  // none, so an unavailable warm SDK client still degrades to the existing
  // chain rather than straight to templates; "claude", undefined, or any
  // unrecognized value gets the pre-existing claude -> ollama -> none chain
  // (today's default behavior, unchanged).
  private async pickCoachBackend(pref?: string): Promise<CoachBackend> {
    const key = pref ?? "claude";
    const now = this.clock();
    const cached = this.coachBackends.get(key);
    if (cached && now - cached.cachedAt < BACKEND_CACHE_TTL_MS) return cached.backend;

    let backend: CoachBackend;
    if (key === "template") {
      backend = noBackend;
    } else if (key === "ollama") {
      backend = (await ollamaBackend.available()) ? ollamaBackend : noBackend;
    } else if (key === "agent-sdk") {
      if (await agentSdkBackend.available()) backend = agentSdkBackend;
      else if (await claudeCliBackend.available()) backend = claudeCliBackend;
      else if (await ollamaBackend.available()) backend = ollamaBackend;
      else backend = noBackend;
    } else {
      if (await claudeCliBackend.available()) backend = claudeCliBackend;
      else if (await ollamaBackend.available()) backend = ollamaBackend;
      else backend = noBackend;
    }
    this.coachBackends.set(key, { backend, cachedAt: this.clock() });
    return backend;
  }

  // Test seam only: lets manager.test.ts (and index.test.ts, chat.test.ts)
  // inject a FAKE backend so tests never probe or invoke the real claude CLI
  // / ollama (brief: "do NOT invoke the real claude CLI in tests"). Seeds
  // the Map entry for a named pref — defaults to "claude" (the pref every
  // pre-Task-5 caller implicitly used) so every existing call site keeps
  // working unchanged. Unused in production — pickCoachBackend's
  // probe-and-cache runs for any pref a test hasn't already primed. Stamps
  // the seeded entry with the (possibly injected) clock's current time, same
  // as a real probe-and-cache, so it participates in the same TTL rule
  // rather than being permanently exempt from it.
  setCoachBackendForTesting(backend: CoachBackend, pref?: string) {
    this.coachBackends.set(pref ?? "claude", { backend, cachedAt: this.clock() });
  }

  // Highlight-a-move (Task 1): a plain passthrough to the db accessor. No
  // validation of gameId/ply here -- the route already checks shape before
  // calling in, and setMoveHighlighted's UPDATE is a safe no-op against an
  // unknown (game_id, ply) pair.
  highlightMove(gameId: number, ply: number, highlighted: boolean): void {
    setMoveHighlighted(gameId, ply, highlighted);
  }

  private async opponentFor(elo: number): Promise<MaiaOpponent> {
    if (!this.opponents.has(elo)) {
      const o = new MaiaOpponent(elo);
      await o.init();
      this.opponents.set(elo, o);
    }
    return this.opponents.get(elo)!;
  }

  async newGame(sessionId: number, elo: number) {
    const opponent = await this.opponentFor(elo);
    const gameId = createGame(sessionId, (opponent.fallback ? "fallback-" : "maia-") + elo);
    this.games.set(gameId, { chess: new Chess(), opponent, ply: 0, finished: false });
    return { gameId, fen: new Chess().fen(), fallback: opponent.fallback, elo };
  }

  private record(gameId: number, live: LiveGame, san: string, uci: string, timeSpentMs: number) {
    live.ply += 1;
    const ply = live.ply;
    const fenAfter = live.chess.fen();
    recordMove({ gameId, ply, san, uci, fenAfter, timeSpentMs });
    // async eval; never awaited on the move path (latency rule)
    this.evaluator.evaluate(fenAfter, 600)
      .then((ev) => attachEval(gameId, ply, ev))
      .catch((err) => console.warn("[girl-chess] eval failed:", err.message));
  }

  // Increment 3b: called from every finish site (playerMove's two gameOver
  // branches, resign, offerDraw's accept branch, adjudicate's execute
  // branch) right after finishGame/live.finished. Pure in-memory compute
  // over already-stored moves (getGameMoves is a synchronous
  // better-sqlite3 read) — no engine call, no shared queue — so there's no
  // real async work to defer, but it's still wrapped so a computation bug
  // can never surface as a failure on the end-game response the client is
  // waiting on ("fire-and-forget: never delays the end-game UX"). Also
  // fully idempotent (insertTurningPoints no-ops on a game_id that already
  // has rows; setMoveClassification is a plain UPDATE) so it's safe even if
  // a future finish path ever called it twice for the same game.
  private persistGameSummary(gameId: number, result: string) {
    try {
      const rows = getGameMoves(gameId);
      const moves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate, bestMove: r.best_move ?? null }));
      const turningPoints = computeTurningPoints(moves, result);
      insertTurningPoints(
        gameId,
        turningPoints.map((t) => ({
          rank: t.rank, ply: t.ply, san: t.san, label: t.label,
          punishSan: t.punishSan ?? null, deltaP: t.deltaP, lowConfidence: t.lowConfidence, kind: t.kind,
          plyEnd: t.plyEnd ?? null, missedPunish: t.missedPunish ?? false,
          crossedAdvantage: t.crossedAdvantage ?? false,
          mateIn: t.mateIn ?? null, missedCount: t.missedCount ?? null,
          endKind: t.endKind ?? null, anchorKind: t.anchorKind ?? null,
        })),
        TP_ALGO_VERSION
      );
      for (const c of classifyMoves(moves)) {
        if (c) setMoveClassification(gameId, c.ply, c.classification);
      }
    } catch (err) {
      console.warn("[girl-chess] game summary computation failed:", (err as Error).message);
    }
  }

  // Increment 3b: GET /api/game/:id/summary. Reads persisted rows first
  // (the normal path — every game finished after this increment shipped
  // has them); falls back to computing fresh from stored moves for a game
  // that finished before this increment existed (no turning_points rows at
  // all) or one whose evals hadn't all attached yet at persist time. Sync
  // (no engine call either way), so this is a plain method, not async.
  // Increment 3c: `moves` (ply/san only, no eval leakage — the debrief's
  // rewind seam replays these SANs on a fresh client-side chess.js to
  // reconstruct any position; see src/review/Rewind.tsx) is now always
  // included alongside the existing turningPoints/classifications, in both
  // the persisted and compute-on-read branches below.
  //
  // debrief-v2: self-healing algo versioning. getTurningPoints already
  // returns only the highest-version row set stored for the game (see its
  // comment in store/db.ts); here we additionally check whether THAT set is
  // still behind the current algorithm (NULL algo_version on old rows reads
  // as 1) and, if so, recompute fresh from stored evals and persist a new
  // TP_ALGO_VERSION row set — insertTurningPoints's per-version existence
  // guard makes this idempotent, and old rows are never deleted (CLAUDE.md's
  // data rule). This heals every pre-debrief-v2 game (including the one
  // that motivated this round) the next time its summary is opened, with no
  // migration script and no data loss.
  getSummary(gameId: number): {
    ok: true;
    turningPoints: TurningPoint[];
    classifications: { ply: number; classification: string }[];
    moves: { ply: number; san: string; highlighted: boolean }[];
  } {
    let persisted = getTurningPoints(gameId);
    const rows = getGameMoves(gameId);
    const moves = rows.map((r: any) => ({ ply: r.ply, san: r.san, highlighted: r.highlighted === 1 }));

    const persistedVersion = persisted.length > 0 ? (persisted[0].algo_version ?? 1) : TP_ALGO_VERSION;
    if (persisted.length > 0 && persistedVersion < TP_ALGO_VERSION) {
      const evalMoves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate, bestMove: r.best_move ?? null }));
      const game = getGame(gameId);
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
        })),
        TP_ALGO_VERSION
      );
      persisted = getTurningPoints(gameId); // re-read: now returns the freshly-inserted v-TP_ALGO_VERSION set
    }

    if (persisted.length > 0) {
      return {
        ok: true,
        turningPoints: persisted.map((r: any) => ({
          rank: r.rank, ply: r.ply, san: r.san, label: r.label,
          punishSan: r.punish_san ?? undefined, deltaP: r.delta_p,
          lowConfidence: !!r.low_confidence, kind: r.kind,
          plyEnd: r.ply_end ?? undefined, missedPunish: !!r.missed_punish,
          crossedAdvantage: !!r.crossed_advantage,
          mateIn: r.mate_in ?? undefined, missedCount: r.missed_count ?? undefined,
          endKind: r.end_kind ?? undefined, anchorKind: r.anchor_kind ?? undefined,
        })),
        classifications: rows
          .filter((m: any) => m.classification)
          .map((m: any) => ({ ply: m.ply, classification: m.classification })),
        moves,
      };
    }

    // Task 11 fix 2: on-read historical backfill. A finished game with ZERO
    // persisted turning_points rows at all (predates increment 3b entirely,
    // or evals hadn't attached by persist time) used to only compute here
    // and hand the result back without ever writing it down — every future
    // read recomputed from scratch and the game kept showing "no clear
    // lesson yet" forever.
    //
    // DATA-RULE GUARD: strictly additive + idempotent — insertTurningPoints'
    // own existence guard (keyed on (game_id, algo_version), see db.ts) is
    // what makes a second read a no-op: it will find `persisted.length > 0`
    // at the top of this function next time and return from the branch
    // above without ever calling insert again, so there's no bookkeeping to
    // duplicate here. STORED evals only: `evalMoves` comes from
    // getGameMoves' already-persisted rows, never the live evaluator queue.
    // Driven by this read, never a bulk pass — nothing outside getSummary
    // triggers this.
    //
    // Only for FINISHED games (`game.result` set) — an in-progress game's
    // evals are still trickling in via the async attachEval path, and
    // persisting turning points as if final would fabricate data for a game
    // that hasn't ended. A game with no stored evals at all naturally
    // computes zero turning points (computeTurningPoints's all-null
    // short-circuit), and the `computed.length > 0` guard below means
    // nothing is ever written for it (graceful no-op).
    const evalMoves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate, bestMove: r.best_move ?? null }));
    const game = getGame(gameId);
    const computed = computeTurningPoints(evalMoves, game?.result ?? "");
    if (game?.result && computed.length > 0) {
      insertTurningPoints(
        gameId,
        computed.map((t) => ({
          rank: t.rank, ply: t.ply, san: t.san, label: t.label,
          punishSan: t.punishSan ?? null, deltaP: t.deltaP, lowConfidence: t.lowConfidence, kind: t.kind,
          plyEnd: t.plyEnd ?? null, missedPunish: t.missedPunish ?? false,
          crossedAdvantage: t.crossedAdvantage ?? false,
          mateIn: t.mateIn ?? null, missedCount: t.missedCount ?? null,
          endKind: t.endKind ?? null, anchorKind: t.anchorKind ?? null,
        })),
        TP_ALGO_VERSION
      );
    }
    return {
      ok: true,
      turningPoints: computed,
      classifications: classifyMoves(evalMoves).filter((c): c is { ply: number; classification: string } => c != null),
      moves,
    };
  }

  // Increment 3.91 (Task 2): GET /api/game/:id/turning-lines. Exposes the
  // ALREADY-PERSISTED Stockfish best-move + principal variation for each of
  // the game's turning points (moves.best_move/pv, written by attachEval on
  // the move path) — a new ADDITIVE endpoint. Reads turning points via the
  // pure getTurningPoints(gameId) SELECT accessor (server/store/db.ts)
  // rather than getSummary: getSummary's self-heal can INSERT a fresh
  // TP_ALGO_VERSION row set when a game's persisted rows are below the
  // current algo version, and a GET must never write to the db (review
  // finding). turning_points rows are persisted at game end
  // (persistGameSummary), so getTurningPoints returns them with zero
  // compute-on-read write; a game whose rows are still at an older algo
  // version just degrades gracefully (the arrows reflect the stale set)
  // rather than triggering a heal here — this endpoint reads only, ever.
  // Every from/to below comes from a chess.js REPLAY (moveEndpoints for the
  // played SAN; the pv-replay loop for the engine line) — never from
  // parsing SAN/UCI text as truth, the same rule classify.ts/hint.ts
  // already follow. A ply whose eval never attached (or attached with an
  // empty pv) degrades gracefully: pvSans: [], no bestSan/bestFromTo —
  // never a guess. `threat` is populated only when a persisted
  // verdicts.facts_json row for that ply AND played san already carries a
  // refutation (no new engine call is made here, ever).
  getTurningLines(gameId: number): { ok: boolean; lines: TurningLine[] } {
    try {
      const turningPoints = getTurningPoints(gameId) as { ply: number; san: string }[];
      const rows = getGameMoves(gameId);
      const sans = rows.map((r: any) => r.san as string);
      // The line the player should see is the best line at the nearest
      // position where the PLAYER (always white) is on move. Player moves
      // on odd plies, mallow on even plies, so the player-to-move "seed"
      // ply is: odd t.ply -> t.ply - 1 (the position right before her
      // move, i.e. fenBefore); even t.ply -> t.ply itself (the position
      // right after mallow's move, i.e. fenAfter(t.ply)). In both cases
      // seedPly is even, and attachEval(seedPly) persisted the eval of
      // fenAfter(seedPly) — exactly this seed position — so
      // evalByPly.get(seedPly) is the correct, legal-for-white eval to
      // replay from. Reading evalByPly.get(t.ply) against fenBefore (the
      // old code) was the bug: that eval was computed for fenAfter(t.ply),
      // the OPPONENT's turn, so its pv's first move is illegal from
      // fenBefore and pvLine breaks at step 1. seedPly < 1 (a ply-1 turning
      // point has no prior ply to seed from) degrades gracefully to an
      // empty line.
      const seedPlies = Array.from(
        new Set(turningPoints.map((t) => t.ply - (t.ply % 2)).filter((p) => p >= 1))
      );
      const evals = getMoveEvalsByPlies(gameId, seedPlies);
      const evalByPly = new Map(evals.map((e) => [e.ply, e]));
      const verdicts = getVerdicts(gameId);

      const lines: TurningLine[] = turningPoints.map((t) => {
        // Fen immediately BEFORE this ply: replay every SAN strictly before
        // it, starting from the initial position (same replay-from-scratch
        // pattern as src/review/Rewind.tsx's fenAtPly).
        const before = new Chess();
        for (let i = 0; i < t.ply - 1 && i < sans.length; i++) before.move(sans[i]);
        const fenBefore = before.fen();

        const playedFromTo = moveEndpoints(fenBefore, t.san);

        const seedPly = t.ply - (t.ply % 2);
        let pvSans: string[] = [];
        let bestSan: string | undefined;
        let bestFromTo: { from: string; to: string } | undefined;
        if (seedPly >= 1) {
          // fenSeed: replay every SAN strictly before seedPly (same
          // replay-from-scratch pattern as fenBefore above) — this is the
          // position attachEval(seedPly) actually evaluated (its
          // fenAfter(seedPly)).
          const seed = new Chess();
          for (let i = 0; i < seedPly && i < sans.length; i++) seed.move(sans[i]);
          const fenSeed = seed.fen();
          ({ pvSans, bestSan, bestFromTo } = this.pvLine(fenSeed, evalByPly.get(seedPly)));
        }

        const threat = this.threatForPly(verdicts, t.ply, t.san);

        const line: TurningLine = { ply: t.ply, pvSans };
        if (playedFromTo) line.playedFromTo = playedFromTo;
        if (bestSan) line.bestSan = bestSan;
        if (bestFromTo) line.bestFromTo = bestFromTo;
        if (threat) line.threat = threat;
        return line;
      });

      return { ok: true, lines };
    } catch (err) {
      console.warn("[girl-chess] getTurningLines failed:", (err as Error).message);
      return { ok: false, lines: [] };
    }
  }

  // Replays a persisted pv (space-separated UCI moves, e.g. "g1f3 b8c6
  // f1c4") from fenBefore through chess.js, collecting SANs as it goes.
  // Falls back to a single-move replay of bestMove when pv is absent but
  // bestMove isn't (defensive — normal engine output always sets both
  // together). Stops at the first illegal/malformed step rather than
  // throwing, so a corrupted pv degrades to a shorter true line instead of
  // failing the whole endpoint.
  private pvLine(
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

  // The opponent's refutation of this ply, when a judge call for it already
  // computed and persisted one (verdicts.facts_json — see motifs.ts's
  // ThreatFacts and judgeMove's insertVerdict call below). Matched on BOTH
  // ply AND verdicts.move === the turning point's played san (review
  // finding): a ply can carry multiple verdicts rows — one per judge call,
  // including retracted candidates she looked at and backed out of — and
  // attaching a retracted candidate's refutation to the played move's line
  // would be a false threat claim. If no row matches both, this returns "no
  // claim" rather than falling back to another candidate's row.
  // Best-effort only: malformed/missing json, or a facts payload without
  // the refutation squares, both resolve to "no claim" rather than
  // throwing.
  private threatForPly(verdicts: any[], ply: number, playedSan: string): { from: string; to: string } | undefined {
    const matches = verdicts.filter((v) => v.ply === ply && v.move === playedSan && v.facts_json);
    if (matches.length === 0) return undefined;
    try {
      const facts = JSON.parse(matches[matches.length - 1].facts_json) as Partial<ThreatFacts>;
      if (facts.refutationFromSquare && facts.refutationToSquare) {
        return { from: facts.refutationFromSquare, to: facts.refutationToSquare };
      }
    } catch {
      // malformed json — no claim, never a guess.
    }
    return undefined;
  }

  // Increment 3c: GET /api/games — the "past games" saved-games menu. Thin
  // passthrough to the db accessor, kept as a GameManager method for the
  // same reason every other route goes through gm rather than db directly
  // (index.ts stays a pure routing layer).
  listGames(): {
    ok: true;
    games: { id: number; startedAt: string; opponent: string; result: string; endReason: string | null; lesson: string | null }[];
  } {
    return { ok: true, games: listFinishedGames() as any };
  }

  // Wave 3.5, item 2 (owner ask, 2026-08-01): real per-game deletion for the
  // past-games drawer's delete X. Guard checks BOTH sources of "is this
  // actually over" -- `this.games`' own finished flag when a LiveGame entry
  // exists (the ordinary case), and the db row's own `result` column
  // otherwise (a finished game can have no `this.games` entry at all, e.g.
  // after a process restart) -- because trusting only one would let either
  // a stale absent-from-map live game, or an unfinished db row with no
  // memory entry, slip past.
  //
  // Wave 3.5 fix (Minor, review 2026-08-01): an id that was NEVER a game at
  // all is a distinct fact from "this game exists but isn't over yet" --
  // both used to collapse into the same reason:"live" (409), which is a
  // misleading answer for an id nothing was ever created under. Reported as
  // reason:"not-found" so the route can answer 404 instead.
  //
  // On success, ALSO evicts any (already-finished) `this.games` entry for
  // this id -- the same "in-memory state can't outlive the db row"
  // discipline the B6 fix already established for playerMove's finished
  // guard: a stale handle for a row that no longer exists must never be
  // able to act on it again.
  deleteGame(gameId: number): { ok: boolean; reason?: string } {
    const live = this.games.get(gameId);
    if (live && !live.finished) return { ok: false, reason: "live" };
    const game = getGame(gameId);
    if (!game) return { ok: false, reason: "not-found" };
    if (game.result == null) return { ok: false, reason: "live" };
    deleteGameRows(gameId);
    this.games.delete(gameId);
    return { ok: true };
  }

  private gameOver(chess: Chess): { result: string } | undefined {
    if (!chess.isGameOver()) return undefined;
    if (chess.isCheckmate()) return { result: chess.turn() === "w" ? "0-1" : "1-0" };
    return { result: "1/2-1/2" };
  }

  // Increment 3.91 (Task 5): the "try the line" sandbox's engine reply.
  // Stateless and DB-free BY DESIGN — no gameId in or out, and no call
  // anywhere in this method to recordMove/attachEval/insertVerdict/
  // finishGame/insertTurningPoints or any other db.ts writer. It reuses
  // opponentFor's engine-process cache (an in-memory Map of live lc0/
  // stockfish handles, not persistence) so repeated explore calls at the
  // same elo don't re-spawn an engine every time, same as real games do.
  async exploreReply(
    fen: string,
    elo: number
  ): Promise<{ ok: boolean; reply?: { from: string; to: string; promotion?: string; san: string }; gameOver?: boolean }> {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return { ok: false };
    }
    if (this.gameOver(chess)) return { ok: true, gameOver: true };

    const opponent = await this.opponentFor(elo);
    const replyUci = await opponent.pickMove(chess.fen());
    const mv = chess.move({
      from: replyUci.slice(0, 2),
      to: replyUci.slice(2, 4),
      promotion: (replyUci[4] as any) ?? undefined,
    });
    return {
      ok: true,
      reply: { from: mv.from, to: mv.to, promotion: mv.promotion, san: mv.san },
      gameOver: this.gameOver(chess) ? true : undefined,
    };
  }

  // `override` (C4): set when the player confirmed a pending move the judge
  // had marked "warning" (never for a "nudge" confirm — see
  // src/game/moveFlow.ts's isOverrideConfirm, the client-side gate that
  // decides whether this is ever populated). The client already holds the
  // verdict at confirm time, so it carries deltaCp/mateAgainst straight
  // through rather than the server re-deriving them from the verdicts
  // table.
  async playerMove(
    gameId: number,
    from: string,
    to: string,
    promotion?: string,
    timeSpentMs = 0,
    override?: { deltaCp: number | null; mateAgainst: boolean }
  ) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false, fen: "" };
    // B6-flagged data-integrity gap, closed here: a finished game stayed in
    // `games` forever with no guard, so a stray /move after resign/mate
    // could still apply against a position that still had legal moves.
    if (live.finished) return { ok: false, fen: live.chess.fen() };
    let mv;
    try {
      mv = live.chess.move({ from, to, promotion: (promotion as any) ?? "q" });
    } catch {
      return { ok: false, fen: live.chess.fen() };
    }
    const playerCapture = mv.flags.includes("c") || mv.flags.includes("e");
    this.record(gameId, live, mv.san, mv.from + mv.to + (mv.promotion ?? ""), timeSpentMs);

    if (override) {
      // ply here is the ply this player move just occupied (this.record()
      // bumped live.ply immediately above) — matches the ply the judge's
      // verdict for this same move was recorded against.
      logGameEvent(
        gameId,
        "override",
        JSON.stringify({ ply: live.ply, deltaCp: override.deltaCp, mateAgainst: override.mateAgainst })
      );
    }

    let over = this.gameOver(live.chess);
    if (over) {
      finishGame(gameId, over.result);
      live.finished = true;
      this.persistGameSummary(gameId, over.result);
      return { ok: true, fen: live.chess.fen(), playerSan: mv.san, playerCapture, gameOver: over };
    }

    const replyUci = await live.opponent.pickMove(live.chess.fen());
    const reply = live.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: (replyUci[4] as any) ?? undefined });
    const replyCapture = reply.flags.includes("c") || reply.flags.includes("e");
    this.record(gameId, live, reply.san, replyUci, 0);

    over = this.gameOver(live.chess);
    if (over) { finishGame(gameId, over.result); live.finished = true; this.persistGameSummary(gameId, over.result); }
    return {
      ok: true, fen: live.chess.fen(), playerSan: mv.san, playerCapture,
      reply: { san: reply.san, uci: replyUci, capture: replyCapture },
      gameOver: over,
    };
  }

  // Stateless: no pending state is stored server-side (retract is purely
  // client-side). Validates against a clone of the live game's current
  // position — the live game itself is never mutated, so judging never
  // advances the game and confirming afterward through playerMove() is a
  // normal, independent move application (no double-apply risk).
  // `mode` (C3): trace-tagging only, distinguishes a pre-move (pending)
  // judgment from a post-move one (coach-only mode judges in parallel with
  // /move, after the move already played). Passed straight through to
  // insertVerdict, which defaults it to "guardian" when omitted — every
  // pre-C3 call site (judge-confirm's pending-render judge) keeps working
  // unchanged.
  // `strictness` (Task 6, F10 tuning — UI label "judge strictness", NOT
  // "advice level"): appended positionally so every pre-Task-6 call site
  // keeps working unchanged, same convention as `mode` above. Selects which
  // ADVICE_LEVELS threshold table classifyMove judges against; the verdict
  // row's existing advice_level column stores this same key (single
  // semantic: which table judged this move) — an omitted or unrecognized
  // value falls back to DEFAULT_ADVICE_LEVEL ("standard") rather than
  // throwing.
  async judgeMove(gameId: number, from: string, to: string, promotion?: string, mode?: string, strictness?: string) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false };
    if (live.finished) return { ok: false };
    const clone = new Chess(live.chess.fen());
    let mv;
    try {
      mv = clone.move({ from, to, promotion: (promotion as any) ?? "q" });
    } catch {
      return { ok: false };
    }
    // Fix (task-reviewer, post Task 6 approval — Critical): isAdviceLevel is
    // an explicit literal allowlist, not a bracket-lookup truthy check — a
    // plain `ADVICE_LEVELS[strictness]` here would resolve truthy for
    // Object.prototype-colliding values ("constructor", "toString", etc.)
    // reaching in via POST /api/game/:id/judge's unvalidated body, silently
    // turning every verdict "silent" downstream in classifyMove. See
    // isAdviceLevel's own comment in classify.ts for the full mechanism.
    const level = isAdviceLevel(strictness) ? strictness : DEFAULT_ADVICE_LEVEL;
    const verdict = await classifyMove(clone, mv, this.evaluator, level);
    // Capture-first trace: every judged move gets a verdict row, silent
    // included (100% trace completeness) — even a move the player
    // retracts afterward. Retraction behavior is itself wanted data for
    // the Lab. `ply` is the ply this move WOULD occupy if confirmed; a
    // confirmed move joins back to it via (game_id, ply).
    insertVerdict({
      gameId,
      ply: live.ply + 1,
      fen: mv.before,
      move: mv.san,
      tier: verdict.tier,
      deltaCp: verdict.deltaCp,
      mateAgainst: verdict.mateAgainst,
      latencyMs: verdict.latencyMs,
      adviceLevel: level,
      mode,
      factsJson: buildVerdictFactsJson(verdict.threat, verdict.conversionCopy),
    });
    return { ok: true, verdict };
  }

  async resign(gameId: number) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false };
    if (live.finished) return { ok: false };
    // Player is always white in v1, so resigning is always a loss for white.
    finishGame(gameId, "0-1");
    live.finished = true;
    this.persistGameSummary(gameId, "0-1");
    logGameEvent(gameId, "resign");
    return { ok: true, result: "0-1" };
  }

  async offerDraw(gameId: number) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false, accepted: false };
    if (live.finished) return { ok: false, accepted: false };

    // Not the move path — this evaluate() IS awaited (unlike the
    // fire-and-forget attachEval above); the <2s move-latency rule doesn't
    // bind here.
    const ev = await this.evaluator.evaluate(live.chess.fen(), 600);

    // ev.cp is UCI's "score cp", reported from the perspective of the side
    // to move on the evaluated fen (see StockfishEvaluator.search /
    // stockfish.test.ts). We only compare its absolute value against a
    // near-zero band below, so which side is to move doesn't matter — a
    // small |cp| means the position is close to equal for either player.
    const accept = ev.mate === null && ev.cp !== null && Math.abs(ev.cp) <= DRAW_ACCEPT_CP_BAND;

    if (accept) {
      finishGame(gameId, "1/2-1/2");
      live.finished = true;
      this.persistGameSummary(gameId, "1/2-1/2");
      logGameEvent(gameId, "draw_accepted", ev.cp !== null ? `cp:${ev.cp}` : undefined);
      return { ok: true, accepted: true, result: "1/2-1/2" };
    }

    logGameEvent(gameId, "draw_declined", ev.cp !== null ? `cp:${ev.cp}` : ev.mate !== null ? `mate:${ev.mate}` : undefined);
    return { ok: true, accepted: false };
  }

  // Wave C, task C-A: the single "end the game?" button. Both the arm-step
  // preview (execute:false) and the real second-click execution
  // (execute:true) run through this SAME decision — the client never gets
  // to supply its own remembered outcome; the server re-derives it fresh
  // every time, execute or not, so a stale preview can never diverge from
  // what actually gets recorded. resign()/offerDraw() above stay exactly as
  // they were (API compat) and are simply no longer wired into the UI.
  async adjudicate(gameId: number, execute: boolean) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false };
    if (live.finished) return { ok: false };

    const decision = await adjudicatePosition(live.chess.fen(), this.evaluator);

    if (execute) {
      finishGame(gameId, decision.result, decision.reason);
      live.finished = true;
      this.persistGameSummary(gameId, decision.result);
      logGameEvent(
        gameId,
        "adjudicated",
        JSON.stringify({ outcome: decision.outcome, reason: decision.reason, playerCp: decision.playerCp })
      );
    }

    return {
      ok: true,
      outcome: decision.outcome,
      result: decision.result,
      reason: decision.reason,
      playerCp: decision.playerCp,
    };
  }

  // Increment 2.5: player-initiated deep hint. The pending move is client-only
  // state, so live.chess.fen() IS the before-position the hint applies to.
  // Runs on the shared serialized evaluator queue: a hint can briefly delay a
  // concurrent judge/eval call (~1.5-4s worst case), acceptable because hints
  // are rare and explicitly requested.
  async computeHint(gameId: number): Promise<{ ok: false } | { ok: true; facts: HintFacts }> {
    const live = this.games.get(gameId);
    if (!live || live.finished) return { ok: false };
    const fen = live.chess.fen();
    const facts = await computeHintFacts(fen, this.evaluator);
    if (!facts) return { ok: false };
    logGameEvent(
      gameId,
      "hint_compute",
      JSON.stringify({ bestUci: facts.bestUci, escalated: facts.escalated, fen })
    );
    return { ok: true, facts };
  }

  // Increment 3a Wave 2: the coach's narrate surface (F17 + F18 + F14 +
  // F40). SEPARATE async surface from judgeMove above by design (see the
  // hard boundary comment on that method, and this file's top-of-file
  // comment): the client already holds all the structured facts (herPiece/
  // from/to/tier/deltaCp/threat/best/recommendation) from its own judge and
  // hint-facts calls, so this re-derives nothing and never touches
  // `this.evaluator` — no engine call, no shared queue, no delay to the
  // judge/ladder/badge/confirm path. Only guards that the game exists and
  // isn't finished (mirrors judgeMove's guard) before assembling and
  // narrating.
  async narrate(
    gameId: number,
    body: {
      herPiece: string;
      from: string;
      to: string;
      tier: "nudge" | "warning";
      deltaCp: number | null;
      // Wave 1 (item 2 -- typed mate): the typed mate distance (mover
      // perspective), threaded onto the fact list so buildPrompt ships it
      // instead of the folded deltaCp. Optional -- a non-mate verdict omits.
      mateBefore?: number | null;
      mateAfter?: number | null;
      threat?: ThreatFacts;
      best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
      recommendation?: RecommendationFacts;
      // Task 5 (F17): per-request backend preference — "claude" | "ollama" |
      // "template" | undefined. Threaded straight through to
      // pickCoachBackend, which resolves and caches per-pref (see that
      // method's comment).
      backendPref?: string;
    }
  ): Promise<
    { ok: false } | { ok: true; text: string; source: "model" | "template"; traceId: number }
  > {
    const live = this.games.get(gameId);
    if (!live || live.finished) return { ok: false };

    const backend = await this.pickCoachBackend(body.backendPref);
    const facts = assembleFactList({
      herMove: { pieceKind: body.herPiece, from: body.from, to: body.to },
      tier: body.tier,
      deltaCp: body.deltaCp,
      // Wave 1 (item 2 -- typed mate): pass the typed mate distance through so
      // buildPrompt prefers it over the folded deltaCp (99098 for a lost mate).
      mateBefore: body.mateBefore,
      mateAfter: body.mateAfter,
      // Task 3 (2026-07-22, truthfulness leaks): DERIVED from the live game
      // state already in hand here (same source computeHint/exploreReply
      // use), never recomputed or hand-invented -- lets validateNarration
      // ground a defense claim against the real position.
      currentFen: live.chess.fen(),
      threat: body.threat,
      best: body.best,
      recommendation: body.recommendation,
    });
    // Wave 2, item 5: the agent-sdk backend is materially slower than the
    // claude CLI / ollama, so it gets a larger narration budget; every other
    // resolved backend keeps the flat 15s (narrate()'s own default). Picked
    // from the RESOLVED backend's name, not body.backendPref -- pickCoachBackend
    // may fall back (agent-sdk -> claude-cli -> ollama), and the budget must
    // track whatever actually runs.
    const budgetMs = backend.name === "agent-sdk" ? NARRATE_AGENT_SDK_BUDGET_MS : NARRATE_DEFAULT_BUDGET_MS;
    const result = await narrateFacts(facts, backend, { gameId, ply: live.ply, kind: body.tier }, { budgetMs });
    return { ok: true, text: result.text, source: result.source, traceId: result.traceId };
  }

  // Increment 3.9, F16 (this-game grounding chat). DB-backed by design
  // (panel A1) -- unlike narrate() above, this method never reads
  // `this.games`. That's what lets review-mode chat work on a finished game
  // that has fallen out of the live map entirely (the whole point of a
  // "past games" chat surface): getGame confirms the row exists,
  // getGameMoves replays the san history, and getTurningPoints supplies the
  // debrief facts once the game actually has a result (never guessed from
  // body.context.mode -- the db's own result column is the source of
  // truth). Live extras (herMove/tier/threat/best/recommendation) come only
  // from body.context, which the client already holds from its own
  // judge/hint-facts calls -- same "re-derive nothing" discipline as
  // narrate().
  //
  // History authority is the server too (F16): the client's own chat array
  // is optimistic UI only and is never sent or trusted -- the last
  // CHAT_HISTORY_WINDOW chat_messages rows for this game are read fresh on
  // every call, before this call's own user message is inserted (so the
  // window never double-counts the message that's still in flight).
  async chat(
    gameId: number,
    // Task 5 (F17): backendPref threaded through exactly like narrate()
    // above — same pickCoachBackend seam, same per-pref cache.
    body: { message: string; context: ChatContext; backendPref?: string },
    // B-stream (2026-07-27, coach-truth-speed round): additive optional 3rd
    // param, so every pre-this-wave caller (index.ts's JSON route, every
    // manager.test.ts call) is untouched and still gets today's behavior.
    // Threaded straight through to chatWithCoach's own opts below — this
    // method has no opinion about SSE at all, only about forwarding the two
    // hooks to the one place (chat.ts) that actually owns the attempt loop.
    streamOpts?: { onDelta?: (text: string) => void; onRedraft?: () => void }
  ): Promise<
    | { ok: false; error?: string }
    | {
        ok: true;
        text: string;
        source: "model" | "template";
        cause?: "backend-down" | "templates-only" | "timeout" | "validation-failed" | "off-topic";
        traceId: number;
      }
  > {
    const message = body.message ?? "";
    if (message.length > CHAT_MAX_LEN) return { ok: false, error: "too-long" };

    const game = getGame(gameId);
    if (!game) return { ok: false };

    const moveRows = getGameMoves(gameId);
    const gameMoves = moveRows.map((r: any) => ({ ply: r.ply, san: r.san }));
    const finished = game.result != null;
    const turningPoints = finished
      ? getTurningPoints(gameId).map((r: any) => ({ ply: r.ply, san: r.san, label: r.label, punishSan: r.punish_san ?? undefined }))
      : undefined;
    // B4a (2026-07-27, coach-truth-speed round): the game-over fact, derived
    // from the db's own result/end_reason columns -- never from
    // body.context.mode (same "the db is the source of truth" discipline
    // `finished` above already follows). Absent (undefined) while the game
    // is still live, so a live chat's fact list carries no outcome at all.
    const outcome: ChatOutcome | undefined = finished
      ? deriveChatOutcome(game.result, game.end_reason ?? null, gameMoves[gameMoves.length - 1]?.san, gameMoves.length)
      : undefined;
    // Task 3 (R1a, fact-gap round): moveRows already carries the judge's
    // persisted eval_cp/eval_mate/best_move(uci)/pv(space-joined uci) per
    // ply -- convert best_move/pv to SAN by replaying the SAME way
    // getTurningLines does (reusing pvLine below, no new logic).
    //
    // 2026-07-28 (off-by-one fix, coach-truth-speed round): a ply's OWN
    // best_move/pv is the eval of the position AFTER that ply was played
    // (see record()'s fenAfter/attachEval pairing above -- attachEval(ply)
    // persists fenAfter(ply)'s eval), so it names the best move for
    // whoever is to move NEXT, i.e. ply+1 -- not an alternative to the
    // move just played at ply. The old code attached each row's own
    // best_move/pv to its OWN ply, which named the best REPLY to that move,
    // not the best move INSTEAD of it. Proven against real game 150: the
    // persisted eval for ply 54 (Kh6) has best_move a8h8 (Qh8#, an
    // immediate mate) -- that is the best move for ply 55 (White's Nf7+),
    // not for ply 54 itself (a Black move; Qh8# is a White queen move and
    // could never have been "instead of Kh6"). Fix: track the PRIOR row's
    // eval and attach it to the CURRENT ply, replayed from fenBefore (the
    // position the current ply's own move was chosen from, which is
    // exactly what the prior ply's attachEval evaluated as its fenAfter).
    // Ply 1 has no prior row, so its bestSan/pvSans are an honest gap
    // (null/[]) rather than a guess -- there is no ply-0 eval to draw from.
    const perPlyChess = new Chess();
    let priorEval: { bestMove: string | null; pv: string | null } | undefined;
    const perPlyAnalysis = moveRows.map((r: any) => {
      const fenBefore = perPlyChess.fen();
      const mv = perPlyChess.move(r.san);
      const { pvSans, bestSan } = this.pvLine(fenBefore, priorEval);
      priorEval = { bestMove: r.best_move ?? null, pv: r.pv ?? null };
      return {
        ply: r.ply as number,
        san: mv.san,
        evalCp: (r.eval_cp ?? null) as number | null,
        evalMate: (r.eval_mate ?? null) as number | null,
        bestSan: bestSan ?? null,
        pvSans,
        // Forward-prediction round (2026-07-28): the replay-proven claim for
        // this ply's line -- deterministic, chess.js only, derived from the
        // exact fenBefore + pvSans pair pvLine just replayed. undefined when
        // nothing is provable; JSON.stringify drops the key entirely then.
        then: deriveContinuation(fenBefore, pvSans),
      };
    });
    // Highlight-a-move (Task 8): straight off the same moveRows Task 1
    // widened with `highlighted` -- no extra query.
    const highlightedPlies = moveRows.filter((r: any) => r.highlighted === 1).map((r: any) => r.ply as number);
    const facts = assembleChatFactList(
      gameMoves,
      body.context,
      turningPoints,
      perPlyAnalysis,
      {
        status: finished ? "finished" : "in-progress",
        outcome,
      },
      highlightedPlies.length > 0 ? highlightedPlies : undefined
    );

    const historyRows = getChatMessages(gameId, CHAT_HISTORY_WINDOW);
    const history = historyRows.map((r: any) => ({ role: r.role as "user" | "coach", text: r.text }));

    insertChatMessage({ gameId, role: "user", text: message });

    const backend = await this.pickCoachBackend(body.backendPref);
    // Review-mode ply = the game's total ply count; in live mode this is
    // the same number (the live in-memory ply counter and "total moves
    // recorded so far" agree while the game is still in progress) -- so one
    // db-derived value covers both, without ever touching `this.games`.
    const ply = gameMoves.length;
    // B1 (2026-07-27, coach-truth-speed round), owner's verbatim ask: once
    // the game is over she is no longer waiting on a move, so a finished
    // game gets the longer TOTAL budget for harder review questions; a live
    // game keeps the budget she already likes. Computed here, server-side,
    // from the SAME `finished` the outcome fact above uses -- never from
    // body.context.mode, which is a client claim this method already
    // distrusts for the outcome fact.
    const budgetMs = finished ? CHAT_REVIEW_BUDGET_MS : CHAT_TIMEOUT_MS;
    // Wave D: hasFocus mirrors chatFocus.ts's own reconciled focus state --
    // she opened chat from a specific on-screen moment (the hint ladder or a
    // turning-point card) whenever either focus field is present on the
    // context this request carries. That alone routes "board" regardless of
    // the message text (classifyIntent's own top-priority rule).
    // Wave F (review fix): hasPendingMove is the SAME signal that was
    // already being ignored (review.md finding 1's root cause) -- she picked
    // up a piece and dropped it on the board but hasn't confirmed, which is
    // just as much "pointing at something" as an open hint/turning-point
    // card. status is the exact same finished/in-progress value already
    // derived above for the outcome fact and the review budget, never a
    // second, independently-computed guess.
    const hasFocus = !!(body.context.hintFocus || body.context.turningPointFocus);
    const hasPendingMove = !!body.context.pendingMove;
    const intent = classifyIntent(message, { hasFocus, hasPendingMove, status: finished ? "finished" : "in-progress" });
    const result = await chatWithCoach(message, history, facts, backend, { gameId, ply, kind: "chat" }, {
      budgetMs,
      intent,
      onDelta: streamOpts?.onDelta,
      onRedraft: streamOpts?.onRedraft,
    });

    // B3b (2026-07-27, coach-truth-speed round): a failed (template) reply
    // is no longer persisted into chat_messages -- only a genuine model
    // answer joins the history CHAT_HISTORY_WINDOW re-feeds the coach next
    // turn. The advice_trace below still writes unconditionally (the Lab
    // loses nothing), and the USER's row above already persisted regardless
    // of what comes back, so an unanswered question still reads honestly as
    // "asked, no reply yet" rather than vanishing. Measured ground truth
    // (game 146): a failed reply's own text sometimes echoed back INTO a
    // later prompt ("that one took me longer than i had", trace 98) because
    // the coach's own apology was persisted as a real coach turn -- this is
    // the fix for that doom loop, not just tidiness.
    if (result.source === "model") {
      insertChatMessage({ gameId, role: "coach", text: result.text, traceId: result.traceId });
    }

    // Task 8 (inc 3.95, Fix 1), owner-ruled: chat.ts's own cause is always
    // "backend-down" whenever backend.generate() throws — true both for a
    // genuine failed claude/ollama probe AND for pickCoachBackend's
    // synchronous, no-probe "template" branch (noBackend.generate() always
    // throws). Those are not the same thing to the player: choosing
    // "templates only" is a deliberate voice pick, not the coach going
    // offline, so CoachChat's muted offline chip must never render for it.
    // Reclassify only that one case, here, where the pref that CAUSED the
    // throw is actually known — chat.ts itself has no visibility into pref
    // and its own "backend-down" meaning stays unchanged for every other
    // caller (including chat.test.ts's own backend-down test, which asks
    // for the default "claude" pref and gets a real failure).
    // Task 2 (2026-07-22, truthfulness leaks): "timeout" passes through
    // untouched -- the templates-only override above only ever applies when
    // chat.ts's cause is "backend-down" (a synchronous no-probe throw from
    // noBackend.generate() is never a timeout), so a real timeout is never
    // misreported as a deliberate voice pick either.
    const cause: "backend-down" | "templates-only" | "timeout" | "validation-failed" | "off-topic" | undefined =
      result.cause === "backend-down" && body.backendPref === "template" ? "templates-only" : result.cause;

    return cause
      ? { ok: true, text: result.text, source: result.source, cause, traceId: result.traceId }
      : { ok: true, text: result.text, source: result.source, traceId: result.traceId };
  }

  // Wave C, task C-B: observability for the Lab's hint-escalation metric.
  // Fire-and-forget from the client on every hint-level reveal — follows
  // the same game_events insert pattern as C4's override logging (see
  // playerMove's `override` branch above). Additive only: no game state
  // changes, and a hint on a since-finished game is harmless to log, so
  // this deliberately does NOT guard on live.finished the way the
  // game-ending actions above do — only on the game existing at all.
  // Wave 0, item 1 (F0): bestUci/refutationUci are both optional -- the
  // caller (server/index.ts's route) includes exactly one, matching what
  // the client actually knows at that hint level. Neither is required by
  // this type because the detail is stored as opaque JSON with no schema;
  // extending it here is additive, not a rename of any existing field.
  logHint(
    gameId: number,
    detail: {
      level: number;
      tier: string;
      deltaCp: number | null;
      bestUci?: string;
      refutationUci?: string;
      // Wave 2 (item 2): the press's branch ("right"/"wrong"), so the Lab can
      // separate right-P2 (opponent threat) from wrong-P2 (best piece) --
      // additive to the opaque detail JSON, same as bestUci/refutationUci.
      branch?: string;
      fen: string;
    }
  ) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false };
    logGameEvent(gameId, "hint", JSON.stringify(detail));
    return { ok: true };
  }
}
