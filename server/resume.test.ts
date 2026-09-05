// Resume round (2026-09-06): POST /api/game/:id/resume over the real
// express app -- a forgotten game (built with the raw store functions, the
// way manager.test.ts's own "no in-memory entry" precedent does, never
// gm.newGame) resumes, and an unknown id is refused with a reason.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { Chess } from "chess.js";
import { app, ready, gm } from "./index";
import { createSession, createGame, recordMove } from "./store/db";

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
