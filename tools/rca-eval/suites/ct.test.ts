// tools/rca-eval/suites/ct.test.ts
//
// TDD: watched red against a pre-implementation suites/ct.ts ("Cannot find
// module './ct'"). Asserts the suite's own denominator (7), reads the real
// pre-tpv7 backup triple (161 games, matching baseline B9), and confirms
// the honest split expected pre-K1/K2 merge: CT-01/02/03/04/05/07
// did-not-run (each citing the current pre-heal state, matching baseline
// rows B4/B5); CT-06 executed for real against pre-existing code and red
// (both fallback strings still fire on game 160 today).
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
  it("asserts its own denominator: exactly 7 evals, over the real 161-game corpus", () => {
    const suite = runCtSuite();
    expect(suite.suite).toBe("CT");
    expect(suite.expectedCount).toBe(7);
    expect(suite.results.length).toBe(7);
    expect(suite.notes?.join(" ")).toMatch(/161 games/);
  });

  it("CT-01/02/03/04/05/07 report did-not-run, each citing the current pre-heal state", () => {
    const suite = runCtSuite();
    for (const id of ["CT-01", "CT-02", "CT-03", "CT-04", "CT-05", "CT-07"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("did-not-run");
    }
  });

  it("CT-01's did-not-run detail matches baseline B4/B5: game 160 has 3 turning points today", () => {
    const suite = runCtSuite();
    const ct01 = suite.results.find((r) => r.id === "CT-01")!;
    expect(ct01.detail).toMatch(/game 160 has 3 turning points/);
  });

  it("CT-06 ran for real against pre-existing code and is red: both fallback strings still fire on game 160", () => {
    const suite = runCtSuite();
    const ct06 = suite.results.find((r) => r.id === "CT-06")!;
    expect(ct06.verdict, ct06.detail).toBe("red");
    expect(ct06.detail).toMatch(/no clear mistakes to flag here/);
    expect(ct06.detail).toMatch(/no repeat pattern showed up/);
  });

  it("never opens data/girlchess.db itself -- the corpus source is the pre-tpv7 backup triple", () => {
    const suite = runCtSuite();
    expect(suite.notes?.join(" ")).toMatch(/pre-tpv7/);
  });
});

// tools/rca-eval/fixtures/expected-conversion.json -- re-derived 2026-07-31
// from the COMMITTED integration-branch behavior (real computeTurningPoints
// run against the verified pre-tpv7 backup via a detached worktree), per
// review-phaseA-union-DELTA-for-fixer.md's cross-check rules. These tests
// read the fixture directly (not the live suite -- conversion.ts has not
// merged into this worktree; the eval branch stays out of
// server/annotator entirely) so the fixture's own invariants stay pinned
// even before CT-01/02/03/07 can execute for real. Watched red first
// against the STALE (pre-regeneration) fixture, which had only game 160's
// raw detectConversion events and none of these per-game/per-rule shapes --
// every assertion below failed on that file (wrong shape, no `games` key,
// no collision/span-gate/conversion-anchor data to check).
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
