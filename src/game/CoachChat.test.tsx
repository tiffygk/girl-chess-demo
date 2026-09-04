// Task 3 (stranger-clones-and-plays round): a stranger with no Claude Code
// install used to get told "try again in a moment", forever. CoachChat is
// kept presentational (coachStatus is fetched once by GamePage and passed
// down), so a static render (react-dom/server, GameEndPanel.test.tsx's own
// precedent) is enough to prove the banner appears/doesn't without any DOM.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachChat } from "./CoachChat";
import type { ChatContext, CoachProbe } from "./api";

function buildContext(): ChatContext {
  return { mode: "live" };
}

// Fix round 1 (2026-09-06, controller rulings 9/10): the sentence changed
// -- not-installed now means the npm-installed helper binary is missing,
// not that the Claude Code desktop app needs installing.
const NOT_INSTALLED_DETAIL =
  "cookie (the coach) needs a helper program that did not install with npm ci. you can still play, get hints, and read every debrief. to turn cookie on: run npm ci again in Terminal, then restart with npm run dev.";

describe("CoachChat: the coach tells the truth about whether it can talk", () => {
  it("renders the setup note above the input when the coach is not ready", () => {
    const coachStatus: CoachProbe = { state: "not-installed", detail: NOT_INSTALLED_DETAIL, checkedAt: 1 };
    const html = renderToStaticMarkup(
      <CoachChat
        gameId={1}
        mode="live"
        buildContext={buildContext}
        hidden={false}
        backendPref="agent-sdk"
        coachStatus={coachStatus}
      />,
    );
    expect(html).toContain("chat-setup-note");
    expect(html).toContain(NOT_INSTALLED_DETAIL);
  });

  it("renders no setup note when the coach is ready", () => {
    const coachStatus: CoachProbe = { state: "ready", detail: "cookie is ready to chat.", checkedAt: 1 };
    const html = renderToStaticMarkup(
      <CoachChat
        gameId={1}
        mode="live"
        buildContext={buildContext}
        hidden={false}
        backendPref="agent-sdk"
        coachStatus={coachStatus}
      />,
    );
    expect(html).not.toContain("chat-setup-note");
  });
});
