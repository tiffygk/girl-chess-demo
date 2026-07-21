import { Chess } from "chess.js";
import type { ThreatFacts, RecommendationFacts } from "../annotator/motifs";
import type { CoachBackend } from "./backends/types";
import { getPersona, type NarrateTraceContext } from "./index";
import { SAN_RE, isAllowedSanToken } from "./validate";
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
export const CHAT_TIMEOUT_MS = 20000; // owner-calibratable
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
  occupancy: { square: string; pieceKind: string; color: "you" | "mallow" }[]; // from currentFen
  legalSans: string[]; // chess.js .moves() on currentFen
  turningPoints?: { ply: number; san: string; label: string; punishSan?: string }[];
  context?: ChatContext; // live coach facts when present
  allowedSans: string[]; // gameSans + legalSans + context sans + turning-point sans/punishSans
  // NOTE: no allowedSquares -- chat validation treats square names as free
  // geography (see validateChat below). Declared cut #2, not an oversight:
  // policing whether a named square is real/relevant would require the
  // fact list to also carry per-square provenance, which nothing upstream
  // computes today. See validateChat's comment and chat.test.ts's cut #2
  // test for the honesty documentation this decision requires.
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

  const currentFen = chess.fen();
  // Player is always white in v1 (see manager.ts's resign() comment) -- so
  // white pieces are always "you" and black is always "mallow", a fixed
  // mapping, not a lookup.
  const occupancy: ChatFactList["occupancy"] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
    }
  }
  const legalSans = chess.moves();

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

  return {
    gameSans,
    currentFen,
    occupancy,
    legalSans,
    turningPoints: tpOut,
    context: ctx,
    allowedSans: [...sans],
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

export function validateChat(text: string, facts: ChatFactList): { ok: true } | { ok: false; violations: string[] } {
  const allowedSans = new Set(facts.allowedSans);
  const violations: string[] = [];

  for (const raw of text.match(SAN_RE) ?? []) {
    const token = stripTrailingPunctuation(raw);
    if (isBareSquare(token)) continue; // geography, always allowed -- cut #2
    if (!isAllowedSanToken(token, allowedSans)) violations.push(token);
  }

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
function factsForModel(facts: ChatFactList) {
  const { allowedSans, context, ...rest } = facts;
  let strippedContext: Record<string, unknown> | undefined;
  if (context) {
    const { best, threat, ...restCtx } = context;
    strippedContext = {
      ...restCtx,
      threat: threat ? stripThreatUci(threat) : undefined,
      best: best ? { san: best.san, pieceKind: best.pieceKind, from: best.from, to: best.to } : undefined,
    };
  }
  return { ...rest, context: strippedContext };
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
export async function chat(
  userMessage: string,
  history: { role: "user" | "coach"; text: string }[],
  facts: ChatFactList,
  backend: CoachBackend,
  trace: NarrateTraceContext
): Promise<{ text: string; source: "model" | "template"; cause?: "backend-down"; traceId: number }> {
  const start = Date.now();
  const persona = getPersona();
  const basePrompt = buildChatPrompt(facts, history, userMessage, persona);

  let attemptPrompt = basePrompt;
  let attemptOutput = "";
  let regenCount = 0;
  let modelText: string | null = null;
  let backendDown = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      attemptOutput = await backend.generate(attemptPrompt, CHAT_TIMEOUT_MS);
    } catch (err) {
      // Backend error/timeout at any attempt short-circuits straight to the
      // redirect template below -- never worth a second network/process
      // call, mirrors narrate()'s discipline exactly.
      attemptOutput = `[backend error] ${err instanceof Error ? err.message : String(err)}`;
      backendDown = true;
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
  const text =
    modelText ??
    persona.chatTemplates.redirect ??
    "let's keep it on the board. ask me about a move from this game and i'll break it down.";
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

  return backendDown ? { text, source, cause: "backend-down", traceId } : { text, source, traceId };
}
