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

export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5;

const MAX_HINT_LEVEL: HintLevel = 5;

/** Advances the ladder by one step, capped at the top (level 5). */
export function nextHintLevel(level: HintLevel): HintLevel {
  return level >= MAX_HINT_LEVEL ? MAX_HINT_LEVEL : ((level + 1) as HintLevel);
}

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Spells out a chess.js piece-kind letter ("n") as a word ("knight"). */
export function pieceName(kind: string): string {
  return PIECE_NAMES[kind] ?? "piece";
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
}

/**
 * Level 5 addendum: what the recommended move accomplishes, in the
 * player's own template voice (lowercase, no em-dashes). Every branch reads
 * only the fields `deriveRecommendationFacts` (server/annotator/motifs.ts)
 * populates for that accomplishment — same HONESTY GATE as the L2/L3 threat
 * copy above. Returns null when there's no recommendation to describe.
 */
export function recommendationClause(rec: RecommendationFacts | null | undefined): string | null {
  if (!rec) return null;
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
  const suffix = probe.isCheckmate() ? ", checkmate" : probe.isCheck() ? ", check" : "";
  if (mv.flags.includes("k")) return `castle short${suffix}`;
  if (mv.flags.includes("q")) return `castle long${suffix}`;
  const isCapture = mv.flags.includes("c") || mv.flags.includes("e");
  let phrase = `${pieceName(facts.bestPieceKind)} ${isCapture ? "takes on" : "to"} ${mv.to}`;
  if (mv.flags.includes("p") && mv.promotion) phrase += `, becoming a ${pieceName(mv.promotion)}`;
  return `${phrase}${suffix}`;
}

/**
 * Everything hintCopy needs to render any level of the ladder. herPieceKind/
 * herToSquare describe the piece SHE just moved (levels 1-3, always
 * available for free off the client mirror + the pending move). threat is
 * verdict.threat, arriving with the judge response (levels 2-3). bestFacts
 * is the deep-fetched facts, present only after the 3->4 fetch (levels 4-5).
 * fen is the live mirror fen, used only at level 5 for describeBestMove.
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
    default:
      return "there's a stronger plan here.";
  }
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
      return `${pieceName(ctx.herPieceKind)} to ${ctx.herToSquare} walks into her ${pieceName(threat.refutationPieceKind)}. she just takes it.`;
    case "capture-other":
      return `${pieceName(ctx.herPieceKind)} to ${ctx.herToSquare} opens the door. her ${pieceName(threat.refutationPieceKind)} takes your ${pieceName(threat.capturedPieceKind ?? "")} on ${threat.capturesSquare}.`;
    case "mate-threat":
      return `her ${threat.refutationSan} starts a forced mate.`;
    case "check-threat":
      return `her ${pieceName(threat.refutationPieceKind)} to ${threat.refutationToSquare} puts you in check.`;
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
  if (level === 4) return `better: your ${pieceName(ctx.bestFacts.bestPieceKind)} on ${ctx.bestFacts.bestFromSquare}`;
  const translation = ctx.fen ? describeBestMove(ctx.bestFacts, ctx.fen) : null;
  const base = translation
    ? `best here: ${ctx.bestFacts.bestSan} (${translation})`
    : `best here: ${ctx.bestFacts.bestSan}`;
  const clause = recommendationClause(ctx.bestFacts.recommendation);
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
