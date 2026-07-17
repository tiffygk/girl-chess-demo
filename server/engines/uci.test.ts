import { describe, it, expect } from "vitest";
import { UciEngine } from "./uci";

describe("UciEngine", () => {
  it("completes the uci handshake with stockfish", async () => {
    const e = new UciEngine("stockfish");
    await e.init(); // resolves only after uciok + readyok
    e.quit();
    expect(true).toBe(true);
  }, 15000);
});
