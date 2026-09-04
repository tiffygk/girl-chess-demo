import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, ready } from "./index";
import { isLocalOrigin } from "./originGuard";

describe("isLocalOrigin", () => {
  it("allows a request with no Origin header (same-origin GET, curl, the Vite proxy)", () => {
    expect(isLocalOrigin(undefined)).toBe(true);
  });
  it("allows loopback origins on any port", () => {
    for (const o of ["http://localhost:5173", "http://127.0.0.1:4173", "http://[::1]:5173", "http://localhost"]) {
      expect(isLocalOrigin(o), o).toBe(true);
    }
  });
  it("rejects foreign, look-alike, opaque and malformed origins", () => {
    for (const o of ["https://evil.example", "http://localhost.evil.example:5173", "null", "not a url", ""]) {
      expect(isLocalOrigin(o), o).toBe(false);
    }
  });
});

describe("originGuard on /api", () => {
  it("returns 403 for a body-less POST from a foreign origin before the route runs", async () => {
    await ready;
    const r = await request(app).post("/api/game/1/resign").set("Origin", "https://evil.example");
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ ok: false, error: "forbidden_origin" });
  });
  it("lets the Vite dev origin through", async () => {
    await ready;
    const r = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  it("lets a request with no Origin through", async () => {
    await ready;
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
  });
});
