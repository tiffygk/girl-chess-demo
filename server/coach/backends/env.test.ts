import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMeteredKeyWarningForTesting, subscriptionOnlyEnv } from "./env";

describe("subscriptionOnlyEnv", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => resetMeteredKeyWarningForTesting());
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
    vi.restoreAllMocks();
  });

  it("strips ANTHROPIC_API_KEY and keeps everything else", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = subscriptionOnlyEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test-not-real"); // never mutates the parent env
  });

  it("warns once, not per call, when a key is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    subscriptionOnlyEnv();
    subscriptionOnlyEnv();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/ANTHROPIC_API_KEY/);
    expect(warn.mock.calls[0][0]).not.toContain("sk-test");
  });

  it("stays silent when no key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    subscriptionOnlyEnv();
    expect(warn).not.toHaveBeenCalled();
  });
});
