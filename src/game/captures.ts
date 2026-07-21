import { Chess } from "chess.js";
import type { Square } from "chess.js";
import type { PieceKind } from "../board/pieces";
import type { MoveRender } from "./describeMove";
import type { SummaryMove } from "./api";

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

/**
 * Rolls back an optimistic capture-tray push after the move that added it
 * turns out to have failed (network error, or the server rejected it). Used
 * by GamePage.tsx's handleMove: the player's capture victim is pushed onto
 * `captured.b` optimistically, before the server round-trip, so both
 * failure branches need to undo exactly that push and nothing else.
 *
 * Pure: given the victim that was (or wasn't) added, drops the last entry
 * on `side` — a plain tail-slice, safe here specifically because the only
 * thing that can land in `captured[side]` between the optimistic push and
 * this rollback is nothing: callers only ever invoke this while still
 * holding the move's own busy-guard, so no concurrent move can interleave
 * another push in between. `victim` null (no capture happened) is a no-op,
 * returning `prev` unchanged.
 */
export function rollbackCapture(
  prev: CapturedBySide,
  side: keyof CapturedBySide,
  victim: PieceKind | null
): CapturedBySide {
  if (!victim) return prev;
  return { ...prev, [side]: prev[side].slice(0, -1) };
}

/**
 * The capture trays (see CapturedBySide) after the first `ply` plies of
 * `moves`, replayed from the start position on a fresh chess.js — the pure
 * "trays at any ply" counterpart to Rewind.tsx's fenAtPly. Added (increment
 * 3.95, Task 10) because review-mode rewind has no incrementally-tracked
 * `captured` state the way a live in-progress game does (a reviewed past
 * game never replays its moves through GamePage's handleMove optimistic
 * pushes) — without this, the trays/material shown during review always sat
 * wherever they were before "past games" was opened, regardless of the
 * rewound ply (the known v1 gap this task folds in). `ply` is clamped to
 * [0, moves.length], same convention as fenAtPly.
 *
 * Uses chess.js's own `move.captured` (the captured piece's kind) rather
 * than re-deriving it from board state — unlike victimKind above, this
 * replays every move itself via chess.js, so the Move object's own field is
 * already in hand and authoritative, including for en passant and
 * promotion-captures.
 */
export function capturesAtPly(moves: SummaryMove[], ply: number): CapturedBySide {
  const chess = new Chess();
  const captured: CapturedBySide = { w: [], b: [] };
  const count = Math.max(0, Math.min(ply, moves.length));
  for (let i = 0; i < count; i++) {
    const move = chess.move(moves[i].san);
    if (move.captured) {
      // The captured piece's color is always the mover's opposite: a white
      // move captures a black piece (-> captured.b, "pieces you've
      // captured") and a black move captures a white piece (-> captured.w).
      if (move.color === "w") captured.b.push(move.captured);
      else captured.w.push(move.captured);
    }
  }
  return captured;
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
