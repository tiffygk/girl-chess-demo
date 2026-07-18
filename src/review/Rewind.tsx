// Increment 3c: the debrief's rewind seam. Pure position reconstruction —
// replays SANs 1..ply on a fresh chess.js from the start position and
// returns the resulting fen. GamePage feeds that fen into the SAME `fen`
// state / `resyncTick` remount seam it already uses to hard-resync the
// board after a desync heal (see reconcile.ts's "adopt" branch) — this file
// does not touch Board or build a second board; it only computes the fen.
import { Chess } from "chess.js";
import type { SummaryMove } from "../game/api";

/**
 * The board position after the first `ply` plies of `moves` (moves assumed
 * ordered ascending, one entry per ply, as returned by
 * GET /api/game/:id/summary). `ply` is clamped to [0, moves.length] — 0 is
 * the start position, moves.length is the final position.
 */
export function fenAtPly(moves: SummaryMove[], ply: number): string {
  const chess = new Chess();
  const count = Math.max(0, Math.min(ply, moves.length));
  for (let i = 0; i < count; i++) {
    chess.move(moves[i].san);
  }
  return chess.fen();
}
