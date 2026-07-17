import express from "express";
import { openDb, createSession, addModeMinutes } from "./store/db";
import { GameManager } from "./game/manager";

export const app = express();
app.use(express.json());

openDb(process.env.NODE_ENV === "test" ? ":memory:" : "data/girlchess.db");
const gm = new GameManager();
export const ready = gm.init();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/session", (_req, res) => res.json({ sessionId: createSession() }));

app.post("/api/game", async (req, res) => {
  const { sessionId, elo } = req.body;
  res.json(await gm.newGame(Number(sessionId), Number(elo) || 1100));
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
  const { from, to, promotion, mode } = req.body;
  try {
    const result = await gm.judgeMove(Number(req.params.id), from, to, promotion, mode);
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

app.post("/api/session/:id/mode", (req, res) => {
  const { mode, seconds } = req.body;
  addModeMinutes(Number(req.params.id), String(mode), Number(seconds) || 0);
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  ready.then(() => app.listen(3001, () => console.log("girl-chess server on :3001")));
}
