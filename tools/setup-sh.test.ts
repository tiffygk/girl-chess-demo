// setup.sh is bash; these tests run it with PATH pointed at a fake bin dir
// holding stub `brew`, `curl`, `stockfish`, `lc0`, and `uname`, so nothing
// real is installed or downloaded. Each stub is a tiny shell script.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = path.join(REPO_ROOT, "setup.sh");

function stub(dir: string, name: string, body: string) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(p, 0o755);
}

// A real gzip member so `gzip -t` passes: gzip an empty payload.
function goodGz(): Buffer {
  return spawnSync("gzip", ["-c"], { input: "" }).stdout;
}

let work: string;
let bin: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "gc-setup-"));
  bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  stub(bin, "uname", 'echo Darwin');
  stub(bin, "brew", 'exit 0'); // "already installed" for every `brew list`
  stub(bin, "stockfish", 'echo uciok');
  stub(bin, "lc0", 'echo uciok');
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

function run(extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [SETUP], {
    cwd: work,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: work, ...extraEnv },
    encoding: "utf8",
  });
}

// each test spawns bash, nine stub curl calls, and gzip; 5 s is not enough on a loaded machine or a shared CI runner.
describe("setup.sh", { timeout: 30_000 }, () => {
  it("re-downloads a weight file that exists but is not a valid gzip", () => {
    fs.mkdirSync(path.join(work, "weights"));
    fs.writeFileSync(path.join(work, "weights", "maia-1500.pb.gz"), "not gzip at all");
    // fake curl writes a valid gzip to the -o target and logs the call
    stub(bin, "curl", 'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "curl $out" >> "$HOME/curl.log"; printf "" | gzip -c > "$out"');
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = fs.readFileSync(path.join(work, "curl.log"), "utf8");
    expect(log).toMatch(/maia-1500\.pb\.gz/);
    expect(spawnSync("gzip", ["-t", path.join(work, "weights", "maia-1500.pb.gz")]).status).toBe(0);
  });

  it("fails with one plain sentence when a download is bad three times", () => {
    stub(bin, "curl", 'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo broken > "$out"');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/maia-1100 did not download correctly after 3 tries/);
    expect(r.stdout + r.stderr).toMatch(/check your internet connection and run \.\/setup\.sh again/);
  });

  it("names each file and its place in the sequence", () => {
    stub(bin, "curl", 'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; printf "" | gzip -c > "$out"');
    const r = run();
    expect(r.stdout).toMatch(/downloading maia-1100 \(1 of 9\)/);
    expect(r.stdout).toMatch(/downloading maia-1900 \(9 of 9\)/);
    expect(r.stdout).toMatch(/this takes about 2 to 10 minutes/);
  });

  it("refuses on a non-mac with one sentence", () => {
    stub(bin, "uname", 'echo Linux');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/Linux and Windows are not supported and not tested/);
  });

  it("skips valid existing weights without calling curl", () => {
    fs.mkdirSync(path.join(work, "weights"));
    for (const elo of [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]) {
      fs.writeFileSync(path.join(work, "weights", `maia-${elo}.pb.gz`), goodGz());
    }
    stub(bin, "curl", 'echo "curl $*" >> "$HOME/curl.log"; exit 1');
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(work, "curl.log"))).toBe(false);
    expect(r.stdout).toMatch(/all 9 opponent files already present/);
  });

  it("still downloads a missing named elo even when a stray file makes the glob count reach 9", () => {
    fs.mkdirSync(path.join(work, "weights"));
    const elos = [1100, 1200, 1300, 1400, 1600, 1700, 1800, 1900]; // 1500 missing
    for (const elo of elos) {
      fs.writeFileSync(path.join(work, "weights", `maia-${elo}.pb.gz`), goodGz());
    }
    fs.writeFileSync(path.join(work, "weights", "maia-9999.pb.gz"), goodGz());
    stub(bin, "curl", 'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "curl $out" >> "$HOME/curl.log"; printf "" | gzip -c > "$out"');
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = fs.readFileSync(path.join(work, "curl.log"), "utf8");
    expect(log).toMatch(/maia-1500\.pb\.gz/);
  });
});
