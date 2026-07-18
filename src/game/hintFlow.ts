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
  bestUci: string;
}

/**
 * Lowercase plain-language translation of the best move, derived by replaying
 * bestUci on the live fen (never by parsing SAN - a parse miss could render a
 * false claim). Returns null when the replay fails; callers then show SAN alone.
 */
export function describeBestMove(facts: HintFacts, fen: string): string | null {
  let probe: Chess;
  try {
    probe = new Chess(fen);
  } catch {
    return null;
  }
  let mv;
  try {
    mv = probe.move({
      from: facts.bestUci.slice(0, 2),
      to: facts.bestUci.slice(2, 4),
      promotion: (facts.bestUci[4] as "q" | "r" | "b" | "n" | undefined) ?? "q",
    });
  } catch {
    return null;
  }
  if (!mv) return null;
  const suffix = probe.isCheckmate() ? ", checkmate" : probe.isCheck() ? ", check" : "";
  if (mv.flags.includes("k")) return `castle short${suffix}`;
  if (mv.flags.includes("q")) return `castle long${suffix}`;
  const isCapture = mv.flags.includes("c") || mv.flags.includes("e");
  let phrase = `${pieceName(facts.bestPieceKind)} ${isCapture ? "takes on" : "to"} ${mv.to}`;
  if (mv.flags.includes("p") && mv.promotion) phrase += `, becoming a ${pieceName(mv.promotion)}`;
  return `${phrase}${suffix}`;
}

/**
 * Template-only copy for the current hint level — lowercase, no em-dashes,
 * no emojis, per the round's copy rules. Returns null at level 0 (nothing
 * to show yet beyond the "help?" affordance itself). `fen`, when given,
 * lets level 3 append a plain-language translation of the best move
 * (derived by replay, see describeBestMove) alongside the SAN.
 */
export function hintCopy(level: HintLevel, facts: HintFacts, fen?: string): string | null {
  if (level <= 0) return null;
  if (level === 1) return `look at your ${pieceName(facts.bestPieceKind)}`;
  // Level 2 names the origin square, not the destination: the destination of
  // a capture/quiet move she isn't seeing reads as an unreachable square
  // (owner playtest 2026-07-17); her own piece's square is always findable.
  if (level === 2) return `your ${pieceName(facts.bestPieceKind)} on ${facts.bestFromSquare}`;
  const translation = fen ? describeBestMove(facts, fen) : null;
  return translation ? `best here: ${facts.bestSan} (${translation})` : `best here: ${facts.bestSan}`;
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
