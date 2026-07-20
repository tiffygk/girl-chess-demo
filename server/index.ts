import express from "express";
import { openDb, createSession, addModeMinutes, rateAdviceTrace } from "./store/db";
import { GameManager } from "./game/manager";

export const app = express();
app.use(express.json());

openDb(process.env.NODE_ENV === "test" ? ":memory:" : "data/girlchess.db");
// Exported: index.test.ts (F16 chat route test) uses
// gm.setCoachBackendForTesting to inject a fake backend before hitting
// POST /api/game/:id/chat, the same seam manager.test.ts already relies on
// -- never invoke the real claude CLI / ollama from a test.
export const gm = new GameManager();
export const ready = gm.init();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
  const { level, tier, deltaCp, bestUci, fen } = req.body;
  try {
    const result = gm.logHint(Number(req.params.id), {
      level: Number(level),
      tier: String(tier),
      deltaCp: deltaCp ?? null,
      bestUci: String(bestUci),
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
  const { herPiece, from, to, tier, deltaCp, threat, best, recommendation, backendPref } = req.body;
  try {
    const result = await gm.narrate(Number(req.params.id), {
      herPiece,
      from,
      to,
      tier,
      deltaCp: deltaCp ?? null,
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

app.post("/api/session/:id/mode", (req, res) => {
  const { mode, seconds } = req.body;
  addModeMinutes(Number(req.params.id), String(mode), Number(seconds) || 0);
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  ready.then(() => app.listen(3001, () => console.log("girl-chess server on :3001")));
}
