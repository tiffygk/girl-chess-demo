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

export interface TurningPoint {
  rank: 1 | 2 | 3 | 4;
  ply: number;
  san: string;
  label: string; // exact lowercase vocabulary from the ruling
  punishSan?: string; // the "you punished with {san}" suffix source, when the guard passes
  deltaP: number; // signed, white perspective
  lowConfidence: boolean; // null-gap > TP_DEDUP_PLIES plies behind this point
  kind: "swing" | "backfill" | "episode";
  // debrief-v2, dedup fix: set on HER kept swing when the preceding kept
  // point in the same dedup cluster is an opponent-error label and her
  // swing is negative — the "missed punish" shape (she had a winning
  // capture/tactic and played something else instead). Purely positional
  // (derived from cluster order + label), never a new claim.
  missedPunish?: boolean;
  // debrief-v2, king-pressure episode: only set when kind === "episode" —
  // the last ply of the qualifying run (game end counts).
  plyEnd?: number;
}

// debrief-v2: bumped when the turning-point algorithm changes shape in a way
// that changes stored output (dedup fix + episode detector). manager.ts's
// summary read path compares this against a persisted row's algo_version
// (NULL treated as 1) to decide whether to heal an old game's stored rows —
// see server/store/db.ts's turning_points.algo_version column and
// manager.ts's getSummary.
// v3 = widened episode geometry (Chebyshev dist 2 + open-file shelter)
export const TP_ALGO_VERSION = 3;

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

// Shared label-band boundaries (her moves AND opponent moves use the same
// numeric tiers per the ruling's vocabulary line) — exported so
// classifications.ts imports the same numbers rather than re-declaring them.
export const TP_BAND_MISTAKE = 0.15;
export const TP_BAND_BLUNDER = 0.25;

export interface MoveEval {
  ply: number;
  san: string;
  evalCp: number | null;
  evalMate: number | null;
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
      for (const d of series) {
        if (!d) continue;
        const mv = moves[d.idx];
        if (mv.evalMate == null) continue;
        if (sheWon && d.p > 0.5) {
          backfill = { ...d, label: "the clincher", kind: "backfill" };
          break;
        }
        if (sheLost && d.p < 0.5) {
          backfill = { ...d, label: "the losing move", kind: "backfill" };
          break;
        }
      }
    }

    if (backfill && !selected.some((s) => s.ply === backfill!.ply)) {
      selected.push(backfill);
    }
  }

  for (const point of selected) attachPunishSuffix(point, moves, series);

  const points: TurningPoint[] = selected.map((s, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    ply: s.ply,
    san: s.san,
    label: s.label,
    punishSan: s.punishSan,
    deltaP: s.deltaP,
    lowConfidence: s.lowConfidence,
    kind: s.kind,
    missedPunish: s.missedPunish,
  }));

  // debrief-v2: the king-pressure episode is a STATE the per-ply swing
  // detector above structurally cannot see (eval stays flat while danger
  // sits on the board) — additional to, never instead of, the swing/backfill
  // points above. Max 4 cards total.
  const episode = detectKingPressureEpisode(moves, series);
  if (episode) {
    points.push({
      rank: (points.length + 1) as 1 | 2 | 3 | 4,
      ply: episode.plyStart,
      plyEnd: episode.plyEnd,
      san: episode.san,
      label: "king pressure",
      deltaP: episode.deltaP,
      lowConfidence: false,
      kind: "episode",
    });
  }

  return points;
}
