import { describe, it, expect } from "vitest";
import { assertWeightsPresent } from "./weightsCheck";

describe("assertWeightsPresent", () => {
  it("passes when every band has a weights file", () => {
    const present = new Set(["/w/maia-1100.pb.gz", "/w/maia-1200.pb.gz"]);
    expect(() =>
      assertWeightsPresent([1100, 1200], (elo) => `/w/maia-${elo}.pb.gz`, (p) => present.has(p))
    ).not.toThrow();
  });

  it("throws and names EVERY missing band, not just the first", () => {
    const present = new Set(["/w/maia-1100.pb.gz"]);
    expect(() =>
      assertWeightsPresent([1100, 1800, 1900], (elo) => `/w/maia-${elo}.pb.gz`, (p) => present.has(p))
    ).toThrow(/1800.*1900|1900.*1800/s);
  });

  it("names the setup command in the error so the fix is obvious", () => {
    expect(() =>
      assertWeightsPresent([1900], (elo) => `/w/maia-${elo}.pb.gz`, () => false)
    ).toThrow(/setup\.sh/);
  });
});
