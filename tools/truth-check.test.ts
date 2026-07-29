// Unit tests for tools/truth-check.ts's own pure data-plumbing helpers --
// reconstructPvLine (mirrors manager.ts's private pvLine) and
// toTurningPoint (raw sqlite row -> the client TurningPoint shape). These
// are NOT tests of the counterfactual-suppression fix itself (that's
// src/review/followedBest.test.ts / turningPointNote.test.ts's job, and
// this file imports rather than reimplements that logic) -- just of the
// plumbing this gate assembles TurningLine/TurningPoint objects with.
// Deliberately does not import `main` and touches no db: importing this
// module never runs main() as a side effect (guarded by the isMain check
// at the bottom of truth-check.ts).
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { Chess } from "chess.js";
import { reconstructPvLine, toTurningPoint, resolveRealDbPath, type RawTurningPointRow } from "./truth-check";

describe("reconstructPvLine", () => {
  it("replays a space-separated UCI pv into SANs from the given fen", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: "e2e4", pv: "e2e4 e7e5 g1f3" });
    expect(result.pvSans).toEqual(["e4", "e5", "Nf3"]);
    expect(result.bestSan).toBe("e4");
    expect(result.bestFromTo).toEqual({ from: "e2", to: "e4" });
  });

  it("falls back to a lone bestMove when pv is absent", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: "e2e4", pv: null });
    expect(result.pvSans).toEqual(["e4"]);
    expect(result.bestSan).toBe("e4");
  });

  it("stops at the first illegal/malformed step rather than throwing", () => {
    const start = new Chess().fen();
    const result = reconstructPvLine(start, { bestMove: null, pv: "e2e4 z9z9 g1f3" });
    expect(result.pvSans).toEqual(["e4"]);
  });

  it("returns an empty pv when no eval row is available", () => {
    const start = new Chess().fen();
    expect(reconstructPvLine(start, undefined)).toEqual({ pvSans: [] });
  });

  it("returns an empty pv when both pv and bestMove are absent", () => {
    const start = new Chess().fen();
    expect(reconstructPvLine(start, { bestMove: null, pv: "" })).toEqual({ pvSans: [] });
  });
});

describe("toTurningPoint", () => {
  it("maps snake_case sqlite columns to the camelCase TurningPoint shape", () => {
    const row: RawTurningPointRow = {
      rank: 1,
      ply: 20,
      san: "Rg8",
      label: "opponent mistake",
      punish_san: "Qf6#",
      delta_p: 0.4,
      low_confidence: 0,
      kind: "swing",
      ply_end: null,
      missed_punish: 0,
      crossed_advantage: 1,
      end_kind: null,
    };
    expect(toTurningPoint(row)).toEqual({
      rank: 1,
      ply: 20,
      san: "Rg8",
      label: "opponent mistake",
      punishSan: "Qf6#",
      deltaP: 0.4,
      lowConfidence: false,
      kind: "swing",
      missedPunish: false,
      plyEnd: undefined,
      crossedAdvantage: true,
    });
  });

  it("maps NULL punish_san/ply_end to undefined, never null or a fabricated value", () => {
    const row: RawTurningPointRow = {
      rank: 2,
      ply: 5,
      san: "Nf3",
      label: "blunder",
      punish_san: null,
      delta_p: -0.3,
      low_confidence: 1,
      kind: "backfill",
      ply_end: null,
      missed_punish: null,
      crossed_advantage: null,
      end_kind: null,
    };
    const tp = toTurningPoint(row);
    expect(tp.punishSan).toBeUndefined();
    expect(tp.plyEnd).toBeUndefined();
    expect(tp.missedPunish).toBeUndefined();
    expect(tp.crossedAdvantage).toBeUndefined();
    expect(tp.lowConfidence).toBe(true);
  });
});

// F2 (review-1.md important): resolveRealDbPath used to try
// <repoRoot>/data/girlchess.db BEFORE the main worktree, with no
// freshness or size check. data/* is gitignored, so a stale/demo snapshot
// dropped in a worktree (exactly the state Task 0 itself found and
// deleted) silently became the ENTIRE corpus every downstream check ran
// against, and nothing printed to say so -- a five-game snapshot reads
// "games examined: 3", never sees game 151, and still prints VERDICT:
// PASS. mainWorktreeDb is now an injectable second param (defaults to the
// real absolute path) specifically so this scenario is testable without
// touching her real db.
describe("F2: resolveRealDbPath prefers the live main-worktree db over a stale local copy", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    delete process.env.GC_DB_PATH;
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeDbWithGames(n: number): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-"));
    tmpDirs.push(dir);
    const p = path.join(dir, "girlchess.db");
    const db = new Database(p);
    db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY);");
    const insert = db.prepare("INSERT INTO games DEFAULT VALUES");
    for (let i = 0; i < n; i++) insert.run();
    db.close();
    return p;
  }

  it("GC_DB_PATH override wins over everything, even when both a main-worktree and local db exist", () => {
    const mainDb = makeDbWithGames(152);
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-repo-"));
    tmpDirs.push(repoDir);
    fs.mkdirSync(path.join(repoDir, "data"));
    fs.copyFileSync(mainDb, path.join(repoDir, "data", "girlchess.db"));
    const override = makeDbWithGames(1);
    process.env.GC_DB_PATH = override;
    const r = resolveRealDbPath(repoDir, mainDb);
    expect(r.path).toBe(override);
    expect(r.source).toMatch(/GC_DB_PATH override/);
  });

  it("the exact F2 regression: a stale local data/girlchess.db must NOT beat the live main-worktree db", () => {
    const mainDb = makeDbWithGames(152); // "live" -- the real corpus, per the finding's own numbers
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-repo-"));
    tmpDirs.push(repoDir);
    fs.mkdirSync(path.join(repoDir, "data"));
    const staleLocal = path.join(repoDir, "data", "girlchess.db");
    fs.copyFileSync(makeDbWithGames(3), staleLocal); // exactly the stale-snapshot shape Task 0 found and deleted

    const r = resolveRealDbPath(repoDir, mainDb);
    expect(r.path).toBe(mainDb);
    expect(r.source).toMatch(/main worktree/);
  });

  it("local copy is honored only as a fallback, and only once it proves itself non-empty by COUNTING", () => {
    const missingMainDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-nomain-")), "girlchess.db");
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-repo-"));
    tmpDirs.push(repoDir);
    fs.mkdirSync(path.join(repoDir, "data"));
    fs.copyFileSync(makeDbWithGames(24), path.join(repoDir, "data", "girlchess.db"));

    const r = resolveRealDbPath(repoDir, missingMainDb);
    expect(r.path).toBe(path.join(repoDir, "data", "girlchess.db"));
    expect(r.source).toMatch(/verified 24 games by count, not hash/);
  });

  it("an empty local copy is rejected (not silently accepted) when the main worktree db is also absent", () => {
    const missingMainDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-nomain-")), "girlchess.db");
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-check-f2-repo-"));
    tmpDirs.push(repoDir);
    fs.mkdirSync(path.join(repoDir, "data"));
    fs.copyFileSync(makeDbWithGames(0), path.join(repoDir, "data", "girlchess.db"));

    expect(() => resolveRealDbPath(repoDir, missingMainDb)).toThrow(/empty \(0 games\)/);
  });
});
