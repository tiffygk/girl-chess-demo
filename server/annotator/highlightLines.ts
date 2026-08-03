// Opponent-move-analysis plan (2026-08-03), Wave A -- the engine-grounding
// facts contract (plan section 3). Pure over already-persisted rows, no
// engine call, ever (same HARD CONSTRAINT classify.ts/turningPoints.ts/
// conversion.ts already carry: engine math over already-persisted evals
// only).
//
// This is the seam getTurningLines (manager.ts) deliberately cannot serve:
// getTurningLines seeds every line at `t.ply - (t.ply % 2)`, which for an
// EVEN (mallow) ply is the ply itself -- her best reply AFTER mallow moved,
// never mallow's own alternatives. This module seeds at `p - 1` for EVERY
// highlighted ply, both sides, universally: the position at fenAfter(p-1)
// is exactly the position the mover of ply p chose in, so row (p-1)'s
// best_move/pv is the engine's best FOR THAT MOVER. Do not copy the
// getTurningLines seedPly formula here -- see highlightLines.test.ts's
// seed-falsification test, which exists specifically to catch that mistake.
//
// Ply parity (CLAUDE.md, "encode in types, not helpers" rule -- bitten five
// times by a shared helper re-deriving parity instead of reading a stored
// field): `side` is a REQUIRED field on every HighlightMoveRow, derived
// ONCE by the caller (manager.ts's getHighlightLines, at the getGameMoves
// read site -- the same place getSummary/conversion.ts already do this).
// Nothing in this file ever computes `ply % 2` to decide a seat; the one
// exception is `decided`'s white-perspective conversion below, which reads
// `current.side` rather than re-deriving it from `current.ply`.
import { Chess } from "chess.js";
import { toMoverCp, DECIDED_BAND_CP } from "./classify";

// One row per HIGHLIGHTED ply, either side. All replay-derived, never
// text-parsed. Mirrored (hand-mirroring, same convention as TurningLine's
// own server/client split) by src/game/api.ts's client-side HighlightLine.
export interface HighlightLine {
  ply: number;
  side: "her" | "mallow"; // from the moves row's parity ONCE at the data load
  san: string;
  bestSan?: string; // engine best FOR THE MOVER, from row p-1's best_move
  bestFromTo?: { from: string; to: string };
  pvSans: string[]; // engine's line from the position before p (row p-1's pv)
  matchedBest: boolean | null; // uci(p) === best_move(p-1); null when no read
  quality: "best" | "solid" | "fine" | "slip" | "unknown"; // server-computed, one place
  gapCp: number | null; // mover-perspective, toMoverCp(p-1) - (-toMoverCp(p))
  mateInvolved: boolean; // eval_mate non-null on either side of the pair
  decided: boolean; // |white-perspective eval before p| >= DECIDED_BAND_CP (300)
}

// The caller's (manager.ts) already-loaded move row, camelCased and with
// `side` attached at load time. Deliberately NOT the raw better-sqlite3 row
// shape (snake_case eval_cp/eval_mate/best_move) -- manager.ts does that
// one small remap at the read site, mirroring getSummary's own `moves`
// remap immediately above it in the same file.
export interface HighlightMoveRow {
  ply: number;
  san: string;
  uci: string | null;
  evalCp: number | null;
  evalMate: number | null;
  bestMove: string | null;
  pv: string | null;
  highlighted: boolean;
  side: "her" | "mallow";
}

// Injected rather than imported: manager.ts's `pvLine` is a private class
// method (it needs no engine call either -- pure chess.js replay of an
// already-persisted pv/bestMove string -- but lives on GameManager because
// getTurningLines already does, and there's no reason to duplicate it).
// This lets highlightLines.test.ts exercise the seed-selection logic with a
// plain spy, no live GameManager/Stockfish process required.
export type PvLineFn = (
  fenSeed: string,
  ev: { bestMove: string | null; pv: string | null } | undefined
) => { pvSans: string[]; bestSan?: string; bestFromTo?: { from: string; to: string } };

// Thresholds deliberately mirror server/coach/chat.ts's gapWord bands (35 /
// 150cp, the ones this module actually branches on -- gapWord itself has a
// third 300cp step this module's own 4-tier vocabulary (best/solid/fine/
// slip) has no matching slot for, since OD-A's chip vocabulary collapses
// "clearly better" and "decisively better" into one "mallow slipped" chip).
// If gapWord's bands ever change, change both, or extract a shared constant
// then -- this comment is the cross-reference the plan asked for.
const SOLID_MAX_GAP_CP = 35;
const SLIP_MIN_GAP_CP = 150;

// Semantics locked in the plan (section 3) so no implementer re-derives
// them: best = matchedBest; solid = gap < 35; fine = gap < 150; slip = gap
// >= 150 OR a mate reading appeared/vanished across the pair with a
// deviation; unknown = either eval null (including the p === 1 case, which
// arrives here with `seed` undefined).
function computeHighlightFacts(
  current: HighlightMoveRow,
  seed: HighlightMoveRow | undefined
): Pick<HighlightLine, "matchedBest" | "quality" | "gapCp" | "mateInvolved" | "decided"> {
  const hasCurrentEval = current.evalCp !== null || current.evalMate !== null;
  const hasSeedEval = seed !== undefined && (seed.evalCp !== null || seed.evalMate !== null);
  // Raw fact, independent of whether either side is otherwise "unknown" --
  // asks only "did a mate reading appear anywhere in this pair," never
  // gated on matchedBest/quality.
  const mateInvolved = (seed?.evalMate ?? null) !== null || current.evalMate !== null;

  if (!seed || !hasSeedEval || !hasCurrentEval) {
    // No read at either end of the pair (or p === 1, which never has a
    // seed row at all) -- honest "no read", never a guess.
    return { matchedBest: null, quality: "unknown", gapCp: null, mateInvolved, decided: false };
  }

  const matchedBest =
    seed.bestMove !== null && current.uci !== null ? seed.bestMove === current.uci : null;

  // Same convention chat.ts's gapWordForPly documents and reuses: prior
  // (seed, p-1) is already mover-of-p perspective; current (p) is
  // opponent-perspective (whoever replies next), so it's negated back to
  // the mover's own perspective before the two are compared.
  const seedMoverCp = toMoverCp({ cp: seed.evalCp, mate: seed.evalMate });
  const currentMoverCp = toMoverCp({ cp: current.evalCp, mate: current.evalMate });
  const gapCp = seedMoverCp - -currentMoverCp;

  // "A mate reading appeared/vanished across the pair" -- present on
  // exactly one side of the pair, not on both (both-present is just a
  // normal mate-distance change, already reflected honestly in gapCp via
  // toMoverCp's own mate-folding).
  const mateSwung = (seed.evalMate !== null) !== (current.evalMate !== null);

  let quality: HighlightLine["quality"];
  if (matchedBest === true) {
    quality = "best";
  } else {
    const gap = Math.abs(gapCp);
    if (mateSwung || gap >= SLIP_MIN_GAP_CP) quality = "slip";
    else if (gap < SOLID_MAX_GAP_CP) quality = "solid";
    else quality = "fine";
  }

  // `decided` reads the SEED (before-p) position in WHITE perspective,
  // magnitude only -- "the game was already decided here, so the numbers
  // barely move either way" is honest whoever is ahead, unlike classify.ts's
  // own directional `decided` (which only fires for the mover's own lead,
  // because its one consumer's copy is hardcoded to a lead). seedMoverCp is
  // already mover-of-p perspective; current.side tells us whether that IS
  // the white reading (her/white moves at p) or its negation (mallow/black
  // moves at p) -- read from the stored field, never re-derived from
  // current.ply % 2.
  const whiteCp = current.side === "her" ? seedMoverCp : -seedMoverCp;
  const decided = Math.abs(whiteCp) >= DECIDED_BAND_CP;

  return { matchedBest, quality, gapCp, mateInvolved, decided };
}

// The endpoint's one assembly function: every HIGHLIGHTED row (either
// side), each seeded at p-1 universally. `rows` is the WHOLE game's moves
// (already side-tagged, camelCased, by the caller), so pv replay can walk
// from ply 1 regardless of which ply is highlighted.
export function buildHighlightLines(rows: HighlightMoveRow[], pvLine: PvLineFn): HighlightLine[] {
  const sans = rows.map((r) => r.san);
  const byPly = new Map(rows.map((r) => [r.ply, r]));

  return rows
    .filter((r) => r.highlighted)
    .map((r) => {
      const p = r.ply;
      const seedPly = p - 1;
      const seedRow = byPly.get(seedPly);

      let pvSans: string[] = [];
      let bestSan: string | undefined;
      let bestFromTo: { from: string; to: string } | undefined;
      if (seedPly >= 1) {
        // Replay-from-scratch pattern (same as getTurningLines/Rewind.tsx's
        // fenAtPly): the position attachEval(seedPly) actually evaluated is
        // fenAfter(seedPly), reached by replaying every SAN strictly
        // before it.
        const seed = new Chess();
        for (let i = 0; i < seedPly && i < sans.length; i++) seed.move(sans[i]);
        const fenSeed = seed.fen();
        ({ pvSans, bestSan, bestFromTo } = pvLine(
          fenSeed,
          seedRow ? { bestMove: seedRow.bestMove, pv: seedRow.pv } : undefined
        ));
      }

      const facts = computeHighlightFacts(r, seedRow);

      const line: HighlightLine = {
        ply: p,
        side: r.side,
        san: r.san,
        pvSans,
        matchedBest: facts.matchedBest,
        quality: facts.quality,
        gapCp: facts.gapCp,
        mateInvolved: facts.mateInvolved,
        decided: facts.decided,
      };
      if (bestSan) line.bestSan = bestSan;
      if (bestFromTo) line.bestFromTo = bestFromTo;
      return line;
    });
}
