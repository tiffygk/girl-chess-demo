// Opponent-move-analysis plan (2026-08-03), Wave B: the row model behind
// the MAGENTA drawer -- the mallow moves she highlighted, graded from the
// HighlightLine facts the Wave-A endpoint already computed. Pure,
// deterministic, no LLM, no engine call (the debrief path's standing
// invariant); same template-over-facts discipline as highlightedMoves.ts.
// Proposal of record: vault "3 visual/opponent-drawer-proposal.html".
//
// Grading lives SERVER-SIDE, in one place (server/annotator/
// highlightLines.ts computes `quality` from the stored eval pair) -- this
// module never re-derives a tier from gapCp, it only maps the five tiers to
// the four owner-approved chips (OD-A) and the approved note copy:
//   `the computer's pick` <- best (mallow's uci matched the stored best_move)
//   `solid`               <- solid OR fine (deviated, gap < 150cp -- the chip
//                            does not split hairs the copy can carry)
//   `mallow slipped`      <- slip (gap >= 150cp, or a mate swing + deviation)
//   `no read`             <- unknown (eval missing, or ply 1). Says so honestly.
//
// The side filter reads each line's own `side` FIELD (data, set once
// server-side at the data load) -- NEVER ply % 2 in a view. That parity
// shortcut has produced five real bugs in this repo; the falsification test
// in mallowHighlightedMoves.test.ts goes red against any parity-derived
// re-implementation.
//
// Register (Maia framing, plan §2): mallow plays like a person, so a
// deviation is normal, never shamed -- "even mallow slips", never
// "objectively losing". The decided-position qualifier appends to the
// NUMBERS-BASED tiers (solid/fine/slip) when `decided` is true, because the
// winprob-blind band must never let a slip in a decided position read as
// consequence-free -- and a decided slip DROPS the "gave you a real chance"
// clause, which stops being true once the game was decided (the approved
// proposal's own slip+decided card). `best` (a uci-identity fact, no
// numbers claimed) and `unknown` (no read at all) never carry it.

import { Chess } from "chess.js";
import type { HighlightLine, SummaryMove } from "../game/api";
import { fenAtPly } from "./Rewind";
import { describeSanMove } from "../game/describeSanMove";

export type MallowChip = "the computer's pick" | "solid" | "mallow slipped" | "no read";

export interface MallowHighlightedRow {
  ply: number;
  moveNumber: number;
  /** Plain-English phrase for the move mallow played (describeSanMove seam). */
  phrase: string;
  /** Raw SAN for the open card's token beside the phrase. */
  san: string;
  chip: MallowChip;
  note: string;
}

const CHIP_FOR_QUALITY: Record<HighlightLine["quality"], MallowChip> = {
  best: "the computer's pick",
  solid: "solid",
  fine: "solid",
  slip: "mallow slipped",
  unknown: "no read",
};

const DECIDED_QUALIFIER = "the game was already decided here, so the numbers barely move either way.";

function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

function describedOrRaw(san: string, fen: string | undefined): string {
  if (!fen) return san;
  return describeSanMove(san, fen) ?? san;
}

// How many pv moves the "plan behind it" phrase names. Three is the
// approved proposal's own depth -- enough to show a plan, short enough to
// stay one sentence.
const PLAN_PV_MOVES = 3;

// "knight to c6, bishop to c4, then knight to f6" -- each pv move rendered
// plainly by replaying from the seed fen (the position BEFORE mallow's ply,
// exactly what row p-1's pv was computed from; pv[0] is mallow's own move).
// A move that fails to describe (or replay) truncates the phrase rather
// than guessing; an empty result means no plan is claimed at all.
function planPhrase(pvSans: string[], seedFen: string | undefined): string | undefined {
  if (!seedFen || pvSans.length === 0) return undefined;
  const described: string[] = [];
  let fen = seedFen;
  for (const san of pvSans.slice(0, PLAN_PV_MOVES)) {
    const phrase = describeSanMove(san, fen);
    if (!phrase) break;
    described.push(phrase);
    // Advance the position for the next pv move's own description.
    const next = advanceFen(fen, san);
    if (!next) break;
    fen = next;
  }
  if (described.length === 0) return undefined;
  if (described.length === 1) return described[0];
  return `${described.slice(0, -1).join(", ")}, then ${described[described.length - 1]}`;
}

// Local single-move replay -- fenAtPly replays whole games from the start;
// here we just need "this fen, plus this one SAN". Returns undefined when
// the SAN is illegal there (honesty gate, mirrors describeSanMove's null).
function advanceFen(fen: string, san: string): string | undefined {
  try {
    const chess = new Chess(fen);
    chess.move(san);
    return chess.fen();
  } catch {
    return undefined;
  }
}

function noteFor(l: HighlightLine, seedFen: string | undefined): string {
  switch (l.quality) {
    case "best": {
      const plan = planPhrase(l.pvSans, seedFen);
      return plan
        ? `this was the computer's top choice here. the plan behind it: ${plan}.`
        : "this was the computer's top choice here.";
    }
    case "solid":
    case "fine": {
      const first = "not the engine's first pick, but it barely matters.";
      const best = l.bestSan ? ` ${describedOrRaw(l.bestSan, seedFen)} was only slightly better.` : "";
      const decided = l.decided ? ` ${DECIDED_QUALIFIER}` : "";
      return `${first}${best}${decided}`;
    }
    case "slip": {
      const best = l.bestSan ? ` ${describedOrRaw(l.bestSan, seedFen)} was clearly stronger` : "";
      if (l.decided) {
        // The "real chance" clause is FALSE in a decided position -- the
        // qualifier replaces it rather than sitting beside it.
        return `even mallow slips.${best ? `${best}.` : ""} ${DECIDED_QUALIFIER}`;
      }
      return best
        ? `even mallow slips.${best}, and this move gave you a real chance.`
        : "even mallow slips. this move gave you a real chance.";
    }
    case "unknown":
      return "no engine read landed for this one, so i won't guess.";
  }
}

export function buildMallowHighlightedRows(
  lines: HighlightLine[],
  gameSans: SummaryMove[]
): MallowHighlightedRow[] {
  return lines
    .filter((l) => l.side === "mallow")
    .map((l) => {
      // The position mallow chose in: before ply p, i.e. after p-1 plies --
      // the same seed row p-1's best_move/pv were computed from (plan §3's
      // seed convention), so played-move phrase, bestSan phrase, and the pv
      // plan all describe from the one true position.
      const seedFen = l.ply >= 1 ? fenAtPly(gameSans, l.ply - 1) : undefined;
      return {
        ply: l.ply,
        moveNumber: moveNumberForPly(l.ply),
        phrase: describedOrRaw(l.san, seedFen),
        san: l.san,
        chip: CHIP_FOR_QUALITY[l.quality],
        note: noteFor(l, seedFen),
      };
    });
}
