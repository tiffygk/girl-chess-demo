import { describe, it, expect } from "vitest";
import { classifyCoachFailure, probeCoach } from "./probe";

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
  it("is ready when the injected probe resolves", async () => {
    const p = await probeCoach({ tryAgentSdk: async () => undefined, now: () => 5 });
    expect(p).toEqual({ state: "ready", detail: "cookie is ready to chat.", checkedAt: 5 });
  });
  it("classifies the injected probe's rejection", async () => {
    const p = await probeCoach({ tryAgentSdk: async () => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); }, now: () => 5 });
    expect(p.state).toBe("not-installed");
  });
});
