import { describe, it, expect } from "vitest";
import request from "supertest";
import { servedCommit } from "./version";
import { app } from "./index";

describe("servedCommit", () => {
  it("returns a short git SHA or the literal 'unknown'", () => {
    const commit = servedCommit();
    expect(commit).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
  });
});

describe("/api/health commit field", () => {
  it("reports the served commit", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.commit).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
  });
});
