import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, getAdviceTraces } from "../store/db";
import { assembleFactList, buildTemplateNarration, narrate, type CoachFactList } from "./index";
import { validateNarration } from "./validate";
import type { CoachBackend } from "./backends/types";
import type { ThreatFacts, RecommendationFacts } from "../annotator/motifs";

// Sanctioned exception to the no-mocks convention (per the brief): the
// CoachBackend interface is ours, and the real claude CLI cannot run in CI
// — every test below uses a fake implementing the interface inline, never
// the real backends/claude-cli.ts or backends/ollama.ts.
function fakeBackend(impl: {
  generate: (prompt: string, timeoutMs: number) => Promise<string>;
  name?: string;
}): CoachBackend {
  return {
    name: impl.name ?? "fake",
    async available() {
      return true;
    },
    generate: impl.generate,
  };
}

function mkFacts(): CoachFactList {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "warning",
    deltaCp: 300,
    threat: {
      motif: "capture-other",
      refutationUci: "d1d8",
      refutationSan: "Rxd8",
      refutationPieceKind: "r",
      refutationFromSquare: "d1",
      refutationToSquare: "d8",
      givesCheck: false,
      capturesSquare: "d8",
      capturedPieceKind: "r",
      capturesHerJustMovedPiece: false,
    },
    best: { san: "Nxe4", uci: "f6e4", pieceKind: "n", from: "f6", to: "e4" },
    recommendation: {
      accomplishment: "captures",
      pieceKind: "n",
      fromSquare: "f6",
      toSquare: "e4",
      san: "Nxe4",
      capturesSquare: "e4",
      capturedPieceKind: "p",
    },
  });
}

describe("narrate", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  it("valid model output on the first try -> source model, no regen", async () => {
    const facts = mkFacts();
    const backend = fakeBackend({
      async generate() {
        return "your rook hangs on d8, and Rxd8 just takes it. Nxe4 wins a pawn back instead.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(result.source).toBe("model");
    expect(result.traceMeta.regenCount).toBe(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("invalid first output, valid second -> source model, regen_count 1", async () => {
    const facts = mkFacts();
    let calls = 0;
    const backend = fakeBackend({
      async generate() {
        calls += 1;
        if (calls === 1) return "watch out for the threat on e5, totally made up.";
        return "Rxd8 takes back, but Nxe4 wins the pawn instead.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(calls).toBe(2);
    expect(result.source).toBe("model");
    expect(result.traceMeta.regenCount).toBe(1);
  });

  it("both attempts invalid -> source template, and the template text passes validation against the fact list", async () => {
    const facts = mkFacts();
    const backend = fakeBackend({
      async generate() {
        return "some made-up thing happens on e5 via Bxc4.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(result.source).toBe("template");
    expect(result.traceMeta.regenCount).toBe(1);
    expect(validateNarration(result.text, facts)).toEqual({ ok: true });
  });

  it("backend throwing/timeout -> source template, no second call attempted", async () => {
    const facts = mkFacts();
    let calls = 0;
    const backend = fakeBackend({
      async generate() {
        calls += 1;
        throw new Error("boom");
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(result.source).toBe("template");
    expect(calls).toBe(1);
  });

  it("empty model output falls back to template rather than being treated as valid", async () => {
    const facts = mkFacts();
    const backend = fakeBackend({
      async generate() {
        return "   ";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(result.source).toBe("template");
  });

  it("writes exactly one advice_traces row per narrate call, model or template", async () => {
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const validBackend = fakeBackend({
      async generate() {
        return "Rxd8 takes back, but Nxe4 wins the pawn instead.";
      },
    });
    const brokenBackend = fakeBackend({
      async generate() {
        throw new Error("down");
      },
    });

    await narrate(mkFacts(), validBackend, { gameId, ply: 1, kind: "warning" });
    await narrate(mkFacts(), brokenBackend, { gameId, ply: 2, kind: "nudge" });

    const rows = getAdviceTraces(gameId);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("model");
    expect(rows[0].ply).toBe(1);
    expect(rows[0].kind).toBe("warning");
    expect(rows[1].source).toBe("template");
    expect(rows[1].backend).toBe("fake");
    expect(rows[1].facts_json).toBeTruthy();
  });
});

describe("buildTemplateNarration", () => {
  const threatMotifs: { motif: ThreatFacts["motif"]; extra: Partial<ThreatFacts> }[] = [
    { motif: "capture-moved", extra: { capturesSquare: "d8", capturedPieceKind: "n" } },
    { motif: "capture-other", extra: { capturesSquare: "d8", capturedPieceKind: "r" } },
    { motif: "fork", extra: { forkTargets: [{ square: "b8", pieceKind: "r" }, { square: "d8", pieceKind: "r" }] } },
    { motif: "mate-threat", extra: {} },
    { motif: "check-threat", extra: {} },
    { motif: "positional", extra: {} },
  ];

  const recommendationAccomplishments: { accomplishment: RecommendationFacts["accomplishment"]; extra: Partial<RecommendationFacts> }[] = [
    { accomplishment: "captures", extra: { capturesSquare: "e4", capturedPieceKind: "p" } },
    { accomplishment: "gives-check", extra: {} },
    { accomplishment: "gives-mate", extra: {} },
    { accomplishment: "forks", extra: { forkTargets: [{ square: "e1", pieceKind: "r" }, { square: "c1", pieceKind: "b" }] } },
    { accomplishment: "attacks", extra: { attackedSquare: "b7", attackedPieceKind: "r" } },
    { accomplishment: "develops", extra: {} },
  ];

  function baseThreat(motif: ThreatFacts["motif"], extra: Partial<ThreatFacts>): ThreatFacts {
    return {
      motif,
      refutationUci: "d1d8",
      refutationSan: "Rxd8",
      refutationPieceKind: "r",
      refutationFromSquare: "d1",
      refutationToSquare: "d8",
      givesCheck: false,
      capturesHerJustMovedPiece: false,
      ...extra,
    };
  }

  function baseRecommendation(accomplishment: RecommendationFacts["accomplishment"], extra: Partial<RecommendationFacts>): RecommendationFacts {
    return {
      accomplishment,
      pieceKind: "n",
      fromSquare: "f6",
      toSquare: "e4",
      san: "Nxe4",
      ...extra,
    };
  }

  it("renders every threat motif template with no unresolved placeholders", () => {
    for (const { motif, extra } of threatMotifs) {
      const facts: CoachFactList = {
        herMove: { pieceKind: "n", from: "f6", to: "g4" },
        tier: "warning",
        deltaCp: 300,
        threat: baseThreat(motif, extra),
        allowedSquares: [],
        allowedSans: [],
      };
      const text = buildTemplateNarration(facts);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("renders every recommendation accomplishment template with no unresolved placeholders", () => {
    for (const { accomplishment, extra } of recommendationAccomplishments) {
      const facts: CoachFactList = {
        herMove: { pieceKind: "n", from: "f6", to: "g4" },
        tier: "nudge",
        deltaCp: 80,
        recommendation: baseRecommendation(accomplishment, extra),
        allowedSquares: [],
        allowedSans: [],
      };
      const text = buildTemplateNarration(facts);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("falls back to a generic line when neither threat nor recommendation is present", () => {
    const facts: CoachFactList = {
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "nudge",
      deltaCp: 80,
      allowedSquares: [],
      allowedSans: [],
    };
    expect(buildTemplateNarration(facts).length).toBeGreaterThan(0);
  });
});
