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

// One violation from one pass of `text` against one occupancy list. `key`
// identifies the CLAIM (owner word + piece word + square) and is stable
// across positions; `message` is the rendered string, whose suffix records
// WHY the claim failed here (empty square vs. wrong piece/owner) and can
// therefore differ between two positions even for the identical claim --
// see checkPlacementClaims below for why that distinction matters.
interface PlacementViolation {
  key: string;
  message: string;
}

// One pass of `text` against one occupancy list.
function placementViolationsAgainst(text: string, occupancy: OccupancyEntry[]): PlacementViolation[] {
  const bySquare = new Map<string, OccupancyEntry>();
  for (const o of occupancy) bySquare.set(o.square.toLowerCase(), o);

  const violations: PlacementViolation[] = [];
  for (const m of text.matchAll(placementClaimRe())) {
    const [, ownerRaw, pieceWordRaw, squareRaw] = m;
    const square = squareRaw.toLowerCase();
    const pieceWord = pieceWordRaw.toLowerCase();
    const claimedKind = PIECE_WORD_TO_KIND[pieceWord];
    const claimedColor = ownerWordToColor(ownerRaw);
    const claimLabel = `${ownerRaw ? ownerRaw.toLowerCase() + " " : ""}${pieceWord} on ${square}`;
    const key = claimLabel;

    const occupant = bySquare.get(square);
    if (!occupant) {
      violations.push({ key, message: `placement-claim: ${claimLabel} -- ${square} is empty` });
      continue;
    }
    const kindMatches = occupant.pieceKind === claimedKind;
    // Owner is only checked when the claim actually named one (directly
    // adjacent, per the regex above) -- a bare "the pawn on d5" is a
    // kind-only claim, deliberately color-agnostic.
    const colorMatches = claimedColor === null || occupant.color === claimedColor;
    if (!kindMatches || !colorMatches) {
      violations.push({ key, message: `placement-claim: ${claimLabel} -- not there` });
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
//
// 2026-08-26 (coach-truth round). This intersection used to be keyed on the
// rendered violation MESSAGE, and that was wrong: placementViolationsAgainst
// appends a different suffix depending on why a claim failed (`-- <sq> is
// empty` when the square is bare, `-- not there` when it holds the wrong
// piece or owner), so the same claim false in both positions for two
// different reasons produced two strings that never matched, and the plain
// string-set intersection let it through untouched. That is exactly how "it
// eyes your bishop on d6" reached her: d6 was empty at the focused ply and
// held mallow's bishop -- not hers -- today, two different reasons, one
// real lie neither run's message-string matched. An asymmetric fix was
// tried and reverted (see chat.test.ts and the round's audit report): it
// traded that miss for a new false positive on a genuinely correct reply
// elsewhere in her history. The fix here keeps the intersection symmetric
// and instead keys it on the claim's IDENTITY (owner word + piece word +
// square, independent of why either run failed it) rather than the message
// text, then reports the CURRENT position's message for anything that
// survives -- so a claim that is false everywhere is caught regardless of
// which reason each position gives, while a claim true at the focused
// moment (the case this intersection exists to protect) is still cleared.
export function checkPlacementClaims(
  text: string,
  occupancy: OccupancyEntry[],
  focusOccupancy?: OccupancyEntry[]
): string[] {
  const current = placementViolationsAgainst(text, occupancy);
  if (!focusOccupancy) return current.map((v) => v.message);
  const focusKeys = new Set(placementViolationsAgainst(text, focusOccupancy).map((v) => v.key));
  return current.filter((v) => focusKeys.has(v.key)).map((v) => v.message);
}
