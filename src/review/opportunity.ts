// Increment 3.95 (Task 4, Part 1): a deterministic, no-LLM classifier for
// "what the better line opens up" — the mirror of server/annotator/
// motifs.ts's deriveRecommendationFacts pattern (chess.js replay, report
// only what's literally true of that replay), but replaying a MULTI-MOVE pv
// instead of a single move, and living client-side since the pv is already
// shipped to the browser on TurningLine.pvSans.
//
// HONESTY GATE: every string this returns must be provably true of the
// chess.js replay below. Nothing here is a guess or an engine-flavor
// inference beyond "what actually happened when these exact SAN moves are
// played out." A pv that doesn't support any of the three named claims falls
// through to the plain "keeps the initiative" fallback rather than inventing
// one — same declared-cut discipline turningPointNote.ts's GENERIC_TIP uses.
import { Chess } from "chess.js";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

/**
 * Replays `pvSans` on top of `fenSeed` — the exact seed position server/
 * game/manager.ts's getTurningLines computed this pv from (same seed-ply
 * convention as src/game/explore.ts's exploreSeedPly: ply - (ply % 2)) —
 * and classifies the resulting opportunity from ONLY what that replay
 * proves, in priority order:
 *   1. the pv ends in checkmate -> "leads to mate in {N}" (N = the number
 *      of the pv's own side's moves it took, ceil(playedPlies / 2))
 *   2. the pv's first capture that is NOT immediately recaptured on the
 *      same square -> "wins the {pieceKind}" (an immediately-recaptured
 *      capture is an even trade, not a material win, and claiming one would
 *      break the honesty gate)
 *   3. a file that had a pawn (either color) before the pv and has none
 *      after it -> "opens the {file} file"
 *   4. the honest fallback: "keeps the initiative"
 *
 * Returns undefined when pvSans is empty, fenSeed is unparseable, or not
 * even the first pv move replays legally (nothing provable yet) — never a
 * guess.
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

  const played: { to: string; captured?: string }[] = [];
  for (const san of pvSans) {
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      mv = null;
    }
    if (!mv) break;
    played.push({ to: mv.to, captured: mv.captured });
  }
  if (played.length === 0) return undefined;

  if (chess.isCheckmate()) {
    return `leads to mate in ${Math.ceil(played.length / 2)}`;
  }

  // A while-loop with a manual index (not for..of/i++) so a detected
  // recapture pair advances past BOTH moves — advancing past only the first
  // would leave the second (the recapturing move, itself a capture with no
  // move after it to immediately answer) misread as an un-recaptured win.
  let i = 0;
  while (i < played.length) {
    const mv = played[i];
    if (!mv.captured) {
      i++;
      continue;
    }
    const next = played[i + 1];
    const immediatelyRecaptured = Boolean(next?.captured) && next?.to === mv.to;
    if (immediatelyRecaptured) {
      i += 2;
      continue;
    }
    const pieceName = PIECE_NAMES[mv.captured];
    if (pieceName) return `wins the ${pieceName}`;
    i++;
  }

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
