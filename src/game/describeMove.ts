import type { Move } from "chess.js";

export interface MoveRender {
  from: string;
  to: string;
  capture: boolean;
  capturedSquare?: string; // differs from `to` only for en passant
  secondary?: { from: string; to: string }; // the rook, when castling
}

/**
 * Maps a chess.js Move to a rendering descriptor that carries everything the
 * Board needs to animate the move correctly: the mover's from/to, whether
 * there's a capture (and where the victim actually sits, which for en
 * passant is NOT the destination square), and a secondary from/to for the
 * rook when the move is a castle.
 */
export function describeMove(m: Move): MoveRender {
  const capture = m.flags.includes("c") || m.flags.includes("e");

  const render: MoveRender = {
    from: m.from,
    to: m.to,
    capture,
  };

  if (m.flags.includes("e")) {
    // En passant: the captured pawn sits on the file of `to`, rank of `from`.
    render.capturedSquare = m.to[0] + m.from[1];
  }

  if (m.flags.includes("k")) {
    const rank = m.from[1];
    render.secondary = { from: `h${rank}`, to: `f${rank}` };
  } else if (m.flags.includes("q")) {
    const rank = m.from[1];
    render.secondary = { from: `a${rank}`, to: `d${rank}` };
  }

  return render;
}
