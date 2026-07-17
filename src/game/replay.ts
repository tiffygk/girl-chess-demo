import type { Move } from "chess.js";

export interface ReplayPlan {
  /** The position immediately before the first replayed ply. */
  startFen: string;
  /** The plies to replay, in play order — the last entry is the mate move. */
  moves: Move[];
}

/**
 * Owner feedback (verbatim): "The replay should play the last three moves or
 * four moves without delays in between... that way I just see the act of the
 * Queen checkmating the King but I get to see what was my lead up."
 *
 * Builds the lead-up cinematic plan for "replay the takedown": the last
 * `plies` half-moves of the game (capped at whatever the game actually has —
 * a game shorter than `plies` replays from the very start), plus the FEN
 * they begin from.
 *
 * Source of truth is the client mirror's full verbose history
 * (`mirrorRef.current.history({ verbose: true })` in GamePage) — each
 * chess.js Move already carries `.before`/`.after`, so `startFen` is simply
 * the `.before` of the first replayed move. The final entry in `moves` is
 * always the game's actual last ply (the mate move, when this is called for
 * a takedown-eligible ending).
 */
export function replayPlan(history: Move[], plies = 4): ReplayPlan {
  if (history.length === 0) {
    return { startFen: "", moves: [] };
  }
  const count = Math.min(plies, history.length);
  const moves = history.slice(history.length - count);
  return { startFen: moves[0].before, moves };
}
