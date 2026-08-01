// Increment 2.7 (why-hints): the 0-5 escalation ladder, anchored to the
// piece SHE just moved (owner rule: "her piece first" — levels 1-3 never
// talk about a different piece; the redirect to "use this piece instead"
// only happens at levels 4-5). Kept as its own pure module (rather than
// inlined in GamePage) for the same reason moveFlow.ts is: a one-glance
// spec, unit testable without touching React state or the network.
//
// Level 0 = nothing revealed yet (only the "help?" affordance shows).
// Level 1 = vague nudge naming her piece, free (mirrorRef, no network).
// Level 2 = direction/concept, keyed off verdict.threat's motif, free.
// Level 3 = concrete why + a board highlight of the threat, free.
// Level 4 = "better: your {piece} on {square}" — fires the deep hint fetch.
// Level 5 = "best here: {san} ({translation})" + the existing board reveal
//           (hintRevealSquares/hintReveal in GamePage), reusing 2.6's
//           describeBestMove unchanged.
//
// HONESTY GATE (product rule, enforced by construction): every L2/L3 string
// only reads fields off `ctx.threat`, which the server populated from a
// literal chess.js replay of the judge's discarded refutation (see
// server/annotator/motifs.ts). A motif branch never reads a field another
// motif populated. When threat is absent, or the motif is "positional",
// copy degrades to the honest fallback — it never speculates.
import { Chess } from "chess.js";
import type { ThreatFacts, RecommendationFacts } from "./api";
import { deriveOpportunity } from "../review/opportunity";
// Debrief Plain-English Notation round, Task 1: pieceName and the SAN-based
// renderer both moved to describeSanMove.ts (a shared module with no
// dependency on this file, so this file can safely depend on it) —
// re-exporting pieceName here keeps every existing import of it from
// hintFlow.ts working unchanged.
import { pieceName, describeSanMove, describeMoveName } from "./describeSanMove";

export { pieceName };

export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5;

const MAX_HINT_LEVEL: HintLevel = 5;

/** Advances the ladder by one step, capped at the top (level 5). */
export function nextHintLevel(level: HintLevel): HintLevel {
  return level >= MAX_HINT_LEVEL ? MAX_HINT_LEVEL : ((level + 1) as HintLevel);
}

export interface HintFacts {
  bestPieceKind: string;
  bestFromSquare: string;
  bestToSquare: string;
  bestSan: string;
  bestUci: string;
  // Increment 3a Wave 3: "why the recommended move is good" — arrives with
  // the deep hint fetch (server/annotator/hint.ts), read by
  // recommendationClause below at level 5 only.
  recommendation?: RecommendationFacts;
  // Task 5 (trade-aware hints, increment 3.95): hand-mirroring
  // server/annotator/hint.ts's HintFacts.pv/.trade (same convention as
  // ThreatFacts/RecommendationFacts above). Not yet read by any copy here —
  // Task 6 builds the "this trades but it's the strongest here" clause off
  // `trade`, and `pv` off the chosen line's own moves. Optional here (unlike
  // the server, which always sets them) since existing fixtures in this
  // file's own tests predate this field and shouldn't have to grow it.
  pv?: string[];
  trade?: boolean;
}

/**
 * Level 4/5 addendum: what the recommended move accomplishes, in the
 * player's own template voice (lowercase, no em-dashes). Every branch reads
 * only the fields `deriveRecommendationFacts` (server/annotator/motifs.ts)
 * populates for that accomplishment — same HONESTY GATE as the L2/L3 threat
 * copy above. Returns null when there's no recommendation to describe.
 *
 * Task 6 (increment 3.95, trade honesty): when `trade` is true (Task 5's
 * isTradeMove found the chosen move is a capture that gets immediately
 * recaptured on the same square — server/annotator/hint.ts), the "it wins
 * the X" wording below would misleadingly imply a clean material gain the
 * replay doesn't actually show. Say so plainly instead, overriding whatever
 * accomplishment fired — this is safe unconditionally because `trade` can
 * only ever be true alongside accomplishment "captures" (isTradeMove itself
 * requires the recommended move to be a capture), so there is no
 * accomplishment branch this could wrongly override.
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
    // Wave 1 (item 3 -- tier-1 motif fields):
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
  // Replay bestUci (never parse SAN here — a parse miss could render a
  // false claim) purely to recover its SAN, then hand off to the shared
  // renderer (describeSanMove.ts) for the actual plain-English text — same
  // capture/check/castle/promotion handling, now with one implementation.
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
 * Task 6 (increment 3.95): replays a raw UCI pv (e.g. `["e1e8"]`, as shipped
 * on HintFacts.pv straight off the engine — see hint.ts) on top of `fen`,
 * collecting SANs as it goes so deriveOpportunity (src/review/opportunity.ts,
 * which requires SAN) can classify it. Mirrors server/game/manager.ts's
 * private `pvLine` helper — same "stop cleanly at the first illegal/
 * malformed step" contract, so a corrupted or stale pv degrades to a shorter
 * true line (or none) rather than throwing.
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
 * Task 6 (increment 3.95): "what it opens up" — reuses the Task-4
 * deriveOpportunity classifier (src/review/opportunity.ts) on the hint's own
 * pv, honesty-gated the same way that module is (only what the replay
 * proves is a gain for the player). Returns undefined gracefully whenever
 * there's no pv, the replay doesn't hold up, or deriveOpportunity itself
 * finds nothing provable.
 *
 * Dedup: when the immediate "captures" clause already named this exact
 * capture (same piece, e.g. "it wins the queen on d4"), and the pv-derived
 * opportunity is the identical "wins the {piece}" claim, it's the same fact
 * twice — omit it rather than pad the copy with a redundant repeat (this is
 * a hint rung, not a paragraph).
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
 * Task 6 (increment 3.95): composes level 4's WHY addendum — the immediate
 * reason (recommendationClause, trade-honesty-gated) plus what the line
 * opens up further out (opensUpOpportunity), or "" when neither is provable.
 * Kept as its own function so hintCopy's level 4 branch stays a one-liner.
 *
 * Copy-polish pass: the caller (hintCopy) terminates the base "better: your
 * {piece} on {square}" clause with a period before appending this, so every
 * branch here starts with a leading space and reads as its own sentence —
 * no run-on. When both the immediate reason and the opens-up clause fire,
 * they're joined with ", and" (immediate's own trailing period stripped
 * first) rather than a bare "and" dangling after a full stop.
 */
function level4Why(facts: HintFacts, fen?: string): string {
  const immediate = recommendationClause(facts.recommendation, facts.trade);
  const opportunity = fen ? opensUpOpportunity(facts, fen) : undefined;
  if (immediate && opportunity) {
    const trimmed = immediate.endsWith(".") ? immediate.slice(0, -1) : immediate;
    return ` ${trimmed}, and it ${opportunity}.`;
  }
  if (immediate) return ` ${immediate}`;
  if (opportunity) return ` it ${opportunity}.`;
  return "";
}

/**
 * Everything hintCopy needs to render any level of the ladder. herPieceKind/
 * herToSquare describe the piece SHE just moved (levels 1-3, always
 * available for free off the client mirror + the pending move). threat is
 * verdict.threat, arriving with the judge response (levels 2-3). bestFacts
 * is the deep-fetched facts, present only after the 3->4 fetch (levels 4-5).
 * fen is the live mirror fen: read at level 4 (level4Why's opens-up clause,
 * via opensUpOpportunity) and at level 5 for describeBestMove.
 */
export interface HintCopyCtx {
  herPieceKind: string;
  herToSquare: string;
  threat?: ThreatFacts;
  bestFacts?: HintFacts;
  fen?: string;
}

// Level 2: direction/concept, no line — keyed off the threat's motif alone.
// Never names a square or a specific piece she can't yet place.
function motifL2(ctx: HintCopyCtx): string {
  const threat = ctx.threat;
  if (!threat) return "there's a stronger plan here.";
  switch (threat.motif) {
    case "fork":
      return "there's a fork brewing.";
    case "capture-moved":
    case "capture-other":
      return `think about what her ${pieceName(threat.refutationPieceKind)} can reach.`;
    case "mate-threat":
      return "this one's dangerous. she's got something forcing.";
    case "check-threat":
      return "this opens you up to check.";
    // Wave 1 (item 3 -- tier-1 motif fields):
    case "promotion-threat":
      return "she's about to make a new queen.";
    default:
      return "there's a stronger plan here.";
  }
}

// Task 1 (2026-07-22, truthfulness leaks): standard piece values for the
// defended-capture-moved material check below. King never counted (it's
// never the capturing piece here).
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/**
 * Task 1 (2026-07-22, corrected per controller review -- issue A), a
 * defended capture-moved trade ("nothing hangs") is only honest when the
 * exchange is roughly even. Live gate example: she plays Qxe6+, f7
 * recaptures -- capturedSquareDefended is true (she could in turn take the
 * pawn on e6), but calling that "nothing hangs" is false when what she
 * captured with her own move is worth far more than what she captured.
 *
 * Net = value(threat.herCapturedPieceKind, defaulting to 0 when her own move
 * wasn't a capture at all) - value(ctx.herPieceKind) [what she captured
 * with]. The FIRST version of this fix used threat.refutationPieceKind
 * (what she'd recapture BACK, a different piece) as a proxy for her own
 * gain -- that produces a real false positive: QxQ recaptured by a pawn is
 * an even trade, but the proxy formula (1 - 9 = -8) fired and printed "down
 * a queen for a pawn," a confidently false statement. herCapturedPieceKind
 * (server/annotator/motifs.ts, threaded from her own chess.js Move.captured
 * at the classify.ts call site) is the real fact for what she actually won,
 * not a proxy.
 */
function defendedCaptureMovedLine(
  ctx: HintCopyCtx,
  threat: ThreatFacts,
  honestFallback: string
): string {
  const herValue = PIECE_VALUES[ctx.herPieceKind];
  if (herValue === undefined) return honestFallback;
  const herCapturedKind = threat.herCapturedPieceKind;
  // Her move captured nothing (a quiet move that simply walked into the
  // recapture) -- net gain from her own move is 0, not a missing/unknown
  // value. A recognized-but-unmapped piece kind (shouldn't happen, king
  // never counted) still degrades to the honest fallback rather than a
  // wrong number.
  const herCapturedValue = herCapturedKind === undefined ? 0 : PIECE_VALUES[herCapturedKind];
  if (herCapturedValue === undefined) return honestFallback;

  const net = herCapturedValue - herValue;
  if (net >= -1) return honestFallback;

  // herCapturedKind === undefined means her own move wasn't a capture at
  // all -- "takes on X" would be a false claim in that case (she just moved
  // there and got captured), so this branch reuses the undefended-loss
  // motif's own honest framing ("to X walks into her Y") instead of
  // asserting a capture that didn't happen.
  if (herCapturedKind === undefined) {
    return `${pieceName(ctx.herPieceKind)} to ${ctx.herToSquare} walks into her ${pieceName(
      threat.refutationPieceKind
    )}. you simply lose the ${pieceName(ctx.herPieceKind)}.`;
  }
  return `${pieceName(ctx.herPieceKind)} takes on ${threat.capturesSquare}, but her ${pieceName(
    threat.refutationPieceKind
  )} takes back. you come out down a ${pieceName(ctx.herPieceKind)} for a ${pieceName(herCapturedKind)}.`;
}

// Level 3: the concrete why, keyed off the threat's motif — every field read
// here came from the server's literal replay of the refutation, per motif.
function motifL3(ctx: HintCopyCtx): string {
  const threat = ctx.threat;
  const honestFallback = "this loses ground. nothing hangs, but the position gets worse.";
  if (!threat) return honestFallback;
  switch (threat.motif) {
    case "fork": {
      const targets = (threat.forkTargets ?? []).map((t) => pieceName(t.pieceKind)).join(" and ");
      return `her ${pieceName(threat.refutationPieceKind)} to ${threat.refutationToSquare} forks your ${targets}.`;
    }
    case "capture-moved":
      // Task 1 (defender grounding, then made material-aware 2026-07-22): a
      // defended capture is a trade, not automatically a loss -- she
      // recaptures right back -- but the trade itself can still be lopsided
      // (queen for a pawn). defendedCaptureMovedLine only degrades to the
      // honest fallback when the exchange is roughly even or better.
      if (threat.capturedSquareDefended) return defendedCaptureMovedLine(ctx, threat, honestFallback);
      return `${pieceName(ctx.herPieceKind)} to ${ctx.herToSquare} walks into her ${pieceName(threat.refutationPieceKind)}. she just takes it.`;
    case "capture-other":
      if (threat.capturedSquareDefended) return honestFallback;
      return `${pieceName(ctx.herPieceKind)} to ${ctx.herToSquare} opens the door. her ${pieceName(threat.refutationPieceKind)} takes your ${pieceName(threat.capturedPieceKind ?? "")} on ${threat.capturesSquare}.`;
    case "mate-threat":
      return `her ${threat.refutationSan} starts a forced mate.`;
    case "check-threat":
      return `her ${pieceName(threat.refutationPieceKind)} to ${threat.refutationToSquare} puts you in check.`;
    // Wave 1 (item 3 -- tier-1 motif fields): reuses only refutation
    // piece/to-square, both always populated on ThreatFacts.
    case "promotion-threat":
      return `her ${pieceName(threat.refutationPieceKind)} to ${threat.refutationToSquare} promotes. that's a new queen.`;
    default:
      return honestFallback;
  }
}

/**
 * Template-only copy for the current hint level — lowercase, no em-dashes,
 * no emojis, per the round's copy rules (SAN is notation, exempt). Returns
 * null at level 0, and at levels 4-5 until bestFacts has arrived (no copy
 * flash mid-fetch — the caller just shows the "thinking..." button state).
 */
export function hintCopy(level: HintLevel, ctx: HintCopyCtx): string | null {
  if (level <= 0) return null;
  if (level === 1) return `hold on. look at your ${pieceName(ctx.herPieceKind)}.`;
  if (level === 2) return motifL2(ctx);
  if (level === 3) return motifL3(ctx);
  if (!ctx.bestFacts) return null;
  if (level === 4) {
    // Copy-polish pass: base clause ends in its own period (mirrors this
    // file's L1 style, "hold on. look at your knight.") so level4Why's
    // addendum never runs on into it.
    //
    // Wave 0, item 3 (F3 seed): was "your {piece} on {bestFromSquare}." --
    // naming only the piece and the FROM square, phrased with "on" as if it
    // were the destination. Root cause of the owner-facing "E1 vs F1" bug:
    // a different surface named the TO square for this same move, so the
    // two disagreed about which square the hint meant. describeMoveName is
    // now the one shared renderer for "name a move by its squares" -- it
    // always states both.
    const base = `better: ${describeMoveName(ctx.bestFacts.bestPieceKind, ctx.bestFacts.bestFromSquare, ctx.bestFacts.bestToSquare)}.`;
    return `${base}${level4Why(ctx.bestFacts, ctx.fen)}`;
  }
  const translation = ctx.fen ? describeBestMove(ctx.bestFacts, ctx.fen) : null;
  const base = translation
    ? `best here: ${ctx.bestFacts.bestSan} (${translation})`
    : `best here: ${ctx.bestFacts.bestSan}`;
  // Copy-polish pass: L4 now owns the immediate-reason clause (level4Why
  // above), so L5 no longer repeats it — a player walking the ladder would
  // otherwise read the identical reason twice. The one exception is the
  // trade-honesty note: it's about the move she's about to commit to here,
  // not a repeat of L4's "why", so it still surfaces via the same
  // honesty-gated recommendationClause when trade is true.
  const clause = ctx.bestFacts.trade
    ? recommendationClause(ctx.bestFacts.recommendation, ctx.bestFacts.trade)
    : null;
  return clause ? `${base} ${clause}` : base;
}

/** Splits a UCI move ("g1f3") into its from/to squares for the board's
 * level-5 highlight. Deliberately doesn't validate — bestUci already came
 * from a legal chess.js replay in server/annotator/hint.ts. Belt-and-
 * suspenders re-validation against the live client position lives in
 * hintIsLegal below. */
export function hintRevealSquares(bestUci: string): { from: string; to: string } {
  return { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) };
}

/**
 * Level-3 board highlight: the opponent's refutation attacker, plus the
 * square it would land on (or actually capture on, for a capture motif —
 * en passant's real captured-pawn square, not the empty landing square).
 * Falls back to herToSquare for a non-capture motif (fork/check/mate) so the
 * highlight still points somewhere true: the square her piece landed on,
 * which is what the refutation is reacting to.
 *
 * HONESTY GATE: returns null for motif "positional" — motifL3's honest
 * fallback copy ("this loses ground. nothing hangs...") explicitly denies a
 * concrete threat exists, so painting a threat-attacker/threat-victim ring
 * would visually claim one anyway. Only the concrete-threat motifs
 * (capture-moved, capture-other, fork, mate-threat, check-threat) get a
 * highlight; "positional" gets none.
 */
export function threatRevealSquares(
  threat: ThreatFacts,
  herToSquare: string
): { attacker: string; victim: string } | null {
  if (threat.motif === "positional") return null;
  return { attacker: threat.refutationFromSquare, victim: threat.capturesSquare ?? herToSquare };
}

/**
 * Belt-and-suspenders legality re-check against the live client position.
 * The server derives facts from a legal chess.js replay, but hintRevealSquares
 * trusts its input unconditionally — if a stale or cross-game hint ever slips
 * through the token guards, this stops it from rendering as an impossible
 * square (the exact playtest complaint) and lets the caller log it instead.
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
