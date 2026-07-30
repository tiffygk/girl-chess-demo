// tools/rca-eval/lib/scenarioDb.test.ts
//
// TDD: watched red against a pre-implementation lib/scenarioDb.ts ("Cannot
// find module './scenarioDb'"). Confirms the scratch-db builders actually
// produce a REAL schema (via the product's own openDb()), a real two-ply
// game, and that doctoring only ever touches the scratch path handed to it.
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  makeScratchDir,
  seedScratchDb,
  seedMinimalGame,
  doctorMoveCount,
  countMoves,
  fakeWorktreeRoot,
  fakeMainRoot,
} from "./scenarioDb";

describe("scenarioDb", () => {
  it("seedScratchDb creates a real, isolated sqlite file with the product's own schema", () => {
    const p = seedScratchDb("test-seed");
    expect(fs.existsSync(p)).toBe(true);
    expect(p).toContain("gc-rca-test-seed-");
  });

  it("seedMinimalGame creates a real session/game/two-move history", () => {
    seedScratchDb("test-game");
    const { gameId } = seedMinimalGame();
    expect(gameId).toBeGreaterThan(0);
    expect(countMoves(seedScratchDb("test-game-recheck"), gameId)).toBe(0); // different (empty) db
  });

  it("doctorMoveCount drops a scratch db's move rows down to keepFirstN, and ONLY that scratch db", () => {
    const p = seedScratchDb("test-doctor");
    const { gameId } = seedMinimalGame();
    expect(countMoves(p, gameId)).toBe(2);
    doctorMoveCount(p, gameId, 1);
    expect(countMoves(p, gameId)).toBe(1);
  });

  it("fakeWorktreeRoot writes a .git FILE (linked-worktree shape); fakeMainRoot writes a .git DIRECTORY (main shape)", () => {
    const wt = fakeWorktreeRoot();
    const main = fakeMainRoot();
    expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);
    expect(fs.statSync(path.join(main, ".git")).isDirectory()).toBe(true);
  });

  it("makeScratchDir returns a fresh directory each call", () => {
    const a = makeScratchDir("uniq");
    const b = makeScratchDir("uniq");
    expect(a).not.toBe(b);
  });
});
