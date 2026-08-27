// tools/rca-eval/suites/ct.test.ts
//
// Dispatch 6 (2026-07-31, post phase-A merge): watched RED first against
// the pre-dispatch suites/ct.ts, which returned a plain (sync) SuiteResult
// and expected CT-01/02/03/04/05/07 to all report did-not-run. Real red,
// quoted verbatim from the run that motivated this rewrite:
//
//   FAIL runCtSuite > asserts its own denominator...
//   AssertionError: expected undefined to be 'CT'
//     - Expected: "CT"  + Received: undefined
//   (suite.suite) -- because runCtSuite() now returns a Promise<SuiteResult>
//   (CT-01/04/05/07 need `await`s inside for computeTurningPoints'
//   idempotency check, ct04's scratch-db setup, and ct05's async
//   classifyMove calls) and the old test called it with no `await`.
//   Every downstream assertion in the old file then failed the same way
//   ("Cannot read properties of undefined (reading 'find')") -- 5 of 12
//   tests red, all for the single real reason: the suite is now async and
//   does real work instead of reporting did-not-run.
//
// This file replaces those did-not-run expectations with the real
// acceptance assertions the RCA Acceptance Evals spec (section 3, suite
// CT) describes, now that phase A (server/annotator/conversion.ts,
// TP_ALGO_VERSION 7, classify.ts's K2 adjudication, debriefInvariants.ts's
// conversion-claim rule) is merged.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { runCtSuite } from "./ct";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "expected-conversion.json"
);

const COLLISION_GAMES = ["85", "86", "132", "149", "159"];
const SPAN_GATE_GAMES = ["141", "144"];
const CONVERSION_GAMES = ["130", "143", "145", "150", "151", "160"];

describe("runCtSuite", () => {
  it("asserts its own denominator: exactly 7 evals, over the real 161-game corpus", async () => {
    const suite = await runCtSuite();
    expect(suite.suite).toBe("CT");
    expect(suite.expectedCount).toBe(7);
    expect(suite.results.length).toBe(7);
    expect(suite.notes?.join(" ")).toMatch(/161 games/);
  });

  it("never opens data/girlchess.db itself -- the corpus source is the pre-tpv7 backup triple", async () => {
    const suite = await runCtSuite();
    expect(suite.notes?.join(" ")).toMatch(/pre-tpv7/);
  });

  it("CT-01: game 160 heals to exactly one conversion point (ply 87, mateIn 2, plyEnd 187) and one missed-win point (ply 69, mateIn 4, missedCount 8), idempotent, TP_ALGO_VERSION 8", async () => {
    const suite = await runCtSuite();
    const ct01 = suite.results.find((r) => r.id === "CT-01")!;
    expect(ct01.verdict, ct01.detail).toBe("pass");
    expect(ct01.detail).toMatch(/ply 87/);
    expect(ct01.detail).toMatch(/mateIn 2/);
    expect(ct01.detail).toMatch(/plyEnd 187/);
    expect(ct01.detail).toMatch(/ply 69/);
    expect(ct01.detail).toMatch(/missedCount 8/);
    expect(ct01.detail).toMatch(/idempotent/);
    expect(ct01.detail).toMatch(/TP_ALGO_VERSION 8/);
    expect(ct01.detail).toMatch(/computeTurningPoints/); // states which seam was exercised
  });

  it("CT-02: game 161 (the clean Nxc7# win) gains zero conversion/missed-win events", async () => {
    const suite = await runCtSuite();
    const ct02 = suite.results.find((r) => r.id === "CT-02")!;
    expect(ct02.verdict, ct02.detail).toBe("pass");
  });

  it("CT-03: ply 185 is a non-event in game 160", async () => {
    const suite = await runCtSuite();
    const ct03 = suite.results.find((r) => r.id === "CT-03")!;
    expect(ct03.verdict, ct03.detail).toBe("pass");
  });

  it("CT-04: zero debriefInvariants violations corpus-wide, all 161 games examined", async () => {
    const suite = await runCtSuite();
    const ct04 = suite.results.find((r) => r.id === "CT-04")!;
    expect(ct04.verdict, ct04.detail).toBe("pass");
    expect(ct04.detail).toMatch(/161 games examined/);
    expect(ct04.detail).toMatch(/conversion-claim/);
  });

  it("CT-05: judge verdicts on game 160's fixture plies -- 95/123/125 nudge, 185 silent", async () => {
    const suite = await runCtSuite();
    const ct05 = suite.results.find((r) => r.id === "CT-05")!;
    expect(ct05.verdict, ct05.detail).toBe("pass");
    expect(ct05.detail).toMatch(/ply 95 -> nudge/);
    expect(ct05.detail).toMatch(/ply 123 -> nudge/);
    expect(ct05.detail).toMatch(/ply 125 -> nudge/);
    expect(ct05.detail).toMatch(/ply 185 -> silent/);
  });

  it("CT-06 ran for real against the healed computeTurningPoints() output and passes: neither fallback string fires", async () => {
    const suite = await runCtSuite();
    const ct06 = suite.results.find((r) => r.id === "CT-06")!;
    expect(ct06.verdict, ct06.detail).toBe("pass");
    expect(ct06.detail).not.toMatch(/"no clear mistakes to flag here/);
  });

  it("CT-07: floor holds -- ply 125 (the worst slip) is carded; count reported, not gated", async () => {
    const suite = await runCtSuite();
    const ct07 = suite.results.find((r) => r.id === "CT-07")!;
    expect(ct07.verdict, ct07.detail).toBe("pass");
    expect(ct07.detail).toMatch(/ply 125/);
    expect(ct07.detail).toMatch(/mate-in-10 became mate-in-16/);
  });
});

// tools/rca-eval/fixtures/expected-conversion.json -- re-derived 2026-07-31
// from the COMMITTED integration-branch behavior (real computeTurningPoints
// run against the verified pre-tpv7 backup via a detached worktree), per
// review-phaseA-union-DELTA-for-fixer.md's cross-check rules. These tests
// read the fixture directly -- pinning its own invariants independent of
// whatever ct.ts's live suite computes, so a future regression in either
// the fixture or the real code shows up as a real disagreement, not a
// coincidental match.
describe("expected-conversion.json (regenerated ground truth)", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

  it("carries a provenance header naming the integration commit and backup file", () => {
    expect(fixture.provenance.integrationCommit).toBe("074a5f3");
    expect(fixture.provenance.integrationBranch).toBe("integrate/2026-07-31-rca-phaseA");
    expect(fixture.provenance.backupFile).toMatch(/pre-tpv7-20260729-195853/);
    expect(fixture.provenance.algoVersion).toBe(7);
  });

  it("collision games 85/86/132/149/159 show a single point -- missed-win only, no conversion", () => {
    for (const gid of COLLISION_GAMES) {
      const points = fixture.games[gid];
      const kinds = points.map((p: any) => p.kind);
      expect(kinds, `game ${gid}`).toContain("missed-win");
      expect(kinds, `game ${gid}`).not.toContain("conversion");
    }
  });

  it("span-gated games 141/144 have a missed-win point but no conversion point", () => {
    for (const gid of SPAN_GATE_GAMES) {
      const points = fixture.games[gid];
      const kinds = points.map((p: any) => p.kind);
      expect(kinds, `game ${gid}`).toContain("missed-win");
      expect(kinds, `game ${gid}`).not.toContain("conversion");
    }
  });

  it("every conversion anchor ply is odd (hers), across exactly these 6 games", () => {
    const gamesWithConversion = Object.entries(fixture.games)
      .filter(([, points]: [string, any]) => points.some((p: any) => p.kind === "conversion"))
      .map(([gid]) => gid)
      .sort();
    expect(gamesWithConversion).toEqual([...CONVERSION_GAMES].sort());
    for (const gid of CONVERSION_GAMES) {
      const conv = fixture.games[gid].find((p: any) => p.kind === "conversion");
      expect(conv.ply % 2, `game ${gid} conversion ply ${conv.ply}`).toBe(1);
    }
  });

  it("game 160 = missed-win@69 (mateIn 4) + conversion@87 (mateIn 2)", () => {
    const points = fixture.games["160"];
    const missedWin = points.find((p: any) => p.kind === "missed-win");
    const conversion = points.find((p: any) => p.kind === "conversion");
    expect(missedWin.ply).toBe(69);
    expect(missedWin.mateIn).toBe(4);
    expect(conversion.ply).toBe(87);
    expect(conversion.mateIn).toBe(2);
  });

  it("game 161 has zero conversion/missed-win/unconverted events", () => {
    const kinds = fixture.games["161"].map((p: any) => p.kind);
    expect(kinds).not.toContain("conversion");
    expect(kinds).not.toContain("missed-win");
    expect(kinds).not.toContain("unconverted");
  });

  it("no two turning points share a ply, in any of the 14 games checked", () => {
    for (const [gid, points] of Object.entries(fixture.games) as [string, any[]][]) {
      const plies = points.map((p) => p.ply);
      const unique = new Set(plies);
      expect(unique.size, `game ${gid}: plies ${plies.join(",")}`).toBe(plies.length);
    }
  });
});
