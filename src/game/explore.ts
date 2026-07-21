// Increment 3.91 (Task 6): the "try the better line" sandbox's pure state
// machine. No network, no db — GamePage wires this to the exploreReply
// client call (src/game/api.ts) and the SAME <Board> the live game and the
// static debrief already share, but this module itself never imports
// anything but chess.js. Nothing here persists: there is no gameId, no
// server write, and exit is simply discarding this state and calling
// startExplore fresh next time — no teardown call, nothing to clean up.
import { Chess } from "chess.js";

export interface ExploreMoveEntry {
  san: string;
  from: string;
  to: string;
}

export interface ExploreState {
  fen: string;
  history: ExploreMoveEntry[];
  // True from the moment the player's own move lands until the engine's
  // reply is applied (or the position is already over, in which case a
  // player move never sets this — there is no reply to await).
  awaitingReply: boolean;
  over: boolean;
}

/** Seeds a fresh sandbox at `fen` (typically fenAtPly(moves, ply) from the
 * debrief's rewound position) — empty history, nothing pending. */
export function startExplore(fen: string): ExploreState {
  return { fen, history: [], awaitingReply: false, over: false };
}

/**
 * Task 3 (increment 3.95): a turning-point card's ply is the mistake move
 * itself. The player is always white, so an odd ply (her move just landed)
 * leaves the position black-to-move — she can't touch her own pieces there.
 * Rounding down to the nearest even ply lands on the position she actually
 * needs to retry, white to move. An already-even ply (player-to-move) is a
 * no-op.
 */
export function exploreSeedPly(ply: number): number {
  return ply - (ply % 2);
}

/**
 * The single green "best" guiding arrow shown while a sandbox is open —
 * the matching turning line's bestFromTo, keyed by the SAME ply passed to
 * openExplore (the mistake's own ply, not the seed ply), matching how the
 * static debrief already looks turning lines up by ply (GamePage's
 * handleRewind). Null when there's no matching line or it has no
 * bestFromTo recorded (declared cut — nothing to point at).
 */
export function guidingArrow(
  ply: number,
  lines: { ply: number; bestFromTo?: { from: string; to: string } }[]
): { from: string; to: string; color: "best" } | null {
  const line = lines.find((l) => l.ply === ply);
  if (!line?.bestFromTo) return null;
  return { from: line.bestFromTo.from, to: line.bestFromTo.to, color: "best" };
}

/**
 * Validates and applies the player's move locally against `s.fen` (same
 * throwaway-clone pattern GamePage's handlePendingStart/mirrorRef flow
 * already uses for the real game — chess.js is the only source of legality,
 * never the server). Rejects silently (ok:false, state unchanged by
 * reference) on an illegal move or a move attempted while a reply is still
 * awaited — the caller (GamePage) gates board input on awaitingReply too,
 * but this is the load-bearing check.
 */
export function applyPlayerMove(
  s: ExploreState,
  from: string,
  to: string,
  promo?: string
): { next: ExploreState; ok: boolean } {
  if (s.over || s.awaitingReply) return { next: s, ok: false };
  const chess = new Chess(s.fen);
  let mv;
  try {
    mv = chess.move({ from, to, promotion: promo ?? "q" });
  } catch {
    return { next: s, ok: false }; // illegal locally — nothing sent anywhere
  }
  if (!mv) return { next: s, ok: false };
  const over = chess.isGameOver();
  const next: ExploreState = {
    fen: chess.fen(),
    history: [...s.history, { san: mv.san, from: mv.from, to: mv.to }],
    awaitingReply: !over,
    over,
  };
  return { next, ok: true };
}

/**
 * Applies an already-chosen engine reply (from exploreReply's response) on
 * top of `s.fen`. A no-op (same reference back) when no reply is being
 * awaited — guards a stale/duplicate response from a superseded request the
 * same way the live game's pendingTokenRef guards do, just without needing
 * a token here since the caller only ever calls this once per awaited turn.
 */
export function applyEngineReply(
  s: ExploreState,
  reply: { from: string; to: string; promotion?: string }
): ExploreState {
  if (!s.awaitingReply) return s;
  const chess = new Chess(s.fen);
  let mv;
  try {
    mv = chess.move({ from: reply.from, to: reply.to, promotion: reply.promotion ?? "q" });
  } catch {
    return { ...s, awaitingReply: false };
  }
  if (!mv) return { ...s, awaitingReply: false };
  return {
    fen: chess.fen(),
    history: [...s.history, { san: mv.san, from: mv.from, to: mv.to }],
    awaitingReply: false,
    over: chess.isGameOver(),
  };
}
