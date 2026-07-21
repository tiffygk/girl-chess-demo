// Increment 3.95 (Task 10): the full-game move-list navigator — a clickable
// SAN move list of the WHOLE game (not just the curated turning points),
// grouped by move number, plus prev/next controls that scrub one ply at a
// time across the entire game. Render-only over the pure groupMoves helper
// (moveList.ts): every control just calls onSelect(ply) with a ply
// GamePage's existing rewindPly/fenAtPly seam already knows how to jump to
// (see Rewind.tsx, GamePage.tsx's handleRewind) — no second board, no chess
// logic in here. Rendered inside DebriefPage, alongside (not replacing) the
// turning-point cards.
//
// Filename is MoveListNav.tsx rather than MoveList.tsx: on this repo's
// (case-insensitive) filesystem, a component file differing from
// moveList.ts only by case in the same directory made TypeScript's
// extensionless-import resolution pick the wrong file (it tried the .ts
// candidate first, case-insensitively matched moveList.ts, and reported
// the pure helper's exports where the component's were expected). The
// exported component itself is still named MoveList, per the task brief.
import { groupMoves } from "./moveList";

export interface MoveListProps {
  /** The whole game's SANs, in ply order (index 0 = ply 1). */
  sans: string[];
  /** The ply currently shown on the board; null means the final position —
   *  the same "no rewind"/"back to the end" convention rewindPly already
   *  uses everywhere else in the debrief. */
  currentPly: number | null;
  onSelect: (ply: number) => void;
  /** Disables every control — set true while a "try the line" sandbox is
   *  live, the same rule the turning-point cards' own buttons already
   *  follow (the live board can't be yanked out from under itself). */
  disabled?: boolean;
}

export function MoveList({ sans, currentPly, onSelect, disabled }: MoveListProps) {
  const rows = groupMoves(sans);
  if (rows.length === 0) return null;

  const totalPlies = sans.length;
  const shownPly = currentPly ?? totalPlies;
  const atStart = shownPly <= 0;
  const atEnd = shownPly >= totalPlies;

  return (
    <div className="debrief-movelist">
      <div className="debrief-movelist-scrub">
        <button
          type="button"
          className="small"
          disabled={disabled || atStart}
          onClick={() => onSelect(Math.max(0, shownPly - 1))}
        >
          prev
        </button>
        <span className="debrief-movelist-scrub-label">
          {shownPly === 0 ? "start" : `ply ${shownPly} / ${totalPlies}`}
        </span>
        <button
          type="button"
          className="small"
          disabled={disabled || atEnd}
          onClick={() => onSelect(Math.min(totalPlies, shownPly + 1))}
        >
          next
        </button>
      </div>
      <div className="debrief-movelist-rows" role="list" aria-label="full move list">
        {rows.map((row) => (
          <div className="debrief-movelist-row" key={row.moveNumber} role="listitem">
            <span className="debrief-movelist-num">{row.moveNumber}.</span>
            {row.white && (
              <button
                type="button"
                disabled={disabled}
                className={
                  "small debrief-movelist-move debrief-movelist-you" +
                  (currentPly === row.white.ply ? " active" : "")
                }
                onClick={() => onSelect(row.white!.ply)}
              >
                {row.white.san}
              </button>
            )}
            {row.black && (
              <button
                type="button"
                disabled={disabled}
                className={
                  "small debrief-movelist-move debrief-movelist-mallow" +
                  (currentPly === row.black.ply ? " active" : "")
                }
                onClick={() => onSelect(row.black!.ply)}
              >
                {row.black.san}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
