import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, ready } from "./index";
import { getVerdicts, getGameEvents, getGame, getModeSeconds } from "./store/db";

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
    expect(j.body.verdict.tier).toBe("silent"); // e4 from startpos is a fine opening move
    expect(typeof j.body.verdict.deltaCp).toBe("number");
    expect(j.body.verdict.mateAgainst).toBe(false);
    expect(typeof j.body.verdict.latencyMs).toBe("number");

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

  // C3: trace-tagging — the /judge route accepts and stores a `mode` field
  // so the Lab can tell a pre-move (pending) judgment apart from a
  // post-move one. Omitting it defaults to "guardian".
  it("accepts and stores the mode field on POST /api/game/:id/judge", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e4", mode: "post" }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "d2", to: "d4" }).expect(200);

    const rows = getVerdicts(g.body.gameId);
    expect(rows).toHaveLength(2);
    expect(rows[0].mode).toBe("post");
    expect(rows[1].mode).toBe("guardian");
  }, 20000);

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

  // C4 Part 1: override logging — an override is confirming a move the
  // judge marked "warning" (a "nudge" confirm is NOT an override — see
  // isOverrideConfirm in src/game/moveFlow.ts, the client-side gate that
  // decides whether this flag is ever set). The client already holds the
  // verdict at confirm time and carries deltaCp/mateAgainst straight
  // through; the server's job is just to record it when told to.
  it("writes a game_events override row when /move carries override:true", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500, override: true, deltaCp: 220, mateAgainst: false })
      .expect(200);
    expect(m.body.ok).toBe(true);

    const events = getGameEvents(g.body.gameId);
    const overrideEvents = events.filter((e) => e.type === "override");
    expect(overrideEvents).toHaveLength(1);
    expect(JSON.parse(overrideEvents[0].detail)).toEqual({ ply: 1, deltaCp: 220, mateAgainst: false });
  }, 20000);

  it("writes no game_events row for a normal /move (no override flag)", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const events = getGameEvents(g.body.gameId);
    expect(events.filter((e) => e.type === "override")).toHaveLength(0);
  }, 20000);

  // C4 Part 2, inherited gap #1 (increment-1 review, verbatim): posting two
  // mode-timer updates for the same (session, mode) should accumulate via
  // the upsert, not overwrite.
  it("accumulates mode-timer seconds across two posts for the same (session, mode)", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const sessionId = s.body.sessionId;

    await request(app).post(`/api/session/${sessionId}/mode`).send({ mode: "game", seconds: 30 }).expect(200);
    await request(app).post(`/api/session/${sessionId}/mode`).send({ mode: "game", seconds: 45 }).expect(200);

    expect(getModeSeconds(sessionId, "game")).toBe(75);
  });

  // C4 Part 2, inherited gap #2 (increment-1 review, verbatim): drive a game
  // to a terminal state through the API and assert the games row's
  // result/finished state, and that a further /move call fails cleanly
  // rather than crashing. Resign is the cheapest API-level path to
  // terminal. This also exercises the finished-game guard added to
  // manager.ts as part of this task (B6 had flagged resign/offerDraw for
  // lacking one).
  it("drives a game to a terminal state via resign, records the result, and further /move calls fail cleanly", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/resign`).send({}).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.result).toBe("0-1");

    const row = getGame(g.body.gameId);
    expect(row.result).toBe("0-1");
    expect(row.ended_at).toBeTruthy();

    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4" }).expect(200);
    expect(m.body.ok).toBe(false);
  });
});
