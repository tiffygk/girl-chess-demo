import { describe, it, expect } from "vitest";
import {
  parseViolationClass,
  classifyFeedbackNote,
  aggregateRoute,
  formatUncheckedCell,
  formatThinkingCell,
  formatNotesCell,
  type AdviceTraceRow,
} from "./game-scoreboard";

// Fix-round fixture helper (reviewer findings 1-3, 2026-09-22): a minimal
// AdviceTraceRow with sane defaults, overridable per test.
function row(overrides: Partial<AdviceTraceRow> = {}): AdviceTraceRow {
  return {
    id: 1,
    game_id: 200,
    ply: 1,
    kind: "chat",
    source: "model",
    regen_count: 0,
    rating: null,
    feedback_text: null,
    attempts_json: null,
    thinking_pref: null,
    coverage_json: null,
    ...overrides,
  };
}

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

// Reviewer finding 1 (2026-09-22): "regens" must count regeneration CALLS
// (sum of regen_count), not rows that regenerated at least once. RED
// condition, verified by reverting the fix (`if (row.regen_count > 0)
// agg.regens++`): this test then reports regens = 1, not 2.
describe("aggregateRoute -- regens (reviewer finding 1)", () => {
  it("sums regen_count across rows, not just counts rows with regen_count > 0", () => {
    const agg = aggregateRoute([row({ regen_count: 2 })]);
    expect(agg.regens).toBe(2);
  });

  it("sums across multiple rows", () => {
    const agg = aggregateRoute([row({ regen_count: 2 }), row({ regen_count: 1 }), row({ regen_count: 0 })]);
    expect(agg.regens).toBe(3);
  });
});

// Reviewer finding 2 (2026-09-22): a route with SOME rows carrying
// coverage_json and some null must print the partial form, not a bare sum
// that reads as a total. RED condition, verified by reverting
// formatUncheckedCell to the old bare-number formatting: this test then
// expects "3 (recorded on 1 of 2 rows)" but gets "3".
describe("formatUncheckedCell -- partial coverage (reviewer finding 2)", () => {
  it("renders the partial form when some rows have coverage_json and some do not", () => {
    const agg = aggregateRoute([
      row({ coverage_json: JSON.stringify({ unchecked: ["a", "b", "c"] }) }),
      row({ coverage_json: null }),
    ]);
    expect(formatUncheckedCell(agg)).toBe("3 (recorded on 1 of 2 rows)");
  });

  it("stays a plain number when every row has coverage_json", () => {
    const agg = aggregateRoute([
      row({ coverage_json: JSON.stringify({ unchecked: ["a"] }) }),
      row({ coverage_json: JSON.stringify({ unchecked: [] }) }),
    ]);
    expect(formatUncheckedCell(agg)).toBe("1");
  });

  it("stays 'not recorded' when every row has no coverage_json", () => {
    const agg = aggregateRoute([row({ coverage_json: null }), row({ coverage_json: null })]);
    expect(formatUncheckedCell(agg)).toBe("not recorded");
  });

  it("stays 'not recorded' when the route has no rows at all", () => {
    const agg = aggregateRoute([]);
    expect(formatUncheckedCell(agg)).toBe("not recorded");
  });
});

describe("formatThinkingCell -- partial thinking_pref (reviewer finding 2, same rule)", () => {
  it("renders the partial form when some rows have thinking_pref and some do not", () => {
    const agg = aggregateRoute([row({ thinking_pref: "low" }), row({ thinking_pref: null })]);
    expect(formatThinkingCell(agg)).toBe("low=1 (recorded on 1 of 2 rows)");
  });

  it("stays plain class counts when every row has thinking_pref", () => {
    const agg = aggregateRoute([row({ thinking_pref: "low" }), row({ thinking_pref: "default" })]);
    expect(formatThinkingCell(agg)).toBe("low=1, default=1");
  });

  it("stays 'not recorded' when every row has no thinking_pref", () => {
    const agg = aggregateRoute([row({ thinking_pref: null }), row({ thinking_pref: null })]);
    expect(formatThinkingCell(agg)).toBe("not recorded");
  });
});

// Reviewer finding 3 (2026-09-22): the baseline row must print thumbs-down
// class counts only (never the raw notes -- thousands of characters);
// per-game rows may print raw notes but each truncated to 80 characters.
// RED condition, verified by reverting formatNotesCell to always print
// full raw text regardless of mode: the baseline-mode assertion then finds
// the full sentence in the output instead of just the class count, and the
// game-mode assertion finds a note longer than 80 characters.
describe("formatNotesCell -- baseline class-counts vs per-game truncation (reviewer finding 3)", () => {
  const longNote =
    "this is a very long thumbs-down note that goes on and on and on well past eighty characters, describing at length exactly what went wrong with the coach's reply in this particular case";

  it("baseline mode prints class counts only, never the raw text", () => {
    const notes = [
      { cls: "accuracy", text: longNote },
      { cls: "accuracy", text: "incorrect again" },
      { cls: "timeout", text: "timed out" },
    ];
    const rendered = formatNotesCell(notes, "baseline");
    expect(rendered).toBe("accuracy=2, timeout=1");
    expect(rendered).not.toContain(longNote);
  });

  it("game mode truncates each raw note to 80 characters", () => {
    const notes = [{ cls: "accuracy", text: longNote }];
    const rendered = formatNotesCell(notes, "game");
    expect(rendered).toContain("accuracy:");
    // The quoted note body itself (between the quote marks) must be <= 80 chars.
    const match = rendered.match(/"([^"]*)"/);
    expect(match).not.toBeNull();
    expect((match as RegExpMatchArray)[1].length).toBeLessThanOrEqual(80);
  });

  it("game mode leaves a short note untouched", () => {
    const notes = [{ cls: "timeout", text: "timed out" }];
    expect(formatNotesCell(notes, "game")).toBe('timeout: "timed out"');
  });
});
