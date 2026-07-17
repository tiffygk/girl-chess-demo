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
  const { from, to, promotion, timeSpentMs } = req.body;
  try {
    const result = await gm.playerMove(Number(req.params.id), from, to, promotion, timeSpentMs ?? 0);
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

app.post("/api/session/:id/mode", (req, res) => {
  const { mode, seconds } = req.body;
  addModeMinutes(Number(req.params.id), String(mode), Number(seconds) || 0);
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== "test") {
  ready.then(() => app.listen(3001, () => console.log("girl-chess server on :3001")));
}
