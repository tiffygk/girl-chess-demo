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
