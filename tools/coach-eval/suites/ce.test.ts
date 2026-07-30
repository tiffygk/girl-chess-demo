import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { longCellPairs, computeCe01, computeCe02, computeCe03, computeCe04, computeCe05, runCeSuite } from "./ce";
import type { AnswerRow } from "../score";

function row(overrides: Partial<AnswerRow> & { id: string; fixtureId: string }): AnswerRow {
  return {
    question: "what should i play here?",
    tag: "dir",
    arm: "long",
    probe: false,
    text: "a clean model answer.",
    source: "model",
    regenCount: 0,
    latencyMs: 1000,
    ...overrides,
  };
}

describe("longCellPairs", () => {
  it("pairs LN1/LN2 (game 160) and LN3/LN4 (game 149) by median latency", () => {
    const rows: AnswerRow[] = [
      row({ id: "a", fixtureId: "LN1", latencyMs: 1000 }),
      row({ id: "b", fixtureId: "LN1", latencyMs: 1200 }),
      row({ id: "c", fixtureId: "LN2", latencyMs: 2000 }),
      row({ id: "d", fixtureId: "LN2", latencyMs: 2200 }),
    ];
    const pairs = longCellPairs(rows);
    expect(pairs.length).toBe(1); // only game 160's pair is present
    expect(pairs[0].gameLabel).toMatch(/game 160/);
    expect(pairs[0].earlyMedianMs).toBe(1100); // median of [1000, 1200]
    expect(pairs[0].lateMedianMs).toBe(2100); // median of [2000, 2200]
    expect(pairs[0].ratio).toBeCloseTo(2100 / 1100, 5);
  });

  it("excludes non-model rows from the latency median", () => {
    const rows: AnswerRow[] = [
      row({ id: "a", fixtureId: "LN1", latencyMs: 1000 }),
      row({ id: "b", fixtureId: "LN1", latencyMs: 45000, source: "template", cause: "timeout" }),
      row({ id: "c", fixtureId: "LN2", latencyMs: 1500 }),
    ];
    const pairs = longCellPairs(rows);
    expect(pairs[0].earlyMedianMs).toBe(1000); // the 45000ms template row is excluded
  });
});

describe("computeCe01 (latency medians)", () => {
  it("did-not-run when no long-arm rows exist", () => {
    expect(computeCe01([]).verdict).toBe("did-not-run");
  });

  it("pass when the late cell is within 1.5x the early cell, no baseline supplied", () => {
    const rows: AnswerRow[] = [
      row({ id: "a", fixtureId: "LN1", latencyMs: 10000 }),
      row({ id: "b", fixtureId: "LN2", latencyMs: 14000 }), // 1.4x
    ];
    const result = computeCe01(rows);
    expect(result.verdict).toBe("pass");
  });

  it("RED when the late cell exceeds 1.5x the early cell", () => {
    const rows: AnswerRow[] = [
      row({ id: "a", fixtureId: "LN1", latencyMs: 10000 }),
      row({ id: "b", fixtureId: "LN2", latencyMs: 20000 }), // 2x
    ];
    const result = computeCe01(rows);
    expect(result.verdict).toBe("red");
  });
});

describe("computeCe02 (timeout rate, instrument-broken guard)", () => {
  it("RED (instrument-broken) when no row carries a cause field or model source", () => {
    const rows: AnswerRow[] = [row({ id: "a", fixtureId: "LN1", source: "template", cause: undefined })];
    const result = computeCe02(rows);
    expect(result.verdict).toBe("red");
    expect(result.detail).toMatch(/INSTRUMENT-BROKEN/);
  });

  it("pass under the 5% timeout-rate gate", () => {
    const rows: AnswerRow[] = Array.from({ length: 100 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", source: "model" }));
    rows.push(row({ id: "timeout1", fixtureId: "LN1", source: "template", cause: "timeout" }));
    const result = computeCe02(rows);
    expect(result.verdict).toBe("pass"); // 1/101 = ~1%
  });

  it("RED over the 5% timeout-rate gate", () => {
    const rows: AnswerRow[] = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", source: "model" }));
    for (let i = 0; i < 2; i++) rows.push(row({ id: `t${i}`, fixtureId: "LN1", source: "template", cause: "timeout" }));
    const result = computeCe02(rows); // 2/12 = 16.7%
    expect(result.verdict).toBe("red");
  });
});

describe("computeCe03 (no growth with game length, paired)", () => {
  it("pass when late-cell timeouts <= early-cell timeouts for every game", () => {
    const rows: AnswerRow[] = [row({ id: "a", fixtureId: "LN1", source: "model" }), row({ id: "b", fixtureId: "LN2", source: "model" })];
    expect(computeCe03(rows).verdict).toBe("pass");
  });

  it("RED when the late cell has MORE timeouts than the early cell for the same game", () => {
    const rows: AnswerRow[] = [
      row({ id: "a", fixtureId: "LN1", source: "model" }),
      row({ id: "b", fixtureId: "LN2", source: "template", cause: "timeout" }),
    ];
    expect(computeCe03(rows).verdict).toBe("red");
  });
});

describe("computeCe04 (regen pressure)", () => {
  it("reports ungated success with fewer than 10 regens, but still gates the rate", () => {
    const rows: AnswerRow[] = Array.from({ length: 19 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", regenCount: i < 1 ? 1 : 0 }));
    const result = computeCe04(rows);
    expect(result.verdict).toBe("pass"); // 1/19 ~= 5.3%, under the 10% rate gate
    expect(result.detail).toMatch(/insufficient regens to gate/);
  });

  it("RED when regen rate is >= 10%", () => {
    const rows: AnswerRow[] = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", regenCount: i < 2 ? 1 : 0 }));
    const result = computeCe04(rows); // 2/10 = 20%
    expect(result.verdict).toBe("red");
  });

  it("gates success rate once n >= 10 regens", () => {
    const rows: AnswerRow[] = Array.from({ length: 200 }, (_, i) =>
      row({ id: `r${i}`, fixtureId: "LN1", regenCount: i < 10 ? 1 : 0, source: i < 6 ? "model" : i < 10 ? "template" : "model" })
    );
    const result = computeCe04(rows);
    expect(result.detail).toMatch(/regen success/);
  });
});

describe("computeCe05 (template pressure by cause)", () => {
  it("pass under the 10% template-rate gate with a clean cause split", () => {
    const rows: AnswerRow[] = Array.from({ length: 100 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", source: "model" }));
    rows.push(row({ id: "t1", fixtureId: "LN1", source: "template", cause: "templates-only" }));
    expect(computeCe05(rows).verdict).toBe("pass");
  });

  it("RED over the 10% template-rate gate", () => {
    const rows: AnswerRow[] = Array.from({ length: 5 }, (_, i) => row({ id: `r${i}`, fixtureId: "LN1", source: "model" }));
    for (let i = 0; i < 3; i++) rows.push(row({ id: `t${i}`, fixtureId: "LN1", source: "template", cause: "backend-down" }));
    expect(computeCe05(rows).verdict).toBe("red"); // 3/8 = 37.5%
  });
});

describe("runCeSuite (did-not-run honesty when no coach-eval run exists on disk)", () => {
  it("reports did-not-run for all 5 evals, denominator still 5", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-ce-norun-"));
    const result = runCeSuite(dir);
    expect(result.suite).toBe("CE");
    expect(result.expectedCount).toBe(5);
    expect(result.results.length).toBe(5);
    expect(result.results.every((r) => r.verdict === "did-not-run")).toBe(true);
  });

  it("RED-then-fixed regression: a run with rows but NO 'long' arm (e.g. an older round's data) must be ignored, not silently substituted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-ce-stale-"));
    const staleRunDir = path.join(dir, "2026-01-01-old-round");
    fs.mkdirSync(staleRunDir);
    const staleRows = Array.from({ length: 50 }, (_, i) => row({ id: `old-${i}`, fixtureId: "C1", arm: "board-live", source: "model" }));
    fs.writeFileSync(path.join(staleRunDir, "raw-sonnet.json"), JSON.stringify(staleRows));
    const result = runCeSuite(dir);
    // Must NOT compute real pass/red verdicts against the stale, unrelated data.
    expect(result.results.every((r) => r.verdict === "did-not-run")).toBe(true);
  });
});
