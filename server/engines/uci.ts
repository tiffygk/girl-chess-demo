import { spawn, ChildProcessWithoutNullStreams } from "child_process";

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private listeners: Array<(line: string) => void> = [];

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
  }

  send(cmd: string) { this.proc.stdin.write(cmd + "\n"); }
  onLine(fn: (line: string) => void) { this.listeners.push(fn); }

  waitFor(pred: (line: string) => boolean, timeoutMs = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        reject(new Error("uci timeout"));
      }, timeoutMs);
      const fn = (line: string) => {
        if (pred(line)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve(line);
        }
      };
      this.onLine(fn);
    });
  }

  async init() {
    this.send("uci");
    await this.waitFor((l) => l === "uciok", 20000);
    this.send("isready");
    await this.waitFor((l) => l === "readyok");
  }

  quit() {
    try { this.send("quit"); } catch { /* already dead */ }
    this.proc.kill();
  }
}
