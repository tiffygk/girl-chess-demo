import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  bestSanForFixture,
  isLaScopedRow,
  checkLaRows,
  computeLa01,
  computeLa02,
  runLaSuite,
  KNOWN_BAD_LA_ANSWER,
  LA_ARMS,
  LA_EXCLUDED_ARMS,
} from "./la";
import { assertDenominator } from "../../rca-eval/lib/assertRan";
import { FIXTURES } from "../fixtures";
import type { AnswerRow } from "../score";

function makeRow(id: string, fixtureId: string, arm: AnswerRow["arm"], tag: AnswerRow["tag"], text: string): AnswerRow {
  return {
    id,
    fixtureId,
    question: "what should i play here?",
    tag,
    arm,
    probe: false,
    text,
    source: "model",
    regenCount: 0,
    latencyMs: 500,
  };
}

describe("scope: which arms/fixtures carry a known best move", () => {
  it("mate fixtures all resolve to a real SAN best move", () => {
    expect(bestSanForFixture("MT1")).toBeTruthy();
    expect(bestSanForFixture("MT7")).toBeTruthy();
  });

  it("board-live C2-C5 resolve to a real SAN best move", () => {
    expect(bestSanForFixture("C2")).toBe("a5");
    expect(bestSanForFixture("C3")).toBe("Ne1");
    expect(bestSanForFixture("C4")).toBe("Bxc8");
    expect(bestSanForFixture("C5")).toBe("Nd5");
  });

  it("board-live C1 has no known best move", () => {
    expect(bestSanForFixture("C1")).toBeUndefined();
  });

  it("fork fixtures have no known best move (no best-move field in fixtures.ts)", () => {
    expect(bestSanForFixture("FK1")).toBeUndefined();
    expect(bestSanForFixture("FK6")).toBeUndefined();
  });

  it("isLaScopedRow: mate always in scope, board-live only on C2-C5, fork never", () => {
    expect(isLaScopedRow({ arm: "mate", fixtureId: "MT1" })).toBe(true);
    expect(isLaScopedRow({ arm: "board-live", fixtureId: "C3" })).toBe(true);
    expect(isLaScopedRow({ arm: "board-live", fixtureId: "C1" })).toBe(false);
    expect(isLaScopedRow({ arm: "fork", fixtureId: "FK1" })).toBe(false);
  });

  it("LA_ARMS/LA_EXCLUDED_ARMS record the fork exclusion honestly, not silently", () => {
    expect(LA_ARMS).toEqual(["mate", "board-live"]);
    expect(LA_EXCLUDED_ARMS.fork).toMatch(/no known-best move/);
  });
});

describe("checkLaRows: agree / disagree / no-claim", () => {
  it("recommends the fixture's known best -> agree", () => {
    const rows = [makeRow("r1", "C2", "board-live", "dir", "The best move here is a5, so you should play a5 instead.")];
    const [check] = checkLaRows(rows);
    expect(check.agrees).toBe(true);
    expect(check.disagreesWith).toEqual([]);
    expect(check.noClaim).toBe(false);
  });

  it("recommends another legal move -> disagree", () => {
    const rows = [makeRow("r2", "C2", "board-live", "dir", "The stronger move is Qh5, play Qh5 instead.")];
    const [check] = checkLaRows(rows);
    expect(check.agrees).toBe(false);
    expect(check.disagreesWith).toContain("Qh5");
  });

  it("names no move -> no-claim", () => {
    const rows = [makeRow("r3", "C2", "board-live", "dir", "This position looks roughly balanced to me.")];
    const [check] = checkLaRows(rows);
    expect(check.agrees).toBe(false);
    expect(check.disagreesWith).toEqual([]);
    expect(check.noClaim).toBe(true);
  });

  it("mate arm rows are checked against MATE_FACTS' bestUci-derived SAN", () => {
    const bestSan = bestSanForFixture("MT1")!;
    const rows = [makeRow("m1", "MT1", "mate", "dir", `Play ${bestSan} -- that's the move.`)];
    const [check] = checkLaRows(rows);
    expect(check.bestSan).toBe(bestSan);
    expect(check.agrees).toBe(true);
  });

  it("out-of-scope rows (fork, C1) are dropped entirely, not scored", () => {
    const rows = [
      makeRow("f1", "FK1", "fork", "dir", "you can avoid it with Kg2"),
      makeRow("c1", "C1", "board-live", "open", "keep developing"),
    ];
    expect(checkLaRows(rows)).toEqual([]);
  });
});

describe("computeLa01 (zero tolerance -- red if ANY row disagrees)", () => {
  it("pass when every row in the arm agrees or makes no claim", () => {
    const rows = [
      makeRow("r1", "C2", "board-live", "dir", "Play a5, that's the move."),
      makeRow("r2", "C3", "board-live", "dir", "This position is balanced."),
    ];
    const checks = checkLaRows(rows);
    const result = computeLa01(checks, "board-live");
    expect(result.id).toBe("LA-01-board-live");
    expect(result.verdict).toBe("pass");
  });

  it("red when even one row recommends a move other than the known best", () => {
    const rows = [
      makeRow("r1", "C2", "board-live", "dir", "Play a5, that's the move."),
      makeRow("r2", "C3", "board-live", "dir", "The best move is Qh5, play Qh5 instead."),
    ];
    const checks = checkLaRows(rows);
    const result = computeLa01(checks, "board-live");
    expect(result.verdict).toBe("red");
    expect(result.detail).toMatch(/r2/);
  });

  it("did-not-run when the arm has no scoped rows", () => {
    const result = computeLa01([], "mate");
    expect(result.verdict).toBe("did-not-run");
  });
});

describe("computeLa02 (informational, no threshold, per arm and per tag)", () => {
  it("reports the naming share without gating, even when it is low", () => {
    const rows = [
      makeRow("r1", "C2", "board-live", "open", "why should i not put this piece here"),
      makeRow("r2", "C3", "board-live", "open", "no real answer given"),
    ];
    const checks = checkLaRows(rows);
    const result = computeLa02(checks, "board-live", "open");
    expect(result.id).toBe("LA-02-board-live-open");
    expect(result.verdict).toBe("pass"); // informational -- never red, however low the share
    expect(result.detail).toMatch(/0 of 2/);
  });

  it("scopes to exactly one tag when given", () => {
    const rows = [
      makeRow("r1", "C2", "board-live", "dir", "Play a5."),
      makeRow("r2", "C3", "board-live", "narr", "Play Ne1."),
    ];
    const checks = checkLaRows(rows);
    const dirResult = computeLa02(checks, "board-live", "dir");
    expect(dirResult.detail).toMatch(/1 of 1/);
  });
});

describe("denominator is asserted (section 4 rule 1)", () => {
  it("throws when a suite reports fewer results than its declared expectedCount", () => {
    const threeResults = [
      { id: "LA-01-mate", verdict: "pass" as const, detail: "x" },
      { id: "LA-01-board-live", verdict: "pass" as const, detail: "x" },
      { id: "LA-02-mate", verdict: "pass" as const, detail: "x" },
    ];
    expect(() => assertDenominator(threeResults, 5, "LA")).toThrow(/denominator mismatch/);
  });
});

describe("known-bad input is proven red at startup (section 4 rule 2)", () => {
  it("KNOWN_BAD_LA_ANSWER is flagged as disagreeing with C2's real best move (a5), never as agreeing or no-claim", () => {
    const rows = [makeRow("bad", "C2", "board-live", "dir", KNOWN_BAD_LA_ANSWER)];
    const [check] = checkLaRows(rows);
    expect(check.agrees).toBe(false);
    expect(check.noClaim).toBe(false);
    expect(check.disagreesWith.length).toBeGreaterThan(0);
  });
});

describe("runLaSuite (did-not-run honesty, expectedCount, fixture-fingerprint discovery)", () => {
  it("reports did-not-run for all 8 evals against an empty runs dir, denominator still asserted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-la-norun-"));
    const result = runLaSuite(dir);
    expect(result.suite).toBe("LA");
    expect(result.expectedCount).toBe(8);
    expect(result.results.length).toBe(8);
    expect(result.results.every((r) => r.verdict === "did-not-run")).toBe(true);
    expect(result.notes?.some((n) => n.includes("mate") && n.includes("board-live"))).toBe(true);
    expect(result.notes?.some((n) => n.includes("fork"))).toBe(true);
  });

  it("never discovers a stale-fixture run over the current one (same fingerprint rule as nm/fh)", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-la-fingerprint-"));
    const currentDir = path.join(runsDir, "2026-09-20-la-current");
    const staleDir = path.join(runsDir, "9999-la-stale-sorts-after");
    fs.mkdirSync(currentDir);
    fs.mkdirSync(staleDir);

    const staleRows: AnswerRow[] = [
      { ...makeRow("r1", "C2", "board-live", "dir", "The best move is Qh5, play Qh5 instead."), fixtureFen: "8/8/8/8/8/8/8/8 w - - 0 1" },
    ];
    fs.writeFileSync(path.join(staleDir, "raw-sonnet-rep1.json"), JSON.stringify(staleRows));

    const currentRows: AnswerRow[] = [{ ...makeRow("r1", "C2", "board-live", "dir", "Play a5, that's the move."), fixtureFen: FIXTURES.C2.fen }];
    fs.writeFileSync(path.join(currentDir, "raw-sonnet-rep1.json"), JSON.stringify(currentRows));

    const result = runLaSuite(runsDir);
    const la01BoardLive = result.results.find((r) => r.id === "LA-01-board-live")!;
    // If the stale (wrong-move) rows had been picked, this would be "red".
    expect(la01BoardLive.verdict).toBe("pass");
  });
});
