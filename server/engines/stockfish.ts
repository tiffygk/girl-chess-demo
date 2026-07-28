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
  // deepens, Stockfish re-emits an "info ... depth d ... multipv i ...
  // score ... pv ..." line for each line index i (1..K) at each depth d.
  // Only lines carrying a depth, a score, AND a pv are accepted -- Stockfish
  // also emits multipv-tagged lines missing one of those (e.g. early
  // "currmove" progress lines), which would otherwise poison an entry.
  //
  // Bug fix (2026-07-27): naively keeping only the LATEST line per index
  // and reading them off at "bestmove" time is NOT safe -- when the search
  // is stopped mid-iteration, different indices can be caught holding
  // scores from DIFFERENT depths (index 1 already updated for depth d+1
  // while index 2 still holds depth d, or vice versa; confirmed by probing
  // raw stockfish output directly). Scores from different depths are not
  // mutually comparable, so that mixed-depth set can violate best-first
  // ordering (~1-in-3 runs observed) and, more importantly for hint.ts,
  // silently corrupts the HINT_TRADE_MARGIN_CP comparison. Instead we keep
  // every index's line PER DEPTH (indexed by depth, so an older depth's
  // entry is never clobbered by a newer one) and at "bestmove" time pick
  // the deepest depth for which we have every index we're going to return,
  // so every returned line is mutually comparable. If no depth ever
  // completed a full k-line set (e.g. a near-forced position with fewer
  // than k legal moves), we fall back to the deepest depth's longest
  // complete prefix from index 1 -- still one depth, never a mixed set.
  private async searchMulti(fen: string, movetimeMs: number, k: number): Promise<Evaluation[]> {
    type Line = { cp: number | null; mate: number | null; pv: string[] };
    const perDepth = new Map<number, Map<number, Line>>();
    const capture = (raw: string) => {
      const idxMatch = raw.match(/\bmultipv (\d+)/);
      const depthMatch = raw.match(/\bdepth (\d+)/);
      if (!idxMatch || !depthMatch) return;
      const s = raw.match(/score (cp|mate) (-?\d+)/);
      const p = raw.match(/ pv (.+)$/);
      if (!s || !p) return;
      const depth = parseInt(depthMatch[1], 10);
      const idx = parseInt(idxMatch[1], 10);
      const cp = s[1] === "cp" ? parseInt(s[2], 10) : null;
      const mate = s[1] === "mate" ? parseInt(s[2], 10) : null;
      let atDepth = perDepth.get(depth);
      if (!atDepth) { atDepth = new Map(); perDepth.set(depth, atDepth); }
      atDepth.set(idx, { cp, mate, pv: p[1].split(" ") });
    };
    const unsubscribe = this.engine.onLine(capture);
    try {
      this.engine.send(`setoption name MultiPV value ${k}`);
      this.engine.send(`position fen ${fen}`);
      this.engine.send(`go movetime ${movetimeMs}`);
      await this.engine.waitFor((l) => l.startsWith("bestmove"), movetimeMs + 8000);

      // Longest contiguous prefix (1..m) present at `depth`, capped at k.
      const prefixAt = (lines: Map<number, Line>): number => {
        let m = 0;
        for (let i = 1; i <= k; i++) {
          if (!lines.has(i) || lines.get(i)!.pv.length === 0) break;
          m = i;
        }
        return m;
      };

      // The largest complete prefix any single depth ever achieved (== k
      // when a full k-line set completed at some depth; less than k only
      // for near-forced positions with fewer than k legal moves).
      let maxPrefixEverSeen = 0;
      for (const lines of perDepth.values()) maxPrefixEverSeen = Math.max(maxPrefixEverSeen, prefixAt(lines));

      // Among depths achieving that max prefix, take the deepest one -- so
      // the result is both as complete as it can be AND as current as it
      // can be, while every returned line still comes from one depth.
      let chosenDepth = -1;
      let chosenLines: Map<number, Line> | null = null;
      for (const [depth, lines] of perDepth) {
        if (prefixAt(lines) === maxPrefixEverSeen && depth > chosenDepth) {
          chosenDepth = depth;
          chosenLines = lines;
        }
      }
      const chosenPrefix = maxPrefixEverSeen;

      const result: Evaluation[] = [];
      if (chosenLines) {
        for (let i = 1; i <= chosenPrefix; i++) {
          const line = chosenLines.get(i)!;
          result.push({ cp: line.cp, mate: line.mate, bestMove: line.pv[0], pv: line.pv, depth: chosenDepth });
        }
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
