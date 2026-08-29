import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, getAdviceTraces } from "../store/db";
import { assembleFactList, buildTemplateNarration, buildPrompt, getPersona, narrate, parsePersona, type CoachFactList } from "./index";
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

// Task 3 (2026-07-22, truthfulness leaks): currentFen is required on
// assembleFactList's input now -- this is a plain, unrelated start-position
// placeholder, since none of this file's tests exercise defense-claim
// checking (that's server/coach/validate.test.ts's job).
const PLACEHOLDER_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function mkFacts(): CoachFactList {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "warning",
    deltaCp: 300,
    currentFen: PLACEHOLDER_FEN,
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

  // Task 6 (game192-fixes round, RC4): the validator caught a bad draft in
  // real game 192 and the caught text was unrecoverable -- only the last
  // attempt ever landed in the row. attempts_json is the fix: one entry per
  // generation attempt, in order, so a regenerated-away draft survives.
  it("invalid first output, valid second -> row has regen_count 1 and attempts_json with 2 entries, entry 0 carrying the violations and validated:false", async () => {
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

    const row = getAdviceTraces(gameId).find((r) => r.id === result.traceId)!;
    expect(row.regen_count).toBe(1);
    expect(row.attempts_json).toBeTruthy();
    const attempts = JSON.parse(row.attempts_json);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].output).toBe("watch out for the threat on e5, totally made up.");
    expect(attempts[0].validated).toBe(false);
    expect(attempts[0].violations).toEqual(expect.arrayContaining(["e5"]));
    expect(attempts[1].output).toBe("Rxd8 takes back, but Nxe4 wins the pawn instead.");
    expect(attempts[1].validated).toBe(true);
    expect(attempts[1].violations).toEqual([]);
  });

  it("clean first attempt -> attempts_json is NULL (the row's own output IS attempt 0, nothing lost)", async () => {
    const facts = mkFacts();
    const backend = fakeBackend({
      async generate() {
        return "your rook hangs on d8, and Rxd8 just takes it. Nxe4 wins a pawn back instead.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });

    const row = getAdviceTraces(gameId).find((r) => r.id === result.traceId)!;
    expect(row.attempts_json).toBeNull();
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

  // Wave 2, item 5: narrate() takes a per-call time budget (the manager
  // threads a larger one for the agent-sdk backend, which is slower), passed
  // straight to backend.generate. Defaults to the flat NARRATE_TIMEOUT_MS
  // when omitted so every pre-this-wave caller is unchanged.
  it("threads the passed budgetMs through to backend.generate", async () => {
    const facts = mkFacts();
    let seenTimeout = -1;
    const backend = fakeBackend({
      async generate(_p, t) {
        seenTimeout = t;
        return "your rook hangs on d8, and Rxd8 just takes it.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    await narrate(facts, backend, { gameId, ply: 3, kind: "warning" }, { budgetMs: 30000 });
    expect(seenTimeout).toBe(30000);
  });

  it("defaults budgetMs to 15000 (NARRATE_TIMEOUT_MS) when no budget is passed", async () => {
    const facts = mkFacts();
    let seenTimeout = -1;
    const backend = fakeBackend({
      async generate(_p, t) {
        seenTimeout = t;
        return "your rook hangs on d8, and Rxd8 just takes it.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    await narrate(facts, backend, { gameId, ply: 3, kind: "warning" });
    expect(seenTimeout).toBe(15000);
  });

  it("result.traceId selects the exact advice_traces row this call wrote", async () => {
    const facts = mkFacts();
    const backend = fakeBackend({
      async generate() {
        return "Rxd8 takes back, but Nxe4 wins the pawn instead.";
      },
    });
    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    const result = await narrate(facts, backend, { gameId, ply: 5, kind: "warning" });

    const rows = getAdviceTraces(gameId);
    const row = rows.find((r) => r.id === result.traceId);
    expect(row).toBeDefined();
    expect(row!.prompt).toBe(result.traceMeta.prompt);
    expect(row!.output).toBe(result.traceMeta.output);
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

// The player is always "you"/"your" in the coach's output; "she"/"her" must
// only ever mean mallow (the opponent). The internal CoachFactList field
// stays named herMove (an established TS identifier, not model-facing), but
// the KEY serialized into the model's fact-list JSON must read yourMove —
// the model never sees the literal string "herMove".
describe("buildPrompt", () => {
  it("serializes the player's move under the key yourMove, never herMove", () => {
    const prompt = buildPrompt(mkFacts(), getPersona());
    expect(prompt).toContain('"yourMove"');
    expect(prompt).not.toContain('"herMove"');
  });

  // Wave 1 (verdict truth layer, item 2 -- typed mate): with no mate on the
  // board the prompt is unchanged -- the folded deltaCp still ships.
  it("without mate fields, still ships deltaCp (unchanged)", () => {
    const prompt = buildPrompt(mkFacts(), getPersona());
    expect(prompt).toContain('"deltaCp"');
    expect(prompt).toContain("300");
  });

  // Wave 1 (item 2): when a mate field is set, deltaCp is the MATE_SCORE_CP
  // fold (a lost mate-in-16 folds to 99098) -- a garbage number to hand a
  // narration model. The prompt must send the typed mate distance and OMIT
  // the folded deltaCp entirely.
  it("with a mate field set, sends the typed mate distance and omits the folded deltaCp", () => {
    const facts = assembleFactList({
      herMove: { pieceKind: "q", from: "d1", to: "d8" },
      tier: "warning",
      deltaCp: 99098, // the MATE_SCORE_CP fold for a lost mate-in-16 -- must NOT reach the model
      currentFen: PLACEHOLDER_FEN,
      mateBefore: 16,
      mateAfter: null,
    });
    const prompt = buildPrompt(facts, getPersona());
    expect(prompt).toContain('"mateBefore"');
    expect(prompt).toContain("16");
    expect(prompt).toContain('"mateAfter"');
    expect(prompt).not.toMatch(/\d{5}/); // no 5-digit folded deltaCp (99098) anywhere
    expect(prompt).not.toContain('"deltaCp"');
  });

  // Task 5 (game192 fixes, RC5): narrate is only ever called from the
  // pending-move verdict flow, so the candidate under yourMove was picked up
  // and set down -- never actually played. Real trace: game 192, trace 297
  // graded it in past tense ("pushing your own pawn to h4 was stronger")
  // because the payload carried no unplayed flag. yourMove must now carry
  // confirmed: false plus a note telling the model to speak of it in
  // present/conditional tense.
  it("marks yourMove as an unconfirmed, considered candidate, never a played move", () => {
    const prompt = buildPrompt(mkFacts(), getPersona());
    const jsonStart = prompt.indexOf("{");
    const parsed = JSON.parse(prompt.slice(jsonStart));
    expect(parsed.yourMove.confirmed).toBe(false);
    expect(parsed.yourMove.note).toBe(
      "this move is only being considered -- picked up and set down, NOT played. speak of it in present or conditional tense, never past.",
    );
  });
});

describe("buildTemplateNarration", () => {
  const threatMotifs: { motif: ThreatFacts["motif"]; extra: Partial<ThreatFacts> }[] = [
    { motif: "capture-moved", extra: { capturesSquare: "d8", capturedPieceKind: "n" } },
    { motif: "capture-other", extra: { capturesSquare: "d8", capturedPieceKind: "r" } },
    { motif: "fork", extra: { forkTargets: [{ square: "b8", pieceKind: "r" }, { square: "d8", pieceKind: "r" }] } },
    { motif: "mate-threat", extra: {} },
    { motif: "check-threat", extra: {} },
    // Wave 2, item 7: the Wave-1 tier-1 motif arms must be covered by the
    // "every threat motif template" claim below, not silently omitted.
    { motif: "promotion-threat", extra: {} },
    { motif: "positional", extra: {} },
  ];

  const recommendationAccomplishments: { accomplishment: RecommendationFacts["accomplishment"]; extra: Partial<RecommendationFacts> }[] = [
    { accomplishment: "captures", extra: { capturesSquare: "e4", capturedPieceKind: "p" } },
    { accomplishment: "gives-check", extra: {} },
    { accomplishment: "gives-mate", extra: {} },
    { accomplishment: "forks", extra: { forkTargets: [{ square: "e1", pieceKind: "r" }, { square: "c1", pieceKind: "b" }] } },
    { accomplishment: "attacks", extra: { attackedSquare: "b7", attackedPieceKind: "r" } },
    // Wave 2, item 7: the Wave-1 tier-1 accomplishment arms, same reason.
    { accomplishment: "promotes", extra: {} },
    { accomplishment: "castles", extra: {} },
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

  // Wave 2, item 7: the generic "nothing extra to flag" line buildTemplateNarration
  // returns when no template matched -- asserting against it is what makes a
  // MISSING coach.md arm turn this test red (without it, a threat/recommendation
  // with no arm silently degrades to this line and the "every" claim passes
  // over a gap, which is exactly what let promotion-threat/promotes/castles go
  // uncovered).
  const GENERIC_FALLBACK = "nothing extra to flag this time, just keep playing your plan.";

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
      // The motif's OWN arm rendered, not the no-template fallback.
      expect(text, `threat motif "${motif}" has no coach.md arm`).not.toBe(GENERIC_FALLBACK);
    }
  });

  // Task 5 (game192 fixes, RC5): the capture-moved template used to say
  // "she can take the piece you just moved, right back on {capturesSquare}"
  // -- past tense about a candidate that was only picked up and set down,
  // never played. It must speak conditionally about what happens IF the
  // player plays it.
  it("capture-moved template speaks conditionally about a candidate that hasn't been played", () => {
    const facts: CoachFactList = {
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "warning",
      deltaCp: 300,
      threat: baseThreat("capture-moved", { capturesSquare: "d8", capturedPieceKind: "n" }),
      allowedSquares: [],
      allowedSans: [],
    };
    const text = buildTemplateNarration(facts);
    expect(text).toBe("if you play this, she can take that piece right back on d8.");
    expect(text).not.toContain("you just moved");
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
      // The accomplishment's OWN arm rendered, not the no-template fallback.
      expect(text, `recommendation "${accomplishment}" has no coach.md arm`).not.toBe(GENERIC_FALLBACK);
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

  // F2 (increment 3a review fast-follow): personas/coach.md's templates and
  // index.ts's vars assembly used to interpolate raw chess.js piece-kind
  // letters ("the r on d8", "the p on e4") straight into prose. A kid
  // learning chess shouldn't have to decode "r" as rook — every piece-kind
  // placeholder must render the word.
  it("renders piece-kind placeholders as words, never bare single letters", () => {
    const threatText = buildTemplateNarration({
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "warning",
      deltaCp: 300,
      threat: baseThreat("capture-other", { capturesSquare: "d8", capturedPieceKind: "r" }),
      allowedSquares: [],
      allowedSans: [],
    });
    expect(threatText).toContain("rook");
    expect(threatText).not.toMatch(/\bthe r\b/i);

    const capturesText = buildTemplateNarration({
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "nudge",
      deltaCp: 80,
      recommendation: baseRecommendation("captures", { capturesSquare: "e4", capturedPieceKind: "p" }),
      allowedSquares: [],
      allowedSans: [],
    });
    expect(capturesText).toContain("pawn");
    expect(capturesText).not.toMatch(/\bthe p\b/i);

    const attacksText = buildTemplateNarration({
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "nudge",
      deltaCp: 80,
      recommendation: baseRecommendation("attacks", { attackedSquare: "b7", attackedPieceKind: "q" }),
      allowedSquares: [],
      allowedSans: [],
    });
    expect(attacksText).toContain("queen");
    expect(attacksText).not.toMatch(/\bthe q\b/i);
  });
});

// F4 (increment 3a review fast-follow): assembleFactList folded best.san
// into allowedSans but not recommendation.san, even though
// recommendationVars renders the template placeholder {bestSan} FROM
// recommendation.san (not best.san — the two facts are assembled
// separately but share that variable name). A game state can carry a
// recommendation with no best move at all (e.g. "attacks"/"develops"
// accomplishments never need a capture-derived best), so the omission was
// a real gap: the template's own output would fail its own validation.
describe("assembleFactList — recommendation.san allow-listing (F4)", () => {
  it("folds recommendation.san into allowedSans even when best is absent", () => {
    const facts = assembleFactList({
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "nudge",
      deltaCp: 80,
      currentFen: PLACEHOLDER_FEN,
      recommendation: {
        accomplishment: "attacks",
        pieceKind: "b",
        fromSquare: "c1",
        toSquare: "g5",
        san: "Bg5",
        attackedSquare: "d8",
        attackedPieceKind: "q",
      },
    });
    expect(facts.best).toBeUndefined();
    expect(facts.allowedSans).toContain("Bg5");

    // R2 Task 2 (2026-07-22 voice rewrite): templates no longer print raw
    // SAN (owner ruling -- plain language only), so the old
    // `expect(text).toContain("Bg5")` proof is gone by design. The F4
    // property itself is the allowedSans fold asserted above; the template
    // output must still validate against its own fact list.
    const text = buildTemplateNarration(facts);
    expect(text).toContain("d8");
    expect(validateNarration(text, facts)).toEqual({ ok: true });
  });
});

// Task 3c (R2, voice-enforcement round, 2026-07-22): the persona rewrite's
// plain-language templates need to name WHICH piece refutes/recommends a
// move, not just the square -- e.g. "her rook takes back on d8" instead of
// "she takes back on d8". The facts already carry the piece kind
// (ThreatFacts.refutationPieceKind, RecommendationFacts.pieceKind/toSquare)
// -- this threads them into threatVars/recommendationVars so a template
// using {refutationPieceKind}/{bestPieceKind}/{bestToSquare} renders. A
// custom persona built via parsePersona (not the real coach.md) isolates
// the vars-threading from whatever the real templates currently say.
describe("threatVars/recommendationVars — plain-language piece-kind/square placeholders (Task 3c)", () => {
  const CUSTOM_PERSONA_MD = [
    "## templates",
    "",
    "### threat",
    "",
    "- capture-other: her {refutationPieceKind} takes back on {capturesSquare}.",
    "",
    "### recommendation",
    "",
    "- captures: grab it with your {bestPieceKind} to {bestToSquare}.",
    "",
  ].join("\n");

  it("a threat template using {refutationPieceKind} renders the piece kind as a word", () => {
    const persona = parsePersona(CUSTOM_PERSONA_MD);
    const facts: CoachFactList = {
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
      allowedSquares: [],
      allowedSans: [],
    };
    const text = buildTemplateNarration(facts, persona);
    expect(text).toContain("rook");
    expect(text).not.toMatch(/[{}]/);
  });

  it("a recommendation template using {bestPieceKind} and {bestToSquare} renders the piece kind and destination square", () => {
    const persona = parsePersona(CUSTOM_PERSONA_MD);
    const facts: CoachFactList = {
      herMove: { pieceKind: "n", from: "f6", to: "g4" },
      tier: "nudge",
      deltaCp: 80,
      recommendation: {
        accomplishment: "captures",
        pieceKind: "n",
        fromSquare: "f6",
        toSquare: "e4",
        san: "Nxe4",
        capturesSquare: "e4",
        capturedPieceKind: "p",
      },
      allowedSquares: [],
      allowedSans: [],
    };
    const text = buildTemplateNarration(facts, persona);
    expect(text).toContain("knight");
    expect(text).toContain("e4");
    expect(text).not.toMatch(/[{}]/);
  });
});
