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

  // Gate-determinism fix (2026-07-31): quit() previously only proved itself
  // by not throwing -- nothing verified the real OS process it spawned
  // actually died. That gap is exactly how server/coach/chat.test.ts's
  // GameManager.chat block leaked 21 real stockfish processes across one
  // file's run: the code called .quit()-shaped cleanup nowhere at all, on
  // an assumption that init() (not the constructor) was what started the
  // process. This test spawns the real binary, calls quit(), and polls the
  // OS by pid rather than trusting the wrapper's own `dead` flag. To see it
  // go RED: comment out `this.proc.kill()` in UciEngine.quit() (server/
  // engines/uci.ts) -- the process stays signalable well past the 3s
  // deadline below and the test times out waiting for it to disappear.
  it("quit() terminates the underlying OS process, not just this wrapper's own state", async () => {
    const e = new UciEngine("stockfish");
    const pid = e.pid;
    expect(pid).toBeTruthy();

    e.quit();

    // process.kill(pid, 0) sends no signal -- it only probes whether the
    // pid is still addressable, throwing ESRCH once the OS has reaped it.
    // kill() itself is async (sends "quit" over stdin, then SIGTERM), so
    // the exit is not guaranteed to land in the same tick as quit()
    // returning -- poll briefly instead of asserting immediately.
    const deadline = Date.now() + 3000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(pid!, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);
  }, 5000);
});
