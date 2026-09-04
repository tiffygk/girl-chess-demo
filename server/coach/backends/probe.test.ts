import { describe, it, expect } from "vitest";
import { classifyCoachFailure, probeCoach, coachStatus, COACH_SENTENCES } from "./probe";

describe("classifyCoachFailure", () => {
  it("a missing executable is not-installed", () => {
    expect(classifyCoachFailure(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })).state).toBe("not-installed");
    expect(classifyCoachFailure(new Error("Claude Code executable not found at /nonexistent/claude")).state).toBe("not-installed");
  });
  it("a login problem is not-signed-in", () => {
    expect(classifyCoachFailure(new Error("Not logged in. Please run /login")).state).toBe("not-signed-in");
    expect(classifyCoachFailure(new Error("authentication_error: invalid x-api-key")).state).toBe("not-signed-in");
  });
  it("anything else is down", () => {
    expect(classifyCoachFailure(new Error("agent-sdk probe timed out after 5000ms")).state).toBe("down");
    expect(classifyCoachFailure(new Error("ECONNRESET")).state).toBe("down");
  });
  it("every state carries a sentence that says what to do", () => {
    for (const e of [Object.assign(new Error("x"), { code: "ENOENT" }), new Error("Not logged in. Please run /login"), new Error("boom")]) {
      const c = classifyCoachFailure(e);
      expect(c.detail).toMatch(/you can still play/);
      expect(c.detail).not.toMatch(/\u2014/);
    }
  });
});

describe("probeCoach", () => {
  it("is ready when the injected auth probe reports loggedIn: true", async () => {
    const p = await probeCoach({ tryAuth: async () => ({ loggedIn: true }), now: () => 5 });
    expect(p).toEqual({ state: "ready", detail: "cookie is ready to chat.", checkedAt: 5 });
  });
  it("is not-signed-in when the injected auth probe reports loggedIn: false", async () => {
    const p = await probeCoach({ tryAuth: async () => ({ loggedIn: false }), now: () => 5 });
    expect(p).toEqual({ state: "not-signed-in", detail: COACH_SENTENCES["not-signed-in"], checkedAt: 5 });
  });
  it("classifies the injected probe's rejection", async () => {
    const p = await probeCoach({ tryAuth: async () => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); }, now: () => 5 });
    expect(p.state).toBe("not-installed");
  });
});

describe("coachStatus caching", () => {
  it("caches a non-ready result for a shorter TTL than ready, so a fresh sign-in is not stuck behind the ready cache window", async () => {
    let calls = 0;
    const tryAuth = async () => {
      calls++;
      return { loggedIn: false };
    };
    let clock = 0;
    const now = () => clock;
    const first = await coachStatus(undefined, { tryAuth, now });
    expect(first.state).toBe("not-signed-in");
    expect(calls).toBe(1);
    // still inside the short non-ready TTL: cache hit, no new call
    clock = 5_000;
    const second = await coachStatus(undefined, { tryAuth, now });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    // past the short non-ready TTL: re-probes
    clock = 15_000;
    await coachStatus(undefined, { tryAuth, now });
    expect(calls).toBe(2);
  });
});
