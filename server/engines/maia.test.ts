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

  // task B9 fix wave: server/game/manager.ts's opponentFor() caches ONE
  // MaiaOpponent per ELO band and reuses it across EVERY game for the
  // server's process lifetime -- it is not a fresh instance per game (see
  // task-b9-report.md, "Fix wave" section, correcting the original report's
  // wrong claim to the contrary). Investigation found that lc0's
  // temperature-sampling RNG is not independently reseeded per `go nodes 1`
  // call: it draws from a single stream that advances with call count, and
  // a warmed instance can hit stretches where that stream degenerates --
  // the SAME position returning the SAME reply on EVERY query for dozens of
  // consecutive calls (measured empirically: 40/40 identical replies at one
  // call-count window, ~250 calls into a session). This is genuine variance
  // decay, not a measurement artifact -- see the report for the full
  // characterization (probes 1-7).
  //
  // Fix: pickMove() now sends `ucinewgame` before every query when not on
  // the fallback engine (see maia.ts). This was verified to prevent the
  // collapse entirely across 1600+ sustained calls during investigation.
  // This test is the regression check: warm the SHARED `maia` instance
  // (same one already exercised by the tests above) across several dozen
  // distinct self-play positions -- mirroring how opponentFor's cached
  // instance accumulates call history across many real games -- then
  // confirm a fixed reference position still varies under repeated query.
  //
  // Statistical sizing: the worst single-move policy share observed across
  // 1600+ warmed-instance draws during investigation was ~33% (13/40 at one
  // checkpoint). Even at a conservative assumed 50% share for the top move,
  // P(20/20 identical replies) <= 0.5^20 ~= 9.5e-7 -- a negligible
  // false-failure rate for this assertion.
  it("retains reply variance on a warmed, shared instance across many prior distinct positions", async () => {
    const openingSeeds = [
      ["d4", "d5", "c4"],
      ["Nf3", "Nf6", "g3"],
      ["e4", "c5", "Nf3"],
      ["c4", "e5", "Nc3"],
    ];
    for (const seed of openingSeeds) {
      const game = new Chess();
      for (const m of seed) game.move(m);
      for (let ply = 0; ply < 10 && !game.isGameOver(); ply++) {
        const uci = await maia.pickMove(game.fen());
        const move = game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4] as any,
        });
        if (!move) break;
      }
    }

    const ref = new Chess();
    ref.move("e4");
    const fen = ref.fen();
    const replies = new Set<string>();
    for (let i = 0; i < 20; i++) {
      replies.add(await maia.pickMove(fen));
    }
    expect(replies.size).toBeGreaterThan(1);
  }, 60000);
});
