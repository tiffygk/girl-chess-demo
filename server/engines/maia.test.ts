import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Chess } from "chess.js";
import { MaiaOpponent } from "./maia";

describe("MaiaOpponent", () => {
  const maia = new MaiaOpponent(1100);
  beforeAll(async () => { await maia.init(); }, 30000);
  afterAll(() => maia.quit());

  it("returns a legal move from the start position", async () => {
    const fen = new Chess().fen();
    const uci = await maia.pickMove(fen);
    const game = new Chess(fen);
    const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as any });
    expect(move).not.toBeNull();
  }, 15000);

  it("returns a legal move mid-game", async () => {
    const game = new Chess();
    game.move("e4"); game.move("e5"); game.move("Nf3");
    const uci = await maia.pickMove(game.fen());
    const check = new Chess(game.fen());
    expect(check.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as any })).not.toBeNull();
  }, 15000);
});
