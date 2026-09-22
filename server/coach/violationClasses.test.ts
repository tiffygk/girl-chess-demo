import { describe, it, expect } from "vitest";
import { VIOLATION_KIND_GUIDANCE } from "./chat";

// Game 198 fixes (2026-09-21), Task C2b: the validator's classes. The
// coach-eval skill (rule 11) cites this literal; change both together.
export const VIOLATION_CLASSES = [
  "placement-claim", "side-claim", "defense-claim", "mate-claim",
  "relation-claim", "voice-notation", "voice-word", "voice-number",
] as const;

describe("validator classes", () => {
  it("the guidance map names exactly the documented classes", () => {
    // "" is the bad-SAN catch-all's key in VIOLATION_KIND_GUIDANCE, but
    // correctiveSuffix never looks it up there -- bad-SAN violations carry
    // no ":" and are filtered out before the guidance-map loop even runs
    // (chat.ts: "if (!v.includes(\":\")) continue;"), so that entry is
    // vestigial and not one of the checker-produced violation classes this
    // test (and coach-eval rule 11) enumerate.
    const semanticKinds = Object.keys(VIOLATION_KIND_GUIDANCE).filter((k) => k !== "");
    expect(semanticKinds.sort()).toEqual([...VIOLATION_CLASSES].sort());
  });
});
