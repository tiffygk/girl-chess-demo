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

// B1.1 (live-telemetry round, 2026-09-22): RED if startedAt/loadedCommit are
// dropped from the route (verified by reverting the index.ts change and
// watching this fail on the missing fields before re-adding it).
describe("/api/health freshness fields", () => {
  it("reports startedAt as an ISO timestamp and loadedCommit alongside commit", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(res.body.loadedCommit).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
    expect(res.body.commit).toBe(res.body.loadedCommit);
  });
});
