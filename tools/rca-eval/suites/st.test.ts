import { describe, it, expect } from "vitest";
import { runStSuite } from "./st";

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
