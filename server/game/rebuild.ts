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

// Owner-calibratable (ruling 2026-07-30): how long an interrupted game
// stays resumable. Computed server-side only; the client reads a boolean.
export const RESUME_WINDOW_DAYS = 7;
export const MIN_RESUMABLE_PLIES = 1;

export function isResumableAt(lastMoveAt: string | null, plies: number, result: string | null, nowMs: number): boolean {
  if (result != null || plies < MIN_RESUMABLE_PLIES || !lastMoveAt) return false;
  const t = Date.parse(lastMoveAt.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return false;
  return nowMs - t <= RESUME_WINDOW_DAYS * 86_400_000;
}
