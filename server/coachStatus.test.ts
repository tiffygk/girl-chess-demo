import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "./index";
import type { Server } from "http";
import { startLoopback, closeServer } from "./loopbackServer";

// supertest against 127.0.0.1 exactly; see loopbackServer.ts.
let api: Server;
beforeAll(async () => {
  api = await startLoopback(app);
});
afterAll(() => closeServer(api));

describe("GET /api/coach/status", () => {
  it("reports a valid state and a human-readable detail", async () => {
    const res = await request(api).get("/api/coach/status").expect(200);
    const c = res.body as { state: string; detail: string; checkedAt: number };
    expect(["ready", "not-installed", "not-signed-in", "down"]).toContain(c.state);
    expect(typeof c.detail).toBe("string");
    expect(c.detail.length).toBeGreaterThan(0);
  });
});
