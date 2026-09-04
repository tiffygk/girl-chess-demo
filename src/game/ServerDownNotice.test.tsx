import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerDownNotice } from "./ServerDownNotice";

describe("ServerDownNotice", () => {
  it("says what happened and what to do, with a retry button", () => {
    const html = renderToStaticMarkup(<ServerDownNotice onRetry={() => {}} />);
    expect(html).toContain("the game server is not running.");
    expect(html).toContain("in Terminal, inside the girl-chess-demo folder, run npm run dev, then click try again.");
    expect(html).toContain(">try again<");
    expect(html).not.toContain("\u2014");
  });
});
