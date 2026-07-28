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
// Design: general is the narrow exception, board is the default. Rather
// than curating a list of "general question" phrasings (fragile -- her real
// questions vary in wording far more than a keyword list could track), this
// routes "board" whenever the message carries ANY signal that it is about
// THIS game's actual position or moves, and falls through to "general" only
// when no such signal is found at all. That is the fail-safe direction the
// owner asked for: a false general answer can contradict the board (the
// trust failure this whole round exists to fix), a false board answer to a
// genuinely general question merely reads narrow. So "board" wins whenever
// there is ANY reason to think the message is about the position; the
// absence of every such signal is itself the evidence that lets "general"
// through.
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

/**
 * Deterministic, model-free router: "board" when the message references
 * this game's actual position/moves, or when she opened chat from a
 * specific on-screen moment (hasFocus -- "ask about this" on a hint or a
 * turning-point card); "general" otherwise. See the header comment for why
 * general is the narrow exception and board the fail-safe default.
 */
export function classifyIntent(message: string, hasFocus: boolean): ChatIntent {
  if (hasFocus) return "board";
  return hasBoardSignal(message) ? "board" : "general";
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
