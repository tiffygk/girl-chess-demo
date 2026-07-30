// tools/rca-eval/lib/forcedLoss.ts
//
// Suite FH's ground truth (RCA Acceptance Evals spec, section 3 suite FH):
// no regex can safely decide "the coach's claimed escape actually exists,"
// in either direction. So fixture ground truth is MECHANICAL instead: this
// module proves, for a given fen, whether every legal move for the side to
// move still loses material within one more ply -- a chess.js depth-2
// material search, not an opinion. "Forced" is a computed label.
//
// Method: for each of the side-to-move's legal moves (ply 1), search every
// one of the opponent's legal replies (ply 2) and take the WORST one for
// the side to move (the opponent plays their best capture/reply). If every
// one of the side-to-move's ply-1 options still ends up materially worse
// after the opponent's best ply-2 reply than the position was before any of
// this, the loss is forced -- there is no move that avoids it.
//
// Lives in tools/rca-eval/lib (not tools/coach-eval) specifically so
// coach-eval stays model-eval-only (spec section 6) -- this is imported by
// the FH fixture builder, never by score.ts/render.ts.
import { Chess } from "chess.js";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

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

export interface ForcedLossLine {
  move: string; // the side-to-move's ply-1 move, in SAN
  // The opponent's WORST reply for the side to move (their best move), in
  // SAN. Null only when the opponent has no legal reply at all (m1 ended
  // the game) -- that line cannot be searched at depth 2 and is treated as
  // an escape (see forcedMaterialLoss's loop).
  worstReplySan: string | null;
  balanceBefore: number;
  balanceAfterReply: number;
  delta: number; // balanceAfterReply - balanceBefore; negative = material lost
}

export interface ForcedLossResult {
  forced: boolean;
  sideToMove: "w" | "b";
  baseline: number;
  lines: ForcedLossLine[];
  // Auditable text proof -- FH's fixture file ships this alongside each
  // pinned fen (spec section 3, suite FH, FH-02) so the "forced" label can
  // be checked by eye, not just trusted as a boolean.
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
      // stalemate/no more replies to search) -- depth 2 cannot prove a loss
      // here, so this counts as an escape, not a silent skip.
      lines.push({ move: m1.san, worstReplySan: null, balanceBefore: baseline, balanceAfterReply: baseline, delta: 0 });
      forced = false;
      continue;
    }
    let worst: { san: string; balance: number } | null = null;
    for (const m2 of replies) {
      const afterM2 = new Chess(afterM1.fen());
      afterM2.move(m2.san);
      const balance = materialBalance(afterM2, sideToMove);
      if (worst === null || balance < worst.balance) worst = { san: m2.san, balance };
    }
    const delta = worst!.balance - baseline;
    lines.push({ move: m1.san, worstReplySan: worst!.san, balanceBefore: baseline, balanceAfterReply: worst!.balance, delta });
    if (delta >= 0) forced = false;
  }

  const proofLines = lines
    .map((l) => `${l.move} -> ${l.worstReplySan ?? "(no reply available)"} (delta ${l.delta >= 0 ? "+" : ""}${l.delta})`)
    .join("; ");
  return {
    forced,
    sideToMove,
    baseline,
    lines,
    proof: `${sideToMove} to move, baseline ${baseline}: ${proofLines}`,
  };
}
