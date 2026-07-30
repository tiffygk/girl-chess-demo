// tools/coach-eval/suites/nm.ts
//
// Suite NM -- forced-mate next-move naming (RCA Acceptance Evals spec,
// section 3). Owner's ask verbatim: "mate in 7 [with] no next move" was the
// game-160 shape. Runs as a coach-eval run configuration (arm "mate",
// fixtures.ts's MT1-MT7 + MATE_QUESTIONS).
//
// NM-01's checker is EXACTLY score.ts's checkPendingAwareness, re-aimed at
// the fixture's own known best move (spec: "the checkPendingAwareness
// pattern re-aimed at the fixture's known best move, importing PIECE_WORDS
// so there is one vocabulary") -- imported and reused, never reimplemented.
// NM-02's checker is the SHIPPED enforcer, server/coach/mateClaims.ts's
// checkMateClaims, imported verbatim (one source of truth for what counts
// as a false mate-distance claim).
import { Chess } from "chess.js";
import type { AnswerRow } from "../score";
import { checkPendingAwareness, type PendingRef } from "../score";
import type { EvalResult, SuiteResult } from "../../rca-eval/lib/types";
import { assertDenominator, proveRedAtStartup } from "../../rca-eval/lib/assertRan";
import { checkMateClaims } from "../../../server/coach/mateClaims";
import { FIXTURES, MATE_FACTS, MATE_FIXTURE_IDS, type MateFixtureId } from "../fixtures";
import fs from "fs";
import path from "path";

// Decodes a mate fixture's persisted best_move (uci) into the SAME
// PendingRef shape checkPendingAwareness already expects (pieceKind/from/to)
// -- one vocabulary (PIECE_WORDS, imported by score.ts) rather than a second
// piece-word mapping living here.
export function pendingRefForMateFixture(fixtureId: MateFixtureId): PendingRef {
  const fixture = FIXTURES[fixtureId];
  const { bestUci } = MATE_FACTS[fixtureId];
  const chess = new Chess(fixture.fen);
  const from = bestUci.slice(0, 2);
  const to = bestUci.slice(2, 4);
  const piece = chess.get(from as Parameters<Chess["get"]>[0]);
  if (!piece) throw new Error(`mate fixture ${fixtureId}: no piece on ${from} at ${fixture.fen} -- bestUci ${bestUci} is stale`);
  return { pieceKind: piece.type, from, to };
}

export interface NmRowCheck {
  rowId: string;
  fixtureId: string;
  namedMove: boolean; // checkPendingAwareness's verdict
  mateClaimViolations: string[]; // checkMateClaims' verdict
  // Only rows where namedMove === false need a hand audit (spec: "a checker
  // false-negative ... is recorded as instrument disagreement and does not
  // fail the suite; a real miss does"). undefined until the owner has
  // graded it; irrelevant (never read) when namedMove is true.
  handAuditRealMiss?: boolean;
}

export function checkNmRows(rows: AnswerRow[], handAudit: Record<string, boolean> = {}): NmRowCheck[] {
  return rows.map((r) => {
    const fixtureId = r.fixtureId as MateFixtureId;
    const pendingRef = pendingRefForMateFixture(fixtureId);
    const namedMove = checkPendingAwareness(r.text, pendingRef);
    const { mateN } = MATE_FACTS[fixtureId];
    const violations = checkMateClaims(r.text, [{ evalMate: mateN }], [mateN]);
    return { rowId: r.id, fixtureId, namedMove, mateClaimViolations: violations, handAuditRealMiss: handAudit[r.id] };
  });
}

// NM-01: >= 20 of 21 name the known best move's piece+destination in plain
// words; every FAILING row needs a hand-audit verdict (checker false-
// negative vs a real miss) before the gate can be computed for real.
export function computeNm01(checks: NmRowCheck[]): EvalResult {
  const failing = checks.filter((c) => !c.namedMove);
  const unauditedFailures = failing.filter((f) => f.handAuditRealMiss === undefined);
  if (unauditedFailures.length > 0) {
    return {
      id: "NM-01",
      verdict: "did-not-run",
      detail:
        `UNAUDITED -- ${unauditedFailures.length} of ${failing.length} mechanical-check failures have no hand-audit verdict ` +
        `(instrument disagreement vs real miss) on file yet, of ${checks.length} total rows.`,
    };
  }
  const realMisses = failing.filter((f) => f.handAuditRealMiss === true).length;
  const named = checks.length - realMisses;
  const pass = named >= 20 && checks.length >= 20; // the spec's own ">= 20 of 21" restated as a count, not a rounded percentage
  return {
    id: "NM-01",
    verdict: pass ? "pass" : "red",
    detail:
      `${named} of ${checks.length} answers named the known best move (gate: >= 20 of 21). ` +
      `${failing.length} mechanical failures, ${failing.length - realMisses} confirmed instrument disagreements (checker false negatives), ` +
      `${realMisses} confirmed real misses.`,
  };
}

// NM-02: zero unadjudicated-false mate-distance claims, via the SHIPPED
// enforcer -- purely mechanical, no hand audit needed (spec: "exact-claim
// checking is mechanical and the enforcer already exists").
export function computeNm02(checks: NmRowCheck[]): EvalResult {
  const violating = checks.filter((c) => c.mateClaimViolations.length > 0);
  if (violating.length > 0) {
    return {
      id: "NM-02",
      verdict: "red",
      detail: `${violating.length} of ${checks.length} rows carry an unadjudicated-false mate-distance claim: ${violating
        .map((v) => `${v.rowId} (${v.mateClaimViolations.join("; ")})`)
        .join(", ")}.`,
    };
  }
  return { id: "NM-02", verdict: "pass", detail: `zero false mate-distance claims across ${checks.length} rows (checkMateClaims, the shipped enforcer).` };
}

// Section 4 rule 2, and NM's own extra clause (spec section 3): "a run where
// every answer passes but the checker was never exercised ... the suite
// plants one known-bad canned answer through the checker at startup and
// aborts if it passes". Two known-bad inputs, one per checker.
export const KNOWN_BAD_NM01_ANSWER = "That's an interesting position -- just keep playing solid moves and you'll be fine.";
export const KNOWN_BAD_NM02_MATE_CLAIM = "This position is mate in 99, a number no fact list here vouches for.";

function nm01CheckerLooksFine(pendingRef: PendingRef): boolean {
  return checkPendingAwareness(KNOWN_BAD_NM01_ANSWER, pendingRef);
}
function nm02CheckerLooksFine(_unused: null): boolean {
  return checkMateClaims(KNOWN_BAD_NM02_MATE_CLAIM, [{ evalMate: 5 }], [5]).length === 0;
}

function discoverMateRows(coachEvalRunsDir: string): AnswerRow[] | undefined {
  if (!fs.existsSync(coachEvalRunsDir)) return undefined;
  const dirs = fs
    .readdirSync(coachEvalRunsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(coachEvalRunsDir, d.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const rawFiles = fs.readdirSync(dir).filter((f) => /^raw-(sonnet|opus)(-rep\d+)?\.json$/.test(f));
    if (rawFiles.length === 0) continue;
    const rows: AnswerRow[] = rawFiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    const mateRows = rows.filter((r) => r.arm === "mate");
    if (mateRows.length > 0) return mateRows;
  }
  return undefined;
}

function loadHandAudit(coachEvalRunsDir: string): Record<string, boolean> | undefined {
  const p = path.join(coachEvalRunsDir, "nm-hand-audit.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return undefined;
  }
}

export function runNmSuite(coachEvalRunsDir: string): SuiteResult {
  proveRedAtStartup("NM-01 pending-awareness checker", nm01CheckerLooksFine, pendingRefForMateFixture(MATE_FIXTURE_IDS[0]));
  proveRedAtStartup("NM-02 mate-claim checker", nm02CheckerLooksFine, null);

  const mateRows = discoverMateRows(coachEvalRunsDir);
  if (!mateRows) {
    const results: EvalResult[] = [
      { id: "NM-01", verdict: "did-not-run", detail: "no coach-eval run with arm 'mate' rows found on disk yet." },
      { id: "NM-02", verdict: "did-not-run", detail: "same as NM-01 -- no mate-arm run exists yet." },
    ];
    return {
      suite: "NM",
      expectedCount: 2,
      results: assertDenominator(results, 2, "NM"),
      ranAt: new Date().toISOString(),
      notes: ["NM-01/02 did-not-run: this dispatch builds no model calls; run coach-eval with --arm mate first, then re-run this suite."],
    };
  }

  const handAudit = loadHandAudit(coachEvalRunsDir);
  const checks = checkNmRows(mateRows, handAudit ?? {});
  const results: EvalResult[] = [computeNm01(checks), computeNm02(checks)];
  return {
    suite: "NM",
    expectedCount: 2,
    results: assertDenominator(results, 2, "NM"),
    ranAt: new Date().toISOString(),
    notes: handAudit ? [] : ["no nm-hand-audit.json found -- NM-01 reports UNAUDITED if any mechanical failure exists (honesty rule 5)."],
  };
}
