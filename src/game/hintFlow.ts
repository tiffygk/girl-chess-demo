// Wave C, task C-B: pure decision table for the deterministic hint
// escalation ladder. Kept as its own pure module (rather than inlined in
// GamePage) for the same reason moveFlow.ts is: a one-glance spec, unit
// testable without touching React state or the network.
//
// Level 0 = nothing revealed yet (only the "help?" affordance shows).
// Level 1 = "look at your {piece name}"
// Level 2 = "your {piece} on {from}"
// Level 3 = "best here: {san}" + the board highlights the best move's
//           from/to squares (GamePage derives those from facts.bestUci —
//           see hintRevealSquares in GamePage.tsx).
import { Chess } from "chess.js";

export type HintLevel = 0 | 1 | 2 | 3;

const MAX_HINT_LEVEL: HintLevel = 3;

/** Advances the ladder by one step, capped at the top (level 3). */
export function nextHintLevel(level: HintLevel): HintLevel {
  return level >= MAX_HINT_LEVEL ? MAX_HINT_LEVEL : ((level + 1) as HintLevel);
}

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Spells out a chess.js piece-kind letter ("n") as a word ("knight"). */
export function pieceName(kind: string): string {
  return PIECE_NAMES[kind] ?? "piece";
}

export interface HintFacts {
  bestPieceKind: string;
  bestFromSquare: string;
  bestToSquare: string;
  bestSan: string;
}

/**
 * Template-only copy for the current hint level — lowercase, no em-dashes,
 * no emojis, per the round's copy rules. Returns null at level 0 (nothing
 * to show yet beyond the "help?" affordance itself).
 */
export function hintCopy(level: HintLevel, facts: HintFacts): string | null {
  if (level <= 0) return null;
  if (level === 1) return `look at your ${pieceName(facts.bestPieceKind)}`;
  // Level 2 names the origin square, not the destination: the destination of
  // a capture/quiet move she isn't seeing reads as an unreachable square
  // (owner playtest 2026-07-17); her own piece's square is always findable.
  if (level === 2) return `your ${pieceName(facts.bestPieceKind)} on ${facts.bestFromSquare}`;
  return `best here: ${facts.bestSan}`;
}

/** Splits a UCI move ("g1f3") into its from/to squares for the board's
 * level-3 highlight. Deliberately doesn't validate — bestUci already came
 * from a legal chess.js replay in classify.ts's deriveFacts. Belt-and-
 * suspenders re-validation against the live client position lives in
 * hintIsLegal below. */
export function hintRevealSquares(bestUci: string): { from: string; to: string } {
  return { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) };
}

/**
 * Belt-and-suspenders legality re-check against the live client position.
 * The server derives facts from a legal chess.js replay, but hintRevealSquares
 * trusts its input unconditionally — if a stale or cross-game hint ever slips
 * through the token guards, this stops it from rendering as an impossible
 * square (the exact playtest complaint) and lets the caller log it instead.
 */
export function hintIsLegal(fen: string, bestUci: string): boolean {
  if (!bestUci || bestUci.length < 4) return false;
  try {
    const probe = new Chess(fen);
    const mv = probe.move({
      from: bestUci.slice(0, 2),
      to: bestUci.slice(2, 4),
      promotion: (bestUci[4] as "q" | undefined) ?? "q",
    });
    return Boolean(mv);
  } catch {
    return false;
  }
}
