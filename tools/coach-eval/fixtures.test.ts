// tools/coach-eval/fixtures.test.ts
//
// RCA acceptance-evals round (2026-07-31): tests for the three ADDITIVE
// fixture classes (fork-*/mate-*/long-*, spec section 1/3). The frozen
// 65/96-question set is asserted UNTOUCHED (byte count still 96) alongside
// the new groups, since "additive, new ids only" is the whole point of this
// round's fixtures.ts change.
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  FIXTURES,
  FORK_FIXTURE_IDS,
  MATE_FIXTURE_IDS,
  LONG_FIXTURE_IDS,
  MATE_FACTS,
  FORK_QUESTIONS,
  MATE_QUESTIONS,
  LONG_QUESTIONS,
  BOARD_LIVE_QUESTION_COUNT,
  GENERAL_QUESTION_COUNT,
  BOARD_REVIEW_QUESTION_COUNT,
  FORK_QUESTION_COUNT,
  MATE_QUESTION_COUNT,
  LONG_QUESTION_COUNT,
  TOTAL_QUESTION_COUNT,
  PIECE_WORDS,
  type Fixture,
} from "./fixtures";
import { forcedMaterialLoss } from "../rca-eval/lib/forcedLoss";
import { checkMateClaims } from "../../server/coach/mateClaims";

describe("frozen counts stay byte-identical (RCA round is additive-only)", () => {
  it("board-live/general/board-review still sum to 96", () => {
    expect(BOARD_LIVE_QUESTION_COUNT).toBe(65);
    expect(GENERAL_QUESTION_COUNT).toBe(15);
    expect(BOARD_REVIEW_QUESTION_COUNT).toBe(16);
    expect(BOARD_LIVE_QUESTION_COUNT + GENERAL_QUESTION_COUNT + BOARD_REVIEW_QUESTION_COUNT).toBe(96);
  });

  it("TOTAL_QUESTION_COUNT is the frozen 96 plus the three RCA groups (12 + 7 + 4 = 23) plus round-3's isolated general-theory 10", () => {
    expect(FORK_QUESTION_COUNT).toBe(12);
    expect(MATE_QUESTION_COUNT).toBe(7);
    expect(LONG_QUESTION_COUNT).toBe(4);
    expect(TOTAL_QUESTION_COUNT).toBe(96 + 23 + 10);
  });
});

describe("fork-* fixtures (suite FH ground truth)", () => {
  it("has exactly 6 fixtures, all midGameOfFinished", () => {
    expect(FORK_FIXTURE_IDS.length).toBe(6);
    for (const id of FORK_FIXTURE_IDS) {
      expect(FIXTURES[id].midGameOfFinished).toBe(true);
    }
  });

  it("every WHITE-TO-MOVE fork fen is a REAL forced-material-loss position (SEE/quiescence-corrected proof), except the documented FK1/FK2 exceptions", () => {
    // FK2 is deliberately excluded: it's game 160's ply-57 fen, BLACK to move
    // (right after her own Rd1) -- forcedMaterialLoss answers "is the side to
    // move forced to lose", and that's mallow's move there, not hers.
    //
    // FK1 is deliberately excluded too (instrument-audit catch, 2026-07-31):
    // it IS white-to-move, but the corrected recapture-aware verifier proves
    // it is NOT forced (white has safe quiet escapes once b2's recapture of
    // Bxa3 is counted) -- the old buggy verifier's "forced" label for FK1
    // was itself the defect this round fixed. FK1's own phase string
    // documents the honest relabel; this test asserts the negative directly
    // so a future regression in either direction (silently forced again, or
    // silently dropped) goes red.
    for (const id of FORK_FIXTURE_IDS) {
      if (id === "FK2") {
        expect(FIXTURES.FK2.fen.split(" ")[1]).toBe("b"); // confirm it's still the documented exception, not silent drift
        continue;
      }
      if (id === "FK1") {
        expect(FIXTURES.FK1.fen.split(" ")[1]).toBe("w"); // FK1 IS white-to-move...
        const result = forcedMaterialLoss(FIXTURES.FK1.fen);
        expect(result.forced, "FK1 is documented as NOT forced under the corrected math").toBe(false); // ...but not forced
        continue;
      }
      const fen = FIXTURES[id].fen;
      expect(fen.split(" ")[1], `${id} (${fen}) is not white-to-move`).toBe("w");
      const result = forcedMaterialLoss(fen);
      expect(result.forced, `${id} (${fen}) is not machine-proven forced`).toBe(true);
    }
  });

  it("FK1-3 are game 160's own ply 56/57/58 fork (baseline row B8), FK4-6 are mined from 3 other games", () => {
    expect(FIXTURES.FK1.gameId).toBe(160);
    expect(FIXTURES.FK2.gameId).toBe(160);
    expect(FIXTURES.FK3.gameId).toBe(160);
    const minedGameIds = new Set([FIXTURES.FK4.gameId, FIXTURES.FK5.gameId, FIXTURES.FK6.gameId]);
    expect(minedGameIds.size).toBe(3); // three DISTINCT games, none of them 160
    expect(minedGameIds.has(160)).toBe(false);
  });

  it("12 fork questions: 2 per fixture, both the 'avoid losing a piece' and 'without a trade' shapes", () => {
    expect(FORK_QUESTIONS.length).toBe(12);
    for (const id of FORK_FIXTURE_IDS) {
      const rows = FORK_QUESTIONS.filter((q) => q.ctx === id);
      expect(rows.length).toBe(2);
    }
    expect(FORK_QUESTIONS.some((q) => /avoid losing a piece/.test(q.q))).toBe(true);
    expect(FORK_QUESTIONS.some((q) => /without a trade/.test(q.q))).toBe(true);
  });
});

describe("mate-* fixtures (suite NM ground truth)", () => {
  it("has exactly 7 fixtures, all midGameOfFinished", () => {
    expect(MATE_FIXTURE_IDS.length).toBe(7);
    for (const id of MATE_FIXTURE_IDS) {
      expect(FIXTURES[id].midGameOfFinished).toBe(true);
    }
  });

  it("every mate fixture's bestUci is a LEGAL move at its own fen, and decodes to a real piece/square", () => {
    for (const id of MATE_FIXTURE_IDS) {
      const fixture: Fixture = FIXTURES[id];
      const { bestUci } = MATE_FACTS[id];
      const chess = new Chess(fixture.fen);
      const from = bestUci.slice(0, 2);
      const to = bestUci.slice(2, 4);
      const piece = chess.get(from as Parameters<Chess["get"]>[0]);
      expect(piece, `${id}: no piece on ${from} at ${fixture.fen}`).toBeTruthy();
      expect(PIECE_WORDS[piece!.type]).toBeTruthy();
      const mv = chess.move({ from, to, promotion: (bestUci[4] as "q") ?? "q" });
      expect(mv, `${id}: ${bestUci} is not a legal move at ${fixture.fen}`).toBeTruthy();
    }
  });

  it("mate distances are every one within the spec's 2..7 range or the named game-160/150 exceptions (5, 10, 2, 2)", () => {
    const distances = MATE_FIXTURE_IDS.map((id) => MATE_FACTS[id].mateN);
    expect(distances).toEqual([5, 10, 2, 2, 2, 3, 6]);
  });

  it("checkMateClaims (the shipped enforcer, imported not re-implemented) adjudicates each fixture's own mate-N claim as true", () => {
    for (const id of MATE_FIXTURE_IDS) {
      const { mateN } = MATE_FACTS[id];
      const violations = checkMateClaims(`this is mate in ${mateN}.`, [{ evalMate: mateN }], [mateN]);
      expect(violations, `${id}: checkMateClaims flagged its own true mate-${mateN} claim`).toEqual([]);
      const falseViolations = checkMateClaims(`this is mate in ${mateN + 1}.`, [{ evalMate: mateN }], [mateN]);
      expect(falseViolations.length, `${id}: checkMateClaims missed a false mate-${mateN + 1} claim`).toBeGreaterThan(0);
    }
  });

  it("7 mate questions, one per fixture, in fixture order MT1..MT7", () => {
    expect(MATE_QUESTIONS.length).toBe(7);
    expect(MATE_QUESTIONS.map((q) => q.ctx)).toEqual(["MT1", "MT2", "MT3", "MT4", "MT5", "MT6", "MT7"]);
  });
});

describe("long-* fixtures (suite CE early/late latency cells)", () => {
  it("has exactly 4 fixtures: game 160's early/late pair and game 149's early/late pair", () => {
    expect(LONG_FIXTURE_IDS.length).toBe(4);
    expect(FIXTURES.LN1.gameId).toBe(160);
    expect(FIXTURES.LN2.gameId).toBe(160);
    expect(FIXTURES.LN3.gameId).toBe(149);
    expect(FIXTURES.LN4.gameId).toBe(149);
    expect(FIXTURES.LN1.ply).toBeLessThan(FIXTURES.LN2.ply);
    expect(FIXTURES.LN3.ply).toBeLessThan(FIXTURES.LN4.ply);
  });

  it("LN1/LN2 deliberately reuse FK3/MT3's exact fens (the owner's own motivating early/late prompt-size pair)", () => {
    expect(FIXTURES.LN1.fen).toBe(FIXTURES.FK3.fen);
    expect(FIXTURES.LN2.fen).toBe(FIXTURES.MT3.fen);
  });

  it("4 long questions, one per fixture", () => {
    expect(LONG_QUESTIONS.length).toBe(4);
    expect(LONG_QUESTIONS.map((q) => q.ctx)).toEqual(["LN1", "LN2", "LN3", "LN4"]);
  });
});
