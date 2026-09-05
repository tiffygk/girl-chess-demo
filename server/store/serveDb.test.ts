import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DEMO_DB_BASENAME, resolveServeDbPath } from "./db";

describe("resolveServeDbPath", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("passes :memory: and ordinary paths through untouched", () => {
    expect(resolveServeDbPath(":memory:")).toEqual({ path: ":memory:" });
    expect(resolveServeDbPath("data/girlchess.db")).toEqual({ path: "data/girlchess.db" });
  });

  it("copies the committed demo db to a scratch sibling on first use and never returns the original", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-servedb-"));
    tmpDirs.push(dir);
    const demo = path.join(dir, DEMO_DB_BASENAME);
    fs.writeFileSync(demo, "pristine");
    const before = fs.statSync(demo).mtimeMs;

    const first = resolveServeDbPath(demo);
    expect(first.path).toBe(path.join(dir, "girlchess-demo.scratch.db"));
    expect(fs.readFileSync(first.path, "utf8")).toBe("pristine");
    expect(first.note).toMatch(/working copy/);

    fs.writeFileSync(first.path, "played on");
    const second = resolveServeDbPath(demo);
    expect(second.path).toBe(first.path);
    expect(fs.readFileSync(second.path, "utf8")).toBe("played on"); // reuse, not re-copy
    expect(second.note).toMatch(/existing working copy/);
    expect(fs.readFileSync(demo, "utf8")).toBe("pristine");
    expect(fs.statSync(demo).mtimeMs).toBe(before);
  });

  // The mkdir guard: dirname(scratch) always equals dirname(requested) by
  // construction (scratch is joined from requested's own dirname), so a
  // real filesystem can never present a "requested exists but its directory
  // doesn't" state to exercise this through pure fs setup -- a file cannot
  // exist without its parent directory existing. The guard is still worth
  // having (defensive against a future caller passing a requested path
  // through a symlink/mount boundary where the copy destination's directory
  // has to be created fresh), so this test proves it the only way available:
  // asserting fs.mkdirSync(dirname(scratch), { recursive: true }) actually
  // runs, with the right directory, before the copy -- removing the guard
  // line makes this fail while every fs-visible behavior above stays green.
  it("creates the scratch directory before copying into it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-servedb-"));
    tmpDirs.push(dir);
    const demo = path.join(dir, DEMO_DB_BASENAME);
    fs.writeFileSync(demo, "pristine");

    const mkdirSpy = vi.spyOn(fs, "mkdirSync");
    const result = resolveServeDbPath(demo);
    expect(mkdirSpy).toHaveBeenCalledWith(dir, { recursive: true });
    expect(fs.readFileSync(result.path, "utf8")).toBe("pristine");
    mkdirSpy.mockRestore();
  });
});
