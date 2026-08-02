// Wave 2 (the hint decision tree): the hint button no longer walks a fixed
// 0-5 escalation anchored to the piece she just moved. It walks a two-branch
// PRESS LADDER whose ONE branch decision is made once per pending move from
// the DEEP hint facts: is her pending move made with the best-move piece?
//   branch = "right" iff pending.from === bestFacts.bestFromSquare.
//
// - right branch (3 presses): P1 vague "the idea is with this piece, but not
//   like this" -> P2 what the OPPONENT is doing (the 8-rung priority ladder
//   in selectRung, or the conversion override) -> P3 full reveal
//   ("best here: {san} ({plain-english})" + board reveal).
// - wrong branch (4 presses): P1 "the best move isn't with this piece" -> P2
//   names the right piece + its FROM square (never a destination) -> P3 what
//   that piece will DO (fork/trade/develop/promotes/castles/check/mate) with
//   NO destination square (piece KINDS are allowed; squares are not) -> P4
//   full reveal, same as right-P3.
//
// Press 0 = nothing revealed (only the "help?" affordance). The help click IS
// press 1. Every press's copy comes from a template POOL, deterministically
// rotated with seed (gameId * 31 + pendingPly) % pool.length -- so a session
// never opens with the same opener two pending moves in a row (consecutive
// HER plies are 2 apart; a step of 2 through a pool of 3-5 can never land on
// the same index). The two HARD-FACT reveal rungs -- wrong-P3's "what it
// does" verb and the full reveal's exact move -- are single canonical
// phrasings, not pooled: the honesty gate pins their wording to the fact, and
// the canned-ness the owner flagged was in the guiding openers, not the
// answer.
//
// HONESTY GATE (enforced by construction): every string only reads fields the
// branch/rung it belongs to owns. Opponent-ladder rungs read ctx.threat
// (populated by server/annotator/motifs.ts from a literal chess.js replay of
// the judge's discarded refutation) and, for the two combination rungs,
// ctx.bestFacts.recommendation. The full reveal reads ctx.bestFacts. No rung
// renders a claim its facts don't prove; when a fact is absent, copy degrades
// to an honest fallback rather than speculating. conversionCopy is owner-voice
// server copy for decided positions -- rendered verbatim, never pooled.
import { Chess } from "chess.js";
import type { ThreatFacts, RecommendationFacts } from "./api";
import { deriveOpportunity } from "../review/opportunity";
// Debrief Plain-English Notation round: pieceName and the SAN-based renderer
// both live in describeSanMove.ts. Re-exporting pieceName here keeps every
// existing import of it from hintFlow.ts working unchanged.
import { pieceName, describeSanMove } from "./describeSanMove";

export { pieceName };

// ---- branch + press shape ----------------------------------------------

export type HintBranch = "right" | "wrong";

/** ONE branch decision per pending move: right iff her piece IS the best-move
 * piece. Kept pure and trivially testable rather than inlined in GamePage. */
export function decideBranch(pendingFrom: string, bestFromSquare: string): HintBranch {
  return pendingFrom === bestFromSquare ? "right" : "wrong";
}

/** Presses in a branch: 3 on the right branch, 4 on the wrong branch. */
export function maxPress(branch: HintBranch): number {
  return branch === "right" ? 3 : 4;
}

export interface HintFacts {
  bestPieceKind: string;
  bestFromSquare: string;
  bestToSquare: string;
  bestSan: string;
  bestUci: string;
  // "why the recommended move is good" -- arrives with the deep hint fetch
  // (server/annotator/hint.ts), read by the full reveal.
  recommendation?: RecommendationFacts;
  // The chosen line's own moves (UCI) and whether the best move is an
  // immediately-recaptured trade -- server/annotator/hint.ts. Optional here
  // (the server always sets them) so this file's own fixtures needn't grow.
  pv?: string[];
  trade?: boolean;
}

/**
 * Everything any rung of either branch needs. herPieceKind describes the
 * piece SHE just moved (right-P1). threat is verdict.threat (the opponent
 * ladder). bestFacts is the deep-fetched facts (present from press 1 -- the
 * branch decision itself needs them, so there is no facts-free rung). fen is
 * the live mirror fen (full reveal's describeBestMove + the opens-up clause).
 * gameId/pendingPly seed the pool rotation. conversionCopy, when present,
 * overrides right-P2 verbatim (decided positions). mateAfter is the verdict's
 * typed mate distance, mover perspective (< 0 = mate against her).
 */
export interface HintCopyCtx {
  herPieceKind: string;
  herToSquare: string;
  threat?: ThreatFacts;
  bestFacts?: HintFacts;
  fen?: string;
  gameId: number;
  pendingPly: number;
  conversionCopy?: string;
  mateAfter?: number | null;
}

// ---- pool rotation ------------------------------------------------------

/** Deterministic pool index from the seed (gameId * 31 + pendingPly). The
 * double-modulo keeps it non-negative even if a caller ever passes a
 * negative ply (defensive; plies are >= 1 in practice). */
function poolIndex(ctx: Pick<HintCopyCtx, "gameId" | "pendingPly">, len: number): number {
  const raw = (ctx.gameId * 31 + ctx.pendingPly) % len;
  return ((raw % len) + len) % len;
}

function pick(pool: readonly string[], ctx: Pick<HintCopyCtx, "gameId" | "pendingPly">): string {
  return pool[poolIndex(ctx, pool.length)];
}

// ---- the 8-rung "what the opponent is doing" ladder ---------------------

export type OpponentRung =
  | "mate"
  | "clean-hang"
  | "fork"
  | "counter-fork"
  | "trade"
  | "check"
  | "promotion"
  | "positional";

// Standard piece values for the counter-fork rung's net-material gate. King
// never counted (it is never the captured/capturing piece in a trade). Same
// convention the pre-rewrite defendedCaptureMovedLine used.
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/**
 * Her net material from the just-moved capture exchange: what her own move
 * captured (threat.herCapturedPieceKind, 0 when her move wasn't a capture)
 * minus the piece she loses to the refutation (her moved piece). Negative =
 * she came out behind. Returns null when it can't be judged (her piece is a
 * king or an unmapped kind) so the caller can decline to assert a loss it
 * can't prove -- mirrors the old defendedCaptureMovedLine's honest fallback.
 */
function herNetMaterial(ctx: HintCopyCtx): number | null {
  const herValue = PIECE_VALUES[ctx.herPieceKind];
  if (herValue === undefined) return null;
  const capturedKind = ctx.threat?.herCapturedPieceKind;
  const herCapturedValue = capturedKind === undefined ? 0 : PIECE_VALUES[capturedKind];
  if (herCapturedValue === undefined) return null;
  return herCapturedValue - herValue;
}

/**
 * Right-P2's ladder: first true wins, in the owner-confirmed priority order.
 * Rungs 4 (counter-fork) and 5 (trade) read ctx.bestFacts; every other rung
 * reads ctx.threat / ctx.mateAfter. Note the ordering that makes rung 2
 * (an UNDEFENDED clean hang) outrank rung 4 (a DEFENDED capture where her
 * best move happens to fork back) -- a hang she can't recapture is the more
 * urgent thing to say.
 */
export function selectRung(ctx: HintCopyCtx): OpponentRung {
  const threat = ctx.threat;
  const best = ctx.bestFacts;
  const isCapture = threat?.motif === "capture-moved" || threat?.motif === "capture-other";

  // 1. typed mate against her, or a mate-threat motif.
  if ((ctx.mateAfter != null && ctx.mateAfter < 0) || threat?.motif === "mate-threat") return "mate";
  // 2. clean hang: a capture motif whose captured square she cannot defend.
  if (isCapture && threat!.capturedSquareDefended === false) return "clean-hang";
  // 3. fork brewing against her.
  if (threat?.motif === "fork") return "fork";
  // 4. counter-fork: she's GENUINELY losing material (a capture motif the
  //    defended-clean-hang rung didn't claim, whose net for her is a real
  //    loss -- NOT a defended even trade like QxQ recaptured) BUT her best
  //    move forks. The net gate restores the discipline the pre-rewrite
  //    defendedCaptureMovedLine had: a "losing material" claim on an even
  //    trade is false. When the net can't be judged (king / unmapped kind),
  //    the loss isn't provable, so fall through rather than assert it.
  if (isCapture && best?.recommendation?.accomplishment === "forks") {
    const net = herNetMaterial(ctx);
    if (net !== null && net < -1) return "counter-fork";
  }
  // 5. the best line here is a trade.
  if (best?.trade === true) return "trade";
  // 6. check threat.
  if (threat?.motif === "check-threat") return "check";
  // 7. promotion threat.
  if (threat?.motif === "promotion-threat") return "promotion";
  // 8. honest positional fallback.
  return "positional";
}

// Each ladder rung's 3-phrasing pool. Fact tokens (piece kinds, fork
// targets) are interpolated identically across a rung's variants -- only the
// framing rotates, so no variant can be true while another is false.
function opponentRungPool(rung: OpponentRung, ctx: HintCopyCtx): readonly string[] {
  const threat = ctx.threat;
  switch (rung) {
    case "mate":
      // House voice: "she"/"her" is ALWAYS mallow, so every phrasing here
      // must read as mallow having a mate against the PLAYER -- never as a
      // mate for the player's benefit ("coming for her" reads inverted).
      return [
        "she's got a mate threat. this is the dangerous one.",
        "careful. she's threatening mate here.",
        "she's got a forced mate lined up.",
      ];
    case "clean-hang": {
      const p = pieceName(threat?.capturedPieceKind ?? ctx.herPieceKind);
      return [
        `she just takes your ${p}. it's hanging.`,
        `your ${p} is hanging. she takes it for free.`,
        `she wins your ${p} outright here.`,
      ];
    }
    case "fork": {
      const targets = (threat?.forkTargets ?? []).map((t) => pieceName(t.pieceKind)).join(" and ");
      return [
        `she's setting up a fork on your ${targets}.`,
        `there's a fork coming on your ${targets}.`,
        `her next move forks your ${targets}.`,
      ];
    }
    case "counter-fork": {
      const p = pieceName(ctx.bestFacts?.recommendation?.pieceKind ?? "");
      return [
        `you're losing material, but your ${p} has a fork.`,
        `she's winning material here, but your ${p} forks back.`,
        `material's slipping, but your ${p} has a fork of its own.`,
      ];
    }
    case "trade":
      return [
        "the best you've got here is a trade.",
        "this position wants a trade, not more.",
        "a clean trade is the move here.",
      ];
    case "check":
      return [
        "she's lining up a check that costs you.",
        "there's a check coming that hurts.",
        "watch the check she's about to give.",
      ];
    case "promotion":
      return [
        "she's about to make a new queen.",
        "her pawn is about to promote.",
        "there's a promotion coming for her.",
      ];
    case "positional":
      return [
        "this loses ground. nothing hangs, but the position gets worse.",
        "nothing hangs here, but you're drifting into a worse spot.",
        "no piece drops, but this quietly gives ground.",
      ];
  }
}

// ---- opener + redirect pools -------------------------------------------

function rightP1Pool(herPieceKind: string): readonly string[] {
  const p = pieceName(herPieceKind);
  return [
    `the idea is with your ${p}, just not like this.`,
    `right piece, wrong square. your ${p} belongs somewhere better.`,
    `your ${p} is the one, but not there.`,
    `you've got the right piece. it's the square that's off.`,
  ];
}

const WRONG_P1_POOL: readonly string[] = [
  "the best move isn't with this piece. look at a different piece.",
  "this piece isn't the one. there's a better piece to move.",
  "put this piece down for a second. another one does more here.",
  "not this piece. something else is the move.",
];

function wrongP2Pool(pieceKind: string, fromSquare: string): readonly string[] {
  const p = pieceName(pieceKind);
  return [
    `look at your ${p} on ${fromSquare}.`,
    `it's your ${p} on ${fromSquare} that does the work.`,
    `your ${p} on ${fromSquare} is the piece.`,
    `check your ${p} on ${fromSquare}.`,
  ];
}

// ---- wrong-P3: what the best piece WILL DO, with NO squares -------------

/**
 * HONESTY GATE: names piece KINDS (fork targets, captured/attacked piece) but
 * never a square -- P4 is where the concrete move (with squares) is revealed.
 * A single canonical clause per accomplishment: the fact pins the wording.
 */
function wrongP3Copy(bestFacts: HintFacts): string {
  if (bestFacts.trade) return "it makes a trade for something better.";
  const rec = bestFacts.recommendation;
  if (!rec) return "it's simply a stronger move.";
  switch (rec.accomplishment) {
    case "captures":
      return `it wins the ${pieceName(rec.capturedPieceKind ?? "")}.`;
    case "gives-mate":
      return "it forces mate.";
    case "gives-check":
      return "it puts her in check.";
    case "forks":
      return `it forks her ${(rec.forkTargets ?? []).map((t) => pieceName(t.pieceKind)).join(" and ")}.`;
    case "attacks":
      return `it goes after her ${pieceName(rec.attackedPieceKind ?? "")}.`;
    case "develops":
      return "it develops a piece and improves your shape.";
    case "promotes":
      return "it makes a new queen.";
    case "castles":
      return "it gets your king castled to safety.";
    default:
      return "it's simply a stronger move.";
  }
}

// ---- the full reveal (right-P3 / wrong-P4) -----------------------------

/**
 * Level 4/5 addendum, unchanged: what the recommended move accomplishes, in
 * the player's own template voice. Every branch reads only the fields
 * deriveRecommendationFacts populates for that accomplishment (same honesty
 * gate). When `trade` is true, says so plainly rather than implying a clean
 * material gain the replay doesn't show (isTradeMove only ever fires
 * alongside accomplishment "captures", so no honest branch is wrongly
 * overridden). Returns null when there's no recommendation to describe.
 */
export function recommendationClause(
  rec: RecommendationFacts | null | undefined,
  trade?: boolean
): string | null {
  if (!rec) return null;
  if (trade) return "this trades, but it's the strongest here.";
  switch (rec.accomplishment) {
    case "captures":
      return `it wins the ${pieceName(rec.capturedPieceKind ?? "")} on ${rec.capturesSquare}.`;
    case "gives-mate":
      return "it forces mate.";
    case "gives-check":
      return "it puts her in check.";
    case "forks":
      return `it forks her ${(rec.forkTargets ?? []).map((t) => pieceName(t.pieceKind)).join(" and ")}.`;
    case "attacks":
      return `it goes after her ${pieceName(rec.attackedPieceKind ?? "")} on ${rec.attackedSquare}.`;
    case "develops":
      return "it keeps building. good shape, no drama.";
    case "promotes":
      return "it makes a new queen.";
    case "castles":
      return "it gets your king castled to safety.";
    default:
      return null;
  }
}

/**
 * Lowercase plain-language translation of the best move, derived by replaying
 * bestUci on the live fen (never by parsing SAN - a parse miss could render a
 * false claim). Returns null when the replay fails; callers then show SAN alone.
 */
export function describeBestMove(facts: HintFacts, fen: string): string | null {
  let probe: Chess;
  try {
    probe = new Chess(fen);
  } catch {
    return null;
  }
  let mv;
  try {
    mv = probe.move({
      from: facts.bestUci.slice(0, 2),
      to: facts.bestUci.slice(2, 4),
      promotion: (facts.bestUci[4] as "q" | "r" | "b" | "n" | undefined) ?? "q",
    });
  } catch {
    return null;
  }
  if (!mv) return null;
  return describeSanMove(mv.san, fen);
}

/**
 * Replays a raw UCI pv on top of `fen`, collecting SANs so deriveOpportunity
 * (which requires SAN) can classify it. Mirrors manager.ts's pvLine -- stops
 * cleanly at the first illegal/malformed step, so a stale pv degrades to a
 * shorter true line rather than throwing.
 */
function pvSansFromUci(fen: string, uciPv: string[]): string[] {
  let replay: Chess;
  try {
    replay = new Chess(fen);
  } catch {
    return [];
  }
  const sans: string[] = [];
  for (const uci of uciPv) {
    if (uci.length < 4) break;
    let mv;
    try {
      mv = replay.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? "q",
      });
    } catch {
      mv = null;
    }
    if (!mv) break;
    sans.push(mv.san);
  }
  return sans;
}

/**
 * "what it opens up" -- reuses deriveOpportunity on the hint's own pv,
 * honesty-gated the same way that module is. Returns undefined when there's
 * no pv, the replay doesn't hold up, or deriveOpportunity finds nothing
 * provable. Dedups against the immediate "captures" clause when they'd name
 * the identical fact.
 */
function opensUpOpportunity(facts: HintFacts, fen: string): string | undefined {
  if (!facts.pv || facts.pv.length === 0) return undefined;
  const sans = pvSansFromUci(fen, facts.pv);
  if (sans.length === 0) return undefined;
  const opportunity = deriveOpportunity(fen, sans);
  if (!opportunity) return undefined;
  const alreadyStated =
    facts.recommendation?.accomplishment === "captures" &&
    opportunity === `wins the ${pieceName(facts.recommendation.capturedPieceKind ?? "")}`;
  return alreadyStated ? undefined : opportunity;
}

/**
 * The full reveal's WHY clause: the immediate reason (recommendationClause,
 * trade-honesty-gated) plus what the line opens up further out
 * (opensUpOpportunity), or "" when neither is provable. No leading space and
 * no trailing padding -- the caller joins it after the base clause's period.
 */
function whyClause(facts: HintFacts, fen?: string): string {
  const immediate = recommendationClause(facts.recommendation, facts.trade);
  const opportunity = fen ? opensUpOpportunity(facts, fen) : undefined;
  if (immediate && opportunity) {
    const trimmed = immediate.endsWith(".") ? immediate.slice(0, -1) : immediate;
    return `${trimmed}, and it ${opportunity}.`;
  }
  if (immediate) return immediate;
  if (opportunity) return `it ${opportunity}.`;
  return "";
}

/** right-P3 / wrong-P4: "best here: {san} ({plain-english}). {why}". Returns
 * null until bestFacts has arrived (the caller shows "thinking..." instead). */
function fullRevealCopy(ctx: HintCopyCtx): string | null {
  const bf = ctx.bestFacts;
  if (!bf) return null;
  const translation = ctx.fen ? describeBestMove(bf, ctx.fen) : null;
  const base = translation ? `best here: ${bf.bestSan} (${translation})` : `best here: ${bf.bestSan}`;
  const why = whyClause(bf, ctx.fen);
  return why ? `${base}. ${why}` : base;
}

// Joins the decided-position conversion copy (owner voice) ahead of another
// clause as its own leading sentence: terminates the conversion text with a
// period if it lacks sentence punctuation, then appends. The conversion text
// itself is preserved verbatim as the prefix.
function joinConversion(conversion: string, tail: string): string {
  const c = conversion.trimEnd();
  const lead = /[.!?]$/.test(c) ? c : `${c}.`;
  return `${lead} ${tail}`;
}

// ---- the state machine's copy function ---------------------------------

/**
 * Template-only copy for a given (branch, press) -- lowercase, no em-dashes,
 * no emojis (SAN is notation, exempt). Returns null at press 0, and at any
 * press whose facts haven't arrived yet (the caller shows the "thinking..."
 * button state, never a copy flash).
 */
export function rungCopy(branch: HintBranch, press: number, ctx: HintCopyCtx): string | null {
  if (press <= 0) return null;

  if (branch === "right") {
    if (press === 1) return pick(rightP1Pool(ctx.herPieceKind), ctx);
    if (press === 2) {
      // CONVERSION OVERRIDE: owner-voice server copy for a decided position
      // outranks the ladder and renders verbatim, never pooled.
      if (ctx.conversionCopy) return ctx.conversionCopy;
      return pick(opponentRungPool(selectRung(ctx), ctx), ctx);
    }
    if (press === 3) return fullRevealCopy(ctx);
    return null;
  }

  // wrong branch
  if (press === 1) return pick(WRONG_P1_POOL, ctx);
  if (press === 2) {
    if (!ctx.bestFacts) return null;
    const naming = pick(wrongP2Pool(ctx.bestFacts.bestPieceKind, ctx.bestFacts.bestFromSquare), ctx);
    // CONVERSION on the wrong branch: unlike right-P2 (full replace), the
    // piece-naming job of wrong-P2 must survive -- so the decided-position
    // copy LEADS and the naming follows it. joinConversion terminates the
    // lead sentence before appending so the two read as one thought.
    return ctx.conversionCopy ? joinConversion(ctx.conversionCopy, naming) : naming;
  }
  if (press === 3) {
    if (!ctx.bestFacts) return null;
    return wrongP3Copy(ctx.bestFacts);
  }
  if (press === 4) return fullRevealCopy(ctx);
  return null;
}

// ---- board-highlight + legality helpers (unchanged) --------------------

/** Full-reveal board highlight (right-P3 / wrong-P4): splits a UCI move into
 * from/to. Deliberately doesn't validate -- hintIsLegal re-checks against the
 * live client position before this renders. */
export function hintRevealSquares(bestUci: string): { from: string; to: string } {
  return { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) };
}

/**
 * Right-P2 threat highlight: the opponent's refutation attacker, plus the
 * square it lands on (or actually captures on, en passant resolved). Falls
 * back to herToSquare for a non-capture motif. HONESTY GATE: null for motif
 * "positional" -- the positional copy denies a concrete threat, so painting
 * an attacker/victim ring would claim one anyway.
 */
export function threatRevealSquares(
  threat: ThreatFacts,
  herToSquare: string
): { attacker: string; victim: string } | null {
  if (threat.motif === "positional") return null;
  return { attacker: threat.refutationFromSquare, victim: threat.capturesSquare ?? herToSquare };
}

/**
 * Belt-and-suspenders legality re-check against the live client position. The
 * server derives facts from a legal replay, but hintRevealSquares trusts its
 * input; if a stale or cross-game hint ever slips a token guard, this stops
 * it rendering as an impossible square and lets the caller log it instead.
 */
export function hintIsLegal(fen: string, bestUci: string): boolean {
  if (!bestUci || bestUci.length < 4) return false;
  try {
    const probe = new Chess(fen);
    const mv = probe.move({
      from: bestUci.slice(0, 2),
      to: bestUci.slice(2, 4),
      promotion: (bestUci[4] as "q" | undefined) ?? "q",
    });
    return Boolean(mv);
  } catch {
    return false;
  }
}
