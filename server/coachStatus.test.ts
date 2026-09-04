import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./index";

describe("GET /api/coach/status", () => {
  it("reports a valid state and a human-readable detail", async () => {
    const res = await request(app).get("/api/coach/status").expect(200);
    const c = res.body as { state: string; detail: string; checkedAt: number };
    expect(["ready", "not-installed", "not-signed-in", "down"]).toContain(c.state);
    expect(typeof c.detail).toBe("string");
    expect(c.detail.length).toBeGreaterThan(0);
  });
});
