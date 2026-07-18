import type { CoachBackend } from "./types";

// Owner-calibratable starting value: swap for whatever model she's pulled
// locally. No new npm deps — Node 20+ ships a global fetch.
export const OLLAMA_MODEL = "llama3.2";
const OLLAMA_BASE_URL = "http://localhost:11434";

// Fallback backend (F17): only reached when claude-cli reports unavailable.
// available() is a plain reachability probe — if ollama isn't running (the
// common case on this machine), it just reports false and the caller moves
// on to template-only, never throwing.
export const ollamaBackend: CoachBackend = {
  name: "ollama",
  async available() {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      return res.ok;
    } catch {
      return false;
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
