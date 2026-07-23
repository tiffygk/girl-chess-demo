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
