import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private listeners: Array<(line: string) => void> = [];
  private pendingRejecters: Array<(err: Error) => void> = [];
  private dead = false;
  private deathError: Error | null = null;

  constructor(cmd: string, args: string[] = []) {
    this.proc = spawn(cmd, args);
    this.proc.stdout.on("data", (d) => {
      this.buffer += d.toString();
      let i: number;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        for (const fn of [...this.listeners]) fn(line);
      }
    });
    this.proc.on("error", (err) => {
      this.markDead(err instanceof Error ? err : new Error(String(err)));
    });
    this.proc.on("exit", (code, signal) => {
      if (this.dead) return;
      this.markDead(new Error(`uci engine exited unexpectedly (code=${code}, signal=${signal})`));
    });
  }

  private markDead(err: Error) {
    this.dead = true;
    this.deathError = err;
    this.listeners = [];
    const rejecters = this.pendingRejecters;
    this.pendingRejecters = [];
    for (const reject of rejecters) reject(err);
  }

  send(cmd: string) {
    if (this.dead) return;
    this.proc.stdin.write(cmd + "\n");
  }

  onLine(fn: (line: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  listenerCount(): number { return this.listeners.length; }

  waitFor(pred: (line: string) => boolean, timeoutMs = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        reject(this.deathError ?? new Error("uci engine is dead"));
        return;
      }
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        this.pendingRejecters = this.pendingRejecters.filter((r) => r !== rejecter);
        reject(new Error("uci timeout"));
      }, timeoutMs);
      const fn = (line: string) => {
        if (pred(line)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== fn);
          this.pendingRejecters = this.pendingRejecters.filter((r) => r !== rejecter);
          resolve(line);
        }
      };
      const rejecter = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      this.pendingRejecters.push(rejecter);
      this.onLine(fn);
    });
  }

  async init() {
    if (this.dead) throw this.deathError ?? new Error("uci engine is dead");
    this.send("uci");
    await this.waitFor((l) => l === "uciok", 20000);
    this.send("isready");
    await this.waitFor((l) => l === "readyok");
  }

  quit() {
    if (this.dead) return;
    try { this.send("quit"); } catch { /* already dead */ }
    this.proc.kill();
  }
}
