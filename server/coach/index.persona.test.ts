import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parsePersona } from "./index";

// F14 voice fix (round 2026-07-21-coach-voice): parsePersona must prepend
// the shared `## voice` block into BOTH systemPrompt and chatSystemPrompt
// (Option 2 from the brief) so the voice actually reaches the model --
// previously `voice` was parsed but never sent anywhere.

describe("parsePersona voice prepend", () => {
  const md = `## voice

VOICE_MARKER

## system prompt

NARR_BODY

## chat

### system prompt

CHAT_BODY
`;

  it("prepends the voice block into systemPrompt", () => {
    const persona = parsePersona(md);
    expect(persona.systemPrompt).toBe("VOICE_MARKER\n\nNARR_BODY");
  });

  it("prepends the voice block into chatSystemPrompt", () => {
    const persona = parsePersona(md);
    expect(persona.chatSystemPrompt).toBe("VOICE_MARKER\n\nCHAT_BODY");
  });

  it("still exposes the raw voice text on .voice", () => {
    const persona = parsePersona(md);
    expect(persona.voice).toBe("VOICE_MARKER");
  });

  it("leaves both prompts unchanged with no leading blank lines when voice is absent", () => {
    const noVoiceMd = `## system prompt

NARR_BODY

## chat

### system prompt

CHAT_BODY
`;
    const persona = parsePersona(noVoiceMd);
    expect(persona.systemPrompt).toBe("NARR_BODY");
    expect(persona.chatSystemPrompt).toBe("CHAT_BODY");
    expect(persona.voice).toBe("");
  });

  it("leaves both prompts unchanged with no leading blank lines when voice is empty", () => {
    const emptyVoiceMd = `## voice



## system prompt

NARR_BODY

## chat

### system prompt

CHAT_BODY
`;
    const persona = parsePersona(emptyVoiceMd);
    expect(persona.systemPrompt).toBe("NARR_BODY");
    expect(persona.chatSystemPrompt).toBe("CHAT_BODY");
    expect(persona.voice).toBe("");
  });
});

// Wave 4, item 1 (2026-08-01, game-164 follow-up): the two answer shapes the
// owner rated +1 land as a parsed "### answer shapes" subsection of "## chat",
// a sibling of "### system prompt"/"### templates"/"### general questions".
// parsePersona exposes it as its own trimmed field (chatAnswerShapes), kept
// separate from chatSystemPrompt the same way chatGeneralPrompt is, so it can
// be appended to the built prompt for BOTH intents without duplicating the
// voice block or polluting the system-prompt field.
describe("parsePersona answer shapes (Wave 4 item 1)", () => {
  const md = `## voice

VOICE_MARKER

## chat

### system prompt

CHAT_BODY

### answer shapes

SHAPE_MARKER

### general questions

GENERAL_BODY
`;

  it("extracts the answer-shapes section as its own trimmed field", () => {
    const persona = parsePersona(md);
    expect(persona.chatAnswerShapes).toBe("SHAPE_MARKER");
  });

  it("keeps answer shapes OUT of chatSystemPrompt and chatGeneralPrompt (separate fields, like chatGeneralPrompt)", () => {
    const persona = parsePersona(md);
    expect(persona.chatSystemPrompt).not.toContain("SHAPE_MARKER");
    expect(persona.chatGeneralPrompt).not.toContain("SHAPE_MARKER");
    // and the section is not run through withVoice -- the voice block reaches
    // the built prompt once, ahead of chatSystemPrompt, never re-prepended here
    expect(persona.chatAnswerShapes).not.toContain("VOICE_MARKER");
  });

  it("is an empty string (no stray header) when the section is absent", () => {
    const noShapesMd = `## chat

### system prompt

CHAT_BODY
`;
    const persona = parsePersona(noShapesMd);
    expect(persona.chatAnswerShapes).toBe("");
  });
});

describe("real coach.md (Task 2)", () => {
  // Parsed fresh from disk each time (NOT getPersona's cache) so this test
  // reflects the file's on-disk content, whatever wave last touched it.
  function parseRealCoachMd() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    return parsePersona(md);
  }

  it("systemPrompt carries the owner-approved voice", () => {
    const persona = parseRealCoachMd();
    expect(persona.systemPrompt).toContain("you are cookie");
    expect(persona.systemPrompt).toContain("grandmaster who loves teaching a beginner");
    expect(persona.systemPrompt).toContain("name moves in plain language");
  });

  it("chatSystemPrompt carries the owner-approved voice", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("you are cookie");
    expect(persona.chatSystemPrompt).toContain("grandmaster who loves teaching a beginner");
    expect(persona.chatSystemPrompt).toContain("name moves in plain language");
  });

  it("voice block carries the banned-word list (proven via 'delve')", () => {
    const persona = parseRealCoachMd();
    expect(persona.voice).toContain("delve");
  });

  // Wave 4, item 1: the two owner-praised shapes are present on the real file's
  // parsed answer-shapes field. Marker phrases chosen to be load-bearing to
  // each shape's ORDER rule, so a rewrite that drops the ordering discipline
  // fails here, not just a reworded copy.
  it("carries both owner-praised answer shapes on chatAnswerShapes", () => {
    const persona = parseRealCoachMd();
    // shape 1: threat -> why it fails -> payoff, fear killed before the fix
    expect(persona.chatAnswerShapes).toContain("name the exact threat she fears");
    expect(persona.chatAnswerShapes).toContain(
      "never argue for your move before you've killed the line she's scared of"
    );
    // shape 2: rule in one line, grounded in her own game, one carryable version
    expect(persona.chatAnswerShapes).toContain("ground it in the one real moment from this game");
    expect(persona.chatAnswerShapes).toContain("small enough to carry into the next game");
  });

  // Wave 4 review residual (Important, 2026-08-01): nothing stops the model's
  // own free-text reply from promising to remember/record something -- the
  // record request rides in the prompt and the opener primes memory claims, so
  // the player could see the model promise persistence (a redundant double-ack
  // on success, or a lone FALSE promise if the insert throws -- the exact
  // game-164 shape). The persona's chat system prompt now forbids the model
  // from making that claim itself; the deterministic ack is the only place a
  // "saved" statement is ever allowed to come from.
  it("chat system prompt forbids the model from claiming it will remember/record something itself", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain(
      "never claim you'll remember, record, or note something yourself"
    );
  });

  it("answer shapes obey the voice block: no notation, no engine word, no signed number", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatAnswerShapes).not.toMatch(/\bengine\b/i);
    expect(persona.chatAnswerShapes).not.toMatch(/\beval(s|uation)?\b/i);
    // no em-dashes, no raw SAN-shaped move name spelled out as notation
    expect(persona.chatAnswerShapes).not.toContain("—");
  });
});

// Chat fact-gap round (2026-07-22), Task 5 (R2 + R5): the old hintFocus
// instruction told the coach to "ground your answer in that hint's own
// level and text", which read as license to restate the hint verbatim --
// the owner's #1 chat complaint. This retunes coach.md so the coach (R2)
// never repeats the hint back, answers the player's specific question one
// ladder level deeper using the hint's own analysis facts, and uses the
// game's per-ply analysis to answer questions about earlier moments; and
// (R5) treats missing engine data as a data-coverage statement, never a
// hedge about chess itself (chess is computed, not guessed).
describe("chat system prompt retune (Task 5, R2 + R5)", () => {
  function parseRealCoachMd() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    return parsePersona(md);
  }

  it("R2: instructs the coach not to repeat the hint back to her", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("do not repeat the hint back to her");
  });

  it("R2: instructs the coach to go one level deeper than the shown ladder level", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("go one level deeper than the ladder level she already saw");
  });

  it("R2: instructs the coach to use per-ply analysis for questions about earlier moments", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("use the per-ply analysis to answer");
    expect(persona.chatSystemPrompt).toContain("'opening' means the early plies");
  });

  it("R5: instructs the coach to state missing analysis data plainly, not hedge", () => {
    const persona = parseRealCoachMd();
    // R2 Task 2 voice rewrite: the canonical no-data line no longer says
    // "engine" -- the tool's in-cast name is "our chess brain".
    expect(persona.chatSystemPrompt).toContain("our chess brain hasn't worked that moment out yet");
    expect(persona.chatSystemPrompt).toContain("never a hedge about chess itself");
  });
});

// Task 3 (coach-truth round) review fix: the focused-moment persona rule
// used to tell the coach to "name pieces from the focused position, never
// from the current one" with no sanctioned source for a piece that never
// moved. Deleting these lines made nothing go red -- this pins the
// corrected rule so removing it fails here, the same idiom as the other
// real-coach.md pins in this file.
describe("chat system prompt: focused-moment ground rule (Task 3 review fix)", () => {
  function parseRealCoachMd() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    return parsePersona(md);
  }

  it("instructs the coach to derive the then-position from both named change lists plus current occupancy, entry-wise never from standHereNowButNotThen", () => {
    const persona = parseRealCoachMd();
    // Both lists are named before "those two lists" refers back to them --
    // the prior wording named only one field, leaving "those two lists"
    // with no antecedent.
    expect(persona.chatSystemPrompt).toContain("stoodHereThenButNotNow is where a piece");
    expect(persona.chatSystemPrompt).toContain("standHereNowButNotThen is where a piece");
    expect(persona.chatSystemPrompt).toContain(
      "work out where a piece stood then from those two lists plus"
    );
    // Entry-wise, not square-wise: a capture/recapture square can appear in
    // BOTH lists, so the rule forbids taking an ENTRY from
    // standHereNowButNotThen as where that piece stood, not naming the
    // square at all -- see chat.ts's matching fix and its own comment.
    expect(persona.chatSystemPrompt).toContain(
      "never take an entry from\nstandHereNowButNotThen as where THAT piece stood at that moment"
    );
  });
});

// R2 Task 2 (2026-07-22, coach voice rewrite): the owner read real coach
// answers and ruled on voice -- no "engine"/"eval"/centipawn numbers (the
// tool's in-cast name is "our chess brain"), no raw notation as a move name,
// one to three sentences, "that's fine." as the canonical short affirmation,
// consequences explained concretely. These tests pin the persona file to
// those rulings; the mechanical output guard is Task 3, not here.
describe("persona voice rewrite (R2 Task 2)", () => {
  function parseRealCoachMd() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    return parsePersona(md);
  }

  it("names the tool 'our chess brain' in the chat prompt", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("our chess brain");
  });

  it("carries the canonical short affirmation \"that's fine.\"", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain('"that\'s fine."');
  });

  it("bans raw notation as a move name", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("never name a move as raw notation");
  });

  // Was "sets the one-to-three-sentence length rule" (R2 Task 2). Superseded
  // 2026-07-28: the owner graded 30 blinded rows and the answers she preferred
  // ran consistently longer than any hard count the persona or the harness
  // imposed (median 95 words preferred vs 71 rejected). Concision is now asked
  // for as intent -- the fewest words that still answer -- with a soft
  // 100-word landing zone and an explicit "never to pad", rather than a
  // sentence ceiling the model must satisfy. Kept as the guard pointing the
  // other way: if a hard count creeps back into the shared voice block or the
  // chat prompt, this fails.
  it("asks for concision as intent, not as a hard sentence or word count", () => {
    const persona = parseRealCoachMd();
    expect(persona.voice).toContain("fewest words");
    expect(persona.voice).toContain("never to pad");
    expect(persona.voice).not.toContain("one to three short sentences");
    expect(persona.chatSystemPrompt).toContain("fewest words");
    expect(persona.chatSystemPrompt).not.toContain("one to three short sentences");
  });

  it("directs the coach to explain the consequence concretely", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("explain the consequence");
  });

  it("carries the owner calibration pair (sharper/reply bad, consequence good)", () => {
    const persona = parseRealCoachMd();
    expect(persona.voice).toContain("e5 was the sharper reply");
    // Task 5 (game192 fixes, RC5): the candidate move narrate speaks about
    // has not been played -- picked up and set down, not confirmed -- so the
    // voice example must not put it in past tense either.
    expect(persona.voice).toContain("pushing your pawn to e5 is stronger");
  });

  it("chat prompt never contains 'engine' or 'eval' as standalone words", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).not.toMatch(/\bengine\b/i);
    expect(persona.chatSystemPrompt).not.toMatch(/\beval(s|uation)?\b/i);
  });

  it("narrate prompt never contains 'engine' or 'eval' as standalone words", () => {
    const persona = parseRealCoachMd();
    expect(persona.systemPrompt).not.toMatch(/\bengine\b/i);
    expect(persona.systemPrompt).not.toMatch(/\beval(s|uation)?\b/i);
  });

  // Task 5 (game192 fixes, RC5): narrate is only ever called from the
  // pending-move verdict flow -- the candidate it narrates about was picked
  // up and set down, never actually played. The old prompt said "reacting
  // to the move they just made," which reads as past tense and produced a
  // real trace (game 192, trace 297) grading the unplayed candidate as
  // already-played ("pushing your own pawn to h4 was stronger"). Pin that
  // the system prompt now names it as a considered, unconfirmed move.
  it("narrate system prompt speaks of a considered move, not a played one", () => {
    const persona = parseRealCoachMd();
    expect(persona.systemPrompt).toContain("a move they are considering");
    expect(persona.systemPrompt).not.toContain("reacting to the move they just made");
  });

  it("fallback templates use no raw-SAN variables and no 'engine'", () => {
    const persona = parseRealCoachMd();
    const all = [
      ...Object.values(persona.threatTemplates),
      ...Object.values(persona.recommendationTemplates),
      ...Object.values(persona.chatTemplates),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) {
      expect(t).not.toMatch(/\{refutationSan\}|\{bestSan\}/);
      expect(t).not.toMatch(/\bengine\b/i);
      expect(t).not.toMatch(/\beval(s|uation)?\b/i);
    }
  });

  it("re-voiced pendingMove paragraph keeps its meaning", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("pendingMove");
    expect(persona.chatSystemPrompt).toContain("'what if i go here'");
    expect(persona.chatSystemPrompt).toContain("'silent'");
    expect(persona.chatSystemPrompt).toContain("judged is false");
  });
});

// Task 4 (RC2 + the RC-timeline fabrication, game-192 fixes round, 2026-08-28):
// real game 192 -- asked why Kh1 was best, the coach fabricated a
// square-color tactical story, then invented a timeline for a changed hint
// and denied the player's correct observation three times. This pins the
// three load-bearing sentences of the honesty-rules paragraph added
// immediately after the pendingMove paragraph: never invent chess reasoning
// beyond the fact list (esp. square colors/diagonals), and never claim a
// changed suggestion belonged to an earlier move unless recentHints itself
// shows that.
describe("chat system prompt: why-question and changed-hint honesty rules (Task 4)", () => {
  function parseRealCoachMd() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    return parsePersona(md);
  }

  it("states our chess brain reports moves and scores, never reasons", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain(
      "our chess brain reports moves and scores, never reasons"
    );
  });

  it("bans reasoning about square colors or diagonals", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain(
      "never reason\nabout square colors or diagonals"
    );
  });

  it("forbids claiming a suggestion belonged to an earlier move unless recentHints shows that", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain(
      "never tell her a\nsuggestion belonged to an earlier move unless recentHints itself shows that"
    );
  });
});
