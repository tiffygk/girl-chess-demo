import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  runChecks,
  realChecks,
  uciIdName,
  EXPECTED_STOCKFISH_ID,
  parseNvmrcMajor,
  nodeCheckResult,
  makeStockfishCheck,
  type Check,
  type CheckResult,
} from "./doctor";

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

  describe("the stockfish check (Task 9, 2026-09-21 engine-pin round: a mismatch is a note, exit 0, not a failure)", () => {
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

    function pinnedBinAt(dirName: string, idLine: string): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), dirName));
      const p = path.join(d, "stockfish");
      fs.writeFileSync(p, `#!/bin/bash\necho "id name ${idLine}"\necho uciok\n`);
      fs.chmodSync(p, 0o755);
      return p;
    }

    it("passes and names the baseline version when it matches, on PATH (no pinned binary)", async () => {
      withStub(EXPECTED_STOCKFISH_ID);
      try {
        const check = makeStockfishCheck(() => "stockfish");
        const result = await check.run();
        expect(result).toEqual({ ok: true, line: `stockfish answers (${EXPECTED_STOCKFISH_ID}, found on PATH)` });
      } finally {
        restorePath();
      }
    });

    it("passes and names the baseline version when it matches, pinned", async () => {
      const sf = pinnedBinAt("gc-doctor-pinned-", EXPECTED_STOCKFISH_ID);
      const check = makeStockfishCheck(() => sf);
      const result = await check.run();
      expect(result).toEqual({ ok: true, line: `stockfish answers (${EXPECTED_STOCKFISH_ID}, the pinned engine in engines/)` });
      fs.rmSync(path.dirname(sf), { recursive: true, force: true });
    });

    // Was "fails and names the installed version when it does not match the
    // baseline" before the owner's 2026-09-21 ruling; now a note, exit 0,
    // not a failure. Red when the note is turned back into a failure.
    it("is a note, not a failure, when the installed version does not match the baseline, on PATH", async () => {
      withStub("Stockfish 18");
      try {
        const check = makeStockfishCheck(() => "stockfish");
        const result = await check.run();
        expect(result).toEqual({
          ok: true,
          note: true,
          line: `Stockfish 18 found at stockfish; this repo is tested on ${EXPECTED_STOCKFISH_ID}. the game works; eval tests may differ. run ./setup.sh to install the pinned engine.`,
        });
      } finally {
        restorePath();
      }
    });

    it("is a note, not a failure, when the pinned binary does not match the baseline", async () => {
      const sf = pinnedBinAt("gc-doctor-pinned-mismatch-", "Stockfish 18");
      const check = makeStockfishCheck(() => sf);
      const result = await check.run();
      expect(result).toEqual({
        ok: true,
        note: true,
        line: `Stockfish 18 found at ${sf}; this repo is tested on ${EXPECTED_STOCKFISH_ID}. the game works; eval tests may differ. run ./setup.sh to install the pinned engine.`,
      });
      fs.rmSync(path.dirname(sf), { recursive: true, force: true });
    });

    // Red when the preference is removed (the PATH stub's "Stockfish 20"
    // would then win, giving a note instead of a clean pass).
    it("the pinned binary wins over a PATH stub", async () => {
      withStub("Stockfish 20");
      try {
        const sf = pinnedBinAt("gc-doctor-pinned-wins-", EXPECTED_STOCKFISH_ID);
        const check = makeStockfishCheck(() => sf);
        const result = await check.run();
        expect(result.ok).toBe(true);
        expect(result.note).toBeUndefined();
        expect(result.line).toContain("the pinned engine in engines/");
        fs.rmSync(path.dirname(sf), { recursive: true, force: true });
      } finally {
        restorePath();
      }
    });

    it("realChecks wires the production resolver (no override), still a Check named stockfish", () => {
      const check = realChecks.find((c) => c.name === "stockfish")!;
      expect(check).toBeDefined();
    });
  });

  describe("the node check's .nvmrc comparison, on fake version pairs", () => {
    it("parseNvmrcMajor parses the major version out of .nvmrc's content", () => {
      expect(parseNvmrcMajor("22\n")).toBe(22);
    });

    it("is a plain ok line, no note, when the running major matches .nvmrc", () => {
      expect(nodeCheckResult("22.11.0", 22)).toEqual({ ok: true, line: "Node v22.11.0" });
    });

    it("is a note, not a failure, when the running major is newer than .nvmrc", () => {
      expect(nodeCheckResult("25.2.1", 22)).toEqual({
        ok: true,
        note: true,
        line: "node v25.2.1 found; this repo is tested on node 22. the game usually works on newer versions; if something fails, switch with nvm use.",
      });
    });

    it("stays a hard failure, not a note, when the running version is too old regardless of .nvmrc", () => {
      expect(nodeCheckResult("18.16.0", 22)).toEqual({
        ok: false,
        line: "Node v18.16.0 is too old. install Node 22 from https://nodejs.org (or: brew install node@22), then reopen Terminal.",
      });
    });

    it("a newer Node than .nvmrc is a note in a real run, not counted as an ok line, and does not fail the run", async () => {
      const out: string[] = [];
      const code = await runChecks(fakeChecks({ node: nodeCheckResult("25.2.1", 22) }), (l) => out.push(l));
      expect(code).toBe(0);
      expect(out.filter((l) => l.startsWith("ok   ")).length).toBe(7);
      expect(out.some((l) => l.startsWith("note"))).toBe(true);
    });

    it("parseNvmrcMajor returns null when the file is missing (simulated by passing null)", () => {
      expect(parseNvmrcMajor(null)).toBeNull();
    });

    it("parseNvmrcMajor returns null on an alias that is not a plain integer", () => {
      expect(parseNvmrcMajor("lts/jod\n")).toBeNull();
    });

    it("no note when nvmrcMajor is unknown, even with a running major that would otherwise mismatch", () => {
      expect(nodeCheckResult("25.2.1", null)).toEqual({ ok: true, line: "Node v25.2.1" });
    });

    it("the too-old sentence derives its version from .nvmrc when a major is known", () => {
      expect(nodeCheckResult("18.16.0", 24)).toEqual({
        ok: false,
        line: "Node v18.16.0 is too old. install Node 24 from https://nodejs.org (or: brew install node@24), then reopen Terminal.",
      });
    });

    it("the too-old sentence falls back to 22 when no .nvmrc major is known", () => {
      expect(nodeCheckResult("18.16.0", null)).toEqual({
        ok: false,
        line: "Node v18.16.0 is too old. install Node 22 from https://nodejs.org (or: brew install node@22), then reopen Terminal.",
      });
    });
  });
});
