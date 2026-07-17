import type { Chess, Square } from "chess.js";
import type { PieceKind } from "../board/pieces";
import type { MoveRender } from "./describeMove";

/**
 * Reads the kind of piece a move captured, from `chess` BEFORE the move is
 * applied to it. Returns null for non-captures.
 *
 * The victim sits at `capturedSquare` when the move set one (en passant —
 * the only case where the victim isn't on `to`), otherwise at `to`. Reading
 * pre-move also handles promotion-captures naturally: the victim is simply
 * whatever occupied the target square, not necessarily a pawn.
 */
export function victimKind(chess: Chess, moveRender: MoveRender): PieceKind | null {
  if (!moveRender.capture) return null;
  const square = (moveRender.capturedSquare ?? moveRender.to) as Square;
  const piece = chess.get(square);
  return piece ? piece.type : null;
}
