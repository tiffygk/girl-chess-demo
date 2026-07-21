// Increment 3.95 (Task 10): pure grouping helper for the full-game move-list
// navigator ("click any turn / scrub the whole game" — the owner's
// verbatim feedback). Turns a flat SAN array into numbered rows (a white
// move, and a black move when the game didn't end right after white's), each
// carrying its own 1-indexed ply — the exact convention fenAtPly
// (Rewind.tsx), capturesAtPly (captures.ts) and the turning-point machinery
// already use (ply N = the position after N plies). MoveList.tsx renders
// this render-only; the click handler reuses GamePage's existing
// rewindPly/fenAtPly seam to actually move the board — this module only
// does the grouping, nothing chess-aware.
export interface MoveListRow {
  moveNumber: number;
  white?: { san: string; ply: number };
  black?: { san: string; ply: number };
}

export function groupMoves(sans: string[]): MoveListRow[] {
  const rows: MoveListRow[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const moveNumber = i / 2 + 1;
    const row: MoveListRow = { moveNumber, white: { san: sans[i], ply: i + 1 } };
    if (i + 1 < sans.length) {
      row.black = { san: sans[i + 1], ply: i + 2 };
    }
    rows.push(row);
  }
  return rows;
}
