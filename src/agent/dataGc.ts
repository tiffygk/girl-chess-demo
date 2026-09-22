// B2.1 (live-telemetry round, 2026-09-22): the client-side half of the
// data-gc-* vocabulary B1.3 pinned in server/agentManifest.ts's
// AGENT_MANIFEST.dataGcAttributes. This map is the single source of truth
// for the attribute NAMES on the client -- every stamping site (Board.tsx,
// GamePage.tsx, CoachChat.tsx, DebriefPage.tsx) imports DATA_GC and uses
// its values, never a string literal, so a rename here is the only place
// that needs to change. dataGc.test.tsx's two-way test asserts this map's
// values agree with the manifest's list; if they ever diverge, reconcile
// THIS map to match the manifest (the manifest is the prior canonical
// declaration -- never silently edit the manifest to match this file).
export const DATA_GC = {
  fen: "data-gc-fen",
  side: "data-gc-side",
  pending: "data-gc-pending",
  arrows: "data-gc-arrows",
  hintLevel: "data-gc-hint-level",
  hintVisible: "data-gc-hint-visible",
  traceId: "data-gc-trace-id",
  postgame: "data-gc-postgame",
  turningCount: "data-gc-turning-count",
} as const;
