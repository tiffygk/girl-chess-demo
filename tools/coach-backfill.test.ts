import { describe, it, expect } from "vitest";
import {
  openDb,
  createSession,
  createGame,
  recordMove,
  attachEval,
  finishGame,
  insertAdviceTrace,
  insertChatMessage,
  insertTurningPoints,
  getAdviceTraces,
  getAdviceTraceById,
} from "../server/store/db";
import { findFailedTraces, backfillTrace, rebuildChatFacts, type FailedTrace } from "./coach-backfill";
import type { CoachBackend } from "../server/coach/backends/types";
import type { CoachFactList } from "../server/coach/index";

function fakeBackend(text: string): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    async generate() {
      return text;
    },
  };
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function seedFacts(): CoachFactList {
  return {
    herMove: { pieceKind: "n", from: "b1", to: "c3" },
    tier: "nudge",
    deltaCp: 20,
    currentFen: START_FEN,
    allowedSquares: ["b1", "c3"],
    allowedSans: ["b1", "c3"],
  };
}

describe("coach-backfill: findFailedTraces", () => {
  // Falsification: remove the `backend !== "none"` clause and this test
  // goes red on the templates-only row -- it starts with "[backend error]"
  // exactly like a real outage does (noBackend.generate() throws
  // unconditionally), and its inclusion would silently regenerate an answer
  // for a session where templates-only voice was a DELIBERATE choice, not a
  // failure. Verified against her real row 260 (2026-08-21), which has this
  // exact shape and must never be selected.
  it("selects only a row whose output records a REAL named backend's error -- never a clean model row, an off-topic/validation-failed template, a timeout, or the deliberate templates-only (backend='none') path", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");

    const backendErrorRowId = insertAdviceTrace({
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    // clean model answer -- never a candidate regardless of shape
    insertAdviceTrace({
      gameId: g,
      ply: 6,
      kind: "nudge",
      factsJson: "{}",
      prompt: "p",
      output: "nice developing move.",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 10,
    });
    // off-topic redirect: correct behaviour, not a failure
    insertAdviceTrace({
      gameId: g,
      ply: 8,
      kind: "chat",
      factsJson: "{}",
      prompt: "",
      output: "keep it on the board.",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 5,
      cause: "off-topic",
    });
    // validation-failed ("garbled"): the rejected model text, never
    // "[backend error]"-shaped -- correct behaviour, not an outage
    insertAdviceTrace({
      gameId: g,
      ply: 9,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "Nf3 develops and threatens e5.",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 1,
      latencyMs: 900,
      cause: "validation-failed",
    });
    // a timeout: the backend was slow, not down -- out of scope for this tool
    insertAdviceTrace({
      gameId: g,
      ply: 10,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] agent-sdk generate timed out after 45000ms",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 1,
      latencyMs: 45000,
    });
    // the deliberate templates-only voice pick -- noBackend's unconditional
    // throw, backend "none". Same "[backend error]" prefix as a real outage.
    insertAdviceTrace({
      gameId: g,
      ply: 12,
      kind: "warning",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] no coach backend available",
      source: "template",
      backend: "none",
      validated: false,
      regenCount: 0,
      latencyMs: 5,
    });

    const rows = findFailedTraces();
    expect(rows.map((r) => r.id)).toEqual([backendErrorRowId]);
  });

  it("filters by gameId when given", () => {
    openDb(":memory:");
    const s = createSession();
    const g1 = createGame(s, "maia-1100");
    const g2 = createGame(s, "maia-1100");

    const idG1 = insertAdviceTrace({
      gameId: g1,
      ply: 4,
      kind: "nudge",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    insertAdviceTrace({
      gameId: g2,
      ply: 4,
      kind: "nudge",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });

    expect(findFailedTraces(g1).map((r) => r.id)).toEqual([idG1]);
  });
});

describe("coach-backfill: backfillTrace", () => {
  it("regenerates a narrate row from facts_json alone, updates it in place, and never inserts a duplicate row", async () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const facts = seedFacts();
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    const before = getAdviceTraces(g).length;

    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };
    const outcome = await backfillTrace(row, fakeBackend("nice, steady development, keep building your plan."));

    expect(outcome).toBe("regenerated");
    // Falsification: comment out the deleteAdviceTraceById call in
    // mergeRegeneration and this assertion goes red -- narrate() always
    // inserts its own row (F40 completeness), and without the delete the
    // count grows by one on every backfill.
    expect(getAdviceTraces(g).length).toBe(before);
    const after = getAdviceTraceById(rowId);
    expect(after.source).toBe("model");
    expect(after.output).toContain("nice, steady development");
    expect(after.backfilled_at).not.toBeNull();
  });

  it("stamps backfilled_at and clears cause on a successful regeneration", async () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const facts = seedFacts();
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
      cause: "backend-down",
    });
    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      output: "x",
      source: "template",
      backend: "agent-sdk",
      cause: "backend-down",
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    expect(getAdviceTraceById(rowId).backfilled_at).toBeNull();
    await backfillTrace(row, fakeBackend("a calm, developing choice that keeps options open."));
    const after = getAdviceTraceById(rowId);
    expect(after.backfilled_at).not.toBeNull();
    expect(after.cause).toBeNull();
  });

  it("leaves the row untouched and reports 'failed' when regeneration also falls back to a template -- never overwrites a real answer with a worse one", async () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const facts = seedFacts();
    const originalOutput = "[backend error] Claude Code returned an error result: Failed";
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      prompt: "p",
      output: originalOutput,
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    const before = getAdviceTraces(g).length;
    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 4,
      kind: "nudge",
      factsJson: JSON.stringify(facts),
      output: originalOutput,
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };
    const throwingBackend: CoachBackend = {
      name: "still-down",
      async available() {
        return false;
      },
      async generate() {
        throw new Error("Claude Code returned an error result: still failing");
      },
    };

    const outcome = await backfillTrace(row, throwingBackend);
    expect(outcome).toBe("failed");
    expect(getAdviceTraces(g).length).toBe(before); // transient row still discarded
    const after = getAdviceTraceById(rowId);
    expect(after.output).toBe(originalOutput); // untouched
    expect(after.backfilled_at).toBeNull();
  });

  it("regenerates a chat row by finding the preceding player question via timestamp correlation, not chat_messages.trace_id (which a failed row never has)", async () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 1000 });
    finishGame(g, "1-0");

    insertChatMessage({ gameId: g, role: "user", text: "why is opening with the king pawn considered strong" });
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 1,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    // Falsification for the join itself: a template (failed) chat reply is
    // NEVER given a chat_messages row (server/game/manager.ts, B3b) -- so
    // this row genuinely has no trace_id pointer anywhere in chat_messages,
    // and a join on trace_id (the plan's original, literal text) would find
    // nothing here. This test's whole setup only ever inserts the USER row
    // above, proving the correlation this tool actually uses (nearest
    // preceding message by timestamp) is the one doing the work below.

    const before = getAdviceTraces(g).length;
    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 1,
      kind: "chat",
      factsJson: "{}",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    const outcome = await backfillTrace(row, fakeBackend("that developing move keeps your pieces flexible and heads toward the middle."));

    expect(outcome).toBe("regenerated");
    expect(getAdviceTraces(g).length).toBe(before);
    const after = getAdviceTraceById(rowId);
    expect(after.source).toBe("model");
    expect(after.output).toContain("developing move");
  });

  it("returns 'skipped' for a chat row with no recoverable preceding question", async () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 1000 });
    finishGame(g, "1-0");
    // No chat_messages rows at all for this game.
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 1,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 1,
      kind: "chat",
      factsJson: "{}",
      output: "x",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    const outcome = await backfillTrace(row, fakeBackend("anything"));
    expect(outcome).toBe("skipped");
  });
});

describe("coach-backfill: rebuildChatFacts (F1 -- review finding HIGH-1)", () => {
  // Falsification: revert rebuildChatFacts to deciding `finished` from
  // `game.result != null` alone (today's state) and this goes red exactly
  // as it did against the real code -- a mid-game question gets told the
  // game is over, with a fabricated outcome and turning points from plies
  // she had not yet reached. Mirrors her real trace 269 (game 188, asked at
  // ply 20 while the game ran on to ply 47): here scaled down to a 6-ply
  // fixture, chat row at ply 3.
  it("describes the game AS OF row.ply, not today's finished state -- a mid-game question must never be told the game is over", () => {
    const dbHandle = openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");

    // Plies 1-3 must be real, chess.js-legal SAN: rebuildChatFacts replays
    // the TRUNCATED list (<= row.ply) through assembleChatFactList. Plies
    // 4-6 are never replayed by this path (only read as raw rows for the
    // "is the game over yet" / turning-point bookkeeping this test is
    // falsifying), so their SAN strings don't need to be legal.
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "f1", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "f2", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "f3", timeSpentMs: 1000 });

    // The chat question fails HERE, mid-game -- ply 3, game not yet over.
    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 3,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });

    // Three more plies get played after the failed question, then the game
    // ends -- a turning point lands at ply 5, strictly after row.ply.
    recordMove({ gameId: g, ply: 4, san: "Nc6", uci: "b8c6", fenAfter: "f4", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 5, san: "Bb5", uci: "f1b5", fenAfter: "f5", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 6, san: "Qxd8#", uci: "d1d8", fenAfter: "f6", timeSpentMs: 1000 });
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 5, san: "Bb5", label: "opponent blunder", deltaP: 0.5, lowConfidence: false, kind: "swing" }],
      8
    );
    finishGame(g, "1-0");

    // Pin the timestamps directly (both columns default to second-
    // resolution `datetime('now')`, which a fast test run could otherwise
    // collapse into the same second): the question failed well before the
    // game's own ended_at, exactly the real-data shape (trace 269 at
    // 20:12:04, game 188 ended_at 20:24:19).
    dbHandle.prepare("UPDATE advice_traces SET created_at = ? WHERE id = ?").run("2026-08-24 20:12:04", rowId);
    dbHandle.prepare("UPDATE games SET ended_at = ? WHERE id = ?").run("2026-08-24 20:24:19", g);

    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 3,
      kind: "chat",
      factsJson: "{}",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    const facts = rebuildChatFacts(row);
    expect(facts).toBeDefined();
    expect(facts!.status).toBe("in-progress");
    expect(facts!.outcome).toBeUndefined();
    expect(facts!.turningPoints).toBeUndefined();
    expect(facts!.gameSans).toEqual(["e4", "e5", "Nf3"]); // truncated to row.ply, never the whole game
  });

  // Companion case (not itself a defect, recorded so the fix isn't
  // over-corrected into "chat facts are never finished"): a question asked
  // genuinely AFTER the game ended (review mode) must still get the real
  // outcome and the full turning-point set -- exactly what manager.ts's
  // chat() assembles live for a review-mode call.
  it("still reports finished + outcome + turning points for a question asked after the game actually ended", () => {
    const dbHandle = openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "f1", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "f2", timeSpentMs: 1000 });
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "e5", label: "opponent blunder", deltaP: 0.5, lowConfidence: false, kind: "swing" }],
      8
    );
    finishGame(g, "1-0");

    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 2,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    // Asked well AFTER the game's own ended_at -- a genuine review-mode question.
    dbHandle.prepare("UPDATE games SET ended_at = ? WHERE id = ?").run("2026-08-24 20:12:00", g);
    dbHandle.prepare("UPDATE advice_traces SET created_at = ? WHERE id = ?").run("2026-08-24 20:30:00", rowId);

    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 2,
      kind: "chat",
      factsJson: "{}",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    const facts = rebuildChatFacts(row);
    expect(facts).toBeDefined();
    expect(facts!.status).toBe("finished");
    expect(facts!.outcome).toBeDefined();
    expect(facts!.outcome!.winner).toBe("you");
    expect(facts!.turningPoints).toEqual([{ ply: 2, san: "e5", label: "opponent blunder", punishSan: undefined }]);
  });
});

describe("coach-backfill: buildPerPlyAnalysis via rebuildChatFacts (F2 -- review finding HIGH-2)", () => {
  // Falsification: revert buildPerPlyAnalysis/pvLine to attaching each row's
  // OWN best_move to its OWN ply (replaying from fenAfter instead of
  // fenBefore with the PRIOR row's eval) and this goes red exactly as it
  // did against the real code -- moves.best_move is the eval of the
  // position AFTER the ply (attachEval's own documented convention), so a
  // ply's own best_move names the best move for whoever moves NEXT, an
  // opposite-side, illegal-as-an-alternative SAN. Real game 188 shape:
  // she plays e4/e5/Nf3 (the engine's own suggestions each time) then
  // deviates with d6 instead of the recommended Nc6.
  it("attaches the PRIOR ply's eval to each ply (fenBefore replay), never a same-ply opposite-side move, and only flags gap on a real deviation", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");

    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "f1", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "f2", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "f3", timeSpentMs: 1000 });
    recordMove({ gameId: g, ply: 4, san: "d6", uci: "d7d6", fenAfter: "f4", timeSpentMs: 1000 });
    // Each row's best_move/pv is the position AFTER that ply, per
    // attachEval's own contract -- ply 1's is black's reply (e5), ply 2's
    // is white's next (Nf3), ply 3's is black's next (Nc6, the move she did
    // NOT play at ply 4), ply 4's is white's next (d4).
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
    attachEval(g, 2, { cp: -180, mate: null, bestMove: "g1f3", pv: ["g1f3"] });
    attachEval(g, 3, { cp: 30, mate: null, bestMove: "b8c6", pv: ["b8c6"] });
    attachEval(g, 4, { cp: -220, mate: null, bestMove: "d2d4", pv: ["d2d4"] });

    const rowId = insertAdviceTrace({
      gameId: g,
      ply: 4,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
    const row: FailedTrace = {
      id: rowId,
      gameId: g,
      ply: 4,
      kind: "chat",
      factsJson: "{}",
      output: "[backend error] Claude Code returned an error result: Failed",
      source: "template",
      backend: "agent-sdk",
      cause: null,
      createdAt: getAdviceTraceById(rowId).created_at,
    };

    const facts = rebuildChatFacts(row);
    expect(facts).toBeDefined();
    const byPly = new Map(facts!.perPlyAnalysis!.map((p) => [p.ply, p]));

    // Ply 1 has no prior row -- an honest gap (null), never the
    // opposite-side "e5" the buggy fenAfter/own-eval pairing would attach.
    expect(byPly.get(1)!.bestSan).toBeNull();
    // Ply 2 (black's move): the PRIOR row's (ply 1) best_move e7e5 -> "e5",
    // matching what she actually played -- same side, legal, and no
    // deviation, so gap must not fire here.
    expect(byPly.get(2)!.bestSan).toBe("e5");
    expect(byPly.get(2)!.gap).toBeUndefined();
    // Ply 3 (white's move): prior row's (ply 2) best_move g1f3 -> "Nf3",
    // matching what she played -- same, no gap.
    expect(byPly.get(3)!.bestSan).toBe("Nf3");
    expect(byPly.get(3)!.gap).toBeUndefined();
    // Ply 4 (black's move): prior row's (ply 3) best_move b8c6 -> "Nc6" --
    // she played "d6" instead, a REAL deviation, so gap must fire here.
    expect(byPly.get(4)!.bestSan).toBe("Nc6");
    expect(byPly.get(4)!.gap).toBeDefined();
  });
});
