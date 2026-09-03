// COUNT IS MIRRORED IN PROSE. Adding or removing a rule here also means updating:
//   docs/evaluation.md ("Nineteen rules run over...", "that rule and the other eighteen")
//   docs/README.md ("Nineteen rules replay the post-game analysis")
//   tools/replay-check.ts and replay-check.test.ts ("ALL 19 debriefInvariants.ts rules")
// The count drifted from 17 to 19 unnoticed between 2026-08-25 and 2026-09-03 because
// nothing pointed here from there. Verify with: grep -oE 'rule: *"[^"]+"' this file | sort -u | wc -l
// Truth round (2026-07-29), Task 0: the debrief invariant module -- the
// deterministic pre-show check. The owner asked whether the analysis could
// be checked before it's shown to her; the answer is this one module, run
// in two places (never duplicated): Task 1's replay gate runs it over every
// game in her history at dev time, and the post-merge wiring task runs the
// SAME module on her fresh game before DebriefPage renders it, so a failure
// on her screen becomes an automatic bug report instead of something she
// has to notice mid-play.
//
// Hard shape constraint: pure TypeScript, no JSX, no React import, no
// server import -- this ships in the browser bundle. The SAN/square
// regexes below are local mirrors of server/coach/validate.ts's patterns,
// not an import of them (that file is server-only). Precision over recall,
// same as every checker this round: a check that cannot verify (no turning
// lines supplied) skips rather than guesses.
//
// turningPoints is typed as TurningPoint[] (src/game/api.ts) but every kind
// comparison below treats `.kind` as a bare string. This module predates
// Task 2's union additions to that type (unconverted, missed-free-piece,
// missed-tactic, walked-into-fork, missed-defence aren't in api.ts's kind
// union yet), so comparing narrowly-typed literals here would either fail
// to compile or silently never match once the union does expand.

import { Chess } from "chess.js";
import type { TurningPoint, TurningLine, SummaryMove } from "../game/api";
import { affordancesForBullet, type DebriefBullet, type ChessCategory } from "./debriefBullets";
// C1 fix (union review, 2026-07-31): the word list for parsing an asserted
// mate distance out of a bullet's text -- from the shared ./numberWords
// module (the same one debriefBullets.ts's own numberWord now re-exports
// from), not a fourth hand-typed copy.
import { NUMBER_WORDS } from "./numberWords";
import { phasesForGame, type GamePhase } from "./gamePhases";
import { followedBest } from "./followedBest";
// N1 (owner report 2026-08-21): the shared "what actually happened" module.
import { mateOutcomeFor } from "./mateOutcome";

export interface DebriefFacts {
  result: string | null;
  turningPoints: TurningPoint[]; // kind compared as string, so this module predates Task 2's union additions
  gameSans: SummaryMove[];
  turningLines?: TurningLine[]; // absent -> san/square/try-line checks SKIP (never guess)
  totalPlies: number;
}

export interface DebriefOutput {
  bullets: DebriefBullet[];
  // review-0.md important 1: the brief's notes shape (couldImprove/nextTime/
  // didWell/whatMayHaveHappened) was missing `opportunity` -- DebriefPage.tsx
  // renders a fifth field ("this opens up: ...") built by
  // turningPointNote.ts's TurningPointNote. Added here so the module reads
  // the actual shape rendered on her screen, not a guessed one.
  notes?: {
    ply: number;
    couldImprove?: string;
    nextTime?: string;
    didWell?: string;
    whatMayHaveHappened?: string;
    opportunity?: string;
  }[];
  // MEDIUM-7 (N1 fix wave): highlightedMoves.ts's study-ledger row (surface
  // #7) derives its own mate number (SEVERITY_LINE's missed-win branch) and
  // it landed outside every check -- a mutation to that row's credit number
  // left `debrief-output violations: 0` while the byte-identical mutation
  // in a bullet or note was caught. Optional so every existing caller
  // (neither replay-check's prior wiring nor any test) has to change.
  rows?: { ply: number; note: string }[];
}

export interface DebriefViolation {
  kind: "contradiction" | "silence";
  rule: string; // stable id, keyed to the rule inventory below
  where: string; // "bullet:<section>:<index>" | "note:<ply>" | "debrief"
  message: string;
}

export const NEVER_MISS_KINDS = [
  "unconverted",
  "missed-win",
  "missed-free-piece",
  "missed-tactic",
  "walked-into-fork",
  "missed-defence",
];

// The four detector kinds forced together as one family for detector-silent
// -- "one forced bullet covers the family" (unconverted and missed-win each
// get their own dedicated silence rule instead, see below).
const TACTIC_KINDS = ["missed-free-piece", "missed-tactic", "walked-into-fork", "missed-defence"];

// Local mirrors of server/coach/validate.ts's patterns -- this module ships
// in the browser bundle and must not import server code. Debrief copy is
// code-built (not model prose), so uppercase-piece SAN is the only form.
const SAN_RE = /(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)/g;
const SQUARE_RE = /[a-h][1-8]/g;
// review-0.md minor 6: scoped to exactly the two phrases the brief spec's
// reassurance-vs-detector on ("any text contains `no clear mistakes` or `no
// repeat pattern` while a never-miss detector fired"). "brought the game
// home" is win-copy-on-non-win's own trigger (checked directly, not through
// this constant) -- a third alternative here would be dead in this rule and
// would misdescribe what actually fires it.
const REASSURANCE_RE = /no clear mistakes|no repeat pattern/;
// conversion-claim (K1, tightened 2026-07-31 union review fix): the
// phrasings a bullet/note uses to assert a MISSED or SLIPPED mate --
// missedWinText's "checkmate in {word}", conversionCouldBeBetterText's/
// unconvertedCouldBeBetterText's/turningPointNote.ts's "mate in {word}"
// (debriefBullets.ts, turningPointNote.ts). "(?:check)?mate in " catches
// all of those without also matching unrelated prose ("checkmate" alone,
// with no "in", never trips this). CAPTURES the asserted number/word so
// the rule below can compare what was actually SAID against the turning
// point's own mateIn -- the original version of this rule only checked
// that SOME mate data existed at the ply (`mateIn != null`), which is why
// it passed unchanged over 8 real games where the bullet said "checkmate
// in one" and the turning point's mateIn was 2-5 (C1, the flagship bug
// this whole round exists to fix). Reuses debriefBullets.ts's own
// NUMBER_WORDS as the single source of truth for how this codebase spells
// a mate distance, rather than a second, hand-typed word list that could
// drift from it.
//
// The negative lookbehind is load-bearing, added after routing this rule
// through outputTextUnits (ADDENDUM 2) surfaced a real false-positive:
// opportunity.ts's deriveOpportunity emits "leads to mate in {N}" on the
// `note.opportunity` field -- a DIFFERENT, already honesty-gated claim
// (N is counted directly off a replay-proven, checkmate-ending pv, never
// read from any TurningPoint's mateIn, and it can legitimately sit on an
// ordinary swing/backfill point that carries no mateIn at all). Every
// missed/slipped-mate producer this rule actually polices says "you had
// mate in N" / "the shortest mate you held ... mate in N" / "mate in N
// was on record" -- none of them ever say "leads to". Excluding that one
// phrase keeps the rule scoped to what it is actually about (a stored
// mateIn being contradicted) without silently swallowing a correct,
// independently-verified claim about a completely different fact.
const NUMBER_WORD_VALUES: Record<string, number> = Object.fromEntries(
  NUMBER_WORDS.map((word, n) => [word, n])
);
const MATE_CLAIM_NUMBER_RE = new RegExp(
  `(?<!leads to )(?:check)?mate in (${NUMBER_WORDS.join("|")}|\\d+)`,
  "i"
);

// Parses every "(check)mate in N" claim out of a bullet's text (a bullet
// can carry at most one in practice, but this never assumes that -- global
// match, never guesses past what's actually there).
function parseMateClaimNumbers(text: string): number[] {
  const re = new RegExp(MATE_CLAIM_NUMBER_RE.source, "gi");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[1].toLowerCase();
    const n = NUMBER_WORD_VALUES[word] ?? (/^\d+$/.test(word) ? parseInt(word, 10) : undefined);
    if (n != null) out.push(n);
  }
  return out;
}

// N1 (2026-08-21): the last ply in the move list, mateOutcomeFor's own
// totalPlies input. facts.gameSans is typed non-optional on DebriefFacts,
// but every conversion-claim test fixture in this file passes gameSans: []
// (fine -- an empty list means mateOutcomeFor returns undefined and this
// rule degrades to its pre-N1 behaviour, see the comment at its call site).
function lastPlyOf(gameSans: SummaryMove[] | undefined): number {
  return gameSans && gameSans.length > 0 ? gameSans[gameSans.length - 1].ply : 0;
}

// Residual hole found by the reviewer's own falsification pass (2026-07-31,
// third instance of "the check is narrower than the thing it claims to
// cover"): "was mate on the spot" / "ends it on the spot" assert mate-in-1
// SEMANTICALLY, with no digit or number word anywhere in the sentence, so
// parseMateClaimNumbers cannot see them at all. Proven concretely: replacing
// turningPointNote.ts's `mateIn === 1 ? ... ends it on the spot ... :
// starts a forced mate in N` ternary with an unconditional "ends it on the
// spot" made `replay-check` exit 0 with zero violations on real games where
// mateIn was 2-5 -- the exact silent-pass shape C1 shipped through twice.
//
// Enumerated, not pattern-matched, on purpose -- same "precision over
// recall" discipline server/coach/defenseClaims.ts's checkDefenseClaims
// already uses for this codebase's other verify-before-send checks. This
// list is EVERY number-free phrase actually in production that implies
// mate-in-1 (grepped across src/review/*.ts and server/annotator/*.ts,
// 2026-07-31: exactly these two, both containing "on the spot", nothing
// else). It does NOT catch a paraphrase that isn't on this list ("delivers
// the mate right there", "wins on the spot", "mates immediately", etc.) --
// if a producer ever adds a new number-free immediate-mate phrase, it must
// be added here too, in this one place, or this rule goes blind to it the
// same way it went blind to these two. Understating this check's reach is
// deliberate: a comment that overstates what it catches is how this class
// of bug survived twice already.
export const IMPLICIT_MATE_ONE_PHRASES = ["mate on the spot", "ends it on the spot"];

function hasImplicitMateOneClaim(text: string): boolean {
  return IMPLICIT_MATE_ONE_PHRASES.some((p) => text.includes(p));
}

// Integration review fix (2026-07-30, I1 + V1 -- mandatory union review):
// two invariants closing one underlying problem -- a single bullet can name
// one phase in its prose, a different phase in its metadata, and a third in
// its category, because the debrief path has no LLM to hallucinate this:
// it is our own template contradicting our own data. Both rules tolerate
// `phase: null` by design (DebriefBullet.phase's own comment in
// debriefBullets.ts): null means "the board cannot prove a phase," and
// every render site legitimately omits the phase word in that case -- that
// omission must never itself be reported as a mismatch.

// Category names that assert a specific phase by their own wording -- the
// only two ChessCategory values that do (see debriefBullets.ts's
// ChessCategory union). Extend here, never invent a phase-shaped category
// without adding its mapping.
const CATEGORY_IMPLIES_PHASE: Partial<Record<ChessCategory, GamePhase>> = {
  "endgame technique": "endgame",
  "opening play": "opening",
};

// A phase word literally spelled out in a bullet's own prose. The only two
// spots in debriefBullets.ts that ever interpolate one are buildDoneWell's
// unconverted branch ("your {phase} is working") and buildWatchNextTime's
// unconverted branch ("the {phase} is where this one slipped") -- no other
// bullet text spells "opening"/"middlegame"/"endgame" as an English word, so
// this has nothing else to misfire against in the real copy.
const PHASE_WORD_RE = /\b(opening|middlegame|endgame)\b/i;

function kindOf(tp: TurningPoint): string {
  return tp.kind as unknown as string;
}

function detailOf(tp: TurningPoint): string | undefined {
  return (tp as unknown as { detail?: string }).detail;
}

function sanMatches(text: string): { token: string; start: number; end: number }[] {
  const re = new RegExp(SAN_RE.source, "g");
  const out: { token: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function maskSanTokens(text: string, ranges: { start: number; end: number }[]): string {
  let out = text;
  for (const r of ranges) {
    out = out.slice(0, r.start) + " ".repeat(r.end - r.start) + out.slice(r.end);
  }
  return out;
}

function bareSquares(text: string, sanRanges: { start: number; end: number }[]): string[] {
  const masked = maskSanTokens(text, sanRanges);
  return masked.match(new RegExp(SQUARE_RE.source, "g")) ?? [];
}

function collectValidSans(facts: DebriefFacts): Set<string> {
  const out = new Set<string>();
  for (const m of facts.gameSans ?? []) out.add(m.san);
  for (const line of facts.turningLines ?? []) {
    for (const s of line.pvSans ?? []) out.add(s);
    if (line.bestSan) out.add(line.bestSan);
  }
  return out;
}

// One replay pass over the whole recorded game. Stops (never guesses past)
// the first unreplayable move, same discipline as phase.ts's nearlyBarePlies.
function replaySquares(gameSans: SummaryMove[]): Set<string> {
  const out = new Set<string>();
  const chess = new Chess();
  for (const m of [...gameSans].sort((a, b) => a.ply - b.ply)) {
    let mv;
    try {
      mv = chess.move(m.san);
    } catch {
      break;
    }
    if (!mv) break;
    out.add(mv.from);
    out.add(mv.to);
  }
  return out;
}

function collectValidSquares(facts: DebriefFacts): Set<string> {
  const out = replaySquares(facts.gameSans ?? []);
  for (const line of facts.turningLines ?? []) {
    for (const pt of [line.playedFromTo, line.bestFromTo, line.threat]) {
      if (pt) {
        out.add(pt.from);
        out.add(pt.to);
      }
    }
  }
  for (const tp of facts.turningPoints) {
    const detail = detailOf(tp);
    if (!detail) continue;
    for (const sq of detail.match(new RegExp(SQUARE_RE.source, "g")) ?? []) out.add(sq);
  }
  return out;
}

function bulletWhere(b: DebriefBullet, i: number): string {
  return `bullet:${b.section}:${i}`;
}

function noteWhere(ply: number): string {
  return `note:${ply}`;
}

// MEDIUM-7 (N1 fix wave): a distinct tag from noteWhere so a violation
// message can say "row" rather than misdescribing a study-ledger row as a
// note. plyForWhere below decodes it the same direct way as note:<ply>.
function rowWhere(ply: number): string {
  return `row:${ply}`;
}

// ADDENDUM 2 fix (union review, 2026-07-31): conversion-claim needs the
// PLY a text unit is about (to look up its backing turning point), but
// outputTextUnits only carries the `where` string, not a numeric ply --
// bullets encode an ARRAY INDEX in their `where` (bulletWhere's own
// `i`), notes encode the ply DIRECTLY (noteWhere's `ply`). This is the one
// place that decodes either shape back to a real ply, so the two formats
// never have to be re-parsed ad hoc at each call site. `bullets` is the
// same array outputTextUnits itself was built from -- same order, so the
// index recovered from a bullet's `where` always resolves to the right one.
function plyForWhere(where: string, bullets: DebriefBullet[]): number | undefined {
  const noteMatch = /^note:(\d+)$/.exec(where);
  if (noteMatch) return parseInt(noteMatch[1], 10);
  // MEDIUM-7 (N1 fix wave): rows encode the ply directly, same as notes.
  const rowMatch = /^row:(\d+)$/.exec(where);
  if (rowMatch) return parseInt(rowMatch[1], 10);
  const bulletMatch = /^bullet:.*:(\d+)$/.exec(where);
  if (bulletMatch) return bullets[parseInt(bulletMatch[1], 10)]?.ply;
  return undefined;
}

interface TextUnit {
  text: string;
  where: string;
}

// review-0.md important 1: seven of the fourteen rules are worded against
// the whole DebriefOutput ("any text", "in output", "anywhere"), not just
// its bullets -- win-copy-on-non-win, reassurance-vs-detector, unknown-san,
// unknown-square, voice-em-dash, voice-emoji, voice-capital. DebriefPage.tsx
// renders note prose (didWell/couldImprove/nextTime/whatMayHaveHappened/
// opportunity, turningPointNote.ts) in the same cards as the bullets, and it
// is the highest-risk text for exactly the claims these rules check -- so
// this is the one place both surfaces feed the same rule, each note field
// tagged with the spec'd "note:<ply>" where.
function outputTextUnits(output: DebriefOutput): TextUnit[] {
  const bullets = output.bullets ?? [];
  const units: TextUnit[] = bullets.map((b, i) => ({ text: b.text, where: bulletWhere(b, i) }));
  for (const note of output.notes ?? []) {
    const where = noteWhere(note.ply);
    for (const field of [note.didWell, note.couldImprove, note.nextTime, note.whatMayHaveHappened, note.opportunity]) {
      if (field) units.push({ text: field, where });
    }
  }
  // MEDIUM-7 (N1 fix wave): highlightedMoves.ts's study-ledger row derives
  // its own mate number and was invisible to every rule below -- folded in
  // exactly like a note so it gets the SAME checks, not a sixth hand-written
  // one.
  for (const row of output.rows ?? []) {
    if (row.note) units.push({ text: row.note, where: rowWhere(row.ply) });
  }
  return units;
}

export function checkDebriefOutput(output: DebriefOutput, facts: DebriefFacts): DebriefViolation[] {
  const violations: DebriefViolation[] = [];
  const bullets = output.bullets ?? [];
  // Phase round (2026-07-30): built once per invocation, straight off the
  // same real chess.js replay of facts.gameSans that debriefBullets.ts's
  // own builder runs -- a genuine board fact (lichess divider + nearly-bare
  // override), not the old ply-arithmetic guess this rule used to import
  // and re-run against itself.
  const phases = phasesForGame(facts.gameSans);

  // -- contradictions --------------------------------------------------

  const neverMissFired = facts.turningPoints.some((tp) => NEVER_MISS_KINDS.includes(kindOf(tp)));

  outputTextUnits(output).forEach(({ text, where }) => {
    if (facts.result !== "1-0" && text.includes("brought the game home")) {
      violations.push({
        kind: "contradiction",
        rule: "win-copy-on-non-win",
        where,
        message: `"brought the game home" claimed but the result was "${facts.result}"`,
      });
    }

    // review-0.md minor 6: REASSURANCE_RE's job here is exactly the two
    // phrases this rule is spec'd on (win-copy-on-non-win owns "brought the
    // game home" above, via its own direct .includes) -- so the constant is
    // scoped to match what actually triggers reassurance-vs-detector, and
    // the guard is just the one regex test, not a second narrower check
    // that made the regex a no-op.
    if (neverMissFired && REASSURANCE_RE.test(text)) {
      violations.push({
        kind: "contradiction",
        rule: "reassurance-vs-detector",
        where,
        message: "reassurance copy present while a never-miss detector fired this game",
      });
    }
  });

  // missed-mate-dismissed: like try-line-on-followed below, this is a
  // permanent regression guard that is structurally unreachable through the
  // real bullet builder today (review-0.md minor 3, verified independently
  // by review) -- documented here rather than broadened, since inventing a
  // trigger is worse than an honest guard that never fires on real copy:
  // "keep playing this clean" exists only in debriefBullets.ts:483's
  // ply-less could-be-better fallback, which itself never runs alongside a
  // missed-win point (debriefBullets.ts:392 pushes the missed-win bullet
  // into `out` unconditionally, so the fallback's `out.length === 0` guard
  // is always false whenever this rule's tp.kind === "missed-win" condition
  // could hold); "cost you nothing" exists only in highlightedMoves.ts:90's
  // move-severity copy, which never becomes a DebriefBullet.text at all. If
  // either producer ever starts emitting one of these strings on a plied
  // bullet, this rule is what catches it. Its own test (below, in
  // debriefInvariants.test.ts) drives it through constructed input, not
  // through the real builder.
  for (const tp of facts.turningPoints) {
    if (kindOf(tp) !== "missed-win") continue;
    bullets.forEach((b, i) => {
      if (b.ply !== tp.ply) return;
      if (b.text.includes("cost you nothing") || b.text.includes("keep playing this clean")) {
        violations.push({
          kind: "contradiction",
          rule: "missed-mate-dismissed",
          where: bulletWhere(b, i),
          message: `missed-win at ply ${tp.ply} dismissed by reassurance copy`,
        });
      }
    });
  }

  bullets.forEach((b, i) => {
    if (b.ply == null) return;
    // V1 fix (2026-07-30 integration review): buildDoneWell's/buildWatchNextTime's
    // unconverted-branch bullets deliberately phase themselves from a
    // DIFFERENT ply (her own run-start ply) than b.ply (kept as the rewind
    // anchor, pointing at the actual turning point) whenever their own
    // prose names that phase explicitly -- see debriefBullets.ts's V1 fix
    // comment. When the bullet's own text already asserts a phase word,
    // phase-word-vs-field (below) is the authoritative, more direct check
    // on that claim; comparing b.phase against b.ply's timeline lookup here
    // would flag a ply this phase claim was never about.
    if (PHASE_WORD_RE.test(b.text)) return;
    const expected = phases.phaseAt(b.ply);
    if (b.phase !== expected) {
      violations.push({
        kind: "contradiction",
        rule: "phase-mismatch",
        where: bulletWhere(b, i),
        message: `phase "${b.phase}" tagged at ply ${b.ply} but the phase timeline says "${expected}"`,
      });
    }
  });

  // phase-vs-category (I1): a bullet's category must not name a phase
  // different from the bullet's own phase field. Catches e.g. category
  // "endgame technique" sitting on a bullet whose phase is "middlegame" --
  // the chip that read "middlegame · endgame technique" on her real games
  // 151/143/132 this round.
  bullets.forEach((b, i) => {
    const impliedPhase = CATEGORY_IMPLIES_PHASE[b.category];
    if (impliedPhase && b.phase != null && b.phase !== impliedPhase) {
      violations.push({
        kind: "contradiction",
        rule: "phase-vs-category",
        where: bulletWhere(b, i),
        message: `category "${b.category}" implies phase "${impliedPhase}" but the bullet's phase is "${b.phase}"`,
      });
    }
  });

  // phase-word-vs-field (V1): a bullet's phase field must agree with any
  // phase word its own prose literally asserts. Unlike phase-mismatch
  // (above), which compares the bullet's phase to the TIMELINE's phase for
  // the same ply and stays silent once both sides come from phasesForGame,
  // this compares the bullet against ITSELF -- the exact class the visual
  // gate caught live on game 151 (chip "middlegame" over the text "your
  // opening is working").
  bullets.forEach((b, i) => {
    if (b.phase == null) return; // no board to prove a phase -- legitimately silent
    const m = b.text.match(PHASE_WORD_RE);
    if (!m) return; // prose asserts no phase word -- nothing to compare
    const word = m[1].toLowerCase();
    if (word !== b.phase) {
      violations.push({
        kind: "contradiction",
        rule: "phase-word-vs-field",
        where: bulletWhere(b, i),
        message: `bullet text names phase "${word}" but the bullet's phase field is "${b.phase}"`,
      });
    }
  });

  // conversion-claim (K1, game-160 RCA round, 2026-07-31; TIGHTENED twice in
  // the union review fix wave, same date): any TEXT UNIT -- bullet, note,
  // lesson, or highlighted row, ANYTHING on her screen -- asserting a
  // missed/slipped mate ("mate in N" / "checkmate in N") must be backed by a
  // same-ply turning point whose stored mateIn AGREES with the number
  // actually asserted -- the debrief path has no LLM (CLAUDE.md), so a
  // false mate claim here is our own template contradicting our own data,
  // same failure class as every other contradiction rule in this file.
  //
  // First tightening: originally shipped checking only that mate data
  // EXISTED at the ply (`tp.mateIn != null`), never that the asserted number
  // matched it. That is why `replay-check` reported PASS, 0 violations over
  // a corpus containing 8 real games where a bullet said "checkmate in one"
  // and the backing turning point's mateIn was 2-5 (C1).
  //
  // Second tightening (ADDENDUM 2, ships the SAME commit as the fourth C1
  // producer's copy fix, turningPointNote.ts): this rule iterated
  // `bullets.forEach` directly, so it was structurally blind to card NOTE
  // text (turningPointNote.ts's couldImprove field, rendered on every card
  // by DebriefPage.tsx) -- the surface where the fourth "checkmate in one"
  // producer actually lived. `checkDebriefOutput` reported 0 violations in
  // the SAME run that produced 8 false notes, for the identical shape of
  // reason the first tightening exists to fix: a check narrower than the
  // thing it claims to cover. Now routes through `outputTextUnits(output)`,
  // the SAME helper win-copy-on-non-win/unknown-san/unknown-square/voice-*
  // already use, so it covers bullets AND notes (and, structurally, the
  // lesson/highlighted-row text ANY future caller folds into `output` the
  // same way) alike -- if a fifth producer appears, this routing is what
  // catches it, not a fifth hand-written check. `plyForWhere` recovers the
  // ply from either shape (`where`'s own encoding, see its comment); a
  // TEXT UNIT WITH NO RESOLVABLE PLY IS TREATED AS UNBACKED, same as a ply
  // that matches no turning point -- never silently skipped, since there is
  // no way to verify an unanchored claim either way. Backs BOTH the
  // "conversion" kind's bullet (mateIn = the episode's shortest held mate)
  // and the existing "missed-win"/"unconverted" kinds' own mate clauses
  // (mateIn is already the field all three use). Tolerant of games with no
  // conversion turning points at all -- only text that actually names a
  // mate distance is checked.
  //
  // Third tightening (reviewer's own falsification pass, 2026-07-31): a
  // NUMBER-FREE mate-in-1 claim ("was mate on the spot" / "ends it on the
  // spot") asserts the distance semantically, with no digit or number word
  // for parseMateClaimNumbers to find -- proven by mutation: an
  // unconditional "ends it on the spot" in turningPointNote.ts made
  // replay-check exit 0 with zero violations on real games where mateIn was
  // 2-5. IMPLICIT_MATE_ONE_PHRASES (above) is the enumerated, precision-
  // over-recall fix -- exactly the two phrases actually in production, not
  // a paraphrase matcher. HONEST LIMIT, stated plainly rather than
  // overstated: this catches a WRONG NUMBER and this SPECIFIC enumerated
  // phrase set. It does NOT catch an arbitrary future paraphrase ("wins on
  // the spot", "mates immediately", etc.) -- a new number-free immediate-
  // mate phrase must be added to IMPLICIT_MATE_ONE_PHRASES by hand, in that
  // one place, or this rule goes blind to it exactly the way it went blind
  // to these two.
  outputTextUnits(output).forEach(({ text, where }) => {
    const claims = parseMateClaimNumbers(text);
    const impliesMateOne = hasImplicitMateOneClaim(text);
    if (claims.length === 0 && !impliesMateOne) return;
    const ply = plyForWhere(where, bullets);
    const tp = ply != null ? facts.turningPoints.find((t) => t.ply === ply && t.mateIn != null) : undefined;
    if (!tp) {
      violations.push({
        kind: "contradiction",
        rule: "conversion-claim",
        where,
        message: `text asserts a mate claim ("${text}") with no same-ply turning point mate data to back it`,
      });
      return;
    }
    // N1 (2026-08-21). Framing B emits TWO provable numbers in one sentence:
    // the stored forced-mate prediction, and the distance the game actually
    // ran. Both are facts; only the first used to be accepted. The actual is
    // recomputed here from facts.gameSans rather than trusted from the text.
    //
    // FALSE-POSITIVE AUDIT (required by this rule's own history -- the last
    // widening swept in opportunity.ts's honest "leads to mate in N" and
    // false-flagged 13 real games). Newly accepted: exactly one additional
    // integer per ply, equal to mateOutcomeFor().actual, and only when a
    // same-ply turning point with a mateIn already exists. Nothing else moves
    // into scope: a claim with no backing turning point still violates above,
    // and a number that is neither value still violates below.
    // HIGH-3 (Opus review, N1 fix wave): nothing this round's copy emits
    // ever claims `actual` on a "slower" or "unresolved" outcome -- those
    // branches keep the pre-N1 reproachful/plain copy, which asserts only
    // tp.mateIn. Accepting `actual` there regardless was pure loosening:
    // proven by mutation to accept "mate in 20" (game 179, genuinely slower)
    // and "mate in zero" (game 177, unresolved actual: 0) as legitimate
    // claims. Gate on the outcome, not just its presence.
    const outcomeFacts =
      tp.mateIn != null
        ? mateOutcomeFor(tp.ply, tp.mateIn, lastPlyOf(facts.gameSans), facts.gameSans)
        : undefined;
    const actual =
      outcomeFacts && (outcomeFacts.outcome === "faster" || outcomeFacts.outcome === "matched")
        ? outcomeFacts.actual
        : undefined;
    for (const n of claims) {
      if (n !== tp.mateIn && n !== actual) {
        violations.push({
          kind: "contradiction",
          rule: "conversion-claim",
          where,
          message:
            actual != null
              ? `text asserts mate in ${n} but the same-ply turning point's mateIn is ${tp.mateIn} and the game actually ran ${actual}`
              : `text asserts mate in ${n} but the same-ply turning point's mateIn is ${tp.mateIn}`,
        });
      }
    }
    if (impliesMateOne && tp.mateIn !== 1) {
      violations.push({
        kind: "contradiction",
        rule: "conversion-claim",
        where,
        message: `text asserts an immediate mate ("${text}") but the same-ply turning point's mateIn is ${tp.mateIn}`,
      });
    }
  });

  // try-line-on-followed: skips entirely when turningLines is absent (never
  // guess). Calls the REAL affordancesForBullet and the REAL followedBest --
  // never a hand-rolled squares compare, that bug has shipped four times.
  if (facts.turningLines) {
    bullets.forEach((b, i) => {
      if (b.ply == null) return;
      const aff = affordancesForBullet(b, facts.turningLines, facts.gameSans);
      if (!aff.tryLine) return;
      const line = facts.turningLines!.find((l) => l.ply === b.ply);
      const fb = followedBest(line, facts.gameSans);
      if (fb?.followed === true) {
        violations.push({
          kind: "contradiction",
          rule: "try-line-on-followed",
          where: bulletWhere(b, i),
          message: `try-the-line offered at ply ${b.ply} but followedBest says she already played it`,
        });
      }
    });
  }

  // unknown-san / unknown-square: both skip entirely when turningLines is
  // absent -- there is no way to verify a claim against lines we don't have.
  if (facts.turningLines) {
    const validSans = collectValidSans(facts);
    const validSquares = collectValidSquares(facts);
    outputTextUnits(output).forEach(({ text, where }) => {
      const ranges = sanMatches(text);
      for (const { token } of ranges) {
        if (!validSans.has(token)) {
          violations.push({
            kind: "contradiction",
            rule: "unknown-san",
            where,
            message: `san "${token}" is not in the game or any supplied turning line`,
          });
        }
      }
      for (const sq of bareSquares(text, ranges)) {
        if (!validSquares.has(sq)) {
          violations.push({
            kind: "contradiction",
            rule: "unknown-square",
            where,
            message: `square "${sq}" is not in the replayed game, a line's endpoints, or a detector's own detail`,
          });
        }
      }
    });
  }

  outputTextUnits(output).forEach(({ text, where }) => {
    if (text.includes("—")) {
      violations.push({ kind: "contradiction", rule: "voice-em-dash", where, message: "em-dash found in bullet text" });
    }
    if (/\p{Extended_Pictographic}/u.test(text)) {
      violations.push({ kind: "contradiction", rule: "voice-emoji", where, message: "emoji found in bullet text" });
    }
    const ranges = sanMatches(text);
    for (let idx = 0; idx < text.length; idx++) {
      const ch = text[idx];
      if (ch >= "A" && ch <= "Z") {
        const insideSan = ranges.some((r) => idx >= r.start && idx < r.end);
        if (!insideSan) {
          violations.push({
            kind: "contradiction",
            rule: "voice-capital",
            where,
            message: `capital letter outside a san token in "${text}"`,
          });
          break;
        }
      }
    }
  });

  // -- silences ----------------------------------------------------------

  for (const tp of facts.turningPoints) {
    if (kindOf(tp) !== "unconverted") continue;
    if (!bullets.some((b) => b.ply === tp.ply)) {
      violations.push({
        kind: "silence",
        rule: "unconverted-silent",
        where: "debrief",
        message: `unconverted point at ply ${tp.ply} has no bullet on its ply`,
      });
    }
  }

  for (const tp of facts.turningPoints) {
    if (kindOf(tp) !== "missed-win") continue;
    if (!bullets.some((b) => b.ply === tp.ply)) {
      violations.push({
        kind: "silence",
        rule: "missed-mate-silent",
        where: "debrief",
        message: `missed-win point at ply ${tp.ply} has no bullet on its ply`,
      });
    }
  }

  // Wave E (2026-08-27): lead-change-silent -- follows the unconverted-
  // silent pattern above but accepts EITHER surface (bullet OR note),
  // because the card note is the guaranteed one (the done-well bullet slot
  // is single, and the punish branch legitimately outranks this bullet).
  for (const tp of facts.turningPoints) {
    if (kindOf(tp) !== "lead-change") continue;
    const hasBullet = bullets.some((b) => b.ply === tp.ply);
    const hasNote = (output.notes ?? []).some(
      (n) => n.ply === tp.ply && (n.didWell || n.couldImprove)
    );
    if (!hasBullet && !hasNote) {
      violations.push({
        kind: "silence",
        rule: "lead-change-silent",
        where: "debrief",
        message: `lead-change point at ply ${tp.ply} has no bullet and no note on its ply`,
      });
    }
  }

  // Task 7 (game 192, RC8): counterfactual-only-card -- the dead-end card
  // the owner called useless: an opponent inaccuracy with punish_san NULL
  // rendered ONLY "what may have happened: if instead your knight to e5."
  // and nothing else. Fires on any note whose whatMayHaveHappened is set
  // but didWell/couldImprove/nextTime/opportunity are all absent -- a
  // counterfactual with no other content is a card that says nothing she
  // can act on.
  //
  // Fix round 1, F3 (2026-08-29): note.opportunity ("this opens up: ...")
  // is real, actionable content too -- turningPointNote.ts's
  // buildTurningPointNote populates it independently of
  // didWell/couldImprove/nextTime whenever the line replays at all, which
  // is reachable today on backfill labels like "the clincher" (no motif,
  // so no nextTime; no eval-band/missedPunish match, so no couldImprove).
  // Omitting it here falsely flagged that shape as the dead-end card.
  for (const note of output.notes ?? []) {
    if (
      note.whatMayHaveHappened &&
      !note.didWell &&
      !note.couldImprove &&
      !note.nextTime &&
      !note.opportunity
    ) {
      violations.push({
        kind: "silence",
        rule: "counterfactual-only-card",
        where: "debrief",
        message: `note at ply ${note.ply} has only whatMayHaveHappened, no didWell/couldImprove/nextTime/opportunity`,
      });
    }
  }

  const tacticPoints = facts.turningPoints.filter((tp) => TACTIC_KINDS.includes(kindOf(tp)));
  if (tacticPoints.length > 0 && !bullets.some((b) => tacticPoints.some((tp) => tp.ply === b.ply))) {
    violations.push({
      kind: "silence",
      rule: "detector-silent",
      where: "debrief",
      message: "a tactic detector fired this game with no bullet on any of its plies",
    });
  }

  if (neverMissFired && !bullets.some((b) => b.section === "watch next time")) {
    violations.push({
      kind: "silence",
      rule: "watch-next-empty",
      where: "debrief",
      message: "a never-miss detector fired this game but watch next time is empty",
    });
  }

  return violations;
}
