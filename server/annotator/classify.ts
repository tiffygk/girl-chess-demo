import { Chess, type Move, type Square } from "chess.js";
import type { Evaluator } from "../engines/types";
import { deriveThreatFacts, type ThreatFacts, type ThreatMotif } from "./motifs";
import { conversionForMove, type MoveConversionEvent } from "./conversion";

// Wave C (hint escalation): "what was best instead" at the position BEFORE
// the judged move — derived from the SAME before-position eval classifyMove
// already runs (no third eval call; see EVAL_MOVETIME_MS's latency-budget
// comment below). bestPieceKind is chess.js's own piece-letter alphabet
// ("p"/"n"/"b"/"r"/"q"/"k"); the client spells it out for copy.
export interface MoveFacts {
  bestUci: string;
  bestSan: string;
  bestPieceKind: string;
  bestToSquare: string;
}

export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  // Wave 1 (verdict truth layer, item 2 -- typed mate): the forced-mate
  // distance BOTH from the mover's perspective, typed rather than folded into
  // deltaCp. toMoverCp collapses a mate into MATE_SCORE_CP - N (a lost
  // mate-in-16 becomes deltaCp 99098), which two real consumers depend on and
  // must stop depending on: lost-mate routing to warning (see the tier chain
  // below) and the coach model prompt (server/coach/index.ts, which shipped
  // that 99098 verbatim to the model). Positive = a mate FOR the mover,
  // negative = a mate AGAINST the mover, null = no forced mate on that side.
  // Agrees with mateAgainst/mateForMover below by construction: mateAgainst
  // <=> mateAfter < 0, mateForMover <=> mateAfter > 0. deltaCp itself stays
  // folded (compat) -- only these typed fields are added.
  mateBefore: number | null;
  mateAfter: number | null;
  latencyMs: number;
  // Undefined whenever the before-position eval's bestMove can't be turned
  // into a legal move on that position (eval failure, or the checkmate
  // short-circuit below never running an eval at all) — the client's rule
  // is "no facts, no help? affordance", never a blocked confirm/retract.
  facts?: MoveFacts;
  // Increment 2.7 (why-hints): the opponent's best reply to HER move,
  // decision-classified into a motif by motifs.ts — the "why" behind the
  // verdict. Sibling of `facts`, not a replacement — the two replay in
  // opposite directions (facts replays the BEFORE-position's best move for
  // the mover; threat replays the AFTER-position's best move for the
  // opponent) so they're kept as separate fields rather than merged.
  // Computed from the already-paid-for afterEval below — zero new engine
  // calls. Undefined on the checkmate short-circuit (her move itself
  // delivers mate — there's no "after" position, no afterEval to derive it
  // from) and whenever the replay fails (same "no facts, no claim" contract
  // as `facts`).
  threat?: ThreatFacts;
  // Task K2 (conversion-aware judge, owner ruling 1): set only on a
  // "nudge" produced by the decided-position conversion path below (a
  // mate-distance slip/missed-mate/lost-mate from conversionForMove, or a
  // free-material giveaway derived from `threat`) — never on a nudge
  // reached through the ordinary deltaCp threshold, which needs no extra
  // copy the client doesn't already render generically. Lowercase, no
  // em-dashes, no emojis, per CLAUDE.md's coach-copy rule (this text
  // reaches the same judge surface, even though it isn't cookie's voice).
  conversionCopy?: string;
  // Round 3 Task 11 (item 5, trust floor): whether it is honest to assert "a
  // better move existed" for this verdict. Gated on either a delta big
  // enough to be a real edge (>= BETTER_CLAIM_MIN_CP) or a concrete tactical
  // reason (threat.motif is a capture/fork/mate/check, not a vague
  // "positional" preference or a quiet promotion) -- a sub-threshold gap
  // with no concrete motif is engine noise/style, not a claim the model or
  // judge copy should ever assert. False on the checkmate short-circuit
  // (there's no "after" position to compare against).
  claimsBetterMove: boolean;
}

// The user-facing "judge strictness" dial (how chatty the judge is; UI
// label "judge strictness" — NOT "advice level", which the PRD reserves for
// the future F13 comprehension-ELO dial, panel B5) — this table is its
// threshold seam. Every threshold below is a labeled starting value,
// playtest-calibrated at C5 (standard) / owner-calibratable (gentle,
// blunt, Task 6); none of them are final.
export const ADVICE_LEVELS: Record<string, { nudgeCp: number; warningCp: number }> = {
  standard: {
    nudgeCp: 60, // starting value: delta below this is silent (no comment)
    warningCp: 150, // starting value: delta at/above this (or any mateAgainst) is a warning
  },
  // Owner-calibratable starting value: less chatty than standard — higher
  // thresholds mean fewer nudges/warnings for the same delta.
  gentle: {
    nudgeCp: 90,
    warningCp: 200,
  },
  // Owner-calibratable starting value: more chatty than standard — lower
  // thresholds mean more nudges/warnings for the same delta.
  blunt: {
    nudgeCp: 40,
    warningCp: 110,
  },
};

export const DEFAULT_ADVICE_LEVEL = "standard";

// Fix (task-reviewer, post Task 6 approval — Critical): a plain
// `ADVICE_LEVELS[strictness]` bracket lookup on an untrusted string is
// unsafe — Object.prototype-colliding values ("constructor", "toString",
// "valueOf", "__proto__", etc.) resolve to a truthy inherited value (e.g.
// the Object constructor function) even though they were never assigned
// as keys, so a naive truthy check treats them as valid levels. This
// explicit literal allowlist is the single source of truth for "is this a
// real ADVICE_LEVELS key" — used both here (classifyMove's own level
// resolution) and by manager.ts's judgeMove, so neither layer can be
// fooled by a garbage string reaching in via POST /api/game/:id/judge's
// unvalidated strictness field.
export function isAdviceLevel(x: unknown): x is keyof typeof ADVICE_LEVELS {
  return x === "gentle" || x === "standard" || x === "blunt";
}

// Starting value: each of the two best-play evals classifyMove runs gets
// this much thinking time. Two of them (~700ms worst case) plus overhead
// stays inside the PRD's <2s p95 verdict-latency gate.
const EVAL_MOVETIME_MS = 350;

// Stand-in "centipawn" magnitude for a mate score, picked large enough that
// any mate always compares as decisively better/worse than any plausible
// material swing, while still ordering a faster mate ahead of a slower one.
const MATE_SCORE_CP = 100_000;

// Task K2 (owner ruling 1, context-v2-changes-and-contract.md section 2):
// "decided" for the purpose of the conversion-aware judge below — the SEED
// (before-move) eval is decided when it's already a mate, or |cp| is at
// least this band. Deliberately a SEPARATE owner-calibratable constant from
// adjudicate.ts's ADJUDICATE_WIN_CP (currently the same starting value,
// 300) rather than an import of it: importing it would create a circular
// dependency (adjudicate.ts already imports toMoverCp from this file), and
// this codebase's own precedent (adjudicate.ts's ADJUDICATE_MOVETIME_MS
// mirroring this file's EVAL_MOVETIME_MS) is exactly "two named constants,
// same value today, free to diverge later" rather than a shared import.
// Exported (opponent-move-analysis plan, Wave A, 2026-08-03): highlightLines.ts's
// `decided` flag imports this exact constant rather than re-declaring 300 a
// third time -- same value, same reasoning, one source of truth for "is this
// position already decided" across both consumers.
export const DECIDED_BAND_CP = 300;

// Round 3 Task 11 (item 5 / OD-5, trust floor -- "we shouldn't try to invent
// better moves for her to have done"): a surface may assert "a better move
// existed" only when the engine's own delta is at/above this, or the
// position carries a concrete tactical motif regardless of delta size (a
// hanging fork or a missed mate is worth naming even at a modest cp gap).
// Owner-calibratable starting value, decided in build per "don't ask her
// about colours and thresholds" -- verify against real play, not an ask-back.
export const BETTER_CLAIM_MIN_CP = 150;

// The motifs.ts vocabulary that counts as "concrete" for the gate above --
// deliberately excludes "positional" (a vague preference, not a reason) and
// "promotion-threat" (present but quiet; naming a promotion isn't the same
// as naming a capture/fork/mate/check the player can act on).
const CONCRETE_BETTER_MOVE_MOTIFS = new Set<ThreatMotif>([
  "capture-moved",
  "capture-other",
  "fork",
  "mate-threat",
  "check-threat",
]);

// Piece-letter -> plain-English name, scoped to this file's own copy the
// same way every other server/annotator/*.ts module keeps its own small
// map (continuation.ts, opportunity.ts) rather than a shared import.
const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

// Owner ruling 1's own example, verbatim: "still winning, but that gives
// back your knight for nothing." Lowercase, no em-dashes, no emojis.
function freeMaterialCopyFor(pieceKind: string): string {
  return `still winning, but that gives back your ${PIECE_NAMES[pieceKind] ?? "piece"} for nothing.`;
}

// mate-slip and missed-mate share this shape — the only difference between
// the two ConversionEvent kinds is how shallow the mate was to begin with
// (MISSED_MATE_DEPTH's gate in conversion.ts), not what she needs to hear.
// lost-mate gets its own line since there's no "mate in N" left to name.
function conversionCopyFor(event: MoveConversionEvent): string {
  if (event.kind === "lost-mate") {
    return "still winning, but the forced mate is gone for now.";
  }
  return `still winning, but there was a faster mate. mate in ${event.mateBefore} was there, now it's mate in ${event.mateAfter}.`;
}

// Exported for adjudicate.ts (Wave C, C-A): the "what governs when someone
// wants to stop" decision reuses this exact mover-perspective/mate-folding
// convention rather than reinventing it.
export function toMoverCp(ev: { cp: number | null; mate: number | null }): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? MATE_SCORE_CP - ev.mate : -(MATE_SCORE_CP - Math.abs(ev.mate));
  }
  return ev.cp ?? 0;
}

// Wave C hint escalation: turns the before-position eval's bestMove (a bare
// UCI string from Stockfish, e.g. "e2e4" or "e7e8q") into the SAN/piece/
// square facts the client needs, by replaying it on a fresh clone of the
// BEFORE position (never the passed-in `chess`, which already has the
// player's actual move applied). Returns undefined rather than throwing on
// anything unparseable — a missing bestMove, an engine hiccup, or (in
// principle) a stale/malformed UCI string — so a facts failure can never
// surface as a judge-call failure; see classifyMove's caller-facing
// "facts is just absent" contract.
export function deriveFacts(beforeFen: string, bestUci: string | undefined): MoveFacts | undefined {
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(beforeFen);
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;
    return { bestUci, bestSan: mv.san, bestPieceKind: piece.type, bestToSquare: to };
  } catch {
    return undefined;
  }
}

/**
 * The judge seam. C1 shipped this as a stub — no engine calls, always
 * "silent" — so the pending-move confirm loop (client) and the stateless
 * /judge route (server) had something real to build and test against. C2
 * (this file) replaces the body with real eval-delta math using
 * `evaluator`, but the signature is unchanged: `chess` is a clone with
 * `move` already applied (never the live game — callers must clone), so
 * this diffs against `move.before`/`move.after` (== chess.fen()) without
 * any extra plumbing. Never re-applies `move` — chess.js throws if you do.
 *
 * HARD CONSTRAINT (PRD gate, pinned by classify.test.ts): this file must
 * never import from server/coach/ — the verdict path is engine math only,
 * no LLM call, ever.
 */
export async function classifyMove(
  chess: Chess,
  move: Move,
  evaluator: Evaluator,
  level: string = DEFAULT_ADVICE_LEVEL
): Promise<Verdict> {
  const start = Date.now();

  // The proposed move is itself checkmate — the mover just won outright.
  // Never warn on a winning move, and there's no legal "after" position
  // left to evaluate (no replies exist), so short-circuit before touching
  // the evaluator.
  if (chess.isCheckmate()) {
    return {
      tier: "silent",
      deltaCp: 0,
      mateAgainst: false,
      mateBefore: null,
      mateAfter: null,
      latencyMs: Date.now() - start,
      claimsBetterMove: false,
    };
  }

  // Defensive fallback: an unrecognized level (stale/garbled client value,
  // or an Object.prototype-colliding string like "constructor" — see
  // isAdviceLevel's comment) judges at standard rather than resolving to
  // an inherited non-threshold value or throwing on an undefined lookup.
  const { nudgeCp, warningCp } = isAdviceLevel(level) ? ADVICE_LEVELS[level] : ADVICE_LEVELS[DEFAULT_ADVICE_LEVEL];

  const [beforeEval, afterEval] = await Promise.all([
    evaluator.evaluate(move.before, EVAL_MOVETIME_MS),
    evaluator.evaluate(chess.fen(), EVAL_MOVETIME_MS),
  ]);

  // beforeEval is already from the mover's perspective (they were the side
  // to move in move.before). afterEval is reported from the opponent's
  // perspective (it's their move in the post-move position) — negate it to
  // get back to the mover's perspective.
  const mateAgainst = afterEval.mate !== null && afterEval.mate > 0;
  const mateForMover = afterEval.mate !== null && afterEval.mate < 0;

  // Wave 1 (item 2 -- typed mate): the mate distance on each side, mover
  // perspective. beforeEval is already mover-perspective (she was to move in
  // move.before). afterEval is opponent-perspective (their move now) -- negate
  // it. By construction these agree with the two booleans above: mateAgainst
  // <=> mateAfter < 0, mateForMover <=> mateAfter > 0.
  const mateBefore = beforeEval.mate;
  const mateAfter = afterEval.mate === null ? null : -afterEval.mate;

  const bestEvalCp = toMoverCp(beforeEval);
  const actualEvalCp = -toMoverCp(afterEval);
  const deltaCp = bestEvalCp - actualEvalCp;

  // Computed for every non-checkmate verdict regardless of tier — cheap
  // (pure chess.js replay, no extra eval call) and the client already
  // gates rendering to nudge/warning, so there's no reason to withhold it
  // for silent.
  const facts = deriveFacts(move.before, beforeEval.bestMove);

  // Same "computed for every non-checkmate verdict" reasoning as facts
  // above: cheap (pure chess.js replay of already-computed engine output),
  // and gating it to warning/nudge tiers would just make the client redo
  // the same check for no benefit. Moved above the tier decision (Task K2)
  // because the free-material check below now reads it too — no new engine
  // call either way, still the SAME already-paid-for afterEval.
  // Controller follow-up (issue A, 2026-07-22 truthfulness-leaks review):
  // move.captured is the literal fact for what HER OWN move captured (chess.js
  // sets this only on a capturing move) -- read here, threaded straight
  // through, never re-derived inside motifs.ts.
  const threat = deriveThreatFacts(chess.fen(), move.to, move.color, afterEval, move.captured);

  // Task K2 (owner ruling 1): "decided" reads the SEED (before-move) eval —
  // already a mate, or already at/above DECIDED_BAND_CP — never the
  // after-move eval, since the whole point is catching a move that THROWS
  // AWAY a position that was already won, not one that merely lands in a
  // winning one.
  //
  // Union review fix (H4, 2026-07-31): this used to be `beforeEval.mate !==
  // null || Math.abs(beforeEval.cp ?? 0) >= DECIDED_BAND_CP` -- Math.abs
  // made it SIGN-BLIND, so a position she is decidedly LOSING (cp -600, a
  // mate reading against her) counted as "decided" exactly like a position
  // she is decidedly winning. The only consumer this actually reaches is
  // the free-material branches below, whose hardcoded copy ("still
  // winning, but that gives back your {piece} for nothing.") is only ever
  // true when SHE holds the lead. Made directional: a mate reading only
  // counts when it favors the mover (mate > 0 -- mateForMover's own
  // decided-mate branch already independently requires this via
  // conversionForMove's `before.mate <= 0` bail, so this mate clause is
  // belt-and-suspenders for that path, not load-bearing there), and the cp
  // reading only counts as a genuine lead, never a genuine deficit.
  const decided = (beforeEval.mate !== null && beforeEval.mate > 0) || (beforeEval.cp ?? 0) >= DECIDED_BAND_CP;

  // Mate-distance conversion (missed-mate/mate-slip/lost-mate): the SAME
  // math conversion.ts's detectMateEvents runs over a whole game, applied
  // to this one move via conversionForMove — zero new engine calls, reuses
  // beforeEval/afterEval exactly as computed above. Only ever attempted in
  // a decided position (conversionForMove itself also independently
  // requires before.mate > 0, so this gate is belt-and-suspenders, not
  // load-bearing on its own).
  const mateConversion = decided
    ? conversionForMove({ cp: beforeEval.cp, mate: beforeEval.mate }, { cp: afterEval.cp, mate: afterEval.mate }, move.before, move.san)
    : null;

  // Free material for nothing: her move made no capture of its own
  // (move.captured is the literal fact for what SHE captured — undefined
  // means her move was quiet), and the opponent's already-computed best
  // reply (threat, from the SAME afterEval) captures right back the exact
  // piece she just moved, with no legal recapture available. That is a
  // clean giveaway, not a trade — deliberately narrow (precision over
  // recall, same discipline as motifs.ts's defender-grounding): an
  // unfavorable TRADE (her move itself a capture, just an uneven one) is
  // a different, not-yet-built check, never guessed at here.
  const freeMaterialPieceKind =
    decided && !move.captured && threat?.capturesHerJustMovedPiece === true && threat.capturedSquareDefended === false
      ? threat.capturedPieceKind
      : undefined;

  // Wave 1 (item 2 -- typed mate): lost-mate routing is now EXPLICIT off the
  // typed fields rather than an accident of the MATE_SCORE_CP fold. She HELD a
  // forced mate (mateBefore > 0) and the move no longer keeps one for her (not
  // mateForMover) -- route to warning independent of the folded deltaCp
  // magnitude. Today the fold already inflates such a delta past warningCp, so
  // this term changes no verdict on its own (belt-and-suspenders); it exists
  // so the routing survives any future change that stops inflating deltaCp.
  const lostMate = mateBefore !== null && mateBefore > 0 && !(mateAfter !== null && mateAfter > 0);

  let tier: Verdict["tier"];
  let conversionCopy: string | undefined;
  if (mateForMover) {
    // Owner ruling 1: the move still keeps the mate for the mover — the
    // best possible outcome — but that no longer short-circuits straight
    // to silent unconditionally. A genuine mate-distance slip (or a clean
    // free-material giveaway inside the same still-active mate run, e.g.
    // game 160's plies 123-124) still gets a nudge; an on-schedule mate
    // stays silent exactly as before.
    if (mateConversion) {
      tier = "nudge";
      conversionCopy = conversionCopyFor(mateConversion);
    } else if (freeMaterialPieceKind && deltaCp >= nudgeCp) {
      // Wave 1 (verdict truth layer): the free-material nudge fires only with
      // engine corroboration -- deltaCp >= nudgeCp -- even inside a still-live
      // mate run. See the game-164 WHY comment on the non-mate branch below:
      // the one-ply scan may never out-vote the engine's own delta.
      tier = "nudge";
      conversionCopy = freeMaterialCopyFor(freeMaterialPieceKind);
    } else {
      tier = "silent";
    }
  } else if (mateAgainst || deltaCp >= warningCp || lostMate) {
    tier = "warning";
    // M4 fix (union review, 2026-07-31): conversionCopyFor's "lost-mate"
    // branch was unreachable dead code -- its only call site sat inside the
    // `if (mateForMover)` block above, which requires afterEval.mate !==
    // null, but conversionForMove only ever RETURNS "lost-mate" when
    // afterMate IS null (the mate reading vanished). The two conditions
    // were mutually exclusive by construction, so the single most severe
    // conversion failure -- throwing away a forced mate outright -- landed
    // here instead, via the ordinary deltaCp/warningCp path (the
    // MATE_SCORE_CP stand-in makes that delta enormous), with the generic
    // "careful, this one hurts" badge and no conversionCopy at all. mateConversion
    // is already computed above (decided-gated, zero new engine calls) --
    // this just threads what it already found into the tier that's actually
    // reachable, rather than leaving her losing-a-mate story untold.
    if (mateConversion) conversionCopy = conversionCopyFor(mateConversion);
  } else if (deltaCp >= nudgeCp) {
    tier = "nudge";
    // Wave 1 (verdict truth layer, game-164 Nf6+ incident): the free-material
    // heuristic may NEVER out-vote the engine. The one-ply scan below
    // (freeMaterialPieceKind) sees only "her piece is recaptured next move
    // with no legal recapture" and cries giveaway -- it cannot see the rest
    // of the line. In game 164 she previewed Nf6+, the engine's OWN best
    // move: Nf6+ gxf6 Bxa8 wins the exchange (deltaCp ~= 0), yet the scan
    // flagged it "gives back your knight for nothing." INVARIANT: a deltaCp
    // below the nudge floor means the engine says the material comes back in
    // the line, so the "for nothing" copy would be false -- the free-material
    // heuristic stays silent, and the engine out-votes the one-ply scan,
    // always. Attaching the copy on THIS branch (deltaCp >= nudgeCp) is the
    // corroboration gate: the copy only ever fires when the engine agrees the
    // move loses at least a nudge's worth. (Previously a separate
    // below-nudgeCp `else if (decided && freeMaterialPieceKind)` branch fired
    // it with no such gate -- that was the false-positive path.)
    if (freeMaterialPieceKind) conversionCopy = freeMaterialCopyFor(freeMaterialPieceKind);
  } else {
    tier = "silent";
  }

  // Round 3 Task 11: the concrete-motif half of the gate reads `threat` --
  // already computed above for every non-checkmate verdict, zero new engine
  // calls. Math.abs guards the (rare, eval-noise) case where deltaCp comes
  // back negative.
  const claimsBetterMove =
    Math.abs(deltaCp) >= BETTER_CLAIM_MIN_CP || (threat !== undefined && CONCRETE_BETTER_MOVE_MOTIFS.has(threat.motif));

  return { tier, deltaCp, mateAgainst, mateBefore, mateAfter, latencyMs: Date.now() - start, facts, threat, conversionCopy, claimsBetterMove };
}
