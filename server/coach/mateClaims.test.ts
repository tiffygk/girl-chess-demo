import { describe, it, expect } from "vitest";
import { checkMateClaims, mateClaimSentences } from "./mateClaims";

const perPlyWithMate = [
  { evalMate: null, then: undefined },
  { evalMate: 3, then: undefined },
  { evalMate: null, then: "leads to mate for you in 2" },
];

describe("checkMateClaims", () => {
  it("passes a digit mate claim whose N matches a persisted evalMate", () => {
    expect(checkMateClaims("you had mate in 3 right there.", perPlyWithMate, [])).toEqual([]);
  });

  it("passes an N proven by a then claim", () => {
    expect(checkMateClaims("that line is mate in 2.", perPlyWithMate, [])).toEqual([]);
  });

  it("flags an invented N", () => {
    const v = checkMateClaims("you had mate in 5 there.", perPlyWithMate, []);
    expect(v).toEqual(["mate-claim: no line in this game's facts mates in 5"]);
  });

  it("word-form mate claims are unpoliced (declared cut, precision over recall)", () => {
    expect(checkMateClaims("you had mate in five there.", perPlyWithMate, [])).toEqual([]);
  });

  it("a focused mating line's own N is allowed", () => {
    expect(checkMateClaims("that's mate in 2.", [{ evalMate: null }], [2])).toEqual([]);
  });

  it("does not adjudicate at all when no truth source exists", () => {
    expect(checkMateClaims("looks like mate in 4 to me.", [], [])).toEqual([]);
    expect(checkMateClaims("looks like mate in 4 to me.", [{ evalMate: null }], [])).toEqual([]);
  });

  it("negative evalMate (mate against the player) still vouches for its N", () => {
    expect(checkMateClaims("she had mate in 2 on you.", [{ evalMate: -2 }], [])).toEqual([]);
  });

  // Round 3 (Q2 step 4): the hint shelf's own verified mate distance is a
  // NEW truth source -- before this, a mate the shelf found but that never
  // got played (so no perPly evalMate exists) could only ever be DENIED.
  it("a mate claim grounded in the hint shelf validates clean (trace-190)", () => {
    // Before round 3, the truth set was empty here and the model could only
    // DENY the mate.
    const violations = checkMateClaims(
      "there's a forced mate in 3 starting with Ng5",
      [],
      [],
      3 // NEW: hintShelfMateN -- the shelf's evalMate distance
    );
    expect(violations).toHaveLength(0);
  });

  it("a mate claim with NO grounding is still blocked", () => {
    const violations = checkMateClaims("there's a forced mate in 5", [], [], null);
    expect(violations.length).toBeGreaterThan(0);
  });
});

// A2 (live-telemetry round, 2026-09-22): same-set test for
// mateClaimSentences -- hand-verified against this fixture: sentence 0 has
// no "mate in N" claim, sentence 1 does.
// RED condition (verify by reverting): if mateClaimSentences is changed to
// test against the whole text instead of per-sentence (losing sentence
// attribution), this exact-shape assertion on which INDEX matched fails.
describe("mateClaimSentences (A2 same-set test)", () => {
  it("reports exactly the sentences containing a mate-in-N claim", () => {
    const text = "you're up material here. there's mate in 3 starting with Ng5.";
    expect(mateClaimSentences(text)).toEqual([{ sentence: 1 }]);
  });
});
