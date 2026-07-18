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

export interface TurningPoint {
  rank: 1 | 2 | 3;
  ply: number;
  san: string;
  label: string; // exact lowercase vocabulary from the ruling
  punishSan?: string; // the "you punished with {san}" suffix source, when the guard passes
  deltaP: number; // signed, white perspective
  lowConfidence: boolean; // null-gap > TP_DEDUP_PLIES plies behind this point
  kind: "swing" | "backfill";
}

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
  // each other, keeping the larger |Δp| in each cluster.
  candidates.sort((a, b) => a.ply - b.ply);
  const clusters: Selected[][] = [];
  for (const c of candidates) {
    const last = clusters[clusters.length - 1];
    if (last && c.ply - last[last.length - 1].ply <= TP_DEDUP_PLIES) last.push(c);
    else clusters.push([c]);
  }
  const deduped = clusters.map((cluster) =>
    cluster.reduce((best, cur) => (Math.abs(cur.deltaP) > Math.abs(best.deltaP) ? cur : best))
  );

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

  return selected.map((s, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    ply: s.ply,
    san: s.san,
    label: s.label,
    punishSan: s.punishSan,
    deltaP: s.deltaP,
    lowConfidence: s.lowConfidence,
    kind: s.kind,
  }));
}
