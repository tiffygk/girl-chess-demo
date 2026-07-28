export interface Evaluation {
  cp: number | null;
  mate: number | null;
  bestMove: string;
  pv: string[];
  // The search depth this evaluation was read at. Set by evaluateMulti (all
  // lines it returns share one depth, by construction -- see stockfish.ts);
  // left undefined by the single-line evaluate(), which has no cross-line
  // consistency to vouch for.
  depth?: number;
}
export interface Opponent {
  pickMove(fen: string): Promise<string>; // uci move
}
export interface Evaluator {
  init(): Promise<void>;
  evaluate(fen: string, movetimeMs?: number): Promise<Evaluation>;
  // Task 5 (trade-aware hints, increment 3.95): the multipv seam --
  // returns the engine's top `k` lines for `fen`, best first. Optional so
  // existing Evaluator implementers (test doubles, any future engine) are
  // never forced to grow it; server/annotator/hint.ts's computeHint falls
  // back to a single-line evaluate() call when it's absent. The judge path
  // (classify.ts/adjudicate.ts) only ever calls evaluate() and never this,
  // so it is completely unaffected by whether an implementer has this.
  evaluateMulti?(fen: string, movetimeMs: number, k: number): Promise<Evaluation[]>;
  quit(): void;
}
