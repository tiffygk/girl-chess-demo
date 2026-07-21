import { describe, it, expect, vi, afterEach } from "vitest";
import { ollamaBackend, OLLAMA_PROBE_MS } from "./ollama";

// Task 8 (inc 3.95, Fix 3): available() used to run an unbounded fetch --
// claude-cli's available() already had a bounded probe budget
// (VERSION_PROBE_MS in claude-cli.ts), but this one had none, so a hung or
// unreachable ollama daemon left the fetch below unsettled forever, stalling
// pickCoachBackend (manager.ts) and therefore the whole coach surface. These
// tests stub global.fetch (the real ollama daemon is never invoked, per the
// no-live-network-calls-in-tests convention every other backend test file in
// this directory follows) and use vitest's fake timers to prove the probe
// now resolves within OLLAMA_PROBE_MS no matter what the transport does.
describe("ollamaBackend.available() (Fix 3, inc 3.95): bounded probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a probe that never resolves, and ignores its own abort signal, still resolves false within OLLAMA_PROBE_MS", async () => {
    vi.useFakeTimers();
    // Deliberately never settles AND never inspects `signal` -- this is what
    // proves the Promise.race timeout arm is the real safety net here, not
    // AbortController alone (a hung daemon, or a misbehaving mock like this
    // one, can ignore an abort signal entirely).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const pending = ollamaBackend.available();
    await vi.advanceTimersByTimeAsync(OLLAMA_PROBE_MS);
    await expect(pending).resolves.toBe(false);
  });

  it("a fast healthy probe still resolves true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true }))
    );
    await expect(ollamaBackend.available()).resolves.toBe(true);
  });

  it("a fast unhealthy (non-ok) probe resolves false -- unrelated to the timeout path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false }))
    );
    await expect(ollamaBackend.available()).resolves.toBe(false);
  });
});
