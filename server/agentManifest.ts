// B1.3 (live-telemetry round, 2026-09-22): the single machine-readable
// description of the telemetry this round adds, so an agent that knows only
// the port can discover the health/state/manifest endpoints, the trace
// tools, and the data-gc attribute vocabulary the client renders --
// without reading source or vision-reading the board. Served at
// GET /api/agent/manifest (server/index.ts) and asserted by tools/doctor.ts.
//
// The dataGcAttributes list below is the CANONICAL declaration of those
// attribute names (owner's B1.3 pin, verbatim). Wave B2 builds
// src/agent/dataGc.ts's DATA_GC map and a two-way test asserting its keys
// agree with this list -- so a name changed here without updating that
// wiring is a red B2 test, not a silent drift (the "check must cover every
// surface that claims it" class of bug this repo has hit before).

export type ManifestEndpoint = { method: "GET" | "POST"; path: string; description: string };
export type ManifestTraceTool = { command: string; description: string };

export const AGENT_MANIFEST: {
  endpoints: ManifestEndpoint[];
  traceTools: ManifestTraceTool[];
  dataGcAttributes: string[];
} = {
  endpoints: [
    {
      method: "GET",
      path: "/api/health",
      description: "process freshness: ok, commit, loadedCommit, startedAt (process boot time -- the trustworthy freshness signal)",
    },
    {
      method: "GET",
      path: "/api/game/:id/state",
      description: "live fen, ply, sideToMove, result, lastVerdict, and coachBreaker for one game",
    },
    {
      method: "GET",
      path: "/api/agent/manifest",
      description: "this manifest",
    },
  ],
  traceTools: [
    { command: "npm run dossier", description: "one-command dossier for a coach chat trace by id" },
    { command: "npm run tail", description: "tail live trace/log output" },
  ],
  // Pinned exactly as spelled -- do not reorder or rename without updating
  // wave B2's src/agent/dataGc.ts and its two-way agreement test.
  dataGcAttributes: [
    "data-gc-fen",
    "data-gc-side",
    "data-gc-pending",
    "data-gc-arrows",
    "data-gc-hint-level",
    "data-gc-hint-visible",
    "data-gc-trace-id",
    "data-gc-postgame",
    "data-gc-turning-count",
  ],
};
