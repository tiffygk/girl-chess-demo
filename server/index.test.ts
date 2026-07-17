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
});
