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
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { preflightFacts, preflightKnownBad, scoreResults, seedGamesForRows, replayRow, type ReplayResult, type StoredRow } from "./replay-trace";
import { seedScratchDb } from "./rca-eval/lib/scenarioDb";
import { assembleChatFactList } from "../server/coach/chat";
import type { CoachBackend } from "../server/coach/backends/types";

// Sanctioned exception to the no-mocks convention, same precedent as
// server/coach/chat.test.ts's own fakeBackend: the real agent-sdk backend
// must never run in a test.
function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

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

describe("preflightKnownBad abort branch", () => {
  it("throws when validateChat is broken and reads the known-bad text as ok:true", async () => {
    // Forces the exact instrument-broken condition preflightKnownBad exists
    // to catch: validateChat wrongly passing the committed known-bad text.
    // Mocking (rather than relying on the real validator, which already
    // correctly rejects it) is what proves this test can actually fail --
    // see replay-trace.ts's own abort branch for what it does on ok:true.
    vi.resetModules();
    vi.doMock("../server/coach/chat", async () => {
      const actual = await vi.importActual<typeof import("../server/coach/chat")>(
        "../server/coach/chat"
      );
      return { ...actual, validateChat: () => ({ ok: true }) };
    });
    const { preflightKnownBad: mockedPreflightKnownBad } = await import("./replay-trace");

    expect(() => mockedPreflightKnownBad()).toThrow(/validator broken/);

    vi.doUnmock("../server/coach/chat");
    vi.resetModules();
  });
});

describe("seedGamesForRows", () => {
  // Fix round (2026-09-22), brief-T fix 1: the tool's own header used to
  // say it was "NOT exercised by this round's tests, and not run by this
  // session" -- its first real run failed on the FIRST id with
  // `SqliteError: FOREIGN KEY constraint failed` inside chat()'s own
  // insertAdviceTrace call, because seedScratchDb's fresh db has no games
  // row for the replayed row's game_id. This test makes that failure go
  // red on demand (seeding removed) and green once seedGamesForRows runs.
  const row: StoredRow = {
    id: 9001,
    gameId: 42,
    ply: 1,
    factsJson: JSON.stringify(assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" })),
    question: "what's my best move?",
  };
  const backend = fakeBackend(async () => "the pawn on e4 is a solid start.");

  it("throws the FK error without seedGamesForRows (proves the fix is necessary)", async () => {
    seedScratchDb("replay-trace-red");
    await expect(replayRow(row, "default", 1, backend)).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("completes and writes one trace once seedGamesForRows seeds the games row", async () => {
    const scratchPath = seedScratchDb("replay-trace-green");
    seedGamesForRows(scratchPath, [row.gameId]);
    const result = await replayRow(row, "default", 1, backend);
    expect(result.id).toBe(row.id);
    expect(result.attempts.length).toBeGreaterThan(0);
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
          { output: "the queen on d7 is hanging.", violations: ["placement-claim: your queen on d7 -- not there"], validated: false, thinking: "low" },
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
    // Only rep 1's attempt 0 has a violation carrying the "placement-claim:"
    // prefix -- rep 2's single attempt validated clean.
    expect(table.low.attempt0ViolationRate).toBeCloseTo(0.5);
    expect(table.low.templateFallbackRate).toBe(0);
    expect(table.low.medianLatencyMs).toBe(5000);
    expect(table.low.medianOutputTokens).toBe(130);

    expect(table.default.n).toBe(1);
    // "Qxh7" carries no "placement-claim:"/"relation-claim:" prefix -- a
    // bare SAN-token violation, not a placement/relation prose claim, so
    // it does NOT count toward attempt0ViolationRate even though the row
    // is a template fallback.
    expect(table.default.attempt0ViolationRate).toBe(0);
    expect(table.default.templateFallbackRate).toBe(1);
    expect(table.default.medianOutputTokens).toBeNull();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("counts only placement-claim/relation-claim violations, not defense-claim", () => {
    // A whitespace heuristic (the old implementation) would count BOTH of
    // these -- both messages are full prose sentences with spaces. Only
    // checkPlacementClaims' and checkRelationClaims' own "placement-claim:"
    // / "relation-claim:" prefixes should count; "defense-claim:" (from
    // checkDefenseClaims) must not, even though it reads exactly like a
    // placement/relation sentence.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-replay-score-prefix-"));
    const results: ReplayResult[] = [
      {
        id: 400,
        arm: "low",
        rep: 1,
        source: "model",
        latencyMs: 1000,
        outputTokens: 50,
        attempts: [
          {
            output: "e4 does guard d5.",
            violations: ["defense-claim: e4 does guard d5"],
            validated: false,
            thinking: "low",
          },
        ],
      },
      {
        id: 401,
        arm: "low",
        rep: 2,
        source: "model",
        latencyMs: 1000,
        outputTokens: 50,
        attempts: [
          {
            output: "c7 does not attack d6 -- it does.",
            violations: ["relation-claim: c7 does not attack d6 -- it does"],
            validated: false,
            thinking: "low",
          },
        ],
      },
    ];
    for (const r of results) {
      fs.writeFileSync(path.join(dir, `${r.id}-${r.arm}-${r.rep}.json`), JSON.stringify(r));
    }

    const table = scoreResults(dir);

    // The defense-claim row must NOT be counted.
    // The relation-claim row MUST be counted.
    // n=2, so a rate of 0.5 proves exactly one of the two counted.
    expect(table.low.n).toBe(2);
    expect(table.low.attempt0ViolationRate).toBe(0.5);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
