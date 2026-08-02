import express from "express";
import { openDb, createSession, addModeMinutes, rateAdviceTrace, getRatedTraces, listCoachNotes, deleteCoachNote } from "./store/db";
import { GameManager } from "./game/manager";
import { servedCommit } from "./version";

export const app = express();
app.use(express.json());

openDb(process.env.NODE_ENV === "test" ? ":memory:" : process.env.DB_PATH || "data/girlchess.db");
// Exported: index.test.ts (F16 chat route test) uses
// gm.setCoachBackendForTesting to inject a fake backend before hitting
// POST /api/game/:id/chat, the same seam manager.test.ts already relies on
// -- never invoke the real claude CLI / ollama from a test.
export const gm = new GameManager();
export const ready = gm.init();

app.get("/api/health", (_req, res) => res.json({ ok: true, commit: servedCommit() }));

app.post("/api/session", (_req, res) => res.json({ sessionId: createSession() }));

// Only these weights files exist in weights/; any other value makes lc0 fail
// to load and silently swaps in the strength-limited stockfish fallback
// (which floors at 1320 — the opposite of what a low-elo request wants).
export const ALLOWED_ELOS = [1100, 1200, 1300, 1400, 1500];

export function snapElo(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1100;
  return ALLOWED_ELOS.reduce((closest, band) =>
    Math.abs(band - n) < Math.abs(closest - n) ? band : closest
  );
}

app.post("/api/game", async (req, res) => {
  const { sessionId, elo } = req.body;
  res.json(await gm.newGame(Number(sessionId), snapElo(elo)));
});

app.post("/api/game/:id/move", async (req, res) => {
  const { from, to, promotion, timeSpentMs, override, deltaCp, mateAgainst } = req.body;
  try {
    const result = await gm.playerMove(
      Number(req.params.id),
      from,
      to,
      promotion,
      timeSpentMs ?? 0,
      // C4: override logging — only ever set when the client marks the
      // confirm as an override (a "warning"-tier confirm; see
      // isOverrideConfirm in src/game/moveFlow.ts). Omitted entirely for an
      // ordinary /move so normal play writes no game_events row.
      override ? { deltaCp: deltaCp ?? null, mateAgainst: Boolean(mateAgainst) } : undefined
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Highlight-a-move (Task 1): the player flags a move (her own, up to three
// back) she wasn't sure about during live play. Sync passthrough to
// gm.highlightMove -- no engine call, same shape-check-then-call convention
// as /api/trace/:id/rate above.
app.post("/api/game/:id/move/:ply/highlight", (req, res) => {
  const gameId = Number(req.params.id);
  const ply = Number(req.params.ply);
  const { highlighted } = req.body ?? {};
  if (!Number.isInteger(gameId) || !Number.isInteger(ply) || ply < 1) {
    res.status(400).json({ error: "bad game id or ply" });
    return;
  }
  if (typeof highlighted !== "boolean") {
    res.status(400).json({ error: "highlighted must be a boolean" });
    return;
  }
  gm.highlightMove(gameId, ply, highlighted);
  res.json({ ok: true });
});

app.post("/api/game/:id/judge", async (req, res) => {
  // `strictness` (Task 6, F10 tuning — UI label "judge strictness"):
  // optional, appended after `mode` same as that field's own convention;
  // gm.judgeMove defaults an omitted/unrecognized value to "standard".
  const { from, to, promotion, mode, strictness } = req.body;
  try {
    const result = await gm.judgeMove(Number(req.params.id), from, to, promotion, mode, strictness);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

app.post("/api/game/:id/resign", async (req, res) => {
  try {
    const result = await gm.resign(Number(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

app.post("/api/game/:id/draw-offer", async (req, res) => {
  try {
    const result = await gm.offerDraw(Number(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Wave C, task C-A: the single "end the game?" flow. Both the arm-step
// preview and the second-click execution hit this same route — execute
// just tells the server whether to actually finish the game with the
// decision it just derived, never something the client gets to remember
// and hand back.
app.post("/api/game/:id/adjudicate", async (req, res) => {
  const { execute } = req.body;
  try {
    const result = await gm.adjudicate(Number(req.params.id), Boolean(execute));
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 2.5: compute a deep, verified hint for the game's live position.
// Separate from POST /:id/hint below, which stays the fire-and-forget
// reveal-logging seam for the Lab's hint-escalation metric.
app.post("/api/game/:id/hint-facts", async (req, res) => {
  try {
    res.json(await gm.computeHint(Number(req.params.id)));
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Wave C, task C-B: fire-and-forget observability for the Lab's
// hint-escalation metric — one game_events row per hint reveal.
app.post("/api/game/:id/hint", (req, res) => {
  // Wave 0, item 1 (F0): the client now names the move field it means --
  // `bestUci` for the coach's own best move, `refutationUci` for the
  // opponent's threat move a levels-1-3 hint reveals. Pass through
  // whichever the body actually carries rather than forcing everything
  // through the `bestUci` key regardless of what it names.
  // Wave 2 (item 2): `branch` ("right"/"wrong") is passed through the same
  // additive way -- present on every press log, absent on the level-0
  // invalid-hint log.
  const { level, tier, deltaCp, bestUci, refutationUci, fen, branch } = req.body;
  try {
    const result = gm.logHint(Number(req.params.id), {
      level: Number(level),
      tier: String(tier),
      deltaCp: deltaCp ?? null,
      ...(bestUci !== undefined ? { bestUci: String(bestUci) } : {}),
      ...(refutationUci !== undefined ? { refutationUci: String(refutationUci) } : {}),
      ...(branch !== undefined ? { branch: String(branch) } : {}),
      fen: String(fen),
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3a Wave 2: async coach narration. Same error envelope as the
// other routes; never throws past gm.narrate (that method itself never
// throws either — worst case is a template-sourced string), so the 500
// branch here is purely defensive.
app.post("/api/game/:id/narrate", async (req, res) => {
  const { herPiece, from, to, tier, deltaCp, mateBefore, mateAfter, threat, best, recommendation, backendPref } = req.body;
  try {
    const result = await gm.narrate(Number(req.params.id), {
      herPiece,
      from,
      to,
      tier,
      deltaCp: deltaCp ?? null,
      // Wave 1 (item 2 -- typed mate): thread the typed mate distance through
      // to assembleFactList so the coach prompt prefers it over the folded
      // deltaCp. Coerce undefined -> null so absence is explicit on the wire.
      mateBefore: mateBefore ?? null,
      mateAfter: mateAfter ?? null,
      threat,
      best,
      recommendation,
      backendPref,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3.9, F16: this-game grounding chat. Mirrors narrate's envelope
// (ok:true/false, never a thrown error past gm.chat -- that method's own
// chat() call never throws either, worst case is a template-sourced
// redirect string, so the 500 branch here is purely defensive). Task 5
// (F17): backendPref is now threaded straight through to gm.chat, which
// hands it to pickCoachBackend (per-pref cache — see manager.ts).
app.post("/api/game/:id/chat", async (req, res) => {
  const { message, context, backendPref } = req.body;
  try {
    const result = await gm.chat(Number(req.params.id), {
      message: String(message ?? ""),
      context: context ?? { mode: "live" },
      backendPref,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// B-stream (2026-07-27, coach-truth-speed round). Owner's verbatim ask: "if
// there's anything else we can do to make these answers faster" -- game
// 146's three thumbs-up replies took 38.4s/39.7s/24.3s and the client
// rendered NOTHING until the terminal result. Streaming doesn't shorten
// generation; it makes the wait legible, which is what reads as "faster".
// This is a NEW route, not a replacement -- POST /api/game/:id/chat above is
// untouched and stays the client's fallback if the stream never opens.
// SSE-over-POST rather than EventSource: EventSource can only GET, and the
// chat body (message + full ChatContext, sometimes carrying a focused
// turning-point's whole pv) is too large/shaped for a query string.
// Frames, one JSON object per SSE `data:` line, `event:` naming the kind:
//   status  {phase}                         -- Task 1c (2026-08-02): staged
//           perceived-progress chip, REAL pipeline events only, NEVER
//           carries prose. phase is "thinking" (an attempt just started --
//           attempt 0) | "redrafting" (an attempt just started -- attempt
//           1, alongside the existing `redraft` frame below) | "checking"
//           (the backend returned, validateChat is about to run) |
//           "drafting" (the FIRST buffered delta of a validated answer is
//           about to replay). Owner ruling stands: no unvalidated prose is
//           ever shown, so "drafting" can only ever fire AFTER "checking"
//           has already passed for that attempt -- chat.ts's buffered-
//           flush-after-validation behaviour is unchanged by this frame.
//   delta   {text}                         -- advisory rendering only
//   redraft {}                              -- the one-regen attempt is starting
//   done    the exact gm.chat() return value (same object the JSON route
//           above sends via res.json) -- ok:true incl. text/source/cause/
//           traceId, so the two routes' envelopes can never drift apart
//   error   the exact gm.chat() ok:false value, or {ok:false,error:"internal"}
//           on a thrown error, mirroring the JSON route's catch branch
// Persistence/trace-writing ordering is entirely gm.chat's/chat.ts's own
// concern, unchanged by this route: the coach row still writes once, after
// the terminal result, still gated on source === "model" (B3b).
app.post("/api/game/:id/chat/stream", async (req, res) => {
  const { message, context, backendPref } = req.body;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const writeFrame = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Task 1c: attemptCount distinguishes attempt 0 ("thinking") from a regen
  // ("redrafting") purely by call order -- chat.ts's onAttemptStart carries
  // no argument on purpose (see its own comment), the same way onRedraft
  // already signals "attempt 1 began" without an argument. firstDeltaSeen
  // gates the one-time "drafting" status frame that precedes the delta
  // replay -- both are per-request closures, fresh on every call.
  let attemptCount = 0;
  let firstDeltaSeen = false;

  try {
    const result = await gm.chat(
      Number(req.params.id),
      {
        message: String(message ?? ""),
        context: context ?? { mode: "live" },
        backendPref,
      },
      {
        onDelta: (text) => {
          if (!firstDeltaSeen) {
            firstDeltaSeen = true;
            writeFrame("status", { phase: "drafting" });
          }
          writeFrame("delta", { text });
        },
        onRedraft: () => writeFrame("redraft", {}),
        onAttemptStart: () => {
          attemptCount += 1;
          writeFrame("status", { phase: attemptCount === 1 ? "thinking" : "redrafting" });
        },
        onValidateStart: () => writeFrame("status", { phase: "checking" }),
      }
    );
    writeFrame(result.ok ? "done" : "error", result);
  } catch (error) {
    writeFrame("error", { ok: false, error: "internal" });
  }
  res.end();
});

// Increment 3.9, Task 4 (F19): thumbs up/down with feedback capture on
// traced coach outputs. Scope per declared cut #3: any advice_traces row
// (narrations, chat replies -- including template/redirect ones, which DO
// have traces) is fair game for rating; the route itself doesn't care which
// endpoint produced the trace. Synchronous accessor -- rateAdviceTrace
// returns false (no throw) for an unknown id, which maps straight to
// { ok: false }; re-rating overwrites, latest wins (see rateAdviceTrace's
// comment in store/db.ts).
app.post("/api/trace/:id/rate", (req, res) => {
  const { rating, feedback } = req.body;
  // Reviewer fix (Task 4 follow-up): only exactly 1 or -1 is a valid
  // rating -- a missing/garbage/0/2 value must be rejected with no write,
  // never silently folded into a thumbs-up. F19 exists to capture exact
  // player feedback; laundering a malformed request into +1 would pollute
  // that dataset with ratings nobody actually gave.
  if (rating !== 1 && rating !== -1) {
    res.json({ ok: false });
    return;
  }
  try {
    const ok = rateAdviceTrace(Number(req.params.id), rating, feedback);
    res.json({ ok });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

// Wave 4, item 2 (2026-08-01): GET /api/traces/rated?rating=1 -- the Lab-side
// read path for ratings, sibling of the /api/trace/:id/rate write route above.
// Same 1|-1 validation the rate route enforces (a missing/garbage value gets
// no query, a 400). Optional ?game=<id> narrows to one game; omitted, it reads
// every game. Read-only, sync, same try/catch envelope as every other route.
// Deliberately a VIEWER only -- it never feeds a rated answer back into a
// prompt (see getRatedTraces' comment / the manager.ts doom-loop note).
app.get("/api/traces/rated", (req, res) => {
  const rating = Number(req.query.rating);
  if (rating !== 1 && rating !== -1) {
    res.status(400).json({ ok: false });
    return;
  }
  // Review residual (Minor, 2026-08-01): a present-but-non-numeric ?game=
  // (Number("abc") -> NaN) used to slip through to an empty 200; it now 400s,
  // consistent with the rating validation above. Absent game stays null (all
  // games).
  let gameId: number | null = null;
  if (req.query.game !== undefined) {
    gameId = Number(req.query.game);
    if (!Number.isInteger(gameId)) {
      res.status(400).json({ ok: false });
      return;
    }
  }
  try {
    res.json({ ok: true, traces: getRatedTraces(gameId, rating) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Wave 4, item 3 (2026-08-01): cross-game memory management for the owner.
// GET lists the newest notes (the same list the coach's prompt reads); DELETE
// removes one by id. Minimal, Lab-style, read/write only -- the WRITE side
// (recording a note from a "please record this" message) lives in the chat
// flow (manager.ts), not here.
app.get("/api/coach-notes", (_req, res) => {
  try {
    res.json({ ok: true, notes: listCoachNotes() });
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});
app.delete("/api/coach-notes/:id", (req, res) => {
  try {
    res.json({ ok: deleteCoachNote(Number(req.params.id)) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3b: panel-ruled turning points + move classifications, computed
// and persisted at game end (see manager.ts's persistGameSummary), read
// here. Sync — no engine call either path (persisted rows or compute-on-read
// fallback for old games) — but wrapped in the same try/catch envelope as
// every other route for consistency.
app.get("/api/game/:id/summary", (req, res) => {
  try {
    res.json(gm.getSummary(Number(req.params.id)));
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3.91 (Task 2): additive — exposes the persisted Stockfish
// best-move/pv per turning point (see manager.ts's getTurningLines). Sync
// (reads only, same as /summary above), same try/catch envelope as every
// other route. Deliberately its own route rather than folded into
// /summary, so 3.9's getSummary shape never changes.
app.get("/api/game/:id/turning-lines", (req, res) => {
  try {
    res.json(gm.getTurningLines(Number(req.params.id)));
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3c: GET /api/games — the "past games" / saved-games menu list.
// Finished games only, newest first, capped at 30 inside listGames/
// listFinishedGames. Sync, same try/catch envelope as every other route.
app.get("/api/games", (_req, res) => {
  try {
    res.json(gm.listGames());
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Wave 3.5, item 2 (owner ask, 2026-08-01): DELETE /api/game/:id -- real
// per-game deletion for the past-games drawer's delete X. gm.deleteGame does
// the actual guard/sweep; the route's own job is only mapping its ok:false
// to a status code, same "server re-derives the real outcome, client's own
// view is never trusted" discipline as /adjudicate above.
// Wave 3.5 fix (Minor, review 2026-08-01): reason:"not-found" (an id that
// was never a game) answers 404; reason:"live" (exists but isn't over yet)
// keeps the original 409 -- these are different facts and shouldn't share a
// status code.
app.delete("/api/game/:id", (req, res) => {
  try {
    const result = gm.deleteGame(Number(req.params.id));
    if (!result.ok) {
      res.status(result.reason === "not-found" ? 404 : 409).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

// Increment 3.91 (Task 5): stateless explore-reply — the "try the line"
// sandbox's engine move. No gameId, no persisted game: gm.exploreReply
// (server/game/manager.ts) calls maia.pickMove at the snapped elo and
// applies it to a throwaway Chess(fen), writing NOTHING to any table.
app.post("/api/explore/reply", async (req, res) => {
  const { fen, elo } = req.body;
  try {
    const result = await gm.exploreReply(String(fen), snapElo(elo));
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: "internal" });
  }
});

app.post("/api/session/:id/mode", (req, res) => {
  const { mode, seconds } = req.body;
  addModeMinutes(Number(req.params.id), String(mode), Number(seconds) || 0);
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  const PORT = Number(process.env.PORT) || 3001;
  ready.then(() => app.listen(PORT, () => console.log(`girl-chess server on :${PORT} (commit ${servedCommit()})`)));
}
