// Game-160 RCA round, Task K1 (2026-07-31): the conversion layer.
//
// Context correction (context-v2-changes-and-contract.md section 0.6): v1's
// claim of "a missed mate-in-2 at ply 185" was WRONG -- the raw evals show
// ply 185 was ON SCHEDULE (before=M2, Qa4+ left M1, Rb4# landed). What the
// data actually shows is repeated MATE-DISTANCE SLIPS she was never told
// about (worst: ply 125, mate-in-10 became mate-in-16) plus two free-piece
// giveaways inside the same mate run. The old missedWins.ts detector
// (MISSED_MATE_DEPTH 1) is structurally blind to all of this: it only ever
// asks "did she skip an immediate mate-in-1," never "did the mate she was
// already delivering get slower." This module answers the second question.
//
// HARD CONSTRAINT (same gate as classify.ts/turningPoints.ts/motifs.ts):
// engine math over ALREADY-PERSISTED evals only. No evaluator call, no
// LLM, ever.
//
// Ply parity (CLAUDE.md, "encode in types, not helpers," sixth-instance
// rule): `side` is a REQUIRED field on every row, derived once at load
// (ply % 2 === 1 ? "her" : "mallow"). Every check below reads `row.side`
// directly and never re-derives parity from `row.ply % 2` -- a caller that
// hands this module a row whose `side` disagrees with its own ply (a
// malformed load) gets `side`'s answer, not ply's, on purpose: the whole
// point of carrying the field on the data is that nothing downstream has
// its own opinion about parity.
//
// Sign convention (mirrors missedWins.ts/turningPoints.ts's buildDeltaSeries
// header): stored evals are SIDE-TO-MOVE signed for the position AFTER the
// ply. For her ply p, the position she FACED is row p-1's fenAfter --
// she's the side to move there, so row p-1's evalMate, read as-is (no
// negation), is HOW MANY MOVES SHE HAD. row p's evalMate is the position
// after her own move -- mallow is to move there, so a NEGATIVE reading
// there means mallow (the side to move) is the one getting mated, i.e. the
// mate is still hers.

import { Chess } from "chess.js";

export type MoveEvalRow = {
  ply: number; // 1-based; odd = hers, even = mallow's
  side: "her" | "mallow"; // REQUIRED, derived at load: ply % 2 === 1 ? "her" : "mallow"
  san: string;
  evalCp: number | null; // eval AFTER this ply, side-to-move perspective
  evalMate: number | null; // ditto; sign: + = side-to-move mates
};

export type ConversionEventKind = "missed-mate" | "mate-slip" | "lost-mate" | "free-material";

export type ConversionEvent = {
  ply: number; // her ply
  kind: ConversionEventKind;
  mateBefore: number | null; // +N she had mate-in-N before her move
  mateAfter: number | null; // mate still hers after (null = lost it)
  slip: number; // mateAfter - (mateBefore - 1); 0 for free-material
  piece?: "p" | "n" | "b" | "r" | "q"; // free-material only
};

export type ConversionEpisode = {
  fromPly: number;
  toPly: number;
  events: ConversionEvent[];
  bestMissed: number | null; // shortest mate she ever held in the run
};

// Owner ruling 2 (context-v2-changes-and-contract.md section 2): widened
// from missedWins.ts's original MISSED_MATE_DEPTH (1) -- that depth-1
// detector was rock-solid but structurally silent on exactly the failure
// this game surfaced (zero missed mate-in-1s existed in game 160; the real
// damage was all mate-DISTANCE slips at deeper depths). This constant
// governs ONLY the "missed-mate" kind below (a shallow mate she had and
// gave ground on); missedWins.ts keeps its own, narrower, byte-stable
// depth-1 constant for its own shipped behavior -- see that file's header
// for why the two are deliberately not the same export.
export const MISSED_MATE_DEPTH = 5;
// Owner ruling 2: minimum |slip| (moves added to the mate distance) to
// count as a "mate-slip" event at all, independent of how deep the mate
// was to start with (a mate-in-12 that becomes mate-in-19 is just as real
// a slip as a mate-in-3 that becomes mate-in-6, even though only the
// second also qualifies as "missed-mate" under the depth gate above).
export const MATE_SLIP_MIN = 2;

function byPlyMap(rows: MoveEvalRow[]): Map<number, MoveEvalRow> {
  return new Map(rows.map((r) => [r.ply, r]));
}

// The maximal run of consecutive plies (no gaps) with evalMate != null.
// "Consecutive" is checked on PLY NUMBER, not array position -- a caller
// that hands in a sparse or unsorted row list still gets a genuine
// contiguous-ply run, never an array-index illusion of one.
function computeEpisode(rows: MoveEvalRow[]): { fromPly: number; toPly: number; rows: MoveEvalRow[] } | null {
  const sorted = [...rows].sort((a, b) => a.ply - b.ply);
  let bestStart = -1;
  let bestLen = 0;
  let curLen = 0;
  for (let i = 0; i < sorted.length; i++) {
    const has = sorted[i].evalMate != null;
    const contiguous = curLen > 0 && sorted[i].ply === sorted[i - 1].ply + 1;
    if (has && (curLen === 0 || contiguous)) {
      curLen++;
    } else if (has) {
      curLen = 1;
    } else {
      curLen = 0;
    }
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = i - curLen + 1;
    }
  }
  if (bestLen === 0) return null;
  const runRows = sorted.slice(bestStart, bestStart + bestLen);
  return { fromPly: runRows[0].ply, toPly: runRows[runRows.length - 1].ply, rows: runRows };
}

// Her mate-distance events: for every her-ply inside (or bordering) a held
// mate, decide whether she kept the mate on schedule, let it slip, walked
// past a shallow one, or lost it outright. Never looks at `ply % 2` --
// only `row.side`.
function detectMateEvents(rows: MoveEvalRow[]): ConversionEvent[] {
  const byPly = byPlyMap(rows);
  const events: ConversionEvent[] = [];
  for (const row of [...rows].sort((a, b) => a.ply - b.ply)) {
    if (row.side !== "her") continue;
    if (row.san.includes("#")) continue; // she delivered the mate: nothing to miss
    const pre = byPly.get(row.ply - 1);
    if (!pre || pre.evalMate == null || pre.evalMate <= 0) continue; // no mate held before her move
    const before = pre.evalMate;
    const after = row.evalMate;

    if (after == null) {
      // The mate reading vanished and a plain cp reading (or nothing) took
      // its place, with the game continuing -- she let the forced mate go
      // entirely, not just slower.
      events.push({ ply: row.ply, kind: "lost-mate", mateBefore: before, mateAfter: null, slip: 0 });
      continue;
    }

    const afterAbs = Math.abs(after);
    const slip = afterAbs - (before - 1);

    if (slip >= MATE_SLIP_MIN) {
      events.push({ ply: row.ply, kind: "mate-slip", mateBefore: before, mateAfter: afterAbs, slip });
    }
    if (before <= MISSED_MATE_DEPTH && slip >= 1) {
      events.push({ ply: row.ply, kind: "missed-mate", mateBefore: before, mateAfter: afterAbs, slip });
    }
  }
  return events;
}

// Free material inside the mate run: her ply p leaves a piece on the board
// that mallow's ply p+1 captures, and her ply p+2 does not recapture on
// that exact square. Only ever evaluated when gameSans is supplied (a pure
// chess.js replay, no eval, no engine) and only for her-plies inside the
// episode's own [fromPly, toPly] window -- free material outside a mate
// run is a different (not-yet-built) detector's job, never this one's.
function detectFreeMaterial(
  gameSans: string[],
  episode: { fromPly: number; toPly: number }
): ConversionEvent[] {
  const chess = new Chess();
  const history: { ply: number; to: string; captured?: string; color: "w" | "b" }[] = [];
  for (let i = 0; i < gameSans.length; i++) {
    const ply = i + 1;
    let mv;
    try {
      mv = chess.move(gameSans[i]);
    } catch {
      break; // unreplayable from here on: stop, never guess
    }
    if (!mv) break;
    history.push({ ply, to: mv.to, captured: mv.captured, color: mv.color });
  }
  const byPly = new Map(history.map((h) => [h.ply, h]));
  const events: ConversionEvent[] = [];
  for (const h of history) {
    if (h.color !== "b" || !h.captured) continue; // mallow's own capture only
    const herPriorPly = h.ply - 1;
    if (herPriorPly < episode.fromPly || herPriorPly > episode.toPly) continue;
    const herNext = byPly.get(h.ply + 1);
    const recaptured = herNext && herNext.to === h.to;
    if (!recaptured) {
      events.push({
        ply: herPriorPly,
        kind: "free-material",
        mateBefore: null,
        mateAfter: null,
        slip: 0,
        piece: h.captured as ConversionEvent["piece"],
      });
    }
  }
  return events;
}

export function detectConversion(
  rows: MoveEvalRow[],
  gameSans?: string[]
): { events: ConversionEvent[]; episode: ConversionEpisode | null } {
  const mateEvents = detectMateEvents(rows);
  const episodeRun = computeEpisode(rows);

  let episode: ConversionEpisode | null = null;
  const freeMaterialEvents: ConversionEvent[] = [];

  if (episodeRun) {
    const byPly = byPlyMap(rows);
    let bestMissed: number | null = null;
    for (const row of episodeRun.rows) {
      if (row.side !== "her") continue;
      if (row.san.includes("#")) continue;
      const pre = byPly.get(row.ply - 1);
      if (pre && pre.evalMate != null && pre.evalMate > 0) {
        if (bestMissed == null || pre.evalMate < bestMissed) bestMissed = pre.evalMate;
      }
    }

    if (gameSans && gameSans.length > 0) {
      freeMaterialEvents.push(
        ...detectFreeMaterial(gameSans, { fromPly: episodeRun.fromPly, toPly: episodeRun.toPly })
      );
    }

    const episodeEvents = [...mateEvents, ...freeMaterialEvents]
      .filter((e) => e.ply >= episodeRun.fromPly && e.ply <= episodeRun.toPly)
      .sort((a, b) => a.ply - b.ply);

    episode = {
      fromPly: episodeRun.fromPly,
      toPly: episodeRun.toPly,
      events: episodeEvents,
      bestMissed,
    };
  }

  const events = [...mateEvents, ...freeMaterialEvents].sort((a, b) => a.ply - b.ply);
  return { events, episode };
}
