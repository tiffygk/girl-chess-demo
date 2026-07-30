// Task K5a: the gate's in-play guard.
//
// WHY: on 2026-07-29 three back-to-back `npm run gate` runs starved her
// live server and interrupted a game she was winning at +492 -- the
// "tests" step spawns Stockfish. checkInPlay is the pure, readonly check
// gate.ts's main() now runs BEFORE that step: an unfinished game
// (ended_at IS NULL) with a move in the last 30 minutes means "she may be
// playing," and the gate should fail fast rather than compete with her.
//
// Deliberately does not import `main` and touches no db of its own beyond
// a throwaway temp file: importing this module never runs main() as a
// side effect (isMain guard at the bottom of gate.ts, same convention as
// truth-check.ts/replay-check.ts) -- otherwise merely importing gate.ts to
// test checkInPlay would spawn vitest recursively.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { checkInPlay, IN_PLAY_WINDOW_MS } from "./gate";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDb(): { path: string; db: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-inplay-"));
  tmpDirs.push(dir);
  const p = path.join(dir, "girlchess.db");
  const db = new Database(p);
  db.exec(`
    CREATE TABLE games(id INTEGER PRIMARY KEY, ended_at TEXT);
    CREATE TABLE moves(id INTEGER PRIMARY KEY, game_id INTEGER, moved_at TEXT);
  `);
  return { path: p, db };
}

function sqliteNow(d: Date): string {
  // Mirrors sqlite's own datetime('now') shape: "YYYY-MM-DD HH:MM:SS", UTC,
  // no timezone suffix.
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("checkInPlay: an unfinished game with a recent move means she may be playing", () => {
  it("inPlay true for a game with ended_at IS NULL and a move 5 minutes ago", () => {
    const { path: dbPath, db } = makeDb();
    const now = new Date("2026-07-31T12:00:00Z");
    db.prepare("INSERT INTO games(id, ended_at) VALUES (7, NULL)").run();
    db.prepare("INSERT INTO moves(game_id, moved_at) VALUES (7, ?)").run(
      sqliteNow(new Date(now.getTime() - 5 * 60 * 1000))
    );
    db.close();

    const result = checkInPlay(dbPath, now);
    expect(result.inPlay).toBe(true);
    expect(result.detail).toMatch(/game 7/);
    expect(result.detail).toMatch(/ended_at IS NULL/);
  });

  it("inPlay false when the same game's last move is 5 minutes past the 30-minute window", () => {
    const { path: dbPath, db } = makeDb();
    const now = new Date("2026-07-31T12:00:00Z");
    db.prepare("INSERT INTO games(id, ended_at) VALUES (7, NULL)").run();
    db.prepare("INSERT INTO moves(game_id, moved_at) VALUES (7, ?)").run(
      sqliteNow(new Date(now.getTime() - (IN_PLAY_WINDOW_MS + 5 * 60 * 1000)))
    );
    db.close();

    expect(checkInPlay(dbPath, now)).toEqual({ inPlay: false });
  });

  it("inPlay false when the only unfinished-looking game is actually finished (ended_at set)", () => {
    const { path: dbPath, db } = makeDb();
    const now = new Date("2026-07-31T12:00:00Z");
    db.prepare("INSERT INTO games(id, ended_at) VALUES (7, ?)").run(sqliteNow(now));
    db.prepare("INSERT INTO moves(game_id, moved_at) VALUES (7, ?)").run(
      sqliteNow(new Date(now.getTime() - 60 * 1000))
    );
    db.close();

    expect(checkInPlay(dbPath, now)).toEqual({ inPlay: false });
  });

  it("inPlay false on an empty db (no games at all)", () => {
    const { path: dbPath, db } = makeDb();
    db.close();
    expect(checkInPlay(dbPath, new Date())).toEqual({ inPlay: false });
  });

  it("opens the db readonly only -- static check on the actual instrument", () => {
    const src = fs.readFileSync(path.join(__dirname, "gate.ts"), "utf8");
    const opens = [...src.matchAll(/new Database\(([^)]*)\)/g)].map((m) => m[1]);
    expect(opens.length).toBeGreaterThan(0);
    for (const args of opens) {
      expect(args).toMatch(/\{\s*readonly:\s*true\s*\}/);
    }
  });
});
