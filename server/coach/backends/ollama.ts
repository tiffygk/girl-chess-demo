import type { CoachBackend } from "./types";

// Owner-calibratable starting value: swap for whatever model she's pulled
// locally. No new npm deps — Node 20+ ships a global fetch.
export const OLLAMA_MODEL = "llama3.2";
const OLLAMA_BASE_URL = "http://localhost:11434";

// Task 8 (inc 3.95, Fix 3), owner-calibratable starting value: claude-cli's
// available() already has a bounded probe budget (VERSION_PROBE_MS in
// claude-cli.ts), but this one had none — a hung/unreachable ollama daemon
// left the fetch below unsettled forever, stalling pickCoachBackend (and
// therefore the whole coach surface) until something else timed out
// upstream, or never. Bounded two ways below on purpose, not just one:
// AbortController actually cancels the in-flight fetch (good citizenship,
// frees the socket), while the Promise.race is the real safety net — a
// probe that ignores its abort signal entirely (as a hung daemon or a
// misbehaving mock can) still can't keep this function from resolving,
// because the race's timeout arm settles on the clock alone.
export const OLLAMA_PROBE_MS = 3000;

// Fallback backend (F17): only reached when claude-cli reports unavailable.
// available() is a plain reachability probe — if ollama isn't running (the
// common case on this machine), it just reports false and the caller moves
// on to template-only, never throwing, and never taking longer than
// OLLAMA_PROBE_MS to say so.
export const ollamaBackend: CoachBackend = {
  name: "ollama",
  async available() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`ollama probe timed out after ${OLLAMA_PROBE_MS}ms`));
      }, OLLAMA_PROBE_MS);
    });
    try {
      const res = await Promise.race([
        fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal }),
        timeout,
      ]);
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
  async generate(prompt, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ollama http ${res.status}`);
      const data = (await res.json()) as { response?: string };
      return (data.response ?? "").trim();
    } finally {
      clearTimeout(timer);
    }
  },
};
