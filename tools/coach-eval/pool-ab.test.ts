// tools/coach-eval/pool-ab.test.ts
//
// TDD for pool-ab.ts (Task 5, 2026-09-20 coach-eval A/B round; fix round 1
// after task-5a-review.md). All tests build synthetic run dirs under a temp
// directory -- never touches the real tools/coach-eval/runs/.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { poolAb, writeSummary, type PoolInput } from "./pool-ab";
import type { AnswerRow } from "./score";
import type { SuiteResult } from "../rca-eval/lib/types";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pool-ab-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePhase(
  dir: string,
  phase: {
    phase: "ab-before" | "ab-after" | string;
    code: string;
    rep: number;
    arm: string;
    quiet: boolean;
  }
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "phase.json"), JSON.stringify(phase, null, 2));
}

// measuredLatencyMs defaults to latencyMs unless explicitly overridden --
// fix round 1, item 1: run.ts writes measuredLatencyMs unconditionally
// (Date.now() wall clock, run.ts:710) on every row, while latencyMs starts
// as that same value but gets OVERWRITTEN with the app's own
// traceRow.latency_ms whenever an advice_traces row exists (run.ts:713-718)
// -- exactly the app-internal code an A/B round is testing. pool-ab pools
// measuredLatencyMs for that reason; see the matching comment in pool-ab.ts.
function row(
  overrides: Partial<AnswerRow> & { id: string; fixtureId: string; measuredLatencyMs?: number }
): AnswerRow & { measuredLatencyMs: number } {
  const latencyMs = overrides.latencyMs ?? 1000;
  return {
    question: "what should i play here?",
    tag: "dir",
    arm: "board-live",
    probe: false,
    text: "a clean model answer that ends cleanly.",
    source: "model",
    regenCount: 0,
    latencyMs,
    measuredLatencyMs: latencyMs,
    ...overrides,
  } as AnswerRow & { measuredLatencyMs: number };
}

function writeRaw(dir: string, rows: (AnswerRow & { measuredLatencyMs: number })[]): void {
  fs.writeFileSync(path.join(dir, "raw-sonnet-rep1.json"), JSON.stringify(rows, null, 2));
}

// rowVerdicts is pool-ab's own contract addition (fix round 1, item 3) on
// top of tools/rca-eval/lib/types.ts's SuiteResult -- rowId/fixtureId
// naming matches the suites' own internal FhRowAudit/NmRowCheck shape
// (fh.ts/nm.ts), so a later scoring dispatch that already computes those
// per-row objects has an obvious place to serialize them for pool-ab to
// read, rather than inventing a third shape.
type SuiteResultWithRows = SuiteResult & {
  rowVerdicts?: { id: string; rowId: string; fixtureId: string; verdict: SuiteResult["results"][number]["verdict"] }[];
};

function writeSuite(dir: string, suite: "fh" | "nm" | "la" | "ce", result: SuiteResultWithRows): void {
  fs.writeFileSync(path.join(dir, `${suite}.json`), JSON.stringify(result, null, 2));
}

describe("poolAb: run-dir discovery", () => {
  it("ignores dirs that are not ab-before/ab-after (e.g. smoke dirs)", () => {
    const smoke = path.join(tmpDir, "2026-09-20-smoke-pre");
    fs.mkdirSync(smoke, { recursive: true });
    fs.writeFileSync(
      path.join(smoke, "phase.json"),
      JSON.stringify({ phase: "smoke", code: "ac8168e", rep: 1, arm: "fork", quiet: true })
    );
    writeRaw(smoke, [row({ id: "q1", fixtureId: "F1" })]);

    const real = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(real, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(real, [row({ id: "q1", fixtureId: "F1" })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(1); // only the real dir counted
  });

  it("silently skips a smoke dir with raw output and no phase.json at all (not an error)", () => {
    const smoke = path.join(tmpDir, "2026-09-20-smoke-pre");
    fs.mkdirSync(smoke, { recursive: true });
    writeRaw(smoke, [row({ id: "q1", fixtureId: "F1" })]); // no phase.json -- driver never writes one for smoke dirs

    expect(() => poolAb(tmpDir)).not.toThrow();
    expect(poolAb(tmpDir).byCode).toEqual({});
  });

  it("throws when a dir looks like a run dir (has raw json) but has no phase.json", () => {
    const bad = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    fs.mkdirSync(bad, { recursive: true });
    writeRaw(bad, [row({ id: "q1", fixtureId: "F1" })]);

    expect(() => poolAb(tmpDir)).toThrow(/phase\.json/);
  });
});

describe("poolAb: denominator per coordinate", () => {
  it("counts n as the total answer rows pooled per code, across arms and reps", () => {
    const dirs = [
      { name: "2026-09-20-ab-pre-fork-rep1", code: "ac8168e", rep: 1, arm: "fork", n: 2 },
      { name: "2026-09-20-ab-pre-mate-rep1", code: "ac8168e", rep: 1, arm: "mate", n: 3 },
      { name: "2026-09-20-ab-post-fork-rep1", code: "cc37958", rep: 1, arm: "fork", n: 2 },
    ];
    for (const d of dirs) {
      const dir = path.join(tmpDir, d.name);
      writePhase(dir, { phase: d.code === "ac8168e" ? "ab-before" : "ab-after", code: d.code, rep: d.rep, arm: d.arm, quiet: true });
      writeRaw(
        dir,
        Array.from({ length: d.n }, (_, i) => row({ id: `q${i}`, fixtureId: `F${i}` }))
      );
    }

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(5); // 2 + 3
    expect(summary.byCode["cc37958"].n).toBe(2);
  });
});

// Fix round 1, item 1.
describe("poolAb: latency source is measuredLatencyMs, never latencyMs", () => {
  it("pools measuredLatencyMs -- a row with latencyMs 1 and measuredLatencyMs 9000 pools as 9000", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1", latencyMs: 1, measuredLatencyMs: 9000 })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].latency.p50).toBe(9000);
  });

  it("pools ttfpMs/ttfwMs as-is (already the harness's own fields, unaffected by the traceRow override)", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1", ttfpMs: 500, ttfwMs: 700 })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].ttfpP50).toBe(500);
    expect(summary.byCode["ac8168e"].ttfwP50).toBe(700);
  });
});

// Fix round 1, item 2.
describe("poolAb: byCodeAndArm carries per-arm latency alongside pooled byCode figures", () => {
  it("two arms with different latencies produce two different per-arm p50s and one pooled figure", () => {
    const forkDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(forkDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(forkDir, [row({ id: "q1", fixtureId: "F1", measuredLatencyMs: 1000, latencyMs: 1000 })]);

    const mateDir = path.join(tmpDir, "2026-09-20-ab-pre-mate-rep1");
    writePhase(mateDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "mate", quiet: true });
    writeRaw(mateDir, [row({ id: "q1", fixtureId: "M1", measuredLatencyMs: 9000, latencyMs: 9000 })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCodeAndArm["ac8168e"]["fork"].latency.p50).toBe(1000);
    expect(summary.byCodeAndArm["ac8168e"]["mate"].latency.p50).toBe(9000);
    expect(summary.byCodeAndArm["ac8168e"]["fork"].n).toBe(1);
    // The pooled byCode figure mixes both arms -- neither 1000 nor 9000 alone.
    expect(summary.byCode["ac8168e"].latency.p50).toBe(5000);
    expect(summary.byCode["ac8168e"].latency.pooledAcrossArms).toBe(true);
  });
});

// Fix round 1, item 3.
describe("poolAb: difficulty buckets carry full per-code parity, suite verdicts mapped by fixture", () => {
  it("a synthetic fh json flags one fork row; the tactical-or-mate bucket's fh tally shows it and the other buckets show 0 with scoredDirs set", () => {
    const forkDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(forkDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(forkDir, [row({ id: "q1", fixtureId: "FK1", difficulty: "tactical-or-mate" as any })]);
    writeSuite(forkDir, "fh", {
      suite: "fh",
      expectedCount: 1,
      ranAt: "2026-09-20T00:00:00Z",
      results: [{ id: "FH-01", verdict: "red", detail: "escape claim confirmed" }],
      rowVerdicts: [{ id: "FH-01", rowId: "q1", fixtureId: "FK1", verdict: "red" }],
    });

    const mateDir = path.join(tmpDir, "2026-09-20-ab-pre-mate-rep1");
    writePhase(mateDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "mate", quiet: true });
    writeRaw(mateDir, [row({ id: "q1", fixtureId: "M1", difficulty: "needs-line" as any })]);
    // mateDir gets no fh.json at all -- a dir where the suite was never scored.

    const summary = poolAb(tmpDir);
    const buckets = summary.byCodeAndDifficulty["ac8168e"].buckets;
    expect(buckets["tactical-or-mate"].fh["FH-01"]).toEqual({ pass: 0, red: 1, didNotRun: 0, scoredDirs: 1, expectedDirs: 1 });
    // needs-line's own dir never had fh.json and FH-01 never appeared there,
    // so there is no id to tally -- {} (did-not-run territory), never a
    // fabricated zero pass. See the "3 dirs, 2 scored" test below for the
    // scoredDirs/expectedDirs counters on an id that DOES appear somewhere.
    expect(buckets["needs-line"].fh).toEqual({});
  });

  it("gives difficulty buckets the same correctness/latency/ttf/token fields as byCode", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [
      row({ id: "q1", fixtureId: "FK1", difficulty: "tactical-or-mate" as any, source: "template", cause: "timeout" }),
      row({ id: "q2", fixtureId: "FK2", difficulty: "tactical-or-mate" as any, ttfpMs: 100, ttfwMs: 200 }),
    ]);

    const summary = poolAb(tmpDir);
    const bucket = summary.byCodeAndDifficulty["ac8168e"].buckets["tactical-or-mate"];
    expect(bucket.n).toBe(2);
    expect(bucket.templateFailures).toBe(1);
    expect(bucket.ttfpP50).toBe(100);
    expect(bucket.ttfwP50).toBe(200);
    expect(bucket).toHaveProperty("tokensP50");
    expect(bucket).toHaveProperty("la");
    expect(bucket).toHaveProperty("nm");
    expect(bucket).toHaveProperty("ce");
  });
});

// Fix round 1, item 4.
describe("poolAb: suite tallies carry scoredDirs/expectedDirs denominators", () => {
  it("3 dirs, 2 suite jsons present -- tally shows scoredDirs 2 of expectedDirs 3", () => {
    const dir1 = path.join(tmpDir, "2026-09-20-ab-pre-mate-rep1");
    writePhase(dir1, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "mate", quiet: true });
    writeRaw(dir1, [row({ id: "q1", fixtureId: "M1" })]);
    writeSuite(dir1, "la", { suite: "la", expectedCount: 1, ranAt: "2026-09-20T00:00:00Z", results: [{ id: "LA-01", verdict: "pass", detail: "ok" }] });

    const dir2 = path.join(tmpDir, "2026-09-20-ab-pre-board-live-rep1");
    writePhase(dir2, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "board-live", quiet: true });
    writeRaw(dir2, [row({ id: "q1", fixtureId: "C2" })]);
    writeSuite(dir2, "la", { suite: "la", expectedCount: 1, ranAt: "2026-09-20T00:00:00Z", results: [{ id: "LA-01", verdict: "red", detail: "bad" }] });

    const dir3 = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir3, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir3, [row({ id: "q1", fixtureId: "FK1" })]);
    // dir3 gets no la.json -- 2 of 3 dirs for this code scored.

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].la["LA-01"]).toEqual({ pass: 1, red: 1, didNotRun: 0, scoredDirs: 2, expectedDirs: 3 });
  });

  it("an id that never appears in any scored dir stays absent (did-not-run territory), never a fabricated pass", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1" })]);
    // No fh.json anywhere for this code -- fh suite never scored.

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].fh).toEqual({});
  });
});

// Fix round 1, item 5.
describe("poolAb: tokens -- final-answer tokensP50 vs cumulative tokensSpentP50", () => {
  it("tokensP50 is the final attempt's output tokens; tokensSpentP50 sums every attempt", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [
      row({
        id: "q1",
        fixtureId: "F1",
        usage: [
          { inputTokens: 100, outputTokens: 50, thinkingTokens: null },
          { inputTokens: 100, outputTokens: 80, thinkingTokens: null },
        ],
      }),
    ]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].tokensP50).toBe(80); // final attempt only
    expect(summary.byCode["ac8168e"].tokensSpentP50).toBe(130); // 50 + 80, every attempt
  });
});

describe("poolAb: quiet exclusion", () => {
  it("excludes a quiet:false rep's rows from the latency pool but still counts them in n", () => {
    const quietDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(quietDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(quietDir, [
      row({ id: "q1", fixtureId: "F1", measuredLatencyMs: 1000 }),
      row({ id: "q2", fixtureId: "F2", measuredLatencyMs: 2000 }),
    ]);

    const contendedDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep2");
    writePhase(contendedDir, { phase: "ab-before", code: "ac8168e", rep: 2, arm: "fork", quiet: false });
    writeRaw(contendedDir, [row({ id: "q1", fixtureId: "F1", measuredLatencyMs: 99999 })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(3); // all rows counted
    expect(summary.byCode["ac8168e"].latency.repsUsed).toBe(1); // only rep 1 was quiet
    expect(summary.byCode["ac8168e"].latency.quietRows).toBe(2);
    expect(summary.byCode["ac8168e"].latency.p50).toBe(1500); // median of [1000, 2000], the contended 99999 excluded
  });
});

describe("poolAb: difficulty buckets pool by row, not by dir", () => {
  it("pools rows by their own difficulty tag, separate from the arm/dir grouping", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-board-live-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "board-live", quiet: true });
    writeRaw(dir, [
      row({ id: "q1", fixtureId: "F1", difficulty: "direct-fact" as any }),
      row({ id: "q2", fixtureId: "F2", difficulty: "direct-fact" as any }),
      row({ id: "q3", fixtureId: "F3", difficulty: "tactical-or-mate" as any }),
    ]);

    const summary = poolAb(tmpDir);
    expect(summary.byCodeAndDifficulty["ac8168e"].buckets["direct-fact"].n).toBe(2);
    expect(summary.byCodeAndDifficulty["ac8168e"].buckets["tactical-or-mate"].n).toBe(1);
  });

  it("excludes rows with no difficulty tag from the difficulty pooling, but keeps them in byCode", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-general-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "general", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1" })]); // no difficulty field

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(1);
    const buckets = summary.byCodeAndDifficulty["ac8168e"]?.buckets ?? {};
    expect(Object.values(buckets).reduce((s, b) => s + b.n, 0)).toBe(0);
  });
});

describe("poolAb: correctness counts", () => {
  it("counts template failures and completeness fails from model-vs-template source and sentence-ending", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [
      row({ id: "q1", fixtureId: "F1", source: "template", cause: "timeout" }),
      row({ id: "q2", fixtureId: "F2", source: "model", text: "this answer trails off without" }), // no sentence-final punctuation
      row({ id: "q3", fixtureId: "F3", source: "model", text: "this answer ends cleanly." }),
    ]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].templateFailures).toBe(1);
    expect(summary.byCode["ac8168e"].completenessFails).toBe(1);
  });
});

describe("writeSummary", () => {
  it("refuses to overwrite an existing output file", () => {
    const outFile = path.join(tmpDir, "2026-09-20-ab-summary.json");
    fs.writeFileSync(outFile, "{}");
    const fakeInput: PoolInput = { byCode: {}, byCodeAndArm: {}, byCodeAndDifficulty: {} } as any;
    expect(() => writeSummary(fakeInput, outFile)).toThrow(/exists/);
  });

  it("writes the summary json when the output file does not yet exist", () => {
    const outFile = path.join(tmpDir, "2026-09-20-ab-summary.json");
    const fakeInput: PoolInput = { byCode: {}, byCodeAndArm: {}, byCodeAndDifficulty: {} } as any;
    writeSummary(fakeInput, outFile);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(outFile, "utf8"))).toEqual(fakeInput);
  });
});
