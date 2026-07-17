import { UciEngine } from "./uci";
import { ENGINE_PATHS } from "./paths";
import type { Opponent } from "./types";

export class MaiaOpponent implements Opponent {
  private engine!: UciEngine;
  public fallback = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private elo: number) {}

  async init() {
    try {
      this.engine = new UciEngine(ENGINE_PATHS.lc0, [
        `--weights=${ENGINE_PATHS.maiaWeights(this.elo)}`,
      ]);
      await this.engine.init();

      // lc0 loads weights lazily: a missing/corrupt weights file still answers
      // the uci handshake, and only fails once a search is requested. Probe
      // with a cheap search so a bad weights file is caught here, at init,
      // rather than surfacing as a 10s pickMove() timeout later.
      this.engine.send("position startpos");
      this.engine.send("go nodes 1");
      let line: string;
      try {
        line = await this.engine.waitFor(
          (l) => l.startsWith("bestmove") || l.startsWith("error"),
          8000
        );
      } catch {
        // probe timed out: treat like a broken-weights error
        line = "error";
      }
      if (line.startsWith("error")) {
        this.engine.quit();
        await this.engageFallback();
      }
    } catch {
      // go/no-go seam: strength-limited stockfish keeps the game playable
      await this.engageFallback();
    }
  }

  private async engageFallback() {
    this.fallback = true;
    this.engine = new UciEngine(ENGINE_PATHS.stockfish);
    await this.engine.init();
    this.engine.send("setoption name UCI_LimitStrength value true");
    this.engine.send(`setoption name UCI_Elo value ${Math.max(1320, this.elo)}`);
  }

  pickMove(fen: string): Promise<string> {
    const run = this.queue.then(async () => {
      this.engine.send(`position fen ${fen}`);
      // nodes 1 = human-typical move, per Maia usage rule; fallback uses movetime
      this.engine.send(this.fallback ? "go movetime 200" : "go nodes 1");
      const best = await this.engine.waitFor((l) => l.startsWith("bestmove"), 10000);
      return best.split(" ")[1];
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  quit() { this.engine?.quit(); }
}
