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

  // Task 5 (trade-aware hints, increment 3.95): the multipv seam --
  // server/annotator/hint.ts's computeHint uses this to weigh the engine's
  // top-K lines against each other instead of only ever seeing the single
  // best one. Queued on the SAME serialized queue as evaluate() (one
  // engine process, one search at a time) so it can never race a judge-path
  // evaluate() call.
  evaluateMulti(fen: string, movetimeMs: number, k: number): Promise<Evaluation[]> {
    const run = this.queue.then(() => this.searchMulti(fen, movetimeMs, k));
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

  // Parses UCI's `setoption name MultiPV value K` output: as the search
  // deepens, Stockfish re-emits an "info ... multipv i ... score ... pv
  // ..." line for each line index i (1..K), each update superseding the
  // last for that same index. Keeping only the LATEST line per index and
  // reading them off in 1..K order at "bestmove" time is what gives
  // best-first, most-current lines. Only lines carrying BOTH a score and a
  // pv are accepted -- Stockfish also emits multipv-tagged lines missing
  // one or the other (e.g. early "currmove" progress lines), which would
  // otherwise poison an index with a half-formed entry.
  private async searchMulti(fen: string, movetimeMs: number, k: number): Promise<Evaluation[]> {
    const lines = new Map<number, { cp: number | null; mate: number | null; pv: string[] }>();
    const capture = (line: string) => {
      const idxMatch = line.match(/\bmultipv (\d+)/);
      if (!idxMatch) return;
      const s = line.match(/score (cp|mate) (-?\d+)/);
      const p = line.match(/ pv (.+)$/);
      if (!s || !p) return;
      const cp = s[1] === "cp" ? parseInt(s[2], 10) : null;
      const mate = s[1] === "mate" ? parseInt(s[2], 10) : null;
      lines.set(parseInt(idxMatch[1], 10), { cp, mate, pv: p[1].split(" ") });
    };
    const unsubscribe = this.engine.onLine(capture);
    try {
      this.engine.send(`setoption name MultiPV value ${k}`);
      this.engine.send(`position fen ${fen}`);
      this.engine.send(`go movetime ${movetimeMs}`);
      await this.engine.waitFor((l) => l.startsWith("bestmove"), movetimeMs + 8000);
      const result: Evaluation[] = [];
      for (let i = 1; i <= k; i++) {
        const line = lines.get(i);
        if (!line || line.pv.length === 0) break; // fewer legal lines than k (e.g. near-forced positions)
        result.push({ cp: line.cp, mate: line.mate, bestMove: line.pv[0], pv: line.pv });
      }
      return result;
    } finally {
      unsubscribe();
      // Judge-path safety: evaluate()'s capture regex has no multipv-index
      // filter, so if MultiPV were left above 1 its next call could
      // silently grab a worse line's info string instead of the primary
      // one. Reset unconditionally (queued, so this always runs before any
      // later evaluate()/evaluateMulti() call) -- evaluate() itself is
      // untouched by this task, exactly as the brief requires.
      this.engine.send("setoption name MultiPV value 1");
    }
  }
}
