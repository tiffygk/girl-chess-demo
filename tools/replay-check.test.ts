import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import {
  unconvertedInvariant,
  unconvertedAnchorInvariant,
  noPlyCollisionInvariant,
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
import { detectUnconverted } from "../server/annotator/unconverted";
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

  // P1 (review-2-pass2.md MERGE BLOCKER): F6's fix added
  // UNCONVERTED_MIN_RUN_PLIES to the detector but this invariant never
  // learned about it -- it still demands a point exist the moment the
  // FINAL reading alone clears UNCONVERTED_MIN_P, exactly the 1-ply-run
  // shape the detector now correctly declines to flag. Real game 113
  // shape: a 4-ply drawn game where only the last stored reading is
  // bumped above threshold (run length 1, same shape review-2.md measured
  // on games 113/127/140). Before this fix: un-passable GATE: FAIL with
  // nothing that can satisfy it (KNOWN_UNCONVERTED_GAMES is empty and its
  // own comment forbids a refill). After this fix: the invariant applies
  // the SAME run-length floor as the detector and is satisfiable (silent).
  it("unconverted: a game-113 shape (4 plies, only the final reading bumped) is a run too short -- the gate must not demand a point the detector correctly declines to emit", () => {
    const game113Shape: MoveEval[] = [
      { ply: 1, san: "e4", evalCp: 20, evalMate: null },
      { ply: 2, san: "e5", evalCp: -20, evalMate: null },
      { ply: 3, san: "Qh5", evalCp: 30, evalMate: null },
      { ply: 4, san: "Nc6", evalCp: 900, evalMate: null }, // only the final reading bumped
    ];
    // The real detector agrees nothing is owed here (run length 1 < floor).
    expect(detectUnconverted(game113Shape, "1/2-1/2")).toBeNull();
    // The gate must be satisfiable with no point present -- this is the
    // exact un-passable-gate landmine P1 describes.
    expect(unconvertedInvariant(game113Shape, "1/2-1/2", [])).toBeNull();
  });
  it("missed mate: an m1 walked past with no detector event is a violation; the real detector satisfies it", () => {
    const moves: MoveEval[] = [
      { ply: 2, san: "Kg8", evalCp: null, evalMate: 1 },
      { ply: 3, san: "Qd2", evalCp: 300, evalMate: null },
    ];
    expect(missedMateInvariant(moves, [])).toMatch(/blind/);
    expect(missedMateInvariant(moves, detectMissedWins(moves))).toBeNull();
  });

  // M2 fix (union review, 2026-07-31): widened from missedWins.ts's depth-1
  // constant to conversion.ts's depth-5. This fixture (a mate-in-4 walked
  // past, slipping to mate-in-6) was INVISIBLE to the old depth-1-gated
  // check -- pre.evalMate=4 > the old MISSED_MATE_DEPTH(1) used to `continue`
  // before the row was ever examined, so an unfixed implementation reports
  // NO violation here even with an empty events list. mateIn 1 alone (the
  // test above) cannot prove this widening; it needs a depth strictly
  // between 2 and 5 to discriminate.
  it("missed mate: a mate-in-4 slip is now caught (was invisible at the old depth-1 gate)", () => {
    const moves: MoveEval[] = [
      { ply: 2, san: "Kg8", evalCp: null, evalMate: 4 },
      { ply: 3, san: "Qd2", evalCp: null, evalMate: -6 }, // slipped mate-4 -> mate-6, not vanished
    ];
    expect(missedMateInvariant(moves, [])).toMatch(/blind/);
    expect(missedMateInvariant(moves, [{ ply: 3 }])).toBeNull();
  });
});

// Union review DELTA (2026-07-31): the collision found in turningPoints.ts's
// H1+H2 fix -- bestMissedPly and the missed-win point's own anchor both
// hunt the shallowest mate in a held run, so they can land on the same ply
// (measured on 5 of her real games: 85, 86, 132, 149, 159). The fix
// suppresses the duplicate point at the data layer; this is the corpus-wide
// proof that guard actually holds, since nothing else in the gate checked
// for two points sharing a ply.
describe("noPlyCollisionInvariant (union review DELTA)", () => {
  it("fires when two points share a ply", () => {
    const points = [
      { kind: "missed-win", ply: 37 },
      { kind: "conversion", ply: 37 },
    ];
    expect(noPlyCollisionInvariant(1, points)).toMatch(/share ply 37/);
  });
  it("stays silent when every point has its own ply", () => {
    const points = [
      { kind: "swing", ply: 8 },
      { kind: "missed-win", ply: 37 },
      { kind: "conversion", ply: 49 },
    ];
    expect(noPlyCollisionInvariant(1, points)).toBeNull();
  });
  it("stays silent on an empty or single-point game", () => {
    expect(noPlyCollisionInvariant(1, [])).toBeNull();
    expect(noPlyCollisionInvariant(1, [{ kind: "swing", ply: 8 }])).toBeNull();
  });
});

// F4 (review-2.md MEDIUM): invariant 1 (unconvertedInvariant above) recomputes
// with the SAME buildDeltaSeries/computeTurningPoints output it is checking
// -- genuine closure for EXISTENCE only. It has zero power over which ply
// gets anchored, so an "unconverted" point on the wrong ply (even the
// owner's explicitly forbidden ply 47) would still pass a green gate.
// unconvertedAnchorInvariant gives the gate power over the anchor itself:
// game 151 must land at ply 43 with endKind "repetition", and no
// unconverted point anywhere in her corpus may sit on an even (mallow's)
// ply.
describe("F4 (review-2.md): the gate has power over the anchor, not just existence", () => {
  it("silent when no unconverted point is present", () => {
    expect(unconvertedAnchorInvariant(999, [])).toBeNull();
    expect(unconvertedAnchorInvariant(999, [{ kind: "swing", ply: 10 } as any])).toBeNull();
  });
  it("flags an unconverted point anchored on an even (mallow's) ply -- never valid, blame or no blame", () => {
    const v = unconvertedAnchorInvariant(999, [{ kind: "unconverted", ply: 34, endKind: "called early" } as any]);
    expect(v).toMatch(/even/);
    expect(v).toMatch(/ply 34/);
  });
  it("game 151 must anchor at ply 43 with endKind repetition -- the owner's ruling, made a hard gate", () => {
    expect(
      unconvertedAnchorInvariant(151, [{ kind: "unconverted", ply: 43, endKind: "repetition" } as any])
    ).toBeNull();
    const wrongPly = unconvertedAnchorInvariant(151, [
      { kind: "unconverted", ply: 45, endKind: "repetition" } as any,
    ]);
    expect(wrongPly).toMatch(/ply 45/);
    expect(wrongPly).toMatch(/must be ply 43/);
    const wrongEndKind = unconvertedAnchorInvariant(151, [
      { kind: "unconverted", ply: 43, endKind: "called early" } as any,
    ]);
    expect(wrongEndKind).toMatch(/endKind/);
  });
  it("game 151 landing on the owner's explicitly forbidden ply 47 is a violation naming 47", () => {
    const v = unconvertedAnchorInvariant(151, [{ kind: "unconverted", ply: 47, endKind: "repetition" } as any]);
    expect(v).toMatch(/47/);
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
  // Truth round (2026-07-29), Task 3: KNOWN_DEBRIEF_VIOLATIONS emptied for
  // good -- buildDoneWell now guards the draw case generally, verified
  // against both real games this allowlist used to name (151 and 140).
  // The per-(game,rule) GRANULARITY this describe block exists to prove is
  // still live in isKnownDebriefViolation's own implementation (a Set
  // lookup keyed on "${gameId}:${rule}", not a per-game skip) -- there is
  // simply nothing left in the Set to exempt, which is the point: an entry
  // ever added back here again is a regression being hidden, not a known
  // gap being tracked.
  it("no game is excused for anything -- the debrief invariants hold on every game in her corpus", () => {
    expect(isKnownDebriefViolation(151, "win-copy-on-non-win")).toBe(false);
    expect(isKnownDebriefViolation(151, "reassurance-vs-detector")).toBe(false);
    expect(isKnownDebriefViolation(151, "unconverted-silent")).toBe(false);
    expect(isKnownDebriefViolation(140, "win-copy-on-non-win")).toBe(false);
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
    // 196/197/199/202 added 2026-08-03 (unbreak-main F2): game 169's
    // pre-normalization coach output, allowlisted as history once
    // normalizeEmDash shipped so no NEW row can leak an em-dash silently.
    expect([...KNOWN_EM_DASH_TRACES].sort((a, b) => a - b)).toEqual([46, 94, 123, 191, 193, 196, 197, 199, 202]);
  });
  it("KNOWN_DEFENSE_CLAIM_TRACES", () => {
    expect([...KNOWN_DEFENSE_CLAIM_TRACES].sort((a, b) => a - b)).toEqual([118]);
  });
  it("KNOWN_DEBRIEF_VIOLATIONS (per game:rule) -- emptied 2026-07-29 (Task 3): the ratchet actually ratcheted", () => {
    expect([...KNOWN_DEBRIEF_VIOLATIONS].sort()).toEqual([]);
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
