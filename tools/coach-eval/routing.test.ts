// tools/coach-eval/routing.test.ts
//
// Router-fix round (2026-08-03): the full-corpus routing truth table.
// Expected route derives from each question's arm -- board-live/board-review/
// fork/mate/long => "board"; general/general-theory => "general" -- under the
// BARE ctx (no focus, no pending move), which is strictly stronger than
// run.ts's real per-question ctx because hasFocus/hasPendingMove force
// "board" unconditionally. Question texts are owner-verbatim and are never
// edited to make routing pass; if a route is wrong, the ROUTER is wrong.
// This file exists so any future widening of the general door is checked
// against every board question in the corpus at unit-test speed (the
// check-widening bug class: see CLAUDE.md's Invariant rule).
import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../server/coach/intent";
import {
  BASE_QUESTIONS,
  PENDING_QUESTIONS,
  AFFIRMATION_QUESTIONS,
  BOARD_REVIEW_QUESTIONS,
  FORK_QUESTIONS,
  MATE_QUESTIONS,
  LONG_QUESTIONS,
  GENERAL_QUESTIONS,
  GENERAL_THEORY_QUESTIONS,
} from "./fixtures";

const live = { hasFocus: false, hasPendingMove: false, status: "in-progress" as const };
const finished = { hasFocus: false, hasPendingMove: false, status: "finished" as const };

describe("full-corpus routing truth table (router-fix round, 2026-08-03)", () => {
  const boardLiveArms = [
    ...BASE_QUESTIONS,
    ...PENDING_QUESTIONS,
    ...AFFIRMATION_QUESTIONS,
    ...FORK_QUESTIONS,
    ...MATE_QUESTIONS,
    ...LONG_QUESTIONS,
  ];

  it("covers the whole corpus (drift guard: a new arm must be added here deliberately)", () => {
    // 65 board-live + 12 fork + 7 mate + 4 long = 88 live-board rows;
    // 16 board-review; 15 general + 10 general-theory = 25 general rows.
    expect(boardLiveArms.length).toBe(88);
    expect(BOARD_REVIEW_QUESTIONS.length).toBe(16);
    expect(GENERAL_QUESTIONS.length + GENERAL_THEORY_QUESTIONS.length).toBe(25);
  });

  for (const q of boardLiveArms) {
    it(`${q.id} ("${q.q}") routes board under the bare live ctx`, () => {
      expect(classifyIntent(q.q, live)).toBe("board");
    });
  }

  for (const q of BOARD_REVIEW_QUESTIONS) {
    it(`${q.id} ("${q.q}") routes board under the bare finished ctx`, () => {
      expect(classifyIntent(q.q, finished)).toBe("board");
    });
  }

  for (const q of [...GENERAL_QUESTIONS, ...GENERAL_THEORY_QUESTIONS]) {
    it(`${q.id} ("${q.q}") routes general under the bare live ctx`, () => {
      expect(classifyIntent(q.q, live)).toBe("general");
    });
  }
});
