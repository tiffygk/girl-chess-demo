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
