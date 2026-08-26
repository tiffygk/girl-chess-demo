import { describe, it, expect, vi, afterEach } from "vitest";
import { ollamaBackend, OLLAMA_PROBE_MS } from "./ollama";
import { isTimeoutError } from "../index";

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

// Task 6 fix (coach-truth round, review finding 1): generate() bounds itself
// with AbortController + setTimeout(() => controller.abort(), timeoutMs)
// around a bare fetch, so an aborted call used to surface as the raw
// AbortError/DOMException ("This operation was aborted") -- a message shape
// that never contains "timed out", the literal substring isTimeoutError
// (coach/index.ts) classifies on. That let a slow-but-alive ollama get
// marked unhealthy for COACH_UNHEALTHY_COOLDOWN_MS (manager.ts) on every
// narration that ran long, pulling a working backend out of the chain.
// These tests stub global.fetch to behave like the REAL fetch does on
// abort -- reject once the passed-in signal fires, never settle on its
// own -- so the abort path under test is the one generate() actually
// drives, not a hand-written error message.
describe("ollamaBackend.generate(): honest timeout message on abort (Task 6 fix, coach-truth round)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("an aborted fetch rejects with a message containing 'timed out', which isTimeoutError classifies as a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => {
              const err = new Error("This operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
      )
    );

    const timeoutMs = 5000;
    let caught: unknown;
    const pending = ollamaBackend.generate("hello", timeoutMs).catch((err) => {
      caught = err;
    });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    await pending;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("timed out");
    expect((caught as Error).message).toBe(`ollama generate timed out after ${timeoutMs}ms`);
    expect(isTimeoutError(caught)).toBe(true);
  });

  it("a non-abort failure (e.g. a bad http status) passes through unchanged -- never misclassified as a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }))
    );

    await expect(ollamaBackend.generate("hello", 5000)).rejects.toThrow("ollama http 500");
    let caught: unknown;
    try {
      await ollamaBackend.generate("hello", 5000);
    } catch (err) {
      caught = err;
    }
    expect(isTimeoutError(caught)).toBe(false);
  });
});
