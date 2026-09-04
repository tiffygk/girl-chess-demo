import fs from "node:fs";
import path from "node:path";

// N2 (2026-08-21): ALLOWED_ELOS (server/index.ts) and OPPONENT_ELOS
// (src/game/GamePage.tsx) are two independent literals, and neither was ever
// checked against what is actually on disk. A band with no weights file does
// not error: lc0 fails to load, MaiaOpponent.engageFallback() swaps in
// strength-limited stockfish at Math.max(1320, elo), and the game is written
// as "fallback-1900". A stockfish 1900 is far stronger and far less human
// than a maia 1900, so the degradation is both silent AND wrong. Fail loudly
// at startup instead.
//
// Maia weight files are gzip members of roughly 1.3 MB. An interrupted
// download leaves a short file that exists but cannot load, and the only
// symptom used to be "lc0 unavailable" at game start. Check the two cheap
// facts a damaged file fails: the gzip magic bytes and a size floor.
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const MIN_BYTES = 100_000;

export type WeightsState = { elo: number; file: string; state: "ok" | "missing" | "damaged" };

export function inspectWeights(elos: number[], weightsPathFor: (elo: number) => string): WeightsState[] {
  return elos.map((elo) => {
    const file = weightsPathFor(elo);
    if (!fs.existsSync(file)) return { elo, file, state: "missing" };
    try {
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, "r");
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      fs.closeSync(fd);
      const ok = size >= MIN_BYTES && head.equals(GZIP_MAGIC);
      return { elo, file, state: ok ? "ok" : "damaged" };
    } catch {
      return { elo, file, state: "damaged" };
    }
  });
}

function rel(file: string): string {
  const r = path.relative(process.cwd(), file);
  return r.startsWith("..") ? file : r;
}

export function assertWeightsPresent(elos: number[], weightsPathFor: (elo: number) => string): void {
  const states = inspectWeights(elos, weightsPathFor);
  const damaged = states.filter((s) => s.state === "damaged");
  const missing = states.filter((s) => s.state === "missing");
  if (damaged.length > 0) {
    const names = damaged.map((s) => rel(s.file)).join(", ");
    throw new Error(
      `the opponent file${damaged.length > 1 ? "s" : ""} ${names} ${damaged.length > 1 ? "are" : "is"} damaged (an interrupted download). delete ${damaged.length > 1 ? "them" : "it"} and run ./setup.sh again.`
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `opponent files for strength ${missing.map((s) => s.elo).join(", ")} are missing. run ./setup.sh to download them.`
    );
  }
}
