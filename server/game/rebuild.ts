// Rebuilding a live game from the database after the server process
// restarted. The games and moves tables hold everything a LiveGame needs
// except the engine handle, which GameManager.opponentFor caches per elo.
// Pure helpers live here so they test without an engine or a db.
import { Chess } from "chess.js";

export function replayMoves(rows: { san: string }[]): Chess | null {
  const chess = new Chess();
  for (const row of rows) {
    try {
      chess.move(row.san);
    } catch {
      return null;
    }
  }
  return chess;
}

// games.opponent is "maia-1600" or "fallback-1600"; the strength is the
// trailing number. There is no separate elo column.
export function eloFromOpponentLabel(label: string): number | null {
  const m = /(\d+)\s*$/.exec(label);
  return m ? Number(m[1]) : null;
}
