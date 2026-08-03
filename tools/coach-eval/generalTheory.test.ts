// tools/coach-eval/generalTheory.test.ts
//
// Round-3 fact-shelf coach round (2026-08-03): the isolated 10-question
// "general-theory" arm -- 10 owner-approved pure-chess-theory questions,
// used VERBATIM, each pinned to a real C1-C5 fixture, added as a DISTINCT
// arm so `--arm general-theory` selects exactly these 10 and nothing else.
//
// This test must go RED if any question is missing, reworded, mis-tagged
// (wrong arm/tag), or mispinned (ctx not spread across C1-C5) -- verified by
// mutation (see the round's own report for the red-run transcript): deleting
// one entry from GENERAL_THEORY_QUESTIONS_RAW, or flipping one entry's arm/
// tag, or changing one entry's ctx, each independently turns this file red.
//
// UPDATE (router-fix round, 2026-08-03): the routing describe block below
// USED to pin an audited 5/5 general/board split -- asserting "all 10 route
// general" would have been a false, permanently-red assertion against the
// router as it existed before this round (only tier-1 GENERAL_MARKER_RE,
// see fixtures.ts's own comment on GENERAL_THEORY_QUESTIONS_RAW). That
// router gap (gt-01/02/06/08/09 falling through to "board") is now CLOSED
// by server/coach/intent.ts's tier-2 ABSTRACT_THEORY_RE, gated on
// !hasBoardSignal. All 10 general-theory questions now route "general"; the
// block below pins that as the new truth table so a future change to
// intent.ts or to this question set that silently flips a question's route
// goes red immediately.
import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../server/coach/intent";
import {
  FIXTURES,
  GENERAL_THEORY_QUESTIONS,
  GENERAL_THEORY_QUESTION_COUNT,
  NUMBER_QUESTION_COUNT,
  TOTAL_QUESTION_COUNT,
  type FixtureId,
} from "./fixtures";

// Owner-approved verbatim text (brief's own numbered list, ids assigned in
// list order) -- the ground truth this test checks fixtures.ts against.
const EXPECTED: { id: string; ctx: FixtureId; q: string }[] = [
  { id: "gt-01", ctx: "C1", q: "what's another opening that would work well from a setup like mine?" },
  { id: "gt-02", ctx: "C1", q: "besides just developing pieces, what should i actually be trying to do in the opening?" },
  { id: "gt-03", ctx: "C2", q: "when is it worth giving up the bishop pair?" },
  { id: "gt-04", ctx: "C2", q: "what makes a pawn weak, and how do i avoid creating weak ones?" },
  { id: "gt-05", ctx: "C3", q: "how do i decide whether to play on the kingside or the queenside?" },
  { id: "gt-06", ctx: "C3", q: "what's the idea behind parking a knight on an outpost?" },
  { id: "gt-07", ctx: "C4", q: "as a rule, when should i trade queens versus keep them on the board?" },
  { id: "gt-08", ctx: "C4", q: "what are the key principles for a king-and-pawn endgame?" },
  { id: "gt-09", ctx: "C5", q: "what does it mean to play for the initiative instead of just reacting?" },
  {
    id: "gt-10",
    ctx: "C5",
    q: "how do i come up with a plan when i don't see any threats or openings for attacks? i'm not sure how to do defense or offense if everything seems even.",
  },
];

describe("general-theory arm loads exactly the 10 owner-approved fixtures", () => {
  it("has exactly 10 rows, and GENERAL_THEORY_QUESTION_COUNT/TOTAL_QUESTION_COUNT agree", () => {
    expect(GENERAL_THEORY_QUESTIONS.length).toBe(10);
    expect(GENERAL_THEORY_QUESTION_COUNT).toBe(10);
    // 96 (frozen board-live/general/board-review) + 23 (RCA fork/mate/long)
    // + 10 (this arm) + the numbers arm's own count (added 2026-08-03,
    // additive on top -- not this test's concern, but the sum must stay
    // honest as new arms land).
    expect(TOTAL_QUESTION_COUNT).toBe(96 + 23 + 10 + NUMBER_QUESTION_COUNT);
  });

  it("every expected id is present exactly once, with VERBATIM question text and the right ctx", () => {
    const byId = new Map(GENERAL_THEORY_QUESTIONS.map((q) => [q.id, q]));
    expect(byId.size).toBe(EXPECTED.length); // no duplicate/missing ids
    for (const exp of EXPECTED) {
      const row = byId.get(exp.id);
      expect(row, `missing general-theory question ${exp.id}`).toBeTruthy();
      expect(row!.q, `${exp.id} text drifted from the owner-approved verbatim wording`).toBe(exp.q);
      expect(row!.ctx, `${exp.id} pinned to the wrong fixture`).toBe(exp.ctx);
    }
  });

  it("every row is tagged arm:general-theory, tag:general, probe:false -- the filterable set --arm general-theory selects", () => {
    for (const q of GENERAL_THEORY_QUESTIONS) {
      expect(q.arm).toBe("general-theory");
      expect(q.tag).toBe("general");
      expect(q.probe).toBe(false);
    }
  });

  it("anchors span all five of C1-C5 (2 questions per fixture) -- not all one position", () => {
    const ctxCounts = new Map<string, number>();
    for (const q of GENERAL_THEORY_QUESTIONS) ctxCounts.set(q.ctx, (ctxCounts.get(q.ctx) ?? 0) + 1);
    for (const id of ["C1", "C2", "C3", "C4", "C5"] as FixtureId[]) {
      expect(FIXTURES[id], `${id} must be a real fixture`).toBeTruthy();
      expect(ctxCounts.get(id), `fixture ${id} has no general-theory question pinned to it`).toBe(2);
    }
  });
});

// Verified 2026-08-03 against the shipped classifyIntent, POST router-fix
// (tier-2 ABSTRACT_THEORY_RE, gated on !hasBoardSignal, closes the
// gt-01/02/06/08/09 gap) -- see this file's header comment.
const ROUTING_TRUTH: Record<string, "general" | "board"> = {
  "gt-01": "general",
  "gt-02": "general",
  "gt-03": "general",
  "gt-04": "general",
  "gt-05": "general",
  "gt-06": "general",
  "gt-07": "general",
  "gt-08": "general",
  "gt-09": "general",
  "gt-10": "general",
};

describe("general-theory routing through the SAME classifyIntent manager.ts calls (router finding, 2026-08-03)", () => {
  it("10 of 10 route general -- pinned so a future drift is caught, not silently reintroduced or hidden", () => {
    expect(Object.values(ROUTING_TRUTH).filter((v) => v === "general").length).toBe(10);
    expect(Object.values(ROUTING_TRUTH).filter((v) => v === "board").length).toBe(0);
    for (const q of GENERAL_THEORY_QUESTIONS) {
      // hasFocus/hasPendingMove are always false for this arm (bare context,
      // no hintFocus/pending move attached -- same ctx run.ts's own
      // buildContext produces for tag "general"); status is "in-progress",
      // the same live status run.ts passes (this arm's fixtures are never
      // board-review). Mirrors score.test.ts's existing "general-arm intent
      // routing" describe block's own ctx shape exactly.
      const intent = classifyIntent(q.q, { hasFocus: false, hasPendingMove: false, status: "in-progress" });
      expect(intent, `"${q.id}" routing drifted from the audited 2026-08-03 post-fix baseline`).toBe(
        ROUTING_TRUTH[q.id]
      );
    }
  });

  it("the mis-routed-to-board set is empty (router-fix round, 2026-08-03 closed the gap)", () => {
    const misrouted = GENERAL_THEORY_QUESTIONS.filter(
      (q) => classifyIntent(q.q, { hasFocus: false, hasPendingMove: false, status: "in-progress" }) === "board"
    ).map((q) => q.id);
    expect(misrouted).toEqual([]);
  });
});
