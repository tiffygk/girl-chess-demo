// Highlight-a-move (Task 5): the row model behind the study ledger's verdict
// chips. Pure, deterministic, no LLM -- same discipline as
// turningPointNote.ts and debriefBullets.ts: never claim more than the
// facts already on hand (TurningLine/MoveClassification) establish.
//
// The verdict chip is the point of the section: it answers "was my
// instinct right?" with zero presses. `done well` means the engine agrees
// (no better line on record); `could be better` means one exists. When a
// highlighted ply has no TurningLine at all (it was never a turning point,
// so no line was ever computed for it), there is nothing on record proving
// a better move existed -- the honest default is `done well`, the same
// "never fabricate, degrade to a true statement" rule opportunityForLine
// and buildWhatMayHaveHappened already follow.
//
// Severity is a SEPARATE fact from the verdict, owner ruling 2026-07-28:
// it comes only from moves.classification (MoveClassification), never
// re-derived from deltaP -- classifications.ts alone owns those thresholds.

import type { SummaryMove, TurningLine, MoveClassification } from "../game/api";
import { fenAtPly } from "./Rewind";
import { describeSanMove } from "../game/describeSanMove";
import { followedBest } from "./followedBest";

export type Verdict = "done well" | "could be better";
export type Severity = "not-an-error" | "inaccuracy" | "mistake" | "blunder";

export interface HighlightedRow {
  ply: number;
  moveNumber: number;
  phrase: string;
  verdict: Verdict;
  severity: Severity;
  note: string;
  canTryLine: boolean;
}

export interface BuildHighlightedRowsInput {
  highlightedPlies: number[];
  gameSans: SummaryMove[];
  turningLines: TurningLine[];
  classifications?: MoveClassification[];
}

function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

// Fen BEFORE the move played at 1-indexed `ply` -- same replay-from-scratch
// convention as turningPointNote.ts's own (unexported) fenBeforePly.
function fenBeforePly(gameSans: SummaryMove[], ply: number): string | undefined {
  if (ply < 1) return undefined;
  return fenAtPly(gameSans, ply - 1);
}

// The seed fen a TurningLine's pvSans/bestSan were replayed from server-side
// -- same seedPly = ply - (ply % 2) formula turningPointNote.ts,
// server/game/manager.ts, and src/game/explore.ts's exploreSeedPly all
// already share. Copied rather than imported: turningPointNote.ts doesn't
// export its private copy (same "copy the few lines, don't reach across
// modules" convention that file's own header documents).
function seedFenForLine(line: TurningLine | undefined, gameSans: SummaryMove[]): string | undefined {
  if (!line) return undefined;
  const seedPly = line.ply - (line.ply % 2);
  if (seedPly < 1) return undefined;
  return fenAtPly(gameSans, seedPly);
}

function describedOrRaw(san: string, fen: string | undefined): string {
  if (!fen) return san;
  return describeSanMove(san, fen) ?? san;
}

const DONE_WELL_NOTE = "nothing here was a mistake. trust the instinct that made you pause.";

// One line per severity tier, owner ruling 2026-07-28 -- the not-an-error
// wording must not imply fault (measured: ~97% of her real moves carry no
// classification at all).
const SEVERITY_LINE: Record<Severity, (best: string) => string> = {
  "not-an-error": (best) => `you just didn't pick the best move here. ${best} was the stronger move, and this cost you nothing.`,
  inaccuracy: (best) => `this was an inaccuracy. ${best} would have held more of your edge.`,
  mistake: (best) => `this was a mistake. ${best} was the move the position needed.`,
  blunder: (best) => `this was a blunder. ${best} would have kept the game where it was.`,
};

function severityFor(ply: number, classifications: MoveClassification[]): Severity {
  const classification = classifications.find((c) => c.ply === ply)?.classification;
  if (classification === "inaccuracy" || classification === "mistake" || classification === "blunder") {
    return classification;
  }
  return "not-an-error";
}

export function buildHighlightedRows(input: BuildHighlightedRowsInput): HighlightedRow[] {
  const { highlightedPlies, gameSans, turningLines, classifications = [] } = input;
  const rows: HighlightedRow[] = [];

  for (const ply of highlightedPlies) {
    const played = gameSans.find((m) => m.ply === ply);
    if (!played) continue; // defensive: a highlighted ply must name a real move

    const line = turningLines.find((l) => l.ply === ply);
    const fb = followedBest(line, gameSans);
    // fb is only undefined when there's no line, no bestSan on it, or the
    // ply falls outside the game -- none of those PROVE a better move
    // existed, so the honest default is "done well" (see file header).
    const verdict: Verdict = fb && !fb.followed ? "could be better" : "done well";
    const severity = severityFor(ply, classifications);

    let note: string;
    if (verdict === "could be better" && fb?.bestSan) {
      const best = describedOrRaw(fb.bestSan, seedFenForLine(line, gameSans));
      note = SEVERITY_LINE[severity](best);
    } else {
      note = DONE_WELL_NOTE;
    }

    rows.push({
      ply,
      moveNumber: moveNumberForPly(ply),
      phrase: describedOrRaw(played.san, fenBeforePly(gameSans, ply)),
      verdict,
      severity,
      note,
      // Offering "try the line" with nothing to try would be a lie -- only
      // ever true alongside a genuine "could be better" verdict, which
      // itself only fires when fb.bestSan is on record.
      canTryLine: verdict === "could be better",
    });
  }

  return rows;
}
