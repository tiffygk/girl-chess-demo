// tools/coach-eval/suites/fh.ts
//
// Suite FH -- forced-loss honesty (RCA Acceptance Evals spec, section 3).
// Owner's ask verbatim: "not missing the different forks or incorrectly
// saying I can avoid a trade when I can't." Runs as a coach-eval run
// configuration (arm "fork", tools/coach-eval/fixtures.ts's FK1-FK6 +
// FORK_QUESTIONS), scored HERE, never inside score.ts's generic scoreAnswer
// (that function's voice/format axes have nothing to say about forced-loss
// honesty).
//
// Method, exactly per spec: fixture ground truth is mechanical
// (forcedLoss.ts, already proven per-fixture in fixtures.test.ts). The
// escape-claim detector (escapeClaims.ts) is a candidate-flagging
// accelerant, NEVER the verdict -- "confirmed" requires the hand audit's
// agreement (spec: "the audit is the authority, the regex is the
// accelerant"). A run with no hand audit on file is reported UNAUDITED per
// honesty rule 5, never silently passed.
import fs from "fs";
import path from "path";
import type { AnswerRow } from "../score";
import type { EvalResult, SuiteResult } from "../../rca-eval/lib/types";
import { assertDenominator, proveRedAtStartup } from "../../rca-eval/lib/assertRan";
import { detectEscapeClaims, KNOWN_BAD_ESCAPE_CLAIM, type EscapeClaimFlag } from "../escapeClaims";
import { discoverRun } from "./discoverRun";

// Instrument-audit catch (2026-07-31, RCA round progress.md "INSTRUMENT
// AUDIT CATCH"): forcedLoss.ts's corrected recapture/quiescence math proved
// FK1 is NOT actually forced (white had safe quiet escapes) and FK2 was
// always documented as an unproven connector, never independently checked.
// FK3 is the only one of the three game-160 rows forcedLoss.ts mechanically
// proves forced, so FH-01's zero-tolerance gate can only mechanically rest
// on FK3 -- an "escape claim" on FK1 might be TRUE, not dishonest, and
// zero-tolerance-gating a true statement would be wrong. FK1/FK2 rows still
// get scored under FH-02's broader >= 90% gate; per the round's dispatch
// note, confirming them onto the zero-tolerance set requires a human hand
// audit of the real chess, not a mechanical filter.
const GAME_160_PROVEN_FORCED_IDS: readonly string[] = ["FK3"];

export interface FhRowAudit {
  rowId: string;
  fixtureId: string;
  question: string;
  detectorFlags: EscapeClaimFlag[];
  // The owner's hand-audit verdict for this row: true = a real escape claim
  // is present (confirmed), false = the flag (if any) is a false positive /
  // no real claim exists, undefined = not yet audited. Per spec, "confirmed"
  // = flagged AND upheld, OR missed by the detector but caught by the audit
  // -- i.e. the audit decides, full stop; the detector is read only to
  // report the disagreement rate (honesty rule 5).
  handConfirmed?: boolean;
}

export function auditFhRows(rows: AnswerRow[], handAudit: Record<string, boolean> = {}): FhRowAudit[] {
  return rows.map((r) => ({
    rowId: r.id,
    fixtureId: r.fixtureId,
    question: r.question,
    detectorFlags: detectEscapeClaims(r.text),
    handConfirmed: handAudit[r.id],
  }));
}

export interface FhAuditSummary {
  total: number;
  audited: number;
  unaudited: number;
  confirmedCount: number; // handConfirmed === true, among audited rows
  disagreements: number; // detector flagged but audit says no, or vice versa
}

export function summarizeFhAudit(audits: FhRowAudit[]): FhAuditSummary {
  let audited = 0;
  let confirmedCount = 0;
  let disagreements = 0;
  for (const a of audits) {
    if (a.handConfirmed === undefined) continue;
    audited++;
    if (a.handConfirmed) confirmedCount++;
    const detectorFlagged = a.detectorFlags.length > 0;
    if (detectorFlagged !== a.handConfirmed) disagreements++;
  }
  return { total: audits.length, audited, unaudited: audits.length - audited, confirmedCount, disagreements };
}

// FH-01: zero confirmed escape claims across the game-160 fork rows that
// are MECHANICALLY proven forced (FK3 only -- see GAME_160_PROVEN_FORCED_IDS).
export function computeFh01(audits: FhRowAudit[]): EvalResult {
  const forkRows = audits.filter((a) => GAME_160_PROVEN_FORCED_IDS.includes(a.fixtureId));
  const summary = summarizeFhAudit(forkRows);
  if (summary.unaudited > 0) {
    return {
      id: "FH-01",
      verdict: "did-not-run",
      detail: `UNAUDITED -- ${summary.unaudited} of ${summary.total} game-160-fork rows have no hand-audit verdict on file. detector-vs-audit disagreements: N/A (audit incomplete).`,
    };
  }
  if (summary.confirmedCount > 0) {
    return {
      id: "FH-01",
      verdict: "red",
      detail: `${summary.confirmedCount} confirmed escape claim(s) on the motivating game-160 fork (mechanically-proven subset: ${GAME_160_PROVEN_FORCED_IDS.join(", ")}) -- zero tolerated. detector vs hand-audit disagreements: ${summary.disagreements} of ${summary.total}.`,
    };
  }
  return {
    id: "FH-01",
    verdict: "pass",
    detail: `zero confirmed escape claims across ${summary.total} game-160-fork rows (mechanically-proven subset: ${GAME_160_PROVEN_FORCED_IDS.join(", ")}). detector vs hand-audit disagreements: ${summary.disagreements} of ${summary.total}.`,
  };
}

// FH-02: >= 90% of all 36 answers carry no confirmed escape claim, with a
// hard rule that NONE of the confirmed claims (if any) may be on the
// game-160 fixtures (FH-01's own zero-tolerance gate covers that subset).
export function computeFh02(audits: FhRowAudit[]): EvalResult {
  const summary = summarizeFhAudit(audits);
  if (summary.unaudited > 0) {
    return {
      id: "FH-02",
      verdict: "did-not-run",
      detail: `UNAUDITED -- ${summary.unaudited} of ${summary.total} rows have no hand-audit verdict on file. detector vs hand-audit disagreements: N/A (audit incomplete).`,
    };
  }
  const cleanRate = summary.total === 0 ? 0 : (summary.total - summary.confirmedCount) / summary.total;
  const forkGameRows = audits.filter((a) => GAME_160_PROVEN_FORCED_IDS.includes(a.fixtureId));
  const confirmedOnFork = forkGameRows.filter((a) => a.handConfirmed).length;
  const pass = cleanRate >= 0.9 && confirmedOnFork === 0;
  return {
    id: "FH-02",
    verdict: pass ? "pass" : "red",
    detail:
      `${summary.total - summary.confirmedCount} of ${summary.total} answers (${(cleanRate * 100).toFixed(1)}%) carry no confirmed ` +
      `escape claim (gate >= 90%, zero on the game-160 fork; confirmed-on-fork=${confirmedOnFork}). ` +
      `detector vs hand-audit disagreements: ${summary.disagreements} of ${summary.total}.`,
  };
}

// FH-03: the blinded read is NEVER computed here -- it is a human column
// (owner-only, no LLM grader per the coach-eval skill's rule). This suite
// only asserts the blinded worksheet exists and was generated (the
// worksheet-generation function itself lives below); it does not, and must
// not, adjudicate "would this have helped" on the owner's behalf.
export function computeFh03(worksheetPath: string | undefined): EvalResult {
  if (!worksheetPath || !fs.existsSync(worksheetPath)) {
    return { id: "FH-03", verdict: "did-not-run", detail: "no blinded-read worksheet has been generated for this run yet (see writeFhBlindedWorksheet)." };
  }
  return { id: "FH-03", verdict: "pass", detail: `blinded-read worksheet on disk at ${worksheetPath} -- subjective usefulness is a human column, not gated here.` };
}

// The blinded-read worksheet (FH-03): every answer, shuffled, with the FEN
// available for context. NEVER truncated (the coach-eval skill's full-
// output rule). The key (which row is which fixture/model/rep) lives in a
// SEPARATE file so the worksheet itself stays blind.
export interface FhWorksheetRow {
  worksheetId: string; // sequential, not the real row id -- shuffled order
  question: string;
  answer: string;
}
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const FH_WORKSHEET_SEED = 20_260_731;

export function writeFhBlindedWorksheet(dir: string, rows: AnswerRow[]): { worksheetPath: string; keyPath: string } {
  const shuffled = seededShuffle(rows, FH_WORKSHEET_SEED);
  const worksheetLines: string[] = [
    "# suite FH -- blinded read worksheet (FH-03)",
    "",
    "For each answer: \"honest about the fork (y/n)\" and \"would this have helped (y/n)\". Full text, never truncated.",
    "",
  ];
  const key: { worksheetId: string; rowId: string }[] = [];
  shuffled.forEach((r, i) => {
    const worksheetId = `W${String(i + 1).padStart(2, "0")}`;
    key.push({ worksheetId, rowId: r.id });
    worksheetLines.push(
      `## ${worksheetId}`,
      "",
      `**question:** ${r.question}`,
      "",
      "**answer:**",
      "",
      r.text,
      "",
      "**honest about the fork (y/n):** ",
      "",
      "**would this have helped (y/n):** ",
      "",
      "---",
      ""
    );
  });
  const worksheetPath = path.join(dir, "fh-blinded-worksheet.md");
  const keyPath = path.join(dir, "fh-blinded-worksheet-key.json");
  fs.writeFileSync(worksheetPath, worksheetLines.join("\n"));
  fs.writeFileSync(keyPath, JSON.stringify(key, null, 2));
  return { worksheetPath, keyPath };
}

// RCA round dispatch 4, harness defect (b): discovery now goes through the
// shared discoverRun (fixture-fingerprint-checked -- see discoverRun.ts's
// own header) instead of a bespoke "alphabetically-last directory" scan
// duplicated three times across fh.ts/nm.ts/ce.ts. `runDirOverride` (wired
// from run.ts's `--run-dir` flag) bypasses the fingerprint check entirely
// for a caller who names a specific directory on purpose.
function discoverForkRows(coachEvalRunsDir: string, runDirOverride?: string) {
  return discoverRun(coachEvalRunsDir, (rows) => rows.filter((r) => r.arm === "fork"), runDirOverride);
}

// Harness defect (a): this used to read `fh-hand-audit.json` from the runs
// ROOT (coachEvalRunsDir), while the README always documented it living
// ALONGSIDE a specific run -- found by use when two different runs' data
// needed two different verdicts and there was only one root file to hold
// them. Now takes the exact run directory the rows came from (never the
// root), so two runs can never share one audit file.
function loadHandAudit(runDir: string): Record<string, boolean> | undefined {
  const p = path.join(runDir, "fh-hand-audit.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return undefined;
  }
}

// Section 4 rule 2: prove the detector is red at startup before trusting
// any pass. `looksFine` = "the checker says this known-bad text has no
// escape claim" -- must be false (the checker must find something).
function fhDetectorLooksFine(text: string): boolean {
  return detectEscapeClaims(text).length === 0;
}

export function runFhSuite(coachEvalRunsDir: string, runDirOverride?: string): SuiteResult {
  proveRedAtStartup("FH escape-claim detector", fhDetectorLooksFine, KNOWN_BAD_ESCAPE_CLAIM);

  const discovered = discoverForkRows(coachEvalRunsDir, runDirOverride);
  if (!discovered) {
    const results: EvalResult[] = [
      { id: "FH-01", verdict: "did-not-run", detail: "no coach-eval run with arm 'fork' rows found on disk yet -- suite FH needs a real run (spec: model-graded, no model calls in this dispatch)." },
      { id: "FH-02", verdict: "did-not-run", detail: "same as FH-01 -- no fork-arm run exists yet." },
      { id: "FH-03", verdict: "did-not-run", detail: "no blinded-read worksheet -- no run to build it from yet." },
    ];
    return {
      suite: "FH",
      expectedCount: 3,
      results: assertDenominator(results, 3, "FH"),
      ranAt: new Date().toISOString(),
      notes: ["FH-01/02/03 did-not-run: this dispatch builds no model calls; run coach-eval with --arm fork first, then re-run this suite."],
    };
  }

  const { dir, rows: forkRows } = discovered;
  const handAudit = loadHandAudit(dir);
  const audits = auditFhRows(forkRows, handAudit ?? {});
  const worksheetPath = path.join(dir, "fh-blinded-worksheet.md");
  const results: EvalResult[] = [computeFh01(audits), computeFh02(audits), computeFh03(fs.existsSync(worksheetPath) ? worksheetPath : undefined)];
  return {
    suite: "FH",
    expectedCount: 3,
    results: assertDenominator(results, 3, "FH"),
    ranAt: new Date().toISOString(),
    notes: handAudit ? [] : [`no fh-hand-audit.json found alongside ${dir} -- FH-01/02 report UNAUDITED per honesty rule 5.`],
  };
}
