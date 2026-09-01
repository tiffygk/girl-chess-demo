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

import { Chess, type Square } from "chess.js";
import type { SummaryMove, TurningLine, MoveClassification, TurningPoint } from "../game/api";
import { fenAtPly } from "./Rewind";
import { describeSanMove, pieceName } from "../game/describeSanMove";
import { followedBest } from "./followedBest";
// C1 fix (union review, 2026-07-31): reuse the shared spelled-number
// helper rather than a second number-to-word table. Imports from
// ./numberWords, not ./debriefBullets -- this file had no dependency on
// debriefBullets.ts before this fix, and numberWords.ts is the shared,
// dependency-free module that exists so it doesn't need to gain one.
import { numberWord } from "./numberWords";
// N1 (owner report 2026-08-21): the shared "what actually happened" module.
import { mateOutcomeFor, type MateOutcomeFacts } from "./mateOutcome";

export type Verdict = "done well" | "could be better";
// "missed-win" added 2026-07-28 after the visual gate caught a missed mate in
// one rendering as "not-an-error" and printing "this cost you nothing".
// It is deliberately NOT one of the owner's original four tiers (didn't pick
// the best move / inaccuracy / mistake / blunder) because it is not a deltaP
// grade at all: mate-in-1 -> mate-in-3 is deltaP ~ 0, so the classification
// ladder can never see it, however the thresholds are tuned. It comes from
// the missed-win turning point instead.
export type Severity = "not-an-error" | "missed-win" | "inaccuracy" | "mistake" | "blunder";

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
  // Optional so existing callers compile. Only kind === "missed-win" points
  // are read, and only to raise severity -- this module never re-derives a
  // grade of its own from them.
  turningPoints?: TurningPoint[];
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
const SEVERITY_LINE: Record<Severity, (best: string, mateIn?: number, outcome?: MateOutcomeFacts) => string> = {
  "not-an-error": (best) => `you just didn't pick the best move here. ${best} was the stronger move, and this cost you nothing.`,
  // Never "cost you nothing" -- a forced mate walked past is the most
  // expensive thing on this list, even when the eval barely moves because the
  // position was already won. Deliberately does not scold: the debrief's own
  // missed-win bullet carries the count and how much longer the win took.
  //
  // C1 fix (union review, 2026-07-31): mateIn can be 2-5 now (K1 widened
  // this point's source to conversion.ts's depth-5 detector) -- "was mate
  // on the spot" is only true for mate-in-one; a deeper miss means the best
  // move STARTS a forced mate, it doesn't deliver it. mateIn defaults to 1
  // only for a caller that omits it (never true in practice -- see
  // severityFor's matching turning point, which always carries mateIn
  // whenever severity is "missed-win").
  "missed-win": (best, mateIn, outcome) => {
    const n = mateIn ?? 1;
    const distance = numberWord(n);
    const startsMate = n === 1 ? `${best} was mate on the spot` : `${best} started a forced mate in ${distance}`;
    // N1 (2026-08-21): "the game went on without it" is a claim about what
    // followed, so it must be checked against what followed. On faster/matched
    // it is simply false.
    if (outcome && (outcome.outcome === "faster" || outcome.outcome === "matched")) {
      return `${startsMate} here, whatever mallow played. what you did still ended in mate in ${numberWord(outcome.actual)}.`;
    }
    return `you had checkmate in ${distance} here. ${startsMate}, and the game went on without it.`;
  },
  inaccuracy: (best) => `this was an inaccuracy. ${best} would have held more of your edge.`,
  mistake: (best) => `this was a mistake. ${best} was the move the position needed.`,
  blunder: (best) => `this was a blunder. ${best} would have kept the game where it was.`,
};

function severityFor(
  ply: number,
  classifications: MoveClassification[],
  turningPoints: TurningPoint[]
): Severity {
  // Checked FIRST and ply-scoped: a forced mate she walked past outranks any
  // deltaP grade, and is invisible to the classification ladder besides (see
  // the Severity type's comment). Nothing else about the point is trusted --
  // only that one exists at this exact ply.
  if (turningPoints.some((t) => t.kind === "missed-win" && t.ply === ply)) return "missed-win";
  const classification = classifications.find((c) => c.ply === ply)?.classification;
  if (classification === "inaccuracy" || classification === "mistake" || classification === "blunder") {
    return classification;
  }
  return "not-an-error";
}

// C1 fix (union review, 2026-07-31): the missed-win turning point's own
// mateIn at this exact ply, so SEVERITY_LINE's "missed-win" branch can name
// the real distance instead of assuming one.
function missedWinMateInAt(ply: number, turningPoints: TurningPoint[]): number | undefined {
  return turningPoints.find((t) => t.kind === "missed-win" && t.ply === ply)?.mateIn ?? undefined;
}

// D4 (done-well composer): the owner's complaint was that every highlighted
// move judged fine renders the same constant DONE_WELL_NOTE sentence. This
// composes a note from board facts already on hand -- capture target,
// whether a recapture exists, what the move attacks, and whether it matched
// the engine's own pick -- rather than a model pass (see the vault's
// "D4 Done-Well Text, Options + Examples" doc, option 1). Deterministic, no
// LLM, same trust class as the rest of this file.
//
// Severity stays owned by moves.classification (owner ruling 2026-07-28):
// this only ever runs for the "done well" branch, and never re-derives a
// grade -- it just describes a move already judged fine.

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity };

function uciFromMove(mv: { from: string; to: string; promotion?: string }): string {
  return `${mv.from}${mv.to}${mv.promotion ?? ""}`;
}

// Given a uci string, finds the matching legal move in `fenBefore` and
// returns its SAN -- the reverse of uciFromMove, needed because SummaryMove
// only ever stores bestUci (Task 1's raw field), never a SAN for the
// engine's pick. Returns undefined (never throws) when fenBefore doesn't
// parse or the uci isn't a legal move there -- same honesty-gate discipline
// as describeSanMove.
function sanForUci(fenBefore: string, uci: string): string | undefined {
  let probe: Chess;
  try {
    probe = new Chess(fenBefore);
  } catch {
    return undefined;
  }
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4) : undefined;
  const moves = probe.moves({ verbose: true }) as { from: string; to: string; promotion?: string; san: string }[];
  return moves.find((m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion))?.san;
}

// Enemy pieces (relative to `moverColor`) attacked by whatever now sits on
// `fromSquare`, in the position `chess` currently holds (called right after
// the move that landed a piece there). Pure board geometry via chess.js's
// attackers() -- not filtered by legality of a hypothetical recapture, same
// as the recapture check below; a fixture-verified approximation the brief
// accepts (see task-2-brief.md's own "chess.js via a local new Chess(fen)"
// framing).
function attackedEnemyTargets(
  chess: Chess,
  fromSquare: Square,
  moverColor: "w" | "b"
): { square: Square; piece: string; value: number }[] {
  const opponentColor = moverColor === "w" ? "b" : "w";
  const targets: { square: Square; piece: string; value: number }[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== opponentColor) continue;
      if (chess.attackers(cell.square, moverColor).includes(fromSquare)) {
        targets.push({ square: cell.square, piece: cell.type, value: PIECE_VALUE[cell.type] ?? 0 });
      }
    }
  }
  return targets;
}

function heaviestTarget(targets: { square: Square; piece: string; value: number }[]) {
  return targets.slice().sort((a, b) => b.value - a.value)[0];
}

function bandSentenceFor(evalCpHerPerspective: number): string {
  if (evalCpHerPerspective >= 500) return "you stayed completely winning.";
  if (evalCpHerPerspective >= 150) return "you kept a clear edge.";
  if (evalCpHerPerspective >= -149) return "the game stayed level.";
  return "you held your ground in a hard spot.";
}

/**
 * Composes a done-well note from board facts for `ply`/`played`, falling
 * back to the constant DONE_WELL_NOTE when there's nothing to say. Exported
 * for tests only -- buildHighlightedRows is the one production call site.
 *
 * THE OFFSET (bit this project before): `gameSans` rows carry Task 1's RAW
 * per-row engine facts -- row P's own bestUci describes the REPLY side's
 * best after ply P, so the MOVER's best at ply P lives on row P-1's
 * bestUci (see server/game/manager.ts's attachEval doc comment). This reads
 * `gameSans` at `ply - 1` for the pick slot, never `played`'s own bestUci.
 */
export function composeDoneWellNote(ply: number, played: SummaryMove, gameSans: SummaryMove[]): string {
  const fenBefore = fenBeforePly(gameSans, ply);
  if (!fenBefore) return DONE_WELL_NOTE;

  let chess: Chess;
  let mv: ReturnType<Chess["move"]>;
  try {
    chess = new Chess(fenBefore);
    mv = chess.move(played.san);
  } catch {
    return DONE_WELL_NOTE;
  }
  if (!mv) return DONE_WELL_NOTE;

  const playedUci = uciFromMove(mv);
  const movePhrase = describedOrRaw(played.san, fenBefore);
  const moverColor = mv.color;

  // pick slot -- THE OFFSET: row ply-1, never `played`'s own bestUci.
  const moverBestUci = gameSans.find((m) => m.ply === ply - 1)?.bestUci ?? undefined;
  let pickClause: string | undefined;
  let isDeviation = false;
  if (moverBestUci) {
    if (moverBestUci === playedUci) {
      pickClause = `${movePhrase} was our chess brain's own pick.`;
    } else {
      const bestSan = sanForUci(fenBefore, moverBestUci);
      const bestPhrase = bestSan ? describedOrRaw(bestSan, fenBefore) : undefined;
      if (bestPhrase) {
        pickClause = `our chess brain's pick was ${bestPhrase}, and your ${movePhrase} gave up nothing:`;
        isDeviation = true;
      }
    }
  }

  // tactics slot
  const isCapture = (mv.flags.includes("c") || mv.flags.includes("e")) && !!mv.captured;
  let tacticsClause: string | undefined;
  if (isCapture) {
    const capturedWord = pieceName(mv.captured!);
    const opponentColor = moverColor === "w" ? "b" : "w";
    const recaptureAvailable = chess.isAttacked(mv.to, opponentColor);
    if (!recaptureAvailable) {
      let clause = `it wins the ${capturedWord} clean: nothing could take back on ${mv.to}`;
      const heavier = heaviestTarget(
        attackedEnemyTargets(chess, mv.to, moverColor).filter((t) => t.value > PIECE_VALUE[mv.piece])
      );
      clause += heavier
        ? `, and from ${mv.to} your ${pieceName(mv.piece)} hit her ${pieceName(heavier.piece)} on ${heavier.square}.`
        : ".";
      tacticsClause = clause;
    } else {
      tacticsClause = `she could take back on ${mv.to}, and the trade was fine for you.`;
    }
  } else {
    const target = heaviestTarget(
      attackedEnemyTargets(chess, mv.to, moverColor).filter((t) => t.value >= PIECE_VALUE[mv.piece])
    );
    if (target) {
      tacticsClause = `it attacks her ${pieceName(target.piece)} on ${target.square}, forcing her to answer you.`;
    }
  }

  // band slot -- this row's OWN evalCp (Task 1's raw field), negated for
  // odd (her) plies to her perspective.
  let bandSentence: string | undefined;
  if (played.evalCp != null) {
    const herPerspective = ply % 2 === 1 ? -played.evalCp : played.evalCp;
    bandSentence = bandSentenceFor(herPerspective);
  }

  const clauses: string[] = [];
  if (isDeviation && pickClause) {
    clauses.push(pickClause);
    if (bandSentence) clauses.push(bandSentence); // mandatory for this branch
  } else {
    if (pickClause) clauses.push(pickClause);
    if (tacticsClause) {
      clauses.push(tacticsClause);
    } else if (bandSentence) {
      // Only when no tactics clause fired -- a clean grab doesn't also get
      // a tacked-on band sentence.
      clauses.push(bandSentence);
    }
  }

  return clauses.length > 0 ? clauses.join(" ") : DONE_WELL_NOTE;
}

export function buildHighlightedRows(input: BuildHighlightedRowsInput): HighlightedRow[] {
  const { highlightedPlies, gameSans, turningLines, classifications = [], turningPoints = [] } = input;
  const rows: HighlightedRow[] = [];

  for (const ply of highlightedPlies) {
    const played = gameSans.find((m) => m.ply === ply);
    if (!played) continue; // defensive: a highlighted ply must name a real move

    const line = turningLines.find((l) => l.ply === ply);
    const fb = followedBest(line, gameSans);
    // fb is only undefined when there's no line, no bestSan on it, or the
    // ply falls outside the game -- none of those PROVE a better move
    // existed, so the honest default is "done well" (see file header).
    const severity = severityFor(ply, classifications, turningPoints);
    const missedWinMateIn = severity === "missed-win" ? missedWinMateInAt(ply, turningPoints) : undefined;
    // N1 (owner report 2026-08-21): "the game went on without it" is only
    // ever true when the real move list bears it out -- see mateOutcome.ts.
    const mwTp = turningPoints.find((t) => t.kind === "missed-win" && t.ply === ply);
    const lastPly = gameSans.length > 0 ? gameSans[gameSans.length - 1].ply : 0;
    const rawOutcome = mwTp?.mateIn != null ? mateOutcomeFor(ply, mwTp.mateIn, lastPly, gameSans) : undefined;
    // HIGH-2 (N1 fix wave), same gate as debriefBullets.ts/turningPointNote.ts/
    // DebriefPage.tsx: mateOutcomeFor only ever measures the anchor ply.
    // missedCount > 1 means a second, unmeasured occurrence exists by
    // construction (real games 175/178) -- crediting on the anchor alone
    // would hide it, so this surface withholds the credit branch too.
    const mateOutcomeHasUnmeasuredRepeat = (mwTp?.missedCount ?? 1) > 1;
    const outcome = mateOutcomeHasUnmeasuredRepeat ? undefined : rawOutcome;
    // A missed forced mate is never "done well", whatever followedBest can or
    // cannot prove. Without this, a missed-win ply that happens to carry no
    // TurningLine would fall through to DONE_WELL_NOTE and congratulate her
    // for walking past mate -- the exact failure mode this round exists to
    // end, one layer down from where it was found.
    const verdict: Verdict =
      severity === "missed-win" || (fb && !fb.followed) ? "could be better" : "done well";

    let note: string;
    if (verdict === "could be better" && fb?.bestSan) {
      const best = describedOrRaw(fb.bestSan, seedFenForLine(line, gameSans));
      note = SEVERITY_LINE[severity](best, missedWinMateIn, outcome);
    } else if (severity === "missed-win") {
      // Missed win with no line on record: still say what happened, just
      // without naming a move we cannot prove.
      note = "you had checkmate here and the game went on without it.";
    } else {
      // D4: was the constant DONE_WELL_NOTE for every done-well move --
      // now composed from board facts when there are any to state.
      note = composeDoneWellNote(ply, played, gameSans);
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
