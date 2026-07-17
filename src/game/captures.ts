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

// Standard point scale used for both the display sort and the material-diff
// badge. King is included (0) only defensively — it should never actually
// appear in a captured-pieces list.
const PIECE_VALUE: Record<PieceKind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function pieceValue(kind: PieceKind): number {
  return PIECE_VALUE[kind];
}

/**
 * Display-only sort: ascending standard point value (pawn 1, knight/bishop
 * 3, rook 5, queen 9). Pure and stable (Array.prototype.sort is stable as
 * of ES2019) — ties like knight vs bishop keep their original relative
 * order rather than jittering between renders. Capture ORDER in state is
 * untouched by this; it's purely how the tray strip lays the pieces out.
 */
export function sortByValue(pieces: PieceKind[]): PieceKind[] {
  return [...pieces].sort((a, b) => pieceValue(a) - pieceValue(b));
}

export interface CapturedBySide {
  w: PieceKind[]; // white pieces captured (by mallow)
  b: PieceKind[]; // black pieces captured (by you)
}

export interface MaterialDiff {
  leader: "you" | "mallow" | null;
  points: number;
}

/**
 * Standard material-advantage readout: sums the point value each side has
 * taken from the other and reports who's ahead and by how much. Even
 * material (including the empty-captures start of a game) reports leader
 * null / points 0 — the "+N" badge only ever renders for a real lead.
 */
export function materialDiff(captured: CapturedBySide): MaterialDiff {
  const yourPoints = captured.b.reduce((sum, k) => sum + pieceValue(k), 0);
  const mallowPoints = captured.w.reduce((sum, k) => sum + pieceValue(k), 0);
  const diff = yourPoints - mallowPoints;
  if (diff === 0) return { leader: null, points: 0 };
  return diff > 0 ? { leader: "you", points: diff } : { leader: "mallow", points: -diff };
}
