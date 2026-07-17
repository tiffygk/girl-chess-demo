import { UciEngine } from "./uci";
import { ENGINE_PATHS } from "./paths";
import type { Evaluation, Evaluator } from "./types";

export class StockfishEvaluator implements Evaluator {
  private engine = new UciEngine(ENGINE_PATHS.stockfish);
  private queue: Promise<unknown> = Promise.resolve();

  async init() { await this.engine.init(); }
  quit() { this.engine.quit(); }

  evaluate(fen: string, movetimeMs = 800): Promise<Evaluation> {
    // serialize: one search at a time on the single engine process
    const run = this.queue.then(() => this.search(fen, movetimeMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async search(fen: string, movetimeMs: number): Promise<Evaluation> {
    let cp: number | null = null;
    let mate: number | null = null;
    let pv: string[] = [];
    const capture = (line: string) => {
      const s = line.match(/score (cp|mate) (-?\d+)/);
      if (s) {
        if (s[1] === "cp") { cp = parseInt(s[2], 10); mate = null; }
        else { mate = parseInt(s[2], 10); cp = null; }
      }
      const p = line.match(/ pv (.+)$/);
      if (p) pv = p[1].split(" ");
    };
    const unsubscribe = this.engine.onLine(capture);
    try {
      this.engine.send(`position fen ${fen}`);
      this.engine.send(`go movetime ${movetimeMs}`);
      const best = await this.engine.waitFor((l) => l.startsWith("bestmove"), movetimeMs + 8000);
      return { cp, mate, bestMove: best.split(" ")[1], pv };
    } finally {
      unsubscribe();
    }
  }
}
