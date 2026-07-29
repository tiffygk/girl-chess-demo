// Unit tests for tools/truth-check.ts's own pure data-plumbing helpers --
// reconstructPvLine (mirrors manager.ts's private pvLine) and
// toTurningPoint (raw sqlite row -> the client TurningPoint shape). These
// are NOT tests of the counterfactual-suppression fix itself (that's
// src/review/followedBest.test.ts / turningPointNote.test.ts's job, and
// this file imports rather than reimplements that logic) -- just of the
// plumbing this gate assembles TurningLine/TurningPoint objects with.
// Deliberately does not import `main` and touches no db: importing this
// module never runs main() as a side effect (guarded by the isMain check
// at the bottom of truth-check.ts).
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { reconstructPvLine, toTurningPoint, type RawTurningPointRow } from "./truth-check";

describe("reconstructPvLine", () => {
  it("replays a space-separated UCI pv into SANs from the given fen", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: "e2e4", pv: "e2e4 e7e5 g1f3" });
    expect(result.pvSans).toEqual(["e4", "e5", "Nf3"]);
    expect(result.bestSan).toBe("e4");
    expect(result.bestFromTo).toEqual({ from: "e2", to: "e4" });
  });

  it("falls back to a lone bestMove when pv is absent", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: "e2e4", pv: null });
    expect(result.pvSans).toEqual(["e4"]);
    expect(result.bestSan).toBe("e4");
  });

  it("stops at the first illegal/malformed step rather than throwing", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: null, pv: "e2e4 z9z9 g1f3" });
    expect(result.pvSans).toEqual(["e4"]);
  });

  it("returns an empty pv when no eval row is available", () => {
    const start = new Chess().fen();
    expect(reconstructPvLine(start, undefined)).toEqual({ pvSans: [] });
  });

  it("returns an empty pv when both pv and bestMove are absent", () => {
    const start = new Chess().fen();
    expect(reconstructPvLine(start, { bestMove: null, pv: "" })).toEqual({ pvSans: [] });
  });
});

describe("toTurningPoint", () => {
  it("maps snake_case sqlite columns to the camelCase TurningPoint shape", () => {
    const row: RawTurningPointRow = {
      rank: 1,
      ply: 20,
      san: "Rg8",
      label: "opponent mistake",
      punish_san: "Qf6#",
      delta_p: 0.4,
      low_confidence: 0,
      kind: "swing",
      ply_end: null,
      missed_punish: 0,
      crossed_advantage: 1,
      end_kind: null,
    };
    expect(toTurningPoint(row)).toEqual({
      rank: 1,
      ply: 20,
      san: "Rg8",
      label: "opponent mistake",
      punishSan: "Qf6#",
      deltaP: 0.4,
      lowConfidence: false,
      kind: "swing",
      missedPunish: false,
      plyEnd: undefined,
      crossedAdvantage: true,
    });
  });

  it("maps NULL punish_san/ply_end to undefined, never null or a fabricated value", () => {
    const row: RawTurningPointRow = {
      rank: 2,
      ply: 5,
      san: "Nf3",
      label: "blunder",
      punish_san: null,
      delta_p: -0.3,
      low_confidence: 1,
      kind: "backfill",
      ply_end: null,
      missed_punish: null,
      crossed_advantage: null,
      end_kind: null,
    };
    const tp = toTurningPoint(row);
    expect(tp.punishSan).toBeUndefined();
    expect(tp.plyEnd).toBeUndefined();
    expect(tp.missedPunish).toBeUndefined();
    expect(tp.crossedAdvantage).toBeUndefined();
    expect(tp.lowConfidence).toBe(true);
  });
});
