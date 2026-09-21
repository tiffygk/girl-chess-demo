import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runChecks, realChecks, uciIdName, EXPECTED_STOCKFISH_ID, type Check, type CheckResult } from "./doctor";

// A tiny executable script standing in for stockfish's uci/quit exchange,
// so uciIdName and the stockfish check can be tested without touching brew
// or the real binary.
function stubEngine(idLine: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-doctor-"));
  const p = path.join(dir, "stockfish");
  const body = idLine === null ? "" : `echo "id name ${idLine}"\n`;
  fs.writeFileSync(p, `#!/bin/bash\n${body}echo uciok\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

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

  it("uciIdName parses the id name line out of a uci/quit exchange", () => {
    const bin = stubEngine(EXPECTED_STOCKFISH_ID);
    expect(uciIdName(bin)).toBe(EXPECTED_STOCKFISH_ID);
  });

  it("uciIdName returns the installed name even when it is not the baseline", () => {
    const bin = stubEngine("Stockfish 18");
    expect(uciIdName(bin)).toBe("Stockfish 18");
  });

  it("uciIdName returns null when the exchange never sends an id name line", () => {
    const bin = stubEngine(null);
    expect(uciIdName(bin)).toBeNull();
  });

  describe("the stockfish check, run against a stub binary on PATH", () => {
    let oldPath: string | undefined;
    let dir: string;

    function withStub(idLine: string) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-doctor-path-"));
      fs.writeFileSync(path.join(dir, "stockfish"), `#!/bin/bash\necho "id name ${idLine}"\necho uciok\n`);
      fs.chmodSync(path.join(dir, "stockfish"), 0o755);
      oldPath = process.env.PATH;
      process.env.PATH = `${dir}:${oldPath}`;
    }
    function restorePath() {
      process.env.PATH = oldPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }

    it("passes and names the baseline version when it matches", async () => {
      withStub(EXPECTED_STOCKFISH_ID);
      try {
        const check = realChecks.find((c) => c.name === "stockfish")!;
        const result = await check.run();
        expect(result).toEqual({ ok: true, line: `stockfish answers (${EXPECTED_STOCKFISH_ID}, the version the eval fixtures are baselined on)` });
      } finally {
        restorePath();
      }
    });

    it("fails and names the installed version when it does not match the baseline", async () => {
      withStub("Stockfish 18");
      try {
        const check = realChecks.find((c) => c.name === "stockfish")!;
        const result = await check.run();
        expect(result).toEqual({
          ok: false,
          line: `Stockfish 18 installed; this repo's eval fixtures are baselined on ${EXPECTED_STOCKFISH_ID}. the game works; eval tests may differ. see .claude/rules/data-and-gate.md`,
        });
      } finally {
        restorePath();
      }
    });
  });
});
