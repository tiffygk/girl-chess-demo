import { Chess, type Color, type Square } from "chess.js";
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

    // En-passant trap: for an ep refutation, mv.to is the empty landing
    // square, not the square the captured pawn actually stood on. Resolve
    // the REAL captured-pawn square before comparing against herToSquare.
    // Her pawn double-moved two ranks; the captured pawn sits one rank
    // BEHIND it from the landing square's perspective. A white pawn's
    // double move e2-e4 is captured en passant by ...dxe3, landing on
    // rank 3 with the captured white pawn still on rank 4 (landing+1); a
    // black pawn's double move d7-d5 is captured by exd6, landing on
    // rank 6 with the captured black pawn on rank 5 (landing-1) — verified
    // against chess.js directly (spec draft had this sign inverted).
    const epCaptured = mv.flags.includes("e");
    const actualCaptureSquare = epCaptured
      ? mv.to[0] + String(Number(mv.to[1]) + (herColor === "w" ? 1 : -1))
      : mv.to;
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
