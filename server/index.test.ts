import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, ready } from "./index";

describe("api", () => {
  it("creates a session, a game, and plays a move", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 1500 }).expect(200);
    expect(m.body.ok).toBe(true);
    expect(m.body.reply.san).toBeTruthy();
  }, 60000);

  it("returns ok:false for move on nonexistent game without crashing", async () => {
    await ready;
    const m = await request(app).post("/api/game/999999/move")
      .send({ from: "e2", to: "e4" }).expect(200);
    expect(m.body.ok).toBe(false);
  });

  it("returns ok:false and the pre-move server fen for an illegal move", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const fenBefore = g.body.fen;
    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e5" }).expect(200);
    expect(m.body.ok).toBe(false);
    expect(m.body.fen).toBe(fenBefore);
  });

  it("resigns a game via POST /api/game/:id/resign", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const r = await request(app).post(`/api/game/${g.body.gameId}/resign`).send({}).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.result).toBe("0-1");
  });

  it("offers a draw via POST /api/game/:id/draw-offer and accepts near startpos", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const r = await request(app).post(`/api/game/${g.body.gameId}/draw-offer`).send({}).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.accepted).toBe(true);
    expect(r.body.result).toBe("1/2-1/2");
  }, 20000);

  it("judges a legal move via POST /api/game/:id/judge without advancing the game", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const j = await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e4" }).expect(200);
    expect(j.body.ok).toBe(true);
    expect(j.body.verdict).toEqual({ tier: "silent", deltaCp: 0, mateAgainst: false, latencyMs: expect.any(Number) });

    // Follow-up /move confirms judging didn't advance the game: e2-e4 is
    // still legal from the (unchanged) starting position.
    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);
    expect(m.body.ok).toBe(true);
    expect(m.body.playerSan).toBe("e4");
  }, 20000);

  it("returns ok:false for an illegal move via POST /api/game/:id/judge", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const j = await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e5" }).expect(200);
    expect(j.body.ok).toBe(false);
  });

  it("judging then confirming through /move produces exactly one recorded player move (no double-apply)", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    await request(app).post(`/api/game/${g.body.gameId}/judge`).send({ from: "e2", to: "e4" }).expect(200);
    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);
    expect(m.body.ok).toBe(true);
    expect(m.body.playerSan).toBe("e4");
    expect(m.body.reply?.san).toBeTruthy();
  }, 20000);
});
