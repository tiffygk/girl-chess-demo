// tools/rca-eval/lib/causeFromTrace.test.ts
//
// TDD: watched red against a pre-implementation lib/causeFromTrace.ts (the
// module did not exist -- "Cannot find module './causeFromTrace'"). This
// test validates causeFromTrace against the 16 REAL advice_traces rows
// (kind='chat', source='template') mined readonly from data/girlchess.db on
// 2026-07-31 -- fixtures/known-template-rows.json -- and asserts the
// aggregate split matches the spec's B10 baseline row exactly: 11 timeout /
// 1 backend-down / 4 validation-failed / 0 off-topic.
import { describe, it, expect } from "vitest";
import { causeFromTrace, type MinedCause } from "./causeFromTrace";
import knownTemplateRows from "../fixtures/known-template-rows.json";

interface KnownRow {
  id: number;
  gameId: number;
  ply: number;
  promptEmpty: boolean;
  output: string;
  expectedCause: MinedCause;
}

const rows = (knownTemplateRows as { rows: KnownRow[] }).rows;

describe("causeFromTrace", () => {
  it("carries exactly 16 known rows (the suite's own denominator)", () => {
    expect(rows.length).toBe(16);
  });

  it("classifies off-topic: an empty prompt, regardless of output", () => {
    expect(causeFromTrace({ prompt: "", output: "anything" })).toBe("off-topic");
  });

  it("classifies timeout: a [backend error] output naming a timeout", () => {
    expect(causeFromTrace({ prompt: "you are the coach...", output: "[backend error] claude cli timed out after 20000ms" })).toBe("timeout");
  });

  it("classifies backend-down: a [backend error] output that is not a timeout", () => {
    expect(causeFromTrace({ prompt: "you are the coach...", output: "[backend error] no coach backend available" })).toBe("backend-down");
  });

  it("classifies validation-failed: a real prompt, non-backend-error output (the rejected model text)", () => {
    expect(causeFromTrace({ prompt: "you are the coach...", output: "actually the other way around: ..." })).toBe("validation-failed");
  });

  it("reproduces the exact per-row classification for every one of the 16 known rows", () => {
    for (const row of rows) {
      const got = causeFromTrace({ prompt: row.promptEmpty ? "" : "x".repeat(10), output: row.output });
      expect(got, `row id ${row.id} (game ${row.gameId}, ply ${row.ply})`).toBe(row.expectedCause);
    }
  });

  it("reproduces the validated split on the 16-row fixture: 11 timeout / 1 backend-down / 4 validation-failed / 0 off-topic (spec section 2, row B10)", () => {
    const counts: Record<MinedCause, number> = { timeout: 0, "backend-down": 0, "validation-failed": 0, "off-topic": 0 };
    for (const row of rows) {
      const cause = causeFromTrace({ prompt: row.promptEmpty ? "" : "x".repeat(10), output: row.output });
      counts[cause]++;
    }
    expect(counts.timeout).toBe(11);
    expect(counts["backend-down"]).toBe(1);
    expect(counts["validation-failed"]).toBe(4);
    expect(counts["off-topic"]).toBe(0);
  });

  // Section 4 rule 2 (prove every mechanical detector red at startup): a
  // fabricated row shaped like the classifier's own known-bad case -- an
  // empty prompt is NEVER produced by a real template row per this fixture,
  // but a regression that dropped the off-topic branch entirely would
  // silently fall through to validation-failed. This assertion is the
  // detector's own startup self-check.
  it("prove-red-at-startup: a fabricated empty-prompt row must classify off-topic, never validation-failed", () => {
    const bad = { prompt: "", output: "[backend error] agent-sdk generate timed out after 45000ms" };
    const got = causeFromTrace(bad);
    if (got !== "off-topic") {
      throw new Error(`causeFromTrace instrument-broken: empty-prompt known-bad input classified as "${got}", expected "off-topic"`);
    }
    expect(got).toBe("off-topic");
  });
});
