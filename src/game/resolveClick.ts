import { Chess, type Square } from "chess.js";

export type ClickMoveResult = { from: string; to: string } | "reselect" | null;

/**
 * Resolves a second click (after a piece is already selected) into either a
 * move to submit, a re-selection of a different own piece, or null when the
 * selected square turns out to hold nothing (defensive — shouldn't happen in
 * practice since selection only ever comes from clicking a real piece).
 *
 * Castle-by-rook-click: when the selected piece is the king and the clicked
 * square holds the player's own rook, this translates the click into the
 * castling move (king two squares toward that rook) *if* castling is
 * currently legal. If not (rook has moved, king has moved, path blocked,
 * king passes through/into check, etc.) the click is treated as reselecting
 * the rook instead — same as clicking any other own piece.
 *
 * Pure: takes a chess.js instance representing the current position and
 * never mutates it (castling legality is probed on a throwaway clone).
 */
export function resolveClickMove(
  chess: Chess,
  selectedSquare: string,
  clickedSquare: string
): ClickMoveResult {
  const selected = chess.get(selectedSquare as Square);
  if (!selected) return null;

  const clicked = chess.get(clickedSquare as Square);

  if (clicked && clicked.color === selected.color) {
    if (selected.type === "k" && clicked.type === "r") {
      const kingFile = selectedSquare.charCodeAt(0);
      const rookFile = clickedSquare.charCodeAt(0);
      const rank = selectedSquare[1];
      const targetFile = rookFile > kingFile ? kingFile + 2 : kingFile - 2;
      const target = String.fromCharCode(targetFile) + rank;

      const probe = new Chess(chess.fen());
      try {
        const mv = probe.move({ from: selectedSquare, to: target });
        if (mv) return { from: selectedSquare, to: target };
      } catch {
        // illegal castle (blocked, moved, through/into check) — fall through
      }
    }
    return "reselect";
  }

  return { from: selectedSquare, to: clickedSquare };
}
