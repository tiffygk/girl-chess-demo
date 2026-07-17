import { Chess } from "chess.js";
import { resolveClickMove, isCastleAttempt } from "./resolveClick";

export type PendingClickResult =
  | { action: "confirm" }
  | { action: "retarget"; to: string }
  | { action: "cancel" }
  | { action: "select"; square: string; castleBlocked: boolean }
  | { action: "noop" };

/**
 * Resolves a click that lands while a move is pending (the judge is
 * holding it, or confirm-only's plain two-step) into one of four actions.
 * The piece at pending.from is conceptually still "selected" the whole
 * time a move is pending — this is what lets a click translate into a
 * same-origin retarget instead of requiring "take it back" first (owner,
 * verbatim: "I want that piece selected and then I just press another
 * square if I want to take it back and move it to that square. To
 * unselect that piece I just click on that piece again... but I still
 * should press the 'okay, confirm' button.").
 *
 * Pure: `chess` is the settled (pre-pending) position — pending never
 * mutates the mirror, so this is exactly the position the original
 * selection was made against — and this function never mutates it either
 * (legality/castle probes run on throwaway clones, same as resolveClickMove
 * does for its own castle-by-rook-click translation).
 */
export function resolvePendingClick(
  chess: Chess,
  pending: { from: string; to: string },
  clickedSquare: string
): PendingClickResult {
  // Click the origin piece again: cancel (owner, increment 1.5, verbatim:
  // "to unselect that piece I just click on that piece again").
  if (clickedSquare === pending.from) {
    return { action: "cancel" };
  }
  // Click the held ghost at the destination again: confirm (owner,
  // increment 2 playtest 2026-07-17: "if I double click the space, I want
  // that to automatically confirm" — supersedes 1.5's cancel-on-ghost).
  if (clickedSquare === pending.to) {
    return { action: "confirm" };
  }

  const result = resolveClickMove(chess, pending.from, clickedSquare);

  if (result === null) {
    // Defensive: pending.from should always hold a piece (pending only
    // ever exists after a successful probe move originated there) —
    // shouldn't happen in practice.
    return { action: "noop" };
  }

  if (result === "reselect") {
    // A different own piece (or a king+own-rook click that isn't a legal
    // castle right now) — retract and select it, the same reselect
    // convention a fresh (non-pending) selection uses (A3). castleBlocked
    // flags the king+rook case specifically so the caller can surface A5's
    // "can't castle right now" hint — every other reselect is silent.
    return {
      action: "select",
      square: clickedSquare,
      castleBlocked: isCastleAttempt(chess, pending.from, clickedSquare),
    };
  }

  // result is {from, to}. resolveClickMove doesn't itself validate a plain
  // destination's legality — its non-castle callers try the real move and
  // no-op on failure — so do that check here: an illegal square must never
  // retract a perfectly legal pending move out from under the player.
  if (result.to === pending.to) {
    // Same destination the pending move already targets, reached via a
    // different clicked square (re-clicking the castling rook while that
    // exact castle is pending): same gesture repeated, so confirm.
    return { action: "confirm" };
  }

  const probe = new Chess(chess.fen());
  try {
    const mv = probe.move({ from: result.from, to: result.to, promotion: "q" });
    if (!mv) return { action: "noop" };
  } catch {
    return { action: "noop" };
  }

  return { action: "retarget", to: result.to };
}
