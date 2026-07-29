// Missed-win round (2026-07-28): the phase taggers called the owner's real
// game-150 finish (queen + two bishops vs a LONE KING, 17 pieces total)
// "middlegame" to the last ply, because both existing rules key on counts
// that never trip when the winning side keeps everything. The honest board
// fact both games share: a side reduced to at most ENDGAME_BARE_PIECE_MAX
// non-pawn, non-king pieces is an endgame, whatever the other side owns.
// Pure chess.js replay — no eval, no engine, no LLM.
import { Chess } from "chess.js";
import type { SummaryMove } from "../game/api";

// Owner-calibratable. 1 covers both real cases from 2026-07-28: game 150
// (black fully bare from ply 47) and game 149 (black down to one bishop
// from ply 64, the ply before her missed Be6#).
export const ENDGAME_BARE_PIECE_MAX = 1;

function boardNearlyBare(chess: Chess): boolean {
  const pieces = chess.board().flat().filter((p) => p != null);
  const count = (color: "w" | "b") =>
    pieces.filter((p) => p!.color === color && p!.type !== "k" && p!.type !== "p").length;
  return Math.min(count("w"), count("b")) <= ENDGAME_BARE_PIECE_MAX;
}

export function sideNearlyBare(fen: string): boolean {
  try {
    return boardNearlyBare(new Chess(fen));
  } catch {
    return false; // unparseable fen: never guess a phase claim
  }
}

// One replay pass over the whole game (promotions handled naturally — a
// bare side that promotes stops being bare). Returns the set of plies at
// whose position-after the rule holds. Unreplayable input degrades to
// whatever was flagged before the bad san — never a fabricated phase.
export function nearlyBarePlies(gameSans: SummaryMove[] | undefined): Set<number> {
  const out = new Set<number>();
  if (!gameSans) return out;
  const chess = new Chess();
  for (const m of [...gameSans].sort((a, b) => a.ply - b.ply)) {
    try {
      chess.move(m.san);
    } catch {
      return out;
    }
    if (boardNearlyBare(chess)) out.add(m.ply);
  }
  return out;
}
