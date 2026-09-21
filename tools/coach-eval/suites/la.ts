// tools/coach-eval/suites/la.ts
//
// Suite LA -- ladder agreement, "follows one fact" (coach-eval round,
// 2026-09-20). Scores whether an answer recommends the FIXTURE'S OWN known
// best move and never another one. Runs over coach-eval raw rows (json),
// never a live model call and never the owner's db.
//
// Inspection (task-4 brief step 0, ruling recorded 2026-09-20): which
// fixtures actually carry a known-best MOVE, as opposed to some other kind
// of ground truth --
//   - arm "mate" (MT1-MT7): MATE_FACTS.bestUci -- a real per-fixture best
//     move. IN SCOPE.
//   - arm "board-live", fixtures C2-C5: ENGINE_BEST_UCI_BY_FIXTURE -- also a
//     real per-fixture best move (used elsewhere for narr hintFocus
//     synthesis), and it is NOT limited to the PD2-4 pending rows -- every
//     board-live row pinned to C2/C3/C4/C5 (open-*/narr-*/dir-*/pending-*/
//     affirmation-*) has one. IN SCOPE, all of them, not just PD2-4.
//   - arm "fork" (FK1-FK6): ground truth is a boolean/narrative "forced
//     material loss" fact (forcedLoss.ts/engineLabel.ts), never a specific
//     recommended SAN move -- FORK_QUESTION_TEXT only ever asks yes/no
//     questions ("can i avoid losing a piece here?"). OUT OF SCOPE: no
//     best-move field exists to check an answer against. Recorded here,
//     not as a silently-absent constant, via LA_ARMS/LA_EXCLUDED_ARMS below
//     so a page reading this suite's own output can print an honest
//     "no ground-truth best in fixtures: UNAUDITED" tile for fork from
//     that field, not from a hardcoded assumption.
//   - board-review/general/general-theory/numbers/long: never inspected
//     for a best-move field (out of the round's ask); not claimed in scope.
//
// LA-01 (zero tolerance, the one-fact rule): share of answers that
// recommend a move OTHER than the fixture's known best, per arm. RED if
// any row in that arm does this, however small the share.
// LA-02 (informational, no threshold): share of answers that NAME the
// known best, per arm, and for board-live ALSO per question tag (open/
// narr/dir/pending) -- an open-ended or false-premise question is not
// asked for a move at all, so a low LA-02 there is expected by design, not
// a defect; reporting it broken out keeps that from being misread as a
// miss when pooled with dir-tag "what should i play next?" rows.
//
// Move extraction reuses tools/coach-ladder-agreement.ts's own
// sentence-bounded extractor (extractMoves) and sentenceRecommends --
// imported, never reimplemented. extractMoves was previously unexported;
// the only change made to that file for this suite is adding the `export`
// keyword to its existing declaration (no logic touched -- see the git log
// for this commit). Confirmed that file has no top-level `new Database`
// (the only construction site is inside runReport/analyze, called only
// when a CLI user runs the tool directly) -- importing it opens no db.
import { Chess } from "chess.js";
import type { AnswerRow } from "../score";
import type { EvalResult, SuiteResult, Verdict } from "../../rca-eval/lib/types";
import { assertDenominator, proveRedAtStartup } from "../../rca-eval/lib/assertRan";
import { extractMoves } from "../../coach-ladder-agreement";
import { normalizeSan } from "../../../server/coach/validate";
import { FIXTURES, MATE_FACTS, MATE_FIXTURE_IDS, ENGINE_BEST_UCI_BY_FIXTURE, type FixtureId, type MateFixtureId } from "../fixtures";
import { discoverRun } from "./discoverRun";

// The two arms LA actually scores, and why fork is excluded -- exported so
// a downstream page (before/after dashboard) reads this from the suite's
// own output rather than re-deriving or hardcoding it.
export const LA_ARMS = ["mate", "board-live"] as const;
export const LA_EXCLUDED_ARMS: Record<string, string> = {
  fork: "no known-best move in fixtures",
};

// Every board-live fixture id that ENGINE_BEST_UCI_BY_FIXTURE actually
// covers -- currently C2-C5. Read from the dict's own keys (never a
// separate hardcoded list) so this suite can never drift from what
// fixtures.ts actually declares a best move for.
export const LA_BOARD_LIVE_FIXTURE_IDS: string[] = Object.keys(ENGINE_BEST_UCI_BY_FIXTURE);

// Comparison form for a SAN string: same one-line rule
// coach-ladder-agreement.ts's own (unexported) sanBase applies, re-derived
// here via the exported normalizeSan rather than importing an unexported
// helper -- normalize case, strip a trailing check/mate suffix (a suffix
// annotates the position, not a different move).
function laSanBase(s: string): string {
  return normalizeSan(s).replace(/[+#]$/, "");
}

function sanForUci(fixtureId: FixtureId, uci: string): string {
  const fixture = FIXTURES[fixtureId];
  const chess = new Chess(fixture.fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const move = chess.move({ from, to, promotion: "q" });
  if (!move) throw new Error(`LA: fixture ${fixtureId} bestUci ${uci} is not legal at ${fixture.fen} -- stale fixture data`);
  return move.san;
}

// Decodes a fixture's persisted best move (uci, from either MATE_FACTS or
// ENGINE_BEST_UCI_BY_FIXTURE) into SAN. Returns undefined for a fixture
// with no known-best-move field at all (fork, C1, R1-3, etc) -- callers
// use this to decide scope, never assume every fixtureId has an answer.
export function bestSanForFixture(fixtureId: string): string | undefined {
  if ((MATE_FIXTURE_IDS as readonly string[]).includes(fixtureId)) {
    return sanForUci(fixtureId as FixtureId, MATE_FACTS[fixtureId as MateFixtureId].bestUci);
  }
  const engineBest = (ENGINE_BEST_UCI_BY_FIXTURE as Record<string, string | undefined>)[fixtureId];
  if (engineBest) {
    return sanForUci(fixtureId as FixtureId, engineBest);
  }
  return undefined;
}

// A row is in LA's scope iff its arm/fixture combination carries a known
// best move (mate arm entirely; board-live only on C2-C5). Fork, and every
// other board-live fixture (C1), general/general-theory/board-review/
// numbers/long rows, are never scoped in, regardless of tag.
export function isLaScopedRow(row: Pick<AnswerRow, "arm" | "fixtureId">): boolean {
  if (row.arm === "mate") return true;
  if (row.arm === "board-live") return LA_BOARD_LIVE_FIXTURE_IDS.includes(row.fixtureId);
  return false;
}

export interface LaRowCheck {
  rowId: string;
  fixtureId: string;
  arm: "mate" | "board-live";
  tag: string;
  bestSan: string;
  recommended: string[]; // every move the row's text recommends (extractMoves)
  agrees: boolean; // bestSan is among recommended
  disagreesWith: string[]; // recommended moves that are NOT bestSan (the one-fact violation)
  noClaim: boolean; // recommended is empty -- named no move at all
}

export function checkLaRows(rows: AnswerRow[]): LaRowCheck[] {
  return rows.filter(isLaScopedRow).map((r) => {
    const fixture = FIXTURES[r.fixtureId as FixtureId];
    const bestSan = bestSanForFixture(r.fixtureId);
    if (!bestSan) {
      // Defensive: isLaScopedRow already guarantees this, but never trust
      // a filter alone to keep a downstream lookup from throwing blind.
      throw new Error(`LA: row ${r.id} (fixture ${r.fixtureId}) has no known-best move -- isLaScopedRow should have excluded it`);
    }
    const { recommended } = extractMoves(fixture.fen, r.text);
    const bestBase = laSanBase(bestSan);
    const agrees = recommended.some((san) => laSanBase(san) === bestBase);
    const disagreesWith = recommended.filter((san) => laSanBase(san) !== bestBase);
    return {
      rowId: r.id,
      fixtureId: r.fixtureId,
      arm: r.arm as "mate" | "board-live",
      tag: r.tag,
      bestSan,
      recommended,
      agrees,
      disagreesWith,
      noClaim: recommended.length === 0,
    };
  });
}

// LA-01: zero tolerance -- RED if ANY row in this arm recommends a move
// other than the fixture's own known best, however small the share.
export function computeLa01(checks: LaRowCheck[], arm: "mate" | "board-live"): EvalResult {
  const scoped = checks.filter((c) => c.arm === arm);
  const id = `LA-01-${arm}`;
  if (scoped.length === 0) {
    return { id, verdict: "did-not-run", detail: `no ${arm}-arm rows with a known best move found in this run.` };
  }
  const violating = scoped.filter((c) => c.disagreesWith.length > 0);
  const verdict: Verdict = violating.length > 0 ? "red" : "pass";
  return {
    id,
    verdict,
    detail:
      `${violating.length} of ${scoped.length} ${arm} rows recommended a move other than the fixture's known best ` +
      `(gate: zero tolerated).` +
      (violating.length > 0
        ? " " + violating.map((v) => `${v.rowId}/${v.fixtureId} recommended [${v.disagreesWith.join(", ")}] vs best ${v.bestSan}`).join("; ")
        : ""),
  };
}

// LA-02: informational, no threshold -- share of answers that NAME the
// known best. `tag` narrows to one question tag (board-live only); omitted
// means the whole arm.
export function computeLa02(checks: LaRowCheck[], arm: "mate" | "board-live", tag?: string): EvalResult {
  const scoped = checks.filter((c) => c.arm === arm && (tag === undefined || c.tag === tag));
  const id = tag ? `LA-02-${arm}-${tag}` : `LA-02-${arm}`;
  if (scoped.length === 0) {
    return { id, verdict: "did-not-run", detail: `no ${arm}${tag ? ` (tag ${tag})` : ""} rows with a known best move found in this run.` };
  }
  const named = scoped.filter((c) => c.agrees).length;
  return {
    id,
    verdict: "pass", // informational: reported, never gates (ruling 2026-09-20)
    detail:
      `${named} of ${scoped.length} ${arm}${tag ? ` (tag ${tag})` : ""} answers named the fixture's known best move ` +
      `(informational, no threshold; open/probe-shaped questions are not asked for a move, a low share there is expected by design).`,
  };
}

// board-live's per-question-tag breakdown for LA-02 (ruling 2026-09-20).
// affirmation-tagged rows on C2-C5 are still counted in the arm-level
// LA-01/LA-02 totals; they are not broken out as a fifth tag here because
// the ruling names exactly these four.
const LA_BOARD_LIVE_TAGS = ["open", "narr", "dir", "pending"] as const;

const LA_EVAL_IDS: string[] = [
  "LA-01-mate",
  "LA-01-board-live",
  "LA-02-mate",
  "LA-02-board-live",
  ...LA_BOARD_LIVE_TAGS.map((t) => `LA-02-board-live-${t}`),
];

// Section 4 rule 2 (assertRan.ts): a committed known-bad canned answer,
// run through the disagreement checker at every suite invocation. The
// checker "looks fine" (broken) if it fails to flag KNOWN_BAD_LA_ANSWER's
// wrong-move recommendation ("Qh5") against fixture C2's real known best
// ("a5", from ENGINE_BEST_UCI_BY_FIXTURE) -- a checker that cannot fail a
// known-bad input cannot be trusted to fail a real one either.
export const KNOWN_BAD_LA_ANSWER = "The best move here is Qh5, so you should definitely play Qh5 instead of anything else.";

function laDisagreementCheckerLooksFine(fixtureId: FixtureId): boolean {
  const fixture = FIXTURES[fixtureId];
  const bestSan = bestSanForFixture(fixtureId)!;
  const { recommended } = extractMoves(fixture.fen, KNOWN_BAD_LA_ANSWER);
  const bestBase = laSanBase(bestSan);
  const disagrees = recommended.some((san) => laSanBase(san) !== bestBase);
  return !disagrees; // true = the checker missed the wrong-move recommendation -- instrument-broken
}

function discoverLaRows(coachEvalRunsDir: string, runDirOverride?: string) {
  return discoverRun(coachEvalRunsDir, (rows) => rows.filter(isLaScopedRow), runDirOverride);
}

export function runLaSuite(coachEvalRunsDir: string, runDirOverride?: string): SuiteResult {
  proveRedAtStartup("LA disagreement checker", laDisagreementCheckerLooksFine, "C2" as FixtureId);

  const notes = [`arms: ${JSON.stringify(LA_ARMS)}`, `excluded: ${JSON.stringify(LA_EXCLUDED_ARMS)}`];

  const discovered = discoverLaRows(coachEvalRunsDir, runDirOverride);
  const rows = discovered?.rows;
  if (!rows) {
    const results: EvalResult[] = LA_EVAL_IDS.map((id) => ({
      id,
      verdict: "did-not-run",
      detail: "no coach-eval run with mate or board-live (C2-C5) rows found on disk yet.",
    }));
    return {
      suite: "LA",
      expectedCount: LA_EVAL_IDS.length,
      results: assertDenominator(results, LA_EVAL_IDS.length, "LA"),
      ranAt: new Date().toISOString(),
      notes: [...notes, "LA did-not-run: run coach-eval (arm mate and/or board-live) first, then re-run this suite."],
    };
  }

  const checks = checkLaRows(rows);
  const results: EvalResult[] = [
    computeLa01(checks, "mate"),
    computeLa01(checks, "board-live"),
    computeLa02(checks, "mate"),
    computeLa02(checks, "board-live"),
    ...LA_BOARD_LIVE_TAGS.map((tag) => computeLa02(checks, "board-live", tag)),
  ];
  return {
    suite: "LA",
    expectedCount: LA_EVAL_IDS.length,
    results: assertDenominator(results, LA_EVAL_IDS.length, "LA"),
    ranAt: new Date().toISOString(),
    notes,
  };
}
