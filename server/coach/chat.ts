import { Chess } from "chess.js";
import type { ThreatFacts, RecommendationFacts } from "../annotator/motifs";
import type { CoachBackend } from "./backends/types";
import { getPersona, type NarrateTraceContext } from "./index";
import { SAN_RE, isAllowedSanToken } from "./validate";
import { checkDefenseClaims } from "./defenseClaims";
import { checkPlacementClaims } from "./placementClaims";
import { insertAdviceTrace } from "../store/db";

// F16 (this-game grounding chat): a second, independent narration surface
// alongside narrate() in ./index.ts. Same shape (persona prompt + fact JSON
// -> backend.generate -> validate -> one corrective regen -> deterministic
// template fallback -> exactly one advice_traces row) but grounds against
// the WHOLE GAME (every san played, the current position, every legal move
// from here, turning points when finished) rather than a single judged
// move's fact list -- narrate()'s CoachFactList is deliberately left
// untouched; chat gets its own ChatFactList so a change to one surface's
// shape can never silently break the other.
export const CHAT_HISTORY_WINDOW = 8; // messages (4 exchanges), owner-calibratable
// Owner-calibratable. Raised 20000 -> 30000 on 2026-07-22 from her own
// advice_traces, not a guess: plain asks answer in 4.6-5.1s, but the
// focused "ask about this" turns carry a much larger prompt and her two
// hardest questions (traces 57/58) burned the full 20s and served a
// template instead of an answer. Chat lives in the coach's corner and
// provably does not block play (that is what moving it out of the centre
// modal bought), so waiting longer for a real answer beats a fast
// non-answer -- and the "slow" chip tells her which one she is getting.
// narrate()'s own budget is deliberately NOT raised with it: that surface
// speaks unprompted while she plays, where a late reply is worse than none.
export const CHAT_TIMEOUT_MS = 30000;
export const CHAT_MAX_LEN = 500;

export interface ChatContext {
  mode: "live" | "review";
  herMove?: { pieceKind: string; from: string; to: string };
  tier?: "nudge" | "warning";
  threat?: ThreatFacts;
  best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
  recommendation?: RecommendationFacts;
  // Task 7 (increment 3.95, "ask about this"): the two per-moment focus
  // fields. GamePage sets at most one of these per message -- hintFocus when
  // the player opened chat from the open hint ladder, turningPointFocus when
  // they opened it from a debrief turning-point card -- so the coach's reply
  // can ground itself in THAT moment instead of the whole game/position.
  hintFocus?: { level: number; text: string };
  turningPointFocus?: {
    ply: number;
    san: string;
    label: string;
    punishSan?: string;
    // bestSan/pvSans: the card's own TurningLine (server/game/manager.ts's
    // getTurningLines), threaded through so assembleChatFactList below can
    // fold them into allowedSans -- see that fold's comment for why this is
    // the one piece that actually changes what the coach is allowed to say.
    bestSan?: string;
    pvSans?: string[];
  };
}

export interface ChatFactList {
  gameSans: string[]; // every san played, in order
  currentFen: string; // final position (review) / live position (live)
  // Side-to-move fact (round 2026-07-22): without this, the coach once
  // attributed the PLAYER's own pending move to mallow, because nothing in
  // the fact list stated whose turn it is -- the model was left to infer
  // perspective from the FEN's side-to-move field, and legalSans is an
  // unlabeled bare list (see below). Derived from chess.turn() at the same
  // place currentFen is derived: "w" -> "you", "b" -> "mallow" -- the same
  // fixed "player is always white in v1" mapping occupancy already uses.
  toMove: "you" | "mallow";
  occupancy: { square: string; pieceKind: string; color: "you" | "mallow" }[]; // from currentFen
  legalSans: string[]; // chess.js .moves() on currentFen
  turningPoints?: { ply: number; san: string; label: string; punishSan?: string }[];
  context?: ChatContext; // live coach facts when present
  allowedSans: string[]; // gameSans + legalSans + context sans + turning-point sans/punishSans
  // Task 2 (defender grounding): every occupied square currently attacked
  // by the OPPOSING side, with who attacks it and who could recapture --
  // computed from currentFen via chess.js's own attackers(), no engine
  // call. Lets the coach answer "is my piece safe / is X defended" from a
  // fact instead of reasoning about defense itself, which is how it once
  // told a player white's e4 pawn "doesn't guard f5" when it demonstrably
  // does (Bxf5 exf5). A piece not attacked by the opponent is omitted --
  // keeps the list small and focused on what's actually under fire.
  contested: {
    square: string;
    pieceKind: string;
    color: "you" | "mallow"; // same mapping as occupancy: w -> "you", b -> "mallow"
    attackedBy: { square: string; pieceKind: string }[]; // opposing-color attackers
    defendedBy: { square: string; pieceKind: string }[]; // same-color defenders (could recapture)
  }[];
  // Round 2026-07-22: when the player asks about a specific turning point,
  // the conversation is about a PAST moment, but every field above describes
  // the position TODAY. The e2e gate caught the coach placing mallow's queen
  // on a5 (true now) while discussing a pivot where it still sat on d8, and
  // calling dxc6 "wins a pawn clean" while ignoring the bxc6 recapture that
  // existed at that moment. focusPosition carries the position just BEFORE
  // the focused move -- the one she was actually choosing in, and the one
  // the card's bestSan/pvSans are legal in -- derived by the same replay
  // discipline as currentFen, never hand-computed. Absent when no turning
  // point is focused, so ordinary chat is untouched.
  focusPosition?: {
    ply: number; // the focused move's ply; this position is the one BEFORE it
    fen: string;
    toMove: "you" | "mallow";
    occupancy: { square: string; pieceKind: string; color: "you" | "mallow" }[];
    legalSans: string[];
    contested: ChatFactList["contested"];
  };
  // NOTE: no allowedSquares -- chat validation treats square names as free
  // geography (see validateChat below). Declared cut #2, not an oversight:
  // policing whether a named square is real/relevant would require the
  // fact list to also carry per-square provenance, which nothing upstream
  // computes today. See validateChat's comment and chat.test.ts's cut #2
  // test for the honesty documentation this decision requires.
}

// Every position-shaped fact the coach gets, derived from one chess.js
// instance. Extracted 2026-07-22 so the focused turning point's position can
// be described by the SAME code as the current one -- two call sites, one
// derivation, no chance of the two drifting apart.
function derivePositionFacts(chess: Chess): {
  fen: string;
  toMove: "you" | "mallow";
  occupancy: ChatFactList["occupancy"];
  legalSans: string[];
  contested: ChatFactList["contested"];
} {
  // Player is always white in v1 (see manager.ts's resign() comment) -- so
  // white pieces are always "you" and black is always "mallow", a fixed
  // mapping, not a lookup. toMove follows the exact same fixed mapping.
  const toMove: "you" | "mallow" = chess.turn() === "w" ? "you" : "mallow";
  const occupancy: ChatFactList["occupancy"] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
    }
  }

  const contested: ChatFactList["contested"] = [];
  for (const entry of occupancy) {
    const cell = chess.get(entry.square as Parameters<typeof chess.get>[0]);
    if (!cell) continue;
    const oppColor = cell.color === "w" ? "b" : "w";
    const attackerSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], oppColor);
    if (attackerSquares.length === 0) continue;
    // Geometric only (same-color attackers()), NOT a legal-recapture
    // guarantee -- a piece pinned to its own king can appear here even
    // though it cannot actually recapture (see motifs.ts's
    // capturedSquareDefended for the legal-recapture-checked version).
    const defenderSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], cell.color);
    const toPiece = (sq: string) => {
      const p = chess.get(sq as Parameters<typeof chess.get>[0]);
      return { square: sq, pieceKind: p ? p.type : "" };
    };
    contested.push({
      square: entry.square,
      pieceKind: entry.pieceKind,
      color: entry.color,
      attackedBy: attackerSquares.map(toPiece),
      defendedBy: defenderSquares.map(toPiece),
    });
  }

  return { fen: chess.fen(), toMove, occupancy, legalSans: chess.moves(), contested };
}

// Pure: replays gameSans from the start position with chess.js so
// currentFen/occupancy/legalSans are all DERIVED, never hand-computed --
// castling rights, en passant, and promotion are exactly whatever the
// replay says they are, the same discipline motifs.ts's threat/recommendation
// derivation already follows for a single move.
export function assembleChatFactList(
  gameMoves: { ply: number; san: string }[],
  ctx: ChatContext,
  turningPoints?: { ply: number; san: string; label: string; punishSan?: string | null }[]
): ChatFactList {
  const chess = new Chess();
  const ordered = [...gameMoves].sort((a, b) => a.ply - b.ply);
  const gameSans: string[] = [];
  for (const m of ordered) {
    const mv = chess.move(m.san);
    gameSans.push(mv.san);
  }

  const { fen: currentFen, toMove, occupancy, legalSans, contested } = derivePositionFacts(chess);

  // Round 2026-07-22: the focused turning point's own moment. Replayed from
  // the same ordered move list, stopping BEFORE the focused ply, so it is
  // derived by exactly the discipline currentFen is (never hand-computed,
  // never patched up from the current position).
  const focusPly = ctx.turningPointFocus?.ply;
  let focusPosition: ChatFactList["focusPosition"];
  if (focusPly !== undefined) {
    const focusChess = new Chess();
    for (const m of ordered) {
      if (m.ply >= focusPly) break;
      focusChess.move(m.san);
    }
    focusPosition = { ply: focusPly, ...derivePositionFacts(focusChess) };
  }

  const tpOut = turningPoints?.map((t) => ({
    ply: t.ply,
    san: t.san,
    label: t.label,
    punishSan: t.punishSan ?? undefined,
  }));

  const sans = new Set<string>(gameSans);
  for (const s of legalSans) sans.add(s);
  if (ctx.threat?.refutationSan) sans.add(ctx.threat.refutationSan);
  if (ctx.best?.san) sans.add(ctx.best.san);
  if (ctx.recommendation?.san) sans.add(ctx.recommendation.san);
  for (const t of tpOut ?? []) {
    sans.add(t.san);
    if (t.punishSan) sans.add(t.punishSan);
  }
  // Task 7 fold: the turningPoints list above only ever carries a turning
  // point's OWN san/punishSan (the debrief's persisted facts) -- never the
  // best line, so a player asking "what should you have played instead" at
  // a focused card would previously get a redirect even though the card
  // itself displays that exact line (GamePage's turningLines fetch). Folding
  // ctx.turningPointFocus's bestSan + pvSans in here is the one change that
  // lets the coach legally NAME it. Geography-free-squares + strict-SAN
  // validation in validateChat below is untouched by this fold.
  if (ctx.turningPointFocus?.bestSan) sans.add(ctx.turningPointFocus.bestSan);
  for (const s of ctx.turningPointFocus?.pvSans ?? []) sans.add(s);
  // Round 2026-07-22: moves that were legal AT the focused moment. Without
  // these, a coach correctly discussing what she could have played back
  // then gets its own true sentence rejected, because those moves are not
  // legal today. Same fold, same reason, as the bestSan/pvSans fold above.
  for (const s of focusPosition?.legalSans ?? []) sans.add(s);

  return {
    gameSans,
    currentFen,
    toMove,
    occupancy,
    legalSans,
    focusPosition,
    turningPoints: tpOut,
    context: ctx,
    allowedSans: [...sans],
    contested,
  };
}

// F16 geography-free policy: a token that is EXACTLY a square name (e.g.
// "f1") is always allowed, full stop -- verifying whether a named square is
// a "real" one from this position would need the fact list to carry
// per-square provenance, which nothing upstream computes. SAN-like tokens
// (piece letter, capture, promotion, castling) still have to be a move that
// was actually played, is legally available from the current position, or
// appears in the live context/turning-point facts.
function isBareSquare(token: string): boolean {
  return /^[a-h][1-8]$/.test(token);
}

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,!?;:'"]+$/, "");
}

// ---- defender-claim validation --------------------------------------------
// Task 3 (2026-07-22, truthfulness leaks): extracted unchanged into
// ./defenseClaims.ts, so server/coach/validate.ts's validateNarration can
// share the exact same checker on the narrate() path (the coach's-corner
// narration surface had nothing checking its own defense claims at all --
// see that file's header comment for the live example this closes).

// ---- side-attribution claim validation ------------------------------------
// The coach once attributed the PLAYER's own pending move to mallow ("you
// win her queen for free" about the player's own Qh5) -- toMove and
// legalSansBelongTo (ChatFactList/factsForModel above) give the model the
// fact, but nothing previously checked the model's OWN prose against it.
// Modeled directly on checkDefenseClaims above: one narrow claim shape, chess
// facts already in hand (no engine call), routed into the same violations
// array. The claim shape: a SAN token explicitly attributed to a named side
// via a fixed, small verb list, in the four fixed subject forms "mallow/she
// /you/your <verb> <SAN>". Ownership is only adjudicated against legalSans
// (the CURRENT toMove side's moves) -- gameSans don't carry a per-san side
// label, so a token that isn't a legal move right now is left unflagged
// rather than guessed at.
//
// Three exclusions, added after a controller review caught each one flagging
// a truthful sentence (2026-07-22):
//   1. Present tense only. "played"/"moved"/"took" almost always describe a
//      move already made, which legalSans (the CURRENT side's OPTIONS) has
//      no opinion about -- "mallow played Nf3" can be a true description of
//      an earlier move even when Nf3 is also legal for the player right now.
//      Only present-tense verbs are adjudicated; the observed live bug was
//      present-tense attribution of a PENDING move, so nothing real is lost.
//   2. Castling is never adjudicated. O-O/O-O-O is the identical token for
//      both colors, so legalSans membership alone can never tell whose
//      castling a mention refers to.
//   3. Conditional/hypothetical lines are skipped. The coach reasons in
//      lines constantly ("if you play Nf3, she takes e5") -- a conditional
//      marker earlier in the same sentence (captured via a bounded filler
//      group and tested with a regex, the same idiom guardClaimRe/
//      GUARD_NEGATION_RE already use for their "between" capture, not a
//      sentence-splitting layer) means the named side is inside a
//      hypothetical, not a literal claim about the current position.
// Precision over recall, same as the guard/safety checker: a verb outside
// the fixed list, a pronoun ("her"/"him"), or a second clause naming the
// other side is never chased -- a missed attribution costs nothing, a false
// positive costs a real reply.
const SIDE_ATTR_SUBJECTS = "mallow|she|you|your";
const SIDE_ATTR_VERBS = "plays the|plays as|plays|moves|takes"; // present tense only -- exclusion 1
const SAN_TOKEN_SRC = "(?:O-O(?:-O)?|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?)";
const SIDE_ATTR_CONDITIONAL_RE = /\b(if|unless|suppose|say|imagine|were you to|what if)\b/i;

function sideAttributionRe(): RegExp {
  // group 1: up to 40 chars of same-sentence filler BEFORE the subject
  // (bounded by excluding sentence-ending punctuation from the class, so a
  // match can never reach back across a prior sentence) -- checked for a
  // conditional marker, exclusion 3. group 2: the subject (mallow/she/you/
  // your), group 3: the SAN token immediately following the verb -- no
  // filler allowed between subject, verb, and token, so this never crosses
  // into a second clause.
  return new RegExp(
    `([^.!?]{0,40})\\b(${SIDE_ATTR_SUBJECTS})\\b\\s+(?:${SIDE_ATTR_VERBS})\\s+(${SAN_TOKEN_SRC})\\b`,
    "gi"
  );
}

function checkSideAttributionClaims(text: string, facts: ChatFactList): string[] {
  const violations: string[] = [];
  const legalSans = new Set(facts.legalSans);

  for (const m of text.matchAll(sideAttributionRe())) {
    const [, before, subjectRaw, sanRaw] = m;
    if (SIDE_ATTR_CONDITIONAL_RE.test(before)) continue; // hypothetical line -- exclusion 3
    const subject = subjectRaw.toLowerCase();
    const claimedSide: "you" | "mallow" = subject === "mallow" || subject === "she" ? "mallow" : "you";
    if (claimedSide === facts.toMove) continue; // correctly attributed
    const token = stripTrailingPunctuation(sanRaw);
    if (/^O-O(-O)?$/i.test(token)) continue; // castling is ambiguous between colors -- exclusion 2
    if (!isAllowedSanToken(token, legalSans)) continue; // not toMove's legal move right now -- can't adjudicate
    violations.push(`side-claim: ${token} is ${facts.toMove}'s move to play, not ${claimedSide}'s`);
  }

  return violations;
}

export function validateChat(text: string, facts: ChatFactList): { ok: true } | { ok: false; violations: string[] } {
  const allowedSans = new Set(facts.allowedSans);
  const violations: string[] = [];

  for (const raw of text.match(SAN_RE) ?? []) {
    const token = stripTrailingPunctuation(raw);
    if (isBareSquare(token)) continue; // geography, always allowed -- cut #2
    if (!isAllowedSanToken(token, allowedSans)) violations.push(token);
  }

  // Round 2026-07-22: a focused turn is ABOUT a past moment, so a defense
  // claim true back then is not a lie now. Judge against both positions and
  // keep only what is false in BOTH -- a claim the checker flags in one
  // position but not the other is one the conversation's own moment
  // vindicates, and flagging it would cost a truthful reply a regen (and
  // possibly a template). The two runs produce identical strings when both
  // flag, because the message states the truth the claim contradicts and
  // the claim is fixed, so a plain intersection is exact here.
  const currentDefense = checkDefenseClaims(text, facts.currentFen);
  if (facts.focusPosition) {
    const focusDefense = new Set(checkDefenseClaims(text, facts.focusPosition.fen));
    violations.push(...currentDefense.filter((v) => focusDefense.has(v)));
  } else {
    violations.push(...currentDefense);
  }
  violations.push(...checkSideAttributionClaims(text, facts));
  // Task 1 (R3, 2026-07-22 fact-gap round): the placement-claim check takes
  // both occupancy lists itself and applies the same both-positions
  // intersection internally (see checkPlacementClaims's own comment) --
  // unlike checkDefenseClaims above, there's no separate current/focus call
  // + filter needed here.
  violations.push(...checkPlacementClaims(text, facts.occupancy, facts.focusPosition?.occupancy));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}

// ---- prompt assembly ------------------------------------------------------

function stripThreatUci(t: ThreatFacts): Omit<ThreatFacts, "refutationUci"> {
  const { refutationUci, ...rest } = t;
  return rest;
}

// The fact JSON serialized into the chat prompt carries NO uci fields --
// san is all a model (or a player) ever needs; uci is an internal engine
// detail. context.best.uci and context.threat.refutationUci are the only
// two places one could leak in, so those are the only fields stripped here.
// Owner playtest 2026-07-22: the focused fact list added ~2.2k characters
// to exactly the turns that were already the slowest, and her next two
// focused asks both hit the hard 20s timeout (traces 57/58, prompts 9.7k
// and 9.9k, against 4.6-5.1s answers at 7.5k). occupancy was 1521 of the
// 1976 added characters, and almost all of it is redundant: most pieces
// stood on the same squares then as now, and the model already has the
// current occupancy. So the model is sent only the squares that DIFFER,
// which is precisely the error this round fixed (mallow's queen described
// on a5 when it stood on d8). The full focus position stays on the fact
// list for validation, which needs the exact position, not a summary.
function focusForModel(facts: ChatFactList) {
  const focus = facts.focusPosition;
  if (!focus) return undefined;
  const key = (o: { square: string; pieceKind: string; color: string }) =>
    `${o.square}:${o.pieceKind}:${o.color}`;
  const nowKeys = new Set(facts.occupancy.map(key));
  const thenKeys = new Set(focus.occupancy.map(key));
  return {
    ply: focus.ply,
    fen: focus.fen,
    toMove: focus.toMove,
    contested: focus.contested,
    // Everything not listed here stood where it stands now.
    stoodHereThenButNotNow: focus.occupancy.filter((o) => !nowKeys.has(key(o))),
    standHereNowButNotThen: facts.occupancy.filter((o) => !thenKeys.has(key(o))),
  };
}

function factsForModel(facts: ChatFactList) {
  const { allowedSans, context, focusPosition, ...rest } = facts;
  let strippedContext: Record<string, unknown> | undefined;
  if (context) {
    const { best, threat, herMove, ...restCtx } = context;
    strippedContext = {
      ...restCtx,
      // The model-facing key is yourMove (the player is always "you"), even
      // though the internal ChatContext field stays named herMove.
      yourMove: herMove,
      threat: threat ? stripThreatUci(threat) : undefined,
      best: best ? { san: best.san, pieceKind: best.pieceKind, from: best.from, to: best.to } : undefined,
    };
  }
  // legalSansBelongTo labels the bare legalSans list with whose moves it
  // holds -- always equal to facts.toMove, kept as a separate key (rather
  // than renaming legalSans itself) so the model gets the label sitting
  // right next to the list without validateChat/allowedSans needing to
  // change shape.
  return {
    ...rest,
    legalSansBelongTo: facts.toMove,
    focusPosition: focusForModel(facts),
    context: strippedContext,
  };
}

function formatHistory(history: { role: "user" | "coach"; text: string }[]): string {
  if (history.length === 0) return "";
  const lines = history.map((h) => `${h.role === "user" ? "player" : "coach"}: ${h.text}`);
  return ["", "conversation so far:", ...lines].join("\n");
}

function buildChatPrompt(
  facts: ChatFactList,
  history: { role: "user" | "coach"; text: string }[],
  userMessage: string,
  persona: ReturnType<typeof getPersona>
): string {
  return [
    persona.chatSystemPrompt,
    "",
    "fact list (json):",
    JSON.stringify(factsForModel(facts), null, 2),
    formatHistory(history),
    "",
    `player: ${userMessage}`,
  ].join("\n");
}

function correctiveSuffix(violations: string[]): string {
  return [
    "",
    "",
    `your previous answer mentioned ${violations.join(", ")}, which isn't a move from this game.`,
    "rewrite it using only moves from this game's fact list, 2-4 short lowercase sentences, no lists, no em-dashes, no emojis.",
  ].join("\n");
}

// ---- chat loop (F16) -------------------------------------------------------

// Flow: persona "## chat" system prompt + fact JSON (no uci) + last
// CHAT_HISTORY_WINDOW messages + the player's message -> generate() ->
// validateChat -> on violation (including empty output), ONE corrective
// regeneration -> on second violation or backend error/timeout, the
// persona's "- redirect:" template. Never throws; always returns text.
// Writes exactly one advice_traces row (kind "chat") per call that reaches
// this function -- i.e. per call that passes GameManager.chat's CHAT_MAX_LEN
// gate; over-length messages are rejected before chat() is ever called, so
// they write no trace row at all (see manager.ts's chat() method, the sole
// caller). history is caller-supplied (the server, never the client) so
// this function itself has no opinion about where history comes from beyond
// using it verbatim.
// Task 2 (2026-07-22, truthfulness leaks): a rejection whose message
// indicates the backend just ran out of time is a different fact from the
// backend actually being down -- the gate measured hard timeouts rendering
// the "offline" chip while other asks in the very same session answered in
// 4-5s. All three backends' timeout paths format their own error text
// through the literal words "timed out" (claude-cli.ts's formatTimeoutError,
// agent-sdk.ts's generate()/probe rejects, ollama.ts's probe reject) --
// detect on that substring rather than adding a typed error class, so this
// stays a one-line classification with no backend-side changes.
function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes("timed out");
}

export async function chat(
  userMessage: string,
  history: { role: "user" | "coach"; text: string }[],
  facts: ChatFactList,
  backend: CoachBackend,
  trace: NarrateTraceContext
): Promise<{
  text: string;
  source: "model" | "template";
  cause?: "backend-down" | "timeout";
  traceId: number;
}> {
  const start = Date.now();
  const persona = getPersona();
  const basePrompt = buildChatPrompt(facts, history, userMessage, persona);

  let attemptPrompt = basePrompt;
  let attemptOutput = "";
  let regenCount = 0;
  let modelText: string | null = null;
  let failureCause: "backend-down" | "timeout" | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      attemptOutput = await backend.generate(attemptPrompt, CHAT_TIMEOUT_MS);
    } catch (err) {
      // Backend error/timeout at any attempt short-circuits straight to the
      // redirect template below -- never worth a second network/process
      // call, mirrors narrate()'s discipline exactly.
      attemptOutput = `[backend error] ${err instanceof Error ? err.message : String(err)}`;
      failureCause = isTimeoutError(err) ? "timeout" : "backend-down";
      break;
    }

    const trimmed = attemptOutput.trim();
    const result = trimmed.length > 0 ? validateChat(attemptOutput, facts) : ({ ok: false, violations: [] } as const);
    if (result.ok) {
      modelText = trimmed;
      break;
    }
    if (attempt === 0) {
      regenCount = 1;
      const violations = "violations" in result && result.violations.length > 0 ? result.violations : ["the previous answer"];
      attemptPrompt = basePrompt + correctiveSuffix(violations);
    }
  }

  const source: "model" | "template" = modelText !== null ? "model" : "template";
  // Owner playtest 2026-07-22: a timed-out reply was served the REDIRECT
  // template ("keep it on the board. ask me about a move from this game"),
  // which tells the player her perfectly on-topic question was off topic.
  // The three failure modes are different apologies: a slow answer is ours
  // to own, a down backend is a capability statement, and only a genuine
  // off-topic ask deserves the redirect. Persona-overridable (add `slow:`
  // / `down:` under the chat templates in coach.md) with an honest default
  // here so the fallback never lies about why it fired.
  const failureTemplate =
    failureCause === "timeout"
      ? persona.chatTemplates.slow ??
        "that one took me longer than i had. ask me again and i'll get you an answer."
      : failureCause === "backend-down"
        ? persona.chatTemplates.down ??
          "i can't reach my thinking right now. try me again in a moment."
        : persona.chatTemplates.redirect ??
          "keep it on the board. ask me about a move from this game and i'll break it down.";
  const text = modelText ?? failureTemplate;
  const latencyMs = Date.now() - start;

  // kind is always literally "chat" for this surface -- not caller
  // configurable via trace.kind, even though NarrateTraceContext's shape
  // carries that field for narrate()'s sake (nudge/warning).
  const traceId = insertAdviceTrace({
    gameId: trace.gameId,
    ply: trace.ply,
    kind: "chat",
    // Full facts, uci fields included -- intentional, not a leak: this is
    // F40 Lab trace data for the owner, not the model prompt. Only
    // factsForModel's stripped copy (built above, no uci) ever reaches the
    // backend; this is the one JSON.stringify(facts) in the whole function.
    factsJson: JSON.stringify(facts),
    prompt: attemptPrompt,
    output: attemptOutput,
    source,
    backend: backend.name,
    validated: source === "model",
    regenCount,
    latencyMs,
  });

  return failureCause ? { text, source, cause: failureCause, traceId } : { text, source, traceId };
}
