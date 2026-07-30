// tools/coach-eval/render.single.test.ts
//
// RCA acceptance-evals round (2026-07-31): render.ts's `--single` acceptance
// mode (spec section 1) -- "aggregates one model's reps ... because
// acceptance is not an A/B and today's render refuses to run without both
// models' raw files." Additive flag; tools/coach-eval/score.test.ts's
// existing A/B-path tests (buildModelSummary, filterFilesByArm, etc.) are
// untouched -- these tests are purely about the NEW discovery/aggregation
// entry points.
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { discoverSingleModel, buildSingleSummary, runSingleMode } from "./render";
import type { AnswerRow } from "./score";

function makeRow(id: string, arm: AnswerRow["arm"], overrides: Partial<AnswerRow> = {}): AnswerRow {
  return {
    id,
    fixtureId: "FK1",
    question: "can i avoid losing a piece here?",
    tag: "dir",
    arm,
    probe: false,
    text: "a full model answer that ends cleanly.",
    source: "model",
    regenCount: 0,
    latencyMs: 1000,
    ...overrides,
  };
}

function writeRaw(dir: string, model: string, rep: number | undefined, rows: AnswerRow[]) {
  const suffix = rep ? `-rep${rep}` : "";
  fs.writeFileSync(path.join(dir, `raw-${model}${suffix}.json`), JSON.stringify(rows.map((r) => ({ ...r, model, wiring: "legacy" }))));
}

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gc-render-single-"));
}

describe("discoverSingleModel", () => {
  it("finds exactly one model's rep files", () => {
    const dir = mkTmpDir();
    writeRaw(dir, "sonnet", 1, [makeRow("fork-01a", "fork")]);
    writeRaw(dir, "sonnet", 2, [makeRow("fork-01a", "fork")]);
    const { model, files } = discoverSingleModel(dir);
    expect(model).toBe("sonnet");
    expect(files.length).toBe(2);
  });

  it("RED: refuses (throws) when both models' raw files are present -- --single is one model, not an A/B path", () => {
    const dir = mkTmpDir();
    writeRaw(dir, "sonnet", 1, [makeRow("fork-01a", "fork")]);
    writeRaw(dir, "opus", 1, [makeRow("fork-01a", "fork")]);
    expect(() => discoverSingleModel(dir)).toThrow(/distinct models/);
  });

  it("RED: refuses on a duplicate rep for the one model", () => {
    const dir = mkTmpDir();
    writeRaw(dir, "sonnet", 1, [makeRow("fork-01a", "fork")]);
    // second file also claims rep 1 (both r absent -> rep 1) -- write a raw-sonnet.json AND raw-sonnet-rep1.json
    writeRaw(dir, "sonnet", undefined, [makeRow("fork-01a", "fork")]);
    expect(() => discoverSingleModel(dir)).toThrow(/duplicate rep/);
  });

  it("RED: refuses when the directory has no raw files at all", () => {
    const dir = mkTmpDir();
    expect(() => discoverSingleModel(dir)).toThrow(/no raw-/);
  });
});

describe("buildSingleSummary", () => {
  it("aggregates per-arm ModelSummary across reps for the one model", () => {
    const dir = mkTmpDir();
    const rows1 = [makeRow("fork-01a", "fork"), makeRow("mate-01", "mate")];
    const rows2 = [makeRow("fork-01a", "fork"), makeRow("mate-01", "mate")];
    writeRaw(dir, "sonnet", 1, rows1);
    writeRaw(dir, "sonnet", 2, rows2);
    const { model, files } = discoverSingleModel(dir);
    const summary = buildSingleSummary(model, files);
    expect(summary.model).toBe("sonnet");
    expect(summary.questionCount).toBe(2);
    expect(Object.keys(summary.arms).sort()).toEqual(["fork", "mate"]);
    expect(summary.arms.fork!.reps).toBe(2);
    expect(summary.arms.fork!.pipeline.pooled.totalRows).toBe(2); // 1 fork row x 2 reps
  });

  it("RED: refuses on a row-id mismatch between reps (reps not comparable)", () => {
    const dir = mkTmpDir();
    writeRaw(dir, "sonnet", 1, [makeRow("fork-01a", "fork")]);
    writeRaw(dir, "sonnet", 2, [makeRow("fork-01b", "fork")]); // different id!
    const { model, files } = discoverSingleModel(dir);
    expect(() => buildSingleSummary(model, files)).toThrow(/row-id mismatch/);
  });
});

describe("runSingleMode (end to end, file writing)", () => {
  it("writes single-summary.json, metrics-single.md, report-single.md", async () => {
    const dir = mkTmpDir();
    writeRaw(dir, "sonnet", 1, [makeRow("fork-01a", "fork"), makeRow("mate-01", "mate")]);
    await runSingleMode(dir);
    expect(fs.existsSync(path.join(dir, "single-summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "metrics-single.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "report-single.md"))).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "single-summary.json"), "utf-8"));
    expect(summary.model).toBe("sonnet");
    const qa = fs.readFileSync(path.join(dir, "report-single.md"), "utf-8");
    // f1 guard: the full answer text must appear untruncated in the dump.
    expect(qa).toContain("a full model answer that ends cleanly.");
  });
});
