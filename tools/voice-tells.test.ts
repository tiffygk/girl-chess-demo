// tools/voice-tells.test.ts
//
// Deviation from the brief's literal "openDb(':memory:')" instruction:
// computeVoiceTells opens its OWN fresh { readonly: true } connection to
// dbPath (copied from tools/gate.ts's checkInPlay, per the brief) -- a
// literal ":memory:" path is per-connection in better-sqlite3, so a second
// `new Database(":memory:")` would open an empty, unrelated database, not
// the one this test seeds. Using a real throwaway file under os.tmpdir()
// (the same pattern tools/dbCountSnapshot.test.ts already uses for exactly
// this reason) lets the readonly reopen see the seeded rows. Never touches
// data/girlchess.db.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, createSession, createGame, insertAdviceTrace } from "../server/store/db";
import { computeVoiceTells } from "./voice-tells";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seedDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-tells-test-"));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, "girlchess.db");
  openDb(dbPath);
  const s = createSession();
  const g = createGame(s, "maia-1100");

  // Row A: chat, hits "let's" and "em or en dash".
  insertAdviceTrace({
    gameId: g,
    ply: 4,
    kind: "chat",
    factsJson: "{}",
    prompt: "p",
    output: "let's look at this — it's a nice choice.",
    source: "model",
    backend: "claude-cli",
    validated: true,
    regenCount: 0,
    latencyMs: 100,
  });

  // Row B: nudge, hits "worth".
  insertAdviceTrace({
    gameId: g,
    ply: 6,
    kind: "nudge",
    factsJson: "{}",
    prompt: "p",
    output: "that was worth noting, keep going.",
    source: "model",
    backend: "claude-cli",
    validated: true,
    regenCount: 0,
    latencyMs: 90,
  });

  // Row C: warning, hits the "quiet move" chess carve-out ONLY -- no real
  // tell, since "quiet move" is not the softener "quietly" and contains
  // none of the other patterns.
  insertAdviceTrace({
    gameId: g,
    ply: 8,
    kind: "warning",
    factsJson: "{}",
    prompt: "p",
    output: "quiet move here, nothing dramatic.",
    source: "model",
    backend: "claude-cli",
    validated: true,
    regenCount: 0,
    latencyMs: 80,
  });

  return dbPath;
}

// Reported-only row seed for the loose-contrast / bare-"real" ruling
// (controller ruling, ledgered report-V4.md, 2026-09-08): a single chat row
// whose text hits the LOOSE contrast phrase ("it's not a big deal") but not
// the strict "contrast shape" tell (no second "it's" inside the window),
// proving the two are counted independently.
function seedLooseContrastDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-tells-test-loose-"));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, "girlchess.db");
  openDb(dbPath);
  const s = createSession();
  const g = createGame(s, "maia-1100");

  insertAdviceTrace({
    gameId: g,
    ply: 4,
    kind: "chat",
    factsJson: "{}",
    prompt: "p",
    output: "it's not a big deal, just a normal move.",
    source: "model",
    backend: "claude-cli",
    validated: true,
    regenCount: 0,
    latencyMs: 100,
  });

  return dbPath;
}

describe("voice-tells: computeVoiceTells", () => {
  // Falsification: change TELLS' "let's" pattern to /\bletsx\b/i (a typo
  // that can never match real text) and this assertion on
  // tellCounts["let's"].chat goes from 1 to 0. Watched red 2026-09-08,
  // restored, confirmed green again -- see the wave report for the pasted
  // command output.
  it("counts the \"let's\" tell and the \"worth\" tell per kind, out of the per-kind total", () => {
    const dbPath = seedDb();
    const result = computeVoiceTells(dbPath, "2020-01-01");

    expect(result.totals).toEqual({ chat: 1, nudge: 1, warning: 1 });
    expect(result.tellCounts["let's"]).toEqual({ chat: 1, nudge: 0, warning: 0 });
    expect(result.tellCounts["worth"]).toEqual({ chat: 0, nudge: 1, warning: 0 });
  });

  it("counts the em-or-en-dash tell on the same chat row, and reports the quiet chess carve-out separately from any tell", () => {
    const dbPath = seedDb();
    const result = computeVoiceTells(dbPath, "2020-01-01");

    expect(result.tellCounts["em or en dash"]).toEqual({ chat: 1, nudge: 0, warning: 0 });
    // The warning row is "quiet move here, nothing dramatic." -- the chess
    // carve-out matches it, but it must not count toward any real tell.
    expect(result.quietCarveOutCounts).toEqual({ chat: 0, nudge: 0, warning: 1 });
    expect(result.anyTellCounts).toEqual({ chat: 1, nudge: 1, warning: 0 });
  });

  it("excludes rows created before --since", () => {
    const dbPath = seedDb();
    const result = computeVoiceTells(dbPath, "2099-01-01");

    expect(result.totals).toEqual({ chat: 0, nudge: 0, warning: 0 });
  });

  // Falsification: change looseContrastCounts' pattern from
  // /\bit's not\b|.../ to /\bitsx not\b|.../ (a typo that can never match
  // real text) and this assertion goes from 1 to 0. Watched red 2026-09-08,
  // restored, confirmed green again -- see the reply for the pasted output.
  it("reports the loose contrast phrase separately from the strict contrast-shape tell, and excludes it from any-tell", () => {
    const dbPath = seedLooseContrastDb();
    const result = computeVoiceTells(dbPath, "2020-01-01");

    expect(result.looseContrastCounts).toEqual({ chat: 1, nudge: 0, warning: 0 });
    expect(result.tellCounts["contrast shape"]).toEqual({ chat: 0, nudge: 0, warning: 0 });
    expect(result.anyTellCounts).toEqual({ chat: 0, nudge: 0, warning: 0 });
  });
});
