// tools/backfill-move-side.ts
//
// ONE-TIME backfill of moves.side for rows written before the column existed
// (Wave B3, attribution round 2026-09-01, owner-approved).
//
// This is the ONE place in the codebase where ply parity is still used to
// decide a party, and it is used here deliberately, with its justification
// recorded: EVERY game in the owner's history was played with her as white,
// so odd plies are hers and even plies are mallow's. That fact is true of the
// existing rows and only of them. After this runs, nothing computes a party
// from a ply ever again -- the column is written at play time from the chess
// engine's own move object (server/game/manager.ts's partyFor), and every
// consumer reads the column.
//
// Idempotent: only rows WHERE side IS NULL are touched, so a re-run is a no-op.
//
// Dry run by default. --confirm is the only path that writes, and it follows
// tools/coach-backfill.ts's convention: the dry run never opens the real file
// at all, and --confirm counts before and after and refuses to leave the db
// with fewer games or moves than it found.
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { resolveRealDbPath } from "./truth-check";
import { countDbSnapshot, checkDbIntact } from "./dbCountSnapshot";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The historical invariant this backfill rests on, stated once, in code.
const PLAYER_WAS_ALWAYS_WHITE = true;

export function partyForHistoricalPly(ply: number): "her" | "mallow" {
  if (!PLAYER_WAS_ALWAYS_WHITE) throw new Error("backfill invariant no longer holds; do not guess");
  return ply % 2 === 1 ? "her" : "mallow";
}

function ensureColumn(db: Database.Database) {
  const cols = new Set((db.pragma("table_info(moves)") as { name: string }[]).map((c) => c.name));
  if (!cols.has("side")) db.exec("ALTER TABLE moves ADD COLUMN side TEXT");
  const gcols = new Set((db.pragma("table_info(games)") as { name: string }[]).map((c) => c.name));
  if (!gcols.has("player_color")) db.exec("ALTER TABLE games ADD COLUMN player_color TEXT DEFAULT 'w'");
}

function report(db: Database.Database, label: string) {
  const total = (db.prepare("select count(*) n from moves").get() as { n: number }).n;
  const missing = (db.prepare("select count(*) n from moves where side is null").get() as { n: number }).n;
  const byside = db.prepare("select ifnull(side,'NULL') s, count(*) n from moves group by s order by s").all() as { s: string; n: number }[];
  console.log(`[backfill-move-side] ${label}: ${total} move rows, ${missing} with no side`);
  for (const r of byside) console.log(`[backfill-move-side]   ${r.s}: ${r.n}`);
  return { total, missing };
}

function main() {
  const confirm = process.argv.slice(2).includes("--confirm");
  const res = resolveRealDbPath(REPO_ROOT);

  if (!confirm) {
    // Dry run: work on a scratch COPY, never the real file, not even readonly.
    const scratchDir = fs.mkdtempSync(path.join(REPO_ROOT, "tools", ".backfill-side-dryrun-"));
    const scratch = path.join(scratchDir, "girlchess.db");
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(res.path + suffix)) fs.copyFileSync(res.path + suffix, scratch + suffix);
    }
    console.log(`[backfill-move-side] DRY RUN -- scratch copy of ${res.path} (${res.source})`);
    const db = new Database(scratch);
    ensureColumn(db);
    const before = report(db, "before");
    const rows = db.prepare("select id, ply from moves where side is null").all() as { id: number; ply: number }[];
    const upd = db.prepare("update moves set side = ? where id = ?");
    const tx = db.transaction((rs: { id: number; ply: number }[]) => {
      for (const r of rs) upd.run(partyForHistoricalPly(r.ply), r.id);
    });
    tx(rows);
    const after = report(db, "after (scratch only)");
    console.log(`[backfill-move-side] would fill ${before.missing} row(s); scratch now has ${after.missing} missing`);
    db.close();
    fs.rmSync(scratchDir, { recursive: true, force: true });
    console.log("[backfill-move-side] dry run only -- NOTHING written to her history. Re-run with --confirm to write.");
    return;
  }

  // --confirm: the one path that writes to her real history.
  if (!fs.existsSync(res.path)) throw new Error(`refusing --confirm: resolved db path does not exist: ${res.path}`);
  const before = countDbSnapshot(res.path);
  console.log(`[backfill-move-side] writing to ${res.path} (${res.source})`);
  console.log(`[backfill-move-side] counts before: ${JSON.stringify(before)}`);

  const db = new Database(res.path);
  ensureColumn(db);
  const pre = report(db, "before");
  const rows = db.prepare("select id, ply from moves where side is null").all() as { id: number; ply: number }[];
  const upd = db.prepare("update moves set side = ? where id = ?");
  const tx = db.transaction((rs: { id: number; ply: number }[]) => {
    for (const r of rs) upd.run(partyForHistoricalPly(r.ply), r.id);
  });
  tx(rows);
  const post = report(db, "after");
  const integrity = (db.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check;
  db.close();

  const after = countDbSnapshot(res.path);
  const drift = checkDbIntact(before, after);
  console.log(`[backfill-move-side] counts after: ${JSON.stringify(after)}`);
  console.log(`[backfill-move-side] integrity: ${integrity}`);
  if (drift) throw new Error(`REFUSING TO REPORT SUCCESS -- db drifted: ${drift}`);
  if (post.missing !== 0) throw new Error(`REFUSING TO REPORT SUCCESS -- ${post.missing} rows still have no side`);
  if (integrity !== "ok") throw new Error(`REFUSING TO REPORT SUCCESS -- integrity_check returned ${integrity}`);
  console.log(`[backfill-move-side] filled ${pre.missing} row(s). Counts unchanged, integrity ok.`);
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
