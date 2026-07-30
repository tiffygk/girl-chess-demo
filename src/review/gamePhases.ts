// The one game-phase source of truth. Ported from lichess-org/scalachess
// core/src/main/scala/Divider.scala (MIT licensed, copyright Thibault
// Duplessis, 2012-2014) -- thresholds, predicates, and the mixedness score
// table are transcribed from the Scala source, verified against the raw
// file 2026-07-29. See "Girl Chess -- Game Phase Classification Research
// (2026-07-29)" in the vault for the primary-source quote.
//
// The public API is a LATCHING running state machine over the game's plies:
// midgame begins at the first ply whose after-position satisfies
// majorsAndMinors <= 10 OR backrankSparse OR mixedness > 150; endgame
// begins at the first ply where majorsAndMinors <= 6. Once a boundary
// latches it never reverses (Lichess's collectFirst semantics), so
// phaseAt(ply) answers "what phase is THIS ply" with no lookahead.
//
// majorsAndMinors ignores pawns and kings. backrankSparse and mixedness
// COUNT pawns and kings (full occupancy) -- two of the three predicates do
// look at them; "the divider ignores pawns and kings" is a half-truth that
// has already misled one implementation attempt.
//
// One deliberate superset of Lichess: the nearly-bare board fact from
// ./phase.ts (owner's real games 149/150 -- a side reduced to at most one
// non-pawn, non-king piece is an endgame whatever the other side kept)
// stays as a per-ply "endgame" override. Per-ply, not latched: a promotion
// can un-bare a side, same as phase.ts today.
//
// There is deliberately NO fallback that MANUFACTURES a phase from
// something other than a board fact. If majorsAndMinors never reaches 6 the
// game has no endgame -- the reference behavior, and exactly what the old
// "late in the game means endgame" fallback got wrong on the owner's game
// 151 (queens, rooks, and a minor piece still on at the end).
//
// Important 5 / union F1 (2026-07-30 fix wave): an earlier version of this
// file DID have an undisclosed fallback -- phaseAt returned "opening" for
// every ply whenever there was no board to replay (gameSans absent or
// empty), which is indistinguishable, to every caller, from a genuinely
// proven opening. That is a fallback; it just returned the least-alarming
// value instead of the most-alarming one the old ply-arithmetic code did.
// phaseAt now returns null in that case -- "I don't know", not "opening" --
// so a caller with no board must decide explicitly what to do with an
// absent phase rather than silently asserting one. hasBoard below is the
// single source of that truth.
//
// A material-count rule is blind to decided-but-unconverted positions
// (queens on, one side already winning) -- same shape as the "winprob
// delta is blind to decided positions" lesson. The unconverted detector is
// winprob-based and orthogonal; conversion coaching rides on unconverted
// bullets, never on this label.
//
// Pure chess.js replay -- no eval, no engine, no LLM, no db.

import { Chess } from "chess.js";
import type { SummaryMove } from "../game/api";
import { boardNearlyBare } from "./phase";

export type GamePhase = "opening" | "middlegame" | "endgame";
export type MidgameTrigger = "majors" | "backrank" | "mixedness";

const MIDGAME_MAJORS_MINORS_MAX = 10; // Divider.scala: majorsAndMinors(board) <= 10
const ENDGAME_MAJORS_MINORS_MAX = 6; // Divider.scala: majorsAndMinors(board) <= 6
const BACKRANK_SPARSE_BELOW = 4; // Divider.scala: (rank & color).count < 4
const MIXEDNESS_ABOVE = 150; // Divider.scala: mixedness(board) > 150

type Cell = "w" | "b" | null;

// rows[y][x]: y = 0 is rank 1 (white's back rank), x = 0 is the a-file.
// chess.board() returns rank 8 first, so flip.
function grid(chess: Chess): Cell[][] {
  const b = chess.board();
  const rows: Cell[][] = [];
  for (let y = 0; y < 8; y++) {
    rows.push(b[7 - y].map((p) => (p ? p.color : null)));
  }
  return rows;
}

// Queens + rooks + bishops + knights, both colors combined. Pawns and
// kings excluded -- this is the ONE predicate that ignores them.
export function majorsAndMinors(chess: Chess): number {
  return chess
    .board()
    .flat()
    .filter((p) => p != null && p.type !== "k" && p.type !== "p").length;
}

// Fewer than 4 of a color's pieces (ANY type, king and pawns included)
// remain on that color's own back rank.
export function backrankSparse(chess: Chess): boolean {
  const rows = grid(chess);
  const whiteOnFirst = rows[0].filter((c) => c === "w").length;
  const blackOnLast = rows[7].filter((c) => c === "b").length;
  return whiteOnFirst < BACKRANK_SPARSE_BELOW || blackOnLast < BACKRANK_SPARSE_BELOW;
}

// Divider.scala's score(y, white, black), transcribed branch for branch.
// y is the 1-based rank of the 2x2 window's LOWER rank (1..7). white/black
// are full-occupancy counts in the window -- pawns and kings included.
// Hand-tuned magic numbers; do not "clean up" or re-derive.
function mixednessScore(y: number, white: number, black: number): number {
  switch (white) {
    case 0:
      switch (black) {
        case 1:
          return 1 + y;
        case 2:
          return y < 6 ? 2 + (6 - y) : 0;
        case 3:
          return y < 7 ? 3 + (7 - y) : 0;
        case 4:
          return y < 7 ? 3 + (7 - y) : 0;
        default:
          return 0;
      }
    case 1:
      switch (black) {
        case 0:
          return 1 + (8 - y);
        case 1:
          return 5 + Math.abs(4 - y);
        case 2:
          return 4 + (7 - y);
        case 3:
          return 5 + (7 - y);
        default:
          return 0;
      }
    case 2:
      switch (black) {
        case 0:
          return y > 2 ? 2 + (y - 2) : 0;
        case 1:
          return 4 + (y - 1);
        case 2:
          return 7;
        default:
          return 0;
      }
    case 3:
      switch (black) {
        case 0:
          return y > 1 ? 3 + (y - 1) : 0;
        case 1:
          return 5 + (y - 1);
        default:
          return 0;
      }
    case 4:
      switch (black) {
        case 0:
          return y > 1 ? 3 + (y - 1) : 0;
        default:
          return 0;
      }
    default:
      return 0;
  }
}

// A 2x2 window slid over a 7x7 grid of placements (49 overlapping regions,
// matching Divider.scala's `0x0303L << (x + 8 * y)` bitboard shift). Sum
// of per-window scores; > 150 reads as middlegame interpenetration.
export function mixedness(chess: Chess): number {
  const rows = grid(chess);
  let acc = 0;
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      let w = 0;
      let b = 0;
      for (const [cx, cy] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ] as const) {
        const c = rows[cy][cx];
        if (c === "w") w++;
        else if (c === "b") b++;
      }
      acc += mixednessScore(y + 1, w, b);
    }
  }
  return acc;
}

export interface PhaseTimeline {
  totalPlies: number;
  midgameStartPly: number | null; // first ply whose after-position latched midgame
  endgameStartPly: number | null; // first ply where majorsAndMinors <= 6; null = this game HAS no endgame
  midgameTriggers: MidgameTrigger[]; // every predicate true at the latching ply
  // The boundary the two cheap predicates alone would have produced. Task 4
  // measures on the owner's real corpus whether mixedness ever moves the
  // answer -- flagged unverified in the research, so it is measured, not
  // assumed.
  midgameStartPlyWithoutMixedness: number | null;
  nearlyBare: Set<number>; // per-ply override plies, from ./phase.ts's boardNearlyBare
  // Important 5 / union F1: null means "no board fact is available for this
  // ply" (gameSans was absent, empty, or unreplayable before this ply) --
  // never "opening". Every caller must handle null explicitly rather than
  // treating a missing board the same as a proven one.
  phaseAt(ply: number): GamePhase | null;
}

export function phasesForGame(gameSans: SummaryMove[] | undefined): PhaseTimeline {
  const sortedSans = gameSans ? [...gameSans].sort((a, b) => a.ply - b.ply) : [];
  // Important 5 / union F1: the ONE fact that decides whether phaseAt may
  // ever answer with a real label. False when there is nothing to replay at
  // all -- gameSans undefined or empty. (An unreplayable-from-the-start
  // game, i.e. the very first move throws, also leaves this true but every
  // latch stays null, which phaseAt's own logic below already resolves to
  // "opening" -- a real board fact about the position before any move.)
  const hasBoard = sortedSans.length > 0;
  let midgameStartPly: number | null = null;
  let endgameStartPly: number | null = null;
  let midgameStartPlyWithoutMixedness: number | null = null;
  let midgameTriggers: MidgameTrigger[] = [];
  // Minor 10 (2026-07-30 fix wave): nearlyBare used to come from a second,
  // fully independent full-game replay (phase.ts's nearlyBarePlies calling
  // its own fresh Chess() and re-walking every san). Folded into this same
  // loop's own `chess` instance instead -- one replay pass, not two.
  const nearlyBare = new Set<number>();
  const chess = new Chess();
  for (const m of sortedSans) {
    try {
      chess.move(m.san);
    } catch {
      break; // unreplayable input: keep what latched before the bad san, never guess further (same discipline as phase.ts)
    }
    if (boardNearlyBare(chess)) nearlyBare.add(m.ply);
    const majors = majorsAndMinors(chess);
    // Minor 11 (2026-07-30 fix wave): backrankSparse(chess) used to be
    // called twice per ply (once for `cheap`, again inside the trigger
    // list) -- same position, same answer. Computed once and reused.
    const sparse = backrankSparse(chess);
    const cheap = majors <= MIDGAME_MAJORS_MINORS_MAX || sparse;
    if (midgameStartPlyWithoutMixedness === null && cheap) {
      midgameStartPlyWithoutMixedness = m.ply;
    }
    if (midgameStartPly === null) {
      const triggers: MidgameTrigger[] = [];
      if (majors <= MIDGAME_MAJORS_MINORS_MAX) triggers.push("majors");
      if (sparse) triggers.push("backrank");
      if (mixedness(chess) > MIXEDNESS_ABOVE) triggers.push("mixedness");
      if (triggers.length > 0) {
        midgameStartPly = m.ply;
        midgameTriggers = triggers;
      }
    }
    // Divider.scala only reports an endgame when a midgame exists; since
    // majors <= 6 implies majors <= 10, the midgame latch is always already
    // set (possibly this same ply) whenever this fires.
    if (endgameStartPly === null && majors <= ENDGAME_MAJORS_MINORS_MAX) {
      endgameStartPly = m.ply;
    }
  }
  const totalPlies = sortedSans.length > 0 ? sortedSans[sortedSans.length - 1].ply : 0;
  return {
    totalPlies,
    midgameStartPly,
    endgameStartPly,
    midgameTriggers,
    midgameStartPlyWithoutMixedness,
    nearlyBare,
    phaseAt(ply: number): GamePhase | null {
      if (!hasBoard) return null;
      if (nearlyBare.has(ply)) return "endgame";
      if (endgameStartPly !== null && ply >= endgameStartPly) return "endgame";
      if (midgameStartPly !== null && ply >= midgameStartPly) return "middlegame";
      return "opening";
    },
  };
}
