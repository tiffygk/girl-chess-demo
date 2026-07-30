import { describe, it, expect } from "vitest";
import request from "supertest";
import { createChatTestApp, parseSseFrames } from "./chatServer";
import { seedScratchDb, seedMinimalGame } from "./scenarioDb";
import { noBackend } from "../../../server/coach/backends/types";
import type { CoachBackend } from "../../../server/coach/backends/types";

// A fake, deterministic backend for the streaming self-test (ST-02's real
// shape without a real model call) -- generateStream fires two deltas then
// returns their concatenation, exactly the contract agent-sdk.ts's real
// implementation promises (chat.ts's own validated result, never assembled
// by concatenating deltas at the call site).
const fakeStreamingBackend: CoachBackend = {
  name: "fake-streaming",
  async available() {
    return true;
  },
  async generate() {
    throw new Error("generate() should not be called when generateStream is used");
  },
  async generateStream(_prompt, _timeoutMs, onDelta) {
    onDelta("play the knight ");
    onDelta("to f7, it is mate in two.");
    return "play the knight to f7, it is mate in two.";
  },
};

describe("createChatTestApp -- never listens on a port (supertest binds ephemeral, per request)", () => {
  it("JSON route returns the chat envelope for a forced-template turn", async () => {
    seedScratchDb("chatserver-json");
    const { gameId } = seedMinimalGame();
    const app = createChatTestApp({ defaultBackend: noBackend });
    const res = await request(app).post(`/api/game/${gameId}/chat`).send({ message: "what should i play?", backendPref: "template" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe("template");
    expect(typeof res.body.text).toBe("string");
  });

  it("stream route emits delta frames then a done frame matching the JSON envelope", async () => {
    seedScratchDb("chatserver-stream");
    const { gameId } = seedMinimalGame();
    const app = createChatTestApp({ defaultBackend: fakeStreamingBackend });
    const streamRes = await request(app).post(`/api/game/${gameId}/chat/stream`).send({ message: "what should i play?" });
    const frames = parseSseFrames(streamRes.text);
    expect(frames.map((f) => f.event)).toEqual(["delta", "delta", "done"]);
    expect((frames[2].data as { source: string }).source).toBe("model");
  });

  it("a missing game id yields a JSON 404, not a hang", async () => {
    const app = createChatTestApp({ defaultBackend: noBackend });
    const res = await request(app).post("/api/game/999999/chat").send({ message: "hello" });
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it("a missing game id yields exactly one error frame on the stream route, not a hang", async () => {
    const app = createChatTestApp({ defaultBackend: noBackend });
    const streamRes = await request(app).post("/api/game/999999/chat/stream").send({ message: "hello" });
    const frames = parseSseFrames(streamRes.text);
    expect(frames.length).toBe(1);
    expect(frames[0].event).toBe("error");
  });
});
