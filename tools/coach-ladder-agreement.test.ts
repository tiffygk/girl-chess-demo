// tools/coach-ladder-agreement.test.ts
//
// Pass 1 red proof (kept, still true of the current code): the "same
// game, different fen" test below was run once with findLadderFacts's
// `detail.fen !== chatFen` guard temporarily deleted -- confirmed FAIL (the
// different-fen hint_compute event was wrongly treated as the ladder fact
// for this chat row) -- then restored to PASS.
//
// Pass 2 red proof (item 1, sentence-bounded extraction): the
// "colon is not a sentence boundary" test below was run once with
// splitSentences's regex changed to `/[.:]\s+/` (treating ": " as a
// boundary too) -- confirmed FAIL (the sentence was wrongly split in two)
// -- then restored to PASS. Pasted output in this wave's report.
import { describe, it, expect } from "vitest";
import { openDb, createSession, createGame, insertAdviceTrace, logGameEvent, insertVerdict } from "../server/store/db";
import {
  analyze,
  classifyRow,
  splitSentences,
  sentenceRecommends,
  factPresenceTotals,
  bucketByGuard,
  SPLIT_DATE,
  type LadderFact,
} from "./coach-ladder-agreement";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Every test gets its own fresh :memory: db (openDb's module-level `db`
// singleton, per server/store/db.ts) and its own game -- openDb returns
// the handle directly, which is what analyze() is given (never a readonly
// re-open of the same :memory: db, which would see nothing: better-
// sqlite3's :memory: connections are private per connection).
function freshGame(): { db: ReturnType<typeof openDb>; gameId: number } {
  const db = openDb(":memory:");
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1500", "w");
  return { db, gameId };
}

describe("splitSentences (unit, no db)", () => {
  it("splits on '. ' but never on ': '", () => {
    expect(splitSentences("the move is: h4. that's clear.")).toEqual(["the move is: h4", "that's clear."]);
  });
});

describe("sentenceRecommends (unit, no db)", () => {
  it("is true for a sentence-initial imperative 'play', false for a mid-sentence descriptive 'play'", () => {
    expect(sentenceRecommends("play h4 now")).toBe(true);
    expect(sentenceRecommends("if you play it, mallow can push her pawn")).toBe(false);
  });
});

describe("bucketByGuard (unit, no db)", () => {
  // Controller correction (2026-09-08): guard commit da3be2d landed
  // 2026-08-28T23:21 PDT = 2026-08-29 06:21 UTC, the same timezone every
  // stored created_at uses. A bare "2026-08-28" date-only split (the old
  // constant) put the whole game-192 cluster (2026-08-29 04:54-05:05 UTC,
  // over an hour BEFORE the guard) on the wrong side of the split.
  it("puts a row at 2026-08-29 05:05:00 UTC (before the guard's 06:21) in the pre bucket", () => {
    expect(bucketByGuard("2026-08-29 05:05:00")).toBe("pre");
  });

  it("puts a row at 2026-08-29 06:21:00 UTC (the guard's own minute) in the post bucket", () => {
    expect(bucketByGuard("2026-08-29 06:21:00")).toBe("post");
  });

  it("SPLIT_DATE is the guard's UTC timestamp, not a bare date", () => {
    expect(SPLIT_DATE).toBe("2026-08-29 06:21");
  });
});

describe("coach-ladder-agreement: analyze()", () => {
  it("classifies disagree-best when a sentence recommends a LEGAL move, at chatFen, different from the ladder's hint_compute best, and never mentions that best", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "e4 is the better first move here.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("disagree-best");
    expect(record.ladderBest?.bestSan).toBe("h4");
    expect(record.recommendsOther).toBe(true);
    expect(record.mentionsLadderBest).toBe(false);
  });

  it("classifies agree when the reply mentions the ladder's best and does not separately recommend a different move", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "the best move here is h4, pushing that pawn forward.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("agree");
    expect(record.mentionsLadderBest).toBe(true);
    expect(record.recommendsOther).toBe(false);
  });

  it("classifies mixed when the reply mentions the ladder's best AND separately recommends a different legal move", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "true, h4 works. but e4 is the better choice here.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("mixed");
    expect(record.mentionsLadderBest).toBe(true);
    expect(record.recommendsOther).toBe(true);
  });

  // Real row 299 (game 192, ply 46): pass 1 wrongly classified this
  // disagree-best -- "f6" (a past-ply historical statement: "you actually
  // played your queen to f6 there instead") fell inside the old 80-char
  // window trailing "best" and "instead". Under sentence-bounded
  // extraction, "queen to f6" sits in the SAME sentence as "instead", but
  // f6 is where the CHAT's own queen already stands at this fen (not a
  // legal destination -- the queen can't move to its own square), so it is
  // filtered out by the legal-at-chatFen requirement on recommendsOther.
  // h4, the ladder's real best, is mentioned (never inside a
  // recommendation-keyword sentence in this reply, which is a known
  // extractor limitation noted in the report) but that's enough for
  // mentionsLadderBest -- so this now reads agree, matching the owner's
  // own read of the row (a real, non-contradictory conversation).
  it("classifies real row 299 (game 192, ply 46) as agree, not disagree-best", () => {
    const { db, gameId } = freshGame();
    const fen = "1r3rk1/5p1p/4pQp1/p2b4/Np1P4/1P1BP3/P4PPP/5RK1 w - - 2 24";
    logGameEvent(gameId, "hint", JSON.stringify({ level: 5, tier: "nudge", deltaCp: 0, bestUci: "h2h4", fen }));
    insertAdviceTrace({
      gameId,
      ply: 46,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: fen }),
      prompt: "p",
      output:
        "you're right, and that's on me for not being clear: king to h1 was never a move you played. it was our chess brain's suggested best move for move 23, but you actually played your queen to f6 there instead. both are real positions in the game, just not ones you chose to follow.\n\nnow we're one move later, move 24, and nothing about h1 applies here. you've picked up your knight to jump to c5. if you play it, mallow can push her pawn to a4, and that holds fine for her, no damage to you but no gain either. pawn to h4 first avoids giving her that resource and keeps grabbing space on the kingside.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.ladderBest?.bestSan).toBe("h4");
    expect(record.mentionsLadderBest).toBe(true);
    expect(record.cls).toBe("agree");
  });

  // Real row 304 (game 192, ply 54): pass 1 wrongly classified this
  // disagree-best -- "b3" (the pawn being dismissed as harmless) fell
  // inside the old window trailing "stronger". The reply's real
  // recommendation, "pawn d5 takes on e6", needed the new fromTakesOn
  // spelled-move pattern (item 1) to resolve to "dxe6" at all -- the old
  // parser's "<piece> (takes on|to) <sq>" shape doesn't match "pawn d5
  // takes on e6" (piece immediately followed by a FROM square, not the
  // action). dxe6 matches the ladder's own best exactly.
  it("classifies real row 304 (game 192, ply 54) as agree, resolving 'pawn d5 takes on e6' to dxe6", () => {
    const { db, gameId } = freshGame();
    const fen = "1r1r2k1/5p2/4pQp1/2NP3p/1p1P3P/1p1B4/P4PP1/5RK1 w - - 0 28";
    logGameEvent(gameId, "hint", JSON.stringify({ level: 1, tier: "nudge", deltaCp: 0, bestUci: "d5e6", fen }));
    insertAdviceTrace({
      gameId,
      ply: 54,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: fen }),
      prompt: "p",
      output:
        "her pawn on b3 isn't queening yet, it still needs two more pushes, to b2 then b1. right now pawn d5 takes on e6 is stronger: our chess brain has that leading to forced mate for you in 7, so the b3 pawn never gets the chance to matter.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.ladderBest?.bestSan).toBe("dxe6");
    expect(record.recommendedMoves).toContain("dxe6");
    expect(record.mentionsLadderBest).toBe(true);
    expect(record.recommendsOther).toBe(false);
    expect(record.cls).toBe("agree");
  });

  it("classifies two-bests-in-prompt when the fact list's own hintFindings and context.best disagree", () => {
    const { db, gameId } = freshGame();
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({
        currentFen: START_FEN,
        hintFindings: {
          fen: START_FEN,
          bestSan: "h4",
          bestUci: "h2h4",
          evalCp: 20,
          evalMate: null,
          pvSans: ["h4"],
          trade: false,
          escalated: true,
          candidates: [],
          verified: true,
        },
        context: { mode: "live", best: { san: "e4", uci: "e2e4", pieceKind: "p", from: "e2", to: "e4" } },
      }),
      prompt: "p",
      output: "not sure which is stronger honestly.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("two-bests-in-prompt");
  });

  it("classifies no-ladder-fact when a hint_compute event exists for the SAME game but at a DIFFERENT fen (proves the matcher checks fen, not just game_id)", () => {
    const { db, gameId } = freshGame();
    const otherFen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: otherFen }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "e4 is the best move here.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.ladderBest).toBeNull();
    expect(record.cls).toBe("no-ladder-fact");
  });

  it("classifies motif-denied when the verdict at the same ply asserts a motif with a refutation and the reply denies it", () => {
    const { db, gameId } = freshGame();
    insertVerdict({
      gameId,
      ply: 3,
      fen: START_FEN,
      move: "Nc6",
      tier: "warning",
      deltaCp: -150,
      mateAgainst: false,
      latencyMs: 300,
      adviceLevel: "standard",
      factsJson: JSON.stringify({ motif: "fork", refutationSan: "Nxe5", refutationUci: "d3e5" }),
    });
    insertAdviceTrace({
      gameId,
      ply: 3,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "no fork there, you're fine.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("motif-denied");
    expect(record.denialFragments[0]).toMatch(/no fork/i);
  });

  it("classifies no-claim when the reply recommends nothing and denies nothing (even though a ladder fact exists -- no-ladder-fact only fits when there is genuinely nothing to compare against)", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "let's keep playing and see how it develops.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("no-claim");
  });

  it("resolves a spelled-out recommended move ('pawn to h4') to SAN against the chat fen", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "i recommend pawn to h4 here.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.recommendedMoves).toContain("h4");
    expect(record.cls).toBe("agree");
  });

  it("ignores a chat row outside the --since window", () => {
    const { db, gameId } = freshGame();
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "no claim here.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const records = analyze(db, "2099-01-01");
    expect(records).toHaveLength(0);
  });
});

describe("classifyRow (unit, no db)", () => {
  it("prefers two-bests-in-prompt over agree when both fit", () => {
    const ladder: LadderFact = { fen: START_FEN, at: "2026-01-01 00:00:00", eventType: "hint_compute", bestSan: "h4" };
    const { primary, secondary } = classifyRow({
      chatBest: "h4",
      ctxBest: "e4",
      recommendedMoves: ["h4"],
      mentionsLadderBest: true,
      recommendsOther: false,
      ladderBest: ladder,
      verdict: null,
      threatMotif: null,
      threatRefutationSan: null,
      denialFragments: [],
    });
    expect(primary).toBe("two-bests-in-prompt");
    expect(secondary).toBe("agree");
  });
});

describe("factPresenceTotals (unit, no db)", () => {
  it("counts presence, equality, and verified status across rows", () => {
    const rows = [
      { ctxBest: "e4", chatBest: "e4", chatBestVerified: true },
      { ctxBest: "e4", chatBest: "d4", chatBestVerified: false },
      { ctxBest: "e4", chatBest: null, chatBestVerified: null },
      { ctxBest: null, chatBest: null, chatBestVerified: null },
    ].map((partial) => ({
      traceId: 0,
      gameId: 0,
      ply: null,
      rating: null,
      createdAt: "2026-01-01 00:00:00",
      kind: "chat",
      source: "model",
      output: "",
      chatFen: null,
      mode: null,
      threatMotif: null,
      threatRefutationSan: null,
      recommendedMoves: [],
      mentionedMoves: [],
      mentionsLadderBest: null,
      recommendsOther: null,
      denialFragments: [],
      ladderBest: null,
      ladderBestAfter: null,
      verdict: null,
      cls: "no-claim" as const,
      secondaryCls: null,
      ...partial,
    }));
    const totals = factPresenceTotals(rows);
    expect(totals.total).toBe(4);
    expect(totals.ctxBestPresent).toBe(3);
    expect(totals.hintFindingsBestPresent).toBe(2);
    expect(totals.bothPresent).toBe(2);
    expect(totals.bothEqual).toBe(1);
    expect(totals.bothDifferent).toBe(1);
    expect(totals.verifiedTrue).toBe(1);
    expect(totals.verifiedFalse).toBe(1);
    expect(totals.verifiedAbsent).toBe(2);
  });
});
