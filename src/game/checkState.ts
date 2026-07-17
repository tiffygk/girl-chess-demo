import type { Chess } from "chess.js";

/**
 * Returns the square of the king belonging to the side to move, if that
 * king is currently in check (including checkmate, which is still "in
 * check" as far as chess.js and the board ring are concerned). Returns
 * null when nobody is in check.
 */
export function kingInCheckSquare(chess: Chess): string | null {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === turn) return cell.square;
    }
  }
  return null;
}
