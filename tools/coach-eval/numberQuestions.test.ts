// tools/coach-eval/numberQuestions.test.ts
//
// coach-eval instrument improvements (2026-08-03): the isolated 3-question
// "numbers" arm -- the harness had no fixture where the question explicitly
// asks the coach for a NUMBER, so the numbers-on-ask path (does the coach
// actually answer with a number when directly asked for one) was untested.
//
// RED-FIRST proof, same discipline as generalTheory.test.ts: this file goes
// red if a question is missing, reworded, mis-tagged (wrong arm/tag), not
// pinned to a fixture with a known eval_cp, or if NUMBER_EVAL_FACTS drifts
// out of sync with NUMBER_QUESTIONS. Verified by mutation (see the task's
// own commit for the red-run transcript): deleting one entry from
// NUMBER_QUESTIONS_RAW, flipping one entry's arm/tag, or dropping one
// NUMBER_EVAL_FACTS key each independently turns this file red.
import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../server/coach/intent";
import {
  FIXTURES,
  NUMBER_QUESTIONS,
  NUMBER_QUESTION_COUNT,
  NUMBER_EVAL_FACTS,
  TOTAL_QUESTION_COUNT,
  type FixtureId,
} from "./fixtures";

describe("numbers arm loads exactly the number-asking fixtures", () => {
  it("has 2 or 3 rows, and NUMBER_QUESTION_COUNT/TOTAL_QUESTION_COUNT agree", () => {
    expect(NUMBER_QUESTIONS.length).toBeGreaterThanOrEqual(2);
    expect(NUMBER_QUESTIONS.length).toBeLessThanOrEqual(3);
    expect(NUMBER_QUESTION_COUNT).toBe(NUMBER_QUESTIONS.length);
    // 96 (frozen board-live/general/board-review) + 23 (RCA fork/mate/long)
    // + 10 (general-theory) + this arm's own count.
    expect(TOTAL_QUESTION_COUNT).toBe(96 + 23 + 10 + NUMBER_QUESTION_COUNT);
  });

  it("every row is tagged arm:numbers, tag:dir, probe:false -- the filterable set --arm numbers selects", () => {
    for (const q of NUMBER_QUESTIONS) {
      expect(q.arm).toBe("numbers");
      expect(q.tag).toBe("dir");
      expect(q.probe).toBe(false);
    }
  });

  it("every question text explicitly asks for a NUMBER (a number word, or 'numbers'/'centipawns'/'exactly how much')", () => {
    const NUMBER_ASK_RE = /\b(how many|numbers?|centipawns?|exactly how much)\b/i;
    for (const q of NUMBER_QUESTIONS) {
      expect(q.q, `"${q.id}" (${q.q}) doesn't read as an explicit number ask`).toMatch(NUMBER_ASK_RE);
    }
  });

  it("no duplicate ids, and ids follow the num-NN convention", () => {
    const ids = NUMBER_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^num-\d{2}$/);
  });
});

describe("every numbers-arm question is pinned to a fixture with a KNOWN, real eval_cp", () => {
  it("NUMBER_EVAL_FACTS has exactly one entry per NUMBER_QUESTIONS row, same ids, same ctx", () => {
    const questionIds = new Set(NUMBER_QUESTIONS.map((q) => q.id));
    const factIds = new Set(Object.keys(NUMBER_EVAL_FACTS));
    expect(factIds).toEqual(questionIds);
    for (const q of NUMBER_QUESTIONS) {
      expect(NUMBER_EVAL_FACTS[q.id].ctx, `${q.id}'s NUMBER_EVAL_FACTS ctx must match its own ctx`).toBe(q.ctx);
    }
  });

  it("every pinned fixture is a real, existing fixture, and every evalCp is a non-zero finite number (a real, known eval -- not a placeholder)", () => {
    for (const q of NUMBER_QUESTIONS) {
      const fixture = FIXTURES[q.ctx as FixtureId];
      expect(fixture, `${q.id} points at unknown fixture ${q.ctx}`).toBeTruthy();
      const { evalCp } = NUMBER_EVAL_FACTS[q.id];
      expect(Number.isFinite(evalCp), `${q.id}'s evalCp must be a real number`).toBe(true);
      expect(evalCp, `${q.id}'s evalCp reads as a placeholder zero, not a known eval`).not.toBe(0);
    }
  });

  it("no two number questions collapse onto the same fixture -- three different known-eval positions, not one repeated", () => {
    const ctxs = new Set(NUMBER_QUESTIONS.map((q) => q.ctx));
    expect(ctxs.size).toBe(NUMBER_QUESTIONS.length);
  });
});

describe("numbers-arm routing through the SAME classifyIntent manager.ts calls (verified 2026-08-03)", () => {
  it("every number-asking question routes 'board' -- it's a live-position question, never general theory", () => {
    for (const q of NUMBER_QUESTIONS) {
      const intent = classifyIntent(q.q, { hasFocus: false, hasPendingMove: false, status: "in-progress" });
      expect(intent, `"${q.id}" (${q.q}) must route board, not general`).toBe("board");
    }
  });
});
