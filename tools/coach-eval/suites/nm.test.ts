import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pendingRefForMateFixture, checkNmRows, computeNm01, computeNm02, runNmSuite, KNOWN_BAD_NM01_ANSWER, KNOWN_BAD_NM02_MATE_CLAIM } from "./nm";
import { MATE_FIXTURE_IDS, MATE_FACTS } from "../fixtures";
import { checkPendingAwareness } from "../score";
import { checkMateClaims } from "../../../server/coach/mateClaims";
import type { AnswerRow } from "../score";

function makeRow(id: string, fixtureId: string, text: string): AnswerRow {
  return {
    id,
    fixtureId,
    question: "what should i play here?",
    tag: "dir",
    arm: "mate",
    probe: false,
    text,
    source: "model",
    regenCount: 0,
    latencyMs: 500,
  };
}

describe("pendingRefForMateFixture", () => {
  it("decodes a real piece/from/to for every mate fixture", () => {
    for (const id of MATE_FIXTURE_IDS) {
      const ref = pendingRefForMateFixture(id);
      expect(ref.from).toBe(MATE_FACTS[id].bestUci.slice(0, 2));
      expect(ref.to).toBe(MATE_FACTS[id].bestUci.slice(2, 4));
      expect(["p", "n", "b", "r", "q", "k"]).toContain(ref.pieceKind);
    }
  });

  it("the decoded pendingRef genuinely satisfies checkPendingAwareness when the move is named in plain words", () => {
    // MT3: best move e8a4 = Qa4+ -- a queen move to a4.
    const ref = pendingRefForMateFixture("MT3");
    expect(checkPendingAwareness("Bring your queen to a4 -- it's check and forces mate in two.", ref)).toBe(true);
    expect(checkPendingAwareness("Just play a solid developing move here.", ref)).toBe(false);
  });
});

describe("known-bad inputs are proven red at startup (section 4 rule 2)", () => {
  it("KNOWN_BAD_NM01_ANSWER fails checkPendingAwareness for every mate fixture (never names the move)", () => {
    for (const id of MATE_FIXTURE_IDS) {
      const ref = pendingRefForMateFixture(id);
      expect(checkPendingAwareness(KNOWN_BAD_NM01_ANSWER, ref), `${id} should NOT be satisfied by the known-bad answer`).toBe(false);
    }
  });

  it("KNOWN_BAD_NM02_MATE_CLAIM is flagged by checkMateClaims as a false claim", () => {
    const violations = checkMateClaims(KNOWN_BAD_NM02_MATE_CLAIM, [{ evalMate: 5 }], [5]);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("computeNm01 (>= 20 of 21, mandatory hand-audit of failures)", () => {
  it("did-not-run (UNAUDITED) when a mechanical failure has no hand-audit verdict", () => {
    const rows = [makeRow("mate-01", "MT1", "just play a solid move here.")]; // fails the checker, no audit given
    const checks = checkNmRows(rows);
    const result = computeNm01(checks);
    expect(result.verdict).toBe("did-not-run");
    expect(result.detail).toMatch(/UNAUDITED/);
  });

  it("pass when 21/21 name the move (no audit needed -- zero failures)", () => {
    // 3 reps x 7 fixtures = 21 rows, matching the real suite's run size.
    const rows = Array.from({ length: 3 }, (_, rep) =>
      MATE_FIXTURE_IDS.map((id, i) => {
        const ref = pendingRefForMateFixture(id);
        const pieceWord = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[ref.pieceKind];
        return makeRow(`mate-0${i + 1}-rep${rep + 1}`, id, `Play your ${pieceWord} to ${ref.to} -- that's the move.`);
      })
    ).flat();
    expect(rows.length).toBe(21);
    const checks = checkNmRows(rows);
    expect(checks.every((c) => c.namedMove)).toBe(true);
    const result = computeNm01(checks);
    expect(result.verdict).toBe("pass");
  });

  it("a checker false-negative (audited as instrument disagreement) does not fail the suite", () => {
    const rows = [makeRow("mate-01", "MT1", "obscure phrasing that names the move oddly")];
    const checks = checkNmRows(rows, { "mate-01": false }); // audited: NOT a real miss
    // Pad to 20 more passing rows so the count clears >= 20.
    const passingIds = MATE_FIXTURE_IDS;
    const padded = [
      ...checks,
      ...Array.from({ length: 20 }, (_, i) => {
        const id = passingIds[i % passingIds.length];
        return { rowId: `pad-${i}`, fixtureId: id, namedMove: true, mateClaimViolations: [] };
      }),
    ];
    const result = computeNm01(padded);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toMatch(/0 confirmed real misses/);
  });

  it("a confirmed REAL miss counts against the gate", () => {
    const rows = [makeRow("mate-01", "MT1", "just play a solid move here.")];
    const checks = checkNmRows(rows, { "mate-01": true }); // audited: yes, a real miss
    const result = computeNm01(checks);
    expect(result.verdict).toBe("red");
  });
});

describe("computeNm02 (purely mechanical, zero unadjudicated-false mate claims)", () => {
  it("pass when no row makes a false mate-distance claim", () => {
    const checks = checkNmRows([makeRow("mate-01", "MT1", "this is mate in 5, play the knight to f7.")]);
    expect(computeNm02(checks).verdict).toBe("pass");
  });

  it("RED when a row claims a mate distance the fact list does not vouch for", () => {
    const checks = checkNmRows([makeRow("mate-01", "MT1", "this is actually mate in 99 for you.")]);
    expect(computeNm02(checks).verdict).toBe("red");
  });
});

describe("runNmSuite (did-not-run honesty when no coach-eval run exists on disk)", () => {
  it("reports did-not-run for both evals against an empty runs dir, denominator still 2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-nm-norun-"));
    const result = runNmSuite(dir);
    expect(result.suite).toBe("NM");
    expect(result.expectedCount).toBe(2);
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.verdict === "did-not-run")).toBe(true);
  });
});
