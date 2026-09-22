import { Chess } from "chess.js";
import { splitSentences } from "./defenseClaims";

// Game 198 fixes round (2026-09-21), cause 2 of the coach correctness map:
// nothing previously checked a RELATION claim (can take, attacks, lines up
// with) against the board, and the fact list has no after-move relations.
// 17 of her 59 thumbs-down notes since game 151 are this class. Modeled on
// defenseClaims.ts's guard/safety checkers (same file header, same
// splitSentences use, same chess.js-only no-engine-call discipline), but
// covers the wider attack/capture/line-of-sight vocabulary those two
// checkers deliberately leave out. "guard"/"defend" are excluded here on
// purpose -- checkDefenseClaims already owns those two verbs, and double
// flagging the same sentence from two checkers would be worse than a gap.
//
// Two claim shapes:
//  A) a standing piece on a square relates to another square NOW
//     ("the pawn on c7 attacks d6", "c7 attacks your queen on d6",
//     "the pawn on c7 can't reach d6").
//  B) a hypothetical: "<piece> to <sq> attacks/eyes/sees <sq2>" -- play the
//     named piece's move (if legal) and judge the relation on the resulting
//     board. If no legal move puts that piece kind on that square, the
//     claim can't be adjudicated and is skipped -- not this checker's job to
//     invent a different violation class for an illegal-move claim.

const SQ = "[a-h][1-8]";
const PIECE = "pawn|knight|bishop|rook|queen|king";
const NEGATION_WORDS = new Set(["can't", "cant", "cannot", "does not", "doesn't", "doesnt", "could not", "couldn't"]);

// Filler words that mark a PASS-THROUGH square rather than the target: "hits
// the king through e7 to f8" names e7 only as a waypoint, not the claimed
// relation's target (game 198 dry-run false alarm, trace 360). The filler
// between the verb and the target square must stop at the first of these,
// so a square named only as a waypoint is never read as the target.
const PASSTHROUGH_STOP = "through|via|along|past";

// Clause-boundary words: the filler between the verb and the target square
// must also stop here, so a square in the NEXT clause is never read as this
// claim's target (game 198 dry-run false alarm, trace 165: "knight to b2
// hits your queen, but your bishop on c1 covers b2..." matched "c1" as the
// target before this fix, reaching straight across the ", but " boundary
// into an unrelated clause). Punctuation (comma/semicolon/colon) is
// checked separately since it isn't a \b-delimited word.
const CLAUSE_STOP = "but|and|so|while";
const CLAUSE_PUNCTUATION = "[,;:]";

export function standingRelationRe(): RegExp {
  // group 1: sqA, group 2: piece (optional), group 3: negation/verb prefix
  // (checked for negation), group 4: the verb, group 5: sqB.
  // The filler between the verb and sqB stops at a pass-through word
  // (PASSTHROUGH_STOP) or another square -- so "hits the king through e7 to
  // f8" never matches at all (e7 is a waypoint, not a target, and the
  // filler is cut off before "through" reaches it), rather than being
  // misread as a claim about e7.
  return new RegExp(
    `\\b(?:your|her|mallow'?s|the)?\\s*(${PIECE})\\s+on\\s+(${SQ})\\s+(can'?t|cannot|can|could|does not|doesn'?t|)\\s*(take|capture|reach|attack|attacks|hit|hits|eye|eyes|see|sees|line up with|lines up with)\\b(?:(?!\\b(?:${PASSTHROUGH_STOP}|${CLAUSE_STOP})\\b)(?!${CLAUSE_PUNCTUATION})(?!\\b${SQ}\\b).){0,40}?\\b(${SQ})\\b`,
    "gi"
  );
}

export function bareSquareRelationRe(): RegExp {
  // group 1: sqA, group 2: the verb phrase (checked for negation), group 3: sqB.
  // A negative lookbehind excludes "<piece> to <sq> attacks <sq2>" -- that's
  // the Shape B hypothetical, handled separately; without the lookbehind,
  // "bishop to d6 attacks c7" also parses as the bare standing claim "d6
  // attacks c7" against the PRE-move board, a false-positive collision.
  return new RegExp(
    `(?<!\\bto\\s)\\b(${SQ})\\s+(attacks|hits|eyes|sees|takes|can take|can'?t take|cannot take|can'?t reach|cannot reach)\\s+(?:your|her|mallow'?s|the)?\\s*(?:${PIECE})?\\s*(?:on\\s+)?(${SQ})\\b`,
    "gi"
  );
}

export function hypotheticalRelationRe(): RegExp {
  // group 1: piece, group 2: destination square, group 3: the verb, group 4: target square
  // Up to 40 chars of filler ("does that instead, ") may separate
  // "<piece> to <sq>" from the verb (game 198 dry-run miss, trace 369), and
  // the verb list includes -ing forms (the coach narrates in the present
  // progressive as often as the simple present).
  return new RegExp(
    `\\b(${PIECE})\\s+to\\s+(${SQ})\\b(?:(?!\\b(?:attacks|hits|eyes|sees|lines up with|threatens|attacking|hitting|eyeing|seeing|lining up with|threatening)\\b).){0,40}?\\b(attacks|hits|eyes|sees|lines up with|threatens|attacking|hitting|eyeing|seeing|lining up with|threatening)\\b(?:(?!\\b(?:${CLAUSE_STOP})\\b)(?!${CLAUSE_PUNCTUATION})(?!\\b${SQ}\\b).){0,40}?\\b(${SQ})\\b`,
    "gi"
  );
}

function isNegated(phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  return NEGATION_WORDS.has(p);
}

function relationHolds(chess: Chess, a: string, b: string): boolean {
  const from = a.toLowerCase() as Parameters<typeof chess.get>[0];
  const to = b.toLowerCase() as Parameters<typeof chess.get>[0];
  const piece = chess.get(from);
  if (!piece) return false;
  return chess.attackers(to, piece.color).includes(from);
}

// A NEGATED claim ("can't take", "cannot reach", ...) is judged by legal
// moves, not by geometric attackers() -- attackers() ignores pins, so a
// pinned piece's TRUE denial ("the knight on e5 can't take g4" while pinned
// to its own king) was flagged as false (review-C Minor). If the source
// piece doesn't belong to the side to move on this board, legality here
// can't adjudicate the denial at all -- return null so the caller skips
// this board rather than treating it as confirming or refuting the claim.
function deniedCaptureHolds(chess: Chess, a: string, b: string): boolean | null {
  const from = a.toLowerCase() as Parameters<typeof chess.get>[0];
  const to = b.toLowerCase() as Parameters<typeof chess.get>[0];
  const piece = chess.get(from);
  if (!piece) return null;
  if (piece.color !== chess.turn()) return null;
  const legal = chess.moves({ verbose: true }).some((mv) => mv.from === from && mv.to === to);
  return legal; // "can take" is true (denial is false) iff a legal move exists
}

// Truth of a standing claim over the intersection of [fen, ...otherFens]:
// the claim only survives as a violation if it is false on EVERY board
// offered (same intersection discipline as checkPlacementClaims). Boards
// where a negated claim can't be adjudicated (deniedCaptureHolds returns
// null) are skipped rather than counted either way.
function standingClaimFalseEverywhere(
  fens: string[],
  a: string,
  b: string,
  claimsRelation: boolean
): boolean {
  let adjudicated = false;
  for (const fen of fens) {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      continue;
    }
    if (!claimsRelation) {
      const canTake = deniedCaptureHolds(chess, a, b);
      if (canTake === null) continue; // can't adjudicate this denial on this board -- skip it
      adjudicated = true;
      const truth = canTake; // "a attacks b" is true iff a legal capture exists
      if (claimsRelation === truth) return false; // true on at least one board -- not a violation
      continue;
    }
    adjudicated = true;
    const truth = relationHolds(chess, a, b);
    if (claimsRelation === truth) return false; // true on at least one board -- not a violation
  }
  return adjudicated; // no violation if no board could adjudicate the claim at all
}

export function checkRelationClaims(text: string, fen: string, otherFens: string[] = []): string[] {
  const fens = [fen, ...otherFens.filter((f): f is string => !!f)];
  const violations: string[] = [];
  const flagged = new Set<string>();

  for (const sentence of splitSentences(text)) {
    // Shape A: "<piece> on <sq> <verb> <sq2>"
    for (const m of sentence.matchAll(standingRelationRe())) {
      const [, , sqA, negPrefix, verb, sqB] = m;
      const verbWord = verb.toLowerCase();
      if (verbWord === "reach" && !negPrefix) continue; // "reach" alone (no negation) is too vague to be an attack claim
      const a = sqA.toLowerCase();
      const b = sqB.toLowerCase();
      if (a === b) continue;
      const key = `${a}>${b}`;
      if (flagged.has(key)) continue;
      const claims = !isNegated(negPrefix);
      if (standingClaimFalseEverywhere(fens, a, b, claims)) {
        flagged.add(key);
        const truth = !claims;
        violations.push(`relation-claim: ${a} ${claims ? "does" : "does not"} attack ${b} -- it ${truth ? "does" : "does not"}`);
      }
    }

    // Shape A (bare square form): "<sq> attacks <sq2>" / "<sq> can't take <sq2>"
    for (const m of sentence.matchAll(bareSquareRelationRe())) {
      const [, sqA, verbPhrase, sqB] = m;
      const a = sqA.toLowerCase();
      const b = sqB.toLowerCase();
      if (a === b) continue;
      const key = `${a}>${b}`;
      if (flagged.has(key)) continue;
      const vp = verbPhrase.toLowerCase();
      const claims = !(vp.includes("can't") || vp.includes("cant") || vp.includes("cannot"));
      if (standingClaimFalseEverywhere(fens, a, b, claims)) {
        flagged.add(key);
        const truth = !claims;
        violations.push(`relation-claim: ${a} ${claims ? "does" : "does not"} attack ${b} -- it ${truth ? "does" : "does not"}`);
      }
    }

    // Shape B: hypothetical "<piece> to <sq> <verb> <sq2>"
    for (const m of sentence.matchAll(hypotheticalRelationRe())) {
      const [, piece, destSq, , targetSq] = m;
      const dest = destSq.toLowerCase();
      const target = targetSq.toLowerCase();
      if (dest === target) continue;
      const key = `${piece.toLowerCase()}->${dest}>${target}`;
      if (flagged.has(key)) continue;

      let anyLegalHoldsTrue = false;
      let anyLegalPlayed = false;
      for (const candidateFen of fens) {
        let chess: Chess;
        try {
          chess = new Chess(candidateFen);
        } catch {
          continue;
        }
        const legalMoves = chess.moves({ verbose: true }).filter(
          (mv) => mv.to === dest && pieceTypeMatches(mv.piece, piece)
        );
        if (legalMoves.length === 0) continue;
        for (const mv of legalMoves) {
          const played = new Chess(candidateFen);
          played.move({ from: mv.from, to: mv.to, promotion: "q" });
          anyLegalPlayed = true;
          if (relationHolds(played, dest, target)) {
            anyLegalHoldsTrue = true;
          }
        }
      }
      if (!anyLegalPlayed) continue; // not a legal move anywhere offered -- skip, not this checker's job
      if (!anyLegalHoldsTrue) {
        flagged.add(key);
        violations.push(
          `relation-claim: ${piece.toLowerCase()} to ${dest} attacks ${target} -- it would not`
        );
      }
    }
  }

  return violations;
}

function pieceTypeMatches(pieceChar: string, pieceName: string): boolean {
  const map: Record<string, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  };
  return map[pieceChar.toLowerCase()] === pieceName.toLowerCase();
}
