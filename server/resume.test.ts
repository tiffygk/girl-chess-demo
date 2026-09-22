// Resume round (2026-09-06): POST /api/game/:id/resume over the real
// express app -- a forgotten game (built with the raw store functions, the
// way manager.test.ts's own "no in-memory entry" precedent does, never
// gm.newGame) resumes, and an unknown id is refused with a reason.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { Chess } from "chess.js";
import { app, ready, gm } from "./index";
import { createSession, createGame, recordMove, finishGame } from "./store/db";

// Shared by the games-list tests below: creates a game and records `n`
// alternating moves from the start position, returning the game id.
function makeGameWithMoves(opponent: string, n: number): number {
  const s = createSession();
  const id = createGame(s, opponent, "w");
  const c = new Chess();
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"];
  for (let i = 0; i < n; i++) {
    const mv = c.move(sans[i]);
    recordMove({
      gameId: id,
      ply: i + 1,
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion ?? ""),
      fenAfter: c.fen(),
      timeSpentMs: 0,
      side: i % 2 === 0 ? "her" : "mallow",
    });
  }
  return id;
}

describe("POST /api/game/:id/resume", () => {
  afterAll(() => gm.shutdown());

  it("a forgotten two-ply game resumes with ok:true, yourTurn:true", async () => {
    await ready;
    const s = createSession();
    const id = createGame(s, "maia-1100", "w");
    const c = new Chess();
    ["e4", "e5"].forEach((san, i) => {
      const mv = c.move(san);
      recordMove({
        gameId: id,
        ply: i + 1,
        san: mv.san,
        uci: mv.from + mv.to + (mv.promotion ?? ""),
        fenAfter: c.fen(),
        timeSpentMs: 0,
        side: i % 2 === 0 ? "her" : "mallow",
      });
    });

    const res = await request(app).post(`/api/game/${id}/resume`).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.yourTurn).toBe(true);
    expect(res.body.plies).toBe(2);
  }, 20000);

  it("an unknown id returns ok:false, reason:not_found", async () => {
    await ready;
    const res = await request(app).post("/api/game/999999/resume").expect(200);
    expect(res.body).toEqual({ ok: false, reason: "not_found" });
  });
});

// Resume round (2026-09-06), Wave B: the games list carries every played
// game, live or finished, with the fields the drawer/status route need.
// Goes red if listGames is pointed back at listFinishedGames (the live
// game vanishes from the response and the fixture's finished-game
// assertions fail against a differently-ordered/shaped list).
describe("GET /api/games", () => {
  afterAll(() => gm.shutdown());

  it("lists every game with a move, newest first, with number/elo/plies/lastMoveAt/resumable", async () => {
    await ready;
    const finishedId = makeGameWithMoves("maia-1400", 2);
    finishGame(finishedId, "1-0");
    const liveId = makeGameWithMoves("fallback-1600", 2);
    const stubId = createGame(createSession(), "maia-1100", "w"); // zero moves

    const res = await request(app).get("/api/games").expect(200);
    expect(res.body.ok).toBe(true);
    const games = res.body.games as any[];
    const ids = games.map((g) => g.id);
    expect(ids).not.toContain(stubId);
    expect(ids.indexOf(liveId)).toBeLessThan(ids.indexOf(finishedId)); // newest first

    const live = games.find((g) => g.id === liveId);
    expect(live.gameNumber).toBe(liveId);
    expect(live.elo).toBe(1600);
    expect(live.plies).toBe(2);
    expect(live.result).toBeNull();
    expect(live.resumable).toBe(true);
    expect(typeof live.lastMoveAt).toBe("string");

    const finished = games.find((g) => g.id === finishedId);
    expect(finished.gameNumber).toBe(finishedId);
    expect(finished.elo).toBe(1400);
    expect(finished.result).toBe("1-0");
    expect(finished.resumable).toBe(false);
  });
});

describe("GET /api/game/:id/status", () => {
  afterAll(() => gm.shutdown());

  it("a live game with moves reports resumable:true", async () => {
    await ready;
    const liveId = makeGameWithMoves("maia-1200", 2);
    const res = await request(app).get(`/api/game/${liveId}/status`).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.game.resumable).toBe(true);
    expect(res.body.game.gameNumber).toBe(liveId);
  });

  it("an unknown id returns ok:false, reason:not_found", async () => {
    await ready;
    const res = await request(app).get("/api/game/999999/status").expect(200);
    expect(res.body).toEqual({ ok: false, reason: "not_found" });
  });
});

// B1.2 (live-telemetry round, 2026-09-22): the fen/ply/side surface
// GameListEntry (the /status route above) never carried. RED if the route
// is missing or reads GameListEntry instead of the live chess object
// (verified by removing the route and watching the 404-vs-shape assertions
// fail, then reverting).
describe("GET /api/game/:id/state", () => {
  afterAll(() => gm.shutdown());

  // Built with the raw store functions (makeGameWithMoves), same as the
  // "GET /api/games" block above -- no live engine needed (this game is
  // NOT resident in gm's in-memory map), so this exercises gameState's
  // not-resident/replay branch through the real route without depending on
  // a real stockfish process's lifecycle across this file's earlier
  // afterAll(gm.shutdown()) calls.
  it("reports fen/ply/side reconstructed from a non-resident game's moves", async () => {
    await ready;
    const id = makeGameWithMoves("maia-1100", 3); // e4 e5 Nf3 -- 3 plies, white to move
    const res = await request(app).get(`/api/game/${id}/state`).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gameId).toBe(id);
    expect(res.body.fen).toContain(" b "); // after 3 plies (e4 e5 Nf3) black is to move
    expect(res.body.ply).toBe(3);
    expect(res.body.sideToMove).toBe("b");
    expect(res.body.result).toBeNull();
    expect(res.body.lastVerdict).toBeNull();
    expect(res.body.coachBreaker).toEqual({ unhealthyUntil: null });
  });

  it("an unknown id returns 404 with ok:false, reason:not_found", async () => {
    await ready;
    const res = await request(app).get("/api/game/999999/state").expect(404);
    expect(res.body).toEqual({ ok: false, reason: "not_found" });
  });
});
