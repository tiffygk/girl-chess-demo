import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app, ready, gm } from "./index";
import { insertChatMessage } from "./store/db";

// Task 11.2 (stranger-clones-and-plays round): GET /api/game/:id/chat lets
// a resumed game bring back what the player asked cookie and what she
// answered. Backed by the already-existing, already-tested
// getAllChatMessages(gameId) (server/store/db.ts) -- this route is the
// first thing that ever exposes chat_messages rows over HTTP (see
// chat-resume-research.md part 2: no prior route returns them at all).
describe("GET /api/game/:id/chat", () => {
  afterAll(() => gm.shutdown());

  it("returns the game's chat_messages rows in created_at order", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const gameId = g.body.gameId;

    insertChatMessage({ gameId, role: "user", text: "what should i do?" });
    insertChatMessage({ gameId, role: "coach", text: "take on d5 with your pawn.", traceId: null });

    const r = await request(app).get(`/api/game/${gameId}/chat`).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.messages).toEqual([
      { role: "user", text: "what should i do?", createdAt: expect.any(String) },
      { role: "coach", text: "take on d5 with your pawn.", createdAt: expect.any(String) },
    ]);
  });

  it("returns ok:false game_not_found for a nonexistent game", async () => {
    await ready;
    const r = await request(app).get("/api/game/999999/chat").expect(404);
    expect(r.body).toEqual({ ok: false, error: "game_not_found" });
  });
});
