import { describe, it, expect } from "vitest";
import { parseViolationClass, classifyFeedbackNote } from "./game-scoreboard";

// brief-2d.md's required unit test: "a small unit test for the attempts_json
// class parser (red if the parser returns the whole string instead of the
// prefix)". RED condition, verified by reverting parseViolationClass to
// `return v` (the whole string): the first assertion below then fails,
// because the returned string still carries the " -- b1 is empty" tail
// after the colon.
describe("parseViolationClass", () => {
  it("returns only the prefix before the first colon, not the whole string", () => {
    expect(parseViolationClass("placement-claim: your rook on b1 -- b1 is empty")).toBe(
      "placement-claim"
    );
  });

  it("handles relation-claim violations the same way", () => {
    expect(parseViolationClass("relation-claim: the knight on e5 does not guard d3")).toBe(
      "relation-claim"
    );
  });

  it("does not split on a colon that appears inside the message body", () => {
    // Only the FIRST colon marks the class boundary -- a sentence with its
    // own colon later on must not shorten the class name.
    expect(
      parseViolationClass("mate-claim: forced mate in 3: knight g5, rook d1, queen h7")
    ).toBe("mate-claim");
  });

  it("returns the whole string unchanged when there is no colon at all", () => {
    expect(parseViolationClass("Qxh7")).toBe("Qxh7");
  });
});

describe("classifyFeedbackNote", () => {
  it("classes a timeout note", () => {
    expect(classifyFeedbackNote("timed out")).toBe("timeout");
  });

  it("classes an accuracy note", () => {
    expect(classifyFeedbackNote("Incorrectly told me the knight defends d3")).toBe("accuracy");
  });

  it("falls back to other for an unmatched note", () => {
    expect(classifyFeedbackNote("See my next message.")).toBe("other");
  });
});
