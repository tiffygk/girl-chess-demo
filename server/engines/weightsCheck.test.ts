import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { assertWeightsPresent } from "./weightsCheck";

function tmpWeights(files: Record<string, Buffer | null>): (elo: number) => string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-weights-"));
  for (const [name, content] of Object.entries(files)) {
    if (content) fs.writeFileSync(path.join(dir, name), content);
  }
  return (elo) => path.join(dir, `maia-${elo}.pb.gz`);
}

const GOOD = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.alloc(200_000, 1)]);

describe("assertWeightsPresent", () => {
  it("passes when every band has a valid weights file", () => {
    const at = tmpWeights({ "maia-1100.pb.gz": GOOD, "maia-1200.pb.gz": GOOD });
    expect(() => assertWeightsPresent([1100, 1200], at)).not.toThrow();
  });

  it("throws and names EVERY missing band, not just the first", () => {
    const at = tmpWeights({ "maia-1100.pb.gz": GOOD });
    expect(() => assertWeightsPresent([1100, 1800, 1900], at)).toThrow(/1800.*1900|1900.*1800/s);
  });

  it("names the setup command in the error so the fix is obvious", () => {
    const at = tmpWeights({});
    expect(() => assertWeightsPresent([1900], at)).toThrow(/setup\.sh/);
  });
});

describe("assertWeightsPresent: damaged files", () => {
  it("accepts files with the gzip magic and a plausible size", () => {
    const at = tmpWeights({ "maia-1100.pb.gz": GOOD, "maia-1200.pb.gz": GOOD });
    expect(() => assertWeightsPresent([1100, 1200], at)).not.toThrow();
  });

  it("names a truncated file and says to delete it and rerun setup", () => {
    const at = tmpWeights({ "maia-1100.pb.gz": GOOD, "maia-1500.pb.gz": Buffer.alloc(100, 1) });
    // The tmp dir lives outside cwd, so rel() falls back to the absolute path;
    // match on the basename plus the rest of the sentence instead of the
    // brief's literal "weights/maia-1500.pb.gz" prefix.
    expect(() => assertWeightsPresent([1100, 1500], at)).toThrow(
      /the opponent file .*maia-1500\.pb\.gz is damaged \(an interrupted download\)\. delete it and run \.\/setup\.sh again\./
    );
  });

  it("still names missing files with the setup hint", () => {
    const at = tmpWeights({ "maia-1100.pb.gz": GOOD });
    expect(() => assertWeightsPresent([1100, 1300, 1400], at)).toThrow(
      /opponent files for strength 1300, 1400 are missing\. run \.\/setup\.sh to download them\./
    );
  });
});
