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

  // Wave C, task C-A: the single "end the game?" flow's endpoint.
  it("adjudicates from startpos as a draw via POST /api/game/:id/adjudicate (preview), without finishing the game", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const preview = await request(app).post(`/api/game/${g.body.gameId}/adjudicate`)
      .send({ execute: false }).expect(200);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.outcome).toBe("draw");
    expect(preview.body.result).toBe("1/2-1/2");
    expect(preview.body.reason).toBe("draw-adjudicated");

    const stillPlayable = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4" }).expect(200);
    expect(stillPlayable.body.ok).toBe(true);
  }, 20000);

  it("adjudicate execute:true finishes the game, records result + end_reason, and further /move calls fail cleanly", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const exec = await request(app).post(`/api/game/${g.body.gameId}/adjudicate`)
      .send({ execute: true }).expect(200);
    expect(exec.body.ok).toBe(true);
    expect(exec.body.result).toBe("1/2-1/2");

    const row = getGame(g.body.gameId);
    expect(row.result).toBe("1/2-1/2");
    expect(row.end_reason).toBe("draw-adjudicated");

    const m = await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4" }).expect(200);
    expect(m.body.ok).toBe(false);
  }, 20000);

  it("returns ok:false for adjudicate on a nonexistent game", async () => {
    await ready;
    const r = await request(app).post("/api/game/999999/adjudicate").send({ execute: false }).expect(200);
    expect(r.body.ok).toBe(false);
  });

  // Wave C, task C-B: hint-escalation observability endpoint.
  it("logs a hint game_event via POST /api/game/:id/hint", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/hint`)
      .send({ level: 1, tier: "nudge", deltaCp: 80, bestUci: "e2e4", fen: g.body.fen }).expect(200);
    expect(r.body.ok).toBe(true);

    const events = getGameEvents(g.body.gameId);
    const hintEvents = events.filter((e: any) => e.type === "hint");
    expect(hintEvents).toHaveLength(1);
    expect(JSON.parse(hintEvents[0].detail)).toEqual({
      level: 1,
      tier: "nudge",
      deltaCp: 80,
      bestUci: "e2e4",
      fen: g.body.fen,
    });
  }, 20000);

  it("returns ok:false for hint logging on a nonexistent game", async () => {
    const r = await request(app).post("/api/game/999999/hint")
      .send({ level: 1, tier: "nudge", deltaCp: 80, bestUci: "e2e4", fen: "x" }).expect(200);
    expect(r.body.ok).toBe(false);
  });

  it("POST /api/game/:id/hint-facts returns deep hint facts", async () => {
    const s = await request(app).post("/api/session").send({});
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 });
    const res = await request(app).post(`/api/game/${g.body.gameId}/hint-facts`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.facts.bestUci).toMatch(/^[a-h][1-8][a-h][1-8][nbrq]?$/);
    expect(res.body.facts.bestFromSquare).toBe(res.body.facts.bestUci.slice(0, 2));
  }, 40000);

  it("snaps a non-band elo to the nearest maia weights band", async () => {
    const s = await request(app).post("/api/session").send({});
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1234 });
    expect(g.body.elo).toBe(1200);
  }, 30000);

  it("defaults garbage elo to 1100 and passes real bands through", async () => {
    const s = await request(app).post("/api/session").send({});
    const bad = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: "mallow" });
    expect(bad.body.elo).toBe(1100);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1500 });
    expect(g.body.elo).toBe(1500);
  }, 60000);

  // Increment 3b: GET /api/game/:id/summary — turning points + move
  // classifications, persisted at game end via manager.ts's
  // persistGameSummary (called from every finish path). Resign is the
  // cheapest reliable path to terminal (same reasoning as the C4 Part 2
  // resign test above), which also exercises the shape when the game is
  // too short for any real turning point (moves.length <= 1 -> []) —
  // "never fabricating a swing" holds even at the API boundary.
  it("computes and persists a game summary at game end, readable via GET /api/game/:id/summary", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/resign`).send({}).expect(200);

    const summary = await request(app).get(`/api/game/${g.body.gameId}/summary`).expect(200);
    expect(summary.body.ok).toBe(true);
    expect(Array.isArray(summary.body.turningPoints)).toBe(true);
    expect(Array.isArray(summary.body.classifications)).toBe(true);
  }, 20000);

  it("returns an empty-but-ok summary for a nonexistent game (compute-on-read fallback)", async () => {
    const r = await request(app).get("/api/game/999999/summary").expect(200);
    expect(r.body).toEqual({ ok: true, turningPoints: [], classifications: [] });
  });
});
