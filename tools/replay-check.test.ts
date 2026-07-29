import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import {
  unconvertedInvariant,
  missedMateInvariant,
  isKnownDebriefViolation,
  KNOWN_DEBRIEF_VIOLATIONS,
  KNOWN_UNCONVERTED_GAMES,
  KNOWN_EM_DASH_TRACES,
  KNOWN_DEFENSE_CLAIM_TRACES,
  regenLegOk,
  REGEN_MIN_CANDIDATES,
  REGEN_RATE_MAX,
  countDbSnapshot,
  checkDbIntact,
  type DbCountSnapshot,
} from "./replay-check";
import { detectMissedWins } from "../server/annotator/missedWins";
import type { MoveEval } from "../server/annotator/turningPoints";

// A legal 8-ply knight shuffle that repeats the start position three times,
// with evals pinning white at winprob ~1.0. Stored evals are side-to-move
// signed for the position AFTER the ply (missedWins.ts header): after her
// odd plies black is to move, so -900 for black is +900 for white.
const sans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
const winningDraw: MoveEval[] = sans.map((san, i) => ({
  ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: null,
}));

describe("replay-check invariants", () => {
  it("unconverted: a winning draw with no explaining point is a violation naming the numbers", () => {
    const v = unconvertedInvariant(winningDraw, "1/2-1/2", []);
    expect(v).toMatch(/final winprob/);
    expect(v).toMatch(/1\/2-1\/2/);
  });
  it("unconverted: satisfied once an unconverted point exists", () => {
    expect(unconvertedInvariant(winningDraw, "1/2-1/2", [{ kind: "unconverted" }])).toBeNull();
  });
  it("unconverted: silent on a win and on a never-winning draw", () => {
    expect(unconvertedInvariant(winningDraw, "1-0", [])).toBeNull();
    const level = winningDraw.map((m) => ({ ...m, evalCp: m.evalCp! > 0 ? 10 : -10 }));
    expect(unconvertedInvariant(level, "1/2-1/2", [])).toBeNull();
  });
  it("missed mate: an m1 walked past with no detector event is a violation; the real detector satisfies it", () => {
    const moves: MoveEval[] = [
      { ply: 2, san: "Kg8", evalCp: null, evalMate: 1 },
      { ply: 3, san: "Qd2", evalCp: 300, evalMate: null },
    ];
    expect(missedMateInvariant(moves, [])).toMatch(/blind/);
    expect(missedMateInvariant(moves, detectMissedWins(moves))).toBeNull();
  });
});

// F1 (review-1.md important): the debrief allowlist used to be per-GAME --
// `KNOWN_DEBRIEF_VIOLATION_GAMES.has(gameId)` exempted a listed game from
// ALL 14 debriefInvariants.ts rules, not just the one it is known to
// break. Concrete consequence measured live tonight: once Task 2's
// unconverted detector landed, game 151 started ALSO firing
// reassurance-vs-detector -- a DIFFERENT rule than the documented
// win-copy-on-non-win gap -- and the blanket skip hid it from the gate.
// isKnownDebriefViolation is per-(game, rule): proven here by picking a
// rule NOT on game 151's list and asserting it is NOT excused, exactly
// the case that used to slip through. (Manually verified against the live
// corpus too: temporarily dropping "151:reassurance-vs-detector" from
// KNOWN_DEBRIEF_VIOLATIONS and re-running `npx tsx tools/replay-check.ts`
// flips VERDICT from PASS to FAIL on that exact rule -- see report.)
describe("F1: debrief allowlist is per (game, rule), not per game", () => {
  it("a game's documented rule is excused", () => {
    expect(isKnownDebriefViolation(151, "win-copy-on-non-win")).toBe(true);
    expect(isKnownDebriefViolation(140, "win-copy-on-non-win")).toBe(true);
  });
  it("the SAME game breaking a DIFFERENT, undocumented rule is NOT excused -- this is the false green F1 fixed", () => {
    // 140 is only ever documented for win-copy-on-non-win. A blanket
    // per-game skip would excuse this too; the per-(game,rule) form must not.
    expect(isKnownDebriefViolation(140, "reassurance-vs-detector")).toBe(false);
    expect(isKnownDebriefViolation(140, "phase-mismatch")).toBe(false);
  });
  it("a game with no entries at all is never excused", () => {
    expect(isKnownDebriefViolation(999999, "win-copy-on-non-win")).toBe(false);
  });
});

// F3 (review-1.md important): `regenCandidates > 0 ? regenCount /
// regenCandidates : 0` used to read an EMPTY denominator as rate 0 -- a
// perfect score for having verified nothing. Task 5 is precisely the task
// likely to change what counts as a model-sourced chat trace; if its
// WHERE clause (kind='chat' AND source='model') stops matching, this leg
// must fail loudly, not silently print "0.0% (0/0)" and pass.
describe("F3: the regen leg fails loudly on an empty or implausibly small denominator", () => {
  it("an EMPTY denominator (0/0) is not a pass -- this is the exact false green F3 fixed", () => {
    // Before this fix: regenCandidates > 0 ? ... : 0 => rate 0, 0 <= 0.15 => ok.
    const legacyRate = 0; // what the old ternary produced for n=0
    expect(legacyRate <= REGEN_RATE_MAX).toBe(true); // demonstrates the old bug would have passed
    const fixed = regenLegOk(0, 0);
    expect(fixed.ok).toBe(false);
    expect(fixed.reason).toMatch(/denominator too small/);
  });
  it("an implausibly small but non-empty denominator with zero violations still fails", () => {
    // 3 candidates, 0 would-be-regens: rate is a perfect 0%, but 3 is far
    // below a plausible corpus size and must not be trusted as a real
    // measurement.
    expect(REGEN_MIN_CANDIDATES).toBeGreaterThan(3);
    const result = regenLegOk(3, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/denominator too small/);
  });
  it("today's real measured shape (39 candidates, 4 violations) passes for the real reason", () => {
    const result = regenLegOk(39, 4);
    expect(result.ok).toBe(true);
    expect(result.rate).toBeCloseTo(4 / 39, 5);
  });
  it("a real, adequately-sized denominator that exceeds the rate still fails on the rate, not the floor", () => {
    const result = regenLegOk(39, 30);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds REGEN_RATE_MAX/);
  });
});

// F4 (review-1.md important): nothing enforced that the ratchet allowlists
// only ever shrink -- a future task could add an id to any of these Sets
// and no test would go red. These pins name the exact CONTENTS (not just
// a size), so growing any of them requires deliberately editing this
// file. Shrinking (a ratchet actually ratcheting, e.g. Task 3 clearing
// game 151/140 from KNOWN_DEBRIEF_VIOLATIONS) is expected and welcome --
// lower this pin freely. Growing needs a stated reason in the same commit.
//
// Proven red by mutation (not committed): adding 999 to
// KNOWN_UNCONVERTED_GAMES and re-running `npx vitest run tools/replay-check.test.ts`
// fails this exact test with the expected/actual arrays differing by
// exactly that one id -- see report for the observed failure.
describe("F4: ratchet allowlists are pinned -- growth requires editing this test", () => {
  it("KNOWN_UNCONVERTED_GAMES", () => {
    expect([...KNOWN_UNCONVERTED_GAMES].sort((a, b) => a - b)).toEqual([]);
  });
  it("KNOWN_EM_DASH_TRACES", () => {
    expect([...KNOWN_EM_DASH_TRACES].sort((a, b) => a - b)).toEqual([46, 94, 123]);
  });
  it("KNOWN_DEFENSE_CLAIM_TRACES", () => {
    expect([...KNOWN_DEFENSE_CLAIM_TRACES].sort((a, b) => a - b)).toEqual([118]);
  });
  it("KNOWN_DEBRIEF_VIOLATIONS (per game:rule)", () => {
    expect([...KNOWN_DEBRIEF_VIOLATIONS].sort()).toEqual([
      "140:win-copy-on-non-win",
      "151:reassurance-vs-detector",
      "151:unconverted-silent",
      "151:win-copy-on-non-win",
    ]);
  });
});

// F5 (review-1.md medium): a sha256 before/after of her LIVE db throws the
// instant she plays a move and SQLite folds its WAL into the main file --
// no data touched, hash moves anyway. gate.ts's own header documents
// removing exactly this pattern from the owner-db check for the same
// reason (project's standing rule: her db is verified by COUNTING, never
// hashing). checkDbIntact replaces the hash comparison; these tests build
// real temp sqlite files (never her live db) to prove both directions:
// counts-only-increase does not false-fail, and an actual loss/corruption
// still throws.
describe("F5: db isolation is verified by counting, never hashing", () => {
  function makeTempDb(games: number, moves: number): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-check-f5-"));
    const p = path.join(dir, "test.db");
    const db = new Database(p);
    db.exec(`
      CREATE TABLE games(id INTEGER PRIMARY KEY);
      CREATE TABLE moves(id INTEGER PRIMARY KEY);
    `);
    const insertGame = db.prepare("INSERT INTO games DEFAULT VALUES");
    for (let i = 0; i < games; i++) insertGame.run();
    const insertMove = db.prepare("INSERT INTO moves DEFAULT VALUES");
    for (let i = 0; i < moves; i++) insertMove.run();
    db.close();
    return p;
  }

  it("countDbSnapshot counts games/moves and reports integrity ok on a real file", () => {
    const p = makeTempDb(3, 10);
    const snap = countDbSnapshot(p);
    expect(snap).toEqual({ games: 3, moves: 10, integrity: "ok" });
  });

  it("same-or-higher counts (she played during the run) are NOT an isolation violation -- the false-red F5 fixed", () => {
    const before: DbCountSnapshot = { games: 152, moves: 1368, integrity: "ok" };
    const afterSameCounts: DbCountSnapshot = { games: 152, moves: 1368, integrity: "ok" };
    const afterSheKeptPlaying: DbCountSnapshot = { games: 153, moves: 1375, integrity: "ok" };
    // Under the OLD sha256 approach, a WAL checkpoint alone (no row change)
    // flips the hash and would have thrown even for afterSameCounts; a new
    // move (afterSheKeptPlaying) definitely changes the hash. Neither is a
    // real isolation violation and neither should throw here.
    expect(checkDbIntact(before, afterSameCounts)).toBeUndefined();
    expect(checkDbIntact(before, afterSheKeptPlaying)).toBeUndefined();
  });

  it("a count DECREASE is a real isolation violation and still fails loudly", () => {
    const before: DbCountSnapshot = { games: 152, moves: 1368, integrity: "ok" };
    const afterLostRows: DbCountSnapshot = { games: 152, moves: 1360, integrity: "ok" };
    const reason = checkDbIntact(before, afterLostRows);
    expect(reason).toMatch(/lost rows/);
    expect(reason).toMatch(/isolation was violated/);
  });

  it("a broken integrity_check fails loudly regardless of counts", () => {
    const before: DbCountSnapshot = { games: 152, moves: 1368, integrity: "ok" };
    const afterCorrupt: DbCountSnapshot = { games: 152, moves: 1368, integrity: "corruption found" };
    expect(checkDbIntact(before, afterCorrupt)).toMatch(/integrity_check returned/);
  });
});
