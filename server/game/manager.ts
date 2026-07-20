import { Chess } from "chess.js";
import { MaiaOpponent } from "../engines/maia";
import { StockfishEvaluator } from "../engines/stockfish";
import {
  createGame, finishGame, recordMove, attachEval, logGameEvent, insertVerdict, getVerdicts,
  getGameMoves, getGame, insertTurningPoints, getTurningPoints, setMoveClassification,
  listFinishedGames, getMoveEvalsByPlies,
} from "../store/db";
import { classifyMove, DEFAULT_ADVICE_LEVEL } from "../annotator/classify";
import { adjudicatePosition } from "../annotator/adjudicate";
import { computeHint as computeHintFacts, type HintFacts } from "../annotator/hint";
import { moveEndpoints } from "../annotator/moveEndpoints";
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
import { claudeCliBackend } from "../coach/backends/claude-cli";
import { ollamaBackend } from "../coach/backends/ollama";
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

export class GameManager {
  private games = new Map<number, LiveGame>();
  private evaluator = new StockfishEvaluator();
  private opponents = new Map<number, MaiaOpponent>();
  // Probed once, cached, per the brief's "claude-cli if available else
  // ollama if available else template-only" selection — narrate() below
  // never re-probes on every call.
  private coachBackend: CoachBackend | null = null;

  async init() { await this.evaluator.init(); }

  private async pickCoachBackend(): Promise<CoachBackend> {
    if (this.coachBackend) return this.coachBackend;
    if (await claudeCliBackend.available()) this.coachBackend = claudeCliBackend;
    else if (await ollamaBackend.available()) this.coachBackend = ollamaBackend;
    else this.coachBackend = noBackend;
    return this.coachBackend;
  }

  // Test seam only: lets manager.test.ts inject a FAKE backend so tests
  // never probe or invoke the real claude CLI / ollama (brief: "do NOT
  // invoke the real claude CLI in tests"). Unused in production —
  // pickCoachBackend's probe-and-cache runs unless a test has already
  // primed this.
  setCoachBackendForTesting(backend: CoachBackend) {
    this.coachBackend = backend;
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
      const moves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate }));
      const turningPoints = computeTurningPoints(moves, result);
      insertTurningPoints(
        gameId,
        turningPoints.map((t) => ({
          rank: t.rank, ply: t.ply, san: t.san, label: t.label,
          punishSan: t.punishSan ?? null, deltaP: t.deltaP, lowConfidence: t.lowConfidence, kind: t.kind,
          plyEnd: t.plyEnd ?? null, missedPunish: t.missedPunish ?? false,
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
    moves: { ply: number; san: string }[];
  } {
    let persisted = getTurningPoints(gameId);
    const rows = getGameMoves(gameId);
    const moves = rows.map((r: any) => ({ ply: r.ply, san: r.san }));

    const persistedVersion = persisted.length > 0 ? (persisted[0].algo_version ?? 1) : TP_ALGO_VERSION;
    if (persisted.length > 0 && persistedVersion < TP_ALGO_VERSION) {
      const evalMoves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate }));
      const game = getGame(gameId);
      const healed = computeTurningPoints(evalMoves, game?.result ?? "");
      insertTurningPoints(
        gameId,
        healed.map((t) => ({
          rank: t.rank, ply: t.ply, san: t.san, label: t.label,
          punishSan: t.punishSan ?? null, deltaP: t.deltaP, lowConfidence: t.lowConfidence, kind: t.kind,
          plyEnd: t.plyEnd ?? null, missedPunish: t.missedPunish ?? false,
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
        })),
        classifications: rows
          .filter((m: any) => m.classification)
          .map((m: any) => ({ ply: m.ply, classification: m.classification })),
        moves,
      };
    }

    // Compute-on-read fallback (old games with no persisted rows at all —
    // evals hadn't attached at persist time; nothing to heal here since
    // there's no prior row set to be stale).
    const evalMoves = rows.map((r: any) => ({ ply: r.ply, san: r.san, evalCp: r.eval_cp, evalMate: r.eval_mate }));
    const game = getGame(gameId);
    return {
      ok: true,
      turningPoints: computeTurningPoints(evalMoves, game?.result ?? ""),
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
      const evals = getMoveEvalsByPlies(gameId, turningPoints.map((t) => t.ply));
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
        const { pvSans, bestSan, bestFromTo } = this.pvLine(fenBefore, evalByPly.get(t.ply));
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
  async judgeMove(gameId: number, from: string, to: string, promotion?: string, mode?: string) {
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
    const verdict = await classifyMove(clone, mv, this.evaluator);
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
      adviceLevel: DEFAULT_ADVICE_LEVEL,
      mode,
      factsJson: verdict.threat ? JSON.stringify(verdict.threat) : null,
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
      threat?: ThreatFacts;
      best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
      recommendation?: RecommendationFacts;
    }
  ): Promise<{ ok: false } | { ok: true; text: string; source: "model" | "template" }> {
    const live = this.games.get(gameId);
    if (!live || live.finished) return { ok: false };

    const backend = await this.pickCoachBackend();
    const facts = assembleFactList({
      herMove: { pieceKind: body.herPiece, from: body.from, to: body.to },
      tier: body.tier,
      deltaCp: body.deltaCp,
      threat: body.threat,
      best: body.best,
      recommendation: body.recommendation,
    });
    const result = await narrateFacts(facts, backend, { gameId, ply: live.ply, kind: body.tier });
    return { ok: true, text: result.text, source: result.source };
  }

  // Wave C, task C-B: observability for the Lab's hint-escalation metric.
  // Fire-and-forget from the client on every hint-level reveal — follows
  // the same game_events insert pattern as C4's override logging (see
  // playerMove's `override` branch above). Additive only: no game state
  // changes, and a hint on a since-finished game is harmless to log, so
  // this deliberately does NOT guard on live.finished the way the
  // game-ending actions above do — only on the game existing at all.
  logHint(gameId: number, detail: { level: number; tier: string; deltaCp: number | null; bestUci: string; fen: string }) {
    const live = this.games.get(gameId);
    if (!live) return { ok: false };
    logGameEvent(gameId, "hint", JSON.stringify(detail));
    return { ok: true };
  }
}
