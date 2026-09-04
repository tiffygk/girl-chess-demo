import { describe, it, expect } from "vitest";
import { runChecks, type Check, type CheckResult } from "./doctor";

// runChecks takes injected probes so the tests never touch brew, ports, or
// the keychain. Each probe returns ok:true or a plain sentence.
function fakeChecks(overrides: Partial<Record<Check["name"], CheckResult>> = {}): Check[] {
  const okAll: Record<Check["name"], CheckResult> = {
    node: { ok: true, line: "Node v22.11.0" },
    homebrew: { ok: true, line: "Homebrew installed" },
    stockfish: { ok: true, line: "stockfish answers" },
    lc0: { ok: true, line: "lc0 answers" },
    weights: { ok: true, line: "9 of 9 opponent files present and valid" },
    ports: { ok: true, line: "ports 3001 and 5173 are free" },
    coach: { ok: true, line: "coach: Claude Code is installed and signed in" },
    data: { ok: true, line: "data folder is writable" },
  };
  const merged = { ...okAll, ...overrides };
  return (Object.keys(merged) as Check["name"][]).map((name) => ({ name, run: async () => merged[name] }));
}

describe("doctor", () => {
  it("prints one ok line per check and the ready sentence when all pass", async () => {
    const out: string[] = [];
    const code = await runChecks(fakeChecks(), (l) => out.push(l));
    expect(code).toBe(0);
    expect(out.filter((l) => l.startsWith("ok   ")).length).toBe(8);
    expect(out.at(-1)).toBe("doctor: everything is ready. run npm run dev");
  });

  it("prints the fix sentence for each failure and counts them", async () => {
    const out: string[] = [];
    const code = await runChecks(
      fakeChecks({
        node: { ok: false, line: "Node is not installed. install Node 22 from https://nodejs.org (or: brew install node@22), then reopen Terminal." },
        ports: { ok: false, line: "port 3001 is already in use by another program. run PORT=3002 npm run dev, or quit that program." },
      }),
      (l) => out.push(l)
    );
    expect(code).toBe(1);
    expect(out).toContain("fix  Node is not installed. install Node 22 from https://nodejs.org (or: brew install node@22), then reopen Terminal.");
    expect(out.at(-1)).toBe("doctor: 2 things to fix above");
  });

  it("a coach that is not signed in is a note, not a failure", async () => {
    const out: string[] = [];
    const code = await runChecks(
      fakeChecks({ coach: { ok: true, note: true, line: "coach: Claude Code is not signed in, so cookie will not chat. to enable: install Claude Code and run claude, then sign in." } }),
      (l) => out.push(l)
    );
    expect(code).toBe(0);
    expect(out.some((l) => l.startsWith("note"))).toBe(true);
  });
});
