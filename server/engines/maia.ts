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
    } catch {
      // go/no-go seam: strength-limited stockfish keeps the game playable
      this.fallback = true;
      this.engine = new UciEngine(ENGINE_PATHS.stockfish);
      await this.engine.init();
      this.engine.send("setoption name UCI_LimitStrength value true");
      this.engine.send(`setoption name UCI_Elo value ${Math.max(1320, this.elo)}`);
    }
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
