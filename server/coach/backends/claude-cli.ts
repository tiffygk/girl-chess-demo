import { spawn } from "child_process";
import type { CoachBackend } from "./types";

// Same spawn discipline as server/engines/uci.ts: explicit timeout kill,
// stderr captured, and every failure mode (spawn error, non-zero exit,
// timeout) rejects rather than throwing synchronously — narrate() in
// ../index.ts treats any rejection here as "fall back to the corrective
// regen or the template", never as a crash.
function runCli(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const proc = spawn("claude", args);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(`claude cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude cli exited ${code}: ${stderr.trim()}`));
    });
  });
}

// Short probe budget for `claude --version` — this is an availability
// check, not a generation call, so it stays independent of the caller's
// narrate timeoutMs.
const VERSION_PROBE_MS = 5000;

// Default backend (F17): headless `claude` CLI, no --model flag so the
// owner's own CLI config (model, auth) rules — $0 marginal on her plan.
export const claudeCliBackend: CoachBackend = {
  name: "claude-cli",
  async available() {
    try {
      await runCli(["--version"], VERSION_PROBE_MS);
      return true;
    } catch {
      return false;
    }
  },
  async generate(prompt, timeoutMs) {
    const out = await runCli(["-p", prompt, "--output-format", "text"], timeoutMs);
    return out.trim();
  },
};
