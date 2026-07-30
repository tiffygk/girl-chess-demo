// tools/rca-eval/lib/engineLabel.ts
//
// Dispatch 4 (RCA acceptance-evals round, "engine-grade labels for mined
// fork fixtures"). forcedLoss.ts's SEE-on-destination-square verifier has a
// proven horizon limit: it only resolves the recapture chain on the ONE
// square a capturing reply lands on, so it can never see a QUIET
// counter-threat defense a few plies deeper (the "h3 bishop-kick" class --
// a non-capturing move that defuses a fork before any capture happens at
// all). This module asks the app's own Stockfish instead, which has no such
// blind spot: its search sees every reply, capturing or not, to whatever
// depth `movetimeMs` buys it.
//
// Operationalization (exact, so "forced" is a computed label here too, not
// an opinion): evaluate the fen once, at the engine's normal single-PV depth
// (movetime ~800ms -- MultiPV is not needed here, because a single evaluate()
// call already returns the SEARCH's own best-move evaluation, which already
// accounts for every one of the opponent's replies the engine considered,
// not just the immediate one; MultiPV is for comparing several candidate
// moves against each other, and there is only one question being asked
// here: "is the engine's own best line still bad?"). Convert the board's
// material balance (in pawns, same convention and same materialBalance()
// function as forcedLoss.ts, from the SIDE-TO-MOVE's perspective) to
// centipawns at PAWN_CP each, and compare it against the engine's own
// best-move evaluation (also from the side-to-move's perspective -- UCI's
// own convention, confirmed against this repo's existing sign handling in
// server/annotator/hint.ts/classify.ts, which negate exactly when crossing
// a ply boundary and never otherwise). The material count is what an
// even, no-further-tactics position would evaluate to; if the engine's own
// best move still comes in at least ENGINE_FORCED_LOSS_THRESHOLD_CP
// centipawns BELOW that, the position is judged a genuine forced material
// loss even the engine's own strongest line cannot escape --
// forcedLossConfirmed = true. A forced mate FOR the side to move saturates
// bestMoveEvalCp to a large positive value (never flagged); a forced mate
// AGAINST saturates it large negative (always flagged, regardless of
// material on the board -- getting mated is the maximal forced loss).
import { Chess } from "chess.js";
import type { Evaluator, Evaluation } from "../../../server/engines/types";
import { materialBalance } from "./forcedLoss";

// The engine-grade forced-loss threshold, in centipawns. ~150cp is roughly
// 1.5 pawns -- comfortably above search noise/engine-to-engine variance at
// an 800ms movetime, and comfortably below "lost a whole minor piece"
// (~300cp), so it catches real material bleeding without false-flagging a
// merely slightly-worse-than-material engine read.
export const ENGINE_FORCED_LOSS_THRESHOLD_CP = 150;

// Default engine think time for a label. ~800ms per the dispatch -- long
// enough for a real search to find a deeper defense/threat than SEE's
// one-square horizon, short enough that labeling six fixtures stays a
// matter of seconds, not minutes.
export const ENGINE_MOVETIME_MS = 800;

// Centipawn value of one pawn of material, for putting forcedLoss.ts's
// pawns-denominated materialBalance() on the same scale as a UCI cp score.
export const PAWN_CP = 100;

// A forced mate saturates to this cp magnitude (sign per whether the mate
// is FOR or AGAINST the side to move) so the same subtraction arithmetic
// used for a plain cp score stays well-defined for a mate score too,
// without a separate branch at every call site.
const MATE_SATURATION_CP = 10_000;

export interface EngineLabel {
  fen: string;
  sideToMove: "w" | "b";
  // Pawns, from the side-to-move's perspective (forcedLoss.ts's own
  // materialBalance() convention -- both verifiers must agree on what
  // "baseline material" means for their two numbers to be comparable).
  materialBalance: number;
  bestMove: string; // uci, from the engine's own search
  // The engine's own evaluation once it has played (and searched past) its
  // best move, from the side-to-move's perspective, in centipawns. A raw
  // mate score is folded to +/-MATE_SATURATION_CP (see module comment).
  bestMoveEvalCp: number;
  mate: number | null; // the engine's raw mate distance, if any (unfolded)
  // materialBalance*PAWN_CP - bestMoveEvalCp -- how far short of "the board's
  // material count" the engine's own best line falls. Positive = the engine
  // sees the position as WORSE than material alone implies.
  impliedLossCp: number;
  // True iff impliedLossCp >= ENGINE_FORCED_LOSS_THRESHOLD_CP -- see the
  // module comment for the exact operationalization.
  forcedLossConfirmed: boolean;
}

// Pure, synchronous, no engine spawned -- the threshold arithmetic in
// isolation, given a fen and an already-produced (real or stub) Evaluation.
export function labelFromEvaluation(fen: string, evaluation: Evaluation): EngineLabel {
  const chess = new Chess(fen);
  const sideToMove = chess.turn();
  const balance = materialBalance(chess, sideToMove);
  const bestMoveEvalCp = evaluation.mate !== null ? (evaluation.mate > 0 ? MATE_SATURATION_CP : -MATE_SATURATION_CP) : (evaluation.cp ?? 0);
  const impliedLossCp = balance * PAWN_CP - bestMoveEvalCp;
  return {
    fen,
    sideToMove,
    materialBalance: balance,
    bestMove: evaluation.bestMove,
    bestMoveEvalCp,
    mate: evaluation.mate,
    impliedLossCp,
    forcedLossConfirmed: impliedLossCp >= ENGINE_FORCED_LOSS_THRESHOLD_CP,
  };
}

// The real entry point: runs the app's own Evaluator (StockfishEvaluator in
// production; any Evaluator implementer in a test double) against `fen` and
// labels the result. Caller owns the evaluator's lifecycle (init()/quit()) --
// this function only ever calls evaluate(), the same single-PV call every
// other engine consumer in this repo uses for a plain "what's the best move
// here" question.
export async function engineLabelForFen(fen: string, evaluator: Evaluator, movetimeMs: number = ENGINE_MOVETIME_MS): Promise<EngineLabel> {
  const evaluation = await evaluator.evaluate(fen, movetimeMs);
  return labelFromEvaluation(fen, evaluation);
}
