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
 * Wave 0, item 3 (F3 seed): the ONE way any surface names a move by its
 * squares, from now on. Root cause of the owner-facing "E1 vs F1" bug: one
 * surface said the from-square, another said the to-square, for the SAME
 * move -- because there was no shared renderer, each surface improvised its
 * own phrasing. This always states both squares, in "from ... to ..."
 * order, lowercase (game-facing copy is lowercase, house rule) -- given a
 * piece-kind letter and squares, never a SAN/position lookup, so it never
 * fails and never needs a legality check the way describeSanMove above
 * does.
 */
export function describeMoveName(pieceKind: string, from: string, to: string): string {
  return `your ${pieceName(pieceKind)} from ${from.toLowerCase()} to ${to.toLowerCase()}`;
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
