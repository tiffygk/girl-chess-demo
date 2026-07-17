import { Chess } from "chess.js";
import { MaiaOpponent } from "../engines/maia";
import { StockfishEvaluator } from "../engines/stockfish";
import { createGame, finishGame, recordMove, attachEval, logGameEvent, insertVerdict } from "../store/db";
import { classifyMove, DEFAULT_ADVICE_LEVEL } from "../annotator/classify";
import { adjudicatePosition } from "../annotator/adjudicate";
import { computeHint as computeHintFacts, type HintFacts } from "../annotator/hint";

interface LiveGame { chess: Chess; opponent: MaiaOpponent; ply: number; finished: boolean }

// Playtest-calibrated draw-acceptance band: the computer accepts an offer
// when the position is within this many centipawns of dead equal. Starting
// value only — expect this to move once real playtest data comes in.
const DRAW_ACCEPT_CP_BAND = 60;

export class GameManager {
  private games = new Map<number, LiveGame>();
  private evaluator = new StockfishEvaluator();
  private opponents = new Map<number, MaiaOpponent>();

  async init() { await this.evaluator.init(); }

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

  private gameOver(chess: Chess): { result: string } | undefined {
    if (!chess.isGameOver()) return undefined;
    if (chess.isCheckmate()) return { result: chess.turn() === "w" ? "0-1" : "1-0" };
    return { result: "1/2-1/2" };
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
      return { ok: true, fen: live.chess.fen(), playerSan: mv.san, playerCapture, gameOver: over };
    }

    const replyUci = await live.opponent.pickMove(live.chess.fen());
    const reply = live.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: (replyUci[4] as any) ?? undefined });
    const replyCapture = reply.flags.includes("c") || reply.flags.includes("e");
    this.record(gameId, live, reply.san, replyUci, 0);

    over = this.gameOver(live.chess);
    if (over) { finishGame(gameId, over.result); live.finished = true; }
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
