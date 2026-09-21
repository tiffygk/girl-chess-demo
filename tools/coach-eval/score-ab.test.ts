// tools/coach-eval/score-ab.test.ts
//
// TDD for score-ab.ts (task-5b, 2026-09-20 coach-eval A/B round). All tests
// build a synthetic run dir under a temp directory -- never touches the
// real tools/coach-eval/runs/, never opens data/girlchess.db, never starts
// or kills anything. auditFhRows/detectEscapeClaims (suite FH's row check)
// is a pure text regex -- no engine/Stockfish call anywhere in this file.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { scoreDir } from "./score-ab";
import type { AnswerRow } from "./score";
import { FIXTURES, MATE_FACTS } from "./fixtures";
import { KNOWN_BAD_ESCAPE_CLAIM } from "./escapeClaims";

let tmpDir: string;
let runDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-ab-test-"));
  runDir = path.join(tmpDir, "2026-09-20-ab-testcode-mate-rep1");
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function row(overrides: Partial<AnswerRow> & { id: string; fixtureId: string }): AnswerRow {
  return {
    question: "what should i play here?",
    tag: "dir",
    arm: "board-live",
    probe: false,
    text: "I'm not sure -- think it over for a moment.",
    source: "model",
    regenCount: 0,
    latencyMs: 1000,
    ...overrides,
  } as AnswerRow;
}

function writeRaw(dir: string, rows: unknown[]): void {
  fs.writeFileSync(path.join(dir, "raw-sonnet-rep1.json"), JSON.stringify(rows, null, 2));
}

function readJson(dir: string, name: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}

describe("scoreDir", () => {
  it("scores a mate dir: nm.json and la.json get one rowVerdict each, fh.json is DID-NOT-RUN with no rowVerdicts", () => {
    const mateRow = row({ id: "R1", fixtureId: "MT1", arm: "mate" });
    writeRaw(runDir, [mateRow]);

    scoreDir(runDir);

    const fh = readJson(runDir, "fh.json");
    expect(fh.results.every((r: { verdict: string }) => r.verdict === "did-not-run")).toBe(true);
    expect(fh.rowVerdicts).toEqual([]);

    const nm = readJson(runDir, "nm.json");
    expect(nm.rowVerdicts).toHaveLength(1);
    expect(nm.rowVerdicts[0]).toMatchObject({ rowId: "R1", fixtureId: "MT1" });
    expect(["pass", "red"]).toContain(nm.rowVerdicts[0].verdict);

    const la = readJson(runDir, "la.json");
    expect(la.rowVerdicts).toHaveLength(1);
    expect(la.rowVerdicts[0]).toMatchObject({ rowId: "R1", fixtureId: "MT1" });

    const phase = readJson(runDir, "score-ab.phase.json");
    expect(phase.phase).toBe("scored");
    expect(phase.suites).toEqual(["fh", "nm", "la", "ce"]);
  });

  it("flags a fork row that escapes the forced-loss check with a red rowVerdict", () => {
    const forkDir = path.join(tmpDir, "2026-09-20-ab-testcode-fork-rep1");
    fs.mkdirSync(forkDir, { recursive: true });
    const escapingRow = row({ id: "R2", fixtureId: "FK3", arm: "fork", text: KNOWN_BAD_ESCAPE_CLAIM });
    writeRaw(forkDir, [escapingRow]);

    scoreDir(forkDir);

    const fh = readJson(forkDir, "fh.json");
    expect(fh.rowVerdicts).toHaveLength(1);
    expect(fh.rowVerdicts[0]).toMatchObject({ rowId: "R2", fixtureId: "FK3", verdict: "red" });
  });

  // Fix round 1 (task-5b-review.md, Minor promoted): FH row verdicts must
  // distinguish the mechanically-proven-forced zero-tolerance rows
  // (fh.ts's own GAME_160_PROVEN_FORCED_IDS, imported not copied) from
  // every other fork row an escape claim is flagged on -- an escape claim
  // outside that list "might be TRUE" per fh.ts's own comment, so it is a
  // candidate for the controller's hand audit, not the same zero-tolerance
  // finding.
  it("splits FH row ids: proven-forced escape claim is FH-ROW, non-proven is FH-ROW-CANDIDATE, clean is FH-ROW pass", () => {
    const forkDir = path.join(tmpDir, "2026-09-20-ab-testcode-fork-rep2");
    fs.mkdirSync(forkDir, { recursive: true });
    const provenForcedEscaping = row({ id: "R10", fixtureId: "FK3", arm: "fork", text: KNOWN_BAD_ESCAPE_CLAIM });
    const nonProvenEscaping = row({ id: "R11", fixtureId: "FK1", arm: "fork", text: KNOWN_BAD_ESCAPE_CLAIM });
    const clean = row({ id: "R12", fixtureId: "FK2", arm: "fork" });
    writeRaw(forkDir, [provenForcedEscaping, nonProvenEscaping, clean]);

    scoreDir(forkDir);

    const fh = readJson(forkDir, "fh.json");
    const byRowId = Object.fromEntries(fh.rowVerdicts.map((rv: { rowId: string }) => [rv.rowId, rv]));
    expect(byRowId.R10).toMatchObject({ id: "FH-ROW", fixtureId: "FK3", verdict: "red" });
    expect(byRowId.R11).toMatchObject({ id: "FH-ROW-CANDIDATE", fixtureId: "FK1", verdict: "red" });
    expect(byRowId.R12).toMatchObject({ id: "FH-ROW", fixtureId: "FK2", verdict: "pass" });
  });

  it("refuses to overwrite an existing suite json without --force", () => {
    writeRaw(runDir, [row({ id: "R1", fixtureId: "MT1", arm: "mate" })]);
    scoreDir(runDir);

    expect(() => scoreDir(runDir)).toThrow(/already exists/);

    // --force allows a re-score.
    expect(() => scoreDir(runDir, { force: true })).not.toThrow();
  });

  it("throws naming the dir and row when a row is missing fixtureId", () => {
    const badRow = { id: "R3", arm: "mate", question: "x", tag: "dir", probe: false, text: "y", source: "model", regenCount: 0, latencyMs: 1 };
    writeRaw(runDir, [badRow]);

    expect(() => scoreDir(runDir)).toThrow(new RegExp(`${runDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*R3|R3.*${runDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});

// Sanity: FIXTURES/MATE_FACTS are imported to confirm MT1 is a real fixture
// this test's synthetic row references (never hardcode a fixtureId that
// doesn't exist in fixtures.ts).
describe("fixture sanity", () => {
  it("MT1 exists and has a known best move", () => {
    expect(FIXTURES.MT1).toBeDefined();
    expect(MATE_FACTS.MT1.bestUci).toBeTruthy();
  });
});
