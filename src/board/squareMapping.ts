// Increment 2.5, hint square-coordinate verification: pulled out of
// Board.tsx (where these lived as unexported local helpers) into their own
// tested module. Owner playtest 2026-07-17 suspected hint square names
// didn't match the actual board squares — this module is the single source
// of truth for square-name <-> grid-index conversion, used both to place
// pieces and to render every square overlay (last-move, hint-reveal, check
// ring, legal-move dots). Board always renders white at the bottom (no
// orientation/flip prop exists anywhere in this codebase — see the file's
// square grid below) — squareToIdx/idxToSquare are the exact inverse of
// each other for that fixed orientation:
//
//   idx 0  = row 0, col 0 = a8 (top-left)
//   idx 7  = row 0, col 7 = h8 (top-right)
//   idx 56 = row 7, col 0 = a1 (bottom-left)
//   idx 63 = row 7, col 7 = h1 (bottom-right)
//
// `.squares` is a plain CSS grid (`grid-template-columns: repeat(8, 1fr)`,
// default row-major auto-flow — see sugar-glitch.css) filled in idx order
// 0..63, so idx increasing by 1 moves one cell right and by 8 moves one
// row down; that is exactly what row/col above assume. Piece placement
// (`left: col * 12.5%, top: row * 12.5%`) uses the SAME squareToIdx, and
// every square overlay (`.sq` divs) compares square NAMES directly (no
// coordinate math at all there) — so a piece's rendered position and a
// same-named overlay can never disagree; verified live 2026-07-17 (help?
// hint round-trip: "your pawn on e2" -> "best here: e4" highlighted
// exactly e2 and e4, cross-checked against getBoundingClientRect() for
// both the .sq grid and the .pc piece elements). No coordinate bug found.
export function squareToIdx(square: string): number {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - Number(square[1]);
  return row * 8 + col;
}

export function idxToSquare(idx: number): string {
  const row = Math.floor(idx / 8);
  const col = idx % 8;
  return String.fromCharCode(97 + col) + (8 - row);
}
