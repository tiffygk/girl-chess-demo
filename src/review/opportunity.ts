// Increment 3.95 (Task 4, Part 1): a deterministic, no-LLM classifier for
// "what the better line opens up" — the mirror of server/annotator/
// motifs.ts's deriveRecommendationFacts pattern (chess.js replay, report
// only what's literally true of that replay), but replaying a MULTI-MOVE pv
// instead of a single move, and living client-side since the pv is already
// shipped to the browser on TurningLine.pvSans.
//
// HONESTY GATE: every string this returns must be provably true of the
// chess.js replay below, AND must describe a gain for THE PLAYER, never the
// opponent. The player is always white — every TurningLine's pv is seeded at
// the position where white is to move (server/game/manager.ts's
// getTurningLines comment) and pv[0], pv[2], pv[4]... are always white's own
// moves. A fix (2026-07-21, post-review): the first version of this
// function classified purely from "did a mate/capture happen anywhere in the
// pv", without checking WHICH SIDE the mate/capture favored — it could (and
// did, on adversarial repro lines) tell her a line that mates HER, or one
// where the OPPONENT nets material, "opens up" something good. Every branch
// below now proves the claim is a gain for white specifically before
// returning it; anything it can't prove that way returns undefined or the
// neutral "keeps the initiative" fallback rather than inventing a direction.
import { Chess } from "chess.js";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

// Standard piece values, used ONLY to decide whether white's net material
// swing across the whole pv clears the "wins the {piece}" bar (>= a minor
// piece) — never to compare against an engine eval or invent a magnitude
// claim beyond "the replay shows white ending this many points of material
// ahead."
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// A minor piece (knight/bishop) is the honesty-gate floor for "wins the
// {piece}" — a smaller net (e.g. a lone pawn) stays unclaimed rather than
// risk overstating a marginal edge as a named win.
const MATERIAL_WIN_FLOOR = 3;

/**
 * Replays `pvSans` on top of `fenSeed` — the exact seed position server/
 * game/manager.ts's getTurningLines computed this pv from (same seed-ply
 * convention as src/game/explore.ts's exploreSeedPly: ply - (ply % 2)) —
 * and classifies the resulting opportunity from ONLY what that replay
 * proves is a gain FOR THE PLAYER (white, pv[0]/pv[2]/... — see header),
 * in priority order:
 *   1. the pv ends in checkmate AND black (the opponent) is the side mated
 *      -> "leads to mate in {N}" (N = white's own move count, ceil(playedPlies / 2)).
 *      A pv ending in white being mated is unconditionally rejected — no
 *      claim of any kind, regardless of material along the way.
 *   2. white's NET material swing across the WHOLE pv (captured-piece value
 *      summed by capturing color, so a later recapture or zwischenzug
 *      several plies on is netted out correctly, not just an immediate
 *      one-ply lookahead) is at least a minor piece (>= 3) -> "wins the
 *      {pieceKind}" naming the single largest piece white captured.
 *   3. (only once neither of the above fires, and white's net material
 *      isn't negative — never dress up a line that costs the player
 *      material as an opportunity) a file that had a pawn before the pv and
 *      has none after -> "opens the {file} file"
 *   4. the honest neutral fallback: "keeps the initiative" — only reached
 *      when white's net material is >= 0 (never claimed after a proven
 *      player material loss)
 *
 * Returns undefined when pvSans is empty, fenSeed is unparseable, not even
 * the first pv move replays legally, white is the one checkmated, or white's
 * net material across the pv is negative — nothing provably good for the
 * player, never a guess.
 */
export function deriveOpportunity(fenSeed: string, pvSans: string[]): string | undefined {
  if (pvSans.length === 0) return undefined;

  let chess: Chess;
  try {
    chess = new Chess(fenSeed);
  } catch {
    return undefined;
  }

  const filesBefore = pawnFiles(chess);

  const played: { captured?: string }[] = [];
  for (const san of pvSans) {
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      mv = null;
    }
    if (!mv) break;
    played.push({ captured: mv.captured });
  }
  if (played.length === 0) return undefined;

  if (chess.isCheckmate()) {
    // chess.js's turn() after the mating move is the side that is now
    // stuck in checkmate — 'b' means black (the opponent) was mated, a
    // genuine win for the player; 'w' means the PLAYER was just mated, which
    // is never a claim of any kind, however the material along the way
    // looked.
    if (chess.turn() === "b") {
      return `leads to mate in ${Math.ceil(played.length / 2)}`;
    }
    return undefined;
  }

  // Net material swing for white across the ENTIRE pv. played[i] is white's
  // own move when i is even (pv[0] is always white's move — see header),
  // black's when i is odd. Summing over the whole line (rather than only
  // checking one ply of lookahead for an "immediate recapture") is what
  // correctly nets out a later recapture or a zwischenzug several plies on.
  let whiteGain = 0;
  let blackGain = 0;
  let biggestWhiteCapture: string | undefined;
  let biggestWhiteValue = 0;
  played.forEach((mv, i) => {
    if (!mv.captured) return;
    const value = PIECE_VALUES[mv.captured] ?? 0;
    if (i % 2 === 0) {
      whiteGain += value;
      if (value > biggestWhiteValue) {
        biggestWhiteValue = value;
        biggestWhiteCapture = mv.captured;
      }
    } else {
      blackGain += value;
    }
  });
  const netForWhite = whiteGain - blackGain;

  if (netForWhite >= MATERIAL_WIN_FLOOR && biggestWhiteCapture) {
    const pieceName = PIECE_NAMES[biggestWhiteCapture];
    if (pieceName) return `wins the ${pieceName}`;
  }

  // A pv that costs the player net material is never dressed up as an
  // opportunity — not as a file-opening, not as "keeps the initiative".
  if (netForWhite < 0) return undefined;

  const filesAfter = pawnFiles(chess);
  for (const file of "abcdefgh") {
    if (filesBefore.has(file) && !filesAfter.has(file)) {
      return `opens the ${file} file`;
    }
  }

  return "keeps the initiative";
}

function pawnFiles(chess: Chess): Set<string> {
  const files = new Set<string>();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "p") files.add(cell.square[0]);
    }
  }
  return files;
}
