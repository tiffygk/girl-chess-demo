// tools/coach-ladder-agreement.test.ts
//
// Red proof lives in this file's own history, not just prose: the
// "same game, different fen" test below was run once with
// findLadderFacts's `detail.fen !== chatFen` guard temporarily deleted --
// confirmed FAIL (the different-fen hint_compute event was wrongly treated
// as the ladder fact for this chat row, flipping its class from
// no-ladder-fact to disagree-best) -- then restored to PASS. See this
// wave's report for the pasted red output.
import { describe, it, expect } from "vitest";
import { openDb, createSession, createGame, insertAdviceTrace, logGameEvent, insertVerdict } from "../server/store/db";
import { analyze, classifyRow, type LadderFact } from "./coach-ladder-agreement";

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

describe("coach-ladder-agreement: analyze()", () => {
  it("classifies disagree-best when the chat asserts a move the ladder's own hint_compute event, at the same fen, does not", () => {
    const { db, gameId } = freshGame();
    logGameEvent(gameId, "hint_compute", JSON.stringify({ bestUci: "h2h4", escalated: true, fen: START_FEN }));
    insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: JSON.stringify({ currentFen: START_FEN }),
      prompt: "p",
      output: "no, the best move here is actually Kh1, trust me.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 500,
    });
    const [record] = analyze(db, "2020-01-01");
    expect(record.cls).toBe("disagree-best");
    expect(record.ladderBest?.bestSan).toBe("h4");
    expect(record.assertedMoves).toContain("Kh1");
  });

  it("classifies agree when the chat asserts the same move as the ladder's hint_compute event", () => {
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
      output: "the best move here is Kh1.",
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

  it("classifies no-claim when the reply asserts nothing and denies nothing (even though a ladder fact exists -- no-ladder-fact only fits when there is genuinely nothing to compare against)", () => {
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

  it("resolves a spelled-out asserted move ('pawn to h4') to SAN against the chat fen", () => {
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
    expect(record.assertedMoves).toContain("h4");
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
      assertedMoves: ["h4"],
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
