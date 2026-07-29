import { SAN_RE } from "./validate";

// R2 methodology (2026-07-22, "coach eval v2"): single source of truth for
// the coach's voice rules -- the deterministic jargon / ai-ism / casing
// checks the committed eval harness (tools/coach-eval/) scores every model
// answer against. The FUTURE runtime checkVoice inside validateChat (R2
// Task 3) is meant to import this same module so the harness and the
// validator never drift into two different definitions of "clean voice".
//
// This session deliberately does NOT wire checkVoice into validateChat or
// any runtime path -- see the R2 build brief. It exists purely so the
// harness has something real to import.
//
// SAN_RE is IMPORTED from ./validate (the one shared SAN-shaped-token
// pattern chat.ts's validateChat and this file's raw-san check both use --
// no second definition). isBareSquare below is MIRRORED, not imported:
// chat.ts's own isBareSquare is a module-local, unexported one-liner, and
// exporting it would be a chat.ts change outside this session's scope.

// Allowlisted in-cast name for the engine, per the task-0 owner ruling.
// "engine" itself stays banned forever regardless of what's on this list --
// see the "engine" rule below, which is never suppressed by the allowlist.
export const ENGINE_NAME_ALLOWLIST = ["the chess brain"];

export interface JargonRule {
  id: string;
  re: RegExp;
}

export const JARGON_RULES: JargonRule[] = [
  // "engine" is banned forever, regardless of the allowlist.
  { id: "engine", re: /\bengine('s)?\b/i },
  { id: "eval", re: /\beval(s|uation|uations)?('s)?\b/i },
  { id: "cp", re: /\bcp\b|\bcentipawns?\b/i },
  // Signed numbers only: "-24", "+0.3". Unsigned "mate in 3" / "move 12" /
  // a bare "e4" all pass -- the leading [+-] is what makes a number read as
  // an eval score instead of a normal chess reference.
  { id: "signed-number", re: /(^|[\s(["'])[+-]\d+(\.\d+)?\b/ },
];

export const SENTENCE_END_RE = /[.!?]["')\]]?$/;

// Persona banned words, copied VERBATIM from server/coach/personas/coach.md
// (the "banned words" paragraph, "## voice" section). Keep in sync by hand
// if that paragraph ever changes -- there is no automated diff between the
// two.
export const AI_ISM_WORDS: string[] = [
  "delve",
  "leverage",
  "robust",
  "comprehensive",
  "seamless",
  "tapestry",
  "realm",
  "paradigm",
  "pivotal",
  "underscore",
  "meticulous",
  "utilize",
  "showcase",
  "testament to",
  "beacon",
  "embark",
  "game-changer",
  "elevate",
  "harness",
  "foster",
  "streamline",
  "empower",
  "dive into",
  "deep dive",
  "unpack",
  "intricate",
  "nuanced",
  "crucial",
  "myriad",
  "plethora",
  "cutting-edge",
  "holistic",
  "actionable",
  "impactful",
];

export const AI_ISM_PHRASES: RegExp[] = [
  /^\s*great question/i,
  // Require the apostrophe (straight ' or curly ’): the banned AI-ism is the
  // contraction "let's". The optional apostrophe (`'?`) previously also
  // matched the ordinary verb "lets" ("X lets you take the bishop"), which is
  // plain English, not banned (audit iter 1, 7 false positives).
  /\blet['’]s\b/i,
  /it'?s not \S[^.!?]{0,40}, it'?s /i,
  /\bmoreover\b/i,
  /\bfurthermore\b/i,
];

// ---- register drift (eval-instrument-repair round, 2026-07-28) ------------
//
// A THIRD, separate axis, added after the owner graded all 30 blinded rows:
// "we also still have AIisms that are in here that are passing as clean but
// they're saying things like this: 'compounds that's the whole loop buying
// and selling,' which is weird for a chess game."
//
// JARGON_RULES bans engine vocabulary and raw notation; AI_ISM_WORDS bans a
// fixed word list. Neither has any concept of a chess coach sliding into
// productivity/business register, so both of these scored clean:
//   "...spend ten minutes with our chess brain looking at the moments it
//    flagged. that's the whole loop."
//   "that habit compounds faster than anything else at your stage."
//
// Deliberately SHORT and precision-over-recall: phrases that are unambiguously
// out of register for a chess coach, not a general corporate-speak detector.
// The list is UNVALIDATED -- per the coach-eval skill's rule 3 (audit the
// instrument before you report its numbers, and never let an unaudited checker
// decide), tools/coach-eval reports this rate and decide.ts is forbidden from
// consulting it until it has been hand-audited against a sample.
//
// "leverage" is also in AI_ISM_WORDS above; that overlap is intentional, and
// visible rather than hidden, because the two axes are reported separately.
export const REGISTER_DRIFT: string[] = [
  "compounds",
  "the whole loop",
  "buying and selling",
  "leverage",
  "double down",
  "unlock",
  "level up",
  "roi",
  "bandwidth",
  "synergy",
];

// Word-boundary anchored, NOT a raw substring test. The plan's draft used
// `lower.includes(p)`, which would have fired "roi" inside ordinary English a
// chess coach really might write ("heroic", "adroit") -- a false positive of
// exactly the "ownership by proximity" kind that inflated a prior round's
// error rate 7.5% -> 16.8% before it was audited out.
//
// Returns each distinct listed phrase found, once, in list order -- the
// canonical phrase, not the raw casing of the match, so a caller can group
// hits without normalizing.
export function checkRegister(text: string): string[] {
  const hits: string[] = [];
  for (const phrase of REGISTER_DRIFT) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) hits.push(phrase);
  }
  return hits;
}

// Mirrors chat.ts's module-local isBareSquare exactly -- deliberately not
// imported (chat.ts does not export it; see the header comment above).
function isBareSquare(token: string): boolean {
  return /^[a-h][1-8]$/.test(token);
}

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,!?;:'"]+$/, "");
}

// Ensures a regex used with matchAll has the "g" flag, without mutating the
// exported constant regexes themselves (matchAll requires a global regex;
// re-constructing per call keeps JARGON_RULES/AI_ISM_PHRASES safe to export
// as plain, non-stateful RegExp objects).
function withGlobalFlag(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`);
}

export interface VoiceViolation {
  axis: "jargon" | "ai-ism" | "casing";
  // Rule id for jargon ("engine" | "eval" | "cp" | "signed-number" |
  // "raw-san"); the banned word/phrase source for ai-ism; "uppercase" for
  // casing.
  id: string;
  match: string;
}

// Pure text scan, no chess/db/network dependency -- runs every axis and
// returns every violation found, in scan order. Callers (the eval harness's
// score.ts today; a future validateChat tomorrow) decide what "pass" means
// per axis; this function only reports facts.
export function checkVoice(text: string, opts: { allowlist?: string[] } = {}): VoiceViolation[] {
  const allowlist = new Set((opts.allowlist ?? ENGINE_NAME_ALLOWLIST).map((s) => s.toLowerCase()));
  const violations: VoiceViolation[] = [];

  for (const rule of JARGON_RULES) {
    for (const m of text.matchAll(withGlobalFlag(rule.re))) {
      const match = m[0].trim();
      if (!match || allowlist.has(match.toLowerCase())) continue;
      violations.push({ axis: "jargon", id: rule.id, match });
    }
  }

  // Raw-san-as-move-name: any SAN-shaped token that is not a bare square is
  // a jargon hit -- "Nf3" fails, a bare "e5" is free geography and passes
  // (same cut chat.ts's validateChat already makes for truthfulness).
  // Castling ("O-O"/"O-O-O") counts as raw san.
  for (const raw of text.match(SAN_RE) ?? []) {
    const token = stripTrailingPunctuation(raw);
    if (!token || isBareSquare(token)) continue;
    if (allowlist.has(token.toLowerCase())) continue;
    violations.push({ axis: "jargon", id: "raw-san", match: token });
  }

  for (const word of AI_ISM_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      violations.push({ axis: "ai-ism", id: word, match: m[0] });
    }
  }
  for (const phrase of AI_ISM_PHRASES) {
    for (const m of text.matchAll(withGlobalFlag(phrase))) {
      violations.push({ axis: "ai-ism", id: phrase.source, match: m[0] });
    }
  }

  // Casing: the persona is lowercase-only; legitimate uppercase is SAN,
  // which the raw-san check above already bans on its own terms. One
  // violation per text (not per character) -- the axis is binary pass/fail.
  const upper = text.match(/[A-Z]/);
  if (upper) violations.push({ axis: "casing", id: "uppercase", match: upper[0] });

  return violations;
}
