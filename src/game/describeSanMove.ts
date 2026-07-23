// Debrief Plain-English Notation round, Task 1: the shared pure renderer
// behind every plain-English move mention in the deterministic debrief
// (turningPointNote.ts, DebriefPage.tsx, debriefBullets.ts) as well as
// hintFlow.ts's own describeBestMove (which now delegates here — see that
// file). Given a SAN and the position it was played FROM, plays it with
// chess.js and returns the plain-English phrase, or null if the SAN is
// illegal in that position (honesty gate: no guess, callers fall back to
// raw SAN). pieceName lives here too (moved from hintFlow.ts, re-exported
// there for backward compatibility) so this file has no dependency on
// hintFlow.ts and hintFlow.ts can safely import from here instead.

import { Chess } from "chess.js";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Spells out a chess.js piece-kind letter ("n") as a word ("knight"). */
export function pieceName(kind: string): string {
  return PIECE_NAMES[kind] ?? "piece";
}

/**
 * Plain-English rendering of `san` played on `fenBefore`. Disambiguated SAN
 * ("Nbd7") drops the disambiguator, since chess.js's parsed move already
 * carries the single resolved from/to. Returns null when `san` isn't legal
 * in `fenBefore`, or `fenBefore` itself doesn't parse — never a guess.
 */
export function describeSanMove(san: string, fenBefore: string): string | null {
  let probe: Chess;
  try {
    probe = new Chess(fenBefore);
  } catch {
    return null;
  }
  let mv;
  try {
    mv = probe.move(san);
  } catch {
    mv = null;
  }
  if (!mv) return null;
  const suffix = probe.isCheckmate() ? ", checkmate" : probe.isCheck() ? ", check" : "";
  if (mv.flags.includes("k")) return `castle short${suffix}`;
  if (mv.flags.includes("q")) return `castle long${suffix}`;
  const isCapture = mv.flags.includes("c") || mv.flags.includes("e");
  let phrase = `${pieceName(mv.piece)} ${isCapture ? "takes on" : "to"} ${mv.to}`;
  if (mv.flags.includes("p") && mv.promotion) phrase += `, becoming a ${pieceName(mv.promotion)}`;
  return `${phrase}${suffix}`;
}

/**
 * Visual-gate catch (2026-07-22): when a caller is about to append its own
 * "· {label}" context and that label already conveys check/mate
 * ("checkmate"/"check"), describeSanMove's own trailing suffix on the same
 * phrase reads as a dupe ("queen takes on c8, checkmate · checkmate"). This
 * strips ONLY that redundant suffix for that display context — it never
 * touches describeSanMove's own output, which still wants the suffix
 * wherever the move stands alone in a sentence (coach hints, debrief prose).
 * A no-op when the label doesn't match, or the phrase has no such suffix.
 */
export function stripRedundantCheckSuffix(described: string, label: string): string {
  if (label !== "checkmate" && label !== "check") return described;
  return described.replace(/, (checkmate|check)$/, "");
}
