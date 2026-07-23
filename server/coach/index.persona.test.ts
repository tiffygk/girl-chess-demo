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

  it("R5: instructs the coach to state missing engine data plainly, not hedge", () => {
    const persona = parseRealCoachMd();
    expect(persona.chatSystemPrompt).toContain("i don't have the engine's line for that moment");
    expect(persona.chatSystemPrompt).toContain("never a hedge about chess itself");
  });
});
