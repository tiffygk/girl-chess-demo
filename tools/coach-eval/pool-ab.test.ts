// tools/coach-eval/pool-ab.test.ts
//
// TDD for pool-ab.ts (Task 5, 2026-09-20 coach-eval A/B round): pools the
// 30 ab-* run dirs (2 codes x 5 arms x 3 reps) by code and by difficulty
// bucket. All tests build synthetic run dirs under a temp directory --
// never touches the real tools/coach-eval/runs/.
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
    phase: "ab-before" | "ab-after";
    code: string;
    rep: number;
    arm: string;
    quiet: boolean;
  }
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "phase.json"), JSON.stringify(phase, null, 2));
}

function row(overrides: Partial<AnswerRow> & { id: string; fixtureId: string }): AnswerRow {
  return {
    question: "what should i play here?",
    tag: "dir",
    arm: "board-live",
    probe: false,
    text: "a clean model answer that ends cleanly.",
    source: "model",
    regenCount: 0,
    latencyMs: 1000,
    ...overrides,
  } as AnswerRow;
}

function writeRaw(dir: string, rows: AnswerRow[]): void {
  fs.writeFileSync(path.join(dir, "raw-sonnet-rep1.json"), JSON.stringify(rows, null, 2));
}

function writeSuite(dir: string, suite: "fh" | "nm" | "la" | "ce", result: SuiteResult): void {
  fs.writeFileSync(path.join(dir, `${suite}.json`), JSON.stringify(result, null, 2));
}

describe("poolAb: run-dir discovery", () => {
  it("ignores dirs that are not ab-before/ab-after (e.g. smoke dirs)", () => {
    const smoke = path.join(tmpDir, "2026-09-20-smoke-pre");
    writePhase(smoke, { phase: "ab-before" as any, code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    // Overwrite phase so it's a non-ab phase to prove the filter works.
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
    writeRaw(smoke, [row({ id: "q1", fixtureId: "F1" })]); // no phase.json written -- driver never writes one for smoke dirs

    expect(() => poolAb(tmpDir)).not.toThrow();
    const summary = poolAb(tmpDir);
    expect(summary.byCode).toEqual({});
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
      { name: "2026-09-20-ab-pre-fork-rep1", code: "ac8168e", rep: 1, arm: "fork", quiet: true, n: 2 },
      { name: "2026-09-20-ab-pre-mate-rep1", code: "ac8168e", rep: 1, arm: "mate", quiet: true, n: 3 },
      { name: "2026-09-20-ab-post-fork-rep1", code: "cc37958", rep: 1, arm: "fork", quiet: true, n: 2 },
    ];
    for (const d of dirs) {
      const dir = path.join(tmpDir, d.name);
      writePhase(dir, { phase: d.code === "ac8168e" ? "ab-before" : "ab-after", code: d.code, rep: d.rep, arm: d.arm, quiet: d.quiet });
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

describe("poolAb: quiet exclusion", () => {
  it("excludes a quiet:false rep's rows from the latency pool but still counts them in n", () => {
    const quietDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(quietDir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(quietDir, [row({ id: "q1", fixtureId: "F1", latencyMs: 1000 }), row({ id: "q2", fixtureId: "F2", latencyMs: 2000 })]);

    const contendedDir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep2");
    writePhase(contendedDir, { phase: "ab-before", code: "ac8168e", rep: 2, arm: "fork", quiet: false });
    writeRaw(contendedDir, [row({ id: "q1", fixtureId: "F1", latencyMs: 99999 })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(3); // all rows counted
    expect(summary.byCode["ac8168e"].latency.repsUsed).toBe(1); // only rep 1 was quiet
    expect(summary.byCode["ac8168e"].latency.medianMs).toBe(1500); // median of [1000, 2000], the contended 99999 excluded
  });
});

describe("poolAb: difficulty buckets", () => {
  it("pools rows by their own difficulty tag, separate from the arm/dir grouping", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-board-live-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "board-live", quiet: true });
    writeRaw(dir, [
      row({ id: "q1", fixtureId: "F1", difficulty: "direct-fact" as any }),
      row({ id: "q2", fixtureId: "F2", difficulty: "direct-fact" as any }),
      row({ id: "q3", fixtureId: "F3", difficulty: "tactical-or-mate" as any }),
    ]);

    const summary = poolAb(tmpDir);
    expect(summary.byCodeAndDifficulty["ac8168e"]["direct-fact"].n).toBe(2);
    expect(summary.byCodeAndDifficulty["ac8168e"]["tactical-or-mate"].n).toBe(1);
  });

  it("excludes rows with no difficulty tag from the difficulty pooling, but keeps them in byCode", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-general-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "general", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1" })]); // no difficulty field

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].n).toBe(1);
    const buckets = summary.byCodeAndDifficulty["ac8168e"] ?? {};
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

describe("poolAb: suite verdict tallies", () => {
  it("tallies pass/red/did-not-run per suite id across every included run dir", () => {
    const dir1 = path.join(tmpDir, "2026-09-20-ab-pre-mate-rep1");
    writePhase(dir1, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "mate", quiet: true });
    writeRaw(dir1, [row({ id: "q1", fixtureId: "F1" })]);
    writeSuite(dir1, "la", {
      suite: "la",
      expectedCount: 1,
      ranAt: "2026-09-20T00:00:00Z",
      results: [{ id: "LA-01", verdict: "pass", detail: "ok" }],
    });

    const dir2 = path.join(tmpDir, "2026-09-20-ab-pre-board-live-rep2");
    writePhase(dir2, { phase: "ab-before", code: "ac8168e", rep: 2, arm: "board-live", quiet: true });
    writeRaw(dir2, [row({ id: "q1", fixtureId: "F1" })]);
    writeSuite(dir2, "la", {
      suite: "la",
      expectedCount: 1,
      ranAt: "2026-09-20T00:00:00Z",
      results: [{ id: "LA-01", verdict: "red", detail: "bad" }],
    });

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].la["LA-01"]).toEqual({ pass: 1, red: 1, didNotRun: 0 });
  });

  it("treats a missing suite json as did-not-run, not an error (scoring may not have run yet)", () => {
    const dir = path.join(tmpDir, "2026-09-20-ab-pre-fork-rep1");
    writePhase(dir, { phase: "ab-before", code: "ac8168e", rep: 1, arm: "fork", quiet: true });
    writeRaw(dir, [row({ id: "q1", fixtureId: "F1" })]);

    const summary = poolAb(tmpDir);
    expect(summary.byCode["ac8168e"].fh).toEqual({});
  });
});

describe("writeSummary", () => {
  it("refuses to overwrite an existing output file", () => {
    const outFile = path.join(tmpDir, "2026-09-20-ab-summary.json");
    fs.writeFileSync(outFile, "{}");
    const fakeInput: PoolInput = { byCode: {}, byCodeAndDifficulty: {} } as any;
    expect(() => writeSummary(fakeInput, outFile)).toThrow(/exists/);
  });

  it("writes the summary json when the output file does not yet exist", () => {
    const outFile = path.join(tmpDir, "2026-09-20-ab-summary.json");
    const fakeInput: PoolInput = { byCode: {}, byCodeAndDifficulty: {} } as any;
    writeSummary(fakeInput, outFile);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(outFile, "utf8"))).toEqual(fakeInput);
  });
});
