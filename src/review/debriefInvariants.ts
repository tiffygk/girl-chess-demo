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
import { phaseForPly, affordancesForBullet, type DebriefBullet } from "./debriefBullets";
import { followedBest } from "./followedBest";

export interface DebriefFacts {
  result: string | null;
  turningPoints: TurningPoint[]; // kind compared as string, so this module predates Task 2's union additions
  gameSans: SummaryMove[];
  turningLines?: TurningLine[]; // absent -> san/square/try-line checks SKIP (never guess)
  totalPlies: number;
  endgamePlies?: Set<number>;
}

export interface DebriefOutput {
  bullets: DebriefBullet[];
  notes?: { ply: number; couldImprove?: string; nextTime?: string; didWell?: string; whatMayHaveHappened?: string }[];
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
const REASSURANCE_RE = /no clear mistakes|no repeat pattern|brought the game home/;

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

export function checkDebriefOutput(output: DebriefOutput, facts: DebriefFacts): DebriefViolation[] {
  const violations: DebriefViolation[] = [];
  const bullets = output.bullets ?? [];

  // -- contradictions --------------------------------------------------

  const neverMissFired = facts.turningPoints.some((tp) => NEVER_MISS_KINDS.includes(kindOf(tp)));

  bullets.forEach((b, i) => {
    const where = bulletWhere(b, i);

    if (facts.result !== "1-0" && b.text.includes("brought the game home")) {
      violations.push({
        kind: "contradiction",
        rule: "win-copy-on-non-win",
        where,
        message: `"brought the game home" claimed but the result was "${facts.result}"`,
      });
    }

    if (neverMissFired && REASSURANCE_RE.test(b.text) && (b.text.includes("no clear mistakes") || b.text.includes("no repeat pattern"))) {
      violations.push({
        kind: "contradiction",
        rule: "reassurance-vs-detector",
        where,
        message: "reassurance copy present while a never-miss detector fired this game",
      });
    }
  });

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
    const expected = phaseForPly(b.ply, facts.totalPlies, facts.endgamePlies);
    if (b.phase !== expected) {
      violations.push({
        kind: "contradiction",
        rule: "phase-mismatch",
        where: bulletWhere(b, i),
        message: `phase "${b.phase}" tagged at ply ${b.ply} but phaseForPly says "${expected}"`,
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
    bullets.forEach((b, i) => {
      const where = bulletWhere(b, i);
      const ranges = sanMatches(b.text);
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
      for (const sq of bareSquares(b.text, ranges)) {
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

  bullets.forEach((b, i) => {
    const where = bulletWhere(b, i);
    if (b.text.includes("—")) {
      violations.push({ kind: "contradiction", rule: "voice-em-dash", where, message: "em-dash found in bullet text" });
    }
    if (/\p{Extended_Pictographic}/u.test(b.text)) {
      violations.push({ kind: "contradiction", rule: "voice-emoji", where, message: "emoji found in bullet text" });
    }
    const ranges = sanMatches(b.text);
    for (let idx = 0; idx < b.text.length; idx++) {
      const ch = b.text[idx];
      if (ch >= "A" && ch <= "Z") {
        const insideSan = ranges.some((r) => idx >= r.start && idx < r.end);
        if (!insideSan) {
          violations.push({
            kind: "contradiction",
            rule: "voice-capital",
            where,
            message: `capital letter outside a san token in "${b.text}"`,
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
