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
  it("fails when only the piece word is present without the origin square", () => {
    expect(checkPendingAwareness("your knight has better options.", pending)).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(checkPendingAwareness("Once it lands on F3 that's fine.", pending)).toBe(true);
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
