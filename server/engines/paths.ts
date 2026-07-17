import path from "path";

export const ENGINE_PATHS = {
  stockfish: "stockfish",
  lc0: "lc0",
  weightsDir: path.resolve(process.cwd(), "weights"),
  maiaWeights: (elo: number) =>
    path.resolve(process.cwd(), "weights", `maia-${elo}.pb.gz`),
};
