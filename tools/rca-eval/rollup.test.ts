// tools/rca-eval/rollup.test.ts
//
// TDD: watched red against a pre-implementation rollup.ts ("Cannot find
// module './rollup'"). Verifies the section-7 table's honesty rule: no row
// shows solved/not-solved while any mapped eval is did-not-run, missing, or
// belongs to a suite this dispatch never built (CE/FH/NM/ST).
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { renderRollup } from "./rollup";
import type { SuiteResult } from "./lib/types";

function writeSuiteJson(dir: string, result: SuiteResult): void {
  fs.writeFileSync(path.join(dir, `2026-07-31-${result.suite.toLowerCase()}.json`), JSON.stringify(result));
}

describe("renderRollup", () => {
  it("reports 'run a suite first' when the runs dir has nothing on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-empty-"));
    const md = renderRollup(dir);
    expect(md).toMatch(/run a suite first/);
  });

  it("never shows solved/not-solved for a row whose mapped suite (CE/FH/NM/ST) has no run json on disk yet", () => {
    // Dispatch 2 (2026-07-31): CE/FH/NM/ST are now BUILT (real evalRefs in
    // ROWS), but this dispatch makes no model calls -- so with nothing on
    // disk, every one of their rows must fall into the SAME "missing"
    // handling every other unrun suite gets, never a fabricated verdict.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-partial-"));
    const md = renderRollup(dir);
    expect(md).toMatch(/mate-move naming.*not run this dispatch \(missing: NM\/NM-01, NM\/NM-02\)/s);
    expect(md).toMatch(/coach reasoning wrongness.*not run this dispatch \(missing: FH\/FH-01, FH\/FH-02\)/s);
  });

  it("never shows solved/not-solved for a row with a did-not-run mapped eval", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-dnr-"));
    writeSuiteJson(dir, {
      suite: "FM",
      expectedCount: 5,
      ranAt: "2026-07-31T00:00:00.000Z",
      results: [
        { id: "FM-01", verdict: "pass", detail: "ok" },
        { id: "FM-02", verdict: "pass", detail: "ok" },
        { id: "FM-03", verdict: "did-not-run", detail: "no interface yet" },
        { id: "FM-04", verdict: "pass", detail: "ok" },
        { id: "FM-05", verdict: "pass", detail: "ok" },
      ],
    });
    const md = renderRollup(dir);
    const row = md.split("\n").find((l) => l.includes("forgetting"))!;
    expect(row).not.toMatch(/\| solved/);
    expect(row).toMatch(/not verdicted/);
    expect(row).toMatch(/FM-03/);
  });

  it("shows 'solved' only when every mapped eval in a fully-run suite passes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-solved-"));
    writeSuiteJson(dir, {
      suite: "PC",
      expectedCount: 4,
      ranAt: "2026-07-31T00:00:00.000Z",
      results: [
        { id: "PC-01", verdict: "pass", detail: "ok" },
        { id: "PC-02", verdict: "pass", detail: "ok" },
        { id: "PC-03", verdict: "pass", detail: "ok" },
        { id: "PC-04", verdict: "pass", detail: "ok" },
      ],
    });
    const md = renderRollup(dir);
    const row = md.split("\n").find((l) => l.startsWith("| safe-square semantics"))!;
    expect(row).toMatch(/solved -- PC-03/);
  });

  it("shows 'not solved' when a mapped eval is red (never did-not-run)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-red-"));
    writeSuiteJson(dir, {
      suite: "CT",
      expectedCount: 7,
      ranAt: "2026-07-31T00:00:00.000Z",
      results: [
        { id: "CT-06", verdict: "red", detail: "fallback strings present" },
        { id: "CT-01", verdict: "pass", detail: "ok" },
        { id: "CT-02", verdict: "pass", detail: "ok" },
        { id: "CT-03", verdict: "pass", detail: "ok" },
        { id: "CT-04", verdict: "pass", detail: "ok" },
        { id: "CT-05", verdict: "pass", detail: "ok" },
        { id: "CT-07", verdict: "pass", detail: "ok" },
      ],
    });
    const md = renderRollup(dir);
    const row = md.split("\n").find((l) => l.startsWith("| empty debrief"))!;
    expect(row).toMatch(/not solved -- CT-06 red/);
  });

  it("shows 'solved' for mate-move naming once a real NM run passes both evals", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-nm-"));
    writeSuiteJson(dir, {
      suite: "NM",
      expectedCount: 2,
      ranAt: "2026-07-31T00:00:00.000Z",
      results: [
        { id: "NM-01", verdict: "pass", detail: "21/21" },
        { id: "NM-02", verdict: "pass", detail: "0 false claims" },
      ],
    });
    const md = renderRollup(dir);
    const row = md.split("\n").find((l) => l.startsWith('| mate-move naming'))!;
    expect(row).toMatch(/solved -- NM-01, NM-02 all pass/);
  });

  it("shows 'not run this dispatch' for ST-mapped rows since no rollup row maps ST directly (ST feeds K6's row, not gated here)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-st-"));
    const md = renderRollup(dir);
    expect(md).toMatch(/ui lifecycle.*K6's gate artifact, honestly labeled as such/s);
  });

  it("picks the NEWEST json per suite when multiple run files exist for the same suite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollup-newest-"));
    fs.writeFileSync(
      path.join(dir, "2026-07-30-pc.json"),
      JSON.stringify({ suite: "PC", expectedCount: 4, ranAt: "x", results: [{ id: "PC-03", verdict: "red", detail: "stale" }] })
    );
    fs.writeFileSync(
      path.join(dir, "2026-07-31-pc.json"),
      JSON.stringify({ suite: "PC", expectedCount: 4, ranAt: "x", results: [{ id: "PC-03", verdict: "pass", detail: "fresh" }] })
    );
    const md = renderRollup(dir);
    const row = md.split("\n").find((l) => l.startsWith("| safe-square semantics"))!;
    expect(row).toMatch(/solved/);
  });
});
