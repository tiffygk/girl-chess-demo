import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app, ready, gm } from "./index";

// B-stream (2026-07-27, coach-truth-speed round): POST /api/game/:id/chat/stream.
// Same gm.setCoachBackendForTesting seam as index.test.ts's existing chat
// tests — never invokes the real claude CLI / ollama. supertest buffers the
// whole SSE response body as `res.text` (content-type is text/event-stream,
// not JSON, so it never attempts to JSON-parse it) — good enough to assert
// frame order and shape without needing a raw streaming reader.
function parseFrames(raw: string): { event: string; data: unknown }[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.split("\n").find((l) => l.startsWith("event: "))!;
      const dataLine = block.split("\n").find((l) => l.startsWith("data: "))!;
      return { event: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) };
    });
}

describe("POST /api/game/:id/chat/stream (B-stream)", () => {
  // Gate-determinism fix (2026-07-31): `gm` here is the module-level
  // singleton from ./index -- constructing it spawns a real stockfish
  // process, and every /api/game call spawns a real maia/lc0 process too,
  // neither of which this file ever killed. That leak, surviving for the
  // rest of whichever vitest worker happened to run this file, is the root
  // cause this round found for the "socket hang up" flake below: see
  // GameManager.shutdown()'s comment in server/game/manager.ts for the
  // full explanation, which spans four files.
  afterAll(() => gm.shutdown());

  it("frame order is delta* then done, for a backend that streams", async () => {
    await ready;
    gm.setCoachBackendForTesting({
      name: "fake-streaming",
      async available() {
        return true;
      },
      async generate() {
        throw new Error("generate() should not be called when generateStream is used");
      },
      async generateStream(_prompt, _timeoutMs, onDelta) {
        onDelta("e4 ");
        onDelta("opens things up nicely for you.");
        return "e4 opens things up nicely for you.";
      },
    });

    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat/stream`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(r.text);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames[frames.length - 1].event).toBe("done");
    // Task 1c (2026-08-02): status frames now interleave with delta frames
    // (a status:drafting frame precedes the delta replay) -- filter to the
    // delta-only subset rather than assuming every non-final frame is one.
    const deltaFrames = frames.filter((f) => f.event === "delta");
    expect(deltaFrames.map((f) => (f.data as { text: string }).text)).toEqual([
      "e4 ",
      "opens things up nicely for you.",
    ]);
  }, 20000);

  // Task 1c (coach-truth-speed latency round, 2026-08-02): the staged
  // status chip -- REAL pipeline events, no unvalidated prose. Given the
  // owner ruling that no unvalidated prose is ever shown, and chat.ts's
  // buffered-flush-after-validation behaviour (UNCHANGED by this task), the
  // buffered delta replay ("drafting") can only ever begin AFTER validation
  // ("checking") has already passed -- so the real, honest order is
  // thinking -> checking -> drafting, never drafting before checking.
  it("emits status frames in the real pipeline order (thinking, checking, drafting on first delta), each carrying ONLY {phase}, never prose", async () => {
    await ready;
    gm.setCoachBackendForTesting({
      name: "fake-streaming",
      async available() {
        return true;
      },
      async generate() {
        throw new Error("generate() should not be called when generateStream is used");
      },
      async generateStream(_prompt, _timeoutMs, onDelta) {
        onDelta("e4 ");
        onDelta("opens things up nicely for you.");
        return "e4 opens things up nicely for you.";
      },
    });

    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat/stream`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(r.text);
    expect(frames.map((f) => f.event)).toEqual(["status", "status", "status", "delta", "delta", "done"]);
    const statusFrames = frames.filter((f) => f.event === "status");
    expect(statusFrames.map((f) => (f.data as { phase: string }).phase)).toEqual(["thinking", "checking", "drafting"]);
    // every status frame carries ONLY {phase} -- never the model's own text.
    for (const f of statusFrames) {
      expect(Object.keys(f.data as object)).toEqual(["phase"]);
    }
  }, 20000);

  it("fires a status:redrafting frame alongside the existing redraft frame when attempt 0 fails validation", async () => {
    await ready;
    let call = 0;
    gm.setCoachBackendForTesting({
      name: "fake-non-streaming",
      async available() {
        return true;
      },
      async generate() {
        call += 1;
        // Attempt 0: an off-game move -> validateChat rejects it -> regen.
        return call === 1 ? "she plays Qh5xf7 next." : "e4 opens things up nicely for you.";
      },
    });

    const s = await request(app).post("/api/session").expect(200);
    const g = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat/stream`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(r.text);
    const events = frames.map((f) => f.event);
    // thinking (attempt 0) -> checking (attempt 0, fails) -> redraft (the
    // existing frame) -> status:redrafting (attempt 1, NEW) -> checking
    // (attempt 1, passes) -> done (non-streaming backend, no delta frames).
    expect(events).toEqual(["status", "status", "redraft", "status", "status", "done"]);
    const phases = frames.filter((f) => f.event === "status").map((f) => (f.data as { phase: string }).phase);
    expect(phases).toEqual(["thinking", "checking", "redrafting", "checking"]);
  }, 20000);

  it("the done frame's envelope matches the JSON route's response shape exactly", async () => {
    await ready;
    const backend = {
      name: "fake",
      async available() {
        return true;
      },
      async generate() {
        return "e4 opens things up nicely for you.";
      },
    };

    const s = await request(app).post("/api/session").expect(200);
    const g1 = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    const g2 = await request(app).post("/api/game").send({ sessionId: s.body.sessionId, elo: 1100 }).expect(200);
    await request(app).post(`/api/game/${g1.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);
    await request(app).post(`/api/game/${g2.body.gameId}/move`)
      .send({ from: "e2", to: "e4", timeSpentMs: 500 }).expect(200);

    gm.setCoachBackendForTesting(backend);
    const jsonRes = await request(app).post(`/api/game/${g1.body.gameId}/chat`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    gm.setCoachBackendForTesting(backend);
    const streamRes = await request(app).post(`/api/game/${g2.body.gameId}/chat/stream`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(streamRes.text);
    const done = frames[frames.length - 1];
    expect(done.event).toBe("done");
    // traceId will differ between the two calls (two distinct advice_traces
    // rows) -- everything else must match exactly.
    const { traceId: jsonTraceId, ...jsonRest } = jsonRes.body;
    const { traceId: streamTraceId, ...streamRest } = done.data as Record<string, unknown>;
    expect(streamRest).toEqual(jsonRest);
    expect(typeof streamTraceId).toBe("number");
  }, 20000);

  it("a backend with no generateStream still completes via the non-streaming path", async () => {
    await ready;
    gm.setCoachBackendForTesting({
      name: "fake-non-streaming",
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

    const r = await request(app).post(`/api/game/${g.body.gameId}/chat/stream`)
      .send({ message: "what did I just play?", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(r.text);
    // Task 1c (2026-08-02): status:thinking + status:checking now precede
    // done even on the non-streaming path (no deltas -- a non-streaming
    // backend never populates attemptDeltas, so no status:drafting fires
    // either) -- filter to the delta-only subset for the "no deltas" claim
    // rather than asserting a bare frame count.
    expect(frames.filter((f) => f.event === "delta")).toHaveLength(0);
    expect(frames[frames.length - 1].event).toBe("done");
    const done = frames[frames.length - 1];
    expect((done.data as { ok: boolean; text: string }).ok).toBe(true);
    expect((done.data as { ok: boolean; text: string }).text.length).toBeGreaterThan(0);
  }, 20000);

  it("emits an error frame (not a thrown 500) for chat on a nonexistent game", async () => {
    await ready;
    const r = await request(app).post("/api/game/999999/chat/stream")
      .send({ message: "hello", context: { mode: "live" } })
      .expect(200);

    const frames = parseFrames(r.text);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("error");
    expect((frames[0].data as { ok: boolean }).ok).toBe(false);
  });
});
