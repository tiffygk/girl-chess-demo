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

  it("engages the fallback when weights are missing, and still plays a legal move", async () => {
    const broken = new MaiaOpponent(9999); // no weights/maia-9999.pb.gz exists
    await broken.init();
    expect(broken.fallback).toBe(true);
    const fen = new Chess().fen();
    const uci = await broken.pickMove(fen);
    const check = new Chess(fen);
    expect(check.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as any })).not.toBeNull();
    broken.quit();
  }, 40000);

  // task B9: MAIA_TEMPERATURE=1.0 makes lc0 sample the root move instead of taking
  // the policy argmax. Sampling must never produce an illegal move, so play a full
  // game's worth of plies against chess.js legality.
  it("plays ~20 legal moves in a row under policy-temperature sampling", async () => {
    const game = new Chess();
    for (let i = 0; i < 20 && !game.isGameOver(); i++) {
      const uci = await maia.pickMove(game.fen());
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] as any,
      });
      expect(move, `move ${i + 1} (${uci}) should be legal`).not.toBeNull();
    }
  }, 60000);

  // Variance probe: the same position queried 5 times should NOT always return the
  // same reply at Temperature=1.0 (argmax, Temperature=0, would be identical every
  // time). This is the sanity check called out in the task B9 brief.
  //
  // Uses its own MaiaOpponent instance rather than the shared `maia` above: lc0's
  // root-sampling RNG is advanced by a running count of `go nodes 1` calls rather
  // than reseeded per query (empirically verified during investigation -- see
  // task-b9-report.md), so probing right after a fresh engine start gives a clean,
  // reproducible read on variance instead of one entangled with how many prior
  // draws the shared engine already made in earlier tests.
  it("varies its reply across repeated queries of the same position (temperature sampling)", async () => {
    const probe = new MaiaOpponent(1100);
    await probe.init();
    try {
      const game = new Chess();
      game.move("e4");
      const fen = game.fen();
      const replies = new Set<string>();
      for (let i = 0; i < 5; i++) {
        replies.add(await probe.pickMove(fen));
      }
      expect(replies.size).toBeGreaterThan(1);
    } finally {
      probe.quit();
    }
  }, 30000);
});
