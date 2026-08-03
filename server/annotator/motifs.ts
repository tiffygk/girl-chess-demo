import { Chess, type Color, type Move, type Square } from "chess.js";
import type { Evaluation } from "../engines/types";

// Increment 2.7 (why-hints): every judge call already computes the
// opponent's best refutation of her move (afterEval.bestMove/pv in
// classifyMove) and discards it. That refutation is the "why" — this file
// turns it into structured, provably-true facts by replaying it with
// chess.js, the same defensive pattern classify.ts's deriveFacts uses
// (slice uci, promotion ?? "q", try/catch, null-check). Zero new engine
// calls: afterEval is already-paid-for engine output.
//
// HONESTY GATE (product rule, enforced by construction): every populated
// field on ThreatFacts must be literally true from the chess.js replay
// below. Optional fields stay undefined outside the motif branch that
// derived them — a template reading a field outside its motif would be
// fabricating, not reporting.
export type ThreatMotif =
  | "capture-moved"
  | "capture-other"
  | "fork"
  | "mate-threat"
  | "check-threat"
  // Wave 1 (item 3 -- tier-1 motif fields): a QUIET promoting refutation
  // (promotion, no capture, no check/mate/fork) -- the opponent is about to
  // make a new queen. A capturing promotion stays a capture motif and a
  // mating promotion stays mate-threat; only the otherwise-quiet promotion
  // lands here (see deriveThreatFacts's ordering).
  | "promotion-threat"
  | "positional";

export interface ThreatFacts {
  motif: ThreatMotif;
  refutationUci: string;
  refutationSan: string;
  refutationPieceKind: string;
  refutationFromSquare: string;
  refutationToSquare: string;
  givesCheck: boolean;
  capturesSquare?: string; // REAL captured square (en passant resolved), only on capture motifs
  capturedPieceKind?: string; // only on capture motifs
  capturesHerJustMovedPiece: boolean;
  forkTargets?: { square: string; pieceKind: string }[]; // only when motif === "fork", length >= 2
  // Controller follow-up (issue A, 2026-07-22 truthfulness-leaks review):
  // the piece kind HER OWN move captured, if it was a capture at all --
  // distinct from capturedPieceKind above, which is what the REFUTATION
  // captures FROM her (for capture-moved, always the same piece she just
  // moved, since the refutation recaptures exactly there -- it carries no
  // information about what she herself won). Caller-supplied, never
  // re-derived here: the caller (classify.ts) already has her own chess.js
  // Move object in hand, and `.captured` on it is the literal fact.
  // Undefined when her move wasn't a capture.
  herCapturedPieceKind?: string;
  // Task 1 (defender grounding): true when the player has a LEGAL recapture
  // on the actual captured square -- a defended capture is a trade, not a
  // clean loss. Deliberately NOT a geometric attackers() check: a piece that
  // only geometrically guards the square but is pinned to its own king
  // cannot legally recapture, so it must not count as a defender. Always
  // present; only meaningful on capture motifs (false otherwise, since
  // there's nothing to defend).
  capturedSquareDefended: boolean;
  // Round 3 (Q4, trace-180): a LEGAL recapture existing (capturedSquareDefended)
  // is a geometric/legal-move fact, not a proof that recapturing is actually
  // safe -- trace-180 (game 167, currentFen w/ her move g2-g4): the h-pawn
  // CAN legally take hxg4, but doing so drops the h1 rook to Qxh1, an
  // overload the "defended" framing hid entirely (owner feedback, verbatim:
  // "the defending pawn can't take back without the queen taking the
  // rook"). Derived from afterEval.pv (already-computed, zero new engine
  // calls): true unless the engine's OWN best continuation either declines
  // the recapture outright (afterEval.pv[1] doesn't land on the captured
  // square -- the strongest signal that "defended" doesn't functionally
  // hold) or takes it and then immediately loses something of greater
  // value on the very next move (deflection/overload). Defaults true for
  // the non-defended case (nothing to disprove) and whenever afterEval.pv
  // is too short to check.
  recaptureHolds: boolean;
  // The SAN of the move that makes recapturing not worth it -- either the
  // engine's own declining move (case above) or the follow-up capture that
  // wins more than the recapture itself. Present only when recaptureHolds
  // is false.
  recaptureRefusalReason?: string;
}

// Round 3 (Q4): standard relative piece values for the "captures something
// bigger" comparison below -- king excluded (never a capture target).
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const MINOR_PLUS = new Set(["n", "b", "r", "q"]);

// Fork detection: chess.js's attackers() is a static map of the CURRENT
// position — it does not model what happens one ply later (an interposition,
// a pin that makes recapture illegal, a defender). So a fork here is a
// shape-claim ("forks") never an outcome-claim ("wins the rook"): the
// template layer must never upgrade "forks your knight and rook" into a
// promise that material is actually won.
function detectFork(probe: Chess, attackerSq: Square, herColor: Color): { square: string; pieceKind: string }[] {
  const oppColor: Color = herColor === "w" ? "b" : "w";
  const targets: { square: string; pieceKind: string }[] = [];
  for (const row of probe.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== herColor) continue;
      if (cell.type === "k") {
        if (probe.inCheck()) targets.push({ square: cell.square, pieceKind: "k" });
        continue;
      }
      if (!MINOR_PLUS.has(cell.type)) continue;
      if (probe.attackers(cell.square as Square, oppColor).includes(attackerSq)) {
        targets.push({ square: cell.square, pieceKind: cell.type });
      }
    }
  }
  return targets;
}

// Shared by deriveThreatFacts and deriveRecommendationFacts below: for an
// en-passant capture, chess.js's mv.to is the empty landing square, not the
// square the captured pawn actually stood on. capturedColor is the CAPTURED
// pawn's own color (not the mover's) — verified against chess.js directly: a
// white pawn's double move e2-e4 is captured en passant landing on rank 3
// with the captured white pawn still on rank 4 (landing+1); a black pawn's
// double move d7-d5 is captured landing on rank 6 with the captured black
// pawn on rank 5 (landing-1).
export function resolveCaptureSquare(mv: Move, capturedColor: Color): string {
  if (!mv.flags.includes("e")) return mv.to;
  return mv.to[0] + String(Number(mv.to[1]) + (capturedColor === "w" ? 1 : -1));
}

// afterFen: position AFTER her move, opponent to move. herToSquare: where
// her piece landed (used to detect the capture-moved motif). afterEval: the
// ALREADY-COMPUTED eval from classifyMove's afterEval — no new engine call.
// Returns undefined on malformed/missing bestMove or replay failure (same
// "facts is just absent" contract as classify.ts's deriveFacts).
// herCapturedPieceKind (controller follow-up, issue A): optional, caller-
// supplied fact about HER OWN move -- read it off her own chess.js Move
// object's `.captured` at the call site (classify.ts) and pass it straight
// through here. This function never re-derives it (it has no access to her
// own move at all, only the position after it), it just threads it onto the
// returned facts unchanged.
export function deriveThreatFacts(
  afterFen: string,
  herToSquare: string,
  herColor: "w" | "b",
  afterEval: Evaluation,
  herCapturedPieceKind?: string
): ThreatFacts | undefined {
  const bestUci = afterEval.bestMove;
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(afterFen);
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;

    // Her pawn is the one potentially captured en passant here, so it's her
    // own color that the shared helper needs to resolve the real square.
    const actualCaptureSquare = resolveCaptureSquare(mv, herColor);
    const isCapture = Boolean(mv.captured);
    const capturesHerJustMovedPiece = isCapture && actualCaptureSquare === herToSquare;
    // probe is now the position AFTER the opponent's refutation capture, with
    // herColor (the player) to move -- so a LEGAL move landing on the
    // captured square (a real recapture) answers "can she recapture right
    // now," the literal test for a trade. chess.js's attackers() is purely
    // geometric and would count a piece that is pinned to its own king (and
    // therefore cannot legally recapture) as a defender -- moves({verbose})
    // only returns legal moves, so a pinned "defender" correctly drops out.
    const capturedSquareDefended = isCapture
      ? probe
          .moves({ verbose: true })
          .some((m) => m.to === actualCaptureSquare && (m.flags.includes("c") || m.flags.includes("e")))
      : false;

    let motif: ThreatMotif;
    if (isCapture && capturesHerJustMovedPiece) {
      motif = "capture-moved";
    } else if (isCapture) {
      motif = "capture-other";
    } else if (detectFork(probe, mv.to as Square, herColor).length >= 2) {
      motif = "fork";
    } else if (probe.isCheckmate() || (afterEval.mate !== null && afterEval.mate > 0)) {
      // Must outrank check-threat below: a mating move also gives check, so
      // checking inCheck() first would misclassify every mate as a mere check.
      motif = "mate-threat";
    } else if (probe.inCheck()) {
      motif = "check-threat";
    } else if (mv.promotion) {
      // Wave 1 (item 3): a QUIET promoting refutation -- placed after the
      // mate/check checks (a mating promotion stayed mate-threat, a checking
      // one check-threat) and before positional. A capturing promotion never
      // reaches here (the isCapture branches above already claimed it). No new
      // per-motif fields: refutationPieceKind ("p") + refutationToSquare
      // already carry the whole story (the promoted-to piece is derivable
      // later if ever needed -- YAGNI now).
      motif = "promotion-threat";
    } else {
      motif = "positional";
    }

    // Round 3 (Q4, trace-180): only meaningful when a legal recapture
    // exists at all -- `probe` here is already the position right after
    // the refutation capture, herColor to move, exactly what pv[1] onward
    // describes. afterEval.pv[0] is the refutation itself (bestUci, already
    // replayed above as `mv`); pv[1] is the engine's own chosen reply.
    //
    // Whole-branch review correction (2026-08-03, Important finding 2): this
    // used to also flip recaptureHolds false whenever pv[1] simply wasn't
    // the recapture ("the engine declines it"). That is NOT evidence the
    // recapture loses material -- a stronger zwischenzug can exist even when
    // the recapture is perfectly safe, and this afterEval carries no fact at
    // all about what recapturing actually leads to in that case (the pv
    // never plays or evaluates it). "No facts, no claim": only the branch
    // below, where the engine's OWN line actually plays the recapture and
    // then demonstrates a concrete follow-up loss, is real evidence.
    let recaptureHolds = true;
    let recaptureRefusalReason: string | undefined;
    if (capturedSquareDefended && afterEval.pv.length >= 3) {
      const pv1 = afterEval.pv[1];
      if (pv1 && pv1.length >= 4 && pv1.slice(2, 4) === actualCaptureSquare) {
        // The recapture DOES happen in the engine's own line -- check
        // whether the very next move then grabs something worth more than
        // what was just recaptured (deflection/overload one ply deeper than
        // the simple "does a legal recapture exist" check).
        try {
          const recaptureProbe = new Chess(probe.fen());
          const recaptureMv = recaptureProbe.move({
            from: pv1.slice(0, 2),
            to: pv1.slice(2, 4),
            promotion: (pv1.slice(4, 5) as "q" | "r" | "b" | "n" | undefined) ?? "q",
          });
          const recapturedValue = recaptureMv?.captured ? (PIECE_VALUE[recaptureMv.captured] ?? 0) : 0;
          const pv2 = afterEval.pv[2];
          const pv2Mv = pv2 && pv2.length >= 4
            ? recaptureProbe.move({
                from: pv2.slice(0, 2),
                to: pv2.slice(2, 4),
                promotion: (pv2.slice(4, 5) as "q" | "r" | "b" | "n" | undefined) ?? "q",
              })
            : null;
          const followUpValue = pv2Mv?.captured ? (PIECE_VALUE[pv2Mv.captured] ?? 0) : 0;
          // Union-review correction: a bigger follow-up capture is only real
          // evidence of an overload if the player has no legal recapture ON
          // the follow-up's own captured square -- otherwise the trade just
          // continues one ply deeper (recaptureProbe is already advanced
          // past pv2Mv, her side to move) and can be even or favorable, not
          // a proven net loss.
          if (pv2Mv?.captured && followUpValue > recapturedValue) {
            const followUpSquare = resolveCaptureSquare(pv2Mv, herColor);
            const canRerecapture = recaptureProbe
              .moves({ verbose: true })
              .some((m) => m.to === followUpSquare && (m.flags.includes("c") || m.flags.includes("e")));
            if (!canRerecapture) {
              recaptureHolds = false;
              recaptureRefusalReason = pv2Mv.san;
            }
          }
        } catch {
          // Replay failed -- leave recaptureHolds true; nothing proven.
        }
      }
    }

    const facts: ThreatFacts = {
      motif,
      refutationUci: bestUci,
      refutationSan: mv.san,
      refutationPieceKind: piece.type,
      refutationFromSquare: mv.from,
      refutationToSquare: mv.to,
      givesCheck: probe.inCheck(),
      capturesHerJustMovedPiece,
      capturedSquareDefended,
      herCapturedPieceKind,
      recaptureHolds,
    };
    if (recaptureRefusalReason) facts.recaptureRefusalReason = recaptureRefusalReason;

    if (motif === "capture-moved" || motif === "capture-other") {
      facts.capturesSquare = actualCaptureSquare;
      facts.capturedPieceKind = mv.captured;
    }
    if (motif === "fork") {
      facts.forkTargets = detectFork(probe, mv.to as Square, herColor);
    }

    return facts;
  } catch {
    return undefined;
  }
}

// Increment 3a Wave 1 (recommendation facts): the mirror of deriveThreatFacts
// above. Where that function answers "why does her move fail" (the
// opponent's discarded refutation), this answers "why is the RECOMMENDED
// move good" — the hint's own chosen best move, derived the same
// never-fabricate way: replay bestUci with chess.js on a clone of the BEFORE
// position (her position, before she plays) and report only what's
// literally true of that replay. Same HONESTY GATE as ThreatFacts: every
// populated field must be provably true from the replay below; optional
// fields stay undefined outside the accomplishment branch that derived them.
export type RecommendationAccomplishment =
  | "captures"
  | "gives-check"
  | "gives-mate"
  | "forks"
  | "attacks"
  // Wave 1 (item 3 -- tier-1 motif fields): two quiet accomplishments that
  // otherwise fall into develops. "promotes" = a quiet promotion (a
  // capture-promotion stays "captures" -- the material story is the honest
  // one); "castles" = a castling move.
  | "promotes"
  | "castles"
  | "develops";

export interface RecommendationFacts {
  accomplishment: RecommendationAccomplishment;
  pieceKind: string; // the recommended piece
  fromSquare: string;
  toSquare: string;
  san: string;
  capturesSquare?: string; // real square (en passant resolved), only on "captures"
  capturedPieceKind?: string; // only on "captures"
  forkTargets?: { square: string; pieceKind: string }[]; // only on "forks", length >= 2
  attackedSquare?: string; // only on "attacks"
  attackedPieceKind?: string; // only on "attacks"
}

// beforeFen: HER position, before her pending move. bestUci: the deep
// search's best move (hint.ts's already-verified chosen move — zero extra
// engine calls here, pure chess.js). Returns undefined on malformed/missing
// bestUci or replay failure, same "facts is just absent" contract as
// deriveThreatFacts and classify.ts's deriveFacts.
export function deriveRecommendationFacts(beforeFen: string, bestUci: string): RecommendationFacts | undefined {
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(beforeFen);
    const moverColor: Color = probe.turn();
    const oppColor: Color = moverColor === "w" ? "b" : "w";
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;

    const facts: RecommendationFacts = {
      accomplishment: "develops",
      pieceKind: piece.type,
      fromSquare: mv.from,
      toSquare: mv.to,
      san: mv.san,
    };

    const isCapture = Boolean(mv.captured);
    if (isCapture) {
      // The captured piece is always the opponent's, so oppColor (not
      // moverColor) is what the shared ep helper needs.
      facts.accomplishment = "captures";
      facts.capturesSquare = resolveCaptureSquare(mv, oppColor);
      facts.capturedPieceKind = mv.captured;
    } else if (probe.isCheckmate()) {
      // Must outrank gives-check below for the same reason as
      // deriveThreatFacts's mate-threat/check-threat ordering: a mating
      // move also gives check.
      facts.accomplishment = "gives-mate";
    } else if (probe.inCheck()) {
      facts.accomplishment = "gives-check";
    } else if (mv.flags.includes("k") || mv.flags.includes("q")) {
      // Wave 1 (item 3): castling ("k"/"q" chess.js flags). Quiet by nature,
      // so it currently lands in develops -- checked before the
      // fork/attack/develops chain. A castling move that also gave check
      // stayed gives-check above (the check is the more salient story).
      facts.accomplishment = "castles";
    } else if (mv.promotion) {
      // Wave 1 (item 3): a quiet promotion. A capture-promotion never reaches
      // here (the isCapture branch above claimed it as "captures"); a
      // promotion that checked/mated stayed gives-check/gives-mate above.
      facts.accomplishment = "promotes";
    } else {
      // Colors inverted from deriveThreatFacts's detectFork call above: there
      // herColor (the target color) was the human player's own color, since
      // the opponent's refutation attacks HER pieces. Here the recommended
      // move is HERS, so the targets are the OPPONENT's pieces — oppColor is
      // the target-color argument detectFork expects. Since we only reach
      // this branch when the earlier checkmate/check checks came back false,
      // detectFork can never smuggle in the king here (it only adds the king
      // target when probe.inCheck() is true).
      const targets = detectFork(probe, mv.to as Square, oppColor);
      if (targets.length >= 2) {
        facts.accomplishment = "forks";
        facts.forkTargets = targets;
      } else if (targets.length === 1) {
        facts.accomplishment = "attacks";
        facts.attackedSquare = targets[0].square;
        facts.attackedPieceKind = targets[0].pieceKind;
      } else {
        facts.accomplishment = "develops";
      }
    }

    return facts;
  } catch {
    return undefined;
  }
}
