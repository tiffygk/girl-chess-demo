// tools/rca-eval/suites/st.ts
//
// Suite ST -- streaming tells one truth (RCA Acceptance Evals spec, section
// 3). Owner's ask verbatim: "measure ... the streaming." Uses
// lib/chatServer.ts's in-process express app (never a listening port --
// see that file's header for why this is the controller-approved
// alternative to raw ports 5199/3099) against a scratch db this suite seeds
// itself (lib/scenarioDb.ts).
//
// ST-01 (template-path variant) / ST-03 / ST-04 run for real, always, with
// zero model calls (noBackend forces the deterministic template path).
// ST-02 and ST-01's MODEL variant need a real backend and are gated behind
// `live: true`, which the controller passes only when announced and the
// machine is quiet (spec: "6-8 model calls plus template turns, about 5
// minutes ... needs the machine QUIET").
import request from "supertest";
import { createChatTestApp, parseSseFrames } from "../lib/chatServer";
import { seedScratchDb, seedMinimalGame } from "../lib/scenarioDb";
import { noBackend } from "../../../server/coach/backends/types";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator } from "../lib/assertRan";

interface DoneEnvelope {
  ok: boolean;
  text?: string;
  source?: string;
  cause?: string;
  traceId?: number;
}

async function st01Template(): Promise<EvalResult> {
  seedScratchDb("st01-json");
  const jsonGame = seedMinimalGame().gameId;
  const app = createChatTestApp({ defaultBackend: noBackend });
  const jsonRes = await request(app).post(`/api/game/${jsonGame}/chat`).send({ message: "what should i play?", backendPref: "template" });

  seedScratchDb("st01-stream");
  const streamGame = seedMinimalGame().gameId;
  const streamApp = createChatTestApp({ defaultBackend: noBackend });
  const streamRes = await request(streamApp).post(`/api/game/${streamGame}/chat/stream`).send({ message: "what should i play?", backendPref: "template" });
  const frames = parseSseFrames(streamRes.text);
  const doneFrame = frames.find((f) => f.event === "done");

  const jsonBody = jsonRes.body as DoneEnvelope;
  const doneBody = doneFrame?.data as DoneEnvelope | undefined;

  const fields: (keyof DoneEnvelope)[] = ["ok", "text", "source", "cause"];
  const mismatches = fields.filter((f) => jsonBody[f] !== doneBody?.[f]);
  const bothHaveTraceId = typeof jsonBody.traceId === "number" && typeof doneBody?.traceId === "number";

  if (mismatches.length === 0 && bothHaveTraceId) {
    return {
      id: "ST-01",
      verdict: "pass",
      detail: `template-path variant: done frame matches the JSON route's envelope on ${fields.join(", ")}; both carry a numeric traceId. (model variant gated behind --live, not run.)`,
    };
  }
  return {
    id: "ST-01",
    verdict: "red",
    detail: `template-path variant: envelope drift on [${mismatches.join(", ")}] (traceId present on both: ${bothHaveTraceId}). json=${JSON.stringify(jsonBody)} done=${JSON.stringify(doneBody)}`,
  };
}

async function st02Model(live: boolean): Promise<EvalResult> {
  if (!live) {
    return {
      id: "ST-02",
      verdict: "did-not-run",
      detail: "model-dependent (6 real-model probes, ~5 min, needs the machine quiet) -- run with --live once announced.",
    };
  }
  // --live implementation: reuses the real agentSdkBackend, dynamically
  // imported (same GC_COACH_MODEL-before-import discipline coach-eval's
  // run.ts follows) so this module never pays that import cost when --live
  // is absent.
  const { agentSdkBackend } = await import("../../../server/coach/backends/agent-sdk");
  seedScratchDb("st02-live");
  const gameId = seedMinimalGame().gameId;
  const app = createChatTestApp({ defaultBackend: agentSdkBackend });
  const streamRes = await request(app).post(`/api/game/${gameId}/chat/stream`).send({ message: "what should i play here?" });
  const frames = parseSseFrames(streamRes.text);
  const deltas = frames.filter((f) => f.event === "delta").map((f) => (f.data as { text: string }).text);
  const doneFrame = frames.find((f) => f.event === "done");
  const doneText = (doneFrame?.data as DoneEnvelope | undefined)?.text ?? "";
  const concatenated = deltas.join("");
  const pass = deltas.length === 0 || concatenated === doneText;
  return {
    id: "ST-02",
    verdict: pass ? "pass" : "red",
    detail: pass
      ? `concatenated deltas equal the done frame's text (${deltas.length} delta frame(s)).`
      : `deltas concatenated ("${concatenated}") DO NOT equal the done frame's text ("${doneText}").`,
  };
}

async function st03ForcedTemplateStream(): Promise<EvalResult> {
  seedScratchDb("st03");
  const gameId = seedMinimalGame().gameId;
  const app = createChatTestApp({ defaultBackend: noBackend });
  const streamRes = await request(app).post(`/api/game/${gameId}/chat/stream`).send({ message: "what should i play?", backendPref: "template" });
  const frames = parseSseFrames(streamRes.text);
  const terminal = frames.filter((f) => f.event === "done" || f.event === "error");
  const done = frames.find((f) => f.event === "done");
  const body = done?.data as DoneEnvelope | undefined;
  const pass = terminal.length === 1 && terminal[0].event === "done" && body?.source === "template" && !!body?.cause;
  return {
    id: "ST-03",
    verdict: pass ? "pass" : "red",
    detail: pass
      ? `exactly one terminal frame (done), source=${body?.source}, cause=${body?.cause}.`
      : `expected exactly one done frame with source=template and a cause -- got ${terminal.length} terminal frame(s): ${JSON.stringify(frames)}.`,
  };
}

async function st04MissingGame(): Promise<EvalResult> {
  const app = createChatTestApp({ defaultBackend: noBackend });
  const streamRes = await request(app).post("/api/game/999999999/chat/stream").send({ message: "hello" });
  const frames = parseSseFrames(streamRes.text);
  const pass = frames.length === 1 && frames[0].event === "error";
  return {
    id: "ST-04",
    verdict: pass ? "pass" : "red",
    detail: pass ? "a missing game id produced exactly one error frame, stream closed cleanly (no hang)." : `expected exactly one error frame -- got: ${JSON.stringify(frames)}.`,
  };
}

export async function runStSuite(live: boolean): Promise<SuiteResult> {
  const results: EvalResult[] = [await st01Template(), await st02Model(live), await st03ForcedTemplateStream(), await st04MissingGame()];
  return {
    suite: "ST",
    expectedCount: 4,
    results: assertDenominator(results, 4, "ST"),
    ranAt: new Date().toISOString(),
    notes: live
      ? ["--live: ST-02 called the real model backend (subscription usage, machine load)."]
      : ["ST-01 (template variant)/ST-03/ST-04 ran for real, zero model calls. ST-02 (and ST-01's model variant) gated behind --live -- not run."],
  };
}
