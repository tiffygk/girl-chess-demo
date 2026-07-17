import { UciEngine } from "./uci";
import { ENGINE_PATHS } from "./paths";
import type { Opponent } from "./types";

// Labeled starting value from the 2026-07-17 playtest (task B9): the owner reported
// maia-1100 "feels much higher than 1100." With `go nodes 1` and lc0's default
// Temperature (0 = argmax), Maia always plays the single most probable human move,
// which is stronger than the rating band its policy was trained on -- real 1100
// players sample from that distribution, mistakes included. Temperature=1.0 samples
// the root move proportionally to Maia's policy (tau in the softmax formula), which
// is the intended way to reproduce human-band play. lc0's `--help --show-hidden`
// confirms the option (UCI: Temperature, DEFAULT 0.00, MIN 0.00, MAX 100.00) and it
// is honored via `setoption` at nodes=1 even though it's hidden from the default
// `uci` option list (verified empirically: 5x query of startpos-after-1.e4 at
// Temperature=0 returned e7e5 every time; at Temperature=1.0 it varied across
// e7e5/b7b6/c7c6/a7a6/c7c5). Revisit this value after real playtesting feedback.
const MAIA_TEMPERATURE = 1.0;

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
      this.engine.send(`setoption name Temperature value ${MAIA_TEMPERATURE}`);

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
