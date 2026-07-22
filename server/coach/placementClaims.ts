// Task 1 (R3, 2026-07-22 fact-gap round): a third claim shape alongside
// defenseClaims.ts's guard/safety checks and chat.ts's own side-attribution
// check -- the coach names a piece and a square ("your rook on a1", "the
// pawn on d5") and the claim can simply be wrong: the wrong piece kind, the
// wrong owner, or an empty square. This closes the measured 7.5%
// placement-accuracy hole from the round's telemetry review.
//
// Modeled EXACTLY on checkDefenseClaims's shape (server/coach/
// defenseClaims.ts): a fixed regex, precision over recall, no engine call --
// the occupancy list already on ChatFactList is the only fact needed.
//
// The owner word (your/her/mallow's) is bound to the piece ONLY when it
// DIRECTLY precedes the piece word in the same match (no filler between
// them) -- never inferred by scanning backward across the sentence. That
// "60-char proximity" idiom (the same shape guardClaimRe/safetyClaimRe use
// for their own "between" captures) was tried for this checker and rejected
// in QA review as a false-positive source: "your knight develops well. the
// pawn on d5..." must NOT borrow "your" for the pawn. Binding is therefore
// structural (regex adjacency), not distance-based.
export interface OccupancyEntry {
  square: string;
  pieceKind: string; // chess.js piece letter: p/n/b/r/q/k
  color: "you" | "mallow";
}

const PIECE_WORD_TO_KIND: Record<string, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

function ownerWordToColor(raw: string | undefined): "you" | "mallow" | null {
  if (!raw) return null;
  return raw.toLowerCase() === "your" ? "you" : "mallow"; // her / mallow's / mallows
}

export function placementClaimRe(): RegExp {
  // group 1: owner word, directly adjacent to the piece word (\s* only, no
  // arbitrary filler) -- the structural guarantee that rules out proximity
  // binding. group 2: piece word (singular; a trailing "s" for plural forms
  // like "rooks" is matched outside the group). group 3: destination square.
  return /\b(your|her|mallow'?s)?\s*(pawn|knight|bishop|rook|queen|king)s?\s+(?:is\s+|sits\s+)?on\s+([a-h][1-8])\b/gi;
}

// One pass of `text` against one occupancy list. The violation message
// describes the CLAIM itself (owner word + piece word + square), never the
// actual occupant found -- so the same false claim produces the identical
// string against either position, which is what makes the plain-set
// intersection in checkPlacementClaims below exact (the same discipline
// validateChat already applies to checkDefenseClaims's own output).
function placementViolationsAgainst(text: string, occupancy: OccupancyEntry[]): string[] {
  const bySquare = new Map<string, OccupancyEntry>();
  for (const o of occupancy) bySquare.set(o.square.toLowerCase(), o);

  const violations: string[] = [];
  for (const m of text.matchAll(placementClaimRe())) {
    const [, ownerRaw, pieceWordRaw, squareRaw] = m;
    const square = squareRaw.toLowerCase();
    const pieceWord = pieceWordRaw.toLowerCase();
    const claimedKind = PIECE_WORD_TO_KIND[pieceWord];
    const claimedColor = ownerWordToColor(ownerRaw);
    const claimLabel = `${ownerRaw ? ownerRaw.toLowerCase() + " " : ""}${pieceWord} on ${square}`;

    const occupant = bySquare.get(square);
    if (!occupant) {
      violations.push(`placement-claim: ${claimLabel} -- ${square} is empty`);
      continue;
    }
    const kindMatches = occupant.pieceKind === claimedKind;
    // Owner is only checked when the claim actually named one (directly
    // adjacent, per the regex above) -- a bare "the pawn on d5" is a
    // kind-only claim, deliberately color-agnostic.
    const colorMatches = claimedColor === null || occupant.color === claimedColor;
    if (!kindMatches || !colorMatches) {
      violations.push(`placement-claim: ${claimLabel} -- not there`);
    }
  }
  return violations;
}

// Produces one "placement-claim: ..." string per contradiction, [] if none.
// When focusOccupancy is supplied (the position just before a focused
// turning point -- see ChatFactList.focusPosition in chat.ts), a claim is
// only flagged when it is false in BOTH the current and the focused
// position -- the intersection discipline validateChat already uses for
// checkDefenseClaims, so a claim true at the moment being discussed is never
// penalized for being untrue today.
export function checkPlacementClaims(
  text: string,
  occupancy: OccupancyEntry[],
  focusOccupancy?: OccupancyEntry[]
): string[] {
  const current = placementViolationsAgainst(text, occupancy);
  if (!focusOccupancy) return current;
  const focus = new Set(placementViolationsAgainst(text, focusOccupancy));
  return current.filter((v) => focus.has(v));
}
