import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelog = () => fs.readFileSync(path.join(ROOT, "docs", "changelog.md"), "utf8");

describe("the rules' incident narratives live in the changelog", () => {
  it("has the moved section with one subsection per standing rule", () => {
    const c = changelog();
    expect(c).toContain("## Incidents that made the rules (moved from CLAUDE.md 2026-09-06)");
    for (const rule of [
      "Play rule (2026-07-29)", "Gate rule (2026-07-28)", "Integrity rule", "Data rule", "Directory rule (2026-07-29)",
      "Invariant rule (2026-07-31", "Push-freshness rule (2026-08-26)", "Worktree rule (2026-07-30)",
      "Playtest freshness rule (2026-08-01)", "Total-time-accounting rule (2026-08-02)", "Durability rule (2026-08-01)",
      "Attribution rule (2026-09-01",
    ]) {
      expect(c, rule).toContain(`### ${rule}`);
    }
  });
});
