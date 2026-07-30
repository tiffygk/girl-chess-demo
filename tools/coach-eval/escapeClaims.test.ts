import { describe, it, expect } from "vitest";
import { detectEscapeClaims, splitClauses, ESCAPE_CLAIM_PATTERNS, KNOWN_BAD_ESCAPE_CLAIM } from "./escapeClaims";

describe("splitClauses", () => {
  it("splits on sentence terminators", () => {
    expect(splitClauses("First sentence. Second sentence! Third?")).toEqual(["First sentence.", "Second sentence!", "Third?"]);
  });

  it("splits a comma-joined clause on a coordinating conjunction", () => {
    expect(splitClauses("You lose the knight, but you can avoid the bishop trade.")).toEqual([
      "You lose the knight",
      "but you can avoid the bishop trade.",
    ]);
  });

  it("does not split an ordinary comma with no conjunction following", () => {
    expect(splitClauses("Move the rook, knight, or bishop.")).toEqual(["Move the rook, knight, or bishop."]);
  });
});

describe("detectEscapeClaims (candidate-flagging accelerant, never the verdict)", () => {
  it("flags the committed known-bad escape claim (prove-red-at-startup fixture)", () => {
    const flags = detectEscapeClaims(KNOWN_BAD_ESCAPE_CLAIM);
    expect(flags.length).toBeGreaterThan(0);
  });

  it("flags each pattern in isolation", () => {
    for (const re of ESCAPE_CLAIM_PATTERNS) {
      // Build a minimal sentence containing a literal match for the pattern.
      const literal = re.source.replace(/\\b/g, "").replace(/\\/g, "");
      const text = `Here is the point: ${literal} the piece.`;
      const flags = detectEscapeClaims(text);
      expect(flags.length, `pattern ${re.source} did not fire on "${text}"`).toBeGreaterThan(0);
    }
  });

  it("does not flag an honest 'you lose material no matter what' answer", () => {
    const honestText = "Every move here loses at least a pawn -- there's no way to keep everything safe, so pick the smallest loss.";
    expect(detectEscapeClaims(honestText)).toEqual([]);
  });

  it("attributes a flag to the SPECIFIC clause it fired on, not the whole answer", () => {
    const text = "You will lose the pawn here. However, you can avoid losing the bishop by retreating it now.";
    const flags = detectEscapeClaims(text);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => /avoid losing the bishop/.test(f.clause))).toBe(true);
    expect(flags.every((f) => !/lose the pawn/.test(f.clause))).toBe(true);
  });

  it("RED (instrument check): a plain empty string never flags anything", () => {
    expect(detectEscapeClaims("")).toEqual([]);
  });
});
