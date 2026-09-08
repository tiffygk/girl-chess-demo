// F2 (2026-08-03, unbreak-main round): the standing no-em-dashes rule was
// violated in real coach chat output -- advice_traces 196/197/199/202 (game
// 169) carry em-dashes from BOTH a validated model reply (source=model) and
// a rejected draft that ended up in a template-fallback row (source=template,
// see chat.ts's attemptOutput -- the persisted `output` field is always the
// raw last-attempt text, not the user-facing apology copy, so a leak in
// either source shows up here). Root cause: no em-dash normalization existed
// anywhere in server/coach/ (grep confirmed every `—`/`–` hit in that
// directory was a comment or test literal). This is the one normalization
// point every coach-chat output funnels through before it is persisted or
// returned -- chat.ts calls it at every seam that produces a final string
// (the validated model reply, the raw draft that gets persisted even when
// the user is shown a template apology, the persona-template fallback
// strings themselves, and the off-topic redirect).
//
// Reversible formatting choice, controller-approved (brief-unbreak-main.md
// Task 2): a spaced em-dash (" — ") reads as a comma-joined clause in plain
// prose, so it becomes ", "; anything left over (an em-dash with no
// surrounding spaces, or an en-dash in either shape) becomes " -- ", the
// same ASCII double-hyphen the persona's own banned-punctuation rule already
// asks the model to use instead.
export function normalizeEmDash(text: string): string {
  return text.replace(/ — /g, ", ").replace(/[—–]/g, " -- ");
}

// Wave V3 (2026-09-08, voice-align round). Owner's ask, verbatim: "I also
// want to fix the em dashes and the 'avoid AI writing' skill in what the
// coach says under the hint ladder." normalizeEmDash above only ever ran
// on the chat surface (server/coach/chat.ts); the band (narrate(), this
// file's sibling server/coach/index.ts) had zero calls, so the same dash
// leak was reachable there too. normalizeVoice is the single funnel every
// final coach-reply string (band and chat alike) now passes through, in
// order:
//   1. normalizeEmDash -- the existing em/en-dash rule, unchanged.
//   2. " -- " -> ", " -- the ASCII double-hyphen normalizeEmDash itself
//      emits for a bare em/en-dash still reads as a dash to the owner, so
//      anything left in that exact spaced form is folded into a comma
//      clause too. Applied AFTER step 1 so it also catches a double-hyphen
//      the model wrote directly (the persona's own banned-punctuation rule
//      already asks it to use this form instead of a real dash).
//   3. a spaced single hyphen used as a dash ("c5 - it forks") -> comma
//      clause. Requires a space on BOTH sides so it never touches a
//      hyphenated word ("x-ray") or a negative number ("-3").
//   4. the controller-adjudicated swap list below, whole-word and
//      case-insensitive (coach copy is already lowercase per the app's
//      style rule, but matching case-insensitively keeps this safe against
//      a persona-template edit that isn't). Deliberately narrow: no
//      sentence restructuring ("it's not X, it's Y" stays exactly as
//      written) -- that shape is not deterministic and is out of scope by
//      controller ruling; the persona handles voice, this function only
//      handles a fixed, adjudicated list of AI-writing tells.
const VOICE_SWAPS: Array<[RegExp, string]> = [
  [/\bhere's the real issue\b/gi, "here's the issue"],
  [/\bthe real issue\b/gi, "the issue"],
  [/\bthe real reason\b/gi, "the reason"],
  [/\ba real slip\b/gi, "a slip"],
  [/\ba real gift\b/gi, "a gift"],
  [/\ba real plan\b/gi, "a plan"],
  [/\breal ground\b/gi, "ground"],
  [/\bworth a look\b/gi, "one to look at"],
  [/\bworth knowing\b/gi, "good to know"],
  // Only the exact "that's the thing, " (trailing comma-space) is dropped;
  // the bare phrase with no trailing comma stays untouched.
  [/\bthat's the thing, /gi, ""],
];

export function normalizeVoice(text: string): string {
  let out = normalizeEmDash(text);
  out = out.replace(/ -- /g, ", ");
  out = out.replace(/(\S) - (\S)/g, "$1, $2");
  for (const [pattern, replacement] of VOICE_SWAPS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
