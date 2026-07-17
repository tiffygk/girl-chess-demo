import express from "express";

export const app = express();
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV !== "test") {
  app.listen(3001, () => console.log("girl-chess server on :3001"));
}
