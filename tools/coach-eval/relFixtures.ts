// tools/coach-eval/relFixtures.ts
//
// Brief-6a (game 198 follow-up round, 2026-09-22): the `rel` fixture family
// -- checker-property fixtures for server/coach/relationClaims.ts's
// checkRelationClaims, checked directly against the production validators
// (validateChat / checkRelationClaims itself), never a model call. Modeled
// on the `fork` arm's FK1-FK6 (a checker property, not a per-fixture model
// reply) and on wt-fu-sweep's tools/checker-sweep/{generate,run}.ts, which
// feeds real stored ChatFactList rows straight into validateChat/
// validateChatGeneral outside a model call.
//
// Provenance discipline (coach-eval rule 9: read the fixture's ruling
// before scoring, every count ships with its rows): each fixture below
// carries its own `ruling` field -- the frozen, human-readable statement of
// what SHOULD happen and, where relevant, what the checker actually does
// today and why that is or isn't correct. Do not re-derive a ruling from a
// re-run; read this field first.
//
// Data provenance: RAW_FACTS_{361,369,60,366,307} in relRawFacts.ts are the
// full facts_json blobs read ONCE (readonly) from the owner's db
// (advice_traces.id = that number) on 2026-09-22. They are frozen literal
// data -- this module never re-queries the db. `factsFor()` below just
// casts the parsed JSON to ChatFactList; the object shape already matches
// (it IS what chat.ts wrote to that column).
//
// Known, named gap this family does NOT cover: relative pins. The relation
// checker's `deniedCaptureHolds` distinguishes ABSOLUTE captures (own-piece
// occupancy, checked here in REL6) from nothing else -- it has no pin
// vocabulary at all. A denial that is true only because moving the piece
// would expose its own king to check (a relative pin) is adjudicated
// exactly like any other legal-move check: chess.js's own `.moves()`
// already excludes moves that leave the king in check, so a RELATIVE pin
// denial would actually be handled correctly by `deniedCaptureHolds` (it
// asks chess.js for legal moves, and chess.js enforces pins). What's
// missing is not correctness but VOCABULARY: nothing in this family
// specifically labels or exercises a relative-pin fixture, and the fixture
// review comment inside relationClaims.ts (2026-07-31, "review-C Minor")
// already logs one prior relative-pin bug (the checker used to use
// attackers() for negated claims, which ignores pins, and was fixed to use
// legal-move generation instead). No new fixture here re-proves that fix;
// record it as a named gap in this family rather than silently covering it
// by coincidence via REL6 (which is an own-piece/absolute case, not a
// relative pin to the king).
//
// Every fixture is checked against production code directly:
//   mode "validateChat": calls validateChat(text, facts) with a frozen,
//     real ChatFactList -- exercises the full production wiring (lineFens'
//     real horizon, focusPosition, pendingMove, etc.) exactly as chat.ts's
//     board route would.
//   mode "direct": calls checkRelationClaims(text, fen, otherFens) itself
//     with an explicitly constructed board array -- used only for REL2 and
//     REL12, where the point is to probe the checker FUNCTION at a horizon
//     or board set production's real wiring would never itself construct.
import { Chess } from "chess.js";
import type { ChatFactList } from "../../server/coach/chat";
import {
  RAW_FACTS_361,
  RAW_FACTS_369,
  RAW_FACTS_60,
  RAW_FACTS_366,
  RAW_FACTS_307,
} from "./relRawFacts";

export type RelExpectation =
  | "must-flag"
  | "must-pass"
  | "expected-unchecked"
  | "pinned-current-behaviour"
  // fix-round (2026-09-22, review finding MAJOR 1): a fixture whose whole
  // point is to prove the checker FUNCTION fails to flag at a horizon
  // production never itself constructs (REL2). Kept out of "must-flag" so
  // that bucket's pass rate reads 100% on the fixtures production actually
  // has to get right today, rather than reading as a broken 3-of-4 suite.
  | "regression-probe";

export type RelMode = "validateChat" | "direct";

export interface RelFixture {
  id: string;
  sourceTraceId: number | "synthetic";
  expectation: RelExpectation;
  // Frozen ruling: what SHOULD happen, and (for pinned/gap fixtures) what
  // the checker actually does today and why. Read this before scoring a
  // run against this fixture (coach-eval rule 9).
  ruling: string;
  // fix-round (2026-09-22, review finding MINOR 3): a short, structured
  // flag for a fixture whose expectation is met today but whose ruling
  // already documents a live risk (REL4: correctly flagged today, but the
  // claim is true two plies further into the same line than production's
  // horizon can see). Optional -- most fixtures carry none. Carried through
  // by scoreRelFixture/scoreRelFamily so a scored run surfaces this without
  // requiring a reader to open the fixture's full `ruling` prose.
  caveat?: string;
  mode: RelMode;
  text: string;
  // mode "validateChat" only:
  facts?: ChatFactList;
  // mode "direct" only:
  fen?: string;
  otherFens?: string[];
}

function factsFor(raw: unknown): ChatFactList {
  return raw as ChatFactList;
}

const FACTS_361 = factsFor(RAW_FACTS_361);
const FACTS_369 = factsFor(RAW_FACTS_369);
const FACTS_60 = factsFor(RAW_FACTS_60);
const FACTS_366 = factsFor(RAW_FACTS_366);
const FACTS_307 = factsFor(RAW_FACTS_307);

// Trace 361's own hint pv, replayed to build the depth-1/2/3 boards REL1
// and REL2 need. Constructed here (not re-queried) from the frozen fact
// list's own hintFindings.pvSans -- the same data REL1 already carries.
function replayPly(fen: string, sans: string[], n: number): string {
  const c = new Chess(fen);
  for (let i = 0; i < n && i < sans.length; i++) c.move(sans[i]);
  return c.fen();
}
const T361_PV = FACTS_361.hintFindings!.pvSans;
const T361_D1 = replayPly(FACTS_361.currentFen, T361_PV, 1);
const T361_D2 = replayPly(FACTS_361.currentFen, T361_PV, 2);
const T361_D3 = replayPly(FACTS_361.currentFen, T361_PV, 3);

export const REL_FIXTURES: RelFixture[] = [
  // ---- must-flag (3): validator-gap (b) -- checker exists and runs, but
  // is narrower than the claim or reads the wrong board. REL2 (the same
  // trace-361 shape probed at a widened horizon) is its own
  // "regression-probe" bucket below, not counted here -- see that bucket's
  // header comment. -------------------------------------------------------
  {
    id: "REL1",
    sourceTraceId: 361,
    expectation: "must-flag",
    mode: "validateChat",
    text: "no, the pawn on c7 can't reach d6.",
    facts: FACTS_361,
    ruling:
      "trace 361's real shape: the denial is false on the moment the sentence actually stands on " +
      "(one ply into the hint line, right after mallow's Qxd6+, where cxd6 IS a legal capture -- " +
      "verified empirically: c7 pawn, d6 white queen, chess.js reports the capture legal). The live " +
      "board itself can't adjudicate this denial at all (c7 is black, white to move -- " +
      "deniedCaptureHolds correctly skips it, color mismatch), so the whole claim's truth rests on " +
      "the hint-line board alone. Production's real horizon for the relation checker is 2 plies " +
      "(chat.ts's lineFens, fixed 2026-09-22 for this exact trace) -- squarely inside that horizon. " +
      "Current production (validateChat with this real fact list): FLAGS it correctly. must-flag: PASS.",
  },
  // ---- regression-probe (1): not a must-flag fixture. This one exists to
  // probe the checker FUNCTION at a horizon production's real wiring never
  // itself constructs (see REL1's ruling for the real, in-horizon shape).
  // Its expected, documented result is that the checker does NOT flag here
  // -- that is the finding the fixture exists to preserve as a regression
  // guard for the 2026-09-22 horizon fix, not a fixture the suite should
  // count toward (or against) the must-flag pass rate. --------------------
  {
    id: "REL2",
    sourceTraceId: 361,
    expectation: "regression-probe",
    mode: "direct",
    text: "no, the pawn on c7 can't reach d6.",
    fen: FACTS_361.currentFen,
    // Deliberately widened past production's real horizon (2) to depth 3,
    // to probe the CHECKER FUNCTION rather than production's real wiring
    // (which never builds a depth-3 board for this claim family -- see
    // REL1's ruling). This is the regression guard for the horizon fix.
    otherFens: [T361_D1, T361_D2, T361_D3],
    ruling:
      "same denial, same source row, one ply deeper. Empirically: at depth 3 (after Qxd6+, Qe7+, " +
      "Qxe7+), the white queen has already left d6, so cxd6 is no longer even a legal SQUARE to name " +
      "(d6 is empty) -- deniedCaptureHolds reports the denial CONFIRMED TRUE on that single board. " +
      "Feeding the checker function [live, d1, d2, d3] together, the depth-3 board's coincidental " +
      "truth triggers standingClaimFalseEverywhere's early-return-on-any-true-board logic, and the " +
      "whole claim clears with NO violation -- even though the sentence is genuinely false about the " +
      "moment it's actually describing (d1). This is the exact shape the 2026-09-22 horizon fix (4 " +
      "plies to 2) exists to prevent: called directly at horizon 3, the function does not flag -- " +
      "documented here, by design, as this regression-probe fixture's expected outcome (not a " +
      "must-flag miss; see the 'regression-probe' bucket comment above). Production's real wiring " +
      "(validateChat, horizon 2, see REL1) never constructs this depth-3 board and so never exhibits " +
      "the bug live -- this fixture is a function-level regression guard, not a live production defect.",
  },
  {
    id: "REL3",
    sourceTraceId: 369,
    expectation: "must-flag",
    mode: "validateChat",
    text: "if you'd rather keep the bishop working, bishop to d6 does that instead, eyeing their rook on h8.",
    facts: FACTS_369,
    ruling:
      "trace 369's real hypothetical claim (Shape B). The hint move Bd6 (e5 to d6) is legal here " +
      "(bestSan matches). Empirically: from d6, the bishop's two diagonals are d6-e7-f8 (short, off " +
      "board after f8) and d6-c7-b8 / d6-c5-b4-a3 -- neither reaches h8 (file diff 4, rank diff 2, not " +
      "a diagonal at all). The claim is false on every legal continuation. Current production " +
      "(validateChat with the real fact list): FLAGS it. must-flag: PASS.",
  },
  {
    id: "REL4",
    sourceTraceId: 369,
    expectation: "must-flag",
    mode: "validateChat",
    text: "the knight on a3 attacks c4.",
    facts: FACTS_369,
    caveat:
      "flagged correctly today, but the claim is actually TRUE two plies further into the same hint " +
      "line; production's 2-ply relation horizon can't see that far, so this is a live over-flagging " +
      "risk on a true claim, not a clean catch.",
    ruling:
      "constructed from trace 369's own hint pv (['Bd6','Nc6','Na3',...]): white's knight only " +
      "reaches a3 at ply 3 of that line. Empirically true ONLY from depth 3 onward (a3-knight " +
      "geometrically attacks c4); false on the live board and at depth 1-2 (no piece on a3 at all, " +
      "so relationHolds reports false there, not 'not applicable'). Production's real relation " +
      "horizon for a hint line is 2 plies (chat.ts lineFens), so it never sees the depth-3 board where " +
      "this becomes true. NAMED GAP, not a corrected behaviour: current production (validateChat with " +
      "the real fact list) FLAGS this sentence as a violation -- but the claim is actually TRUE two " +
      "plies further into the same line the coach is narrating. This is a false alarm the horizon is " +
      "too narrow to avoid; expectation 'must-flag' is met by today's code (PASS as literally stated), " +
      "but the ruling records this as a live over-flagging risk for a true claim, not a clean win.",
  },

  // ---- must-pass (4) -----------------------------------------------------
  {
    id: "REL5",
    sourceTraceId: 361,
    expectation: "must-pass",
    mode: "validateChat",
    text: "the queen on d6 attacks the queen on e7.",
    facts: FACTS_361,
    ruling:
      "a positive relation claim true within the production horizon: at depth 1 of trace 361's own " +
      "hint line (Qxd6+), the queen that just landed on d6 stands diagonally adjacent to e7, which the " +
      "very next hint ply (Qe7+) puts a black queen on. Verified true by direct board inspection. " +
      "Current production (validateChat, real fact list): does not flag it. must-pass: PASS.",
  },
  {
    id: "REL6",
    sourceTraceId: 60,
    expectation: "must-pass",
    mode: "validateChat",
    text: "the rook on a8 can't reach d8.",
    facts: FACTS_60,
    ruling:
      "the mutation-3 shape from the checker-sweep assessment: if deniedCaptureHolds used attackers() " +
      "(geometric) instead of chess.js legal-move generation, it would say the a8 rook geometrically " +
      "attacks d8 (nothing blocks the rank) and wrongly mark this true denial a false alarm. " +
      "Production's real deniedCaptureHolds asks chess.js for LEGAL moves, and capturing d8 (occupied " +
      "by mallow's own queen) is never legal regardless of geometry, so the denial holds. The live " +
      "board alone can't adjudicate this (white to move, the rook is black -- deniedCaptureHolds' own " +
      "color-mismatch skip applies), but this fixture's real fact list carries turningPointFocus.pvSans " +
      "= ['Qb3'] anchored at focusPosition, and chat.ts's lineFens replays that line to build a board " +
      "where black is to move with the same a8/d8 occupancy -- verified empirically to adjudicate the " +
      "denial as confirmed true. Current production (validateChat, real fact list): does not flag it. " +
      "must-pass: PASS.",
  },
  {
    id: "REL7",
    sourceTraceId: 366,
    expectation: "must-pass",
    mode: "validateChat",
    text: "c7 attacks your queen on d6.",
    facts: FACTS_366,
    ruling:
      "trace 366's real relation content (bare-square form), trimmed of the surrounding sentence's " +
      "'check the contested list' phrase -- that phrase is a SEPARATE, already-known voice-label-leak " +
      "violation (rule 11's changelog) unrelated to whether the relation claim itself is true; " +
      "including it here would conflate two violation classes in one fixture. The claim itself " +
      "(mallow's c7 pawn attacks the queen on d6) is true on the live board. Current production " +
      "(validateChat, real fact list): does not flag it. must-pass: PASS.",
  },
  {
    id: "REL8",
    sourceTraceId: 307,
    expectation: "must-pass",
    mode: "validateChat",
    text: "not your pawn taking on b6, her pawn on b6 takes your pawn on c5.",
    facts: FACTS_307,
    ruling:
      "trace 307's real sentence -- the bare-square capture form ('X takes Y') the assessment's " +
      "paraphrase-recall row calls out as the one shape the checker DOES catch, contrasted against " +
      "the unchecked 'is aiming at' / 'can be taken by' shapes (REL9/REL10). True on the live board. " +
      "Current production (validateChat, real fact list): does not flag it. must-pass: PASS.",
  },

  // ---- expected-unchecked (2): validator-gap (a) -- no checker pattern
  // exists for this shape at all. Assert only that the relation checker's
  // own span function (relationClaimSentences) and checkRelationClaims
  // itself never touch these sentences -- never assert a violation. ------
  {
    id: "REL9",
    sourceTraceId: "synthetic",
    expectation: "expected-unchecked",
    mode: "direct",
    text: "the bishop on f1 is aiming at h3.",
    // fen is irrelevant to this fixture's assertion (the checker never
    // reaches board adjudication for this verb shape at all), but a real
    // board is used anyway rather than a placeholder string.
    fen: FACTS_361.currentFen,
    otherFens: [],
    ruling:
      "the 'is aiming at' verb shape names no vocabulary the checker's three regexes " +
      "(standingRelationRe/bareSquareRelationRe/hypotheticalRelationRe) recognize -- 'aim'/'aiming' " +
      "is not in the verb list. relationClaimSentences(text) returns no match for this sentence, and " +
      "checkRelationClaims never adjudicates it (empty violations either way). This is a genuine " +
      "coverage gap (validator-gap (a)), not a bug: assert it is unchecked, never assert a verdict.",
  },
  {
    id: "REL10",
    sourceTraceId: "synthetic",
    expectation: "expected-unchecked",
    mode: "direct",
    text: "your queen on e5 can be taken by the pawn on c7.",
    fen: FACTS_361.currentFen,
    otherFens: [],
    ruling:
      "the passive 'can be taken by' form is unchecked for the same reason as REL9: none of the three " +
      "relation regexes recognize a passive construction (subject and object are reversed from every " +
      "verb pattern they match). relationClaimSentences(text) returns no match; checkRelationClaims " +
      "never adjudicates it. Genuine coverage gap (validator-gap (a)): assert unchecked, never a verdict.",
  },

  // ---- pinned current behaviour (2): a later owner ruling could flip
  // these deliberately -- do not treat either as a bug to fix silently. --
  {
    id: "REL11",
    sourceTraceId: 60,
    expectation: "pinned-current-behaviour",
    mode: "validateChat",
    text: "the rook on a8 attacks d8.",
    facts: FACTS_60,
    ruling:
      "PINNED, not a correctness target: same-colour occupancy. d8 holds mallow's own queen, and the " +
      "a8 rook is also mallow's. relationHolds is pure geometry (chess.js's attackers(), which does " +
      "not care whose piece already sits on the target square), so it reports the claim TRUE -- the " +
      "checker has no same-colour semantic cut for the word 'attacks' the way ordinary chess speech " +
      "sometimes reserves 'attacks' for an enemy occupant and 'defends'/'guards' for one's own. " +
      "Current production (validateChat, real fact list): does not flag it (treats the claim as true, " +
      "by design). An owner ruling to police same-colour 'attacks' as really meaning 'defends' would " +
      "flip this fixture's expectation to must-flag; until then, this is documented current behaviour.",
  },
  {
    id: "REL12",
    sourceTraceId: 60,
    expectation: "pinned-current-behaviour",
    mode: "direct",
    text: "the rook on a8 can't reach d8.",
    fen: FACTS_60.currentFen,
    // Deliberately NO otherFens -- isolates the bare live-board case from
    // REL6 (which supplies the tp-focus line board that lets the checker
    // adjudicate). This fixture is about the scope-table skip itself.
    otherFens: [],
    ruling:
      "PINNED, not a correctness target: the non-mover-denial skip (relationClaims.ts's own " +
      "color-mismatch checks at deniedCaptureHolds and standingClaimFalseEverywhere). On the bare " +
      "live board alone (white to move, the denied piece is black), deniedCaptureHolds returns null " +
      "and the claim is never adjudicated -- no violation is raised, but the claim is also never " +
      "CONFIRMED true the way REL6's fuller context (with the tp-focus line board) confirms it. " +
      "Current production, called with only the live board: silently skips (no violation either way). " +
      "An owner ruling to adjudicate a non-mover denial by flipping side-to-move (when the mover isn't " +
      "in check) would flip this fixture's behaviour; until then, this is documented current scope.",
  },
];
