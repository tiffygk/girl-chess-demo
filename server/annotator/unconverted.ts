// Game-151 round (2026-07-29): the result-vs-eval detector. rca.md B5:
// exactly one of the 24 finished games with evals ended with final white
// winprob >= 0.85 and a result other than 1-0 (game 151), and no code
// noticed. Third instance of the "real failure with no eval swing" class
// (siege 7-19, missed mates 7-28): once winprob pins at 1.0 every deltaP
// is 0 by construction and no threshold can see it.
//
// HARD CONSTRAINT (every annotator pass): engine math over STORED evals
// only, no evaluator call, no LLM, ever.
//
// Claims: the game ended strictly worse than the position supported, the
// ply where the terminal winning run began, how it ended, and -- ONLY when
// provable from already-stored data -- the ply that entered a repeating
// cycle when a non-repeating winning alternative was on record. MUST NOT
// claim a blunder outside that provable case, or a deltaP magnitude.
//
// Fix wave (2026-07-29, review-2.md SPEC COMPLIANCE FAIL): the original
// anchor here ("first stored mate reading in the winning run") was WRONG.
// feedback-unconverted-copy.md is the binding ruling: the owner said, of
// game 151, "I did have a blunder move, which was doing the repetition. I
// could have easily not done that" -- the anchor must be the first ply
// that ENTERED THE REPEATING CYCLE and has a stored, non-repeating
// alternative that kept her winning. The mate-reading rule landed on ply
// 43 for real game 151 by COINCIDENCE (it happened to be the first mate
// reading AND the repetition entry in this one game); proven by
// review-2.md's perturbation: reading plies 42/44 as cp instead of mate
// (squarely inside this evaluator's own documented self-disagreement band
// -- it returned mate-12 and mate-10 for the SAME fen at different times)
// walked the old rule to ply 47, the ply the owner explicitly forbade,
// naming `f6g5` (Qg5+, the move she actually played) as "the alternative."
// findRepetitionAnchor below replaces it: a chess.js replay locates the
// repeated position, and only a genuinely different, non-repeating stored
// best_move at HER decision point counts as an escape. See that function's
// comment for the full mechanism and scout-unconverted-data.md for the
// verification against real game 151 (anchor ply 43, Ne7+ mate-in-12 on
// record; ply 47 has no escape on record -- its stored best_move IS the
// repeat itself).
import { Chess } from "chess.js";
import { buildDeltaSeries, type MoveEval } from "./turningPoints";

// Owner-calibratable. Shared with tools/replay-check.ts's B1 invariant --
// import from here, never redeclare, so the detector and the gate cannot
// drift onto different thresholds.
export const UNCONVERTED_MIN_P = 0.85;

// F6 fix (review-2.md MEDIUM): a terminal run of length 1 used to qualify,
// so a single noisy final reading was enough to declare an "unconverted
// win" on a game she was never really winning. Verified against her real
// short draws (games 113 at 4 plies, 140 at 16, 127 at 24): bumping ONLY
// the last stored eval above UNCONVERTED_MIN_P produces exactly a 1-ply
// run in every one of them. Requiring a run at least this long eliminates
// every one of those false positives outright (a single bumped reading
// can never produce a run this long) while leaving game 151's real run
// (17 plies, 34-50) untouched by a wide margin. 4 (two full move pairs) is
// a round, conservative floor picked for that margin -- not fit to either
// number -- and, like UNCONVERTED_MIN_P, is owner-calibratable.
export const UNCONVERTED_MIN_RUN_PLIES = 4;

export interface UnconvertedEvent {
  ply: number; // first ply of the terminal >= UNCONVERTED_MIN_P run
  endPly: number; // last evaluated ply of that same run (bounds anchor search)
  san: string;
  finalP: number; // white winprob at the last evaluated ply
  endKind: "repetition" | "stalemate" | "fifty moves" | "called early";
}

// How the game actually ended, re-derived from the SANs. games.end_reason
// is NULL for every non-checkmate finish (rca N3); re-deriving covers
// historical games too, so the finish path stays untouched.
export function deriveEndKind(moves: MoveEval[]): UnconvertedEvent["endKind"] {
  const chess = new Chess();
  for (const mv of [...moves].sort((a, b) => a.ply - b.ply)) {
    try {
      chess.move(mv.san);
    } catch {
      return "called early";
    }
  }
  if (chess.isStalemate()) return "stalemate";
  if (chess.isThreefoldRepetition()) return "repetition";
  if (chess.isDrawByFiftyMoves()) return "fifty moves";
  return "called early";
}

export function detectUnconverted(moves: MoveEval[], finalResult: string): UnconvertedEvent | null {
  if (moves.length === 0) return null;
  if (/1-0/.test(finalResult)) return null;
  if (!/1\/2-1\/2|0-1/.test(finalResult)) return null; // unfinished/unknown: never guess
  const series = buildDeltaSeries(moves);

  let lastIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]) { lastIdx = i; break; }
  }
  if (lastIdx < 0) return null; // no readings at all
  const finalP = series[lastIdx]!.p;
  if (finalP < UNCONVERTED_MIN_P) return null;

  // Walk back through the unbroken terminal run of >= threshold readings.
  // A null reading breaks the run -- never claim a hold without a reading
  // (same rule as the backfill hold check above this file's call site).
  let startIdx = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const d = series[i];
    if (!d || d.p < UNCONVERTED_MIN_P) break;
    startIdx = i;
  }

  const runLen = lastIdx - startIdx + 1;
  if (runLen < UNCONVERTED_MIN_RUN_PLIES) return null; // F6: a single noisy reading is not a held win

  return {
    ply: moves[startIdx].ply,
    endPly: moves[lastIdx].ply,
    san: moves[startIdx].san,
    finalP,
    endKind: deriveEndKind(moves),
  };
}

export interface RepetitionAnchor {
  ply: number; // her odd ply that entered the repeating cycle
  mateIn?: number; // stored mate distance backing the alternative, when present
}

// F1 fix (feedback-unconverted-copy.md, the owner's ruling): the
// unconverted anchor is the first ply that ENTERED the repeating cycle AND
// has a stored, non-repeating alternative that kept her winning.
//
// Method, zero fresh engine calls (only moves.best_move, already written
// live during play -- see manager.ts's attachEval):
//   1. Replay the full game with chess.js and key the position after every
//      ply on board+side-to-move+castling+en-passant (the real threefold
//      key, ignoring the halfmove/fullmove counters -- same key chess.js's
//      own isThreefoldRepetition uses internally).
//   2. The position that recurs is the one sitting at the FINAL ply (the
//      repetition that ended the game). Every ply immediately AFTER an
//      occurrence of that position, except the last occurrence (which ends
//      the game -- no move follows it), is a candidate "entry" -- the
//      first move of a lap that turned out to loop back.
//   3. Only HER (odd) candidate plies are eligible. A repeated position
//      with white to move is always reached after an EVEN ply, so her
//      candidates are automatic; if the repeated position has black to
//      move, no candidate is hers and this function honestly returns null
//      rather than anchoring on mallow's move.
//   4. For each candidate, in game order: read the PRIOR row's stored
//      best_move (the position she faced at this ply, per
//      turningPoints.ts's buildDeltaSeries header -- a row's own eval
//      describes the position for whoever moves NEXT). Replay to that
//      exact position, apply the stored UCI move via chess.js, and compare
//      the SAN chess.js generates to what she actually played -- never a
//      hand-rolled squares comparison, the same discipline
//      src/review/followedBest.ts uses (playedSan === bestSan). If the
//      alternative differs from what she played AND does not itself land
//      back on the repeated position, it is a genuine escape: return it.
//   5. Otherwise, try the next candidate. No candidate escapes: return
//      null (precision over recall -- never invent one).
//
// Verified against real game 151 (scout-unconverted-data.md): candidates
// are plies 43 and 47. Ply 43's prior row (ply 42) stores `c6e7` (Ne7+),
// mate-in-12, different from what she played (Qg5+) and not a repeat --
// returned. Ply 47 is never reached: 43 already answers. Had it been
// reached, its prior row (ply 46) stores `f6g5`, IDENTICAL to what she
// played there -- correctly rejected, matching the owner's "never ply 47."
interface RepetitionKeys {
  candidateEntries: number[]; // her odd-ply repetition-cycle entries, in game order
  finalKey: string | null; // fen-substring key of the position that recurs; null if no genuine repeat
}

// Extracted (P2 fix, review-2-pass2.md MEDIUM): the replay + key-collection
// + candidate-entry derivation used to live only inside findRepetitionAnchor,
// duplicated by nothing -- but that meant the set of plies it EXAMINES had
// no name outside this function, so a caller could not tell "this ply was
// vetted and rejected" from "this ply was never a repetition-cycle entry at
// all." Both share this single computation now: one source of truth for
// "which plies are repetition-cycle entries," never redeclared.
function computeRepetitionKeys(moves: MoveEval[]): RepetitionKeys {
  const sorted = [...moves].sort((a, b) => a.ply - b.ply);
  const chess = new Chess();
  const keys: string[] = [];
  for (const mv of sorted) {
    try {
      chess.move(mv.san);
    } catch {
      return { candidateEntries: [], finalKey: null }; // not a clean replay from the start position: never guess
    }
    keys.push(chess.fen().split(" ").slice(0, 4).join(" "));
  }
  if (keys.length === 0) return { candidateEntries: [], finalKey: null };
  const finalKey = keys[keys.length - 1];
  const occurrencePlies = sorted
    .map((mv, i) => (keys[i] === finalKey ? mv.ply : null))
    .filter((p): p is number => p != null);
  if (occurrencePlies.length < 2) return { candidateEntries: [], finalKey: null }; // no genuine repeat: never guess

  const maxPly = sorted[sorted.length - 1].ply;
  const candidateEntries = occurrencePlies
    .slice(0, -1) // drop the final occurrence: it ends the game, no move follows
    .map((p) => p + 1)
    .filter((p) => p % 2 === 1 && p <= maxPly);
  return { candidateEntries, finalKey };
}

// P2 fix (review-2-pass2.md MEDIUM): the full list of repetition-cycle
// ENTRY plies -- every ply findRepetitionAnchor examines as a candidate,
// whether it ultimately accepts one as a proven escape or rejects all of
// them for having none on record. Exported so downstream fallback paths
// (turningPoints.ts's collision-displacement scan) can exclude every one of
// them: a repetition-cycle entry ply is either the verified anchor (the
// first one with a genuine escape) or was specifically vetted and
// REJECTED -- and a rejected ply must stay rejected by every downstream
// path, never quietly re-selected as a "fallback" landing spot. That silent
// re-selection is exactly how ply 47, the owner's explicitly forbidden ply,
// reappeared through the collision scan (see turningPoints.ts's usage).
export function repetitionEntryPlies(moves: MoveEval[]): number[] {
  return computeRepetitionKeys(moves).candidateEntries;
}

export function findRepetitionAnchor(moves: MoveEval[]): RepetitionAnchor | null {
  const sorted = [...moves].sort((a, b) => a.ply - b.ply);
  const byPly = new Map(sorted.map((m) => [m.ply, m]));
  const { candidateEntries, finalKey } = computeRepetitionKeys(moves);
  if (finalKey == null) return null;

  for (const entryPly of candidateEntries) {
    const priorRow = byPly.get(entryPly - 1);
    const playedRow = byPly.get(entryPly);
    if (!priorRow?.bestMove || !playedRow) continue;

    const replay = new Chess();
    for (const mv of sorted) {
      if (mv.ply >= entryPly) break;
      replay.move(mv.san);
    }
    const uci = priorRow.bestMove;
    if (uci.length < 4) continue;
    let altMove;
    try {
      altMove = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" });
    } catch {
      continue; // stored best_move doesn't replay legally here: never guess
    }
    const altKey = replay.fen().split(" ").slice(0, 4).join(" ");
    const isSameMove = altMove.san === playedRow.san;
    if (!isSameMove && altKey !== finalKey) {
      return {
        ply: entryPly,
        mateIn: priorRow.evalMate != null && priorRow.evalMate >= 1 ? priorRow.evalMate : undefined,
      };
    }
  }
  return null;
}
