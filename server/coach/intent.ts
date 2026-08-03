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
// mere ABSENCE of a board signal.
//
// Router-fix round (2026-08-03): hasBoardSignal is live in classifyIntent
// again, but ONLY as a tier-2 NEGATIVE gate -- its presence BLOCKS the
// second, narrower general door (ABSTRACT_THEORY_RE, below), it never
// TRIGGERS a route by itself. Tier 1 (hasGeneralMarker) is untouched and
// still the sole unconditional door; tier 2 fires only when a message
// carries BOTH a tier-2 marker AND zero board signal. The F1 inversion
// reasoning above (absence-of-signal must never widen scope) still governs:
// SAN_TEST_RE/PIECE_MOVE_VERB_RE/etc. remain live for isOffTopic too, a
// separate and much narrower check (see that function's own header
// comment).
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

// Router-fix round (2026-08-03): tier 2 of the general door. The round-3
// general-theory arm (tools/coach-eval/fixtures.ts, gt-01..gt-10, owner-
// verbatim) proved 5 of 10 natural theory questions carry NONE of
// GENERAL_MARKER_RE's phrases and mis-routed to board. Each alternative
// below is justified by one of those five and names a genuinely abstract
// question SHAPE -- never a keyword chosen to make one string pass (this
// file's own standing rule). Unlike tier 1, these fire ONLY when
// hasBoardSignal(message) is false (see classifyIntent): a message carrying
// a SAN, a piece-move phrase, a move number, a demonstrative, or "my
// <phase>" keeps the board route no matter what tier-2 phrase it also
// carries. That gate is what makes this widening safe against the
// check-wider-than-it-claims bug class.
const ABSTRACT_THEORY_RE = new RegExp(
  [
    // gt-06 "what's the idea behind parking a knight on an outpost?" --
    // the why-does-this-pattern-exist shape. The negative lookahead keeps
    // the deictic forms ("the idea behind this?") AND the possessive forms
    // on board: open-10, a real frozen board-live fixture, is "what is the
    // idea behind my opponent's setup?" -- a this-game question carrying NO
    // hasBoardSignal match, found by the planning-time corpus sweep, which
    // the bare marker would have swallowed. "behind that move" is board
    // twice over (lookahead + DEMONSTRATIVE_RE through the gate).
    String.raw`\bwhat(?:'s| is) the (?:idea|point|purpose) behind (?!(?:this|that|it|my|your|her|his|their)\b)`,
    // gt-09 "what does it mean to play for the initiative..." -- the
    // definitional what-does-it-mean-to-<concept> shape.
    String.raw`\bwhat does it mean to\b`,
    // gt-08 "what are the key principles for a king-and-pawn endgame?" --
    // TIGHTENED (router-fix round, 2026-08-03; final-whole-branch-review
    // finding, see
    // .superpowers/sdd/rounds/2026-08-03-round3/brief-router-fix-review.md).
    // The bare word alone is NOT a reliable theory signal: "is this a good
    // principle to follow?" and "is my knight on a good principle?" carry it
    // too, and neither is caught by hasBoardSignal -- DEMONSTRATIVE_RE only
    // matches the literal phrases "this move/this position/.../here", never
    // a bare "this"/"it", and MY_PHASE_RE only matches a possessive GAME
    // PHASE ("my opening"), not a possessive piece ("my knight"). The old
    // promise (this comment used to claim a live "this position" pairing
    // "is board via the gate's demonstrative check") was therefore false for
    // every bare-deictic/concrete-piece phrasing, which is exactly what the
    // review caught. Now requires one of three explicit abstract FRAMES
    // instead of the bare word: a phase/scope adjective directly before it
    // ("opening/middlegame/endgame/general/key principles"), a
    // "principles for/of <topic>" complement (guarded against a deictic
    // complement the same way the idea/point/purpose alternative above is),
    // or the literal question-opener "what are the (key) principles". None
    // of the three mis-routed board strings carries any of these frames, so
    // they now fall through this door to the file's own
    // ambiguity-resolves-to-board default (classifyIntent's final return);
    // gt-08 carries two of the three ("key principles" and "principles
    // for") and keeps firing.
    String.raw`\bwhat are the (?:key )?principles\b`,
    String.raw`\b(?:opening|middlegame|endgame|general|key)\s+principles?\b`,
    String.raw`\bprinciples?\s+(?:for|of)\s+(?!(?:this|that|it|my|your|her|his|their)\b)`,
    // gt-01 "what's another opening that would work well from a setup like
    // mine?" -- asking for a DIFFERENT opening than the one played is
    // inherently a next-game question. Deliberately NOT the bare plural
    // "openings": gt-10's own text uses "openings for attacks" in the
    // gaps-in-a-position sense, so the plural collides with a live meaning.
    String.raw`\banother opening\b`,
    // gt-02 "...what should i actually be trying to do in the opening?" --
    // goals-in-a-phase-in-the-abstract. The generic article is the theory
    // signal; the possessive form ("my opening") is a board signal via
    // MY_PHASE_RE and wins through the gate. A phase-less "what should i be
    // trying to do" stays board -- ambiguity resolves to board, unchanged.
    String.raw`\btrying to do in the (?:opening|middlegame|endgame)\b`,
    // gt-07 "as a rule, when should i trade queens..." (already tier-1 via
    // "when should i") -- the explicit rule-request frame, kept because it
    // is the single most literal way she asks for theory.
    String.raw`\bas a rule\b`,
  ].join("|"),
  "i"
);

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
  // Tier 2 (router-fix round, 2026-08-03): abstract-theory phrasings, gated
  // on the ABSENCE of any positive board signal so the widened door cannot
  // swallow a real board question. See ABSTRACT_THEORY_RE's comment.
  if (ABSTRACT_THEORY_RE.test(message) && !hasBoardSignal(message)) return "general";
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

// Wave 4, item 3 (2026-08-01, game-164): a conservative detector for an
// explicit request to remember something across games -- the trigger for the
// coach_notes write path (see server/game/manager.ts's chat()). Model-free and
// synchronous, the same discipline classifyIntent/isOffTopic follow.
//
// The family is exactly the four the brief names: "record this", "mark this",
// "please record", and "remember this". The first three are imperative and
// almost never appear in a non-request sentence. "remember this" is the one
// that false-fires -- "I don't remember this opening" contains it as a
// substring -- so that branch alone carries a preceding-negation guard
// (variable-length lookbehind, supported in Node's V8): it matches "remember
// this" only when NOT immediately preceded by a negation word + space. Recall
// over precision would cost a real question a spurious "noted" line and a note
// the player never asked for, so precision wins here, the same as every other
// checker in this directory.
// Round 2, item 8 (owner ruling, 2026-08-01 playtest): "she asked twice for
// a note in her playtest and got nothing" -- her real phrasing, "let's make
// a note of this for analysis later", matched none of the original four
// (record this / mark this / please record / remember this). Extends the
// family to the note-taking phrasings the ruling names: make a note, take a
// note, note this, jot this/that down, write this/that down, add a note.
// Same precedence-of-precision philosophy as the original four (a false
// negative just falls through to a normal reply; a false positive costs a
// real question a spurious "noted" line): a negated form ("don't make a
// note of this") or a retrospective QUESTION about whether a note already
// exists ("did you make a note of that?") must not fire.
//
// The two guards are named fragments, not hand-copied into every
// alternative, so the list can't silently drift out of sync with itself.
const NOTE_NEGATION_GUARD =
  String.raw`(?<!\b(?:don't|do not|didn't|doesn't|cannot|can't|not|never|won't|wouldn't|haven't|hasn't)\s)`;
// "did/have/has/does <1-4 words> ___" immediately before the phrase --
// catches "did you make a note", "have you noted this", "does the coach
// note this automatically" style retrospective checks about a note that
// may already exist, as distinct from a fresh imperative request. The
// bounded {0,3} lets the subject be more than one word ("the coach") without
// letting the lookbehind run unbounded.
const NOTE_QUESTION_GUARD = String.raw`(?<!\b(?:did|have|has|does)\s+\w+(?:\s+\w+){0,3}\s)`;

const RECORD_REQUEST_RE = new RegExp(
  [
    String.raw`please\s+record\b`,
    String.raw`\brecord this\b`,
    String.raw`\bmark this\b`,
    NOTE_NEGATION_GUARD + String.raw`\bremember this\b`,
    NOTE_NEGATION_GUARD + NOTE_QUESTION_GUARD + String.raw`\bmake a note\b`,
    NOTE_NEGATION_GUARD + NOTE_QUESTION_GUARD + String.raw`\btake a note\b`,
    NOTE_NEGATION_GUARD + NOTE_QUESTION_GUARD + String.raw`\bnote this\b`,
    NOTE_NEGATION_GUARD + String.raw`\bjot (?:this|that) down\b`,
    NOTE_NEGATION_GUARD + String.raw`\bwrite (?:this|that) down\b`,
    NOTE_NEGATION_GUARD + NOTE_QUESTION_GUARD + String.raw`\badd a note\b`,
  ].join("|"),
  "i"
);

export function isRecordRequest(message: string): boolean {
  return RECORD_REQUEST_RE.test(message);
}

// Forward-prediction round (2026-07-28): when the player names a specific
// move or ply, that moment gets full per-ply detail (pvSans + then) for
// this one turn -- deterministic promotion, decided here from the message
// text alone, never by the model. Grounded in the real game-150 thread:
// she asked "what should i have done on move 28" and the collapsed
// projection had no line to give. "move N" is read BOTH as move N (plies
// 2N-1 and 2N) and as a bare ply N -- her own thread shows the two getting
// mixed ("ply 54 is move 27", then she says "move 54"), and the double
// reading costs a few promoted plies only on turns that name a number.
// Word numbers mirror MOVE_NUMBER_RE above, including the "for"/"four"
// speech-to-text homophone that regex already documents.
const MENTION_WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, for: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const MOVE_MENTION_RE = /\bmove\s+(\d+|one|two|three|four|for|five|six|seven|eight|nine|ten)\b/gi;
const PLY_MENTION_RE = /\bply\s+(\d+)\b/gi;
// Owner-calibratable: hard cap on promoted plies per turn, so a message
// listing many numbers cannot re-inflate the prompt past the slimming win.
const MENTIONED_PLY_MAX = 12;

export function mentionedPlies(message: string, maxPly: number): number[] {
  const plies = new Set<number>();
  const add = (p: number) => {
    if (p >= 1 && p <= maxPly && plies.size < MENTIONED_PLY_MAX) plies.add(p);
  };
  for (const m of message.matchAll(MOVE_MENTION_RE)) {
    const raw = m[1].toLowerCase();
    const n = MENTION_WORD_NUMBERS[raw] ?? parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) continue;
    add(2 * n - 1);
    add(2 * n);
    add(n);
  }
  for (const m of message.matchAll(PLY_MENTION_RE)) {
    add(parseInt(m[1], 10));
  }
  return [...plies];
}
