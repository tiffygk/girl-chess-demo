import { Chess, type Color, type Move, type Square } from "chess.js";
import type { Evaluation } from "../engines/types";

// Increment 2.7 (why-hints): every judge call already computes the
// opponent's best refutation of her move (afterEval.bestMove/pv in
// classifyMove) and discards it. That refutation is the "why" — this file
// turns it into structured, provably-true facts by replaying it with
// chess.js, the same defensive pattern classify.ts's deriveFacts uses
// (slice uci, promotion ?? "q", try/catch, null-check). Zero new engine
// calls: afterEval is already-paid-for engine output.
//
// HONESTY GATE (product rule, enforced by construction): every populated
// field on ThreatFacts must be literally true from the chess.js replay
// below. Optional fields stay undefined outside the motif branch that
// derived them — a template reading a field outside its motif would be
// fabricating, not reporting.
export type ThreatMotif = "capture-moved" | "capture-other" | "fork" | "mate-threat" | "check-threat" | "positional";

export interface ThreatFacts {
  motif: ThreatMotif;
  refutationUci: string;
  refutationSan: string;
  refutationPieceKind: string;
  refutationFromSquare: string;
  refutationToSquare: string;
  givesCheck: boolean;
  capturesSquare?: string; // REAL captured square (en passant resolved), only on capture motifs
  capturedPieceKind?: string; // only on capture motifs
  capturesHerJustMovedPiece: boolean;
  forkTargets?: { square: string; pieceKind: string }[]; // only when motif === "fork", length >= 2
}

const MINOR_PLUS = new Set(["n", "b", "r", "q"]);

// Fork detection: chess.js's attackers() is a static map of the CURRENT
// position — it does not model what happens one ply later (an interposition,
// a pin that makes recapture illegal, a defender). So a fork here is a
// shape-claim ("forks") never an outcome-claim ("wins the rook"): the
// template layer must never upgrade "forks your knight and rook" into a
// promise that material is actually won.
function detectFork(probe: Chess, attackerSq: Square, herColor: Color): { square: string; pieceKind: string }[] {
  const oppColor: Color = herColor === "w" ? "b" : "w";
  const targets: { square: string; pieceKind: string }[] = [];
  for (const row of probe.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== herColor) continue;
      if (cell.type === "k") {
        if (probe.inCheck()) targets.push({ square: cell.square, pieceKind: "k" });
        continue;
      }
      if (!MINOR_PLUS.has(cell.type)) continue;
      if (probe.attackers(cell.square as Square, oppColor).includes(attackerSq)) {
        targets.push({ square: cell.square, pieceKind: cell.type });
      }
    }
  }
  return targets;
}

// Shared by deriveThreatFacts and deriveRecommendationFacts below: for an
// en-passant capture, chess.js's mv.to is the empty landing square, not the
// square the captured pawn actually stood on. capturedColor is the CAPTURED
// pawn's own color (not the mover's) — verified against chess.js directly: a
// white pawn's double move e2-e4 is captured en passant landing on rank 3
// with the captured white pawn still on rank 4 (landing+1); a black pawn's
// double move d7-d5 is captured landing on rank 6 with the captured black
// pawn on rank 5 (landing-1).
export function resolveCaptureSquare(mv: Move, capturedColor: Color): string {
  if (!mv.flags.includes("e")) return mv.to;
  return mv.to[0] + String(Number(mv.to[1]) + (capturedColor === "w" ? 1 : -1));
}

// afterFen: position AFTER her move, opponent to move. herToSquare: where
// her piece landed (used to detect the capture-moved motif). afterEval: the
// ALREADY-COMPUTED eval from classifyMove's afterEval — no new engine call.
// Returns undefined on malformed/missing bestMove or replay failure (same
// "facts is just absent" contract as classify.ts's deriveFacts).
export function deriveThreatFacts(
  afterFen: string,
  herToSquare: string,
  herColor: "w" | "b",
  afterEval: Evaluation
): ThreatFacts | undefined {
  const bestUci = afterEval.bestMove;
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(afterFen);
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;

    // Her pawn is the one potentially captured en passant here, so it's her
    // own color that the shared helper needs to resolve the real square.
    const actualCaptureSquare = resolveCaptureSquare(mv, herColor);
    const isCapture = Boolean(mv.captured);
    const capturesHerJustMovedPiece = isCapture && actualCaptureSquare === herToSquare;

    let motif: ThreatMotif;
    if (isCapture && capturesHerJustMovedPiece) {
      motif = "capture-moved";
    } else if (isCapture) {
      motif = "capture-other";
    } else if (detectFork(probe, mv.to as Square, herColor).length >= 2) {
      motif = "fork";
    } else if (probe.isCheckmate() || (afterEval.mate !== null && afterEval.mate > 0)) {
      // Must outrank check-threat below: a mating move also gives check, so
      // checking inCheck() first would misclassify every mate as a mere check.
      motif = "mate-threat";
    } else if (probe.inCheck()) {
      motif = "check-threat";
    } else {
      motif = "positional";
    }

    const facts: ThreatFacts = {
      motif,
      refutationUci: bestUci,
      refutationSan: mv.san,
      refutationPieceKind: piece.type,
      refutationFromSquare: mv.from,
      refutationToSquare: mv.to,
      givesCheck: probe.inCheck(),
      capturesHerJustMovedPiece,
    };

    if (motif === "capture-moved" || motif === "capture-other") {
      facts.capturesSquare = actualCaptureSquare;
      facts.capturedPieceKind = mv.captured;
    }
    if (motif === "fork") {
      facts.forkTargets = detectFork(probe, mv.to as Square, herColor);
    }

    return facts;
  } catch {
    return undefined;
  }
}

// Increment 3a Wave 1 (recommendation facts): the mirror of deriveThreatFacts
// above. Where that function answers "why does her move fail" (the
// opponent's discarded refutation), this answers "why is the RECOMMENDED
// move good" — the hint's own chosen best move, derived the same
// never-fabricate way: replay bestUci with chess.js on a clone of the BEFORE
// position (her position, before she plays) and report only what's
// literally true of that replay. Same HONESTY GATE as ThreatFacts: every
// populated field must be provably true from the replay below; optional
// fields stay undefined outside the accomplishment branch that derived them.
export type RecommendationAccomplishment =
  | "captures"
  | "gives-check"
  | "gives-mate"
  | "forks"
  | "attacks"
  | "develops";

export interface RecommendationFacts {
  accomplishment: RecommendationAccomplishment;
  pieceKind: string; // the recommended piece
  fromSquare: string;
  toSquare: string;
  san: string;
  capturesSquare?: string; // real square (en passant resolved), only on "captures"
  capturedPieceKind?: string; // only on "captures"
  forkTargets?: { square: string; pieceKind: string }[]; // only on "forks", length >= 2
  attackedSquare?: string; // only on "attacks"
  attackedPieceKind?: string; // only on "attacks"
}

// beforeFen: HER position, before her pending move. bestUci: the deep
// search's best move (hint.ts's already-verified chosen move — zero extra
// engine calls here, pure chess.js). Returns undefined on malformed/missing
// bestUci or replay failure, same "facts is just absent" contract as
// deriveThreatFacts and classify.ts's deriveFacts.
export function deriveRecommendationFacts(beforeFen: string, bestUci: string): RecommendationFacts | undefined {
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(beforeFen);
    const moverColor: Color = probe.turn();
    const oppColor: Color = moverColor === "w" ? "b" : "w";
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;

    const facts: RecommendationFacts = {
      accomplishment: "develops",
      pieceKind: piece.type,
      fromSquare: mv.from,
      toSquare: mv.to,
      san: mv.san,
    };

    const isCapture = Boolean(mv.captured);
    if (isCapture) {
      // The captured piece is always the opponent's, so oppColor (not
      // moverColor) is what the shared ep helper needs.
      facts.accomplishment = "captures";
      facts.capturesSquare = resolveCaptureSquare(mv, oppColor);
      facts.capturedPieceKind = mv.captured;
    } else if (probe.isCheckmate()) {
      // Must outrank gives-check below for the same reason as
      // deriveThreatFacts's mate-threat/check-threat ordering: a mating
      // move also gives check.
      facts.accomplishment = "gives-mate";
    } else if (probe.inCheck()) {
      facts.accomplishment = "gives-check";
    } else {
      // Colors inverted from deriveThreatFacts's detectFork call above: there
      // herColor (the target color) was the human player's own color, since
      // the opponent's refutation attacks HER pieces. Here the recommended
      // move is HERS, so the targets are the OPPONENT's pieces — oppColor is
      // the target-color argument detectFork expects. Since we only reach
      // this branch when the earlier checkmate/check checks came back false,
      // detectFork can never smuggle in the king here (it only adds the king
      // target when probe.inCheck() is true).
      const targets = detectFork(probe, mv.to as Square, oppColor);
      if (targets.length >= 2) {
        facts.accomplishment = "forks";
        facts.forkTargets = targets;
      } else if (targets.length === 1) {
        facts.accomplishment = "attacks";
        facts.attackedSquare = targets[0].square;
        facts.attackedPieceKind = targets[0].pieceKind;
      } else {
        facts.accomplishment = "develops";
      }
    }

    return facts;
  } catch {
    return undefined;
  }
}
