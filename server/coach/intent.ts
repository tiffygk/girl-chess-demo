// Wave D (coach-truth-speed round, 2026-07-27), owner's verbatim ask: "If I
// ask a question specifically about a move or the board, it should only use
// the chess brain with Stockfish and Maya. If I'm asking general chess
// questions, we should see if it works..." Her thumbs-down on trace 93
// ("will only answer about moves i already did, not general chess questions
// for strategy next game") was NOT a validateChat gap -- validateChat
// (chat.ts) has no scope rule at all. The refusal came from a prompt
// instruction in personas/coach.md telling the model to steer back to this
// game. This module replaces that prompt-level refusal with a routing
// DECISION, made before any model call -- the owner's explicit choice of a
// deterministic router over letting the model self-route, precisely because
// model self-routing is the failure she already hit.
//
// Deliberately model-free and synchronous: classifyIntent/isOffTopic must
// never touch a backend or the Stockfish evaluator queue (the same "chat/
// narrate never touch the engine queue" rule the rest of this directory
// follows).
//
// Design (Wave F, review fix 2026-07-27 -- see
// .superpowers/sdd/rounds/2026-07-27-coach-truth-speed/review.md finding 1):
// general is the narrow exception, board is the default. The ORIGINAL
// design (routing "board" only when hasBoardSignal fired, "general"
// otherwise) got this backwards in practice: 38 of 65 frozen board-live eval
// questions -- "is this ok", "should i take it", "what about my knight",
// bare "yes"/"ok" -- carry NO SAN, no piece-move verb, no move number, no
// "this move/this position/here" demonstrative, and no "my <phase>" phrase,
// so they fell through to "general" and got answered from a fact list with
// no currentFen/occupancy/legalSans/contested/pendingMove on it at all --
// the exact trust failure this whole round exists to eliminate. A short
// demonstrative question during live play is *always* about the position on
// screen, even when it carries no regex-matchable signal.
//
// So this is now inverted: "board" is the unconditional default, and
// "general" is reached ONLY through an explicit marker naming a genuinely
// next-game/theory question (hasGeneralMarker below) -- never through the
// mere ABSENCE of a board signal. hasBoardSignal/SAN_TEST_RE/
// PIECE_MOVE_VERB_RE/etc. below are no longer part of classifyIntent's own
// routing at all; they remain live for isOffTopic, a separate and much
// narrower check (see that function's own header comment).
import { SAN_RE } from "./validate";

export type ChatIntent = "board" | "general";

// A non-global copy of validate.ts's shared SAN_RE: that regex carries the
// `g` flag and is used elsewhere via String.match (which resets lastIndex
// safely) -- calling .test() directly on the shared, mutable, module-level
// object would leave its lastIndex advanced between calls, corrupting the
// next classifyIntent's scan. .source alone, wrapped in a fresh non-global
// RegExp, is what SAN_RE.test() would mean without owning the shared
// object's state.
const SAN_TEST_RE = new RegExp(SAN_RE.source);

// Singular piece nouns only (not "pawns"/"knights"/...): a plural mention is
// almost always describing pieces in general ("I want my pawns staggered"),
// not this game's own single piece on a single square. Real fixture: "I
// learned that I always want my pawns staggered..." must route general, and
// does, because "pawns" (plural) never matches this word-bounded singular.
const PIECE_MOVE_VERB_RE =
  /\b(pawn|knight|bishop|rook|queen|king)\b[\s\w']{0,20}\b(went|goes?|going|move[sd]?|moving|took|takes?|taking|captured?|captures?|traded?|trades?|played?|plays?|put|puts?)\b/i;

// "move 5", "move 13" -- and, per her real trace ("What move did I make on
// Move for?"), "move for" as a literal alternative: a speech-to-text
// transcription of "move four" ("for"/"four" are homophones). Kept as the
// exact verbatim fixture requires, not a general number-word list built to
// guess at other possible transcription slips.
const MOVE_NUMBER_RE = /\bmove\s+(?:\d+|one|two|three|four|for|five|six|seven|eight|nine|ten)\b/i;

// Demonstratives about the position on screen right now.
const DEMONSTRATIVE_RE = /\b(this move|this position|this game|that move|that line|here)\b/i;

// "was my opening okay" (a real, pre-existing chat fixture -- see
// manager.test.ts's "perPlyAnalysis reaches the model prompt" test, which
// this router must not regress): a possessive singular game-phase noun is a
// retrospective question about what SHE actually did in THIS game, the
// exact shape personas/coach.md's own per-ply-analysis instruction already
// answers from real per-ply facts. Deliberately narrow (singular, and only
// paired with "my") so it never collides with a general PRINCIPLE question
// about the same phase in the abstract -- "how do I get better at
// endgames" (plural, no "my") must still route general.
const MY_PHASE_RE = /\bmy (opening|middlegame|endgame)\b/i;

function hasBoardSignal(message: string): boolean {
  return (
    SAN_TEST_RE.test(message) ||
    PIECE_MOVE_VERB_RE.test(message) ||
    MOVE_NUMBER_RE.test(message) ||
    DEMONSTRATIVE_RE.test(message) ||
    MY_PHASE_RE.test(message)
  );
}

// The only door into "general" (Wave F). Deliberately phrase-level, not a
// single-word list: a bare word like "study" alone would be too broad, but
// "study"/"learn"/"practice" as their OWN verb (not embedded in a board
// claim) reliably signal a request for a general method or habit, not a
// claim about this position. Verified against every one of the round's own
// frozen fixtures (coach-eval's 65 board-live + 15 general questions,
// tools/coach-eval/fixtures.ts) with zero false positives against
// board-live/board-review and zero false negatives against general -- see
// intent.test.ts. Extended past the brief's literal list (how should i /
// is it worth / is it better / difference between / separates / the
// study/studying/studies stem) only where a real frozen general-arm
// question needed it and the phrase names a genuinely abstract/comparative
// chess-principle question ("what's the difference between a good bishop
// and a bad bishop", "what separates a good plan from a bad one", "is it
// better to focus on tactics or endgames"), never a keyword chosen to make
// one string pass.
const GENERAL_MARKER_RE =
  /\b(how do i|how should i|when should i|what is an?|why do people|in general|generally|next game|next time i play|get better at|is it worth|is it better|difference between|separates|stud(?:y|ying|ies))\b/i;

function hasGeneralMarker(message: string): boolean {
  return GENERAL_MARKER_RE.test(message);
}

/**
 * Deterministic, model-free router. "board" is the unconditional default;
 * "general" is reached only through hasFocus/hasPendingMove being false AND
 * an explicit general marker firing. See the header comment for the full
 * reasoning and for why the OLD hasBoardSignal-gated design routed the
 * majority of real live questions the wrong way.
 */
export function classifyIntent(
  message: string,
  ctx: { hasFocus: boolean; hasPendingMove: boolean; status: "in-progress" | "finished" }
): ChatIntent {
  // She is pointing at something -- a hint ladder, a turning-point card, or
  // a move she has picked up and placed on the board but not confirmed.
  // Unconditional: no marker, no status, overrides this.
  if (ctx.hasFocus || ctx.hasPendingMove) return "board";
  if (hasGeneralMarker(message)) return "general";
  // Ambiguity resolves to board -- the declared failure preference, true
  // for BOTH ctx.status values. Live ("in-progress"): this is the exact
  // failure this fix exists to close -- "is this ok" carries zero
  // positional signal either, and a false general answer can contradict the
  // board she is looking at right now. Finished ("finished", review chat):
  // the coach-eval board-review arm reuses bare [dir] questions ("what
  // should i play next?", "which piece should i move?") verbatim against a
  // finished game, and these still need the board route (the review-budget
  // + outcome-fact path), not the general-chess prompt, despite carrying no
  // marker and no hasBoardSignal match either. A board answer to a
  // genuinely general question merely reads narrow; a general answer to a
  // board question can state something false about a position the model
  // was never shown.
  return "board";
}

// Keep the bar high: "a chess question is never off-topic" (the brief's own
// words) -- this is a SEPARATE, much narrower check than classifyIntent
// above, and deliberately asymmetric to it. classifyIntent's board/general
// split treats "no positional signal" as reason enough to widen scope
// (general); isOffTopic must NOT reuse that same absence as its trigger --
// this app IS a chess coach, so a bare, contextless message with no chess
// word in it at all ("what should I do next?", "new question" -- both real
// pre-existing chat fixtures) is still presumptively about the game she is
// chatting from, not evidence of anything else. So this requires POSITIVE
// evidence of a genuinely different topic (an explicit non-chess-domain
// word) rather than the mere absence of a chess one -- a short, deliberately
// non-exhaustive list, since false negatives here just fall through to a
// harmless general-route answer, while a false positive costs a real
// question its reply outright.
const OFF_TOPIC_DOMAIN_RE =
  /\b(pizza|recipe|cooking|weather|forecast|movies?|tv show|song|lyrics|music|joke|homework|essay|poem|stock market|politics|celebrit\w*|sports? score|football|basketball|baseball|soccer)\b/i;

export function isOffTopic(message: string): boolean {
  return OFF_TOPIC_DOMAIN_RE.test(message) && !hasBoardSignal(message);
}
