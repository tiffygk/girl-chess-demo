import { describe, it, expect } from "vitest";
import { renderDossier, type AdviceTraceRow, type DossierContext } from "./dossier";

// A3 (live-telemetry round, 2026-09-22): renderDossier is a pure function
// (no db) so it can be exercised on a synthetic row -- the thin main()
// (db read + print) is not itself unit tested here, same discipline every
// other tools/*.ts in this repo already uses for its rendering half.
// RED condition (verify by reverting): drop the `currentFen`, `thinking`,
// `coverage`, or `rejected attempts` section from renderDossier's template
// and the corresponding assertion below fails because its expected
// substring no longer appears anywhere in the rendered string.
function baseRow(overrides: Partial<AdviceTraceRow> = {}): AdviceTraceRow {
  return {
    id: 42,
    game_id: 7,
    ply: 15,
    kind: "chat",
    facts_json: JSON.stringify({ currentFen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", toMove: "you" }),
    prompt: "p",
    output: "the pawn on c7 attacks d6.",
    source: "model",
    backend: "agent-sdk",
    validated: 1,
    regen_count: 1,
    latency_ms: 4200,
    created_at: "2026-09-21T00:00:00Z",
    rating: null,
    feedback_text: null,
    cause: null,
    backfilled_at: null,
    attempts_json: JSON.stringify([
      { output: "bad first draft", violations: ["placement-claim: your rook on a1 -- not there"], validated: false, thinking: "low" },
    ]),
    thinking_pref: "low",
    coverage_json: JSON.stringify({ sentences: 1, boardSentences: 1, checked: 1, unchecked: [], byClass: { "relation-claim": 1 } }),
    ...overrides,
  };
}

describe("renderDossier (A3)", () => {
  it("includes the game/ply, side to move, final text, thinking pref, coverage, rejected attempts, and position", () => {
    const text = renderDossier(baseRow(), {});
    expect(text).toContain("game 7");
    expect(text).toContain("ply 15");
    expect(text).toContain("you"); // side to move
    expect(text).toContain("the pawn on c7 attacks d6."); // final text
    expect(text).toContain("low"); // thinking pref
    expect(text).toContain("board-relevant: 1"); // coverage
    expect(text).toContain("bad first draft"); // rejected attempt
    expect(text).toContain("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"); // position
  });

  it("falls back to ctx.fenAfter when facts_json has no currentFen", () => {
    const row = baseRow({ facts_json: JSON.stringify({ toMove: "you" }) });
    const ctx: DossierContext = { fenAfter: "8/8/8/8/8/8/8/8 w - - 0 1" };
    expect(renderDossier(row, ctx)).toContain("8/8/8/8/8/8/8/8 w - - 0 1");
  });

  it("never reads facts_json.fen -- that key does not exist on ChatFactList/CoachFactList", () => {
    // A row with a bogus `fen` key (not `currentFen`) and no ctx fallback:
    // the dossier must render as unknown, not silently pick up the wrong
    // key.
    const row = baseRow({ facts_json: JSON.stringify({ fen: "bogus", toMove: "you" }) });
    const text = renderDossier(row, {});
    expect(text).not.toContain("bogus");
  });

  it("reports no rejected attempts when attempts_json is null", () => {
    const row = baseRow({ attempts_json: null });
    const text = renderDossier(row, {});
    expect(text.toLowerCase()).toContain("no rejected attempts");
  });

  it("reports thinking pref as unrecorded when NULL", () => {
    const row = baseRow({ thinking_pref: null });
    const text = renderDossier(row, {});
    expect(text.toLowerCase()).toContain("unrecorded");
  });

  it("reports coverage as unrecorded when coverage_json is null", () => {
    const row = baseRow({ coverage_json: null });
    const text = renderDossier(row, {});
    expect(text.toLowerCase()).toContain("unrecorded");
  });
});
