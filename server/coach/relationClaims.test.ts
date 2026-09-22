import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { checkRelationClaims } from "./relationClaims";

// game 198: after Qxd6+ (trace 366's board has the queen on d6 and mallow's king on g8)
const AFTER_QXD6 = "rnbq1k1r/pppp1ppp/3Q4/B2P4/2P5/8/PP3PPP/RN2KBNR b KQ - 0 9";
// game 198 ply 26 (trace 369): her bishop on e5, mallow rooks a8/h8
const PLY26 = "rnb3kr/pp1p2p1/5p1p/3PB3/2P5/8/PP2BPPP/RN2K1NR w KQ - 0 14";

describe("checkRelationClaims", () => {
  it("passes a true standing claim: c7 attacks your queen on d6 (trace 366)", () => {
    expect(checkRelationClaims("the pawn on c7 attacks your queen on d6.", AFTER_QXD6)).toEqual([]);
  });
  it("flags a false denial: the pawn on c7 can't reach d6 (trace 361)", () => {
    expect(checkRelationClaims("no, the pawn on c7 can't reach d6, it isn't a legal capture from there.", AFTER_QXD6))
      .toEqual(["relation-claim: c7 does not attack d6 -- it does"]);
  });
  it("flags a fabricated hypothetical: bishop to d6 eyes their rook on h8 (trace 369)", () => {
    expect(checkRelationClaims("bishop to d6 eyes their rook on h8.", PLY26))
      .toEqual(["relation-claim: bishop to d6 attacks h8 -- it would not"]);
  });
  it("passes a true hypothetical: bishop to d6 attacks c7 is true only if it is; check with chess.js", () => {
    const c = new Chess(PLY26); c.move("Bd6");
    const truth = c.attackers("c7", "w").includes("d6");
    const v = checkRelationClaims("bishop to d6 attacks c7.", PLY26);
    expect(v.length === 0).toBe(truth);
  });
  it("a claim true on an after-move board offered in otherFens is not flagged", () => {
    const before = "rnbq1k1r/pppp1ppp/3n4/B2PQ3/2P5/8/PP3PPP/RN2KBNR w KQ - 1 9";
    expect(checkRelationClaims("the pawn on c7 attacks your queen on d6.", before, [AFTER_QXD6])).toEqual([]);
  });
  it("skips guard and defend verbs (checkDefenseClaims owns them)", () => {
    expect(checkRelationClaims("the pawn on c7 defends d6.", AFTER_QXD6)).toEqual([]);
  });
});
