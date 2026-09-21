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

function sha256Of(filePath: string): string {
  const out = spawnSync("shasum", ["-a", "256", filePath], { encoding: "utf8" }).stdout;
  return out.trim().split(/\s+/)[0];
}

const ELOS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

// gzip embeds a timestamp, so `gzip -c` is NOT byte-identical between calls
// -- a checksum precomputed once cannot match bytes regenerated on the fly.
// Every fixture below is written ONCE per test, its real sha256 is computed
// from those exact bytes, and any stub `curl` that must "download" it
// copies the same file rather than re-running gzip. That is also why a
// checksum table (GC_WEIGHTS_SHA256_FILE), not a fixed hash constant, is the
// right fixture shape here: the test controls the bytes and the table in
// the same breath, real setup.sh usage builds the table from real weights.
function writeFixedGz(dir: string, name: string, payload: string): { path: string; sha256: string } {
  const p = path.join(dir, name);
  fs.writeFileSync(p, spawnSync("gzip", ["-c"], { input: payload }).stdout);
  return { path: p, sha256: sha256Of(p) };
}

// A checksum table in the same format setup.sh reads: `<sha256>  weights/maia-<elo>.pb.gz` per line.
function writeShaFile(dir: string, entries: Array<{ elo: number; sha256: string }>): string {
  const p = path.join(dir, "weights-sha256.txt");
  fs.writeFileSync(p, entries.map((e) => `${e.sha256}  weights/maia-${e.elo}.pb.gz`).join("\n") + "\n");
  return p;
}

let work: string;
let bin: string;
// A single fixed-content gzip fixture and a checksum table that says every
// one of the nine weight files should hash to it -- the "matching content"
// every already-passing case below now downloads or pre-places.
let fixedGz: { path: string; sha256: string };
let defaultShaFile: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "gc-setup-"));
  bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  stub(bin, "uname", 'echo Darwin');
  stub(bin, "brew", 'exit 0'); // "already installed" for every `brew list`
  stub(bin, "stockfish", 'echo "id name Stockfish 19"; echo uciok');
  stub(bin, "lc0", 'echo uciok');
  fixedGz = writeFixedGz(work, "fixed.gz", "gc-test-weight-payload");
  defaultShaFile = writeShaFile(work, ELOS.map((elo) => ({ elo, sha256: fixedGz.sha256 })));
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

// A real gzip member whose checksum is registered in defaultShaFile, so
// pre-placing it satisfies both `gzip -t` and the checksum check.
function goodGz(): Buffer {
  return fs.readFileSync(fixedGz.path);
}

// Every existing stub curl below was rewritten from an inline `gzip -c` to
// this: it must return the SAME bytes every call (never regenerate gzip
// inline, which would mint a new timestamp and a new hash each time) so the
// checksum check added by this brief sees matching content, not noise.
function curlCopyingFixedGz(): string {
  return `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "curl $out" >> "$HOME/curl.log"; cp "${fixedGz.path}" "$out"`;
}

function run(extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [SETUP], {
    cwd: work,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: work, GC_WEIGHTS_SHA256_FILE: defaultShaFile, ...extraEnv },
    encoding: "utf8",
  });
}

// each test spawns bash, nine stub curl calls, and gzip; 5 s is not enough on a loaded machine or a shared CI runner.
describe("setup.sh", { timeout: 30_000 }, () => {
  it("re-downloads a weight file that exists but is not a valid gzip", () => {
    fs.mkdirSync(path.join(work, "weights"));
    fs.writeFileSync(path.join(work, "weights", "maia-1500.pb.gz"), "not gzip at all");
    // fake curl writes a valid, checksum-matching gzip to the -o target and logs the call
    stub(bin, "curl", curlCopyingFixedGz());
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
    stub(bin, "curl", curlCopyingFixedGz());
    const r = run();
    expect(r.stdout).toMatch(/downloading maia-1100 \(1 of 9\)/);
    expect(r.stdout).toMatch(/downloading maia-1900 \(9 of 9\)/);
    expect(r.stdout).toMatch(/this takes about 2 to 10 minutes/);
  });

  it("echoes the engine's own id name in the OK line", () => {
    stub(bin, "curl", curlCopyingFixedGz());
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/stockfish OK \(Stockfish 19\)/);
  });

  it("retries once, then fails with one plain sentence naming the file, when a download's checksum does not match", () => {
    const wrongGz = writeFixedGz(work, "wrong.gz", "not-the-payload-the-checksum-table-expects");
    stub(
      bin,
      "curl",
      `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "curl $out" >> "$HOME/curl.log"; cp "${wrongGz.path}" "$out"`
    );
    const r = run();
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toMatch(/maia-1100 still does not match the expected checksum after a second download, so it was removed\./);
    expect(out).toMatch(
      /the upstream file may have changed; open an issue at github\.com\/tiffygk\/girl-chess-demo and do not run the game with unverified opponent files\./
    );
    // one normal attempt (gzip-valid, so the 3-try loop stops there) plus
    // one retry after the checksum mismatch -- never three, never zero.
    const log = fs.readFileSync(path.join(work, "curl.log"), "utf8");
    expect(log.split("\n").filter((l) => l.includes("maia-1100.pb.gz")).length).toBe(2);
    expect(fs.existsSync(path.join(work, "weights", "maia-1100.pb.gz"))).toBe(false);
  });

  it("fails with one sentence when the checksum table is missing or empty", () => {
    const r = run({ GC_WEIGHTS_SHA256_FILE: path.join(work, "nonexistent-sha256.txt") });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toMatch(
      /tools\/weights-sha256\.txt is missing, so the opponent files cannot be verified\. run \.\/setup\.sh from the girl-chess-demo folder, or restore the file from git\./
    );
  });

  it("says a checksum mismatch on an existing file is not an interrupted download", () => {
    fs.mkdirSync(path.join(work, "weights"));
    const wrongExisting = writeFixedGz(work, "wrong-existing.gz", "existing-file-wrong-payload");
    fs.writeFileSync(path.join(work, "weights", "maia-1500.pb.gz"), fs.readFileSync(wrongExisting.path));
    stub(bin, "curl", curlCopyingFixedGz());
    const r = run();
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toMatch(/maia-1500 does not match the expected file \(wrong bytes, not an interrupted download\); fetching it again/);
    expect(out).not.toMatch(/maia-1500 is damaged \(a download was interrupted\)/);
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
    stub(bin, "curl", curlCopyingFixedGz());
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = fs.readFileSync(path.join(work, "curl.log"), "utf8");
    expect(log).toMatch(/maia-1500\.pb\.gz/);
  });
});
