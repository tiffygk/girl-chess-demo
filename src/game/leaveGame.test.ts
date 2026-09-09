import { describe, it, expect } from "vitest";
import gamePageSrc from "./GamePage.tsx?raw";
import cssSrc from "../skin/sugar-glitch.css?raw";

describe("the mid-game back button (owner ask 2026-09-08)", () => {
  // RED when the button is removed, renamed, or moved to the right of the
  // end-game button: the pin requires back-btn to appear before
  // handleEndGameClick inside the live controls row.
  it("renders back, then end the game?, in the live controls row", () => {
    const row = gamePageSrc.match(/<div className="controls game-controls">([\s\S]*?)<\/div>\s*\)\s*\}/);
    expect(row).not.toBeNull();
    const html = row![1];
    const back = html.indexOf('className="small back-btn"');
    const end = html.indexOf("onClick={handleEndGameClick}");
    expect(back).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(-1);
    expect(back).toBeLessThan(end);
    expect(html).toMatch(/className="small back-btn"[\s\S]*?disabled=\{!gameId \|\| uiBusy\}[\s\S]*?onClick=\{handleLeaveGame\}[\s\S]*?>\s*back\s*</);
  });
  // RED when back starts ending games or forgetting them: the handler body
  // must not adjudicate and must not clear the stored active-game id; it
  // must go through the one reset path.
  it("back is the new-game reset and nothing more", () => {
    const m = gamePageSrc.match(/const handleLeaveGame = useCallback\(\(\) => \{([\s\S]*?)\}, \[/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/handleNewGame\(\)/);
    expect(body).not.toMatch(/adjudicate\(/);
    expect(body).not.toMatch(/writeActiveGame\(/);
    expect(body).toMatch(/busyRef\.current/);
  });
  // RED when the css block is missing or drifts from the approved recipe.
  it("back wears the candied-lemon pill at the end-game button's size", () => {
    expect(cssSrc).toMatch(/\.gc-app button\.small\.back-btn \{[^}]*background: #FFD84D;[^}]*color: #4A3B7E;[^}]*box-shadow: 0 3px 0 #C9BFEF, 0 6px 10px rgba\(90,70,180,\.2\);[^}]*font-size: 15px;/);
    expect(cssSrc).not.toMatch(/\.back-btn[^{]*\{[^}]*animation/);
  });
  // RED when the past-games pill is missing the sky recipe or is still white.
  it("past games wears the sky pill, not white", () => {
    expect(cssSrc).toMatch(/\.gc-app button\.small\.past-games-btn \{[^}]*background: #D7FAFF;[^}]*color: #1A7A93;[^}]*box-shadow: 0 3px 0 #23A8C7, 0 6px 10px rgba\(90,70,180,\.12\);/);
    expect(cssSrc).not.toMatch(/\.gc-app button\.small\.past-games-btn \{[^}]*background: #fff;/);
  });
});
