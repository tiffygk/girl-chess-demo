// tools/rca-eval/suites/pc.ts
//
// Suite PC -- prompt cap and the current block (spec section 3, K3). Owner's
// ask folded in here: prompt caps are half of "measure the timeout."
//
// PC-01 controller correction (b): reads FACTS_BUDGET_CHARS from the merged
// code when it exists (a namespace import, never a hardcoded 12000 once K3
// ships); until then, records RED with today's measured payload size,
// using 12000 only as this suite's OWN documented fallback constant, never
// silently substituted for a real one.
//
// 2026-07-31 status: K3 has not merged -- there is no "current" block on
// ChatFactList and no FACTS_BUDGET_CHARS export. PC-01 and PC-03 need
// nothing from K3 (assembleChatFactList/contested already exist) and are
// executed for real -- PC-01 is a MANDATORY pre-merge red (spec section 4
// rule 3): today's assembly reaches far over budget at late plies, matching
// baseline row B3's real 44,997-char measurement at game 160 ply 184. PC-02
// and PC-04 need the "current" block and report did-not-run.
import * as chatModule from "../../../server/coach/chat";
import { assembleChatFactList, type ChatFactList } from "../../../server/coach/chat";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator, proveRedAtStartup } from "../lib/assertRan";
import game160Fixture from "../fixtures/game160-evals.json";
import game149Fixture from "../fixtures/game149-evals.json";
import syntheticFixture from "../fixtures/synthetic-187-sans.json";

// This suite's own documented fallback -- the spec's own budget number
// (section 3, PC-01), NOT a guess. Overridden the instant K3 exports the
// real constant; see the namespace-import read below.
const FALLBACK_FACTS_BUDGET_CHARS = 12000;
const FACTS_BUDGET_CHARS: number = (chatModule as unknown as { FACTS_BUDGET_CHARS?: number }).FACTS_BUDGET_CHARS ?? FALLBACK_FACTS_BUDGET_CHARS;
const USING_REAL_BUDGET_CONSTANT = (chatModule as unknown as { FACTS_BUDGET_CHARS?: number }).FACTS_BUDGET_CHARS !== undefined;

interface EvalRow {
  ply: number;
  san: string;
  evalCp: number | null;
  evalMate: number | null;
}

interface GameFixture {
  gameId: number;
  plies: number;
  rows: EvalRow[];
}

interface OverBudgetFinding {
  source: string;
  ply: number;
  chars: number;
}

// Builds the ChatFactList exactly as a LIVE mid-game chat call would see it
// at ply P: gameMoves/perPlyAnalysis truncated to the first P plies,
// context "live" (matches how the real game-160/149 traces that produced
// baseline row B3 were actually assembled -- turningPoints are only ever
// passed for a FINISHED game, which a mid-game ply truncation never is).
function factsAtPly(rows: EvalRow[], uptoPly: number, withEvals: boolean): ChatFactList {
  const slice = rows.filter((r) => r.ply <= uptoPly);
  const gameMoves = slice.map((r) => ({ ply: r.ply, san: r.san }));
  const perPlyAnalysis = withEvals
    ? slice.map((r) => ({ ply: r.ply, san: r.san, evalCp: r.evalCp, evalMate: r.evalMate, bestSan: null, pvSans: [] as string[], phase: null }))
    : undefined;
  return assembleChatFactList(gameMoves, { mode: "live" }, undefined, perPlyAnalysis);
}

function measureAllPlies(label: string, rows: EvalRow[], withEvals: boolean): { findings: OverBudgetFinding[]; maxChars: number; maxPly: number; pliesChecked: number } {
  let maxChars = 0;
  let maxPly = 0;
  const findings: OverBudgetFinding[] = [];
  const totalPlies = rows.length;
  for (let ply = 1; ply <= totalPlies; ply++) {
    const facts = factsAtPly(rows, ply, withEvals);
    const chars = JSON.stringify(facts).length;
    if (chars > maxChars) {
      maxChars = chars;
      maxPly = ply;
    }
    if (chars > FACTS_BUDGET_CHARS) findings.push({ source: label, ply, chars });
  }
  return { findings, maxChars, maxPly, pliesChecked: totalPlies };
}

// Section 4 rule 2: prove the checker itself is provably red on a known-bad
// (deliberately oversized) payload before trusting any pass it reports.
function budgetChecker(chars: number): boolean {
  return chars <= FACTS_BUDGET_CHARS; // true = "looks fine" (within budget)
}

function pc01(): EvalResult {
  proveRedAtStartup("PC-01 budget checker", budgetChecker, FACTS_BUDGET_CHARS + 1);

  const g160 = game160Fixture as unknown as GameFixture;
  const g149 = game149Fixture as unknown as GameFixture;
  const synth = syntheticFixture as unknown as { plies: number; sans: { ply: number; san: string }[] };
  const synthRows: EvalRow[] = synth.sans.map((s) => ({ ply: s.ply, san: s.san, evalCp: null, evalMate: null }));

  const r160 = measureAllPlies("game160", g160.rows, true);
  const r149 = measureAllPlies("game149", g149.rows, true);
  const rSynth = measureAllPlies("synthetic187", synthRows, false);

  const totalPliesChecked = r160.pliesChecked + r149.pliesChecked + rSynth.pliesChecked;
  const totalOverBudget = r160.findings.length + r149.findings.length + rSynth.findings.length;

  const budgetSource = USING_REAL_BUDGET_CONSTANT
    ? "imported FACTS_BUDGET_CHARS from server/coach/chat.ts (K3 has merged)"
    : `this suite's own fallback constant (${FALLBACK_FACTS_BUDGET_CHARS}, the spec's own budget number) -- K3 has not merged, no real export exists yet`;

  if (totalOverBudget === 0) {
    return {
      id: "PC-01",
      verdict: "pass",
      detail: `every ply of all 3 fixtures (${totalPliesChecked} plies checked) stayed at or under the ${FACTS_BUDGET_CHARS}-char budget (${budgetSource}). A pre-merge green here means the eval is broken, not the code fixed -- verify FACTS_BUDGET_CHARS is really being read.`,
    };
  }
  return {
    id: "PC-01",
    verdict: "red",
    detail:
      `${totalOverBudget} of ${totalPliesChecked} plies exceeded the ${FACTS_BUDGET_CHARS}-char budget (${budgetSource}). ` +
      `game160 worst: ply ${r160.maxPly}, ${r160.maxChars} chars. game149 worst: ply ${r149.maxPly}, ${r149.maxChars} chars. ` +
      `synthetic187 worst: ply ${rSynth.maxPly}, ${rSynth.maxChars} chars. This is the MANDATORY pre-merge red (spec section 4 ` +
      "rule 3) -- matches baseline row B3's real measurement (44,997 chars at game 160 ply 184).",
  };
}

function pc02(): EvalResult {
  return {
    id: "PC-02",
    verdict: "did-not-run",
    detail:
      "ChatFactList has no 'current' block and phasesForGame-driven dropped-span aggregation does not exist yet " +
      "(K3). The phaseParity tripwire (phaseParity.test.ts) is a separate, already-passing, pre-existing test -- " +
      "not re-asserted here since it needs no K3 code and isn't part of this suite's own interface.",
  };
}

function pc03(): EvalResult {
  const g160 = game160Fixture as unknown as GameFixture;
  const uptoPly57 = g160.rows.filter((r) => r.ply <= 57).map((r) => ({ ply: r.ply, san: r.san }));
  const facts = assembleChatFactList(uptoPly57, { mode: "live" });
  if (facts.contested.length > 0) {
    return {
      id: "PC-03",
      verdict: "pass",
      detail: `contested lists ${facts.contested.length} contact-dense square(s) on game 160's real ply-57 fen (matches baseline row B8's contact-dense position).`,
    };
  }
  return {
    id: "PC-03",
    verdict: "red",
    detail: "contested is EMPTY on game 160's ply-57 fen -- reproduces the trace-140 bug this eval pins (spec section 3, PC-03).",
  };
}

function pc04(): EvalResult {
  return {
    id: "PC-04",
    verdict: "did-not-run",
    detail:
      "ChatFactList has no 'current' block at all yet (K3) -- there is no current.bestSan/current.pvSans to check " +
      "against the manager.ts:939-944 dangling priorEval off-by-one.",
  };
}

export function runPcSuite(): SuiteResult {
  const results: EvalResult[] = [pc01(), pc02(), pc03(), pc04()];
  assertDenominator(results, 4, "PC");
  return {
    suite: "PC",
    expectedCount: 4,
    results,
    ranAt: new Date().toISOString(),
    notes: [
      `budget constant: ${USING_REAL_BUDGET_CONSTANT ? "read from server/coach/chat.ts's real FACTS_BUDGET_CHARS export" : `this suite's own fallback (${FALLBACK_FACTS_BUDGET_CHARS}) -- K3 has not merged`}.`,
      "PC-01/PC-03 executed for real against pre-K3 code (assembleChatFactList/contested need no K3 code).",
      "PC-02/PC-04 did-not-run: the 'current' block does not exist on ChatFactList yet.",
      "fixtures: tools/rca-eval/fixtures/game160-evals.json (187 plies), game149-evals.json (144 plies), synthetic-187-sans.json (187-ply generated game) -- all readonly-extracted or synthetic, never touching data/girlchess.db.",
    ],
  };
}
