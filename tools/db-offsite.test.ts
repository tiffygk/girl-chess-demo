// offsiteBackup: a verified snapshot copied OUT of the repo (the vault's
// `7 backups/`, which iCloud syncs), pruned to the newest N. Every fixture is
// a throwaway db under os.tmpdir(); nothing here reads data/girlchess.db.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { offsiteBackup, OFFSITE_NAME } from "./db-backup";
import { countDbSnapshot } from "./dbCountSnapshot";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function makeDb(dir: string, games: number, moves: number): string {
  const p = path.join(dir, "girlchess.db");
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE games(id INTEGER PRIMARY KEY); CREATE TABLE moves(id INTEGER PRIMARY KEY);");
  for (let i = 0; i < games; i++) db.prepare("INSERT INTO games DEFAULT VALUES").run();
  for (let i = 0; i < moves; i++) db.prepare("INSERT INTO moves DEFAULT VALUES").run();
  db.close();
  return p;
}
function fixture() {
  const root = tmp("offsite-main-");
  fs.mkdirSync(path.join(root, "data"));
  const mainDb = makeDb(path.join(root, "data"), 9, 55);
  const dest = tmp("offsite-dest-");
  return { root, mainDb, dest };
}
const stampName = (d: Date) => `girlchess-${d.toISOString().replace(/[:.]/g, "-")}.db`;

describe("offsiteBackup", () => {
  it("writes one verified snapshot into the destination, counts equal live, no WAL sidecars", async () => {
    const f = fixture();
    const out = await offsiteBackup(f.dest, { sourceDb: f.mainDb, mainWorktreeDb: f.mainDb });
    expect(path.dirname(out.path)).toBe(f.dest);
    expect(OFFSITE_NAME.test(path.basename(out.path))).toBe(true);
    expect(countDbSnapshot(out.path)).toEqual(countDbSnapshot(f.mainDb));
    // a WAL-mode copy grows -wal/-shm the moment anything opens it, which
    // iCloud would then sync as loose files beside the snapshot
    expect(fs.readdirSync(f.dest).sort()).toEqual([path.basename(out.path)]);
    const db = new Database(out.path, { readonly: true });
    expect(db.pragma("journal_mode", { simple: true })).toBe("delete");
    db.close();
  });

  it("keeps the newest `keep` snapshots and never touches files that are not its own", async () => {
    const f = fixture();
    const base = Date.UTC(2026, 0, 1);
    const seeded: string[] = [];
    for (let i = 0; i < 15; i++) {
      const name = stampName(new Date(base + i * 86_400_000));
      fs.writeFileSync(path.join(f.dest, name), "old");
      seeded.push(name);
    }
    const bystanders = ["notes.md", "girlchess.db", "girlchess-manual-copy.db", "photo.png"];
    for (const b of bystanders) fs.writeFileSync(path.join(f.dest, b), "keep me");

    const out = await offsiteBackup(f.dest, {
      sourceDb: f.mainDb,
      mainWorktreeDb: f.mainDb,
      now: new Date(Date.UTC(2026, 5, 1)),
      keep: 14,
    });

    const left = fs.readdirSync(f.dest);
    for (const b of bystanders) expect(left).toContain(b);
    const snaps = left.filter((n) => OFFSITE_NAME.test(n)).sort();
    expect(snaps).toHaveLength(14);
    expect(snaps).toContain(path.basename(out.path));
    // the new one plus the 13 newest seeded; the two oldest seeded are gone
    expect(snaps).toEqual([...seeded.slice(2), path.basename(out.path)].sort());
    expect(out.pruned.sort()).toEqual(seeded.slice(0, 2).sort());
  });

  it("refuses a destination inside an agent worktree or inside the repo's data dir", async () => {
    const f = fixture();
    const inWt = path.join(tmp("offsite-x-"), "wt-something", "backups");
    await expect(offsiteBackup(inWt, { sourceDb: f.mainDb, mainWorktreeDb: f.mainDb })).rejects.toThrow(/worktree/);
    const inData = path.join(f.root, "data", "offsite");
    await expect(offsiteBackup(inData, { sourceDb: f.mainDb, mainWorktreeDb: f.mainDb })).rejects.toThrow(/data/);
  });

  it("refuses keep below 1, so a bad argument can never prune every snapshot", async () => {
    const f = fixture();
    await expect(offsiteBackup(f.dest, { sourceDb: f.mainDb, mainWorktreeDb: f.mainDb, keep: 0 })).rejects.toThrow(/keep/);
  });
  it("leaves nothing under a snapshot name when the copy fails its check", async () => {
    const f = fixture();
    await expect(
      offsiteBackup(f.dest, {
        sourceDb: f.mainDb,
        mainWorktreeDb: f.mainDb,
        verify: () => {
          throw new Error("simulated bad copy");
        },
      })
    ).rejects.toThrow(/simulated bad copy/);
    expect(fs.readdirSync(f.dest)).toEqual([]);
  });

  it("never prunes the snapshot it just wrote, even when the clock has jumped backwards", async () => {
    const f = fixture();
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 14; i++) fs.writeFileSync(path.join(f.dest, stampName(new Date(base + i * 86_400_000))), "old");
    const out = await offsiteBackup(f.dest, {
      sourceDb: f.mainDb,
      mainWorktreeDb: f.mainDb,
      now: new Date(Date.UTC(2025, 0, 1)),
      keep: 14,
    });
    const snaps = fs.readdirSync(f.dest).filter((n) => OFFSITE_NAME.test(n));
    expect(snaps).toContain(path.basename(out.path));
    expect(snaps).toHaveLength(14);
    expect(out.pruned).toEqual([stampName(new Date(base))]);
  });
});
