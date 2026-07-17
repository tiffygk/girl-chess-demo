import { describe, it, expect } from "vitest";
import { UciEngine } from "./uci";

describe("UciEngine", () => {
  it("completes the uci handshake with stockfish", async () => {
    const e = new UciEngine("stockfish");
    await e.init(); // resolves only after uciok + readyok
    e.quit();
    expect(true).toBe(true);
  }, 15000);

  it("rejects init() cleanly when the binary does not exist (no process crash)", async () => {
    const e = new UciEngine("this-binary-does-not-exist-xyz");
    await expect(e.init()).rejects.toThrow();
    e.quit();
  });
});
