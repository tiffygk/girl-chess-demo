// tools/rca-eval/lib/chatServer.ts
//
// Suite ST's server harness (RCA Acceptance Evals spec, section 3 --
// "starts a real server on alt ports against a db copy, because the done
// frame only exists on the HTTP route"). Controller-approved alternative to
// raw listening ports (dispatch instruction: "use an in-process supertest-
// style app ... or a server on an ephemeral port that your test starts AND
// stops in the same test"): this is an express app that is NEVER listened
// on -- supertest binds it to an OS-assigned ephemeral port per request and
// tears it down immediately after, so no port number is ever chosen or
// held by this code, and 5173/3001 are never touched.
//
// Deliberately does NOT import server/index.ts or construct `new
// GameManager()` -- that class's `evaluator = new StockfishEvaluator()`
// field initializer spawns a REAL stockfish child process at construction
// time (the exact hazard suites/fm.ts's header comment documents, "learned
// the hard way"). Instead this mirrors ONLY the chat-relevant slice of
// manager.ts's chat()/chat/stream routes, driving chatWithCoach() directly
// -- the same pattern fm.ts's chatPipeline already established.
import express, { type Express } from "express";
import { chat as chatWithCoach, assembleChatFactList, type ChatContext } from "../../../server/coach/chat";
import { noBackend } from "../../../server/coach/backends/types";
import type { CoachBackend } from "../../../server/coach/backends/types";
import { getGame, getGameMoves, getChatMessages } from "../../../server/store/db";

export interface ChatAppOptions {
  // The backend used when body.backendPref !== "template" -- a fake for
  // template-path self-tests (ST-01/03/04), the real agentSdkBackend only
  // when the controller passes --live (suite ST's model-dependent probes,
  // ST-02 and ST-01's model variant).
  defaultBackend: CoachBackend;
}

async function runChatPipeline(
  gameId: number,
  message: string,
  context: ChatContext,
  backendPref: string | undefined,
  defaultBackend: CoachBackend,
  streamOpts?: { onDelta?: (text: string) => void; onRedraft?: () => void }
): Promise<{ ok: true; text: string; source: string; cause?: string; traceId: number } | { ok: false; error: string }> {
  const game = getGame(gameId);
  if (!game) return { ok: false, error: "no-game" };
  const moveRows = getGameMoves(gameId) as { ply: number; san: string }[];
  const gameMoves = moveRows.map((r) => ({ ply: r.ply, san: r.san }));
  const facts = assembleChatFactList(gameMoves, context);
  const historyRows = getChatMessages(gameId, 8) as { role: "user" | "coach"; text: string }[];
  const history = historyRows.map((r) => ({ role: r.role, text: r.text }));
  const backend: CoachBackend = backendPref === "template" ? noBackend : defaultBackend;
  const ply = gameMoves.length;
  const result = await chatWithCoach(message, history, facts, backend, { gameId, ply, kind: "chat" }, { onDelta: streamOpts?.onDelta, onRedraft: streamOpts?.onRedraft });
  return { ok: true, text: result.text, source: result.source, cause: result.cause, traceId: result.traceId };
}

// Builds a fresh express app wired with EXACTLY two routes -- the JSON chat
// route and its SSE sibling -- mirroring server/index.ts's own two routes'
// envelope shapes (ST-01's whole point) without ever importing that module.
export function createChatTestApp(opts: ChatAppOptions): Express {
  const app = express();
  app.use(express.json());

  app.post("/api/game/:id/chat", async (req, res) => {
    const { message, context, backendPref } = req.body;
    try {
      const result = await runChatPipeline(Number(req.params.id), String(message ?? ""), context ?? { mode: "live" }, backendPref, opts.defaultBackend);
      if (!result.ok) {
        res.status(404).json(result);
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  app.post("/api/game/:id/chat/stream", async (req, res) => {
    const { message, context, backendPref } = req.body;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    const writeFrame = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await runChatPipeline(Number(req.params.id), String(message ?? ""), context ?? { mode: "live" }, backendPref, opts.defaultBackend, {
        onDelta: (text) => writeFrame("delta", { text }),
        onRedraft: () => writeFrame("redraft", {}),
      });
      writeFrame(result.ok ? "done" : "error", result);
    } catch {
      writeFrame("error", { ok: false, error: "internal" });
    }
    res.end();
  });

  return app;
}

// Parses a supertest SSE response body (one JSON object per `data:` line)
// into {event, data} frames, in order -- shared by every ST eval that reads
// the stream route.
export function parseSseFrames(raw: string): { event: string; data: unknown }[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
      const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) throw new Error(`malformed SSE block: ${JSON.stringify(block)}`);
      return { event: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) };
    });
}
