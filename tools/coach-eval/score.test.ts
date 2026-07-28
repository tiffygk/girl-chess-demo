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
import {
  medianOf,
  aggregateAxis,
  buildModelSummary,
  filterFilesByArm,
  selectPrioritySubset,
  PRIORITY_TARGET_TOTAL,
  type RepAxis,
  type RepFile,
} from "./render";
import {
  decideModel,
  decideArm,
  decideAcrossArms,
  DEFAULT_MODEL,
  TIMEOUT_RATE_DECISIVE_DELTA,
  type DecideInputs,
  type ArmDecision,
} from "./decide";
import { GENERAL_QUESTIONS, BOARD_REVIEW_QUESTIONS } from "./fixtures";
import { classifyIntent } from "../../server/coach/intent";
import { GENERAL_MAX_WORDS } from "../../server/coach/chat";

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

  // Wave E1: per-arm budget selection (Task 2). board-live's default arg
  // keeps the old two-tier board-live behavior above untouched; general and
  // board-review both read GENERAL_MAX_WORDS (imported from
  // server/coach/chat.ts, never a second hardcoded number).
  describe("per-arm budget (Wave E1)", () => {
    it("defaults to board-live (45w/3s) when arm is omitted -- pre-existing call sites are unaffected", () => {
      const text = Array.from({ length: 50 }, () => "word").join(" ") + ".";
      expect(checkLength(text, false).pass).toBe(false);
      expect(checkLength(text, false, "board-live").pass).toBe(false);
    });

    it("general and board-review pass a reply over the board-live 45-word cap but under GENERAL_MAX_WORDS", () => {
      const words = 80;
      expect(words).toBeGreaterThan(45);
      expect(words).toBeLessThan(GENERAL_MAX_WORDS);
      const text = Array.from({ length: words }, () => "word").join(" ") + ".";
      expect(checkLength(text, false, "board-live").pass).toBe(false);
      expect(checkLength(text, false, "general").pass).toBe(true);
      expect(checkLength(text, false, "board-review").pass).toBe(true);
    });

    it("general/board-review still fail once GENERAL_MAX_WORDS is exceeded", () => {
      const text = Array.from({ length: GENERAL_MAX_WORDS + 5 }, () => "word").join(" ") + ".";
      expect(checkLength(text, false, "general").pass).toBe(false);
      expect(checkLength(text, false, "board-review").pass).toBe(false);
    });

    it("general/board-review do not gate on sentence count -- a many-sentence reply under the word cap still passes", () => {
      const text = Array.from({ length: 10 }, (_, i) => `sentence number ${i}`).join(". ") + ".";
      expect(checkLength(text, false, "general").pass).toBe(true);
    });
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
    arm: "board-live",
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

  // Wave E1: scoreAnswer reads row.arm (not just row.tag) to pick the length
  // budget -- a general/board-review row over 45 words but under
  // GENERAL_MAX_WORDS must pass, where the SAME text on a board-live row
  // must fail. Regression guard for the exact "arm decides the budget, not
  // tag" wiring Task 2 asks for.
  it("scores length against the row's own arm, not just its tag", () => {
    const text = Array.from({ length: 80 }, () => "word").join(" ") + ".";
    const boardLiveRow = mkRow({ arm: "board-live", tag: "open", text });
    const generalRow = mkRow({ arm: "general", tag: "general", text });
    const boardReviewRow = mkRow({ arm: "board-review", tag: "dir", text });
    expect(scoreAnswer(boardLiveRow).length?.pass).toBe(false);
    expect(scoreAnswer(generalRow).length?.pass).toBe(true);
    expect(scoreAnswer(boardReviewRow).length?.pass).toBe(true);
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

  // Bug 1 regression (coach-truth-speed round, controller-verified
  // 2026-07-28): production rows for a real timeout NEVER carry
  // source:"timeout" -- server/coach/chat.ts's chat() emits
  // source:"template" for every pipeline fallback and records the real
  // reason in `cause` ("timeout" | "validation-failed" | "backend-down" |
  // "off-topic" | "templates-only"). The old summarizePipeline filtered on
  // `r.source === "timeout"`, a value real rows never have, so
  // timeoutCount/timeoutRate silently read 0 for every rep even though the
  // owner's real game had four 45s timeouts. This fixture mirrors the exact
  // raw-row shape (source:"template", cause:"timeout") this run's
  // raw-sonnet-rep1.json actually carries for its board-live rows.
  it("counts a real timeout row (source:template, cause:timeout) toward timeoutCount, not just templateCount", () => {
    const rows = [
      { source: "model", regenCount: 0, latencyMs: 4000 },
      { source: "template", cause: "timeout", regenCount: 0, latencyMs: 45001 },
      { source: "template", cause: "timeout", regenCount: 0, latencyMs: 45001 },
      { source: "template", cause: "validation-failed", regenCount: 1, latencyMs: 6000 },
    ];
    const summary = summarizePipeline(rows);
    expect(summary.templateCount).toBe(3); // all three non-model rows
    expect(summary.timeoutCount).toBe(2); // only the two whose cause is "timeout"
    expect(summary.timeoutCount).toBeGreaterThan(0);
    expect(summary.templateRate).toBeCloseTo(0.75);
  });

  it("does not count a non-timeout pipeline failure (e.g. validation-failed) toward timeoutCount", () => {
    const rows = [
      { source: "template", cause: "backend-down", regenCount: 0, latencyMs: 5000 },
      { source: "template", cause: "off-topic", regenCount: 0, latencyMs: 3000 },
    ];
    const summary = summarizePipeline(rows);
    expect(summary.timeoutCount).toBe(0);
    expect(summary.templateCount).toBe(2);
  });

  it("still counts source:'timeout' if that literal is ever actually produced (defensive, not the real-world path)", () => {
    const rows = [{ source: "timeout", regenCount: 0, latencyMs: 45001 }];
    const summary = summarizePipeline(rows);
    expect(summary.timeoutCount).toBe(1);
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

// ---- Wave E1 (coach-truth-speed round) ------------------------------------

describe("per-arm aggregation (buildModelSummary + filterFilesByArm)", () => {
  // A minimal, typed RepFile -- rows only need the fields scoreAnswer/
  // summarizePipeline actually read.
  function mkRepFile(rep: number, rows: AnswerRow[]): RepFile {
    return { model: "sonnet", rep, path: `raw-sonnet-rep${rep}.json`, mtimeMs: rep, rows };
  }

  it("filterFilesByArm narrows rows to one arm without touching other reps' data", () => {
    const files: RepFile[] = [
      mkRepFile(1, [
        mkRow({ id: "gen-01", arm: "general", tag: "general" }),
        mkRow({ id: "open-01", arm: "board-live", tag: "open" }),
      ]),
    ];
    const generalOnly = filterFilesByArm(files, "general");
    expect(generalOnly[0].rows).toHaveLength(1);
    expect(generalOnly[0].rows[0].id).toBe("gen-01");
    // Original untouched (no mutation).
    expect(files[0].rows).toHaveLength(2);
  });

  it("buildModelSummary on an arm-filtered view only aggregates that arm's rows", () => {
    const files: RepFile[] = [
      mkRepFile(1, [
        mkRow({ id: "gen-01", arm: "general", tag: "general", text: "let's leverage this position." }), // ai-ism FAIL
        mkRow({ id: "open-01", arm: "board-live", tag: "open", text: "clean board-live answer, no violations." }),
      ]),
    ];
    const generalSummary = buildModelSummary(filterFilesByArm(files, "general"));
    // Only the one general row counted -- its ai-ism failure should be the
    // entire denominator (rate 0), not diluted by the clean board-live row.
    expect(generalSummary.axes.aiIsmCasing.median).toBe(0);
    const boardLiveSummary = buildModelSummary(filterFilesByArm(files, "board-live"));
    expect(boardLiveSummary.axes.aiIsmCasing.median).toBe(1);
  });

  it("computes a cross-rep p90 latency aggregation (latencyAgg.p90) from per-rep pipeline p90s", () => {
    const files: RepFile[] = [
      mkRepFile(1, [mkRow({ arm: "general", tag: "general", latencyMs: 10000 }), mkRow({ arm: "general", tag: "general", latencyMs: 20000 })]),
      mkRepFile(2, [mkRow({ arm: "general", tag: "general", latencyMs: 30000 }), mkRow({ arm: "general", tag: "general", latencyMs: 40000 })]),
    ];
    const summary = buildModelSummary(files);
    // Two reps -> the cross-rep median of the two reps' own p90s; min/max
    // span the two reps' p90s. Exact values aren't the point (summarizePipeline's
    // own percentile math is already unit-tested) -- what this guards is that
    // latencyAgg.p90 is a REAL per-rep aggregation, not a flat 0/pooled value.
    expect(summary.latencyAgg.p90.min).not.toBeNull();
    expect(summary.latencyAgg.p90.max).not.toBeNull();
    expect(summary.latencyAgg.p90.min!).toBeLessThan(summary.latencyAgg.p90.max!);
    expect(summary.latencyAgg.p90.perRep).toHaveLength(2);
  });

  // Bug 1, full path: buildModelSummary's pipelineAgg.timeoutRate must come
  // out non-zero when the rows it aggregates carry real timeout rows
  // (source:"template", cause:"timeout") -- the exact raw-row shape this
  // run's raw-*.json files use. Guards the render.ts layer, not just
  // summarizePipeline in isolation.
  it("aggregates a real, non-zero pipelineAgg.timeoutRate from cause:'timeout' rows across reps", () => {
    const files: RepFile[] = [
      mkRepFile(1, [
        mkRow({ arm: "board-live", source: "template", cause: "timeout", latencyMs: 45001 }),
        mkRow({ arm: "board-live", source: "model", latencyMs: 4000 }),
        mkRow({ arm: "board-live", source: "model", latencyMs: 4000 }),
      ]),
      mkRepFile(2, [
        mkRow({ arm: "board-live", source: "template", cause: "timeout", latencyMs: 45001 }),
        mkRow({ arm: "board-live", source: "template", cause: "timeout", latencyMs: 45001 }),
        mkRow({ arm: "board-live", source: "model", latencyMs: 4000 }),
      ]),
    ];
    const summary = buildModelSummary(files);
    expect(summary.pipelineAgg.timeoutRate.median).not.toBeNull();
    expect(summary.pipelineAgg.timeoutRate.median).toBeGreaterThan(0);
    expect(summary.pipeline.perRep[0].timeoutCount).toBe(1);
    expect(summary.pipeline.perRep[1].timeoutCount).toBe(2);
  });
});

describe("decideArm + decideAcrossArms (Wave E1 split decision)", () => {
  const pair = (sMed: number, sLo: number, sHi: number, oMed: number, oLo: number, oHi: number) => ({
    sonnet: { median: sMed, min: sLo, max: sHi },
    opus: { median: oMed, min: oLo, max: oHi },
  });
  const flat = pair(0.9, 0.88, 0.92, 0.9, 0.88, 0.92);

  it("board-live's decideArm falls through to decideModel's chain when no p90/timeout pair is supplied", () => {
    const inputs = { jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97), length: flat, pending: flat, pendingAudited: false };
    const viaModel = decideModel(inputs);
    const viaArm = decideArm("board-live", inputs);
    expect(viaArm.decidedBy).toBe(viaModel.decidedBy);
    expect(viaArm.winner).toBe(viaModel.winner);
    expect(viaArm.arm).toBe("board-live");
  });

  // Bug 2 regression: board-live must NOT be structurally excluded from the
  // p90-latency gate. A prior wave scoped p90 to general/board-review only
  // (an arm allow-list); this round's fix makes both reliability gates
  // input-driven for every arm, so board-live decides on p90 exactly like
  // the other two arms when the gap is decisive and ranges disjoint.
  it("board-live's p90-latency axis decides FIRST (ahead of jargon) when supplied and decisive -- the exact axis this round's fix restores", () => {
    const inputs = {
      jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97), // jargon alone would pick opus
      length: flat,
      pending: flat,
      pendingAudited: false,
      p90LatencyMs: pair(37100, 30000, 40000, 17000, 13000, 20000), // this run's own board-live gap
    };
    const d = decideArm("board-live", inputs);
    expect(d.decidedBy).toBe("p90-latency");
    expect(d.winner).toBe("opus"); // lower p90 wins
  });

  // Bug 2 (timeout-rate axis): reliability outranks prose length AND p90
  // latency -- a model with a decisively worse timeout rate loses even when
  // its p90/jargon numbers would otherwise favor it.
  it("timeout-rate decides FIRST, ahead of p90-latency and jargon, for every arm", () => {
    for (const arm of ["board-live", "general", "board-review"] as const) {
      const inputs = {
        jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97), // jargon alone would pick opus
        length: flat,
        pending: flat,
        pendingAudited: false,
        p90LatencyMs: pair(17000, 13000, 20000, 37100, 30000, 40000), // p90 alone would pick sonnet
        // this run's actual board-live timeout rates (sonnet 14/195, opus 5/195)
        timeoutRate: pair(0.072, 0.062, 0.108, 0.026, 0.015, 0.031),
      };
      const d = decideArm(arm, inputs);
      expect(d.decidedBy).toBe("timeout-rate");
      expect(d.winner).toBe("opus"); // lower timeout rate wins
    }
  });

  it("timeout-rate falls through to p90-latency when the timeout-rate gap is not decisive (overlapping ranges or < delta)", () => {
    const inputs = {
      jargon: flat,
      length: flat,
      pending: flat,
      pendingAudited: false,
      p90LatencyMs: pair(37100, 30000, 40000, 13780, 10000, 16000),
      timeoutRate: pair(0.05, 0.02, 0.08, 0.04, 0.01, 0.07), // overlapping ranges, gap < TIMEOUT_RATE_DECISIVE_DELTA
    };
    expect(TIMEOUT_RATE_DECISIVE_DELTA).toBeGreaterThan(0);
    const d = decideArm("general", inputs);
    expect(d.decidedBy).toBe("p90-latency");
    expect(d.winner).toBe("opus");
  });

  it("general/board-review's p90-latency axis decides FIRST, ahead of jargon, when the gap is decisive and ranges are disjoint", () => {
    const inputs = {
      // jargon alone would pick opus -- p90 must still win the arm decision.
      jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97),
      length: flat,
      pending: flat,
      pendingAudited: false,
      p90LatencyMs: pair(37100, 30000, 40000, 13780, 10000, 16000), // v3's own real gap
    };
    const d = decideArm("general", inputs);
    expect(d.decidedBy).toBe("p90-latency");
    expect(d.winner).toBe("opus"); // lower p90 wins
  });

  it("falls through to the jargon/length/pending chain when p90 ranges overlap despite a median gap", () => {
    const inputs = {
      jargon: pair(0.8, 0.78, 0.82, 0.95, 0.93, 0.97),
      length: flat,
      pending: flat,
      pendingAudited: false,
      p90LatencyMs: pair(20000, 10000, 30000, 15000, 8000, 25000), // overlapping ranges
    };
    const d = decideArm("general", inputs);
    expect(d.decidedBy).not.toBe("p90-latency");
    expect(d.decidedBy).toBe("jargon");
  });

  it("decideAcrossArms reports a single winner when board and general agree", () => {
    const boardLive: ArmDecision = { arm: "board-live", winner: "sonnet", decidedBy: "length", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const general: ArmDecision = { arm: "general", winner: "sonnet", decidedBy: "jargon", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const { recommendation } = decideAcrossArms({ "board-live": boardLive, general });
    expect(recommendation).toEqual({ kind: "single", winner: "sonnet" });
  });

  it("decideAcrossArms reports a per-route split when board and general disagree", () => {
    const boardLive: ArmDecision = { arm: "board-live", winner: "sonnet", decidedBy: "length", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const general: ArmDecision = { arm: "general", winner: "opus", decidedBy: "p90-latency", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const { recommendation } = decideAcrossArms({ "board-live": boardLive, general });
    expect(recommendation).toEqual({ kind: "split", board: "sonnet", general: "opus" });
  });

  it("board-review breaks a board-live tie-keep-default when deciding the 'board' route", () => {
    const boardLive: ArmDecision = { arm: "board-live", winner: "tie-keep-default", decidedBy: "default", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const boardReview: ArmDecision = { arm: "board-review", winner: "opus", decidedBy: "p90-latency", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const general: ArmDecision = { arm: "general", winner: "opus", decidedBy: "jargon", reasoning: "x", inputs: { jargon: flat, length: flat, pending: flat, pendingAudited: false } };
    const { recommendation } = decideAcrossArms({ "board-live": boardLive, "board-review": boardReview, general });
    expect(recommendation).toEqual({ kind: "single", winner: "opus" });
  });
});

describe("general-arm intent routing (Wave E1 Task 1, ctx shape updated Wave F)", () => {
  // The whole point of the general arm is that it measures the general-chess
  // route -- a general fixture that silently classifies as "board" would
  // measure the wrong pipeline and invalidate the arm. hasFocus/hasPendingMove
  // are always false for these fixtures (none of them carry a hintFocus/
  // turningPointFocus or a pending move), and status is "in-progress" --
  // the SAME ctx run.ts actually passes for this arm (finished is only ever
  // true for the board-review arm; see run.ts's own `finished` variable).
  for (const q of GENERAL_QUESTIONS) {
    it(`"${q.id}" routes to general via classifyIntent: ${JSON.stringify(q.q.slice(0, 60))}`, () => {
      expect(classifyIntent(q.q, { hasFocus: false, hasPendingMove: false, status: "in-progress" })).toBe("general");
    });
  }
});

describe("board-review fixtures reuse [dir] question text/ctx verbatim (Wave E1 Task 1)", () => {
  it("carries the same count as the [dir] bucket and the arm/tag Wave E1 declares", () => {
    expect(BOARD_REVIEW_QUESTIONS.length).toBeGreaterThan(0);
    for (const q of BOARD_REVIEW_QUESTIONS) {
      expect(q.arm).toBe("board-review");
      expect(q.tag).toBe("dir");
    }
  });
});

// ---- coach-truth-speed round: report-blinded.md graded subset (cap-based) --
//
// Replaces the prior tie-based rule, which marked 66/96 rows -- both models
// pass nearly every mechanical axis, so most rows tied and "tie" was not a
// filter. The new rule is a hard cap of PRIORITY_TARGET_TOTAL (30): every
// eligible general-arm row, plus a stratified deterministic random draw
// filling whatever's left from the other two arms.

// Builds a realistic-scale fixture set matching the actual run's shape (65
// board-live + 15 general + 16 board-review = 96), every row eligible
// (both sides source:"model") unless overridden. Text differs slightly per
// id so rows aren't byte-identical, but content no longer matters to
// selection at all -- there is no more tie/scorecard criterion.
function buildFullScaleRows(): { ids: string[]; rowsA: Map<string, AnswerRow>; rowsB: Map<string, AnswerRow> } {
  const ids: string[] = [];
  const rowsA = new Map<string, AnswerRow>();
  const rowsB = new Map<string, AnswerRow>();
  const add = (id: string, arm: AnswerRow["arm"]) => {
    ids.push(id);
    const tag = arm === "general" ? "general" : "open";
    rowsA.set(id, mkRow({ id, arm, tag, source: "model", text: `a clean answer for ${id} with no violations at all.` }));
    rowsB.set(id, mkRow({ id, arm, tag, source: "model", text: `a different clean answer for ${id} with no violations either.` }));
  };
  for (let i = 0; i < 65; i++) add(`bl-${i}`, "board-live");
  for (let i = 0; i < 15; i++) add(`gen-${i}`, "general");
  for (let i = 0; i < 16; i++) add(`br-${i}`, "board-review");
  return { ids, rowsA, rowsB };
}

describe("selectPrioritySubset (owner graded subset, hard cap 30)", () => {
  it("never marks a row where either side is a pipeline failure, even in the general arm (which is otherwise forced)", () => {
    const ids = ["r1", "r2"];
    const rowsA = new Map<string, AnswerRow>([
      ["r1", mkRow({ id: "r1", source: "model", text: "a clean board-live answer with no violations." })],
      ["r2", mkRow({ id: "r2", arm: "general", tag: "general", source: "model", text: "a clean general answer." })],
    ]);
    const rowsB = new Map<string, AnswerRow>([
      ["r1", mkRow({ id: "r1", source: "template", cause: "timeout", text: "keep it on the board." })],
      ["r2", mkRow({ id: "r2", arm: "general", tag: "general", source: "error", text: "" })],
    ]);
    const sel = selectPrioritySubset(ids, rowsA, rowsB);
    expect(sel.graded.has("r1")).toBe(false);
    expect(sel.general.has("r1")).toBe(false);
    expect(sel.random.has("r1")).toBe(false);
    // r2 would be forced into `general` unconditionally if eligible -- a
    // pipeline failure on side B must still exclude it entirely.
    expect(sel.graded.has("r2")).toBe(false);
    expect(sel.general.has("r2")).toBe(false);
  });

  it("marks every eligible general-arm row unconditionally, regardless of scorecard content", () => {
    const ids = ["gen-01"];
    const rowsA = new Map<string, AnswerRow>([
      ["gen-01", mkRow({ id: "gen-01", arm: "general", tag: "general", source: "model", text: "clean answer here." })],
    ]);
    const rowsB = new Map<string, AnswerRow>([
      ["gen-01", mkRow({ id: "gen-01", arm: "general", tag: "general", source: "model", text: "let's leverage this position for a strong follow-up." })],
    ]);
    const sel = selectPrioritySubset(ids, rowsA, rowsB);
    expect(sel.general.has("gen-01")).toBe(true);
    expect(sel.graded.has("gen-01")).toBe(true);
  });

  it("at real-run scale (65 board-live + 15 general + 16 board-review), marks exactly 30 total, all 15 general, and both other arms in the random draw", () => {
    const { ids, rowsA, rowsB } = buildFullScaleRows();
    const sel = selectPrioritySubset(ids, rowsA, rowsB);

    expect(sel.graded.size).toBe(PRIORITY_TARGET_TOTAL);
    expect(sel.graded.size).toBe(30);

    // All 15 eligible general rows marked, none dropped.
    expect(sel.general.size).toBe(15);
    for (let i = 0; i < 15; i++) expect(sel.general.has(`gen-${i}`)).toBe(true);

    // The remaining 15 slots are the stratified random draw; both other
    // arms must appear (neither crowds the other out).
    expect(sel.random.size).toBe(15);
    const blCount = [...sel.random].filter((id) => id.startsWith("bl-")).length;
    const brCount = [...sel.random].filter((id) => id.startsWith("br-")).length;
    expect(blCount).toBeGreaterThan(0);
    expect(brCount).toBeGreaterThan(0);
    expect(blCount + brCount).toBe(15);
    // Roughly proportional to pool size (65 vs 16) -- board-live's share
    // should clearly outweigh board-review's, not just barely.
    expect(blCount).toBeGreaterThan(brCount);

    // general and random never overlap; graded is exactly their union.
    for (const id of sel.random) expect(sel.general.has(id)).toBe(false);
    expect(sel.graded.size).toBe(sel.general.size + sel.random.size);
  });

  it("is deterministic across two independent calls on identical (but separately constructed) input", () => {
    const built1 = buildFullScaleRows();
    const built2 = buildFullScaleRows();
    const sel1 = selectPrioritySubset(built1.ids, built1.rowsA, built1.rowsB);
    const sel2 = selectPrioritySubset(built2.ids, built2.rowsA, built2.rowsB);

    expect([...sel1.graded].sort()).toEqual([...sel2.graded].sort());
    expect([...sel1.general].sort()).toEqual([...sel2.general].sort());
    expect([...sel1.random].sort()).toEqual([...sel2.random].sort());
  });

  it("never selects a pipeline-failure row, even when it would otherwise be sampled or forced", () => {
    const { ids, rowsA, rowsB } = buildFullScaleRows();
    // Knock out one general row and several board-live/board-review rows as
    // pipeline failures on side B.
    rowsB.set("gen-0", mkRow({ id: "gen-0", arm: "general", tag: "general", source: "template", cause: "timeout", text: "keep it on the board." }));
    for (const id of ["bl-0", "bl-1", "br-0"]) {
      rowsB.set(id, mkRow({ id, arm: id.startsWith("bl-") ? "board-live" : "board-review", source: "error", text: "" }));
    }
    const sel = selectPrioritySubset(ids, rowsA, rowsB);

    expect(sel.graded.has("gen-0")).toBe(false);
    expect(sel.general.has("gen-0")).toBe(false);
    for (const id of ["bl-0", "bl-1", "br-0"]) {
      expect(sel.graded.has(id)).toBe(false);
      expect(sel.random.has(id)).toBe(false);
    }
    // general is "every eligible general row", not "up to 15" -- gen-0's
    // loss shrinks general to 14. The vacated cap slot is picked up by the
    // random draw instead (there's still ample eligible pool in the other
    // two arms), so the grand total still reaches the hard cap.
    expect(sel.general.size).toBe(14);
    expect(sel.random.size).toBe(PRIORITY_TARGET_TOTAL - 14);
    expect(sel.graded.size).toBe(PRIORITY_TARGET_TOTAL);
  });
});
