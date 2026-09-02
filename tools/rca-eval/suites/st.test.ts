import { describe, it, expect } from "vitest";
import { runStSuite, evaluateStreamConsistency } from "./st";

describe("runStSuite (template-path evals run for real, zero model calls)", () => {
  it("asserts its own denominator: 4 evals", async () => {
    const result = await runStSuite(false);
    expect(result.suite).toBe("ST");
    expect(result.expectedCount).toBe(4);
    expect(result.results.length).toBe(4);
  });

  it("ST-01 (template variant) passes: the done frame's envelope matches the JSON route's", async () => {
    const result = await runStSuite(false);
    const st01 = result.results.find((r) => r.id === "ST-01")!;
    expect(st01.verdict).toBe("pass");
  });

  it("ST-02 is did-not-run without --live (model-dependent, gated)", async () => {
    const result = await runStSuite(false);
    const st02 = result.results.find((r) => r.id === "ST-02")!;
    expect(st02.verdict).toBe("did-not-run");
  });

  it("ST-03 passes: a forced-template turn over the stream yields exactly one done frame with source=template and a cause", async () => {
    const result = await runStSuite(false);
    const st03 = result.results.find((r) => r.id === "ST-03")!;
    expect(st03.verdict).toBe("pass");
  });

  it("ST-04 passes: a missing game id yields exactly one error frame, no hang", async () => {
    const result = await runStSuite(false);
    const st04 = result.results.find((r) => r.id === "ST-04")!;
    expect(st04.verdict).toBe("pass");
  });
});

describe("evaluateStreamConsistency (ST-02's pass condition, the arm the probe caught reporting pass over a real failure)", () => {
  it("a template-fallback done frame yields did-not-run, naming the cause -- there is no model answer to compare against", () => {
    const result = evaluateStreamConsistency([], { ok: true, text: "i couldn't get that one clean. ask me again and i'll come at it from a different angle.", source: "template", cause: "validation-failed" });
    expect(result.verdict).toBe("did-not-run");
    expect(result.detail).toContain("template");
    expect(result.detail).toContain("validation-failed");
  });

  it("a model-source done frame with zero deltas yields red -- a validated model answer arrived but the stream was lost", () => {
    const result = evaluateStreamConsistency([], { ok: true, text: "play knight to f3.", source: "model" });
    expect(result.verdict).toBe("red");
    expect(result.detail).toContain("zero delta");
  });

  it("a model-source frame whose deltas concatenate to the done text yields pass", () => {
    const result = evaluateStreamConsistency(["play knight ", "to f3."], { ok: true, text: "play knight to f3.", source: "model" });
    expect(result.verdict).toBe("pass");
  });

  it("a model-source frame whose deltas do NOT concatenate to the done text yields red", () => {
    const result = evaluateStreamConsistency(["play knight ", "to e4."], { ok: true, text: "play knight to f3.", source: "model" });
    expect(result.verdict).toBe("red");
    expect(result.detail).toContain("DO NOT equal");
  });
});
