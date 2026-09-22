// B1.3 (live-telemetry round, 2026-09-22): the manifest is the single
// machine-readable description of this wave's telemetry surfaces, so an
// agent that knows only the port can discover them without reading source.
// RED if any of the three endpoints or nine data-gc attribute names is
// dropped (verified by deleting one entry from AGENT_MANIFEST and watching
// the corresponding assertion fail, then reverting).
import { describe, it, expect } from "vitest";
import request from "supertest";
import { AGENT_MANIFEST } from "./agentManifest";
import { app } from "./index";

describe("AGENT_MANIFEST", () => {
  it("lists all three telemetry endpoints", () => {
    const paths = AGENT_MANIFEST.endpoints.map((e) => e.path);
    expect(paths).toContain("/api/health");
    expect(paths).toContain("/api/game/:id/state");
    expect(paths).toContain("/api/agent/manifest");
    expect(paths).toHaveLength(3);
  });

  it("lists the trace tools", () => {
    const commands = AGENT_MANIFEST.traceTools.map((t) => t.command);
    expect(commands).toContain("npm run dossier");
    expect(commands).toContain("npm run tail");
  });

  // B1.3's pinned attribute names -- wave B2's src/agent/dataGc.ts (DATA_GC)
  // must declare exactly this same set; its own two-way test asserts
  // agreement against this list, so this list is the canonical source.
  it("lists all nine pinned data-gc attribute names, exactly as spelled", () => {
    expect(AGENT_MANIFEST.dataGcAttributes).toEqual([
      "data-gc-fen",
      "data-gc-side",
      "data-gc-pending",
      "data-gc-arrows",
      "data-gc-hint-level",
      "data-gc-hint-visible",
      "data-gc-trace-id",
      "data-gc-postgame",
      "data-gc-turning-count",
    ]);
  });
});

// No afterAll(gm.shutdown()) here -- this route touches no engine, and
// resume.test.ts/index.test.ts already own the shared gm singleton's
// teardown; an extra shutdown() call here (observed once) produced an
// unhandled "uci engine quit" rejection from a concurrent file's in-flight
// search racing this file's redundant quit.
describe("GET /api/agent/manifest", () => {
  it("serves AGENT_MANIFEST verbatim", async () => {
    const res = await request(app).get("/api/agent/manifest").expect(200);
    expect(res.body).toEqual(AGENT_MANIFEST);
  });
});
