import fs from "node:fs";

// N2 (2026-08-21): ALLOWED_ELOS (server/index.ts) and OPPONENT_ELOS
// (src/game/GamePage.tsx) are two independent literals, and neither was ever
// checked against what is actually on disk. A band with no weights file does
// not error: lc0 fails to load, MaiaOpponent.engageFallback() swaps in
// strength-limited stockfish at Math.max(1320, elo), and the game is written
// as "fallback-1900". A stockfish 1900 is far stronger and far less human
// than a maia 1900, so the degradation is both silent AND wrong. Fail loudly
// at startup instead. Injectable fs predicate so the test never touches disk.
export function assertWeightsPresent(
  elos: number[],
  weightsPathFor: (elo: number) => string,
  exists: (path: string) => boolean = (p) => fs.existsSync(p)
): void {
  const missing = elos.filter((elo) => !exists(weightsPathFor(elo)));
  if (missing.length === 0) return;
  throw new Error(
    `missing maia weights for elo ${missing.join(", ")}. run setup.sh to download them.`
  );
}
