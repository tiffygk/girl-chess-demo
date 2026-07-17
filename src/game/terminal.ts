import type { Chess, Square } from "chess.js";

export interface Takedown {
  from: string;
  to: string;
}

function chebyshevDistance(a: string, b: string): number {
  const fileDiff = Math.abs(a.charCodeAt(0) - b.charCodeAt(0));
  const rankDiff = Math.abs(Number(a[1]) - Number(b[1]));
  return Math.max(fileDiff, rankDiff);
}

/**
 * On a checkmate position, finds the winning side's piece best suited to
 * play the king-takedown animation: any piece of the winning color that
 * attacks the mated king's square, nearest by Chebyshev distance (ties
 * broken by board-scan order — good enough since the animation only needs
 * *a* plausible attacker, not necessarily the actual mating piece).
 *
 * Returns null when the position isn't checkmate, or (defensively) if no
 * attacker can be found.
 */
export function findTakedownPiece(chess: Chess): Takedown | null {
  if (!chess.isCheckmate()) return null;

  const matedColor = chess.turn();
  const winningColor = matedColor === "w" ? "b" : "w";

  let kingSquare: string | null = null;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === matedColor) {
        kingSquare = cell.square;
      }
    }
  }
  if (!kingSquare) return null;

  const attackers = chess.attackers(kingSquare as Square, winningColor);
  if (attackers.length === 0) return null;

  let best = attackers[0];
  let bestDist = chebyshevDistance(best, kingSquare);
  for (const sq of attackers.slice(1)) {
    const dist = chebyshevDistance(sq, kingSquare);
    if (dist < bestDist) {
      best = sq;
      bestDist = dist;
    }
  }

  return { from: best, to: kingSquare };
}
