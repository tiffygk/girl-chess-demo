// tools/checker-sweep/generate.test.ts
//
// Fix round (2026-09-22), brief-T fix 2: generateRelationClaims'
// paraphrasesFor emitted the SAME positive-phrased text ("could capture",
// "is aiming at", "can be taken by") for both the positive claim and the
// denial claim ("<piece> can't reach <square>"), regardless of polarity.
// A denial claim's label is true when NO capture exists, but its
// paraphrase asserted that a capture DOES exist -- an opposite-polarity
// mismatch that made the paraphrase recall table score against the wrong
// truth value for every denial claim. This test asserts a denial claim's
// paraphrases are themselves negated (denial-shaped), matching its own
// polarity, so the recall table's "caught" check compares like with like.
import { describe, expect, test } from "vitest";
import { generateRelationClaims } from "./generate";

// A position where white's e4 pawn is the side to move and has no legal
// capture on d8 (far out of reach) -- so the denial claim "the pawn on e4
// can't reach d8" is adjudicated true (no capture exists), on the live
// board.
const FEN = "r2qkb1r/pppb1ppp/2n5/4p3/4P3/2N5/PPPB1PPP/R2QKB1R w KQkq - 0 1";

describe("generateRelationClaims paraphrases", () => {
  test("a denial claim's paraphrases are negated, not positive-phrased", () => {
    const claims = generateRelationClaims(
      [{ fen: FEN, depth: "live", source: "live" } as never],
      32
    );
    const denial = claims.find((c) => c.polarity === "denial" && c.claimKey === "den>e4>d8");
    expect(denial).toBeDefined();
    // A denial's own paraphrases must carry a negation matching the
    // claim's own polarity -- "could capture" must read "could not
    // capture" (or equivalent), never the bare positive form the
    // positive claim uses.
    for (const p of denial!.paraphrases) {
      expect(p.text).not.toMatch(/\bcould capture\b/);
      expect(p.text).not.toMatch(/\bis aiming at\b/);
      expect(p.text).toMatch(/n't|not/i);
    }
  });

  test("a positive claim's paraphrases stay positive-phrased", () => {
    const claims = generateRelationClaims(
      [{ fen: FEN, depth: "live", source: "live" } as never],
      32
    );
    const positive = claims.find((c) => c.polarity === "positive" && c.claimKey === "pos>e4>d8");
    expect(positive).toBeDefined();
    const capture = positive!.paraphrases.find((p) => p.verb === "could capture");
    expect(capture?.text).toMatch(/\bcould capture\b/);
  });
});
