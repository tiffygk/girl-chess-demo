// tools/rca-eval/lib/forcedLoss.test.ts
//
// TDD: watched red against a pre-implementation lib/forcedLoss.ts ("Cannot
// find module './forcedLoss'"). Suite FH's ground truth (spec section 3,
// suite FH) needs "forced" to be a COMPUTED label, not an opinion --
// forcedMaterialLoss proves it with a chess.js depth-2 material search: for
// every legal move the side to move could play, does the opponent have a
// reply that leaves material worse than the position's current balance.
import { describe, it, expect } from "vitest";
import { forcedMaterialLoss } from "./forcedLoss";

describe("forcedMaterialLoss", () => {
  // The textbook royal fork: white knight on c7 checks the black king on e8
  // AND forks the rook on a8. Knight checks cannot be blocked, and no black
  // piece can capture or defend against the knight, so every legal black
  // move is a king move that leaves a8 hanging to Nxa8 next move. This is a
  // known, hand-verifiable position -- every one of black's ~5 legal king
  // moves loses the rook (delta -5) with zero escape.
  const ROYAL_FORK_FEN = "r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1";

  it("proves a forced material loss on the royal-fork position: every legal move still loses the rook", () => {
    const result = forcedMaterialLoss(ROYAL_FORK_FEN);
    expect(result.forced).toBe(true);
    expect(result.sideToMove).toBe("b");
    expect(result.lines.length).toBeGreaterThan(0);
    for (const line of result.lines) {
      expect(line.delta).toBeLessThan(0);
    }
    // The proof output is auditable text, not just a boolean -- FH-02's
    // fixture file ships this proof alongside each pinned fen so the label
    // itself can be checked by eye.
    expect(result.proof).toContain("Nxa8");
  });

  it("does NOT report a forced loss on the starting position (a quiet, balanced position)", () => {
    const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const result = forcedMaterialLoss(START_FEN);
    expect(result.forced).toBe(false);
    expect(result.baseline).toBe(0);
  });

  it("does NOT report a forced loss when the threatened side has an escape that avoids the delta (rook can flee to safety)", () => {
    // Same knight-fork shape, but the rook starts on d8 (not forked) and
    // black has a king move to a square the knight does not attack that
    // also gets the rook off any capturable square permanently -- i.e. no
    // line at all loses material for black, since Rd8 was never attacked.
    const NO_FORK_FEN = "3rk3/2N5/8/8/8/8/8/4K3 b - - 0 1";
    const result = forcedMaterialLoss(NO_FORK_FEN);
    expect(result.forced).toBe(false);
  });

  // Section 4 rule 2 (every mechanical detector proven red at startup): a
  // fabricated "no threat at all" input (two lone kings, nothing to fork)
  // must never be misclassified as forced -- this is the verifier's own
  // known-bad-input self-check.
  it("prove-red-at-startup: two lone kings (nothing to lose) is never forced", () => {
    const LONE_KINGS_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const result = forcedMaterialLoss(LONE_KINGS_FEN);
    if (result.forced) {
      throw new Error(`forcedMaterialLoss instrument-broken: lone-kings known-bad input reported forced=true`);
    }
    expect(result.forced).toBe(false);
  });

  it("baseline reflects the side-to-move's current material balance (not always zero)", () => {
    // White is up a rook already (no black rook on the board at all).
    const UP_A_ROOK_FEN = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
    const result = forcedMaterialLoss(UP_A_ROOK_FEN);
    expect(result.baseline).toBe(5);
  });

  // Instrument-audit catch (progress.md, "INSTRUMENT AUDIT CATCH"): the
  // original implementation stopped counting material one ply after the
  // opponent's reply and never let the side-to-move RECAPTURE. These four
  // cases are the exact reproductions from that audit, run directly against
  // the mined/motivating fixture fens (tools/coach-eval/fixtures.ts).
  describe("recapture/quiescence resolution (instrument-audit catch)", () => {
    // FK1: game 160, ply 56, white to move.
    const FK1_FEN = "4nb2/2p3kp/p3B1p1/1p2N3/4p3/P3N1P1/1P3P1P/5RK1 w - - 2 29";
    // FK3: game 160, ply 58, white to move -- the real, still-forced fork.
    const FK3_FEN = "4nb2/2p4p/p3Bkp1/1p2N3/4p3/P3N1P1/1P3P1P/3R2K1 w - - 4 30";
    // FK5: game 141, ply 14, white to move.
    const FK5_FEN = "r1b1kb1r/p1p1n1pp/1pnp1q2/8/8/2PBPN2/PP3PPP/RNBQK2R w KQkq - 4 8";
    // FK6: game 148, ply 12, white to move, in check from Bb4+.
    const FK6_FEN = "r1bqk1nr/1ppp1p1p/n5p1/p7/1bPPN1P1/7P/PP2PP2/R1BQKBNR w KQkq - 1 7";

    it("(a) FK1: a quiet king move (Kg2) is NOT falsely charged for Bxa3 -- b2 recaptures the bishop, a net GAIN for white, not a pawn loss", () => {
      const result = forcedMaterialLoss(FK1_FEN);
      const line = result.lines.find((l) => l.move === "Kg2");
      expect(line).toBeDefined();
      // Old buggy behavior: worstReplySan "Bxa3", delta -1 (a bare pawn loss,
      // b2's recapture never counted). Corrected: b2xa3 answers it, so this
      // branch is never the worst-case reply for black, and Kg2 is a
      // genuine, fully safe escape (delta >= 0).
      expect(line!.worstReplySan).not.toBe("Bxa3");
      expect(line!.delta).toBeGreaterThanOrEqual(0);
      // With that fixed, FK1 is not provably forced: quiet moves like Kg2 escape clean.
      expect(result.forced).toBe(false);
    });

    it("(b) FK6: blocking check with Nc3 is NOT a piece loss -- Bxc3+ is answered by bxc3, an even minor-piece trade; 'forced' must fall out of the corrected math, not be assumed", () => {
      const result = forcedMaterialLoss(FK6_FEN);
      const nc3 = result.lines.find((l) => l.move === "Nc3");
      const nd2 = result.lines.find((l) => l.move === "Nd2");
      const bd2 = result.lines.find((l) => l.move === "Bd2");
      expect(nc3).toBeDefined();
      expect(nd2).toBeDefined();
      expect(bd2).toBeDefined();
      // Old buggy behavior: all three read as a bare piece loss (delta -3),
      // never letting the pawn/queen recapture the checking bishop.
      expect(nc3!.delta).toBeGreaterThanOrEqual(0);
      expect(nd2!.delta).toBeGreaterThanOrEqual(0);
      expect(bd2!.delta).toBeGreaterThanOrEqual(0);
      // The one real blunder in this set (Qd2 blocks with the queen, which
      // Bxd2+ then wins outright) must STILL read as a genuine loss -- the
      // fix must not blind the verifier to real losses either.
      const qd2 = result.lines.find((l) => l.move === "Qd2");
      expect(qd2).toBeDefined();
      expect(qd2!.delta).toBeLessThan(0);
      // Three of the four legal replies to the check are fully safe, so this
      // position does NOT meet the definition of forced.
      expect(result.forced).toBe(false);
    });

    it("(c) FK5: Qxf3 never surfaces as a worst reply -- the f3 knight is defended twice (g2 pawn, and the queen through the empty e2 square), so capturing it loses the queen instead", () => {
      const result = forcedMaterialLoss(FK5_FEN);
      for (const line of result.lines) {
        expect(line.worstReplySan).not.toBe("Qxf3");
      }
      expect(result.forced).toBe(false);
    });

    it("(d) FK3 stays forced under the corrected math: game 160's real fork survives recapture resolution -- every legal white move still loses material", () => {
      const result = forcedMaterialLoss(FK3_FEN);
      expect(result.forced).toBe(true);
      for (const line of result.lines) {
        expect(line.delta).toBeLessThan(0);
      }
    });
  });
});
