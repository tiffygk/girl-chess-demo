// Forward-prediction round (2026-07-28): the deterministic, side-aware
// continuation claim for one ply's persisted engine line. Server sibling of
// src/review/opportunity.ts's deriveOpportunity (the client render-site twin
// -- same replay-and-prove discipline, same honesty gates; the two files
// name each other and must not drift in spirit). It differs in exactly two
// ways, both forced by where it sits: (1) perPlyAnalysis seeds ALTERNATE
// colors -- an odd ply's fenBefore has the player (white) to move, an even
// ply's has mallow -- so every claim here is side-aware and phrased
// player-relative ("you win the rook" / "she wins the rook" / "leads to
// mate for you in 2"), where opportunity.ts is white-seeded only; (2) a
// line that mates the PLAYER is reported honestly ("leads to mate against
// you in N") rather than suppressed -- on a per-ply fact, "her line mates
// you" is exactly the warning the coach needs to explain a bad moment,
// where opportunity.ts's render site only ever advertises upside.
//
// HONESTY GATE (same as opportunity.ts): every string returned must be
// provably true of the chess.js replay below. Anything unprovable returns
// undefined -- never a guess, never a vague filler claim. chess.js only, no
// engine call, no LLM -- this is an annotator-path module and stays
// deterministic.
import { Chess } from "chess.js";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

// Standard piece values, used ONLY to decide whether the net material swing
// across the whole line clears a claim floor -- never to state a number.
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const MATERIAL_WIN_FLOOR = 3; // a minor piece: the floor for naming the piece
const PAWN_GAIN_FLOOR = 1;

function pawnFiles(chess: Chess): Set<string> {
  const files = new Set<string>();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "p") files.add(cell.square[0]);
    }
  }
  return files;
}

/**
 * Replays pvSans from fenSeed and returns one plain-language claim about
 * where the line provably lands, or undefined. Priority order:
 *   1. mate -- "leads to mate for you in N" / "leads to mate against you in
 *      N", N counted in the MATING side's own moves within the line.
 *   2. net material for white >= a minor piece -> "you win the {piece}"
 *      (biggest piece white captured); >= a pawn -> "you win a pawn".
 *   3. net material for black >= a minor piece -> "she wins the {piece}";
 *      >= a pawn -> "she wins a pawn". (Player is always white in v1 --
 *      the same fixed mapping chat.ts's derivePositionFacts documents.)
 *   4. only for a WHITE-seeded line (the player's own choosing position),
 *      matching opportunity.ts exactly: a checking first move plus minor
 *      development -> "develops with the initiative"; a file whose pawns
 *      vanish -> "opens the {file} file". Suppressed for black seeds: those
 *      weaker claims have no clean side-aware reading.
 * A malformed tail truncates to the replayable prefix; an empty prefix,
 * empty pv, or unparseable fen returns undefined.
 */
export function deriveContinuation(fenSeed: string, pvSans: string[]): string | undefined {
  if (pvSans.length === 0) return undefined;

  let chess: Chess;
  try {
    chess = new Chess(fenSeed);
  } catch {
    return undefined;
  }
  const seedWhiteToMove = chess.turn() === "w";
  const filesBefore = pawnFiles(chess);

  const played: {
    captured?: string;
    piece: string;
    flags: string;
    checkAfter: boolean;
    moverIsWhite: boolean;
  }[] = [];
  for (const san of pvSans) {
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      mv = null;
    }
    if (!mv) break;
    played.push({
      captured: mv.captured,
      piece: mv.piece,
      flags: mv.flags,
      checkAfter: chess.inCheck(),
      moverIsWhite: mv.color === "w",
    });
  }
  if (played.length === 0) return undefined;

  if (chess.isCheckmate()) {
    // turn() after the mating move is the side now stuck in checkmate.
    const blackIsMated = chess.turn() === "b";
    const matingSideMoves = played.filter((mv) => mv.moverIsWhite === blackIsMated).length;
    return blackIsMated
      ? `leads to mate for you in ${matingSideMoves}`
      : `leads to mate against you in ${matingSideMoves}`;
  }

  // Net material for white across the ENTIRE line -- a later recapture or
  // zwischenzug several plies on is netted out correctly, same whole-line
  // accounting opportunity.ts uses.
  let netForWhite = 0;
  let biggestWhiteCapture: string | undefined;
  let biggestWhiteValue = 0;
  let biggestBlackCapture: string | undefined;
  let biggestBlackValue = 0;
  for (const mv of played) {
    if (!mv.captured) continue;
    const value = PIECE_VALUES[mv.captured] ?? 0;
    if (mv.moverIsWhite) {
      netForWhite += value;
      if (value > biggestWhiteValue) {
        biggestWhiteValue = value;
        biggestWhiteCapture = mv.captured;
      }
    } else {
      netForWhite -= value;
      if (value > biggestBlackValue) {
        biggestBlackValue = value;
        biggestBlackCapture = mv.captured;
      }
    }
  }

  if (netForWhite >= MATERIAL_WIN_FLOOR && biggestWhiteCapture && PIECE_NAMES[biggestWhiteCapture]) {
    return `you win the ${PIECE_NAMES[biggestWhiteCapture]}`;
  }
  if (netForWhite >= PAWN_GAIN_FLOOR) return "you win a pawn";
  if (netForWhite <= -MATERIAL_WIN_FLOOR && biggestBlackCapture && PIECE_NAMES[biggestBlackCapture]) {
    return `she wins the ${PIECE_NAMES[biggestBlackCapture]}`;
  }
  if (netForWhite <= -PAWN_GAIN_FLOOR) return "she wins a pawn";

  // The two weaker claims exist only for the player's own choosing position
  // (white to move at the seed), byte-matching opportunity.ts's semantics.
  if (!seedWhiteToMove) return undefined;

  const firstMoveGivesCheck = played[0]?.checkAfter === true;
  const hasWhiteDevelopment = played.some(
    (mv) =>
      mv.moverIsWhite && (mv.piece === "n" || mv.piece === "b" || mv.flags.includes("k") || mv.flags.includes("q"))
  );
  if (firstMoveGivesCheck && hasWhiteDevelopment) return "develops with the initiative";

  const filesAfter = pawnFiles(chess);
  for (const file of "abcdefgh") {
    if (filesBefore.has(file) && !filesAfter.has(file)) return `opens the ${file} file`;
  }

  return undefined;
}
