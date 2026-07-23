import { describe, it, expect } from "vitest";
import {
  countWords,
  countSentences,
  checkCompleteness,
  checkLength,
  checkPendingAwareness,
  scoreAnswer,
  summarizePipeline,
  type AnswerRow,
} from "./score";
import { medianOf, aggregateAxis, type RepAxis } from "./render";
import { decideModel, DEFAULT_MODEL, type DecideInputs } from "./decide";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("move your knight to f3 and you're fine.")).toBe(8);
  });
  it("treats an empty string as zero words", () => {
    expect(countWords("")).toBe(0);
  });
  it("collapses multiple spaces", () => {
    expect(countWords("one   two    three")).toBe(3);
  });
});

describe("countSentences", () => {
  it("counts terminator runs", () => {
    expect(countSentences("first. second! third?")).toBe(3);
  });
  it("treats a run of terminators as one sentence end", () => {
    expect(countSentences("really?!")).toBe(1);
  });
  it("floors at 1 for non-empty text with no terminal punctuation", () => {
    expect(countSentences("trails off without punctuation")).toBe(1);
  });
  it("is 0 for empty text", () => {
    expect(countSentences("")).toBe(0);
  });
});

describe("checkCompleteness", () => {
  it("passes text ending in a period", () => {
    expect(checkCompleteness("that's the idea.").pass).toBe(true);
  });
  it("passes text ending in a quoted period", () => {
    expect(checkCompleteness('she said "no."').pass).toBe(true);
  });
  it("fails text that trails off mid-sentence", () => {
    expect(checkCompleteness("that's the idea and then it just tr").pass).toBe(false);
  });
});

describe("checkLength", () => {
  it("passes a short standard answer within 45 words / 3 sentences", () => {
    const text = "move your knight to f6. it develops a piece and keeps your king safe.";
    const result = checkLength(text, false);
    expect(result.pass).toBe(true);
  });
  it("fails a standard answer over 45 words", () => {
    const longText = Array.from({ length: 50 }, () => "word").join(" ") + ".";
    expect(checkLength(longText, false).pass).toBe(false);
  });
  it("fails a standard answer over 3 sentences", () => {
    const text = "one. two. three. four.";
    expect(checkLength(text, false).pass).toBe(false);
  });
  it("applies the tighter affirmation budget (<=20 words, <=2 sentences)", () => {
    const text = Array.from({ length: 21 }, () => "word").join(" ") + ".";
    expect(checkLength(text, true).pass).toBe(false);
    expect(checkLength(text, false).pass).toBe(true); // same text passes the looser standard budget
  });
});

describe("checkPendingAwareness", () => {
  const pending = { pieceKind: "n", from: "g1", to: "f3" };

  it("passes when the answer names the destination square", () => {
    expect(checkPendingAwareness("that leaves your knight loose once it lands on f3.", pending)).toBe(true);
  });
  it("passes when the answer names both the piece word and the origin square", () => {
    expect(checkPendingAwareness("your knight on g1 has better options.", pending)).toBe(true);
  });
  it("fails when the answer names neither the destination nor piece+origin", () => {
    expect(checkPendingAwareness("develop a piece toward the center first.", pending)).toBe(false);
  });
  it("fails when a bare piece word appears without 'your', the origin, or the destination", () => {
    // "the knight" is not "your knight" -> mentionsYourPiece stays false.
    expect(checkPendingAwareness("the knight has better options.", pending)).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(checkPendingAwareness("Once it lands on F3 that's fine.", pending)).toBe(true);
  });

  // Audit iter 1: the coach's natural register describes retreats /
  // developments / refutations without printing either square. The
  // square-substring formula false-negatived on these (7 disagreements).
  // Third disjunct: pass when the pending piece is possessed by the player
  // ("your knight") or, for a pawn move, described as "the pawn push".
  it("passes a described-not-named retreat via 'your <piece>' (audit iter 1: PD2)", () => {
    const p = { pieceKind: "n", from: "f3", to: "e1" };
    expect(
      checkPendingAwareness(
        "that's fine. it steps your knight away from the bishop's attack while keeping it ready to hop back into the game.",
        p,
      ),
    ).toBe(true);
  });
  it("matches a compound-adjective piece name after 'your' (e.g. 'your light-square bishop')", () => {
    const p = { pieceKind: "b", from: "c3", to: "e5" };
    expect(
      checkPendingAwareness("your light-square bishop takes on c8 and her queen recaptures.", p),
    ).toBe(true);
  });
  it("passes a pending pawn move described as 'the pawn push' (audit iter 1: PD8)", () => {
    const p = { pieceKind: "p", from: "h2", to: "h3" };
    expect(
      checkPendingAwareness(
        "your bishop on f5 is attacked by her bishop on c8 and nothing defends it, so the pawn push leaves it hanging.",
        p,
      ),
    ).toBe(true);
  });
});

function mkRow(overrides: Partial<AnswerRow> = {}): AnswerRow {
  return {
    id: "open-01",
    fixtureId: "C1",
    question: "what did i do right so far?",
    tag: "open",
    probe: false,
    text: "you developed your knight early and kept your king safe.",
    source: "model",
    regenCount: 0,
    latencyMs: 4000,
    ...overrides,
  };
}

describe("scoreAnswer", () => {
  it("marks a template/timeout row as a pipeline failure, excluded from every voice axis", () => {
    const sc = scoreAnswer(mkRow({ source: "template", cause: "backend-down", text: "keep it on the board." }));
    expect(sc.pipelineFailure).toBe(true);
    expect(sc.completeness).toBeUndefined();
    expect(sc.length).toBeUndefined();
    expect(sc.jargon).toBeUndefined();
    expect(sc.aiIsmCasing).toBeUndefined();
  });

  it("scores a clean model answer as passing on every axis", () => {
    const sc = scoreAnswer(mkRow({ text: "move your knight to f6. it keeps your king safer." }));
    expect(sc.pipelineFailure).toBe(false);
    expect(sc.completeness?.pass).toBe(true);
    expect(sc.length?.pass).toBe(true);
    expect(sc.jargon?.pass).toBe(true);
    expect(sc.aiIsmCasing?.pass).toBe(true);
  });

  it("fails the jargon axis on a model answer using raw SAN", () => {
    const sc = scoreAnswer(mkRow({ text: "Nf3 develops with tempo." }));
    expect(sc.jargon?.pass).toBe(false);
  });

  it("fails the ai-ism/casing axis on a model answer with a banned word", () => {
    const sc = scoreAnswer(mkRow({ text: "let's leverage this position for a strong follow-up." }));
    expect(sc.aiIsmCasing?.pass).toBe(false);
  });

  it("scores pending-awareness only when the row carries a pending move", () => {
    const withPending = scoreAnswer(
      mkRow({ text: "that knight lands on f3 and does nothing for you.", pending: { pieceKind: "n", from: "g1", to: "f3" } })
    );
    expect(withPending.pendingAwareness?.pass).toBe(true);

    const withoutPending = scoreAnswer(mkRow({ text: "a plain answer with no pending move in view." }));
    expect(withoutPending.pendingAwareness).toBeUndefined();
  });

  it("applies the affirmation length budget when tag is affirmation", () => {
    const longAffirmation = mkRow({
      tag: "affirmation",
      text: Array.from({ length: 21 }, () => "word").join(" ") + ".",
    });
    expect(scoreAnswer(longAffirmation).length?.pass).toBe(false);
  });
});

describe("summarizePipeline", () => {
  it("computes template rate and latency median/p90 over a set of rows", () => {
    const rows = [
      { source: "model", regenCount: 0, latencyMs: 1000 },
      { source: "model", regenCount: 1, latencyMs: 2000 },
      { source: "template", regenCount: 1, latencyMs: 3000 },
      { source: "model", regenCount: 0, latencyMs: 4000 },
    ];
    const summary = summarizePipeline(rows);
    expect(summary.total).toBe(4);
    expect(summary.templateCount).toBe(1);
    expect(summary.templateRate).toBeCloseTo(0.25);
    expect(summary.medianLatencyMs).toBe(2500);
  });

  it("handles an empty row set without dividing by zero", () => {
    const summary = summarizePipeline([]);
    expect(summary.total).toBe(0);
    expect(summary.templateRate).toBe(0);
    expect(summary.medianLatencyMs).toBe(0);
  });
});

describe("medianOf", () => {
  it("returns the middle value of an odd-length set", () => {
    expect(medianOf([0.6, 0.9, 0.7])).toBe(0.7);
  });
  it("interpolates (averages the two middles) on an even-length set", () => {
    expect(medianOf([0.2, 0.4, 0.6, 0.8])).toBeCloseTo(0.5);
  });
  it("does not mutate the input order", () => {
    const input = [0.9, 0.1, 0.5];
    medianOf(input);
    expect(input).toEqual([0.9, 0.1, 0.5]);
  });
});

describe("aggregateAxis", () => {
  const rep = (n: number, rate: number | null): RepAxis => ({ rep: n, rate, n: 10 });

  it("returns median/min/max across three reps", () => {
    const agg = aggregateAxis([rep(1, 0.6), rep(2, 0.9), rep(3, 0.7)]);
    expect(agg.median).toBe(0.7);
    expect(agg.min).toBe(0.6);
    expect(agg.max).toBe(0.9);
    expect(agg.perRep).toHaveLength(3);
  });

  it("ignores null reps when some are present", () => {
    const agg = aggregateAxis([rep(1, null), rep(2, 0.8), rep(3, 0.4)]);
    expect(agg.median).toBeCloseTo(0.6);
    expect(agg.min).toBe(0.4);
    expect(agg.max).toBe(0.8);
  });

  it("returns all-null when every rep is null", () => {
    const agg = aggregateAxis([rep(1, null), rep(2, null)]);
    expect(agg.median).toBeNull();
    expect(agg.min).toBeNull();
    expect(agg.max).toBeNull();
    expect(agg.perRep).toHaveLength(2);
  });
});

describe("decideModel", () => {
  const pair = (
    sMed: number,
    sLo: number,
    sHi: number,
    oMed: number,
    oLo: number,
    oHi: number
  ) => ({
    sonnet: { median: sMed, min: sLo, max: sHi },
    opus: { median: oMed, min: oLo, max: oHi },
  });
  // A deliberately non-deciding (equal, overlapping) axis pair.
  const flat = pair(0.9, 0.88, 0.92, 0.9, 0.88, 0.92);

  it("decides on jargon when the delta exceeds the threshold and rep ranges are disjoint", () => {
    const inputs: DecideInputs = {
      jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97),
      length: flat,
      pending: flat,
      pendingAudited: false,
    };
    const d = decideModel(inputs);
    expect(d.decidedBy).toBe("jargon");
    expect(d.winner).toBe("opus");
  });

  it("falls through jargon when the ranges overlap despite a median gap", () => {
    const inputs: DecideInputs = {
      // medians differ by 0.10 but the rep ranges overlap -> not decisive
      jargon: pair(0.8, 0.7, 0.9, 0.9, 0.82, 0.98),
      length: flat,
      pending: flat,
      pendingAudited: false,
    };
    const d = decideModel(inputs);
    expect(d.decidedBy).not.toBe("jargon");
    expect(d.winner).toBe("tie-keep-default");
  });

  it("ignores pending unless the checker was audited", () => {
    const inputs: DecideInputs = {
      jargon: flat,
      length: flat,
      pending: pair(0.5, 0.48, 0.52, 0.9, 0.88, 0.92),
      pendingAudited: false,
    };
    const d = decideModel(inputs);
    expect(d.decidedBy).toBe("default");
    const audited = decideModel({ ...inputs, pendingAudited: true });
    expect(audited.decidedBy).toBe("pending");
    expect(audited.winner).toBe("opus");
  });

  it("returns tie-keep-default (semantically sonnet) when no axis decides", () => {
    const inputs: DecideInputs = { jargon: flat, length: flat, pending: flat, pendingAudited: true };
    const d = decideModel(inputs);
    expect(d.winner).toBe("tie-keep-default");
    expect(d.decidedBy).toBe("default");
    expect(DEFAULT_MODEL).toBe("sonnet");
    expect(d.reasoning.toLowerCase()).toContain("sonnet");
  });
});
