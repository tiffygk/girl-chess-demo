export interface Evaluation {
  cp: number | null;
  mate: number | null;
  bestMove: string;
  pv: string[];
}
export interface Opponent {
  pickMove(fen: string): Promise<string>; // uci move
}
