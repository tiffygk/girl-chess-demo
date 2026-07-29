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
import { affordancesForBullet, type DebriefBullet } from "./debriefBullets";
import { phasesForGame } from "./gamePhases";
import { followedBest } from "./followedBest";

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
