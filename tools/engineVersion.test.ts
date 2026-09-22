// tools/engineVersion.sh is the exact script .github/workflows/gate.yml's
// "engine version" step runs. Exercised here with a fake `stockfish` on
// PATH so CI's pass/fail logic is proven without touching brew.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { EXPECTED_STOCKFISH_ID } from "./doctor";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "tools", "engineVersion.sh");

function stub(dir: string, name: string, body: string) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(p, 0o755);
}

let work: string;
let bin: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "gc-engine-version-"));
  bin = path.join(work, "bin");
  fs.mkdirSync(bin);
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

// cwd is the isolated temp dir, never REPO_ROOT: since Task 8 (2026-09-21)
// the script prefers a relative engines/stockfish, and the real checkout
// has one once setup.sh has run, which would silently outrank every PATH
// stub below.
function run() {
  return spawnSync("bash", [SCRIPT], { cwd: work, env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
}

describe("engineVersion.sh", () => {
  it("has exactly one EXPECTED= literal, matching doctor.ts's EXPECTED_STOCKFISH_ID", () => {
    const text = fs.readFileSync(SCRIPT, "utf8");
    const m = text.match(/^EXPECTED="(.+)"$/m);
    expect(m, text).not.toBeNull();
    expect(m![1]).toBe(EXPECTED_STOCKFISH_ID);
  });

  it("passes and prints the id line when the installed version matches the baseline", () => {
    stub(bin, "stockfish", `echo "id name ${EXPECTED_STOCKFISH_ID}"; echo uciok`);
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^id name ${EXPECTED_STOCKFISH_ID}$`, "m"));
  });

  it("fails with the exact mismatch sentence when the installed version is not the baseline", () => {
    stub(bin, "stockfish", 'echo "id name Stockfish 18"; echo uciok');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^id name Stockfish 18$/m);
    expect(r.stdout).toContain(
      `stockfish Stockfish 18 installed; this repo's eval fixtures are baselined on ${EXPECTED_STOCKFISH_ID}. the game works; eval tests may differ. see .claude/rules/data-and-gate.md`
    );
  });

  it("fails with the missing-id-name sentence when the engine answers but never sends an id name line", () => {
    stub(bin, "stockfish", "echo uciok");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "stockfish answered without an id name line; this repo's eval fixtures are baselined on Stockfish 19. the game works; eval tests may differ. see .claude/rules/data-and-gate.md"
    );
  });

  // Task 8 (2026-09-21 engine-pin round): a pinned engines/stockfish (what
  // setup.sh installs by checksum) wins over a PATH stockfish, matching the
  // preference order in server/engines/paths.ts's resolveStockfishPath. Red
  // when that preference is removed (the PATH stub's "Stockfish 20" would
  // then win and the test would see the wrong id line / a failing exit).
  it("prefers a pinned engines/stockfish over a PATH stockfish", () => {
    stub(bin, "stockfish", 'echo "id name Stockfish 20"; echo uciok');
    const engineWork = fs.mkdtempSync(path.join(os.tmpdir(), "gc-engine-version-pinned-"));
    const engineDir = path.join(engineWork, "engines");
    fs.mkdirSync(engineDir);
    stub(engineDir, "stockfish", `echo "id name ${EXPECTED_STOCKFISH_ID}"; echo uciok`);
    const r = spawnSync("bash", [SCRIPT], { cwd: engineWork, env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
    fs.rmSync(engineWork, { recursive: true, force: true });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^id name ${EXPECTED_STOCKFISH_ID}$`, "m"));
  });
});
