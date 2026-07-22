import fs from "fs";
import os from "os";
import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CoachBackend } from "./types";

// Warm-coach-backend round (2026-07-21). Per decision-no-warm-reserve.md
// (Opus controller, amending the brief's Task 2): measured startup()/
// WarmQuery's reserve pattern head-to-head against plain per-call query()
// and the delta (~0.5s on a ~3s call) landed inside the noise band of the
// cold samples, with warm_spare_claimed null on every warm call (not even
// confirmed the spare was claimed). generate() below calls query() per
// call -- no startup(), no WarmQuery, no background refill. What IS
// hoisted to module load, per that decision doc: the shared Options
// shape (built fresh per call from this module's constants, since
// abortController/env must differ per call), the neutral-cwd mkdirSync,
// and the module import itself.

// Model pinned per the brief (A0): claude-sonnet-5, verbatim per
// sdk-api-notes.md Q3 ("used verbatim as an example in the type's own doc
// comment -- no alias mapping needed").
const AGENT_SDK_MODEL = "claude-sonnet-5";

// Task 8 (inc 3.95, Fix 3)'s OLLAMA_PROBE_MS / claude-cli's
// VERSION_PROBE_MS precedent: available() must never hang
// pickCoachBackend. There is no cheaper "--version"-style check for the
// SDK (Task 1 risk log), so the probe is a real one-shot query with a
// trivial prompt, bounded the same two ways ollama's fetch probe is --
// AbortController for good citizenship, Promise.race as the actual
// guarantee (a hung/misbehaving mock or subprocess can ignore the abort
// signal entirely and still can't keep this from resolving).
export const AGENT_SDK_PROBE_MS = 3000;
const AGENT_SDK_PROBE_PROMPT = "ping";

// Neutral cwd outside the repo (A0 security constraint + sdk-api-notes.md
// Q5): created once at module load, same discipline as claude-cli.ts's
// COACH_CWD -- mkdirSync with recursive:true is idempotent and cheap to
// skip repeating on every call.
const AGENT_SDK_CWD = path.join(os.tmpdir(), "girl-chess-agent-sdk-coach");
fs.mkdirSync(AGENT_SDK_CWD, { recursive: true });

// sdk-api-notes.md Q6: the `env` option REPLACES the subprocess env
// entirely, it does not merge with process.env. Spread the rest of
// process.env so PATH/HOME/CLAUDE_CODE_OAUTH_TOKEN still reach the
// subprocess, but strip ANTHROPIC_API_KEY so this call always resolves to
// subscription/OAuth auth, never a stray metered key -- built fresh from
// the live process.env on every call, and never mutates process.env
// itself (no global `delete process.env.ANTHROPIC_API_KEY`, which would
// leak to every other subprocess this Node process spawns).
function subscriptionOnlyEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY, ...rest } = process.env;
  return rest;
}

// Security options (A0): all built-in tools disabled (`tools: []`, the
// availability knob per sdk-api-notes.md Q4 -- not `allowedTools`, which
// is permission-layer only), no MCP servers (`strictMcpConfig: true` with
// `mcpServers` left unset), full filesystem-settings isolation
// (`settingSources: []`), neutral cwd. The coach prompt embeds untrusted
// chat text; with no tools and no MCP there is nothing for a
// prompt-injection attempt to execute.
function buildOptions(abortController: AbortController) {
  return {
    model: AGENT_SDK_MODEL,
    maxTurns: 1,
    tools: [] as string[],
    strictMcpConfig: true,
    cwd: AGENT_SDK_CWD,
    settingSources: [] as never[],
    env: subscriptionOnlyEnv(),
    abortController,
  };
}

// One stateless one-shot turn (sdk-api-notes.md Q2): the terminal
// `result`/`success` message carries the final text directly in
// `result.result` -- never reassembled from assistant content blocks.
// Bounding (timeout/abort) is the caller's job (available()/generate()
// below), not this function's -- keeps the two callers' Promise.race
// wiring in one place each, mirroring ollama.ts's fetch-wrapped shape.
async function runQuery(prompt: string, abortController: AbortController): Promise<string> {
  let result = "";
  const stream = query({
    prompt,
    options: buildOptions(abortController),
  }) as AsyncGenerator<SDKMessage, void>;
  for await (const message of stream) {
    if (message.type === "result") {
      if (message.subtype === "success") result = message.result;
      else throw new Error(`agent-sdk result error: ${JSON.stringify(message)}`);
    }
  }
  return result.trim();
}

// Warm coach backend (F17 sibling to claude-cli/ollama): in-process via
// @anthropic-ai/claude-agent-sdk instead of spawning a fresh `claude`
// process per call. Bounded exactly like ollama.ts -- AbortController +
// Promise.race on the probe, AbortController + setTimeout(timeoutMs) on
// generate, finally clearTimeout -- so a hung or misbehaving SDK call can
// never stall pickCoachBackend or narrate()/chat()'s existing
// timeout/fallback handling.
export const agentSdkBackend: CoachBackend = {
  name: "agent-sdk",
  async available() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`agent-sdk probe timed out after ${AGENT_SDK_PROBE_MS}ms`));
      }, AGENT_SDK_PROBE_MS);
    });
    try {
      await Promise.race([runQuery(AGENT_SDK_PROBE_PROMPT, controller), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
  async generate(prompt, timeoutMs) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`agent-sdk generate timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([runQuery(prompt, controller), timeout]);
    } finally {
      clearTimeout(timer);
    }
  },
};
