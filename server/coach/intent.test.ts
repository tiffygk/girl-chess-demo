import { describe, it, expect } from "vitest";
import { classifyIntent, isOffTopic, mentionedPlies, isRecordRequest } from "./intent";

function ctx(overrides: Partial<{ hasFocus: boolean; hasPendingMove: boolean; status: "in-progress" | "finished" }> = {}) {
  return { hasFocus: false, hasPendingMove: false, status: "in-progress" as const, ...overrides };
}

// Wave D (coach-truth-speed round): the deterministic router replacing
// personas/coach.md's blanket "steer back to this game" refusal. Fixture
// set drawn verbatim from her real game-146 chat questions (see the brief) --
// these are not hypotheticals, they are the exact strings that earned her
// thumbs-down.
//
// Wave F (review fix, 2026-07-27): classifyIntent's signature changed from
// (message, hasFocus: boolean) to (message, ctx). "board" is now the
// unconditional default; "general" is reached only via hasGeneralMarker
// (intent.ts). Every case below is re-expressed against the new ctx shape;
// the BOARD_FIXTURES/GENERAL_FIXTURES sets are unchanged in wording.
describe("classifyIntent", () => {
  const BOARD_FIXTURES: string[] = [
    "why was my pawn on f3 to f4 the right move",
    "cant the king still go to g7",
    "why was my move 5 an innaccuracy",
    "if my pawn went to d4 then i would not have had pieces supporting the pawns on c4 and e4",
    "But if I did that, then their pawn on c5 could have just taken my d4 pawn.",
    "What did I actually do here? I thought I did put the queen from g5 to f6.",
    "What move did I make on Move for?",
    "What would have happened if I had made my pawn take on d5 that move?",
    // Real pre-existing fixture (manager.test.ts, R1a): a retrospective
    // question about her own opening in THIS game -- not general opening
    // theory (which stays general; see the plural "endgames" fixture below).
    "was my opening okay?",
  ];

  for (const message of BOARD_FIXTURES) {
    it(`routes "${message}" to board`, () => {
      expect(classifyIntent(message, ctx())).toBe("board");
    });
  }

  // The brief's own controller-verified reproduction (review.md finding 1):
  // 38 of 65 frozen board-live eval questions -- every one of these among
  // them -- misclassified "general" under the old hasBoardSignal-gated
  // design because none of them carry a SAN/piece-verb/move-number/
  // demonstrative/phase signal. They must now default to board.
  const F1_REPRO_FIXTURES: string[] = [
    "is this ok",
    "should i take it",
    "is that a good idea",
    "what about my knight",
    "is this safe",
    "yes",
    "ok",
    "what should i do here",
  ];

  for (const message of F1_REPRO_FIXTURES) {
    it(`routes the brief's live repro "${message}" to board (F1)`, () => {
      expect(classifyIntent(message, ctx())).toBe("board");
    });
  }

  const GENERAL_FIXTURES: string[] = [
    "I learned that I always want my pawns staggered so they support each other. How do I know when it's a good idea to have them staggered versus move them in a horizontal wall?",
    "what should I work on before my next game",
    "how do I get better at endgames",
    "what is a fork",
  ];

  for (const message of GENERAL_FIXTURES) {
    it(`routes "${message}" to general`, () => {
      expect(classifyIntent(message, ctx())).toBe("general");
    });
  }

  it("routes an ambiguous message with no positional reference, no focus, and no marker to board (ambiguity resolves to board, not general)", () => {
    // Pre-fix this asserted "general" -- the exact failure direction F1
    // fixes. Board is the declared failure preference now: narrow beats
    // false.
    expect(classifyIntent("what do you think overall", ctx())).toBe("board");
    expect(classifyIntent("what do you think overall", ctx({ status: "finished" }))).toBe("board");
  });

  it("routes any message to board when hasFocus is true, even one carrying an explicit general marker", () => {
    expect(classifyIntent("what do you think overall", ctx({ hasFocus: true }))).toBe("board");
    expect(classifyIntent("how do I get better at endgames", ctx({ hasFocus: true }))).toBe("board");
  });

  it("hasPendingMove forces board even with a general-sounding marker", () => {
    expect(classifyIntent("how do i get better at endgames", ctx({ hasPendingMove: true }))).toBe("board");
    expect(classifyIntent("what should i work on before my next game", ctx({ hasPendingMove: true }))).toBe("board");
  });

  it("an explicit general marker still routes general during a live game (status in-progress)", () => {
    expect(classifyIntent("how do i get better at endgames", ctx({ status: "in-progress" }))).toBe("general");
    expect(classifyIntent("what should i work on before my next game", ctx({ status: "in-progress" }))).toBe(
      "general"
    );
  });

  it("a bare board question with no marker still routes board during a finished-game review chat", () => {
    // The coach-eval board-review arm's own case: bare [dir] questions
    // reused verbatim against a finished game must still take the board
    // route (review-budget + outcome-fact path), not the general-chess
    // prompt, despite status being "finished".
    expect(classifyIntent("what should i play next?", ctx({ status: "finished" }))).toBe("board");
    expect(classifyIntent("which piece should i move?", ctx({ status: "finished" }))).toBe("board");
  });
});

describe("isOffTopic", () => {
  it("is true for a message with no chess relevance at all", () => {
    expect(isOffTopic("what's a good pizza topping")).toBe(true);
    expect(isOffTopic("can you recommend a good movie")).toBe(true);
  });

  it("is false for a real chess question with no positional signal (never off-topic per the owner's bar)", () => {
    expect(isOffTopic("how do I get better at endgames")).toBe(false);
    expect(isOffTopic("what is a fork")).toBe(false);
  });

  it("is false for a board-shaped message", () => {
    expect(isOffTopic("why was my pawn on f3 to f4 the right move")).toBe(false);
  });
});

// Forward-prediction round (2026-07-28): deterministic ply promotion from
// the message text -- no model routing, same philosophy as classifyIntent.
describe("mentionedPlies", () => {
  it("maps move N to both its plies and the raw number read as a ply", () => {
    expect(new Set(mentionedPlies("what should i have done on move 27", 91))).toEqual(new Set([53, 54, 27]));
  });

  it("reads word numbers including the speech-to-text 'for' homophone", () => {
    expect(new Set(mentionedPlies("what move did i make on move for?", 91))).toEqual(new Set([7, 8, 4]));
  });

  it("reads explicit ply mentions directly", () => {
    expect(mentionedPlies("what about ply 55", 91)).toEqual([55]);
  });

  it("clamps to the game's real plies and returns empty for no mention", () => {
    expect(mentionedPlies("what should i have done on move 27", 20)).toEqual([]);
    expect(mentionedPlies("was my opening okay?", 91)).toEqual([]);
  });

  it("is bounded even against a message listing many numbers", () => {
    const msg = "moves 1 2 3 4 5 6 7 8 9 10 11 12".replace(/(\d+)/g, "move $1");
    expect(mentionedPlies(msg, 200).length).toBeLessThanOrEqual(12);
  });
});

// Wave 4, item 3 (2026-08-01, game-164): a conservative detector for an
// explicit request to remember something across games. The real game-164
// phrasings must fire; a negated recall ("I don't remember this opening")
// must NOT -- that is the whole reason the "remember this" branch carries a
// preceding-negation guard rather than a bare substring match.
describe("isRecordRequest (Wave 4 item 3)", () => {
  it("fires on the real game-164 phrasings", () => {
    expect(isRecordRequest("Please record this because I always forget it")).toBe(true);
    expect(isRecordRequest("Let's mark this for analysis next time")).toBe(true);
    expect(isRecordRequest("remember this for my next game")).toBe(true);
    expect(isRecordRequest("please remember this")).toBe(true);
  });

  it("does NOT fire on a negated recall or an unrelated question", () => {
    expect(isRecordRequest("I don't remember this opening")).toBe(false);
    expect(isRecordRequest("I do not remember this line at all")).toBe(false);
    expect(isRecordRequest("was my knight move okay?")).toBe(false);
    expect(isRecordRequest("what should i play here?")).toBe(false);
  });
});

// Round 2, item 8 (owner ruling, 2026-08-01 playtest): "she asked twice for
// a note in her playtest and got nothing" -- coach_notes stayed empty
// because her real phrasing, "let's make a note of this for analysis
// later", matched none of the original four. This extends the family to
// the note-taking phrasings the ruling names, keeping the same
// negation-guard philosophy the original four already established: a
// negated form or a retrospective QUESTION about whether a note already
// exists must not fire, since neither is a fresh request to write one.
describe("isRecordRequest (Round 2, item 8): the 'make a note' family", () => {
  it("fires on the owner's own verbatim phrasing from the playtest", () => {
    expect(isRecordRequest("let's make a note of this for analysis later")).toBe(true);
  });

  it("fires on each new phrasing in a natural sentence", () => {
    expect(isRecordRequest("make a note of that for me")).toBe(true);
    expect(isRecordRequest("can you take a note of this line?")).toBe(true);
    expect(isRecordRequest("note this, it's a recurring mistake")).toBe(true);
    expect(isRecordRequest("jot this down for later")).toBe(true);
    expect(isRecordRequest("jot that down please")).toBe(true);
    expect(isRecordRequest("write this down for my next game")).toBe(true);
    expect(isRecordRequest("write that down, it matters")).toBe(true);
    expect(isRecordRequest("add a note about this blunder")).toBe(true);
  });

  it("does NOT fire on a retrospective question asking whether a note already exists", () => {
    expect(isRecordRequest("did you make a note of that?")).toBe(false);
    expect(isRecordRequest("have you taken a note of this yet?")).toBe(false);
    expect(isRecordRequest("does the coach note this automatically?")).toBe(false);
  });

  it("does NOT fire on a negated form of the new phrasings", () => {
    expect(isRecordRequest("don't make a note of this, I take it back")).toBe(false);
    expect(isRecordRequest("please don't write this down")).toBe(false);
    expect(isRecordRequest("I didn't jot this down")).toBe(false);
    expect(isRecordRequest("never take a note of my openings")).toBe(false);
  });

  it("still does NOT fire on an unrelated question with no note-taking language", () => {
    expect(isRecordRequest("what should i play here?")).toBe(false);
    expect(isRecordRequest("was my knight move okay?")).toBe(false);
  });
});

// Task 9 (2026-09-01, coach_notes capture gap round): the controller
// re-verified two real, directly-evidenced silent misses against her actual
// chat_messages (sqlite3 "file:data/girlchess.db?mode=ro", read-only) that
// the family above still doesn't cover:
//   - game 172, msg 203: "Just making a note here that..." -- the
//     present-participle inflection of "make a note", not the bare verb.
//   - game 189, msg 247: "Something else that I want to note is..." -- a
//     distinct phrase, not a form of any of the ten existing alternatives.
// Both messages produced zero coach_notes rows even though they read as
// plain record requests to a human. Grepped ALL 150 of her real user
// chat_messages containing the substring "note" (the widened patterns below
// can only ever match a message containing "note", so that superset is
// exhaustive) and reviewed every one by hand: the two widenings below match
// exactly these two real asks and NOTHING else in her history -- her other
// "note" messages (game 146, ids 63/65/67/69) all use "note"/"notes" as a
// noun referring to an EXISTING debrief annotation ("the note that is the
// piece of advice", "the notes literally say", "for the notes for the rest
// of the game") and none contain "making a note" or "want to note" as a
// substring. Zero measured false positives.
describe("isRecordRequest (Task 9, coach_notes capture gap): verb-form and 'want to note' misses", () => {
  it("fires on the present-participle 'making a note' (real miss, game 172 msg 203)", () => {
    expect(
      isRecordRequest(
        "Just making a note here that we should see in green the recommended dotted move for Mallow"
      )
    ).toBe(true);
  });

  it("fires on 'want to note' (real miss, game 189 msg 247)", () => {
    expect(
      isRecordRequest(
        "Something else that I want to note is that I am often not highlighting the turning point"
      )
    ).toBe(true);
  });

  it("fires on the colloquial 'wanna note', same family as the existing 'wanna make a note'", () => {
    expect(isRecordRequest("wanna note this for later")).toBe(true);
  });

  it("does NOT fire on a negated or retrospective-question form of the new phrasings", () => {
    expect(isRecordRequest("don't want to note that, forget it")).toBe(false);
    expect(isRecordRequest("did you want to note that already?")).toBe(false);
    expect(isRecordRequest("I didn't want to note that, ignore it")).toBe(false);
  });

  it("still does NOT fire on her real non-record uses of 'note' from game 146", () => {
    expect(
      isRecordRequest(
        "Then why is this the note that is the piece of advice if I actually did this exact move?"
      )
    ).toBe(false);
    expect(
      isRecordRequest(
        "Okay, I think this is a bug that we need to correct because the notes literally say what may have happened if instead."
      )
    ).toBe(false);
    expect(
      isRecordRequest(
        "For the notes for the rest of the game, opponent inaccuracy on move 4 and move 13: bishop takes on h2, check."
      )
    ).toBe(false);
  });
});

// Router-fix round (2026-08-03): tier-2 abstract-theory markers
// (ABSTRACT_THEORY_RE), gated on !hasBoardSignal. Positives are the 5
// owner-verbatim general-theory questions that mis-routed to board under
// tier-1 alone (gt-01/02/06/08/09); negatives prove the gate holds in every
// direction the check-widening bug class attacks from.
describe("classifyIntent tier-2 abstract-theory markers (router-fix round, 2026-08-03)", () => {
  const GT_FORMERLY_MISROUTED: string[] = [
    "what's another opening that would work well from a setup like mine?",
    "besides just developing pieces, what should i actually be trying to do in the opening?",
    "what's the idea behind parking a knight on an outpost?",
    "what are the key principles for a king-and-pawn endgame?",
    "what does it mean to play for the initiative instead of just reacting?",
  ];
  for (const message of GT_FORMERLY_MISROUTED) {
    it(`routes owner-verbatim "${message}" to general`, () => {
      expect(classifyIntent(message, ctx())).toBe("general");
    });
  }

  it("a tier-2 phrase alongside a positive board signal stays board (the widening gate)", () => {
    expect(classifyIntent("what's the idea behind that move", ctx())).toBe("board"); // demonstrative
    expect(classifyIntent("what's the principle behind this position", ctx())).toBe("board"); // demonstrative
    expect(classifyIntent("what does it mean to play Nf3 here", ctx())).toBe("board"); // SAN + here
    expect(classifyIntent("by opening principles, was my opening okay", ctx())).toBe("board"); // my-phase
  });

  it("the live deictic/possessive 'idea behind this|it|my...' stays board (lookahead)", () => {
    expect(classifyIntent("what's the idea behind this", ctx())).toBe("board");
    expect(classifyIntent("what is the idea behind it", ctx())).toBe("board");
    // open-10, a real frozen board-live fixture that carries NO board
    // signal -- the planning-time sweep's one genuine collision. Also
    // asserted arm-derived in routing.test.ts; duplicated here so the unit
    // file alone falsifies the lookahead.
    expect(classifyIntent("what is the idea behind my opponent's setup?", ctx())).toBe("board");
  });

  it("hasFocus/hasPendingMove force board over any tier-2 marker, same as tier-1", () => {
    expect(classifyIntent("what does it mean to play for the initiative", ctx({ hasFocus: true }))).toBe("board");
    expect(
      classifyIntent("what are the key principles for a king-and-pawn endgame?", ctx({ hasPendingMove: true }))
    ).toBe("board");
  });

  it("a phase-less goal question stays board (ambiguity resolves to board, unchanged)", () => {
    expect(classifyIntent("what should i be trying to do", ctx())).toBe("board");
    expect(classifyIntent("what should i be trying to do here", ctx())).toBe("board");
  });

  it("the F1 repro set is untouched by tier 2 (no marker, no signal, still board)", () => {
    for (const m of ["is this ok", "should i take it", "yes", "ok", "what should i do here"]) {
      expect(classifyIntent(m, ctx())).toBe("board");
    }
  });
});

// Final-review fix (router-fix round, 2026-08-03; see
// .superpowers/sdd/rounds/2026-08-03-round3/brief-router-fix-review.md): the
// bare `\bprinciples?\b` alternative had no shape constraint at all, so any
// live board question carrying the bare word -- even one pairing it with a
// bare deictic ("this"/"it") or a concrete piece -- fell through the tier-2
// door, because DEMONSTRATIVE_RE (and the rest of hasBoardSignal) only
// catches the literal phrases "this move/this position/this game/that
// move/that line/here", never bare "this"/"that"/"it". These three are the
// finding's own concrete repro strings; each must go RED if the tightened
// frame requirement is reverted back to the bare word.
describe("classifyIntent tier-2 principles alternative -- overbroad-bare-word fix (router-fix round, 2026-08-03)", () => {
  it("a live board question carrying bare 'principle' but no abstract frame stays board", () => {
    expect(classifyIntent("what's the principle behind this?", ctx())).toBe("board");
    expect(classifyIntent("is this a good principle to follow?", ctx())).toBe("board");
    expect(classifyIntent("is my knight on a good principle?", ctx())).toBe("board");
  });

  it("gt-08 keeps its abstract frame ('key principles for') and stays general in both a live and a finished chat", () => {
    const q = "what are the key principles for a king-and-pawn endgame?";
    expect(classifyIntent(q, ctx())).toBe("general");
    expect(classifyIntent(q, ctx({ status: "finished" }))).toBe("general");
  });

  it("the brief's other named-general phrasings still route general", () => {
    expect(classifyIntent("what are the opening principles I should know?", ctx())).toBe("general");
    expect(classifyIntent("what are some good endgame principles?", ctx())).toBe("general");
    expect(classifyIntent("can you explain some general principles of chess?", ctx())).toBe("general");
    expect(classifyIntent("what are the principles of a good pawn structure?", ctx())).toBe("general");
    expect(classifyIntent("what are the principles for winning an endgame?", ctx())).toBe("general");
  });
});
