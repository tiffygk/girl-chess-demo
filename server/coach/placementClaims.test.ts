import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { checkPlacementClaims, placementClaimSentences } from "./placementClaims";
import type { OccupancyEntry } from "./placementClaims";

// Task 1 (R3, 2026-07-22 fact-gap round): checkPlacementClaims is modeled
// EXACTLY on checkDefenseClaims (server/coach/defenseClaims.ts) -- fixed
// regex, precision over recall, no engine call, position facts already on
// ChatFactList. The measured accuracy hole this closes: the coach naming a
// piece on a square that is either the wrong piece, the wrong owner, or not
// there at all ("her queen on d8" when d8 is empty, "your rook on a1" when
// a1 holds a bishop).
describe("checkPlacementClaims (Task 1, R3)", () => {
  it("a true owned-piece claim ('your rook on a1' with a1 holding your rook) -> no violation", () => {
    const occupancy: OccupancyEntry[] = [{ square: "a1", pieceKind: "r", color: "you" }];
    expect(checkPlacementClaims("your rook on a1 is safe.", occupancy)).toEqual([]);
  });

  it("a false owned-piece claim ('your rook on a1' with a1 holding your bishop) -> one violation", () => {
    const occupancy: OccupancyEntry[] = [{ square: "a1", pieceKind: "b", color: "you" }];
    const result = checkPlacementClaims("your rook on a1 is safe.", occupancy);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("placement-claim");
  });

  it("a kind claim on an empty square ('the pawn on d5' with d5 empty) -> one violation", () => {
    const occupancy: OccupancyEntry[] = []; // d5 not present -- empty
    const result = checkPlacementClaims("the pawn on d5 looks weak.", occupancy);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("placement-claim");
  });

  // Intersection discipline (mirrors validateChat's checkDefenseClaims
  // both-positions handling): a claim false in the CURRENT position but true
  // at the FOCUSED moment is not a lie -- the conversation is about that
  // past moment.
  it("a claim false now but true at the focused moment ('her queen on d8') -> no violation (intersection rule)", () => {
    const occupancyNow: OccupancyEntry[] = [{ square: "f6", pieceKind: "q", color: "mallow" }]; // d8 empty now
    const focusOccupancy: OccupancyEntry[] = [{ square: "d8", pieceKind: "q", color: "mallow" }];
    expect(checkPlacementClaims("her queen on d8 is trapped.", occupancyNow, focusOccupancy)).toEqual([]);
  });

  it("a claim false in BOTH the current and the focused position -> still one violation", () => {
    const occupancyNow: OccupancyEntry[] = [{ square: "f6", pieceKind: "q", color: "mallow" }];
    const focusOccupancy: OccupancyEntry[] = [{ square: "e8", pieceKind: "q", color: "mallow" }];
    const result = checkPlacementClaims("her queen on d8 is trapped.", occupancyNow, focusOccupancy);
    expect(result).toHaveLength(1);
  });

  // 2026-08-26 (coach-truth round). RED case for the claim-keyed intersection
  // fix: the SAME claim is false in both positions, but for TWO DIFFERENT
  // reasons -- empty square at focus, wrong owner (occupied, but not
  // "yours") today. Before the fix, checkPlacementClaims intersected on the
  // rendered message string, and "-- d6 is empty" never matches "-- not
  // there" even though both describe the identical false claim -- so this
  // exact shape (trace 284, game 190: "it eyes your bishop on d6") slipped
  // through untouched. Run this against the pre-fix string-keyed
  // intersection (`current.filter((v) => new Set(focus).has(v))` on the raw
  // message strings) and watch it go green when it should be red -- that is
  // the bug this test exists to catch.
  it("a claim false in BOTH positions for DIFFERENT reasons (empty at focus, wrong owner today) -> still one violation", () => {
    // today: d6 holds mallow's bishop, not "your" (the player's) bishop --
    // wrong owner, "-- not there".
    const occupancyNow: OccupancyEntry[] = [{ square: "d6", pieceKind: "b", color: "mallow" }];
    // focus: d6 is bare, the bishop is still on e7 -- "-- d6 is empty".
    const focusOccupancy: OccupancyEntry[] = [{ square: "e7", pieceKind: "b", color: "mallow" }];
    const result = checkPlacementClaims(
      "once it's on the board, it eyes your bishop on d6",
      occupancyNow,
      focusOccupancy
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("placement-claim: your bishop on d6");
  });

  // The rejected 60-char-proximity idiom: an owner word from an EARLIER
  // clause in the same sentence must never bind to a LATER, unrelated
  // piece mention. The owner is only inferred when it directly precedes the
  // piece word (no filler between them) -- a structural guarantee, not a
  // heuristic distance cutoff.
  it("an owner word earlier in the sentence is NOT inferred for a later, unrelated piece mention (kind-only check)", () => {
    // d5 genuinely holds mallow's pawn -- if "your" from the earlier clause
    // were wrongly borrowed for "the pawn", this would be a false positive
    // (claiming a mallow pawn is "yours"). Since the owner word must
    // directly precede the piece, no owner is inferred and only the piece
    // KIND (pawn) is checked, which is true.
    const occupancy: OccupancyEntry[] = [{ square: "d5", pieceKind: "p", color: "mallow" }];
    const text = "your knight develops nicely. the pawn on d5 looks weak.";
    expect(checkPlacementClaims(text, occupancy)).toEqual([]);
  });

  it("does not flag prose with no piece-on-square claim at all", () => {
    const occupancy: OccupancyEntry[] = [{ square: "a1", pieceKind: "r", color: "you" }];
    expect(checkPlacementClaims("nice, that develops your knight toward the center.", occupancy)).toEqual([]);
  });

  it("a claim with the wrong OWNER but the right piece kind is still a violation ('her queen on d8' when d8 holds YOUR queen)", () => {
    const occupancy: OccupancyEntry[] = [{ square: "d8", pieceKind: "q", color: "you" }];
    const result = checkPlacementClaims("her queen on d8 looks exposed.", occupancy);
    expect(result).toHaveLength(1);
  });

  it("accepts the 'mallow's' owner form as well as 'her'", () => {
    const occupancy: OccupancyEntry[] = [{ square: "d8", pieceKind: "q", color: "mallow" }];
    expect(checkPlacementClaims("mallow's queen on d8 looks exposed.", occupancy)).toEqual([]);
  });
});

// Game 198 fixes (2026-09-21), Task B1, cause 1: the placement check must
// also clear a claim that is true somewhere along a line the reply may be
// narrating (a hint PV, a turning-point PV, or the candidate line), not
// only the current board and the focused-turning-point board. Sixteen of
// sixteen stored rejections for this checker flagged a square that was a
// PV, hint, or played-move destination -- true after a move the reply had
// already named, just not true on the single board the checker compared
// against.
function occ(fen: string): OccupancyEntry[] {
  return new Chess(fen).board().flat().filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ square: c.square, pieceKind: c.type, color: c.color === "w" ? "you" : "mallow" as const }));
}
// game 198, before her Qxd6+ (trace 361's currentFen)
const BEFORE = "rnbq1k1r/pppp1ppp/3n4/B2PQ3/2P5/8/PP3PPP/RN2KBNR w KQ - 1 9";
function after(fen: string, sans: string[]): string { const c = new Chess(fen); for (const s of sans) c.move(s); return c.fen(); }

describe("checkPlacementClaims with after-move boards", () => {
  it("'your queen on d6' is true after Qxd6+, so it is not flagged (game 198 trace 361)", () => {
    const v = checkPlacementClaims("your queen on d6 gives check.", occ(BEFORE), occ(after(BEFORE, ["Qxd6+"])));
    expect(v).toEqual([]);
  });
  it("'her queen on e7' is true two plies into the line, so it is not flagged (trace 363)", () => {
    const boards = [occ(after(BEFORE, ["Qxd6+"])), occ(after(BEFORE, ["Qxd6+", "Qe7+"]))];
    expect(checkPlacementClaims("you take her queen on e7.", occ(BEFORE), ...boards)).toEqual([]);
  });
  it("a claim false on every board is still flagged", () => {
    const v = checkPlacementClaims("your queen on h8 is safe.", occ(BEFORE), occ(after(BEFORE, ["Qxd6+"])));
    // h8 holds mallow's rook in BEFORE (not empty), so the message is "-- not there".
    expect(v).toEqual(["placement-claim: your queen on h8 -- not there"]);
  });
  it("with no extra boards the current-board check is unchanged", () => {
    expect(checkPlacementClaims("your queen on d6 gives check.", occ(BEFORE))).toEqual(["placement-claim: your queen on d6 -- not there"]);
  });
});

// A2 (live-telemetry round, 2026-09-22): same-set test for
// placementClaimSentences -- hand-verified against this fixture: sentence
// 0 has no placement-claim shape, sentence 1 is one ("your rook on a1").
// RED condition (verify by reverting): if placementClaimSentences is
// changed to always report every sentence index regardless of a match,
// sentence 0 would wrongly appear and this fails.
describe("placementClaimSentences (A2 same-set test)", () => {
  it("reports exactly the sentences containing a placement-claim shape", () => {
    const text = "the position looks balanced. your rook on a1 is active.";
    expect(placementClaimSentences(text)).toEqual([{ sentence: 1 }]);
  });
});
