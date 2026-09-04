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
import { ENGINE_PATHS, ALLOWED_ELOS } from "../server/engines/paths";
import { probeCoach } from "../server/coach/backends/probe";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type CheckResult = { ok: boolean; line: string; note?: boolean };
export type Check = {
  name: "node" | "homebrew" | "stockfish" | "lc0" | "weights" | "ports" | "coach" | "data";
  run: () => Promise<CheckResult>;
};

function has(cmd: string): boolean {
  return spawnSync("/usr/bin/which", [cmd]).status === 0;
}

function uciAnswers(cmd: string, args: string[] = []): boolean {
  try {
    const out = execFileSync(cmd, args, { input: "uci\nquit\n", encoding: "utf8", timeout: 8000 });
    return /uciok/.test(out);
  } catch {
    return false;
  }
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

export const realChecks: Check[] = [
  {
    name: "node",
    run: async () => {
      const [major, minor] = process.versions.node.split(".").map(Number);
      const ok = major > 20 || (major === 20 && minor >= 19);
      return ok
        ? { ok: true, line: `Node v${process.versions.node}` }
        : { ok: false, line: `Node v${process.versions.node} is too old. install Node 22 from https://nodejs.org (or: brew install node@22), then reopen Terminal.` };
    },
  },
  {
    name: "homebrew",
    run: async () =>
      has("brew")
        ? { ok: true, line: "Homebrew installed" }
        : { ok: false, line: "Homebrew is not installed. install it from https://brew.sh (one command, about 5 minutes), then run ./setup.sh." },
  },
  {
    name: "stockfish",
    run: async () =>
      !has("stockfish")
        ? { ok: false, line: "stockfish (the chess engine) is not installed. run ./setup.sh." }
        : uciAnswers("stockfish")
          ? { ok: true, line: "stockfish answers" }
          : { ok: false, line: "stockfish is installed but does not answer. run: brew reinstall stockfish" },
  },
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
