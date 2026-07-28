import { describe, it, expect } from "vitest";
import request from "supertest";
import { Chess } from "chess.js";
import { app, ready, gm } from "./index";
import { getVerdicts, getGameEvents, getGame, getModeSeconds, getAllChatMessages, getAdviceTraces, insertAdviceTrace, getAllTableCounts } from "./store/db";
import { CHAT_MAX_LEN } from "./coach/chat";

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

  // Task 6 (judge strictness dial, F10 tuning — UI label "judge strictness",
  // not "advice level"): the /judge route accepts and stores a `strictness`
  // field. The verdict row's existing advice_level column stores the
  // strictness key itself (single semantic: which ADVICE_LEVELS table
  // judged this move); an omitted strictness stores "standard"
  // (DEFAULT_ADVICE_LEVEL).
  it("threads strictness to the stored verdict row's advice_level column; omitted strictness stores standard", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e4", strictness: "blunt" }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "d2", to: "d4" }).expect(200);

    const rows = getVerdicts(g.body.gameId);
    expect(rows).toHaveLength(2);
    expect(rows[0].advice_level).toBe("blunt");
    expect(rows[1].advice_level).toBe("standard");
  }, 20000);

  it("an unrecognized strictness value falls back to standard rather than erroring", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const j = await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e4", strictness: "not-a-real-level" }).expect(200);
    expect(j.body.ok).toBe(true);

    const rows = getVerdicts(g.body.gameId);
    expect(rows[0].advice_level).toBe("standard");
  }, 20000);

  // Fix (task-reviewer, post Task 6 approval — Critical): "constructor" is
  // an Object.prototype-colliding string reachable via a direct POST to
  // this route (no allowlist previously guarded gm.judgeMove's strictness
  // param). Proves the fix through the full route -> manager -> classify
  // path: the request still succeeds, and the stored advice_level column is
  // "standard" — not the garbage "constructor" the pre-fix bracket-lookup
  // bug would have stored (which would also have silently forced every
  // verdict on this table to "silent"; see classify.test.ts's
  // isAdviceLevel/classifyMove tests for the delta-precision half of this
  // proof with a mocked evaluator).
  it("an Object.prototype-colliding strictness value ('constructor') stores advice_level 'standard', not the colliding string", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const j = await request(app).post(`/api/game/${g.body.gameId}/judge`)
      .send({ from: "e2", to: "e4", strictness: "constructor" }).expect(200);
    expect(j.body.ok).toBe(true);

    const rows = getVerdicts(g.body.gameId);
    expect(rows[0].advice_level).toBe("standard");
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
    // Increment 3c: `moves` (ply/san, for the debrief's client-side rewind
    // seam) rides alongside the existing arrays. Highlight-a-move (Task 1)
    // widens each row with `highlighted` (false when never flagged).
    expect(Array.isArray(summary.body.moves)).toBe(true);
    expect(summary.body.moves.length).toBeGreaterThanOrEqual(1);
    expect(summary.body.moves[0]).toEqual({ ply: 1, san: expect.any(String), highlighted: false });
  }, 20000);

  // Highlight-a-move (Task 1): POST /api/game/:id/move/:ply/highlight
  // persists a per-move flag, readable straight back off /summary.
  it("highlights a move via POST /api/game/:id/move/:ply/highlight, reflected in the summary", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/move/1/highlight`)
      .send({ highlighted: true }).expect(200);
    expect(r.body).toEqual({ ok: true });

    const summary = await request(app).get(`/api/game/${g.body.gameId}/summary`).expect(200);
    expect(summary.body.moves.find((m: any) => m.ply === 1)?.highlighted).toBe(true);
  }, 20000);

  it("rejects a highlight request with a non-boolean `highlighted`", async () => {
    const r = await request(app).post("/api/game/1/move/1/highlight").send({ highlighted: "yes" }).expect(400);
    expect(r.body.error).toMatch(/boolean/);
  });

  it("returns an empty-but-ok summary for a nonexistent game (compute-on-read fallback)", async () => {
    const r = await request(app).get("/api/game/999999/summary").expect(200);
    expect(r.body).toEqual({ ok: true, turningPoints: [], classifications: [], moves: [] });
  });

  // Increment 3c: GET /api/games — the "past games" saved-games menu.
  // Finished-only filter + newest-first + the rank-1-turning-point lesson
  // join. Resign is the cheapest reliable path to terminal (same reasoning
  // as the summary test above); the second game is left unfinished on
  // purpose to prove the filter actually excludes it.
  it("lists finished games via GET /api/games, newest first, excluding unfinished games", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g1 = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g1.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);
    await request(app).post(`/api/game/${g1.body.gameId}/resign`).send({}).expect(200);

    const g2 = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const list = await request(app).get("/api/games").expect(200);
    expect(list.body.ok).toBe(true);
    const ids = list.body.games.map((g: any) => g.id);
    expect(ids).toContain(g1.body.gameId);
    expect(ids).not.toContain(g2.body.gameId);

    const found = list.body.games.find((g: any) => g.id === g1.body.gameId);
    expect(found.result).toBe("0-1");
    expect(found.opponent).toBeTruthy();
    expect(found.startedAt).toBeTruthy();
    // A one-move-then-resign game is too short for any real turning point
    // (moves.length <= 1 -> []), so the lesson join correctly yields null
    // rather than fabricating one.
    expect(found.lesson).toBeNull();

    // Newest-first: g1 was created before g2, but g2 never finished, so g1
    // should simply be present; assert ordering holds among finished games
    // by checking g1 isn't pushed behind a later finished game (none here,
    // but the ORDER BY id DESC is exercised implicitly by this shape).
    expect(list.body.games[0].id).toBe(g1.body.gameId);
  }, 30000);

  // Increment 3.9, F16: this-game grounding chat. gm.setCoachBackendForTesting
  // is called before every request below (the same seam manager.test.ts and
  // coach/chat.test.ts already rely on) so the route never invokes the real
  // claude CLI / ollama, even though this file hits the real exported `gm`
  // singleton rather than a fresh test instance.
  it("chats about a live game via POST /api/game/:id/chat, mirroring narrate's envelope", async () => {
    await ready;
    gm.setCoachBackendForTesting({
      name: "fake",
      async available() {
        return true;
      },
      async generate() {
        return "e4 opens things up nicely for you.";
      },
    });
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat`)
      .send({ message: "what did I just play?", context: { mode: "live" } }).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.text.length).toBeGreaterThan(0);
    expect(["model", "template"]).toContain(r.body.source);

    const messages = getAllChatMessages(g.body.gameId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("coach");

    const traces = getAdviceTraces(g.body.gameId).filter((t: any) => t.kind === "chat");
    expect(traces).toHaveLength(1);
  }, 20000);

  it("rejects an over-length chat message via POST /api/game/:id/chat", async () => {
    await ready;
    gm.setCoachBackendForTesting({
      name: "fake",
      async available() {
        return true;
      },
      async generate() {
        return "should never be called for this test.";
      },
    });
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat`)
      .send({ message: "x".repeat(CHAT_MAX_LEN + 1), context: { mode: "live" } }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("too-long");
  });

  it("returns ok:false for chat on a nonexistent game without crashing", async () => {
    await ready;
    const r = await request(app).post("/api/game/999999/chat")
      .send({ message: "hello", context: { mode: "live" } }).expect(200);
    expect(r.body.ok).toBe(false);
  });

  // Increment 3.9, Task 4 (F19): POST /api/trace/:id/rate — thumbs up/down
  // with feedback capture on traced coach outputs. Seeds a trace row
  // directly via insertAdviceTrace (the route doesn't care which endpoint
  // produced the trace; any advice_traces row is fair game per the declared
  // scope), then exercises the route itself.
  function seedTrace(gameId: number) {
    return insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "narrate",
      factsJson: "{}",
      prompt: "p",
      output: "o",
      source: "model",
      backend: "claude-cli",
      validated: true,
      regenCount: 0,
      latencyMs: 10,
    });
  }

  it("rates a trace via POST /api/trace/:id/rate (happy path)", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const traceId = seedTrace(g.body.gameId);

    const r = await request(app).post(`/api/trace/${traceId}/rate`)
      .send({ rating: -1, feedback: "too fast" }).expect(200);
    expect(r.body.ok).toBe(true);

    const rows = getAdviceTraces(g.body.gameId);
    expect(rows[0].rating).toBe(-1);
    expect(rows[0].feedback_text).toBe("too fast");
  });

  it("returns ok:false for rating an unknown trace id", async () => {
    await ready;
    const r = await request(app).post("/api/trace/999999/rate").send({ rating: 1 }).expect(200);
    expect(r.body.ok).toBe(false);
  });

  // Reviewer fix (Task 4 follow-up): a malformed rating (0, 2, a string, or
  // missing entirely) must be rejected outright -- never silently coerced
  // into a thumbs-up -- and must leave the trace row unrated, not just
  // return ok:false.
  it("rejects a malformed rating (0) without writing, leaving the trace unrated", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const traceId = seedTrace(g.body.gameId);

    const r = await request(app).post(`/api/trace/${traceId}/rate`).send({ rating: 0 }).expect(200);
    expect(r.body.ok).toBe(false);

    const rows = getAdviceTraces(g.body.gameId);
    expect(rows[0].rating).toBeNull();
  });

  it("rejects a missing rating without writing, leaving the trace unrated", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const traceId = seedTrace(g.body.gameId);

    const r = await request(app).post(`/api/trace/${traceId}/rate`).send({}).expect(200);
    expect(r.body.ok).toBe(false);

    const rows = getAdviceTraces(g.body.gameId);
    expect(rows[0].rating).toBeNull();
  });

  it("overwrites a rating on re-rate via the route -- latest wins", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const traceId = seedTrace(g.body.gameId);

    await request(app).post(`/api/trace/${traceId}/rate`).send({ rating: -1, feedback: "too fast" }).expect(200);
    const r = await request(app).post(`/api/trace/${traceId}/rate`).send({ rating: 1 }).expect(200);
    expect(r.body.ok).toBe(true);

    const rows = getAdviceTraces(g.body.gameId);
    expect(rows[0].rating).toBe(1);
    expect(rows[0].feedback_text).toBeNull();
  });

  it("stores feedback only when provided via the route", async () => {
    await ready;
    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const traceId = seedTrace(g.body.gameId);

    await request(app).post(`/api/trace/${traceId}/rate`).send({ rating: 1 }).expect(200);
    const rows = getAdviceTraces(g.body.gameId);
    expect(rows[0].rating).toBe(1);
    expect(rows[0].feedback_text).toBeNull();
  });

  // Increment 3.91 (Task 5): POST /api/explore/reply — the "try the line"
  // sandbox's engine move. Stateless: no gameId, no persisted game at all.
  describe("POST /api/explore/reply", () => {
    // 1.e4 e5 2.Nf3 — a mid-game (well, mid-opening) fen with no persisted
    // game backing it whatsoever.
    const MID_GAME_FEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
    // Fool's mate: 1.f3 e5 2.g4 Qh4# — white to move, already checkmated.
    const CHECKMATE_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

    it("returns a legal maia reply for a mid-game fen, verified independently via chess.js", async () => {
      await ready;
      const r = await request(app).post("/api/explore/reply")
        .send({ fen: MID_GAME_FEN, elo: 1100 }).expect(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.reply).toBeTruthy();
      const { from, to, promotion, san } = r.body.reply;

      // Independent legality check: replay the reply on a fresh clone of
      // the same fen and confirm chess.js accepts it and agrees on the san.
      const clone = new Chess(MID_GAME_FEN);
      const mv = clone.move({ from, to, promotion: promotion ?? "q" });
      expect(mv).toBeTruthy();
      expect(mv!.san).toBe(san);
    }, 60000);

    it("writes nothing to any table — every row count is identical before and after the call", async () => {
      await ready;
      const before = getAllTableCounts();
      await request(app).post("/api/explore/reply")
        .send({ fen: MID_GAME_FEN, elo: 1200 }).expect(200);
      const after = getAllTableCounts();
      expect(after).toEqual(before);
    }, 60000);

    it("returns gameOver:true and no reply for an already-terminal fen", async () => {
      await ready;
      const r = await request(app).post("/api/explore/reply")
        .send({ fen: CHECKMATE_FEN, elo: 1100 }).expect(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.gameOver).toBe(true);
      expect(r.body.reply).toBeUndefined();
    });
  });
});
