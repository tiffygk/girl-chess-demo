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

// Missed-win round (2026-07-28): shared real-game fixture (game 150,
// 2026-07-28, her real 91-ply win). Ply 55 (Nf7+) declined Qh8#. Repeated
// per repo convention (each test file keeps its own copy).
const GAME150_SANS: SummaryMove[] = [
  "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
  "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
  "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
  "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
  "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
  "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
  "Qh6+","Kd5","Be7","Kc4","Qc6#",
].map((san, i) => ({ ply: i + 1, san }));

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
      ["eval-drop", "good-moment", "king-safety", "missed-punish", "missed-mate", "unconverted"].sort()
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

  // Coach truth-speed round (2026-07-27): GENERIC_TIP ("look one move deeper
  // before you commit next time") is gone — the owner's playtest report
  // flagged it as a useless sentence she'd already done. A turning point
  // with no inferable motif now has no nextTime at all, rather than a
  // filler tip.
  it("a turning point with no inferable motif has no nextTime at all", () => {
    const note = buildTurningPointNote(tp({ label: "the losing move", kind: "backfill" }), undefined, undefined);
    expect(note.nextTime).toBeUndefined();
  });

  it("an unmapped label (e.g. the backfill's 'the clincher') also has no nextTime", () => {
    const note = buildTurningPointNote(tp({ label: "the clincher", kind: "backfill" }), undefined, undefined);
    expect(note.nextTime).toBeUndefined();
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

  // Debrief Plain-English Notation round (Task 2): with gameSans supplied,
  // the strong-move mention renders in plain English from the position
  // before its own ply, not raw SAN.
  it("renders the strong move in plain English when gameSans is given", () => {
    const note = buildTurningPointNote(
      tp({ label: "strong move", san: "Qh5", ply: 3 }),
      undefined,
      undefined,
      SCHOLARS_MATE_SANS
    );
    expect(note.didWell).toContain("queen to h5");
    expect(note.didWell).not.toContain("Qh5");
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

  // Debrief Plain-English Notation round (Task 2): with gameSans supplied,
  // both the played move (tp.san, from the position before its own ply) and
  // the stronger idea (line.bestSan, from the same seed position
  // whatMayHaveHappened uses) render in plain English, not raw SAN.
  it("renders both the played move and the stronger idea in plain English when gameSans is given", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nf6", ply: 6 }),
      undefined,
      line({ ply: 6, pvSans: ["Qxf7#"], bestSan: "Qxf7#" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.couldImprove).toContain("knight to f6");
    expect(note.couldImprove).toContain("queen takes on f7, checkmate");
    expect(note.couldImprove).not.toContain("Nf6");
    expect(note.couldImprove).not.toMatch(/\bQxf7#\b/);
  });
});

// Highlight-a-move (Task 7): buildTurningPointNote's fields are all
// optional -- a turning point with a neutral label (e.g. "strong move")
// and no missedPunish/line-mismatch naturally renders NO couldImprove at
// all (confirmed by the "is absent for a strong move" test above). But a
// move she flagged as uncertain must always say something true, not go
// silent -- the 5th `highlighted` param opts a ply into an honest fallback
// when the existing logic left couldImprove unset.
describe("highlighted-move fallback (Task 7)", () => {
  // A real, independently legal game reaching ply 11 with Qd2 played there
  // (1.d4 d5 2.Nf3 Nf6 3.Nc3 Nc6 4.Bf4 Bf5 5.e3 e6 6.Qd2) -- verified via
  // chess.js, same fixture discipline as highlightedMoves.test.ts.
  const GAME_TO_PLY_11 = ["d4", "d5", "Nf3", "Nf6", "Nc3", "Nc6", "Bf4", "Bf5", "e3", "e6", "Qd2"].map(
    (san, i) => ({ ply: i + 1, san })
  );

  it("a highlighted move with no fault affirms the instinct instead of inventing one", () => {
    const note = buildTurningPointNote(
      tp({ ply: 11, san: "Qd2", label: "strong move" }),
      undefined,
      line({ ply: 11, bestSan: "Qd2" }),
      GAME_TO_PLY_11,
      true
    );
    expect(note.couldImprove).toMatch(/nothing here was a mistake/);
    expect(note.couldImprove).not.toMatch(/should have/);
  });

  it("a highlighted move that missed a stronger idea names it, honestly, instead of staying silent", () => {
    const note = buildTurningPointNote(
      tp({ ply: 11, san: "Qd2", label: "strong move" }),
      undefined,
      line({ ply: 11, bestSan: "Nd5" }), // a different, hypothetical stronger idea
      GAME_TO_PLY_11,
      true
    );
    expect(note.couldImprove).toBeTruthy();
    // Renders in plain English (same convention as the rest of this file's
    // clauses) since Nd5 is actually legal at the seed position, not raw SAN.
    expect(note.couldImprove).toContain("knight takes on d5");
  });

  it("does not touch an existing couldImprove -- the fallback only fills a genuine gap", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nxe5" }),
      undefined,
      undefined,
      undefined,
      true
    );
    expect(note.couldImprove).toContain("Nxe5");
    expect(note.couldImprove).not.toMatch(/you highlighted this one/);
  });

  it("a non-highlighted ply with the same neutral label still has no couldImprove", () => {
    const note = buildTurningPointNote(tp({ label: "strong move" }), undefined, undefined, undefined, false);
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

  // Debrief Plain-English Notation round (Task 2): the old behavior dumped
  // the WHOLE pv ("if instead Bxb5, then a6 Ba4.") — a beginner-unreadable
  // 18-move wall in the worst real case. The outcome is already carried by
  // the separate "this opens up" clause, so only the first move survives.
  it("drops the pv dump, keeping only the first move (no gameSans: raw-SAN fallback)", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: ["Bxb5", "a6", "Ba4"] }));
    expect(note.whatMayHaveHappened).toContain("Bxb5");
    expect(note.whatMayHaveHappened).not.toContain("a6");
    expect(note.whatMayHaveHappened).not.toContain("Ba4");
  });

  // Real game, real fen: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? — a turning point at
  // ply 6 (her blunder Nf6) with a line whose seed position (player-to-move
  // after ply 6, per getTurningLines' seedPly = ply - ply%2) is the exact
  // fen Qxf7# is legal from. With gameSans in hand, whatMayHaveHappened
  // renders the pv's first move in plain English, not raw SAN.
  it("renders the first move in plain English when gameSans supplies the seed fen", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nf6", ply: 6 }),
      undefined,
      line({ ply: 6, pvSans: ["Qxf7#"], bestSan: "Qxf7#" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.whatMayHaveHappened).toBe("if instead your queen takes on f7, checkmate.");
  });

  it("never adds an interpretive claim beyond the SAN moves themselves", () => {
    const note = buildTurningPointNote(tp({}), undefined, line({ pvSans: ["Bxb5", "a6", "Ba4"] }));
    expect(note.whatMayHaveHappened).not.toMatch(/win|initiative|advantage|better position/i);
  });
});

// Coach truth-speed round (2026-07-27): the owner's verbatim playtest
// report — she played the recommended reply (queen to f6, checkmate; rook
// to g8) and the debrief still asked "what may have happened if instead...",
// forcing her to go ask the chat whether she'd already done it. Controller
// ruling (post-A1 review): buildWhatMayHaveHappened now goes silent (not a
// swapped-in congratulation) when followed — the "what may have happened:"
// label is itself a counterfactual label and putting a congratulation under
// it was the exact confusion the owner reported. The congratulation moved to
// buildDidWell instead, for BOTH parities: the pre-existing even-ply
// ("opponent" turning point she punished) branch, plus a new odd-ply
// ("her own turning point she got right") branch this wave adds.
describe("followedBest integration: no counterfactual when she played the recommended move", () => {
  it("whatMayHaveHappened is absent when she played the recommended move (odd-ply, her own turning point)", () => {
    // ply 3 (Qh5) is her own move; the pv recommends the exact move she played.
    const note = buildTurningPointNote(
      tp({ label: "the clincher", kind: "backfill", san: "Qh5", ply: 3 }),
      undefined,
      line({ ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.whatMayHaveHappened).toBeUndefined();
  });

  it("whatMayHaveHappened is absent when she played the recommended reply (even-ply, an opponent turning point)", () => {
    // ply 4 (Nc6) is the opponent's move; her reply at ply 5 (Bc4) matches
    // the pv's recommendation.
    const note = buildTurningPointNote(
      tp({ label: "opponent inaccuracy", kind: "swing", san: "Nc6", ply: 4 }),
      undefined,
      line({ ply: 4, pvSans: ["Bc4"], bestSan: "Bc4" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.whatMayHaveHappened).toBeUndefined();
  });

  it("didWell congratulates ('you punished it') on an even-ply (opponent) turning point she followed, even without tp.punishSan set", () => {
    // ply 4 (Nc6) is the opponent's move; her reply at ply 5 (Bc4) matches
    // the pv's recommendation. No tp.punishSan is set here (that's the
    // separate, pre-existing turningPoints.ts credit-assignment path) — this
    // is followedBest independently confirming the same fact off the line.
    const note = buildTurningPointNote(
      tp({ label: "opponent inaccuracy", kind: "swing", san: "Nc6", ply: 4 }),
      undefined,
      line({ ply: 4, pvSans: ["Bc4"], bestSan: "Bc4" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.didWell).toBeTruthy();
    expect(note.didWell).toContain("you punished it");
    expect(note.didWell).toContain("move 3");
  });

  it("an odd-ply followed turning point still congratulates in didWell", () => {
    // ply 3 (Qh5) is her own move; the pv recommends the exact move she
    // played. Not labeled "strong move" (that branch already covers its own
    // congratulation), so this is the new odd-ply followedBest branch.
    const note = buildTurningPointNote(
      tp({ label: "the clincher", kind: "backfill", san: "Qh5", ply: 3 }),
      undefined,
      line({ ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.didWell).toBeTruthy();
    expect(note.didWell).toBe("you found it. your queen to h5 was the top move here.");
  });

  it("couldImprove drops the 'stronger idea' clause when she played the recommended move", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Qh5", ply: 3 }),
      undefined,
      line({ ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" }),
      SCHOLARS_MATE_SANS
    );
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).not.toMatch(/stronger idea/);
  });

  // Review fix (Wave F, 2026-07-27, review.md finding 6): buildCouldImprove's
  // guard went from `line.bestSan !== tp.san` to `!fb?.followed` -- with fb
  // undefined (gameSans unavailable, so followedBest has nothing to check
  // against), that reads as "didn't follow it" and renders "…was the
  // stronger idea" about the move she just played, whenever bestSan happens
  // to equal tp.san. Not reachable from DebriefPage today (it always passes
  // gameSans), but wrong on its own terms -- this proves the guard itself is
  // correct without relying on that caller discipline.
  it("couldImprove falls back to the direct SAN comparison (and so drops 'stronger idea') when fb is undefined but bestSan equals the played move", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Qh5", ply: 3 }),
      undefined,
      line({ ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" })
      // gameSans omitted entirely -- fb is undefined inside buildCouldImprove.
    );
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).not.toMatch(/stronger idea/);
  });

  it("couldImprove still shows 'stronger idea' when fb is undefined and bestSan genuinely differs from the played move", () => {
    const note = buildTurningPointNote(
      tp({ label: "blunder", san: "Nxe5", ply: 3 }),
      undefined,
      line({ ply: 3, pvSans: ["Nf3"], bestSan: "Nf3" })
      // gameSans omitted -- fb undefined, falls back to the direct SAN
      // comparison, which correctly finds bestSan ("Nf3") !== tp.san ("Nxe5").
    );
    expect(note.couldImprove).toBeTruthy();
    expect(note.couldImprove).toMatch(/stronger idea/);
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

describe("missed-win note", () => {
  const missedTp = tp({
    rank: 3, ply: 55, san: "Nf7+", label: "missed mate", deltaP: 0,
    lowConfidence: false, kind: "missed-win", mateIn: 1, missedCount: 5,
  });
  const missedLine = { ply: 55, pvSans: ["Qh8#"], bestSan: "Qh8#" };

  it("names the mate, what she played, and the repeat count", () => {
    const note = buildTurningPointNote(missedTp, undefined, missedLine, GAME150_SANS);
    expect(note.couldImprove).toBe(
      "you had checkmate in one here. your queen to h8 ends it on the spot. you played knight to f7, check instead. this happened 5 times this game."
    );
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["missed-mate"]);
    // The existing counterfactual + opportunity machinery serves this card unchanged:
    expect(note.whatMayHaveHappened).toBe("if instead your queen to h8, checkmate.");
    expect(note.opportunity).toContain("mate in 1");
  });

  it("degrades honestly with no line: states the miss without inventing the move", () => {
    const note = buildTurningPointNote({ ...missedTp, missedCount: 1 }, undefined, undefined, GAME150_SANS);
    expect(note.couldImprove).toBe(
      "you had checkmate in one here. you played knight to f7, check instead."
    );
  });

  // Union review ADDENDUM 2 fix (2026-07-31, the fourth C1 producer): mateIn
  // 1 alone (missedTp above) proves nothing -- "checkmate in one" AND "ends
  // it on the spot" were ALSO the old hardcoded text, so neither can
  // discriminate "reads tp.mateIn" from "always assumes one". Game 160's
  // real shape: ply 69, mateIn 4 -- before this fix the card said "you had
  // checkmate in one here. your Qh8+ ends it on the spot", false on both
  // counts (she had mate in FOUR, and the named move only starts that mate).
  it("reads the real mate distance and 'starts a forced mate' phrasing for mateIn > 1 (game 160's real shape)", () => {
    const tp160 = tp({
      rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8,
    });
    const line69 = { ply: 69, pvSans: ["Qxg7+"], bestSan: "Qxg7+" };
    const note = buildTurningPointNote(tp160, undefined, line69, GAME150_SANS);
    expect(note.couldImprove).toContain("you had checkmate in four here.");
    expect(note.couldImprove).toContain("starts a forced mate in four");
    expect(note.couldImprove).not.toContain("checkmate in one");
    expect(note.couldImprove).not.toContain("ends it on the spot");
  });

  // N1 (owner report 2026-08-21). Same real GAME150_SANS tail already used
  // above -- ply 89 Be7 (her), ply 90 Kc4 (mallow), ply 91 Qc6# (her mate)
  // -- reused rather than the plan's own truncated fixture, which throws
  // inside fenAtPly's from-the-start replay (see debriefBullets.test.ts's
  // matching N1 block for the full explanation). mateIn is set to 4, an
  // artificial override for this unit -- the point under test is the
  // WORDING when the real game finished faster than the stored prediction,
  // not a claim about what game 150's real turning point actually recorded.
  it("does not imply she was slow when she finished faster than the forced line", () => {
    const fasterTp = tp({
      rank: 3, ply: 89, san: "Be7", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 4,
    });
    const fasterLine = { ply: 89, bestSan: "Be7", pvSans: [] };
    const note = buildTurningPointNote(fasterTp, undefined, fasterLine, GAME150_SANS);
    expect(note.couldImprove).toContain("forced mate in four");
    expect(note.couldImprove).toContain("mate in two");
    expect(note.couldImprove).not.toMatch(/instead\.$/);
    expect(note.couldImprove).toContain("king to c4");
    // HIGH-1 (Opus review, N1 fix wave): "was not forced" is unprovable from
    // the client's inputs (no eval data reaches this renderer) and false on
    // real games where the mate survived her move (174, 178). Never assert it.
    expect(note.couldImprove).not.toMatch(/was not forced/);
  });

  // HIGH-2 (Opus review, N1 fix wave): mateOutcomeFor measures only the
  // anchor ply. When missedCount > 1 a second, unmeasured miss exists by
  // construction (games 175/178, real data) -- crediting her on the anchor
  // alone is an unproven claim. Same ply/mateIn/fixture as the faster test
  // above, missedCount raised to 2 to isolate the gate.
  it("does not credit her when a second, unmeasured miss exists (missedCount > 1)", () => {
    const repeatTp = tp({
      rank: 3, ply: 89, san: "Be7", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 2,
    });
    const line = { ply: 89, bestSan: "Be7", pvSans: [] };
    const note = buildTurningPointNote(repeatTp, undefined, line, GAME150_SANS);
    expect(note.couldImprove).not.toContain("still ended in mate");
    expect(note.couldImprove).toMatch(/instead/);
    expect(note.couldImprove).toContain("this happened 2 times this game");
  });
});

// Truth round (2026-07-29), Task 3: the game-151 owner ruling
// (feedback-unconverted-copy.md) applies to this card too. Never a blame
// line by default (rca B5) -- but the annotator's verified repetition
// anchor (Task 2, commit c1d1905) sometimes carries a real, stored mate
// reading, and the card should say so rather than flatten it to "nothing
// hung" when a true fact is available.
describe("unconverted note (game-151 owner ruling, feedback-unconverted-copy.md)", () => {
  const unconvertedTp = tp({
    rank: 2, ply: 43, san: "Qg5+", label: "unconverted win", deltaP: 0,
    lowConfidence: false, kind: "unconverted", endKind: "repetition", mateIn: 12,
  });

  it("states the stored mate reading when the anchor carries one", () => {
    const note = buildTurningPointNote(unconvertedTp, undefined, undefined);
    expect(note.couldImprove).toContain("the win was on the board");
    expect(note.couldImprove).toContain("mate in twelve");
    expect(note.nextTime).toBe(NEXT_TIME_TIPS["unconverted"]);
    expect(note.nextTime).toContain("new progress");
    for (const field of [note.couldImprove, note.nextTime]) {
      expect(field).not.toMatch(/blunder|mistake|—/);
    }
  });

  it("degrades to the plain fact with no mate claim when the anchor has no proven alternative", () => {
    const note = buildTurningPointNote({ ...unconvertedTp, mateIn: undefined }, undefined, undefined);
    expect(note.couldImprove).toBe(
      "from this move the win was on the board, and the game ended level from here. nothing hung; the finish just never came."
    );
    expect(note.couldImprove).not.toContain("mate in");
  });

  // review-3.md MEDIUM finding 4: the card tip was documented as "generic
  // across endKinds" but named repetition unconditionally -- a stalemate or
  // fifty-move unconverted game showed "treat a repeated position as a stop
  // sign" on the card while the bullets right next to it correctly said
  // "the stalemate". No repetition happened in either fixture below; the
  // tip must not claim one did.
  it("the card tip follows the ending kind: a stalemate unconverted point does NOT get the repetition-specific tip", () => {
    const stalemateTp = { ...unconvertedTp, endKind: "stalemate" as const, mateIn: undefined };
    const note = buildTurningPointNote(stalemateTp, undefined, undefined);
    expect(note.nextTime).not.toBe(NEXT_TIME_TIPS["unconverted"]);
    expect(note.nextTime).not.toContain("repeated position");
    expect(note.nextTime).not.toContain("stop sign");
  });

  it("a fifty-moves unconverted point also gets the non-repetition tip, and a real repetition still gets the repetition-specific one", () => {
    const fiftyMovesTp = { ...unconvertedTp, endKind: "fifty moves" as const, mateIn: undefined };
    const note = buildTurningPointNote(fiftyMovesTp, undefined, undefined);
    expect(note.nextTime).not.toContain("repeated position");

    const repetitionNote = buildTurningPointNote(unconvertedTp, undefined, undefined);
    expect(repetitionNote.nextTime).toBe(NEXT_TIME_TIPS["unconverted"]);
    expect(repetitionNote.nextTime).toContain("repeated position");
  });
});
