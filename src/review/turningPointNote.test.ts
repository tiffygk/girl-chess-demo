// Increment 3.91 Task 3: the four-part turning-point note. Pure,
// deterministic, no LLM — tests pin the motif->tip bank, the generic
// fallback (declared cut), and that each of the four parts only appears
// when its underlying fact is actually present (never fabricated).

import { describe, it, expect } from "vitest";
import { buildTurningPointNote, opportunityForLine, NEXT_TIME_TIPS } from "./turningPointNote";
import type { TurningPoint, MoveClassification, TurningLine, SummaryMove } from "../game/api";

// Scholar's Mate up to black's losing 3rd move — a real, independently
// checkable game (1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6??), used below as a genuine
// gameSans fixture so opportunityForLine/buildTurningPointNote's fenAtPly
// replay lands on an actual position, not a synthetic one.
const SCHOLARS_MATE_SANS: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Qh5" },
  { ply: 4, san: "Nc6" },
  { ply: 5, san: "Bc4" },
  { ply: 6, san: "Nf6" },
];

function tp(overrides: Partial<TurningPoint>): TurningPoint {
  return {
    rank: 1,
    ply: 10,
    san: "Nxe5",
    label: "blunder",
    deltaP: -0.3,
    lowConfidence: false,
    kind: "swing",
    ...overrides,
  };
}

function cls(classification: string, ply = 10): MoveClassification {
  return { ply, classification };
}

function line(overrides: Partial<TurningLine>): TurningLine {
  return { ply: 10, pvSans: [], ...overrides };
}

// No-em-dash / lowercase-copy-except-SAN check shared across assertions
// below. SAN tokens (capitalized piece letters, castling, etc.) are exempt
// per the project's hard copy rule.
function assertCleanCopy(text: string) {
  expect(text).not.toMatch(/—|--/);
  const words = text.split(/\s+/);
  for (const w of words) {
    // strip trailing punctuation before checking casing
    const bare = w.replace(/[.,!?]+$/, "");
    // SAN-looking tokens (contain digits, or are pure castling notation)
    // are exempt from the lowercase check.
    if (/\d/.test(bare) || bare === "O-O" || bare === "O-O-O") continue;
    // a token starting with an uppercase letter that ISN'T at the very
    // start of the string is only allowed if it looks like SAN (starts
    // with N/B/R/Q/K and has a following lowercase file/rank char, or is
    // a single capital move like "Bxb5").
    if (/^[A-Z]/.test(bare) && text.indexOf(w) !== 0) {
      expect(/^[NBRQKO][a-hx1-8=+#]/.test(bare) || /^[a-h][1-8]/.test(bare)).toBe(true);
    }
  }
}

describe("NEXT_TIME_TIPS motif bank", () => {
  it("has a distinct tip for every declared motif", () => {
    const motifs = Object.keys(NEXT_TIME_TIPS);
    expect(motifs.sort()).toEqual(
      ["eval-drop", "good-moment", "king-safety", "missed-punish"].sort()
    );
    const tips = Object.values(NEXT_TIME_TIPS);
    expect(new Set(tips).size).toBe(tips.length);
  });

  it("eval-drop: her own blunder maps to the eval-drop tip, not a hung-piece claim", () => {
    const note = buildTurningPointNote(tp({ label: "blunder" }), undefined, undefined);
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["eval-drop"]);
    expect(note.nextTime).not.toMatch(/hang|hanging/i);
  });

  it("eval-drop: mistake/inaccuracy also maps to the eval-drop tip", () => {
    const mistake = buildTurningPointNote(tp({ label: "mistake" }), undefined, undefined);
    expect(mistake.nextTime).toBe(NEXT_TIME_TIPS["eval-drop"]);
    const inaccuracy = buildTurningPointNote(tp({ label: "inaccuracy" }), undefined, undefined);
    expect(inaccuracy.nextTime).toBe(NEXT_TIME_TIPS["eval-drop"]);
    // article grammar: "an inaccuracy", never "a inaccuracy" (2026-07-19 gate)
    expect(inaccuracy.couldImprove).toContain("an inaccuracy");
    expect(mistake.couldImprove).toContain("a mistake");
  });

  it("king-safety: an episode turning point maps to the king-safety tip", () => {
    const note = buildTurningPointNote(
      tp({ label: "king pressure", kind: "episode", ply: 30, plyEnd: 36 }),
      undefined,
      undefined
    );
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["king-safety"]);
  });

  it("missed-punish: missedPunish flag maps to the missed-punish tip regardless of label", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", missedPunish: true }),
      undefined,
      undefined
    );
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["missed-punish"]);
  });

  it("good-moment: a strong move or a punished opponent blunder maps to the good-moment tip", () => {
    const strong = buildTurningPointNote(tp({ label: "strong move" }), undefined, undefined);
    expect(strong.nextTime).toBe(NEXT_TIME_TIPS["good-moment"]);

    const punished = buildTurningPointNote(
      tp({ label: "opponent blunder", punishSan: "Qxb5" }),
      undefined,
      undefined
    );
    expect(punished.nextTime).toBe(NEXT_TIME_TIPS["good-moment"]);
  });

  it("unrecognized motif falls back to a generic tip (declared cut)", () => {
    const note = buildTurningPointNote(tp({ label: "the losing move", kind: "backfill" }), undefined, undefined);
    expect(note.nextTime).toBeTruthy();
    expect(Object.values(NEXT_TIME_TIPS)).not.toContain(note.nextTime);
  });

  it("nextTime is ALWAYS present, even with no cls/line data at all", () => {
    const note = buildTurningPointNote(tp({ label: "the clincher", kind: "backfill" }), undefined, undefined);
    expect(note.nextTime).toBeTruthy();
    expect(typeof note.nextTime).toBe("string");
  });

  // Adversarial: a "strong move" turning point in a winning position must
  // never produce "when you're worse" / "trade down" language — that claim
  // isn't supported by a strong-move label alone (could be winning, could be
  // equal, could be worse; the label doesn't say).
  it("adversarial: a strong move in a winning position has no when-you're-worse / trade-down text", () => {
    const note = buildTurningPointNote(
      tp({ label: "strong move", san: "Qh6", ply: 40 }),
      undefined,
      undefined
    );
    expect(note.nextTime).not.toMatch(/when you're worse|trade down|simplify/i);
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["good-moment"]);
  });

  // Adversarial: a plain blunder must not tell her to check what she left
  // hanging — a blunder could be a missed mate, a walked-into fork, a
  // back-rank issue, anything. The eval-band label alone doesn't establish
  // a hanging piece.
  it("adversarial: a blunder does not claim something was left hanging", () => {
    const note = buildTurningPointNote(tp({ label: "blunder" }), undefined, undefined);
    expect(note.nextTime).not.toMatch(/hang|hanging/i);
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["eval-drop"]);
  });
});

describe("didWell (part i)", () => {
  it("is present for a king-pressure episode (good defense)", () => {
    const note = buildTurningPointNote(
      tp({ label: "king pressure", kind: "episode", ply: 30, plyEnd: 36 }),
      undefined,
      undefined
    );
    expect(note.didWell).toBeTruthy();
    expect(note.didWell).toContain("move 15");
  });

  it("is present for a strong move (good moment)", () => {
    const note = buildTurningPointNote(tp({ label: "strong move", san: "Nd4", ply: 14 }), undefined, undefined);
    expect(note.didWell).toBeTruthy();
    expect(note.didWell).toContain("Nd4");
  });

  it("is present when she punished an opponent blunder", () => {
    const note = buildTurningPointNote(
      tp({ label: "opponent blunder", punishSan: "Qxb5", ply: 12 }),
      undefined,
      undefined
    );
    expect(note.didWell).toBeTruthy();
    expect(note.didWell).toContain("Qxb5");
  });

  it("is absent for a plain blunder turning point", () => {
    const note = buildTurningPointNote(tp({ label: "blunder" }), undefined, undefined);
    expect(note.didWell).toBeUndefined();
  });
});

describe("couldImprove (part ii)", () => {
  it("a blunder with a pv yields couldImprove and whatMayHaveHappened", () => {
    const l = line({ ply: 10, pvSans: ["Bxb5", "a6", "Ba4"], bestSan: "Bxb5" });
    const note = buildTurningPointNote(tp({ label: "blunder", san: "Nxe5" }), undefined, l);
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).toContain("Nxe5");
    expect(note.whatMayHaveHappened).toBeTruthy();
    expect(note.whatMayHaveHappened).toContain("Bxb5");
  });

  it("prefers the MoveClassification label over the turning point label when both are given", () => {
    const note = buildTurningPointNote(tp({ label: "blunder" }), cls("mistake"), undefined);
    expect(note.couldImprove).toContain("mistake");
    expect(note.couldImprove).not.toContain("blunder");
  });

  // Adversarial: a blunder is an eval-magnitude band, not a tactical-cause
  // signal — it could be a hung piece, but it could just as easily be a
  // missed mate, a walked-into fork, or a positional collapse with no
  // material lost at all. couldImprove must stay true either way.
  it("adversarial: a blunder couldImprove does not claim material was dropped", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Kg1" }),
      undefined,
      line({ bestSan: "Rd8+", pvSans: ["Rd8+"] })
    );
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).not.toMatch(/dropped material|material|hang|hanging/i);
  });

  it("a missedPunish point gets couldImprove text even without a matching label nudge", () => {
    const note = buildTurningPointNote(
      tp({ label: "opponent blunder", missedPunish: true, san: "O-O" }),
      undefined,
      line({ bestSan: "Qxb5", pvSans: ["Qxb5"] })
    );
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).toContain("Qxb5");
  });

  // Adversarial: missed-punish couldImprove/nextTime must not assume the
  // stronger continuation was a capture — the missedPunish flag only says
  // she failed to punish a slip, not that the punish was material-grabbing.
  it("adversarial: missed-punish couldImprove and nextTime do not assert a capture", () => {
    const note = buildTurningPointNote(
      tp({ label: "opponent blunder", missedPunish: true, san: "O-O" }),
      undefined,
      line({ bestSan: "Rd8+", pvSans: ["Rd8+"] })
    );
    expect(note.couldImprove).not.toMatch(/take the material|capture/i);
    expect(note.nextTime).not.toMatch(/take the material|capture/i);
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["missed-punish"]);
  });

  it("is absent for a strong move (nothing to improve)", () => {
    const note = buildTurningPointNote(tp({ label: "strong move" }), undefined, undefined);
    expect(note.couldImprove).toBeUndefined();
  });

  it("is absent for an unmapped label with no missedPunish flag", () => {
    const note = buildTurningPointNote(tp({ label: "the clincher", kind: "backfill" }), undefined, undefined);
    expect(note.couldImprove).toBeUndefined();
  });
});

describe("whatMayHaveHappened (part iv)", () => {
  it("is absent when there is no line at all", () => {
    const note = buildTurningPointNote(tp({}), undefined, undefined);
    expect(note.whatMayHaveHappened).toBeUndefined();
  });

  it("is absent when the line has an empty pv and no bestSan (graceful degrade)", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: [] }));
    expect(note.whatMayHaveHappened).toBeUndefined();
  });

  it("uses bestSan alone when pvSans is empty but bestSan exists", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: [], bestSan: "Qxb5" }));
    expect(note.whatMayHaveHappened).toBeTruthy();
    expect(note.whatMayHaveHappened).toContain("Qxb5");
  });

  it("renders the full pv plainly, SAN preserved, when pvSans has multiple moves", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: ["Bxb5", "a6", "Ba4"] }));
    expect(note.whatMayHaveHappened).toContain("Bxb5");
    expect(note.whatMayHaveHappened).toContain("a6");
    expect(note.whatMayHaveHappened).toContain("Ba4");
  });

  it("never adds an interpretive claim beyond the SAN moves themselves", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: ["Bxb5", "a6", "Ba4"] }));
    expect(note.whatMayHaveHappened).not.toMatch(/win|initiative|advantage|better position/i);
  });
});

describe("opportunity (part v)", () => {
  it("opportunityForLine reports an honest, replay-provable claim when line + gameSans are both given", () => {
    const l = line({ ply: 6, pvSans: ["Qxf7#"], bestSan: "Qxf7#" });
    expect(opportunityForLine(l, SCHOLARS_MATE_SANS)).toBe("leads to mate in 1");
  });

  it("opportunityForLine is undefined without gameSans (no seed position to replay from)", () => {
    const l = line({ ply: 6, pvSans: ["Qxf7#"] });
    expect(opportunityForLine(l, undefined)).toBeUndefined();
  });

  it("opportunityForLine is undefined without a line at all", () => {
    expect(opportunityForLine(undefined, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("opportunityForLine is undefined when pvSans is empty (graceful degrade)", () => {
    const l = line({ ply: 6, pvSans: [] });
    expect(opportunityForLine(l, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("buildTurningPointNote surfaces the opportunity clause on note.opportunity when gameSans is passed", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nf6", ply: 6 }),
      undefined,
      line({ ply: 6, pvSans: ["Qxf7#"], bestSan: "Qxf7#" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.opportunity).toBe("leads to mate in 1");
  });

  it("buildTurningPointNote never fabricates an opportunity clause when gameSans is omitted (backward compatible)", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nf6", ply: 6 }),
      undefined,
      line({ ply: 6, pvSans: ["Qxf7#"], bestSan: "Qxf7#" })
    );
    expect(note.opportunity).toBeUndefined();
  });
});

describe("copy hygiene (lowercase, no em-dash, SAN preserved)", () => {
  it("every tip in NEXT_TIME_TIPS is clean copy", () => {
    for (const tip of Object.values(NEXT_TIME_TIPS)) assertCleanCopy(tip);
  });

  it("a fully-populated note is clean copy across all four parts", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nxe5", missedPunish: false }),
      undefined,
      line({ pvSans: ["Bxb5", "a6", "Ba4"], bestSan: "Bxb5" })
    );
    for (const part of [note.didWell, note.couldImprove, note.nextTime, note.whatMayHaveHappened]) {
      if (part) assertCleanCopy(part);
    }
  });

  it("an episode didWell note is clean copy", () => {
    const note = buildTurningPointNote(
      tp({ label: "king pressure", kind: "episode", ply: 30, plyEnd: 36 }),
      undefined,
      undefined
    );
    assertCleanCopy(note.didWell!);
  });
});
