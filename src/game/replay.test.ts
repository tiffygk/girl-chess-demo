import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { replayPlan } from "./replay";

function play(moves: string[]) {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  return chess;
}

describe("replayPlan", () => {
  it("caps at the last 4 plies of a longer game", () => {
    const chess = play(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"]);
    const history = chess.history({ verbose: true });
    const plan = replayPlan(history, 4);

    expect(plan.moves).toHaveLength(4);
    expect(plan.moves.map((m) => m.san)).toEqual(history.slice(4).map((m) => m.san));
    expect(plan.startFen).toBe(plan.moves[0].before);
    expect(plan.startFen).toBe(history[history.length - 4].before);
  });

  it("replays from the very start when the game is shorter than the requested plies", () => {
    const chess = play(["e4", "e5"]);
    const history = chess.history({ verbose: true });
    const plan = replayPlan(history, 4);

    expect(plan.moves).toHaveLength(2);
    expect(plan.moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    expect(plan.startFen).toBe(new Chess().fen());
  });

  it("returns an empty plan for a game with no moves", () => {
    const plan = replayPlan([], 4);
    expect(plan.moves).toEqual([]);
    expect(plan.startFen).toBe("");
  });

  it("respects a custom plies count", () => {
    const chess = play(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    const history = chess.history({ verbose: true });
    const plan = replayPlan(history, 2);

    expect(plan.moves.map((m) => m.san)).toEqual(["Nc6", "Bb5"]);
    expect(plan.startFen).toBe(history[history.length - 2].before);
  });

  it("includes a castling ply intact when it falls within the last 4 plies", () => {
    const chess = play(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"]);
    const history = chess.history({ verbose: true });
    const plan = replayPlan(history, 4);

    const castle = plan.moves.find((m) => m.isKingsideCastle());
    expect(castle).toBeDefined();
    expect(castle!.san).toBe("O-O");
    expect(castle!.flags).toContain("k");
  });

  it("includes a promotion ply intact when it falls within the last 4 plies", () => {
    // White pawn one step from promoting; black king kept off the 8th rank
    // and off the a8-h1 diagonal so the promotion itself isn't check, and
    // play continues a couple more plies so the promotion isn't the very
    // last ply in the window.
    const chess = new Chess("8/P7/7k/8/8/8/8/6K1 w - - 0 1");
    chess.move("a8=Q");
    chess.move("Kh5");
    chess.move("Qb8");
    const history = chess.history({ verbose: true });
    const plan = replayPlan(history, 4);

    const promo = plan.moves.find((m) => m.promotion);
    expect(promo).toBeDefined();
    expect(promo!.promotion).toBe("q");
    expect(promo!.san).toBe("a8=Q");
  });
});
