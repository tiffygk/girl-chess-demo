// Task 8 (replay-arrow lingering bug, coach_notes id 4, owner report
// verbatim): "replaying one debrief card, then replaying the takedown,
// leaves the previous replay's best-move arrows on screen ... These should
// disappear if I do replay the take down because I just want to watch the
// sequence." Root-caused by the controller (see
// .superpowers/sdd/rounds/2026-09-01-replay-arrows/finding.md): the board
// renders `reviewArrows`/`reviewHighlights` while not exploring
// (GamePage.tsx:2462). handleRewind (the card-replay path) replaces that
// state on every call, so card-to-card replay is correct. handleReplayTakedown
// (the end-panel "replay the takedown" path) never touches that state at
// all, so whatever the last card replay set stays drawn over the whole
// cinematic.
//
// GamePage has no render-mount harness (it owns fetch effects, timers, and
// a huge prop/state surface) -- same source-pin precedent as
// postJudgeCheckmark.test.ts/postgame.test.ts/endCopy.test.ts: assert on the
// literal handleReplayTakedown function body via a vite `?raw` import,
// extracted with brace-counting the same way postJudgeCheckmark.test.ts's
// extractDivBlock extracts a JSX block.
import { describe, it, expect } from "vitest";
import gamePageSrc from "./GamePage.tsx?raw";

const HANDLER_MARKER = "const handleReplayTakedown = useCallback(async () => {";

// Brace-counted extraction (mirrors extractDivBlock's tag-to-close-tag
// style in postJudgeCheckmark.test.ts, but for a JS block instead of a JSX
// div): starts at the marker's own opening "{" and walks forward until its
// matching closer, so the slice is exactly the function body regardless of
// nested if/try/finally blocks inside it.
function extractCallbackBody(src: string, marker: string): string {
  const markerStart = src.indexOf(marker);
  if (markerStart === -1) {
    throw new Error(`marker not found in GamePage.tsx: ${marker}`);
  }
  const braceStart = src.indexOf("{", markerStart);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error("unbalanced braces while extracting handleReplayTakedown");
  }
  return src.slice(markerStart, i + 1);
}

describe("handleReplayTakedown clears the prior replay's arrows before the cinematic plays (task 8)", () => {
  const body = extractCallbackBody(gamePageSrc, HANDLER_MARKER);

  it("sanity: the extracted block is actually handleReplayTakedown's body (contains its own known call)", () => {
    // Guards the extraction itself -- if this fails, the marker/brace
    // walk grabbed the wrong span and the real assertions below would be
    // meaningless.
    expect(body).toMatch(/replayCinematic\(/);
  });

  it("THE FIX: reviewArrows and reviewHighlights are cleared BEFORE replayCinematic is awaited -- not only in the finally block", () => {
    const awaitIdx = body.indexOf("replayCinematic(");
    expect(awaitIdx).toBeGreaterThan(-1);
    // Everything the handler does before it kicks off the cinematic. Today
    // (pre-fix) this prefix never mentions reviewArrows/reviewHighlights at
    // all -- the previous card replay's arrows are simply never cleared,
    // so they stay drawn for the whole cinematic. This is the exact bug she
    // reported.
    const beforeCinematic = body.slice(0, awaitIdx);
    expect(beforeCinematic).toMatch(/setReviewArrows\(\s*\[\]\s*\)/);
    expect(beforeCinematic).toMatch(/setReviewHighlights\(\s*\[\]\s*\)/);
  });

  it("regression pin: the clear does not live ONLY in the finally block (that would clear the arrows only after the cinematic ends, not before it starts)", () => {
    // Matches the actual `} finally {` block keyword, not any prose
    // mention of the word "finally" in a comment above it.
    const finallyIdx = body.indexOf("} finally {");
    expect(finallyIdx).toBeGreaterThan(-1);
    const beforeFinally = body.slice(0, finallyIdx);
    expect(beforeFinally).toMatch(/setReviewArrows\(\s*\[\]\s*\)/);
    expect(beforeFinally).toMatch(/setReviewHighlights\(\s*\[\]\s*\)/);
  });
});
