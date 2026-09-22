// npm run doctor: says, in plain English, whether this Mac can run girl
// chess and what to do about each thing that is missing. Every check is a
// small function that returns ok or one sentence with the fix, so a person
// who does not know Node or Homebrew can act on the output without a search.
//
// No server/store import: weightsCheck.ts, engines/paths.ts, and
// coach/backends/probe.ts (via agent-sdk.ts) touch only node:fs, node:path,
// node:url, child_process, module, os -- none open the db, so this file can
// load without a database side effect.
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { inspectWeights } from "../server/engines/weightsCheck";
import { ENGINE_PATHS, ALLOWED_ELOS, resolveStockfishPath } from "../server/engines/paths";
import { probeCoach } from "../server/coach/backends/probe";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type CheckResult = { ok: boolean; line: string; note?: boolean };
export type Check = {
  name: "node" | "homebrew" | "stockfish" | "lc0" | "weights" | "ports" | "coach" | "data" | "manifest";
  run: () => Promise<CheckResult>;
};

function has(cmd: string): boolean {
  return spawnSync("/usr/bin/which", [cmd]).status === 0;
}

// Runs the uci/quit exchange once and returns the raw output, or null if the
// command does not run or times out. Shared by uciIdName and the stockfish
// check below so a doctor run never spawns the engine twice for one check.
function runUciExchange(cmd: string, args: string[] = []): string | null {
  try {
    return execFileSync(cmd, args, { input: "uci\nquit\n", encoding: "utf8", timeout: 8000 });
  } catch {
    return null;
  }
}

function parseIdName(out: string): string | null {
  const m = out.match(/^id name (.+)$/m);
  return m ? m[1].trim() : null;
}

// The eval fixtures are baselined on a named engine version; the doctor and
// CI both assert against this constant so a Homebrew bump surfaces as one
// named line instead of mysterious fixture failures. See
// .claude/rules/data-and-gate.md's Engine-version rule.
export const EXPECTED_STOCKFISH_ID = "Stockfish 19";

// Parses the `id name <...>` line out of a uci/quit exchange, e.g.
// "Stockfish 19". Returns null if the command does not run, times out, or
// never sends an id name line.
export function uciIdName(cmd: string, args: string[] = []): string | null {
  const out = runUciExchange(cmd, args);
  return out === null ? null : parseIdName(out);
}

// A dev server can bind loopback on either family: vite has been observed
// listening on ::1 only while an express server takes 127.0.0.1 only (or
// vice versa). Binding just one family reads the other's port as free, so
// check both loopback addresses and call the port busy if either refuses.
// Each bind attempt closes immediately (before the next one starts), so at
// no point are both a check's own probe sockets open at once.
function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

async function portFree(port: number): Promise<boolean> {
  const v4 = await bindable(port, "127.0.0.1");
  if (!v4) return false;
  return bindable(port, "::1");
}

// Parses the major version number out of .nvmrc's content, e.g. "22\n" -> 22.
// Returns null when there is nothing to compare against: a missing file
// (the caller passes null when the read failed) or content that is not a
// plain integer, such as an nvm alias like "lts/jod".
export function parseNvmrcMajor(nvmrcContent: string | null): number | null {
  if (nvmrcContent === null) return null;
  const trimmed = nvmrcContent.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return parseInt(trimmed, 10);
}

// Pure so the note-vs-fail decision can be tested with fake version pairs,
// without spawning a different Node. A version too old to run the game at
// all stays a hard failure regardless of .nvmrc (that check is unrelated to
// which version this repo is tested on). A version that runs fine but has a
// different major than .nvmrc is a note, not a failure: the game usually
// works on newer Node, and a green "ok" that never looks at .nvmrc would
// hide the one thing worth telling a stranger who hits a real mismatch.
// nvmrcMajor is null when .nvmrc is missing or unparseable (e.g. an alias);
// in that case there is nothing to note against, so a running-major
// mismatch is silently skipped, and the too-old sentence falls back to 22.
export function nodeCheckResult(runningVersion: string, nvmrcMajor: number | null): CheckResult {
  const [major, minor] = runningVersion.split(".").map(Number);
  const tooOld = !(major > 20 || (major === 20 && minor >= 19));
  if (tooOld) {
    const installMajor = nvmrcMajor ?? 22;
    return {
      ok: false,
      line: `Node v${runningVersion} is too old. install Node ${installMajor} from https://nodejs.org (or: brew install node@${installMajor}), then reopen Terminal.`,
    };
  }
  if (nvmrcMajor !== null && major !== nvmrcMajor) {
    return {
      ok: true,
      note: true,
      line: `node v${runningVersion} found; this repo is tested on node ${nvmrcMajor}. the game usually works on newer versions; if something fails, switch with nvm use.`,
    };
  }
  return { ok: true, line: `Node v${runningVersion}` };
}

// A different Stockfish than the pin is a NOTE (exit 0), never a failure
// (owner ruling 2026-09-21): the game works fine on another version, only
// the eval fixtures may read differently. CI still asserts the pin by name
// (tools/engineVersion.sh); the doctor is the friendly, non-blocking signal
// for a stranger's machine. Factored as a function taking an injectable
// path resolver (default resolveStockfishPath) so the "pinned wins over
// PATH" preference is testable against a synthesized binary, never this
// real checkout's own engines/ directory.
export function makeStockfishCheck(resolvePath: () => string = resolveStockfishPath): Check {
  return {
    name: "stockfish",
    run: async () => {
      const sfPath = resolvePath();
      const pinned = sfPath !== "stockfish";
      if (!pinned && !has("stockfish")) {
        return { ok: false, line: "stockfish (the chess engine) is not installed. run ./setup.sh." };
      }
      const out = runUciExchange(sfPath);
      if (out === null || !/uciok/.test(out)) {
        return {
          ok: false,
          line: pinned
            ? `the pinned stockfish at ${sfPath} does not answer. delete engines/ and run ./setup.sh again.`
            : "stockfish is installed but does not answer. run: brew reinstall stockfish",
        };
      }
      const idName = parseIdName(out);
      if (idName && idName.includes(EXPECTED_STOCKFISH_ID)) {
        return {
          ok: true,
          line: pinned
            ? `stockfish answers (${EXPECTED_STOCKFISH_ID}, the pinned engine in engines/)`
            : `stockfish answers (${EXPECTED_STOCKFISH_ID}, found on PATH)`,
        };
      }
      return {
        ok: true,
        note: true,
        line: `${idName ?? "stockfish"} found at ${sfPath}; this repo is tested on ${EXPECTED_STOCKFISH_ID}. the game works; eval tests may differ. run ./setup.sh to install the pinned engine.`,
      };
    },
  };
}

// B1.3 (live-telemetry round, 2026-09-22): confirms GET /api/agent/manifest
// responds and lists the endpoints this round adds. A note (not a hard
// failure) when the server isn't running at all -- doctor runs on a fresh
// clone before anyone has started `npm run dev`, same reasoning as the
// "coach" check above -- so this only ever fixes-fails when the server IS
// up but the route is missing or the manifest dropped an endpoint.
// `fetchJson` is injected so doctor.test.ts never needs a real server.
export function makeManifestCheck(
  fetchJson: (url: string) => Promise<any> = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  }
): Check {
  return {
    name: "manifest",
    run: async () => {
      const port = Number(process.env.PORT) || 3001;
      let body: any;
      try {
        body = await fetchJson(`http://localhost:${port}/api/agent/manifest`);
      } catch {
        return { ok: true, note: true, line: "agent manifest: server not running; start npm run dev, then re-run doctor to verify GET /api/agent/manifest." };
      }
      const paths: string[] = Array.isArray(body?.endpoints) ? body.endpoints.map((e: any) => e?.path) : [];
      const required = ["/api/health", "/api/game/:id/state", "/api/agent/manifest"];
      const missing = required.filter((p) => !paths.includes(p));
      if (missing.length > 0) {
        return { ok: false, line: `agent manifest is missing ${missing.join(", ")}. check server/agentManifest.ts.` };
      }
      return { ok: true, line: `agent manifest lists all ${required.length} telemetry endpoints` };
    },
  };
}

export const realChecks: Check[] = [
  {
    name: "node",
    run: async () => {
      let nvmrcContent: string | null;
      try {
        nvmrcContent = fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf8");
      } catch {
        nvmrcContent = null;
      }
      const nvmrcMajor = parseNvmrcMajor(nvmrcContent);
      return nodeCheckResult(process.versions.node, nvmrcMajor);
    },
  },
  {
    name: "homebrew",
    run: async () =>
      has("brew")
        ? { ok: true, line: "Homebrew installed" }
        : { ok: false, line: "Homebrew is not installed. install it from https://brew.sh (one command, about 5 minutes), then run ./setup.sh." },
  },
  makeStockfishCheck(),
  {
    name: "lc0",
    run: async () =>
      !has("lc0")
        ? { ok: false, line: "lc0 (runs the human-like opponent) is not installed. run ./setup.sh." }
        : { ok: true, line: "lc0 installed" },
  },
  {
    name: "weights",
    run: async () => {
      const states = inspectWeights(ALLOWED_ELOS, ENGINE_PATHS.maiaWeights);
      const bad = states.filter((s) => s.state !== "ok");
      if (bad.length === 0) return { ok: true, line: `${states.length} of ${states.length} opponent files present and valid` };
      const damaged = bad.filter((s) => s.state === "damaged").map((s) => path.relative(REPO_ROOT, s.file));
      if (damaged.length > 0) return { ok: false, line: `opponent file${damaged.length > 1 ? "s" : ""} ${damaged.join(", ")} ${damaged.length > 1 ? "are" : "is"} damaged. delete ${damaged.length > 1 ? "them" : "it"} and run ./setup.sh again.` };
      return { ok: false, line: `${bad.length} of ${states.length} opponent files are missing. run ./setup.sh to download them.` };
    },
  },
  {
    name: "ports",
    run: async () => {
      const server = Number(process.env.PORT) || 3001;
      const client = Number(process.env.VITE_PORT) || 5173;
      const [s, c] = await Promise.all([portFree(server), portFree(client)]);
      if (s && c) return { ok: true, line: `ports ${server} and ${client} are free` };
      const busy = [!s && `port ${server}`, !c && `port ${client}`].filter(Boolean).join(" and ");
      return { ok: false, line: `${busy} ${!s && !c ? "are" : "is"} already in use by another program. run PORT=${!s ? server + 1 : server} VITE_PORT=${!c ? client + 1 : client} npm run dev, or quit that program.` };
    },
  },
  {
    name: "coach",
    run: async () => {
      const p = await probeCoach();
      if (p.state === "ready") return { ok: true, line: "coach: Claude Code is installed and signed in" };
      return { ok: true, note: true, line: `coach: ${p.detail}` };
    },
  },
  {
    name: "data",
    run: async () => {
      try {
        fs.mkdirSync(path.join(REPO_ROOT, "data"), { recursive: true });
        fs.accessSync(path.join(REPO_ROOT, "data"), fs.constants.W_OK);
        return { ok: true, line: "data folder is writable" };
      } catch {
        return { ok: false, line: `the data folder at ${path.join(REPO_ROOT, "data")} is not writable. check the folder's permissions.` };
      }
    },
  },
  makeManifestCheck(),
];

export async function runChecks(checks: Check[], print: (line: string) => void): Promise<number> {
  let failures = 0;
  for (const c of checks) {
    const r = await c.run();
    if (r.ok && r.note) print(`note ${r.line}`);
    else if (r.ok) print(`ok   ${r.line}`);
    else {
      failures++;
      print(`fix  ${r.line}`);
    }
  }
  print(failures === 0 ? "doctor: everything is ready. run npm run dev" : `doctor: ${failures} thing${failures === 1 ? "" : "s"} to fix above`);
  return failures === 0 ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runChecks(realChecks, (l) => console.log(l)).then((code) => process.exit(code));
}
