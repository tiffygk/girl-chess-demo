// Increment 3b: panel-ruled turning points. Implements
// .superpowers/sdd/rounds/2026-07-18-increment-3b/panel-ruling.md exactly
// (the binding Opus-judge synthesis of a 3-panelist debate over real game
// data — do not redesign the algorithm; see that file for the full spec).
//
// HARD CONSTRAINT (same PRD gate as classify.ts/adjudicate.ts/motifs.ts,
// pinned by classify.test.ts's source-scan): engine math only, reads
// STORED evals only, never touches the live evaluator/coach — no LLM call,
// ever.
//
// KNOWN DEVIATION FROM THE RULING'S PROSE (verified against real numbers,
// documented per the brief's "if a fixture's [detail] disagrees with your
// implementation, STOP and report the disagreement rather than adjusting
// the algorithm to force it"): the ruling's acceptance-fixture list calls
// several opponent-caused swing points "opponent blunder" that, computed
// precisely against the stated formula (K=0.00368, Δp vs previous non-null
// point), fall in the .08–.15 or .15–.25 bands (inaccuracy/mistake), not
// the >=.25 blunder band. This reproduces Panelist B's OWN loop-1 numbers
// exactly (game 105 ply 26: "+10.4pp won-material" in panel-loop-1.md,
// matching this file's 0.1036 to the stated tolerance) — so the discrepancy
// is in the ruling's synthesis prose (a looser, narrative use of "blunder"),
// not in this implementation. The one directly-checkable HER-move label
// (game 86 ply 15, "inaccuracy") matches the ruling exactly, including
// magnitude, which is why this file trusts the numeric bands over the
// prose. Ply, rank order, kind (swing vs backfill), and punishSan all
// reproduce the ruling's fixtures exactly — see turningPoints.test.ts.

import { Chess } from "chess.js";
import { detectConversion, type MoveEvalRow } from "./conversion";
import { detectUnconverted, findRepetitionAnchor, repetitionEntryPlies } from "./unconverted";

export interface TurningPoint {
  // Game-160 RCA round (2026-07-31): widened from a fixed 1..6 union to a
  // plain number. A long, real game can carry more than 3 swing/backfill
  // cards plus an episode plus an unconverted point plus a conversion
  // point -- server/store/db.ts's own `rank: number` column already agreed
  // with this; the fixed union here was the only place still narrower than
  // what actually gets stored.
  rank: number;
  ply: number;
  san: string;
  label: string; // exact lowercase vocabulary from the ruling
  punishSan?: string; // the "you punished with {san}" suffix source, when the guard passes
  deltaP: number; // signed, white perspective
  lowConfidence: boolean; // null-gap > TP_DEDUP_PLIES plies behind this point
  kind: "swing" | "backfill" | "episode" | "missed-win" | "unconverted" | "conversion";
  // debrief-v2, dedup fix: set on HER kept swing when the preceding kept
  // point in the same dedup cluster is an opponent-error label and her
  // swing is negative — the "missed punish" shape (she had a winning
  // capture/tactic and played something else instead). Purely positional
  // (derived from cluster order + label), never a new claim.
  missedPunish?: boolean;
  // debrief-v2, king-pressure episode: only set when kind === "episode" —
  // the last ply of the qualifying run (game end counts).
  plyEnd?: number;
  // 2026-07-22 (debrief copy grading): true iff this is HER move (odd ply)
  // and the win-probability crossed from advantage to non-advantage across
  // it — p was >= 0.5 BEFORE the move and < 0.5 AFTER. A purely factual,
  // literal read of buildDeltaSeries' own p/deltaP for this point (prevP =
  // p - deltaP), never a guess. Debrief copy (debriefBullets.ts/
  // debriefLesson.ts) uses this to pick firmer wording for a mistake/
  // inaccuracy that gave back a real lead, instead of flattening it to the
  // same "small slip" text used for a move that was never leading to begin
  // with. Undefined/false for episode points (no meaningful single-ply p).
  crossedAdvantage?: boolean;
  // Missed-win round (2026-07-28): set only when kind === "missed-win" —
  // the forced-mate depth she had (mateIn, from the PRIOR row's evalMate,
  // see missedWins.ts) and how many times a mate-in-<=MISSED_MATE_DEPTH
  // slipped this game (missedCount). One point per game, anchored at the
  // EARLIEST miss not already claimed by another point; deltaP is 0 by
  // construction (both sides of a missed mate sit at winprob ~1.0 — the
  // measured signal on the real game was 1.3e-6, which is WHY this point
  // exists outside the TP_FLOOR machinery; never "fix" it by lowering the
  // floor).
  mateIn?: number;
  missedCount?: number;
  // Game-151 round: set only when kind === "unconverted" -- how the game
  // actually ended, re-derived from the SANs (see unconverted.ts).
  endKind?: string;
  // Fix wave (2026-07-29, review-3.md HIGH finding 1): the unconverted
  // point's `ply` carries two structurally different meanings and the copy
  // layer must never confuse them. "repetition-entry" means ply IS
  // findRepetitionAnchor's verified escape ply -- a real turning moment
  // with a stored, non-repeating alternative on record (unconverted.ts).
  // "run-start" means no escape was ever proven -- every non-repetition
  // ending (findRepetitionAnchor is never even called for those), a
  // repetition whose candidate entries all failed to prove one, OR a
  // collision-displaced fallback ply (see the push site below) -- and ply
  // is simply the first ply of the terminal held-winning run, parity-fixed
  // to hers. It is NEVER a claim about when the win ended. Set only when
  // kind === "unconverted"; same "encode in types, not helpers" lesson as
  // ply-parity.
  anchorKind?: "repetition-entry" | "run-start";
  // Game-160 RCA round, Task K1 (2026-07-31): set on kind === "conversion"
  // only -- the shortest mate she ever held during the episode (mateIn,
  // conversion.ts's ConversionEpisode.bestMissed) and where the held-mate
  // run ended (plyEnd, already an existing field via the episode kind
  // above).
  //
  // Union review fix (H1+H2, 2026-07-31): `ply` is conversion.ts's
  // ConversionEpisode.bestMissedPly -- the ply she actually HELD the
  // shortest mate at -- NOT the run's start (conversion.ts's fromPly, as
  // this shipped originally). Two bugs collapsed into one fix: fromPly is
  // whichever side's ply happened to carry the first mate reading in the
  // run (mallow's in 7 of her 12 real conversion games -- H2, the same
  // "encode parity in the data" lesson CLAUDE.md already names, applied
  // here at the data layer since conversion.ts's own `side` field was
  // already correct); and even where fromPly was hers, it welded the run's
  // START ply to a mate distance (bestMissed) that was actually held at a
  // LATER ply, producing a bullet naming one move but describing a fact
  // true of a different one (H1, e.g. real game 160: fromPly 65 / move 33
  // versus bestMissedPly 87 / move 44, where mate-in-2 was actually held).
  // bestMissedPly is guaranteed hers by construction (conversion.ts's own
  // loop filters `row.side === "her"` before ever considering a ply), so
  // this point's `ply` can never again render mallow's move as her card.
  // One point per game, and only when the run actually contains real slip
  // evidence (a clean, unslipped mate march earns no card -- see the
  // gating comment at this kind's push site below) AND clears
  // conversion.ts's MIN_CONVERSION_RUN_PLIES span gate (M1 fix -- a
  // handful of plies of a flickering evaluator is not a conversion
  // episode; see that constant's own comment for real game 144's shape).
}

// debrief-v2: bumped when the turning-point algorithm changes shape in a way
// that changes stored output (dedup fix + episode detector). manager.ts's
// summary read path compares this against a persisted row's algo_version
// (NULL treated as 1) to decide whether to heal an old game's stored rows —
// see server/store/db.ts's turning_points.algo_version column and
// manager.ts's getSummary.
// v3 = widened episode geometry (Chebyshev dist 2 + open-file shelter)
// v4 = adds crossedAdvantage (2026-07-22, debrief copy grading) — a shape
// change to TurningPoint, so old rows heal to pick up the new field.
// v5 = missed-win points (2026-07-28) — a game where she let a forced
// mate-in-1 slip gains one "missed mate" point on heal, which is exactly
// what retro-fixes games 149/150's debriefs the next time they're opened.
// v6: game-151 round, unconverted-win point — a game that ended level or
// lost from a held winning eval (result vs eval, invisible to every
// delta-based detector above) gains one "unconverted win" point on heal.
// v7: game-160 RCA round, Task K1 (2026-07-31, owner ruling 7 -- approved
// across her whole corpus). Two shape changes: (1) the missed-win point's
// SOURCE widens from missedWins.ts's depth-1, mate-only detector to
// conversion.ts's depth-5, slip-aware one (MISSED_MATE_DEPTH 1 -> 5,
// MATE_SLIP_MIN 2), so a game with real mate-DISTANCE slips but zero
// mate-in-1 misses (game 160's actual shape) now gets a missed-win point
// where it silently got none before; (2) a new "conversion" point, one per
// game, naming the shortest mate she ever held during a mate run and how
// long the run took, appended whenever that run shows real slip evidence.
// Old games heal to pick up both on their next summary read.
export const TP_ALGO_VERSION = 7;

// Owner-calibratable: cp -> winprob steepness. This is the same constant as
// chess.com's published win% formula (0.00368208, here to 3 sig figs per
// the ruling) — mathematically it IS the same sigmoid, just algebraically
// rearranged there as 50 + 50*(2/(1+exp(-Kx))-1).
export const TP_K = 0.00368;
// Owner-calibratable: min |Δp| to count as a turning point.
export const TP_FLOOR = 0.08;
// Owner-calibratable: dedup window (plies) — also reused as the null-gap
// threshold for lowConfidence, per the ruling's "gap > 2 plies" language
// (the same "2" both places).
export const TP_DEDUP_PLIES = 2;

// Task 11 fix 1: the honest-backfill branch below (fired only when fewer
// than 3 real swings qualified) surfaces a turning point for a game that
// trended inexorably toward a win/loss without any single ply's jump ever
// being dramatic enough to clear TP_FLOOR. It used to key on a single-ply
// touch of the winning/losing side of 0.5 — a 3b-review LOW, since a
// fleeting one-ply crossing is noisy and not a genuine "this became clearly
// winning/losing" moment. It now requires the win-prob to HOLD >=
// TP_HOLD_THRESHOLD (for the side that won) or <= 1 - TP_HOLD_THRESHOLD (for
// the side that lost) across a TP_HOLD_PLIES-ply window before it counts.
// Owner-calibratable.
export const TP_HOLD_THRESHOLD = 0.9;
// Owner-calibratable: the hold window length, in plies (checked against
// consecutive entries of the winprob delta series, indexed the same as
// `moves` — a null-eval ply inside the window breaks the hold, since there's
// no reading to confirm the win-prob actually stayed up).
export const TP_HOLD_PLIES = 2;

// Shared label-band boundaries (her moves AND opponent moves use the same
// numeric tiers per the ruling's vocabulary line) — exported so
// classifications.ts imports the same numbers rather than re-declaring them.
//
// Owner recalibration (2026-07-22): a real game's Bxe4 gave back a clear
// advantage (+1.44 -> -0.12, Δp -0.1405) and the original 0.15 floor still
// read it as an "inaccuracy" — too soft for a swing that erases a lead
// entirely. Lowered to 0.13 so a swing this size reads as a mistake.
// Blunder stays reserved for going-from-fine-to-losing / hanging material,
// unchanged at 0.25.
export const TP_BAND_MISTAKE = 0.13;
export const TP_BAND_BLUNDER = 0.25;

export interface MoveEval {
  ply: number;
  san: string;
  evalCp: number | null;
  evalMate: number | null;
  // Fix wave (2026-07-29, F1): the UCI move the evaluator recommended for
  // the position AFTER this ply (i.e. the best move for whoever moves
  // NEXT) -- already persisted live during play (moves.best_move, see
  // manager.ts's attachEval). Optional so every existing MoveEval literal
  // in this codebase (none of which needed it before unconverted.ts's
  // findRepetitionAnchor) keeps compiling unchanged. Only
  // findRepetitionAnchor reads it, and only to check whether a stored
  // alternative to a repetition-entering move exists -- never a fresh
  // evaluator call.
  bestMove?: string | null;
}

// Mate cap: M±n -> wcp ±(3000 - 10*min(n,20)), so a fast forced mate scores
// higher than a slow one but every mate still dominates any plausible
// centipawn swing.
function mateToRawSigned(mate: number): number {
  const sign = mate < 0 ? -1 : 1;
  return sign * (3000 - 10 * Math.min(Math.abs(mate), 20));
}

export function winProb(whiteCp: number): number {
  return 1 / (1 + Math.exp(-TP_K * whiteCp));
}

export interface DeltaPoint {
  idx: number;
  ply: number;
  san: string;
  p: number; // white winprob AFTER this ply
  deltaP: number; // signed, white perspective, vs previous non-null point
  lowConfidence: boolean;
  moverIsWhite: boolean;
  // Wave E, Task E1: the already-computed normalized white-perspective cp
  // (mate-capped via mateToRawSigned, same value `p` was derived from a few
  // lines below) -- encoded in data so the lead-change detector (E2) keys
  // on eval LEVEL without ever re-deriving the odd/even parity sign itself
  // (the ply-parity lesson: encode the convention in data, not in a helper
  // every caller has to remember to call correctly).
  whiteCp: number;
}

/**
 * The shared winprob/delta engine — computeTurningPoints and
 * classifyMoves both build on this so there is exactly one conversion
 * (per the brief: "sharing the SAME conversion... one winprob function").
 *
 * CRITICAL normalization (all three loop-1 panelists + the judge confirmed
 * against real data, and this file's own re-derivation against game 105's
 * ply 42/43 mate-parity fixture pins it): stored evals are SIDE-TO-MOVE
 * signed as of the position AFTER the ply was played. Ply 1 is white's
 * move, so after an ODD ply it is black's turn — the stored value is
 * black-perspective and must be NEGATED to reach white perspective. After
 * an EVEN ply it is white's turn — the stored value is already
 * white-perspective, used as-is.
 *
 * Δp for ply i is p[i] minus the p of the previous NON-NULL point (a null
 * eval is skipped entirely, never used as an anchor — "never anchor on a
 * null" per the ruling). The very first non-null point compares against
 * the assumed starting position (dead equal, p=0.5). lowConfidence marks a
 * point whose null-gap back to that anchor exceeds TP_DEDUP_PLIES.
 *
 * An actual delivered checkmate (SAN containing "#" — by the rules of
 * chess this can only be the LAST move of the game) gets its whiteCp
 * forced to the extreme (+3000 if white just delivered it, -3000 if
 * black did) rather than trusting whatever the stored eval says for that
 * ply. A mated position may not evaluate cleanly at all (no legal moves
 * left), and a degenerate "mate distance 0" artifact run through the
 * ordinary mate-cap formula would produce nonsense (it would NOT reliably
 * read as "the mating side is winning") — that nonsense would otherwise
 * corrupt both the swing detection here and classifyMoves' her-move bands
 * with a fabricated near-100pp delta on the winning move itself.
 */
export function buildDeltaSeries(moves: MoveEval[]): (DeltaPoint | null)[] {
  const whiteCp: (number | null)[] = new Array(moves.length).fill(null);
  const p: (number | null)[] = new Array(moves.length).fill(null);

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const isWhitePly = mv.ply % 2 === 1;

    if (mv.san.includes("#")) {
      whiteCp[i] = isWhitePly ? 3000 : -3000;
      p[i] = winProb(whiteCp[i]!);
      continue;
    }

    let raw: number | null = null;
    if (mv.evalMate != null) raw = mateToRawSigned(mv.evalMate);
    else if (mv.evalCp != null) raw = mv.evalCp;
    if (raw == null) continue; // no eval captured for this ply

    whiteCp[i] = isWhitePly ? -raw : raw;
    p[i] = winProb(whiteCp[i]!);
  }

  let prevP = 0.5;
  let prevPly = 0;
  const series: (DeltaPoint | null)[] = new Array(moves.length).fill(null);
  for (let i = 0; i < moves.length; i++) {
    if (p[i] == null) continue;
    const gap = moves[i].ply - prevPly;
    series[i] = {
      idx: i,
      ply: moves[i].ply,
      san: moves[i].san,
      p: p[i]!,
      deltaP: p[i]! - prevP,
      lowConfidence: gap > TP_DEDUP_PLIES,
      moverIsWhite: moves[i].ply % 2 === 1,
      whiteCp: whiteCp[i]!,
    };
    prevP = p[i]!;
    prevPly = moves[i].ply;
  }
  return series;
}

function labelForSwing(d: DeltaPoint): string | null {
  const mag = Math.abs(d.deltaP);
  if (d.moverIsWhite) {
    if (d.deltaP > 0) return "strong move";
    if (mag >= TP_BAND_BLUNDER) return "blunder";
    if (mag >= TP_BAND_MISTAKE) return "mistake";
    return "inaccuracy"; // mag >= TP_FLOOR guaranteed by the candidate filter
  }
  // Opponent move.
  if (d.deltaP < 0) {
    // The opponent's move was actually GOOD for them (bad for white) — not
    // an opponent error, so the inaccuracy/mistake/blunder vocabulary
    // doesn't apply. The ruling gates "the losing move" specifically to
    // when this drags white's winprob below .25; outside that gate there
    // is no vocabulary word for "opponent played well" yet, so this point
    // is not a valid turning point ("never inventing a swing") — the
    // caller drops it rather than mislabeling it.
    return d.p < 0.25 ? "the losing move" : null;
  }
  if (mag >= TP_BAND_BLUNDER) return "opponent blunder";
  if (mag >= TP_BAND_MISTAKE) return "opponent mistake";
  return "opponent inaccuracy";
}

interface Selected extends DeltaPoint {
  label: string;
  punishSan?: string;
  kind: "swing" | "backfill";
  missedPunish?: boolean;
}

function attachPunishSuffix(point: Selected, moves: MoveEval[], series: (DeltaPoint | null)[]): void {
  // C-sourced guard (re-attribution only as a label SUFFIX, never a
  // magnitude change): only for opponent-error points, only when her very
  // next ply's SAN contains x or +, and only when her reply doesn't itself
  // give much back (Δp >= -0.02).
  if (point.moverIsWhite) return;
  if (!point.label.startsWith("opponent")) return;
  const nextIdx = point.idx + 1;
  if (nextIdx >= moves.length) return;
  const next = moves[nextIdx];
  if (next.ply % 2 !== 1) return; // must be her reply
  if (!/[x+]/.test(next.san)) return;
  const nextSeries = series[nextIdx];
  if (!nextSeries) return;
  const replyDelta = nextSeries.p - point.p;
  if (replyDelta >= -0.02) point.punishSan = next.san;
}

// debrief-v2: king-pressure episode detector. Sustained danger (opponent
// pieces camped on her king, shelter broken, plies of defensive shuffling)
// is a STATE, not an eval EVENT — per-ply |Δp| can stay under TP_FLOOR the
// whole time because the engine judges the position technically defensible,
// even though it's the most lived part of the game. Pure chess.js board-fact
// replay from the start position — no eval, no engine, no LLM. "Her" is
// always white (player is always white in v1 — see manager.ts's resign()).
export const EP_MIN_PLIES = 6;

// debrief-v2 gate fix (game 127, her REAL moves — see turningPoints.test.ts):
// the original 3x3/2-shelter-pawns geometry missed her real king-pressure
// episode entirely. In the real game the opponent queen sat at h3 with her
// king on g1/h1 — Chebyshev distance up to 2, OUTSIDE the old 3x3 (distance
// <=1) zone — and after gxf3 her f2+f3+h2 pawns still counted as "2+
// shelter pawns" even though the g-file next to her king was ripped open.
// Widened to a literal-board-fact definition that catches both:
// opponent-piece proximity out to distance 2, and shelter defined as
// open-file exposure rather than a raw pawn count.
export const EP_QUEEN_DIST = 2;
export const EP_PIECE_DIST = 2;
// Shelter: a file counts as covered only if a friendly pawn stands within
// this many ranks in front of the king on that file.
export const EP_SHELTER_RANKS = 3;

// Chebyshev-distance block centered on `kingSquare` (its own square
// included), clamped to the board.
function kingZoneSquares(kingSquare: string, dist: number): string[] {
  const file = kingSquare.charCodeAt(0) - 97;
  const rank = parseInt(kingSquare[1], 10) - 1;
  const squares: string[] = [];
  for (let df = -dist; df <= dist; df++) {
    for (let dr = -dist; dr <= dist; dr++) {
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      squares.push(String.fromCharCode(97 + f) + (r + 1));
    }
  }
  return squares;
}

// Both literal board facts, ANDed per the brief: (1) an opponent queen
// within Chebyshev distance EP_QUEEN_DIST of her king, or 2+ opponent
// N/B/R/Q pieces within Chebyshev distance EP_PIECE_DIST; (2) her pawn
// shelter is broken — open-file exposure, not a raw pawn count: at least
// one of the up-to-3 files containing or adjacent to her king has NO
// friendly pawn within EP_SHELTER_RANKS ranks in FRONT of the king (white's
// front = higher ranks). This catches a doubled-pawn shelter that still
// leaves an open file next to the king (her real game 127: f2+f3 doubled,
// g-file wide open) — a raw pawn-count check cannot.
function kingPressureHolds(chess: Chess): boolean {
  const board = chess.board(); // board[0] = rank 8 ... board[7] = rank 1
  let kingSquare: string | null = null;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (sq && sq.type === "k" && sq.color === "w") kingSquare = String.fromCharCode(97 + f) + (8 - r);
    }
  }
  if (!kingSquare) return false;

  const queenZone = new Set(kingZoneSquares(kingSquare, EP_QUEEN_DIST));
  const pieceZone = new Set(kingZoneSquares(kingSquare, EP_PIECE_DIST));
  let queenInZone = false;
  let pieceCount = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq || sq.color !== "b") continue;
      const alg = String.fromCharCode(97 + f) + (8 - r);
      if (sq.type === "q" && queenZone.has(alg)) queenInZone = true;
      if ((sq.type === "n" || sq.type === "b" || sq.type === "r" || sq.type === "q") && pieceZone.has(alg)) {
        pieceCount++;
      }
    }
  }
  if (!queenInZone && pieceCount < 2) return false;

  const kingFile = kingSquare.charCodeAt(0) - 97;
  const kingRank = parseInt(kingSquare[1], 10) - 1; // 0-indexed
  const files = [kingFile - 1, kingFile, kingFile + 1].filter((f) => f >= 0 && f <= 7);
  for (const f of files) {
    let covered = false;
    for (let dr = 1; dr <= EP_SHELTER_RANKS; dr++) {
      const r = kingRank + dr;
      if (r < 0 || r > 7) continue;
      const sq = board[7 - r][f];
      if (sq && sq.type === "p" && sq.color === "w") covered = true;
    }
    if (!covered) return true; // an open file next to the king: shelter broken
  }
  return false;
}

export interface KingPressureEpisode {
  plyStart: number;
  plyEnd: number;
  deltaP: number;
  san: string;
}

// debrief-v2 calibration sweep (task 7b): computeTurningPoints already
// builds the winprob delta series once for its own swing detection and
// then called this function with just `moves`, forcing a second, redundant
// buildDeltaSeries pass over the exact same move list just to read
// series[startIdx]/series[endIdx] below. The optional `series` param lets
// that caller pass its already-computed series through; any DIRECT caller
// (every existing test in this file calls detectKingPressureEpisode(moves)
// with no second argument) still gets it computed internally, so behavior
// is unchanged for them — this is a pure sharing optimization, not a
// behavior change.
export function detectKingPressureEpisode(
  moves: MoveEval[],
  series?: (DeltaPoint | null)[]
): KingPressureEpisode | null {
  if (moves.length === 0) return null;

  const chess = new Chess();
  const flags: boolean[] = [];
  for (const mv of moves) {
    try {
      chess.move(mv.san);
    } catch {
      // Not a replayable game from the standard start position (synthetic
      // fixture, corrupted data) — no board facts to derive an episode
      // from; never fabricate one.
      return null;
    }
    flags.push(kingPressureHolds(chess));
  }

  // Longest run of consecutive qualifying plies; emit at most one episode
  // per game (the ruling's "the longest run").
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  if (bestLen < EP_MIN_PLIES) return null;

  const startIdx = bestStart;
  const endIdx = bestStart + bestLen - 1;
  const resolvedSeries = series ?? buildDeltaSeries(moves);
  const startP = resolvedSeries[startIdx]?.p ?? 0.5;
  const endP = resolvedSeries[endIdx]?.p ?? 0.5;

  return {
    plyStart: moves[startIdx].ply,
    plyEnd: moves[endIdx].ply,
    deltaP: endP - startP,
    san: moves[startIdx].san,
  };
}

// Wave E: the "decision checkpoint" the swing detector can never produce
// (owner ask, game 189 chat, 2026-08) -- the move that establishes a lead
// usually arrives in sub-TP_FLOOR steps (game 189's Bb4: deltaP 0.062), so
// this keys on eval LEVEL (a centipawn band), never on winprob delta.
// TP_FLOOR stays untouched -- the two detectors answer different questions.
// Owner-calibratable: about a minor piece's worth; winProb(300) = 0.751.
export const LEAD_CP = 300;

export interface LeadChange {
  ply: number; // confirmed crossing ply (either side's move)
  san: string;
  leader: "her" | "mallow";
  marginCp: number; // |white cp| at the crossing, >= LEAD_CP
  nth: number; // 1-based ordinal of this leader change
  lowConfidence: boolean; // the crossing point's own null-gap flag
}

// Two mechanisms, both required (design questions 2/3,
// .superpowers/sdd/rounds/2026-08-27-coach-truth-continuation/... Wave E):
// (1) confirmation (anti-spike) -- a crossing only counts if the
// IMMEDIATELY FOLLOWING ply carries a reading still past the same band. A
// null-eval ply in between, or the game ending here, leaves it unconfirmed
// (never claim it held without a reading to prove it -- TP_HOLD_PLIES's own
// philosophy). Side effect: a terminal-ply crossing never fires, so the
// delivered mate stays backfill's job. (2) a Schmitt trigger (anti-chatter)
// -- leader state is none|her|mallow, moves to "her" only on a confirmed
// crossing of +LEAD_CP, to "mallow" only on a confirmed crossing of
// -LEAD_CP, and returning to the neutral zone does NOT clear it. A new card
// requires the OTHER side to reach a full confirmed lead -- the give-back
// itself is already a swing card, and pure Schmitt is her own words ("becomes
// the NEW leader") as code.
export function detectLeadChanges(series: (DeltaPoint | null)[]): LeadChange[] {
  const readings = series.filter((d): d is DeltaPoint & { whiteCp: number } => d != null);
  const out: LeadChange[] = [];
  let state: "none" | "her" | "mallow" = "none";
  for (let i = 0; i < readings.length; i++) {
    const d = readings[i];
    const next = i + 1 < readings.length ? readings[i + 1] : null;
    const adjacent = next != null && next.ply === d.ply + 1;
    if (state !== "her" && d.whiteCp >= LEAD_CP && adjacent && next.whiteCp >= LEAD_CP) {
      out.push({ ply: d.ply, san: d.san, leader: "her", marginCp: d.whiteCp,
                 nth: out.length + 1, lowConfidence: d.lowConfidence });
      state = "her";
    } else if (state !== "mallow" && d.whiteCp <= -LEAD_CP && adjacent && next.whiteCp <= -LEAD_CP) {
      out.push({ ply: d.ply, san: d.san, leader: "mallow", marginCp: -d.whiteCp,
                 nth: out.length + 1, lowConfidence: d.lowConfidence });
      state = "mallow";
    }
  }
  return out;
}

export function computeTurningPoints(moves: MoveEval[], finalResult: string): TurningPoint[] {
  if (moves.length <= 1) return [];

  const series = buildDeltaSeries(moves);
  if (series.every((d) => d == null)) return []; // all-null evals: nothing to fabricate from

  const lastIdx = moves.length - 1;
  const isTerminalMate = moves[lastIdx].san.includes("#");

  // Candidates: clear the floor, exclude the terminal delivered-checkmate
  // ply (that's handled exclusively via backfill below), and drop
  // opponent "played well but not yet losing" points (no label for them).
  const candidates: Selected[] = [];
  for (const d of series) {
    if (!d) continue;
    if (isTerminalMate && d.idx === lastIdx) continue;
    if (Math.abs(d.deltaP) < TP_FLOOR) continue;
    const label = labelForSwing(d);
    if (!label) continue;
    candidates.push({ ...d, label, kind: "swing" });
  }

  // Dedup: transitive clustering of candidates within TP_DEDUP_PLIES of
  // each other. debrief-v2 fix: a cluster used to collapse to a single
  // max-|Δp| member, which let an opponent blunder swallow her own missed
  // punish (or shelter-wrecking follow-up) in the same cluster — the two
  // most teachable moments of a game, gone. New rule: from each cluster
  // keep (a) the max-|Δp| member (any mover), AND (b) the max-|Δp| HER
  // (white) member when it's a DIFFERENT ply and already cleared the floor
  // (guaranteed — every candidate here already cleared it). Her-move swings
  // and opponent swings never cannibalize each other; two same-mover swings
  // in a cluster still dedup to the larger (herBest === best in that case,
  // so nothing is added twice).
  candidates.sort((a, b) => a.ply - b.ply);
  const clusters: Selected[][] = [];
  for (const c of candidates) {
    const last = clusters[clusters.length - 1];
    if (last && c.ply - last[last.length - 1].ply <= TP_DEDUP_PLIES) last.push(c);
    else clusters.push([c]);
  }
  const deduped: Selected[] = [];
  for (const cluster of clusters) {
    const best = cluster.reduce((a, b) => (Math.abs(b.deltaP) > Math.abs(a.deltaP) ? b : a));
    deduped.push(best);
    const herCandidates = cluster.filter((c) => c.moverIsWhite);
    if (herCandidates.length === 0) continue;
    const herBest = herCandidates.reduce((a, b) => (Math.abs(b.deltaP) > Math.abs(a.deltaP) ? b : a));
    if (herBest.ply === best.ply) continue; // best already IS her point; not added twice
    // "missed punish" shape: the OTHER kept point in this cluster is an
    // opponent-error label, precedes her point, and her kept swing is
    // negative — she had the chance to punish and didn't. Purely
    // positional (cluster order + label), no new claim.
    const missedPunish =
      herBest.deltaP < 0 && best.ply < herBest.ply && best.label.startsWith("opponent");
    deduped.push(missedPunish ? { ...herBest, missedPunish: true } : { ...herBest });
  }

  // Rank by significance. Ties (|Δp| equal): not-low-confidence beats
  // low-confidence (barred from tie wins) -> nearer p=.5 -> her ply ->
  // earlier ply.
  deduped.sort((a, b) => {
    const magDiff = Math.abs(b.deltaP) - Math.abs(a.deltaP);
    if (Math.abs(magDiff) > 1e-9) return magDiff;
    if (a.lowConfidence !== b.lowConfidence) return a.lowConfidence ? 1 : -1;
    const distDiff = Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5);
    if (Math.abs(distDiff) > 1e-9) return distDiff;
    if (a.moverIsWhite !== b.moverIsWhite) return a.moverIsWhite ? -1 : 1;
    return a.ply - b.ply;
  });

  const selected: Selected[] = deduped.slice(0, 3);

  // Backfill: only when fewer than 3 real swings qualified, and only ONE
  // point is ever added — the mate move (an actual delivered checkmate),
  // else the first ply where a mate-type eval appears favoring the
  // eventual winner (a forced-mate detection, not necessarily delivered on
  // board — e.g. an adjudicated game). Never fabricates a swing.
  if (selected.length < 3) {
    const sheWon = /1-0/.test(finalResult);
    const sheLost = /0-1/.test(finalResult);
    let backfill: Selected | null = null;

    if (isTerminalMate) {
      const mv = moves[lastIdx];
      backfill = {
        idx: lastIdx,
        ply: mv.ply,
        san: mv.san,
        p: mv.ply % 2 === 1 ? 1 : 0,
        // The terminal ply's own stored eval (if any) isn't a meaningful
        // continued-play probability (see buildDeltaSeries' comment) — this
        // point is included for the mate itself, not a measured swing.
        deltaP: 0,
        lowConfidence: false,
        moverIsWhite: mv.ply % 2 === 1,
        label: sheWon ? "checkmate" : sheLost ? "the losing move" : "checkmate",
        kind: "backfill",
      };
    } else {
      // Task 11 fix 1: scan the raw series (indexed the same as `moves`,
      // one slot per ply — NOT the null-skipping candidate list) for the
      // first ply whose win-prob crosses the threshold AND holds there for
      // the next TP_HOLD_PLIES-1 plies. A null-eval ply anywhere inside the
      // window breaks the hold (never claim it "held" without a reading to
      // confirm it).
      for (let i = 0; i < series.length; i++) {
        const d = series[i];
        if (!d) continue;
        const crosses = sheWon ? d.p >= TP_HOLD_THRESHOLD : sheLost ? d.p <= 1 - TP_HOLD_THRESHOLD : false;
        if (!crosses) continue;

        let holds = true;
        for (let j = i + 1; j < i + TP_HOLD_PLIES; j++) {
          const w = j < series.length ? series[j] : null;
          if (!w) { holds = false; break; }
          const stillCrosses = sheWon ? w.p >= TP_HOLD_THRESHOLD : w.p <= 1 - TP_HOLD_THRESHOLD;
          if (!stillCrosses) { holds = false; break; }
        }
        if (!holds) continue;

        backfill = { ...d, label: sheWon ? "the clincher" : "the losing move", kind: "backfill" };
        break;
      }
    }

    if (backfill && !selected.some((s) => s.ply === backfill!.ply)) {
      selected.push(backfill);
    }
  }

  for (const point of selected) attachPunishSuffix(point, moves, series);

  const points: TurningPoint[] = selected.map((s, i) => ({
    rank: i + 1,
    ply: s.ply,
    san: s.san,
    label: s.label,
    punishSan: s.punishSan,
    deltaP: s.deltaP,
    lowConfidence: s.lowConfidence,
    kind: s.kind,
    missedPunish: s.missedPunish,
    // prevP = p - deltaP (deltaP is p minus the previous non-null point, so
    // this recovers that previous point exactly) — literal arithmetic on
    // fields this same point already carries, no new lookup.
    crossedAdvantage: s.moverIsWhite && s.p - s.deltaP >= 0.5 && s.p < 0.5,
  }));

  // debrief-v2: the king-pressure episode is a STATE the per-ply swing
  // detector above structurally cannot see (eval stays flat while danger
  // sits on the board) — additional to, never instead of, the swing/backfill
  // points above. Max 4 cards total.
  const episode = detectKingPressureEpisode(moves, series);
  if (episode) {
    points.push({
      rank: points.length + 1,
      ply: episode.plyStart,
      plyEnd: episode.plyEnd,
      san: episode.san,
      label: "king pressure",
      deltaP: episode.deltaP,
      lowConfidence: false,
      kind: "episode",
    });
  }

  // Game-160 RCA round, Task K1 (2026-07-31): a missed or slipped forced
  // mate is invisible to the swing detector by construction (see TP_FLOOR's
  // comment) -- detected directly from the stored mate distances via
  // conversion.ts (own MISSED_MATE_DEPTH 5 / MATE_SLIP_MIN 2, wider than
  // missedWins.ts's byte-stable depth-1 detector -- see that file's header
  // for why the two stay separate). Kept as ONE aggregated point per game
  // (same shape the missed-win round shipped -- the anchor-selection
  // "already claimed" check stays an EXACT ply match, same as the old
  // algorithm; widening it to a TP_DEDUP_PLIES proximity check was tried
  // and reverted, see turningPoints.test.ts's "anchors on the first miss"
  // fixture, where a proximity check wrongly excluded a real miss sitting
  // two plies from an unrelated swing): a long held-mate run like game
  // 160's can carry many separate missed-mate events (four well-separated
  // pockets on the real data, 14-22 plies apart), and every consumer of
  // this TP (debriefBullets.ts's forced could-be-better/watch-next bullets,
  // debriefInvariants.ts's missed-mate-silent rule) is built around exactly
  // one missed-win point telling the whole story, its `missedCount`
  // counting every one of them. Splitting into per-cluster points would
  // need a matching redesign of the bullet/invariant layer this round does
  // not ask for and the corpus-wide replay-check gate would catch as silent
  // detector fire the moment more than 2 such points existed for one game
  // (buildCouldBeBetter/buildWatchNextTime each cap at 2 bullets).
  const evalRows: MoveEvalRow[] = [...moves]
    .sort((a, b) => a.ply - b.ply)
    .map((m) => ({
      ply: m.ply,
      side: m.ply % 2 === 1 ? "her" : "mallow",
      san: m.san,
      evalCp: m.evalCp,
      evalMate: m.evalMate,
    }));
  const gameSansForConversion = evalRows.map((r) => r.san);
  const { events: conversionEvents, episode: conversionEpisode } = detectConversion(
    evalRows,
    gameSansForConversion
  );

  // "lost-mate" counts too, same union missedWins.ts's own delegation uses
  // (see that file's header): whether the mate reading merely got slower
  // (missed-mate) or vanished entirely (lost-mate), she failed to convert
  // it, and the old shipped algorithm counted both without distinguishing.
  const missedMateEvents = conversionEvents
    .filter((e) => e.kind === "missed-mate" || e.kind === "lost-mate")
    .sort((a, b) => a.ply - b.ply);
  if (missedMateEvents.length > 0) {
    const anchor = missedMateEvents.find((e) => !points.some((p) => p.ply === e.ply));
    if (anchor) {
      points.push({
        rank: points.length + 1,
        ply: anchor.ply,
        san: evalRows.find((r) => r.ply === anchor.ply)?.san ?? "",
        label: "missed mate",
        deltaP: 0,
        lowConfidence: false,
        kind: "missed-win",
        mateIn: anchor.mateBefore ?? undefined,
        missedCount: missedMateEvents.length,
      });
    }
  }

  // Game-151 round: result vs eval. A game ending level (or lost) from a
  // held winning evaluation is invisible to the swing detector by
  // construction -- detected from the final readings vs the recorded
  // result, appended as one point per game so every turning-point surface
  // (cards, arrows, try-the-line, notes, chat full-detail) lights up with
  // no new plumbing.
  //
  // Fix wave (2026-07-29, review-2.md F1/F2/F3, feedback-unconverted-copy.md
  // is the binding ruling): the anchor is the first ply that ENTERED a
  // repeating cycle with a stored, non-repeating alternative that kept her
  // winning -- see unconverted.ts's findRepetitionAnchor for the full
  // mechanism and why the old "first stored mate reading" rule was wrong
  // (it landed on the owner's forbidden ply 47 under a perturbation
  // squarely inside the evaluator's own documented noise band).
  const unconverted = detectUnconverted(moves, finalResult);
  if (unconverted) {
    let anchorPly: number | null = null;
    let mateAtAnchor: number | null = null;
    // Fix wave (2026-07-29, review-3.md HIGH finding 1): tracked separately
    // from anchorPly itself -- anchorPly gets overwritten by the run-start
    // fallback below when nothing was proven, and once that happens there
    // is no way left to tell "this ply IS the proven escape" from "this
    // ply is just where the fallback landed." anchorProven is that
    // distinction, captured at the moment (if ever) it becomes true.
    let anchorProven = false;

    if (unconverted.endKind === "repetition") {
      const repAnchor = findRepetitionAnchor(moves);
      if (repAnchor) {
        anchorPly = repAnchor.ply;
        mateAtAnchor = repAnchor.mateIn ?? null;
        anchorProven = true;
      }
    }
    // Non-repetition endings (stalemate, fifty moves, called early), or a
    // repetition with no PROVABLE escape at any of her entry points: never
    // invent an avoidable-blunder anchor (precision over recall) -- fall
    // back to the run's own start, parity-fixed to HER ply (F3: odd plies
    // are hers, and this label is never valid on mallow's move, blame or
    // no blame).
    if (anchorPly == null) {
      anchorPly = unconverted.ply % 2 === 1 ? unconverted.ply : unconverted.ply + 1;
    }

    // F2/F3 fix: a single fixed fallback (the old code's "last evaluated
    // ply") could equal the colliding ply itself, silently dropping the
    // point while detectUnconverted still says one is owed -- an
    // unpassable gate. Scan forward through HER (odd) plies inside the
    // held winning run (never outside it, or the card would be misplaced)
    // for the first one not already claimed by another point. mateIn only
    // ever attaches to the verified repetition-anchor ply itself, never to
    // a collision-displaced fallback -- a displaced ply carries no proven
    // alternative and must not borrow one.
    const candidatePlies: number[] = [];
    if (anchorPly % 2 === 1) candidatePlies.push(anchorPly);
    for (let p = unconverted.ply % 2 === 1 ? unconverted.ply : unconverted.ply + 1; p <= unconverted.endPly; p += 2) {
      if (!candidatePlies.includes(p)) candidatePlies.push(p);
    }

    // P2 fix (review-2-pass2.md MEDIUM): the scan above used to be free to
    // land on ANY her-ply in the run, including a repetition-cycle entry
    // findRepetitionAnchor already examined and REJECTED (no escape on
    // record) -- reaching the owner's explicitly forbidden ply 47 through a
    // side door that carries no mateIn and so never trips the anchor-value
    // gate on its own. A repetition-cycle entry ply is either the verified
    // anchor itself (anchorPly, already the first item pushed above) or was
    // specifically vetted and rejected; every other entry is barred from
    // ever being selected as a "fallback" landing spot.
    const rejectedEntries =
      unconverted.endKind === "repetition"
        ? new Set(repetitionEntryPlies(moves).filter((p) => p !== anchorPly))
        : new Set<number>();
    const resolvedPly = candidatePlies.find(
      (p) => moves.some((m) => m.ply === p) && !points.some((pt) => pt.ply === p) && !rejectedEntries.has(p)
    );

    if (resolvedPly != null) {
      const anchorSan = moves.find((m) => m.ply === resolvedPly)?.san ?? unconverted.san;
      points.push({
        rank: points.length + 1,
        ply: resolvedPly,
        san: anchorSan,
        label: "unconverted win",
        deltaP: 0, // never fabricated to be sortable -- force-slotted downstream
        lowConfidence: false,
        kind: "unconverted",
        endKind: unconverted.endKind,
        // Only the verified repetition-anchor ply carries mateIn -- a
        // collision-displaced fallback ply has no proven alternative on
        // record and must never borrow this one's.
        mateIn: resolvedPly === anchorPly ? mateAtAnchor ?? undefined : undefined,
        // Fix wave (review-3.md finding 1): "repetition-entry" only when
        // this exact ply IS the proven escape AND nothing displaced it --
        // the same condition mateIn already gates on above, spelled out as
        // its own fact so copy can ask "is this ply a real turning moment"
        // without inferring it from mateIn's mere presence (a proven
        // escape backed by a plain cp read, not a mate read, would leave
        // mateIn unset while the ply is still genuinely proven).
        anchorKind: resolvedPly === anchorPly && anchorProven ? "repetition-entry" : "run-start",
      });
    }
  }

  // Game-160 RCA round, Task K1: one "conversion" point per game, naming
  // the shortest mate she ever held during a held-mate run (`mateIn`,
  // conversion.ts's ConversionEpisode.bestMissed) and the run's span (`ply`
  // = start, `plyEnd` = end, reusing the episode kind's existing field).
  // Gated on the run actually containing real slip evidence (a mate-slip
  // or missed-mate event somewhere in it) -- a clean, unslipped mate march
  // is not a conversion lesson and would just be corpus noise.
  //
  // Union review DELTA fix (2026-07-31): pushed LAST, after every other
  // point kind (including unconverted, immediately above), on purpose --
  // its own collision guard (below) must see every other real fact already
  // placed this game, not just the missed-win point. Moving conversion
  // ahead of unconverted (as it originally shipped) let it steal the one
  // remaining free ply unconverted's own collision-displacement scan needed
  // in a narrow but real edge case (a short held-mate run with few candidate
  // her-plies), silently dropping the unconverted point entirely even
  // though detectUnconverted still says one is owed -- the exact
  // "unpassable gate" failure mode that scan's own F2/F3 fix exists to
  // prevent. Conversion has no fallback scan of its own (a single anchor
  // ply, not a range) so it is the one that must yield when a real
  // conflict exists, never the reverse.
  if (conversionEpisode) {
    const hasSlipEvidence = conversionEpisode.events.some(
      (e) => e.kind === "mate-slip" || e.kind === "missed-mate"
    );
    // H1+H2 fix (union review, 2026-07-31): anchored on bestMissedPly (the
    // ply she actually HELD the shortest mate at), never fromPly (the run's
    // start, which is whichever side's ply happened to carry the first mate
    // reading -- mallow's in 7 of her 12 real conversion games). Same
    // parity-fix SHAPE as `unconverted`'s own anchorPly above (`ply % 2 ===
    // 1 ? ply : ply + 1`) rather than a second, drifting mechanism --
    // applied here to bestMissedPly instead of fromPly, since bestMissedPly
    // is also where H1's welding bug (the sentence naming one move but
    // describing a mate distance actually held at a different one) gets
    // fixed. bestMissedPly is already guaranteed hers by construction
    // (conversion.ts's own loop only ever considers `row.side === "her"`
    // rows -- the explicit-field convention this module was built around),
    // so this ternary's +1 branch is defense-in-depth, never expected to
    // fire; conversion.test.ts's own parity fixture proves the field, not
    // just asserts the type.
    if (hasSlipEvidence && conversionEpisode.bestMissed != null && conversionEpisode.bestMissedPly != null) {
      const anchorPly =
        conversionEpisode.bestMissedPly % 2 === 1
          ? conversionEpisode.bestMissedPly
          : conversionEpisode.bestMissedPly + 1;
      // Collision guard (union review DELTA, 2026-07-31): bestMissedPly and
      // the missed-win point's own anchor are both "the shallowest mate in
      // the run" hunts, so they land on the SAME ply whenever the shortest
      // held mate is also the first missed mate -- measured on 5 of her 11
      // real conversion games (85, 86, 132, 149, 159). Pushing unconditionally
      // put two turning points on one ply: DebriefPage renders two cards for
      // one move, and buildCouldBeBetter's `used.add(missedWin.ply)` then
      // silently SUPPRESSES the conversion bullet -- the exact sentence H1
      // exists to fix disappears on those 5 games instead of reading true.
      // Same "one story, one bullet" reasoning the hasUnconverted suppression
      // above already uses: when the missed-win (or, now, unconverted) point
      // already owns this ply, its bullet already tells the real story, so
      // the conversion point is redundant here, not merely inconvenient.
      // Displacing to a neighbouring ply instead was considered and rejected
      // -- that reintroduces H1 (a sentence whose ply and whose mate
      // distance come from different moves).
      const collides = points.some((p) => p.ply === anchorPly);
      if (!collides) {
        points.push({
          rank: points.length + 1,
          ply: anchorPly,
          plyEnd: conversionEpisode.toPly,
          san: evalRows.find((r) => r.ply === anchorPly)?.san ?? "",
          label: "conversion",
          deltaP: 0,
          lowConfidence: false,
          kind: "conversion",
          mateIn: conversionEpisode.bestMissed,
        });
      }
    }
  }

  return points;
}
