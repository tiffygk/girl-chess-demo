import { describe, it, expect } from "vitest";
// Source pin, following endCopy.test.ts / postgame.test.ts's own precedent:
// GamePage.tsx has no render-mount harness (it owns fetch effects, timers,
// and a huge prop/state surface that would need a heavy mock rig to mount),
// so these assert on the literal JSX text via a vite `?raw` import rather
// than mounting the component.
import gamePageSrc from "./GamePage.tsx?raw";

// game-169 minors investigation: two judge-indicator render paths exist.
// Guardian mode (pending + judgePhase==="judged") renders the "judged ✓"
// checkmark UNCONDITIONALLY across tiers, plus a tier badge. The separate
// coach-only/confirm-off path (!pending && postVerdict, aka "post-judge")
// only rendered the ✓ for tier "silent" -- nudge and warning got a badge
// but no checkmark, an asymmetry with guardian mode. Fix: render the
// checkmark unconditionally in the post-judge block too, mirroring
// guardian mode, keeping the existing per-tier badges as-is.

function extractDivBlock(src: string, openTag: string): string {
  const start = src.indexOf(openTag);
  if (start === -1) {
    throw new Error(`open tag not found in GamePage.tsx: ${openTag}`);
  }
  const close = src.indexOf("</div>", start);
  if (close === -1) {
    throw new Error(`no closing </div> found after: ${openTag}`);
  }
  return src.slice(start, close);
}

const GUARDIAN_OPEN_TAG = '<div className="judge-indicator" role="status" aria-live="polite">';
const POST_JUDGE_OPEN_TAG =
  '<div className="judge-indicator post-judge" role="status" aria-live="polite">';

describe("judge-indicator checkmark parity: guardian mode vs coach-only/confirm-off (game-169 minors asymmetry)", () => {
  const guardianBlock = extractDivBlock(gamePageSrc, GUARDIAN_OPEN_TAG);
  const postJudgeBlock = extractDivBlock(gamePageSrc, POST_JUDGE_OPEN_TAG);

  it("THE FIX: coach-only/confirm-off (post-judge) renders the judged checkmark for nudge and warning tiers too, not just silent", () => {
    // Pre-fix this block reads:
    //   {postVerdict.tier === "silent" && <span className="judge-check">✓</span>}
    // which withholds the checkmark from nudge/warning verdicts. Fixed, the
    // checkmark is unconditional (mirroring guardian mode) so it renders
    // for every tier, and the per-tier badges still render alongside it.
    expect(postJudgeBlock).not.toMatch(/tier === "silent" &&\s*<span className="judge-check">/);
    expect(postJudgeBlock).toMatch(/<span className="judge-check">✓<\/span>/);
    expect(postJudgeBlock).toMatch(/judge-badge-nudge/);
    expect(postJudgeBlock).toMatch(/judge-badge-warning/);
  });

  it("regression pin: guardian mode's unconditional checkmark is untouched", () => {
    expect(guardianBlock).toMatch(/judged <span className="judge-check">✓<\/span>/);
    expect(guardianBlock).not.toMatch(/tier === "silent" &&\s*<span className="judge-check">/);
    expect(guardianBlock).toMatch(/judge-badge-nudge/);
    expect(guardianBlock).toMatch(/judge-badge-warning/);
  });

  it("regression pin: the silent tier in coach-only/confirm-off mode still gets a checkmark and no badge (no judge-badge-silent exists)", () => {
    expect(postJudgeBlock).not.toMatch(/judge-badge-silent/);
    const badgeCount = (postJudgeBlock.match(/judge-badge-/g) ?? []).length;
    expect(badgeCount).toBe(2); // nudge + warning badges only
  });
});
