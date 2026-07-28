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
  /** Highlight-a-move: plies she flagged during live play, so the recap can
   *  spot them even outside the (collapsed-by-default) study ledger. Empty
   *  by default so every pre-existing caller keeps compiling unchanged. */
  highlightedPlies?: Set<number>;
}

export function MoveList({ sans, currentPly, onSelect, disabled, highlightedPlies }: MoveListProps) {
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
        {rows.map((row) => {
          // Highlight-a-move (Task 4): the machine's record of her flag —
          // the ROW wears the flat cyan statement (tint + inset rule) and a
          // closing chip; the ply button keeps its candy recipe untouched
          // (it still jumps the board) and gains the same 7px dot she
          // filled live, via CSS. Only her plies can be highlighted, but
          // both seats are checked rather than assuming.
          const rowHighlighted =
            (row.white != null && highlightedPlies?.has(row.white.ply)) ||
            (row.black != null && highlightedPlies?.has(row.black.ply));
          return (
          <div
            className={"debrief-movelist-row" + (rowHighlighted ? " highlighted-row" : "")}
            key={row.moveNumber}
            role="listitem"
          >
            <span className="debrief-movelist-num">{row.moveNumber}.</span>
            {row.white && (
              <button
                type="button"
                disabled={disabled}
                className={
                  "small debrief-movelist-move debrief-movelist-you" +
                  (shownPly === row.white.ply ? " active" : "") +
                  (highlightedPlies?.has(row.white.ply) ? " highlighted" : "")
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
                  (shownPly === row.black.ply ? " active" : "") +
                  (highlightedPlies?.has(row.black.ply) ? " highlighted" : "")
                }
                onClick={() => onSelect(row.black!.ply)}
              >
                {row.black.san}
              </button>
            )}
            {rowHighlighted && <span className="debrief-movelist-hl-chip">highlighted</span>}
          </div>
          );
        })}
      </div>
    </div>
  );
}
