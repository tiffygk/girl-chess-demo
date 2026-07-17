export interface Evaluation {
  cp: number | null;
  mate: number | null;
  bestMove: string;
  pv: string[];
}
export interface Opponent {
  pickMove(fen: string): Promise<string>; // uci move
}
export interface Evaluator {
  init(): Promise<void>;
  evaluate(fen: string, movetimeMs?: number): Promise<Evaluation>;
  quit(): void;
}
