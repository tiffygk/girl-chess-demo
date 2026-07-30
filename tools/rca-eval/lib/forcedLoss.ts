// tools/rca-eval/lib/forcedLoss.ts
//
// Suite FH's ground truth (RCA Acceptance Evals spec, section 3 suite FH):
// no regex can safely decide "the coach's claimed escape actually exists,"
// in either direction. So fixture ground truth is MECHANICAL instead: this
// module proves, for a given fen, whether every legal move for the side to
// move still loses material once the resulting exchanges are played out to
// quiescence -- a chess.js material search, not an opinion. "Forced" is a
// computed label.
//
// Method: for each of the side-to-move's legal moves (m1, "the candidate"),
// search every one of the opponent's legal replies (m2). For each m2 that is
// a CAPTURE, resolve the exchange to quiescence with a static-exchange-
// evaluation (SEE) style search restricted to the destination square: both
// sides alternate recapturing on that one square, each allowed to "stand
// pat" (decline to recapture) when doing so is better, until no side wants
// to continue. That resolved value -- not the raw material count one ply
// after m2 -- is what m2 is judged on. The opponent then picks whichever m2
// leaves the side-to-move worst off (their best move). If every one of the
// side-to-move's m1 options still ends up materially worse after full
// exchange resolution than the position was before any of this, the loss is
// forced -- there is no move that avoids it.
//
// Instrument-audit catch (2026-07-31, RCA round progress.md "INSTRUMENT
// AUDIT CATCH"): the previous version of this file stopped counting
// material immediately after the opponent's reply and never let the side to
// move RECAPTURE. That mislabeled several fixtures forced when the
// "losing" line was actually an even trade or a net gain once the
// recapture was counted (e.g. Bxa3 answered by b2xa3; Bxc3+ answered by
// bxc3; Qxf3 answered by gxf3, since f3 was defended twice over). The SEE-
// style resolution below fixes that: it terminates fast (branching is
// bounded by the small, monotonically-shrinking set of pieces that can
// reach one particular square, not a full-board capture search), and
// chess.js re-deriving legal moves fresh at each ply means newly revealed
// (x-ray) attackers are picked up automatically, no manual attacker-list
// bookkeeping required.
//
// Lives in tools/rca-eval/lib (not tools/coach-eval) specifically so
// coach-eval stays model-eval-only (spec section 6) -- this is imported by
// the FH fixture builder, never by score.ts/render.ts.
import { Chess } from "chess.js";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A generous but finite cap on the recapture chain's length. Real chains
// are bounded by the number of pieces that can ever reach one square (in
// practice well under 10); this cap exists only so a pathological/malformed
// fen can never spin forever, not because real positions approach it.
const SEE_MAX_DEPTH = 32;

// Material balance from `color`'s perspective: sum of color's own piece
// values minus the opponent's, over the WHOLE board (both kings contribute
// 0, so their presence/absence never perturbs the count).
function materialBalance(chess: Chess, color: "w" | "b"): number {
  let balance = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      const value = PIECE_VALUES[cell.type] ?? 0;
      balance += cell.color === color ? value : -value;
    }
  }
  return balance;
}

interface SeeResult {
  value: number; // resolved material balance from `color`'s perspective
  line: string[]; // the recapture SANs played to reach `value`, in order
}

// Resolve a capture that just landed on `square` to quiescence: the side to
// move here may recapture on `square` (repeatedly, alternating sides) or
// "stand pat" and stop -- whichever is better for the side whose turn it
// currently is. `color` is the FIXED perspective (the original side to
// move in forcedMaterialLoss) that every returned `value` is measured
// against, regardless of whose turn it is at this node.
function resolveSeeChain(chess: Chess, square: string, color: "w" | "b", depth: number): SeeResult {
  const standPat = materialBalance(chess, color);
  if (depth <= 0) return { value: standPat, line: [] };
  const turnColor = chess.turn();
  // Only recaptures ON THIS SQUARE continue the exchange -- a capture
  // elsewhere on the board is a different tactic entirely and is out of
  // scope for resolving THIS exchange (spec: "SEE approach on the
  // destination square is acceptable").
  const recaptures = chess.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  let best: SeeResult = { value: standPat, line: [] };
  for (const recapture of recaptures) {
    const next = new Chess(chess.fen());
    next.move(recapture.san);
    const sub = resolveSeeChain(next, square, color, depth - 1);
    const candidate: SeeResult = { value: sub.value, line: [recapture.san, ...sub.line] };
    const better = turnColor === color ? candidate.value > best.value : candidate.value < best.value;
    if (better) best = candidate;
  }
  return best;
}

export interface ForcedLossLine {
  move: string; // the side-to-move's ply-1 move, in SAN
  // The opponent's WORST reply for the side to move (their best move), in
  // SAN. Null only when the opponent has no legal reply at all (m1 ended
  // the game) -- that line cannot be searched further and is treated as an
  // escape (see forcedMaterialLoss's loop).
  worstReplySan: string | null;
  balanceBefore: number;
  // Material balance AFTER the full recapture chain following worstReplySan
  // has been resolved to quiescence (not just the raw balance one ply after
  // the reply -- that was the bug).
  balanceAfterReply: number;
  delta: number; // balanceAfterReply - balanceBefore; negative = material lost
  // Every recapture SAN played, in order, to resolve worstReplySan's
  // exchange to quiescence. Empty when the reply wasn't a capture, or no
  // recapture on that square was available/worthwhile.
  resolvedLine: string[];
}

export interface ForcedLossResult {
  forced: boolean;
  sideToMove: "w" | "b";
  baseline: number;
  lines: ForcedLossLine[];
  // Auditable text proof -- FH's fixture file ships this alongside each
  // pinned fen (spec section 3, suite FH, FH-02) so the "forced" label can
  // be checked by eye, not just trusted as a boolean. Enumerates every
  // legal move with its resolved worst line (reply + any recaptures).
  proof: string;
}

export function forcedMaterialLoss(fen: string): ForcedLossResult {
  const root = new Chess(fen);
  const sideToMove = root.turn();
  const baseline = materialBalance(root, sideToMove);
  const lines: ForcedLossLine[] = [];
  let forced = true;

  for (const m1 of root.moves({ verbose: true })) {
    const afterM1 = new Chess(fen);
    afterM1.move(m1.san);
    const replies = afterM1.moves({ verbose: true });
    if (replies.length === 0) {
      // The side to move has a move that ends the game (checkmate/
      // stalemate/no more replies to search) -- there is no opponent reply
      // to resolve here, so this counts as an escape, not a silent skip.
      lines.push({ move: m1.san, worstReplySan: null, balanceBefore: baseline, balanceAfterReply: baseline, delta: 0, resolvedLine: [] });
      forced = false;
      continue;
    }
    let worst: { san: string; value: number; line: string[] } | null = null;
    for (const m2 of replies) {
      const afterM2 = new Chess(afterM1.fen());
      afterM2.move(m2.san);
      // Only a capturing reply can start a recapture chain; a quiet reply
      // is judged on the plain material balance right after it, same as
      // before.
      const resolved = m2.captured
        ? resolveSeeChain(afterM2, m2.to, sideToMove, SEE_MAX_DEPTH)
        : { value: materialBalance(afterM2, sideToMove), line: [] };
      if (worst === null || resolved.value < worst.value) worst = { san: m2.san, value: resolved.value, line: resolved.line };
    }
    const delta = worst!.value - baseline;
    lines.push({
      move: m1.san,
      worstReplySan: worst!.san,
      balanceBefore: baseline,
      balanceAfterReply: worst!.value,
      delta,
      resolvedLine: worst!.line,
    });
    if (delta >= 0) forced = false;
  }

  const proofLines = lines
    .map((l) => {
      const chain = [l.worstReplySan ?? "(no reply available)", ...l.resolvedLine].join(" ");
      return `${l.move} -> ${chain} (delta ${l.delta >= 0 ? "+" : ""}${l.delta})`;
    })
    .join("; ");
  return {
    forced,
    sideToMove,
    baseline,
    lines,
    proof: `${sideToMove} to move, baseline ${baseline}: ${proofLines}`,
  };
}
