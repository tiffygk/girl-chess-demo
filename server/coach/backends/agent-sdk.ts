import { spawn } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
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
// Env-overridable so the coach model can be pinned without a code change
// (the Sonnet-vs-Opus A/B harness sets GC_COACH_MODEL=claude-opus-4-8 for its
// Opus stack; this is also the seam a future model-switcher would use).
// Defaults to Sonnet, so unset behavior is unchanged.
const AGENT_SDK_MODEL = process.env.GC_COACH_MODEL || "claude-sonnet-5";

// Controller review (follow-up commit, 2026-07-21): the first pass here
// probed with a real one-shot query("ping") call. Two findings killed
// that design. FINDING 1 (correctness): AGENT_SDK_PROBE_MS=3000 sat right
// on top of the SDK's real one-shot latency distribution (controller-
// measured on this machine, quiet, same options buildOptions builds:
// 4527ms / 3081ms / 3422ms) -- a probe this close to its own budget
// intermittently times out and silently demotes the coach to claude-cli,
// the exact slow path this backend exists to remove. FINDING 2 (cost):
// even a trivial prompt burns a full Sonnet round trip, and
// pickCoachBackend's per-pref cache re-probes every BACKEND_CACHE_TTL_MS
// of activity -- an extra model call roughly every 30s of play, purely to
// ask "are you there" (~$0.0028/call notional).
//
// The fix: there IS a cheaper "--version"-style check after all (this
// superseded the original Task 1 risk-log note that none existed) -- the
// SDK ships its own CLI as a platform-specific optional dependency (e.g.
// @anthropic-ai/claude-agent-sdk-darwin-arm64), and spawning THAT binary
// with `--version` is a real, no-model-call probe: controller-measured at
// 44ms. Same shape as claude-cli.ts's VERSION_PROBE_MS /
// `runCli(["--version"])`, and the same bounded discipline as ollama's
// fetch probe -- AbortController for good citizenship (kills the
// subprocess), Promise.race as the actual guarantee (a hung/misbehaving
// mock or subprocess can ignore the abort signal entirely and still can't
// keep this from resolving). Raised to 5000ms to match claude-cli's
// VERSION_PROBE_MS -- a local binary spawn has no reason to need less
// headroom than the sibling backend's own version check.
export const AGENT_SDK_PROBE_MS = 5000;

// The platform package does NOT resolve by module name -- it has no
// `exports` field, so `require.resolve("@anthropic-ai/claude-agent-sdk-
// darwin-arm64")` throws MODULE_NOT_FOUND. Resolve it on the filesystem
// instead, next to the main package's resolved entry point, rather than
// hardcoding a single platform/arch pair. Computed once at module load
// (mirrors claude-cli.ts's COACH_CWD discipline); undefined here (require
// itself failing) is a genuine "the SDK isn't installed at all" case --
// runVersionProbe below rejects immediately rather than calling spawn
// with a garbage path.
function resolveClaudeBinaryPath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
    const scopeDir = path.dirname(path.dirname(sdkEntry));
    return path.join(scopeDir, `claude-agent-sdk-${process.platform}-${process.arch}`, "claude");
  } catch {
    return undefined;
  }
}

const AGENT_SDK_BINARY_PATH = resolveClaudeBinaryPath();

// Bounding is the caller's job (available() below), same split as
// runQuery/generate() -- this just spawns, listens for the abort signal
// (good-citizen cleanup only; the caller's Promise.race is the real
// guarantee), and resolves/rejects on the process's own outcome. Missing
// binary, non-zero exit, and spawn errors (e.g. ENOENT if the optional
// platform dependency didn't install) all reject -- available() below
// turns every rejection into `false`, which is correct: without a working
// binary the SDK genuinely cannot run, and falling through to claude-cli
// is the right behavior.
function runVersionProbe(controller: AbortController): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!AGENT_SDK_BINARY_PATH) {
      reject(new Error("agent-sdk binary path could not be resolved"));
      return;
    }
    let settled = false;
    const proc = spawn(AGENT_SDK_BINARY_PATH, ["--version"], { signal: controller.signal });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`agent-sdk version probe exited ${code}`));
    });
  });
}

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
// Prompt-caching round (2026-08-02 latency plan, Task 3a build-out): the
// spike (spike-3a-caching.md) proved `query()` reuses cache across separate
// one-shot calls, under this backend's exact security posture, when the
// SAME byte-identical text rides in `options.systemPrompt` as a `string[]`
// with the SDK's own exported cache-boundary marker. stablePrefix is
// undefined on every pre-this-round call site (backend.generate/
// generateStream's new 3rd/4th param is optional) -- so buildOptions grows
// no `systemPrompt` field and every caller that doesn't pass it gets
// byte-identical options to before.
function buildOptions(abortController: AbortController, stablePrefix?: string) {
  return {
    model: AGENT_SDK_MODEL,
    maxTurns: 1,
    tools: [] as string[],
    strictMcpConfig: true,
    cwd: AGENT_SDK_CWD,
    settingSources: [] as never[],
    env: subscriptionOnlyEnv(),
    abortController,
    ...(stablePrefix ? { systemPrompt: [stablePrefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY] } : {}),
  };
}

// The seam's contract (types.ts): `prompt` is ALWAYS the complete, ready-
// to-send text on its own, and stablePrefix (when present) is always a
// leading substring of it followed by "\n" -- chat.ts builds it that way,
// and every backend that ignores stablePrefix relies on `prompt` staying
// whole. Once that text is moved into `systemPrompt` above, sending it a
// second time as literal `prompt` content would duplicate it (wasted
// tokens, a confusing double instruction) and defeat the point of caching
// it separately -- so this strips exactly that leading substring back out.
// Defensive fallback: if the invariant ever doesn't hold (prompt doesn't
// actually start with stablePrefix -- should never happen from chat.ts),
// send the untouched prompt rather than mangling it; the systemPrompt is
// still set, just with stablePrefix's content appearing twice in that edge
// case instead of the model losing text.
//
// Review fix F3 (Opus review of ab814d4..1c31dab, 2026-08-02): drift is
// CONFIRMED IMPOSSIBLE in the current wiring (chat.ts's basePrompt always
// starts with stablePrefix + "\n"; the corrective suffix is appended, never
// prepended; the timeout retry reuses basePrompt unchanged) -- but this
// branch had no signal at all if that ever stopped being true. A future
// edit that prepends anything to attemptPrompt would silently double-send
// the persona (wasted tokens, defeats caching) with zero observability.
// console.warn (not throw -- fail toward duplication, never crash the
// chat) names the drift so it shows up in server logs instead of hiding.
export function splitStablePrefix(prompt: string, stablePrefix: string | undefined): string {
  if (!stablePrefix) return prompt;
  const withSeparator = `${stablePrefix}\n`;
  if (!prompt.startsWith(withSeparator)) {
    console.warn(
      `[agent-sdk] splitStablePrefix: stablePrefix drift -- prompt does not start with the expected ` +
        `stablePrefix + "\\n" (stablePrefix ${stablePrefix.length} chars, prompt ${prompt.length} chars). ` +
        `Sending the prompt untouched (systemPrompt is still set) -- the persona text is being sent ` +
        `TWICE this call, wasting tokens. This should never happen from chat.ts; investigate the caller.`
    );
    return prompt;
  }
  return prompt.slice(withSeparator.length);
}

// One stateless one-shot turn (sdk-api-notes.md Q2): the terminal
// `result`/`success` message carries the final text directly in
// `result.result` -- never reassembled from assistant content blocks.
// Bounding (timeout/abort) is the caller's job (available()/generate()
// below), not this function's -- keeps the two callers' Promise.race
// wiring in one place each, mirroring ollama.ts's fetch-wrapped shape.
async function runQuery(
  prompt: string,
  abortController: AbortController,
  stablePrefix?: string
): Promise<string> {
  let result = "";
  const stream = query({
    prompt: splitStablePrefix(prompt, stablePrefix),
    options: buildOptions(abortController, stablePrefix),
  }) as AsyncGenerator<SDKMessage, void>;
  for await (const message of stream) {
    if (message.type === "result") {
      if (message.subtype === "success") result = message.result;
      else throw new Error(`agent-sdk result error: ${JSON.stringify(message)}`);
    }
  }
  return result.trim();
}

// B-stream (2026-07-27, coach-truth-speed round): the streaming sibling of
// runQuery above. `includePartialMessages: true` is added ONLY to the
// options object this function builds -- buildOptions/runQuery/generate stay
// byte-identical, so the non-streaming path cannot regress. A `stream_event`
// message wraps the SDK's own raw Anthropic stream event
// (SDKPartialAssistantMessage.event: BetaRawMessageStreamEvent); the only
// shape this backend renders live is a text delta on the (single, maxTurns:1)
// content block -- content_block_delta + delta.type "text_delta" -- every
// other event type (message_start/stop, content_block_start/stop, thinking/
// signature/citation/input-json deltas) is silently ignored, exactly the
// same "only text deltas are advisory rendering" cut ollama/claude-cli never
// had to make because neither streams at all.
// The terminal `result.result` on the "result" message is still the ONLY
// source for the returned string -- deltas are never concatenated into it.
// This is deliberate, not an oversight: the deltas are provisional token
// fragments the model can still revise before the turn ends, and chat.ts's
// validateChat must always validate the same authoritative text the caller
// ends up persisting/rendering as final, never a hand-assembled echo of what
// was streamed.
async function runQueryStream(
  prompt: string,
  abortController: AbortController,
  onDelta: (text: string) => void,
  stablePrefix?: string
): Promise<string> {
  let result = "";
  const stream = query({
    prompt: splitStablePrefix(prompt, stablePrefix),
    options: { ...buildOptions(abortController, stablePrefix), includePartialMessages: true },
  }) as AsyncGenerator<SDKMessage, void>;
  for await (const message of stream) {
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onDelta(event.delta.text);
      }
      continue;
    }
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
      await Promise.race([runVersionProbe(controller), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
  async generate(prompt, timeoutMs, stablePrefix) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`agent-sdk generate timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([runQuery(prompt, controller, stablePrefix), timeout]);
    } finally {
      clearTimeout(timer);
    }
  },
  // B-stream: identical AbortController + Promise.race bounding as generate()
  // above (same reject message shape -- "timed out" -- so chat.ts's
  // isTimeoutError classification is unchanged for the streaming path too),
  // delegating only to runQueryStream instead of runQuery.
  async generateStream(prompt, timeoutMs, onDelta, stablePrefix) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`agent-sdk generate timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([runQueryStream(prompt, controller, onDelta, stablePrefix), timeout]);
    } finally {
      clearTimeout(timer);
    }
  },
};
