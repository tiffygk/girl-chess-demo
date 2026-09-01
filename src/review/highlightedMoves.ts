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
import { describeSanMove, pieceName, stripRedundantCheckSuffix } from "../game/describeSanMove";
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

// Fix round 1 (2026-08-31 review): owner-calibratable, the "genuinely
// comparable" precedent -- same magic number and reasoning as hint.ts's
// HINT_TRADE_MARGIN_CP. Two her-perspective evals across a move that differ
// by this little or less are treated as no real difference; anything wider
// must never be described as "gave up nothing".
const DONE_WELL_NO_GAP_CP = 35;

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }; // F3: no "k" -- the king is never a describable target, see attackedEnemyTargets

const ARTICLE_FOR_CLASSIFICATION: Record<"inaccuracy" | "mistake" | "blunder", string> = {
  inaccuracy: "an",
  mistake: "a",
  blunder: "a",
};

function uciFromMove(mv: { from: string; to: string; promotion?: string }): string {
  return `${mv.from}${mv.to}${mv.promotion ?? ""}`;
}

// F3: a described move embedded MID-CLAUSE (followed by more prose, e.g.
// "{move} was our chess brain's own pick.") must not carry a trailing
// ", check"/", checkmate" -- that suffix only reads right when the phrase is
// the last word on the row (buildHighlightedRows' own `phrase` field, which
// this does NOT touch). Reuses describeSanMove.ts's existing stripper: its
// gate only cares that the label passed is one of the two check tokens, not
// that it matches the actual suffix, so passing "check" strips either.
function embeddedPhrase(san: string, fen: string | undefined): string {
  return stripRedundantCheckSuffix(describedOrRaw(san, fen), "check");
}

// Her-perspective eval at a summary row, evalCp only (F1's gap machinery is
// explicitly evalCp-to-evalCp -- a row carrying only evalMate makes the gap
// INCOMPUTABLE, never a stand-in value). Same negate-odd-plies rule as the
// band slot.
function herPerspectiveCp(row: SummaryMove | undefined): number | undefined {
  if (!row || row.evalCp == null) return undefined;
  return row.ply % 2 === 1 ? -row.evalCp : row.evalCp;
}

// F1/F4: the her-perspective eval swing across playing `ply` (row ply-1's
// evalCp, before, vs `played`'s own evalCp, after). undefined when either
// side is missing -- "incomputable", never treated as zero.
function herPerspectiveGap(ply: number, played: SummaryMove, gameSans: SummaryMove[]): number | undefined {
  const before = herPerspectiveCp(gameSans.find((m) => m.ply === ply - 1));
  const after = herPerspectiveCp(played);
  if (before == null || after == null) return undefined;
  return after - before;
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

// Fix round 1 (F4): whether the piece the mover just moved to `fromSquare`
// could legally capture on `toSquare` if it were the mover's turn again --
// accounts for pins the geometric attackers()/isAttacked() calls are blind
// to (a pinned piece geometrically "attacks" a square it cannot legally
// move to: game 190 ply 35, the g7 pawn geometrically attacks h6 but is
// pinned to its own king by the queen on g3 down the g-file). chess.js has
// no side-to-move-agnostic "would this be legal" query, so this hacks the
// fen's side-to-move field back to the mover's color and clears the
// en-passant square (never relevant to a piece that already moved this
// ply) before asking for legal moves.
function canLegallyReach(fenAfter: string, moverColor: "w" | "b", from: Square, to: Square): boolean {
  const parts = fenAfter.split(" ");
  if (parts.length < 4) return false;
  parts[1] = moverColor;
  parts[3] = "-";
  let probe: Chess;
  try {
    probe = new Chess(parts.join(" "));
  } catch {
    return false;
  }
  return probe.moves({ verbose: true }).some((m) => m.from === from && m.to === to);
}

// Enemy pieces (relative to `moverColor`) the piece on `fromSquare` could
// LEGALLY capture, in the position `chess` currently holds (called right
// after the move that landed a piece there). F3: the king is categorically
// excluded -- a checking move must never render as "hit her king on e8"
// (real case: game 169 ply 19, a knight capture that also attacks the
// black queen would otherwise lose to the king on heaviestTarget's sort,
// since Infinity beat every real piece value). F4: geometry alone isn't
// enough (see canLegallyReach's comment) -- each candidate is confirmed
// reachable via a real legal move, not just chess.js's attackers().
function attackedEnemyTargets(
  chess: Chess,
  fromSquare: Square,
  moverColor: "w" | "b"
): { square: Square; piece: string; value: number }[] {
  const opponentColor = moverColor === "w" ? "b" : "w";
  const fenAfter = chess.fen();
  const targets: { square: Square; piece: string; value: number }[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== opponentColor || cell.type === "k") continue;
      if (canLegallyReach(fenAfter, moverColor, fromSquare, cell.square)) {
        targets.push({ square: cell.square, piece: cell.type, value: PIECE_VALUE[cell.type] ?? 0 });
      }
    }
  }
  return targets;
}

function heaviestTarget(targets: { square: Square; piece: string; value: number }[]) {
  return targets.slice().sort((a, b) => b.value - a.value)[0];
}

// Fix round 2 (hardening, re-review observation 3): PIECE_VALUE has no "k"
// entry (F3 -- the king is never a describable TARGET), but `mv.piece` here
// is the MOVER's own piece, and the king CAN be a mover (a plain king step,
// or a king capture). `t.value > PIECE_VALUE["k"]` degrades to `t.value >
// undefined`, which is `NaN`, always false -- correct today only by
// accident of that comparison rule, and it silently inverts if anyone ever
// adds a `?? 0` fallback to PIECE_VALUE's lookups. Made explicit: Infinity
// as an unrecognized piece's own value makes both `t.value > X` and
// `t.value >= X` false for every real target, i.e. "never heavier, never
// equal-or-higher" -- a king mover never earns either tactics sub-clause.
function moverValueOrNeverHeavier(piece: string): number {
  return PIECE_VALUE[piece] ?? Infinity;
}

function bandSentenceFor(evalCpHerPerspective: number): string {
  if (evalCpHerPerspective >= 500) return "you stayed completely winning.";
  if (evalCpHerPerspective >= 150) return "you kept a clear edge.";
  if (evalCpHerPerspective >= -149) return "the game stayed level.";
  return "you held your ground in a hard spot.";
}

// F2: 23% of rows carry a forced-mate score with evalCp NULL -- band must
// not simply go dark (and the deviation clause below must never emit a
// bare trailing colon because of it). Falls back to evalMate, same
// negate-odd-plies conversion; a forced mate is always decisively one way
// or the other, so there's no need for the 4-tier cp scale, just the two
// extremes.
function bandSentenceForRow(row: SummaryMove | undefined): string | undefined {
  if (!row) return undefined;
  if (row.evalCp != null) {
    return bandSentenceFor(row.ply % 2 === 1 ? -row.evalCp : row.evalCp);
  }
  if (row.evalMate != null) {
    // Fix round 2 (F2 hardening): Stockfish emits `score mate 0` at an
    // already-mated position. On her (odd) rows that means MALLOW is the
    // side to move and mated -- she just delivered mate, unambiguously a
    // win, never a "hard spot". `-0 === 0`, so the naive `herPerspective >
    // 0` gate below silently fails this exact case and rendered a losing
    // sentence on a checkmating move (real row game 24 ply 41, Qf7#: evalCp
    // null, evalMate 0). Earns its own terminal copy instead of a band --
    // the claim is fully grounded, mate 0 means the game is over right now.
    if (row.evalMate === 0 && row.ply % 2 === 1) {
      return "checkmate: it won the game on the spot.";
    }
    const herPerspective = row.ply % 2 === 1 ? -row.evalMate : row.evalMate;
    return herPerspective > 0 ? "you stayed completely winning." : "you held your ground in a hard spot.";
  }
  return undefined;
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
 *
 * Fix round 1 (2026-08-31 review): `classifications` defaults to `[]` so
 * every pre-existing call site keeps compiling -- buildHighlightedRows
 * always passes the real array it already holds.
 */
export function composeDoneWellNote(
  ply: number,
  played: SummaryMove,
  gameSans: SummaryMove[],
  classifications: MoveClassification[] = []
): string {
  // F5(a): production only ever calls this for a "done well" verdict on
  // HER move, but the function itself must not lie if ever called on a
  // mallow row -- side is data (Task 1/W5), never re-derived from parity
  // here.
  if (played.side === "mallow") return DONE_WELL_NOTE;

  // F1(a) -- CRITICAL: a row can reach this function with a real
  // classification (inaccuracy/mistake/blunder) whenever it was never a
  // TurningLine point at all (so buildHighlightedRows' "could be better"
  // gate, which only fires off followedBest, never saw it) -- real rows
  // game 190 ply 33 (Qg3, inaccuracy) and ply 37 (Qe3, mistake) rendered
  // "...gave up nothing" under the old code despite being graded errors.
  // Severity still stays owned by moves.classification (owner ruling
  // 2026-07-28): this never re-derives a grade, it just says the honest
  // thing about a move that already has one, instead of any done-well
  // prose at all. Checked before any chess.js replay -- doesn't need it.
  const classification = classifications.find((c) => c.ply === ply)?.classification;
  if (classification === "inaccuracy" || classification === "mistake" || classification === "blunder") {
    const article = ARTICLE_FOR_CLASSIFICATION[classification];
    const clauses = [`our chess brain graded this ${article} ${classification}.`];
    const band = bandSentenceForRow(played);
    if (band) clauses.push(band);
    return clauses.join(" ");
  }

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
  const movePhrase = embeddedPhrase(played.san, fenBefore); // F3: strip ", check"/", checkmate" -- embedded mid-clause
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
      const bestPhrase = bestSan ? embeddedPhrase(bestSan, fenBefore) : undefined; // F3
      if (bestPhrase) {
        // F1(b): "gave up nothing" is a claim about the GAP between the two
        // moves' her-perspective evals, not a freebie for any differing
        // pick. Computed here, evalCp-only (F1's own wording) -- a row
        // carrying only evalMate makes the gap incomputable, not zero.
        const gap = herPerspectiveGap(ply, played, gameSans);
        const gapIsSmall = gap != null && Math.abs(gap) <= DONE_WELL_NO_GAP_CP;
        if (gapIsSmall) {
          // F2: this exact phrasing must NEVER emit without a trailing band
          // -- that's what left three live rows ending in a bare "...gave
          // up nothing:". No band computable at all -> skip the deviation
          // clause entirely and let tactics/fallback take over below,
          // rather than assert an unwarranted claim with nothing after it.
          const band = bandSentenceForRow(played);
          if (band) {
            pickClause =
              `our chess brain's pick was ${bestPhrase}, and your ${movePhrase} gave up nothing: ` +
              `the gap between them is no real gap. ${band}`;
            isDeviation = true;
          }
        } else {
          // Gap is large, or incomputable -- never claim "gave up nothing".
          // Band is optional here (no colon in this phrasing to leave bare).
          const band = bandSentenceForRow(played);
          pickClause = band
            ? `our chess brain's pick was ${bestPhrase}. ${band}`
            : `our chess brain's pick was ${bestPhrase}.`;
          isDeviation = true;
        }
      }
    }
  }

  // Deviation branch is a complete, self-contained clause (pick + optional
  // gap warrant + band) -- it never combines with the tactics slot, same as
  // the original design.
  if (isDeviation) {
    return pickClause ?? DONE_WELL_NOTE;
  }

  // tactics slot
  const isCapture = (mv.flags.includes("c") || mv.flags.includes("e")) && !!mv.captured;
  let tacticsClause: string | undefined;
  if (isCapture) {
    const capturedWord = pieceName(mv.captured!);
    // F4: legality, not geometry -- `chess` already has the opponent to
    // move (the move that just landed on mv.to flipped the turn), so its
    // own moves() IS the legal-recapture check; no fen hack needed here.
    const recaptureAvailable = chess.moves({ verbose: true }).some((m) => m.to === mv.to && m.captured);
    if (!recaptureAvailable) {
      let clause = `it wins the ${capturedWord} clean: nothing could take back on ${mv.to}`;
      const heavier = heaviestTarget(
        attackedEnemyTargets(chess, mv.to, moverColor).filter((t) => t.value > moverValueOrNeverHeavier(mv.piece))
      );
      clause += heavier
        ? `, and from ${mv.to} your ${pieceName(mv.piece)} hit her ${pieceName(heavier.piece)} on ${heavier.square}.`
        : ".";
      tacticsClause = clause;
    } else {
      // F4: "the trade was fine for you" asserted an evaluation nothing
      // computed. Reuses the same gap machinery as the pick slot -- only
      // claim it cost her nothing when the numbers back that up; otherwise
      // say nothing rather than guess.
      const gap = herPerspectiveGap(ply, played, gameSans);
      if (gap != null && gap >= -DONE_WELL_NO_GAP_CP) {
        tacticsClause = `she could take back on ${mv.to}, and it cost you nothing.`;
      }
    }
  } else {
    const target = heaviestTarget(
      attackedEnemyTargets(chess, mv.to, moverColor).filter((t) => t.value >= moverValueOrNeverHeavier(mv.piece))
    );
    if (target) {
      tacticsClause = `it attacks her ${pieceName(target.piece)} on ${target.square}, forcing her to answer you.`;
    }
  }

  // band slot -- this row's OWN evalCp/evalMate (F2 fallback), negated for
  // odd (her) plies to her perspective.
  const bandSentence = bandSentenceForRow(played);

  const clauses: string[] = [];
  if (pickClause) clauses.push(pickClause);
  if (tacticsClause) {
    clauses.push(tacticsClause);
  } else if (bandSentence) {
    // Only when no tactics clause fired -- a clean grab doesn't also get
    // a tacked-on band sentence.
    clauses.push(bandSentence);
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
      // classifications passed through so F1's severity gate can catch a
      // classified row that never earned a TurningLine (see that fix's
      // comment inside composeDoneWellNote).
      note = composeDoneWellNote(ply, played, gameSans, classifications);
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
