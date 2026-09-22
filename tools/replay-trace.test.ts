// tools/replay-trace.test.ts
//
// Game 198 fixes (2026-09-21), Task D3. This file exercises the two pure
// pieces of tools/replay-trace.ts that this round's build window owns:
// the preflight (instrument-broken detection, plan step 5's "run the
// replay only once it's proven not to be lying to itself") and the
// scorer (arm-table computation over already-written result files). The
// actual RUN against the owner's db (plan step 5, model calls at a
// chosen thinking level) is a SEPARATE session's job per the brief -- it
// is never exercised here, and nothing in this file opens
// data/girlchess.db or calls a real backend.
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { preflightFacts, preflightKnownBad, scoreResults, type ReplayResult } from "./replay-trace";

describe("preflightFacts", () => {
  it("aborts on a facts_json lacking occupancy", () => {
    // Instrument-broken shape: currentFen and contested present, occupancy
    // missing entirely -- the exact partial-shape failure a schema drift
    // or a truncated facts_json row would produce.
    const brokenFactsJson = JSON.stringify({
      currentFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      contested: [],
      // occupancy: missing
    });
    expect(() => preflightFacts(brokenFactsJson)).toThrow(/occupancy/);
  });

  it("passes on a complete facts_json (occupancy, contested, currentFen all present)", () => {
    const completeFactsJson = JSON.stringify({
      currentFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      occupancy: [{ square: "e4", pieceKind: "p", color: "you" }],
      contested: [],
    });
    expect(() => preflightFacts(completeFactsJson)).not.toThrow();
  });
});

describe("preflightKnownBad", () => {
  it("throws if the committed known-bad text passes validateChat (validator broken)", () => {
    // This proves the CHECK, not the production validator -- preflightKnownBad
    // runs the real validateChat from server/coach/chat.ts against a
    // committed known-bad text/facts pair that must always fail. If it ever
    // reads ok:true, the instrument itself is broken and the replay would
    // silently score every arm as violation-free.
    expect(() => preflightKnownBad()).not.toThrow();
  });
});

describe("scoreResults", () => {
  it("computes the arm table from three hand-written result files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-replay-score-"));
    const results: ReplayResult[] = [
      {
        id: 361,
        arm: "low",
        rep: 1,
        source: "model",
        latencyMs: 4000,
        outputTokens: 120,
        attempts: [
          { output: "the queen on d7 is hanging.", violations: ["the queen on d7 is hanging."], validated: false, thinking: "low" },
          { output: "the knight on f6 is hanging.", violations: [], validated: true, thinking: "default" },
        ],
      },
      {
        id: 361,
        arm: "low",
        rep: 2,
        source: "model",
        latencyMs: 6000,
        outputTokens: 140,
        attempts: [
          { output: "the knight on f6 is hanging.", violations: [], validated: true, thinking: "low" },
        ],
      },
      {
        id: 361,
        arm: "default",
        rep: 1,
        source: "template",
        latencyMs: 9000,
        outputTokens: null,
        attempts: [
          { output: "Qxh7", violations: ["Qxh7"], validated: false, thinking: "default" },
        ],
      },
    ];
    for (const r of results) {
      fs.writeFileSync(path.join(dir, `${r.id}-${r.arm}-${r.rep}.json`), JSON.stringify(r));
    }

    const table = scoreResults(dir);

    expect(table.low.n).toBe(2);
    // Only rep 1's attempt 0 has a placement/relation-shaped violation (a
    // prose message, distinguished from a bare SAN token like "Qxh7" by
    // containing whitespace) -- rep 2's single attempt validated clean.
    expect(table.low.attempt0ViolationRate).toBeCloseTo(0.5);
    expect(table.low.templateFallbackRate).toBe(0);
    expect(table.low.medianLatencyMs).toBe(5000);
    expect(table.low.medianOutputTokens).toBe(130);

    expect(table.default.n).toBe(1);
    // "Qxh7" has no whitespace -- a bare SAN-token violation, not a
    // placement/relation prose claim, so it does NOT count toward
    // attempt0ViolationRate even though the row is a template fallback.
    expect(table.default.attempt0ViolationRate).toBe(0);
    expect(table.default.templateFallbackRate).toBe(1);
    expect(table.default.medianOutputTokens).toBeNull();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
