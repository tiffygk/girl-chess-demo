import { Chess } from "chess.js";
import { toMoverCp } from "../annotator/classify";
// Phase comes from src/review/gamePhases (lichess divider, latching
// timeline) -- the SAME module the debrief renders from, imported, not
// hand-mirrored. The old convention ("server never imports src, mirror
// the constant") is what produced two divergent phase algorithms lying
// to the owner differently on the same game. This server-to-src edge IS
// now covered by tsc -b (tsconfig.server.json's program includes this
// file plus gamePhases.ts/phase.ts/api.ts, verified with --listFiles), so
// a nullable-shape mistake at this seam is caught at build time, not just
// by tsx/vitest resolving the import at runtime. The one thing tsc still
// cannot see: it cannot tell a `GamePhase`-only `import type` from a
// runtime value import, so converting gamePhases.ts's or phase.ts's
// `import type { SummaryMove }` to a value import type-checks fine but
// would pull src/game/api.ts's browser-only `fetch` code into this
// process and break the dev server. Phase logic is imported, never
// mirrored. If you are about to copy a phase threshold into this file,
// stop: phaseParity.test.ts will fail.
import { phasesForGame, type GamePhase } from "../../src/review/gamePhases";
import type { ThreatFacts, RecommendationFacts } from "../annotator/motifs";
import type { CoachBackend, CoachUsage } from "./backends/types";
import { getPersona, type NarrateTraceContext } from "./index";
import { SAN_RE, isAllowedSanToken } from "./validate";
import { checkDefenseClaims } from "./defenseClaims";
import { checkPlacementClaims } from "./placementClaims";
import { checkMateClaims } from "./mateClaims";
import { insertAdviceTrace, getLatestRejectedChatTrace } from "../store/db";
import { isOffTopic, mentionedPlies, thinkingForIntent, type ChatIntent } from "./intent";
import { normalizeEmDash } from "./textNormalize";

// Round 3 (Q4, trace-180): the recapture-viability exemption checkDefenseClaims
// takes -- shared by both validateChat's board route and validateChatGeneral,
// same "caller derives, checker only carries it through" discipline as every
// other fact fold in this file. A square only qualifies when a legal
// recapture exists (capturedSquareDefended) AND the engine's own line says
// it doesn't actually hold (recaptureHolds === false); anything else leaves
// the geometric checker's normal behavior untouched.
// Whole-branch review (2026-08-03), Minor finding 3: moved below the import
// block -- it previously sat between two import statements, splitting the
// block (legal, since imports hoist, but reads oddly).
function unsafeRecaptureSquaresFrom(threat: ChatContext["threat"]): string[] {
  return threat?.capturedSquareDefended && threat.recaptureHolds === false && threat.capturesSquare
    ? [threat.capturesSquare]
    : [];
}

// F16 (this-game grounding chat): a second, independent narration surface
// alongside narrate() in ./index.ts. Same shape (persona prompt + fact JSON
// -> backend.generate -> validate -> one corrective regen -> deterministic
// template fallback -> exactly one advice_traces row) but grounds against
// the WHOLE GAME (every san played, the current position, every legal move
// from here, turning points when finished) rather than a single judged
// move's fact list -- narrate()'s CoachFactList is deliberately left
// untouched; chat gets its own ChatFactList so a change to one surface's
// shape can never silently break the other.
export const CHAT_HISTORY_WINDOW = 8; // messages (4 exchanges), owner-calibratable
// Owner-calibratable. Raised 20000 -> 30000 on 2026-07-22 from her own
// advice_traces, not a guess: plain asks answer in 4.6-5.1s, but the
// focused "ask about this" turns carry a much larger prompt and her two
// hardest questions (traces 57/58) burned the full 20s and served a
// template instead of an answer. Chat lives in the coach's corner and
// provably does not block play (that is what moving it out of the centre
// modal bought), so waiting longer for a real answer beats a fast
// non-answer -- and the "slow" chip tells her which one she is getting.
// Raised again 30000 -> 45000 the same day (R6, fact-gap round): the owner's
// stated tolerance is ~60s, and a fast non-answer is the worst outcome of
// all -- 45s gives real headroom under that ceiling without making 45s the
// common wait (R1's per-ply-analysis fix is what should cut the common
// case; this budget is a backstop for the tail, not the target latency).
// narrate()'s own budget is deliberately NOT raised with it: that surface
// speaks unprompted while she plays, where a late reply is worse than none.
// OWNER RULING 2026-08-02 (wave-1 playtest, game 167): "maybe we put the
// time out at something crazy like three minutes" -- many replies were dying
// at the 45s cap on exactly the questions she most wanted answered (traces
// 185/186). For now the budget is deliberately oversized so games can be
// played through and we MEASURE real completion times instead of truncating
// them; the systematic-debugging round decides what it becomes afterwards.
// (The 45s era's rationale is preserved in git history at this line.)
export const CHAT_TIMEOUT_MS = 180000;
// B1 (2026-07-27, coach-truth-speed round), owner's verbatim ask: "once the
// game is over, I am no longer waiting on it to make a move... I want it to
// have a longer timeout so it can answer more in-depth questions." The live
// budget (CHAT_TIMEOUT_MS) is untouched -- she likes it for live play -- this
// is a SEPARATE, larger TOTAL budget for review-mode chat (finished games
// only), selected server-side in manager.ts from the db's own `result`
// column, never from a client-supplied mode flag. MIN_ATTEMPT_MS is the
// floor: if less than this remains after attempt 0 fails validation, the
// regen is skipped entirely rather than started and immediately starved --
// see chat()'s loop below for the accounting that keeps the worst case
// exactly budgetMs, never budgetMs + a second full timeout.
// OWNER RULING 2026-08-02: review budget raised to the same 3-minute measure-
// don't-truncate ceiling as live chat (was 90000; see CHAT_TIMEOUT_MS above).
export const CHAT_REVIEW_BUDGET_MS = 180000;
export const MIN_ATTEMPT_MS = 8000;
// Wave 3, item 4 (F5 family, game-164): attempt 0's OWN generate timeout is
// capped at 1/this of the total budget, so a slow-but-eventually-returning
// attempt 0 can never starve the one regen. Trace 161: attempt 0 ran 35.6s of
// a 90s budget and the regen then timed out at 54.4s -- with the cap the regen
// is guaranteed at least half the budget. Only attempt 0's per-call timeout is
// clamped; the shared `deadline` (start + budget) is untouched, so the worst
// case is still exactly budgetMs, and the regen keeps the full remainder and
// the MIN_ATTEMPT_MS floor.
export const ATTEMPT0_BUDGET_DIVISOR = 2;
export const CHAT_MAX_LEN = 500;
// Task 2 (Wave D, coach-truth-speed round): the persona's "one to three
// short sentences" rule is a LIVE-NUDGE budget -- it must not gag a real
// post-game strategy answer on the new general-chess route. Named (rather
// than inlined into personas/coach.md's prose alone) so coach-eval can read
// the exact same number this prompt asks for, instead of a hardcoded guess
// baked into the eval harness.
export const GENERAL_MAX_WORDS = 120;

export interface ChatContext {
  mode: "live" | "review";
  herMove?: { pieceKind: string; from: string; to: string };
  tier?: "nudge" | "warning";
  threat?: ThreatFacts;
  best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
  recommendation?: RecommendationFacts;
  // Task 7 (increment 3.95, "ask about this"): the two per-moment focus
  // fields. GamePage sets at most one of these per message -- hintFocus when
  // the player opened chat from the open hint ladder, turningPointFocus when
  // they opened it from a debrief turning-point card -- so the coach's reply
  // can ground itself in THAT moment instead of the whole game/position.
  // Task 4 (R1b, fact-gap round): before this, hintFocus carried only the
  // ladder's level + rendered text -- none of the already-computed
  // HintFacts the player is actually looking at ever reached the coach, so
  // a hint follow-up couldn't legally name the best move, and had no engine
  // facts to expand on. bestSan/pvSans are already SAN (client-converted,
  // same "convert once, at the source" rule Task 3 follows); threat is the
  // ThreatFacts that prompted the hint (level-3's own highlight, from the
  // judge's verdict, not a HintFacts field); recommendation/trade are
  // HintFacts' own fields verbatim. All optional -- a hint at level 1-2
  // renders before any of this is computed.
  // Wave 2 (item 6): the client's focus identity switched from a numeric
  // `level` to the two-branch press ladder's {branch, press}. The server has
  // never read this identity (only text/bestSan/pvSans/threat/recommendation/
  // trade below are used), so it is a passthrough rename; hintFocusForModel
  // strips only `threat` and lets the rest ride into the prompt harmlessly.
  hintFocus?: {
    branch: "right" | "wrong";
    press: number;
    text: string;
    bestSan?: string;
    pvSans?: string[];
    threat?: ThreatFacts;
    recommendation?: RecommendationFacts;
    trade?: boolean;
  };
  turningPointFocus?: {
    ply: number;
    san: string;
    label: string;
    punishSan?: string;
    // bestSan/pvSans: the card's own TurningLine (server/game/manager.ts's
    // getTurningLines), threaded through so assembleChatFactList below can
    // fold them into allowedSans -- see that fold's comment for why this is
    // the one piece that actually changes what the coach is allowed to say.
    bestSan?: string;
    pvSans?: string[];
    // Task 3 (Wave D, deferred from A1): the same fact reviewArrows.ts/
    // debriefBullets.ts/turningPointNote.ts already compute via
    // src/review/followedBest.ts's followedBest() -- threaded into chat so
    // the coach's answer and the debrief note can never disagree about
    // whether she actually played the recommended move. Owner's game-146
    // question this closes: "did I actually do the move it recommended, or
    // did I not?" playedNextSan is the move she actually played at the
    // relevant ply (her own move for an odd tp.ply, her REPLY for an even/
    // opponent tp.ply -- see followedBest.ts's header comment);
    // followedBest is whether that move matches the line's own
    // recommendation. Both optional: absent whenever the client has no
    // gameSans to compute them from (see chatFocus.ts's
    // turningPointFocusContext).
    playedNextSan?: string;
    followedBest?: boolean;
    // Opponent-move-analysis plan (2026-08-03), Wave C: hand-mirrors
    // src/game/api.ts's ChatContext.turningPointFocus verbatim -- see that
    // file's own comment. Populated ONLY for a mallow-ply focus (chatFocus
    // .ts's opponentMoveFocusContext), straight off the matching
    // HighlightLine's own already-computed fields (Wave A's
    // server/annotator/highlightLines.ts -- one place, never re-derived
    // here). Lets checkOpponentQualityClaims below answer "did mallow
    // actually play the engine's own best move" from a fact already in
    // hand, never by re-deriving it from the model's own prose. Absent for
    // every her-ply focus, so JSON.stringify drops the keys there and that
    // prompt path stays byte-identical (chat.stablePrefix discipline).
    matchedBest?: boolean | null;
    quality?: "best" | "solid" | "fine" | "slip" | "unknown";
  };
  // Task 1 (R2, pending-move context threading): the move she's picked up
  // and placed on the board but has NOT confirmed -- src/game/GamePage.tsx's
  // buildChatContext sends this whenever `pending` is truthy, regardless of
  // verdict/tier state (silent/in-flight/coach-off all included). Before
  // this, the pending move reached chat only once a verdict had landed AND
  // its tier was nudge/warning, so a move judged "silent" (a fine move --
  // exactly when she asks "why should i NOT put it here?") reached the
  // coach as bare `{mode:"live"}`, and it truthfully answered "not sure
  // which piece you mean." `tier`/`judged` describe the JUDGE's state, not
  // confirmation: judged:false means no verdict has landed yet (still
  // judging, or a confirm-only pending move that was never sent to judge at
  // all). `san` is a CLIENT CLAIM, never trusted as-is -- assembleChatFactList
  // below distrust-verifies it is actually legal from the position it just
  // replayed before folding it into allowedSans or letting it reach the
  // model; an illegal/stale claim (the player retracted the move, or the
  // request raced a retarget) is dropped entirely. Deliberately no deltaCp
  // or any other number here -- see factsForModel's own comment for why.
  pendingMove?: {
    pieceKind: string;
    from: string;
    to: string;
    san?: string;
    tier?: "silent" | "nudge" | "warning";
    judged: boolean;
  };
}

// B4a: the finished-game outcome fact. `winner`/`how` are plain-language,
// never a raw result-string parse the model has to do itself; `finalPly` is
// the game's total ply count, the same number chat's own `ply` trace arg
// already uses for a finished game.
export interface ChatOutcome {
  result: string;
  winner: "you" | "mallow" | "draw";
  how: string;
  finalPly: number;
}

// Round 3 (Q2 step 3): the hint engine's own verified findings for the exact
// position she is asking about, folded onto ChatFactList.hintFindings ONLY
// when the shelf's fen matches the position in play (see the fold below).
// bestSan/pvSans are converted uci->san at the matched fen so they are
// speakable the same way perPlyAnalysis's bestSan/pvSans already are.
export interface HintFindings {
  fen: string; // the position this shelf entry is valid for
  bestSan: string; // chosen best move in SAN, converted from bestUci at the fen
  bestUci: string;
  evalCp: number | null; // side-to-move signed at fen
  evalMate: number | null; // side-to-move signed at fen
  pvSans: string[]; // the verified line, uci->san from fen
  trade: boolean;
  escalated: boolean;
  recommendationSan?: string; // recommendation.san when present
  // Whole-branch review (2026-08-03, Important finding 1): PROVENANCE,
  // threaded straight through from HintFacts.verified (see that field's own
  // comment). true only for a real deep hint (computeHint); false for the
  // fast, unverified position view (computePositionView) that fills the
  // shelf on ordinary live chat with no matching prior hint -- the common
  // case. hintFindingsForModel below is the one place this drives wording:
  // only true may claim "verified"/"trust over your own reasoning".
  verified: boolean;
}

export interface ChatFactList {
  gameSans: string[]; // every san played, in order
  currentFen: string; // final position (review) / live position (live)
  // Side-to-move fact (round 2026-07-22): without this, the coach once
  // attributed the PLAYER's own pending move to mallow, because nothing in
  // the fact list stated whose turn it is -- the model was left to infer
  // perspective from the FEN's side-to-move field, and legalSans is an
  // unlabeled bare list (see below). Derived from chess.turn() at the same
  // place currentFen is derived: "w" -> "you", "b" -> "mallow" -- the same
  // fixed "player is always white in v1" mapping occupancy already uses.
  toMove: "you" | "mallow";
  occupancy: { square: string; pieceKind: string; color: "you" | "mallow" }[]; // from currentFen
  legalSans: string[]; // chess.js .moves() on currentFen
  turningPoints?: { ply: number; san: string; label: string; punishSan?: string }[];
  // B4a (2026-07-27, coach-truth-speed round): there was no game-over signal
  // in the prompt at all before this -- the coach would discuss a game she
  // had already won in present/live tense, because nothing in the fact list
  // ever said the game was over. `status` is ALWAYS emitted (a live game
  // must be labeled live, not left to be inferred from outcome's absence);
  // `outcome` is only ever present alongside status "finished", derived by
  // the caller (manager.ts) from the db's own `result`/`end_reason` columns,
  // never guessed from ctx.mode.
  status: "in-progress" | "finished";
  outcome?: ChatOutcome;
  context?: ChatContext; // live coach facts when present
  allowedSans: string[]; // gameSans + legalSans + context sans + turning-point sans/punishSans
  // Task 2 (defender grounding): every occupied square currently attacked
  // by the OPPOSING side, with who attacks it and who could recapture --
  // computed from currentFen via chess.js's own attackers(), no engine
  // call. Lets the coach answer "is my piece safe / is X defended" from a
  // fact instead of reasoning about defense itself, which is how it once
  // told a player white's e4 pawn "doesn't guard f5" when it demonstrably
  // does (Bxf5 exf5). A piece not attacked by the opponent is omitted --
  // keeps the list small and focused on what's actually under fire.
  contested: {
    square: string;
    pieceKind: string;
    color: "you" | "mallow"; // same mapping as occupancy: w -> "you", b -> "mallow"
    attackedBy: { square: string; pieceKind: string }[]; // opposing-color attackers
    defendedBy: { square: string; pieceKind: string }[]; // same-color defenders (could recapture)
  }[];
  // Round 2026-07-22: when the player asks about a specific turning point,
  // the conversation is about a PAST moment, but every field above describes
  // the position TODAY. The e2e gate caught the coach placing mallow's queen
  // on a5 (true now) while discussing a pivot where it still sat on d8, and
  // calling dxc6 "wins a pawn clean" while ignoring the bxc6 recapture that
  // existed at that moment. focusPosition carries the position just BEFORE
  // the focused move -- the one she was actually choosing in, and the one
  // the card's bestSan/pvSans are legal in -- derived by the same replay
  // discipline as currentFen, never hand-computed. Absent when no turning
  // point is focused, so ordinary chat is untouched.
  focusPosition?: {
    ply: number; // the focused move's ply; this position is the one BEFORE it
    fen: string;
    toMove: "you" | "mallow";
    occupancy: { square: string; pieceKind: string; color: "you" | "mallow" }[];
    legalSans: string[];
    contested: ChatFactList["contested"];
  };
  // Task 3 (R1a, fact-gap round): the WHOLE game's already-persisted engine
  // analysis (moves.eval_cp/eval_mate/best_move/pv, written by the judge) --
  // before this, chat had nothing but the bare san list and the current
  // position, so a question about an earlier moment ("was my opening okay?")
  // got answered by the model reasoning about chess itself instead of a
  // fact. bestSan/pvSans arrive here ALREADY converted from the stored UCI
  // by the caller (manager.ts, reusing the pvLine replay discipline
  // getTurningLines already uses) -- this function only tags each entry with
  // its phase. Affordable to carry the whole game because prompt size does
  // not drive latency (r=-0.14, measured against advice_traces). Absent when
  // the caller passes nothing, so every existing call site is untouched.
  perPlyAnalysis?: {
    ply: number;
    san: string;
    evalCp: number | null;
    evalMate: number | null;
    bestSan: string | null;
    pvSans: string[];
    // Integration-round fix (2026-07-30): phasesForGame.phaseAt is honest
    // about "I don't know" -- null when there is no board to derive a phase
    // from (gameSans absent or empty; see src/review/gamePhases.ts's
    // "Important 5 / union F1"). This field must tell the same truth, not
    // paper over it with a non-null type that forces phases.phaseAt's
    // result to be lied about at the assignment below. Every consumer
    // (perPlyForModel below) must omit phase for a ply where this is null,
    // never fabricate a phase or leak a placeholder string.
    phase: GamePhase | null;
    then?: string;
    // Round 3 Task 12 (item 5/Q3, trust floor): the played-vs-best gap for
    // THIS ply, in words, not a number -- distinct from `read`'s per-position
    // bucket (readForPly, below), which describes the resulting position's
    // overall state, not how much worse the played move was than the best
    // one. Derived by assembleChatFactList from this array's own consecutive
    // entries (see gapWordForPly); undefined when either side of the pair has
    // no eval captured, same "no data, no claim" contract as `then`.
    gap?: string;
  }[];
  // NOTE: no allowedSquares -- chat validation treats square names as free
  // geography (see validateChat below). Declared cut #2, not an oversight:
  // policing whether a named square is real/relevant would require the
  // fact list to also carry per-square provenance, which nothing upstream
  // computes today. See validateChat's comment and chat.test.ts's cut #2
  // test for the honesty documentation this decision requires.
  // Highlight-a-move (Task 8): plies she flagged during live play ("that
  // move I paused on"). Fed into perPlyForModel's fullDetailPlies below so
  // "why did I highlight this?" always gets pvSans/phase, regardless of how
  // far outside RECENT_PLY_WINDOW the ply sits -- the same exemption a
  // turning point or the focused ply already gets. Deliberately NOT folded
  // into turningPoints/allowedSans: a highlighted ply that was never an
  // actual turning point would drift validateChat's SAN allow-list.
  highlightedPlies?: number[];
  // Round 3 fact shelf (Q2): the hint engine's own verified line for the
  // position she is asking about, folded in ONLY when lastHint.fen matches
  // currentFen (live) or focusPosition.fen (focused ask). This is the
  // position the chat otherwise knows least -- perPlyAnalysis covers played
  // plies only. Absent when there is no matching hint, so ordinary chat is
  // untouched.
  hintFindings?: HintFindings;
}

// Every position-shaped fact the coach gets, derived from one chess.js
// instance. Extracted 2026-07-22 so the focused turning point's position can
// be described by the SAME code as the current one -- two call sites, one
// derivation, no chance of the two drifting apart.
function derivePositionFacts(chess: Chess): {
  fen: string;
  toMove: "you" | "mallow";
  occupancy: ChatFactList["occupancy"];
  legalSans: string[];
  contested: ChatFactList["contested"];
} {
  // Player is always white in v1 (see manager.ts's resign() comment) -- so
  // white pieces are always "you" and black is always "mallow", a fixed
  // mapping, not a lookup. toMove follows the exact same fixed mapping.
  const toMove: "you" | "mallow" = chess.turn() === "w" ? "you" : "mallow";
  const occupancy: ChatFactList["occupancy"] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
    }
  }

  const contested: ChatFactList["contested"] = [];
  for (const entry of occupancy) {
    const cell = chess.get(entry.square as Parameters<typeof chess.get>[0]);
    if (!cell) continue;
    const oppColor = cell.color === "w" ? "b" : "w";
    const attackerSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], oppColor);
    if (attackerSquares.length === 0) continue;
    // Geometric only (same-color attackers()), NOT a legal-recapture
    // guarantee -- a piece pinned to its own king can appear here even
    // though it cannot actually recapture (see motifs.ts's
    // capturedSquareDefended for the legal-recapture-checked version).
    const defenderSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], cell.color);
    const toPiece = (sq: string) => {
      const p = chess.get(sq as Parameters<typeof chess.get>[0]);
      return { square: sq, pieceKind: p ? p.type : "" };
    };
    contested.push({
      square: entry.square,
      pieceKind: entry.pieceKind,
      color: entry.color,
      attackedBy: attackerSquares.map(toPiece),
      defendedBy: defenderSquares.map(toPiece),
    });
  }

  return { fen: chess.fen(), toMove, occupancy, legalSans: chess.moves(), contested };
}

// Task 3 (R1a) input shape: one game's already-persisted per-ply analysis,
// san/bestSan/pvSans already in SAN (converted by the caller -- see
// ChatFactList.perPlyAnalysis's own comment for why the conversion lives
// there and not here).
export interface ChatPerPlyInput {
  ply: number;
  san: string;
  evalCp: number | null;
  evalMate: number | null;
  bestSan: string | null;
  pvSans: string[];
  // Forward-prediction round (2026-07-28): the replay-proven continuation
  // claim for this ply's line (server/annotator/continuation.ts), derived by
  // the caller (manager.ts) from the same fenBefore + pvSans replay that
  // produced bestSan/pvSans -- same "caller derives, this function only
  // carries it" discipline as every other field here. Absent when the line
  // proves nothing claimable (about half of real plies, measured).
  then?: string;
}

// Owner-calibratable starting values (Task 3b, R2 voice-enforcement round):
// the cp thresholds bucketing perPlyAnalysis's per-ply eval into a plain-
// language "read" for the MODEL-FACING projection only -- the voice rules
// ban stating a number for the position outright (checkVoice above), so
// factsForModel must never leak evalCp/evalMate as numbers. The raw
// ChatFactList keeps the numbers untouched (validation + the F40 trace
// still need them); only this bucketing is new.
const READ_EVEN_CP = 60; // |cp| below this reads as "even" (nudge-sized edge)
const READ_MUCH_BETTER_CP = 300; // |cp| at/above this reads as "much better" (roughly a minor piece)

// evalCp/evalMate on ChatFactList are SIDE-TO-MOVE signed as of the
// position AFTER the ply was played (same convention turningPoints.ts's
// buildDeltaSeries documents and re-derives against real data): after an
// ODD ply it's black's turn, so the stored value is black-perspective and
// must be negated to reach the fixed "player is always white" read; after
// an EVEN ply it's white's turn, so the stored value is already
// white-perspective, used as-is.
function toWhitePerspective(ply: number, signed: number): number {
  return ply % 2 === 1 ? -signed : signed;
}

function readForPly(ply: number, evalCp: number | null, evalMate: number | null): string {
  if (evalMate !== null) {
    const whiteMate = toWhitePerspective(ply, evalMate);
    return whiteMate > 0 ? `mate for you in ${whiteMate}` : `mate against you in ${Math.abs(whiteMate)}`;
  }
  if (evalCp === null) return "no read yet"; // honest "no data", not a guessed number
  const whiteCp = toWhitePerspective(ply, evalCp);
  if (Math.abs(whiteCp) < READ_EVEN_CP) return "even";
  if (whiteCp > 0) return whiteCp >= READ_MUCH_BETTER_CP ? "you're much better" : "you're a bit better";
  return whiteCp <= -READ_MUCH_BETTER_CP ? "she's much better" : "she's a bit better";
}

// Round 3 Task 12 (item 5/Q3, trust floor): relative-gap language -- how
// much worse the move actually played was than the best move available,
// distinct from readForPly's per-position bucket above (which describes the
// resulting position overall, not the size of the miss). Lets the coach
// distinguish a real edge (trace-180, "clearly better, here's the tactic")
// from engine noise or a bare style preference (trace-193, "no real gap,
// style call"). The 35cp floor mirrors hint.ts's own HINT_TRADE_MARGIN_CP
// ("genuinely comparable") rather than inventing a new number; the 150/300cp
// steps mirror classify.ts's BETTER_CLAIM_MIN_CP (Task 11) and its own next
// step up. hasMateOrMotif overrides straight to "decisively better" --
// a forced mate gained or lost is decisive regardless of how small the
// cp reading happens to look.
export function gapWord(deltaCp: number, hasMateOrMotif: boolean): string {
  if (hasMateOrMotif) return "decisively better";
  const d = Math.abs(deltaCp);
  if (d < 35) return "no real gap";
  if (d < 150) return "slightly better";
  if (d < 300) return "clearly better";
  return "decisively better";
}

// Task 12 helper: derives one ply's gapWord honestly from the WHOLE-GAME
// perPly array's own consecutive entries -- no new engine call, no new
// stored column. `prior` is ply-1's own evalCp/evalMate, i.e. fenAfter(ply-1)
// == fenBefore(ply), already signed for the mover of `ply` (same convention
// manager.ts's own priorEval / toWhitePerspective above document); `current`
// is ply's own evalCp/evalMate, i.e. fenAfter(ply), signed for the OPPONENT
// (whoever moves next) -- toMoverCp+negation converts both to "how good was
// this for the ply's own mover," exactly classify.ts's beforeEval/afterEval
// convention. Returns undefined (never a guessed number) when either side of
// the pair has no eval captured -- the array's very first entry has no prior
// at all, and any ply whose eval never landed stays an honest gap.
function gapWordForPly(
  prior: { evalCp: number | null; evalMate: number | null },
  current: { evalCp: number | null; evalMate: number | null }
): string | undefined {
  if (prior.evalCp === null && prior.evalMate === null) return undefined;
  if (current.evalCp === null && current.evalMate === null) return undefined;
  const bestEvalCp = toMoverCp({ cp: prior.evalCp, mate: prior.evalMate });
  const actualEvalCp = -toMoverCp({ cp: current.evalCp, mate: current.evalMate });
  const deltaCp = bestEvalCp - actualEvalCp;
  const hasMate = prior.evalMate !== null || current.evalMate !== null;
  return gapWord(deltaCp, hasMate);
}

// Pure: replays gameSans from the start position with chess.js so
// currentFen/occupancy/legalSans are all DERIVED, never hand-computed --
// castling rights, en passant, and promotion are exactly whatever the
// replay says they are, the same discipline motifs.ts's threat/recommendation
// derivation already follows for a single move.
export function assembleChatFactList(
  gameMoves: { ply: number; san: string }[],
  ctx: ChatContext,
  turningPoints?: { ply: number; san: string; label: string; punishSan?: string | null }[],
  perPly?: ChatPerPlyInput[],
  // B4a: additive optional 5th param, mirrors perPly's own "caller derives,
  // this function only carries it through" discipline -- manager.ts is the
  // one place that knows the db's result/end_reason columns. Every existing
  // caller (every test, every pre-this-round call site) omits it and gets
  // status "in-progress", outcome undefined -- unchanged behavior.
  outcomeInfo?: { status: "in-progress" | "finished"; outcome?: ChatOutcome },
  // Highlight-a-move (Task 8): additive optional 6th param, same
  // "caller derives, this function only carries it through" discipline as
  // outcomeInfo above -- manager.ts is the one place that knows the db's
  // moves.highlighted column. Every existing caller (every test, every
  // pre-this-round call site) omits it and gets undefined -- unchanged
  // behavior.
  highlightedPlies?: number[],
  // Round 3 (Q2 step 3): additive optional 7th param, same "caller derives,
  // this function only carries it through" discipline as every other
  // optional param here. manager.ts passes live.lastHint. Only folded into
  // hintFindings when its fen matches currentFen or focusPosition.fen (see
  // below) -- a stale hint from a position the board has moved past is
  // dropped, never shown as if it still applied.
  hintCandidate?: {
    fen: string;
    facts: {
      bestUci: string;
      pv: string[];
      evalCp: number | null;
      evalMate: number | null;
      trade: boolean;
      escalated: boolean;
      // Whole-branch review (2026-08-03, Important finding 1): required,
      // never defaulted -- see HintFindings.verified's own comment. Both
      // real producers (computeHint, computePositionView) always set this.
      verified: boolean;
      recommendation?: { san: string };
    };
  }
): ChatFactList {
  const chess = new Chess();
  const ordered = [...gameMoves].sort((a, b) => a.ply - b.ply);
  const gameSans: string[] = [];
  for (const m of ordered) {
    const mv = chess.move(m.san);
    gameSans.push(mv.san);
  }
  // Phase round (Task 3, 2026-07-30): the shared latching timeline, built
  // once from the same ordered gameMoves the replay above just consumed --
  // phaseAt(ply) answers "what phase is THIS ply" with the same lichess
  // divider predicates the debrief renders from (src/review/gamePhases.ts's
  // own header comment covers the algorithm; nothing about it is
  // reimplemented here).
  const phases = phasesForGame(ordered);

  const perPlyAnalysis = perPly?.map((p, i) => ({
    ...p,
    phase: phases.phaseAt(p.ply),
    // Whole-branch review (2026-08-03, Important finding 2): gap (and its
    // mate-override inside gapWord) must only ever describe a real
    // DEVIATION -- a ply where she played something other than the engine's
    // own best move. Previously this was computed for every ply with a
    // prior eval, with no deviation check at all, so a ply where she played
    // bestSan itself (including converting a mate correctly) could still
    // read "decisively better" purely because a mate appeared on either
    // side of the pair -- inventing a decisive miss on a move she played
    // BEST. p.bestSan === null means "no best move ever computed for this
    // ply" (never a deviation, nothing to compare against either).
    gap: i > 0 && p.bestSan !== null && p.bestSan !== p.san
      ? gapWordForPly(perPly[i - 1], p)
      : undefined,
  }));

  const { fen: currentFen, toMove, occupancy, legalSans, contested } = derivePositionFacts(chess);

  // Task 1 (R2, pending-move context threading): ctx.pendingMove is a
  // CLIENT CLAIM (GamePage's own local judgment of what's sitting on the
  // board, unconfirmed), not fact -- distrust-verify it is actually a legal
  // move from the position just replayed above (the same `chess` instance
  // currentFen came from, so it can never disagree with it) before it is
  // allowed to influence allowedSans or reach the model. An illegal/stale
  // claim (the player retracted the move, or this request raced a retarget)
  // is dropped entirely, never partially trusted -- same discipline as
  // every other fact in this list, which is derived, never taken on faith.
  let verifiedPendingMove = ctx.pendingMove;
  if (verifiedPendingMove) {
    const probe = new Chess(chess.fen());
    let legal = false;
    try {
      legal = probe.move({ from: verifiedPendingMove.from, to: verifiedPendingMove.to, promotion: "q" }) != null;
    } catch {
      legal = false;
    }
    if (!legal) verifiedPendingMove = undefined;
  }

  // Round 2026-07-22: the focused turning point's own moment. Replayed from
  // the same ordered move list, stopping BEFORE the focused ply, so it is
  // derived by exactly the discipline currentFen is (never hand-computed,
  // never patched up from the current position).
  const focusPly = ctx.turningPointFocus?.ply;
  let focusPosition: ChatFactList["focusPosition"];
  if (focusPly !== undefined) {
    const focusChess = new Chess();
    for (const m of ordered) {
      if (m.ply >= focusPly) break;
      focusChess.move(m.san);
    }
    focusPosition = { ply: focusPly, ...derivePositionFacts(focusChess) };
  }

  const tpOut = turningPoints?.map((t) => ({
    ply: t.ply,
    san: t.san,
    label: t.label,
    punishSan: t.punishSan ?? undefined,
  }));

  const sans = new Set<string>(gameSans);
  for (const s of legalSans) sans.add(s);
  if (ctx.threat?.refutationSan) sans.add(ctx.threat.refutationSan);
  if (ctx.best?.san) sans.add(ctx.best.san);
  if (ctx.recommendation?.san) sans.add(ctx.recommendation.san);
  for (const t of tpOut ?? []) {
    sans.add(t.san);
    if (t.punishSan) sans.add(t.punishSan);
  }
  // Missed-win round (2026-07-28): folds every per-ply bestSan/pvSans the
  // model is HANDED (restored by 46f641a, replay-verified server-side from
  // fenBefore) into the allow-list. Only replay-verified engine lines join
  // here, never a claim.
  //
  // Union review 2026-07-28 correction: this fold does NOT make those moves
  // speakable, which is what an earlier version of this comment claimed.
  // checkVoice rejects EVERY non-bare-square SAN-shaped token independently
  // of allowedSans (see chat.ts:671 and the both-routes pins in
  // chat.general.test.ts), so a reply echoing "Qh8#" as literal notation is
  // still zapped -- by the voice rule, not by this list. The fold is kept
  // because allowedSans is the truth-membership record for SAN a future
  // non-voice path may consult, and it costs no prompt tokens (allowedSans
  // is stripped from the model-facing facts at factsForModel). It is
  // currently redundant with checkVoice. Do not cite it as a speakability
  // mechanism.
  for (const p of perPly ?? []) {
    if (p.bestSan) sans.add(p.bestSan);
    for (const s of p.pvSans) sans.add(s);
  }
  // Task 7 fold: the turningPoints list above only ever carries a turning
  // point's OWN san/punishSan (the debrief's persisted facts) -- never the
  // best line, so a player asking "what should you have played instead" at
  // a focused card would previously get a redirect even though the card
  // itself displays that exact line (GamePage's turningLines fetch). Folding
  // ctx.turningPointFocus's bestSan + pvSans in here is the one change that
  // lets the coach legally NAME it. Geography-free-squares + strict-SAN
  // validation in validateChat below is untouched by this fold.
  if (ctx.turningPointFocus?.bestSan) sans.add(ctx.turningPointFocus.bestSan);
  for (const s of ctx.turningPointFocus?.pvSans ?? []) sans.add(s);
  // Task 3 (Wave D): the move she actually played at the focused turning
  // point -- without this, the coach's own true statement of what she did
  // ("you played Qf6") could be rejected as an unsanctioned move whenever it
  // differs from the line's own bestSan/pvSans.
  if (ctx.turningPointFocus?.playedNextSan) sans.add(ctx.turningPointFocus.playedNextSan);
  // Task 4 fold (R1b): identical reasoning, for the hint ladder's own focus
  // -- without this, a hint follow-up asking "why is that the move?" could
  // never legally name the move the hint itself is about.
  if (ctx.hintFocus?.bestSan) sans.add(ctx.hintFocus.bestSan);
  for (const s of ctx.hintFocus?.pvSans ?? []) sans.add(s);
  // Round 2026-07-22: moves that were legal AT the focused moment. Without
  // these, a coach correctly discussing what she could have played back
  // then gets its own true sentence rejected, because those moves are not
  // legal today. Same fold, same reason, as the bestSan/pvSans fold above.
  for (const s of focusPosition?.legalSans ?? []) sans.add(s);
  // Task 1 fold (R2): the verified pending move's own san -- see the
  // legality check above. Only ever a real legal move by the time it's here.
  if (verifiedPendingMove?.san) sans.add(verifiedPendingMove.san);

  // Round 3 (Q2 step 3): fold the hint shelf into the fact list ONLY when
  // its fen matches the position actually in play -- live currentFen, or the
  // focused turning point's own pre-move fen when she's asking about a past
  // moment. A shelf entry for a fen that matches neither is a hint from a
  // position the board has since moved past and must be dropped, never
  // shown as if it still applied (fen-keying, same discipline as
  // focusPosition itself). pv/bestUci are converted uci->san by replay from
  // the matched fen, same discipline perPlyAnalysis's bestSan/pvSans
  // already follow -- stop at the first illegal move rather than throw.
  let hintFindings: ChatFactList["hintFindings"];
  if (hintCandidate) {
    const matchFen =
      hintCandidate.fen === currentFen
        ? currentFen
        : focusPosition && hintCandidate.fen === focusPosition.fen
          ? focusPosition.fen
          : undefined;
    if (matchFen) {
      const hc = hintCandidate;
      const board = new Chess(matchFen);
      const bestMove = board.move({
        from: hc.facts.bestUci.slice(0, 2),
        to: hc.facts.bestUci.slice(2, 4),
        promotion: (hc.facts.bestUci.slice(4, 5) || undefined) as "q" | "r" | "b" | "n" | undefined,
      });
      const bestSan = bestMove?.san ?? hc.facts.bestUci;
      const pvBoard = new Chess(matchFen);
      const pvSans: string[] = [];
      for (const u of hc.facts.pv) {
        const mv = pvBoard.move({
          from: u.slice(0, 2),
          to: u.slice(2, 4),
          promotion: (u.slice(4, 5) || undefined) as "q" | "r" | "b" | "n" | undefined,
        });
        if (!mv) break;
        pvSans.push(mv.san);
      }
      hintFindings = {
        fen: matchFen,
        bestSan,
        bestUci: hc.facts.bestUci,
        evalCp: hc.facts.evalCp,
        evalMate: hc.facts.evalMate,
        pvSans,
        trade: hc.facts.trade,
        escalated: hc.facts.escalated,
        verified: hc.facts.verified,
        recommendationSan: hc.facts.recommendation?.san,
      };
      sans.add(bestSan);
      for (const s of pvSans) sans.add(s);
    }
  }

  return {
    gameSans,
    currentFen,
    toMove,
    occupancy,
    legalSans,
    focusPosition,
    turningPoints: tpOut,
    status: outcomeInfo?.status ?? "in-progress",
    outcome: outcomeInfo?.outcome,
    // Task 1 (R2): context carries the VERIFIED pendingMove, never the raw
    // client claim -- an illegal/dropped claim must not reach validateChat,
    // factsForModel, or the advice_traces record either.
    context: { ...ctx, pendingMove: verifiedPendingMove },
    allowedSans: [...sans],
    contested,
    perPlyAnalysis,
    highlightedPlies,
    hintFindings,
  };
}

// F16 geography-free policy: a token that is EXACTLY a square name (e.g.
// "f1") is always allowed, full stop -- verifying whether a named square is
// a "real" one from this position would need the fact list to carry
// per-square provenance, which nothing upstream computes. SAN-like tokens
// (piece letter, capture, promotion, castling) still have to be a move that
// was actually played, is legally available from the current position, or
// appears in the live context/turning-point facts.
function isBareSquare(token: string): boolean {
  return /^[a-h][1-8]$/.test(token);
}

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,!?;:'"]+$/, "");
}

// ---- defender-claim validation --------------------------------------------
// Task 3 (2026-07-22, truthfulness leaks): extracted unchanged into
// ./defenseClaims.ts, so server/coach/validate.ts's validateNarration can
// share the exact same checker on the narrate() path (the coach's-corner
// narration surface had nothing checking its own defense claims at all --
// see that file's header comment for the live example this closes).

// ---- side-attribution claim validation ------------------------------------
// The coach once attributed the PLAYER's own pending move to mallow ("you
// win her queen for free" about the player's own Qh5) -- toMove and
// legalSansBelongTo (ChatFactList/factsForModel above) give the model the
// fact, but nothing previously checked the model's OWN prose against it.
// Modeled directly on checkDefenseClaims above: one narrow claim shape, chess
// facts already in hand (no engine call), routed into the same violations
// array. The claim shape: a SAN token explicitly attributed to a named side
// via a fixed, small verb list, in the four fixed subject forms "mallow/she
// /you/your <verb> <SAN>". Ownership is only adjudicated against legalSans
// (the CURRENT toMove side's moves) -- gameSans don't carry a per-san side
// label, so a token that isn't a legal move right now is left unflagged
// rather than guessed at.
//
// Three exclusions, added after a controller review caught each one flagging
// a truthful sentence (2026-07-22):
//   1. Present tense only. "played"/"moved"/"took" almost always describe a
//      move already made, which legalSans (the CURRENT side's OPTIONS) has
//      no opinion about -- "mallow played Nf3" can be a true description of
//      an earlier move even when Nf3 is also legal for the player right now.
//      Only present-tense verbs are adjudicated; the observed live bug was
//      present-tense attribution of a PENDING move, so nothing real is lost.
//   2. Castling is never adjudicated. O-O/O-O-O is the identical token for
//      both colors, so legalSans membership alone can never tell whose
//      castling a mention refers to.
//   3. Conditional/hypothetical lines are skipped. The coach reasons in
//      lines constantly ("if you play Nf3, she takes e5") -- a conditional
//      marker earlier in the same sentence (captured via a bounded filler
//      group and tested with a regex, the same idiom guardClaimRe/
//      GUARD_NEGATION_RE already use for their "between" capture, not a
//      sentence-splitting layer) means the named side is inside a
//      hypothetical, not a literal claim about the current position.
// Precision over recall, same as the guard/safety checker: a verb outside
// the fixed list, a pronoun ("her"/"him"), or a second clause naming the
// other side is never chased -- a missed attribution costs nothing, a false
// positive costs a real reply.
const SIDE_ATTR_SUBJECTS = "mallow|she|you|your";
const SIDE_ATTR_VERBS = "plays the|plays as|plays|moves|takes"; // present tense only -- exclusion 1
const SAN_TOKEN_SRC = "(?:O-O(?:-O)?|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?)";
const SIDE_ATTR_CONDITIONAL_RE = /\b(if|unless|suppose|say|imagine|were you to|what if)\b/i;

function sideAttributionRe(): RegExp {
  // group 1: up to 40 chars of same-sentence filler BEFORE the subject
  // (bounded by excluding sentence-ending punctuation from the class, so a
  // match can never reach back across a prior sentence) -- checked for a
  // conditional marker, exclusion 3. group 2: the subject (mallow/she/you/
  // your), group 3: the SAN token immediately following the verb -- no
  // filler allowed between subject, verb, and token, so this never crosses
  // into a second clause.
  return new RegExp(
    `([^.!?]{0,40})\\b(${SIDE_ATTR_SUBJECTS})\\b\\s+(?:${SIDE_ATTR_VERBS})\\s+(${SAN_TOKEN_SRC})\\b`,
    "gi"
  );
}

function checkSideAttributionClaims(text: string, facts: ChatFactList): string[] {
  const violations: string[] = [];
  const legalSans = new Set(facts.legalSans);

  for (const m of text.matchAll(sideAttributionRe())) {
    const [, before, subjectRaw, sanRaw] = m;
    if (SIDE_ATTR_CONDITIONAL_RE.test(before)) continue; // hypothetical line -- exclusion 3
    const subject = subjectRaw.toLowerCase();
    const claimedSide: "you" | "mallow" = subject === "mallow" || subject === "she" ? "mallow" : "you";
    if (claimedSide === facts.toMove) continue; // correctly attributed
    const token = stripTrailingPunctuation(sanRaw);
    if (/^O-O(-O)?$/i.test(token)) continue; // castling is ambiguous between colors -- exclusion 2
    if (!isAllowedSanToken(token, legalSans)) continue; // not toMove's legal move right now -- can't adjudicate
    violations.push(`side-claim: ${token} is ${facts.toMove}'s move to play, not ${claimedSide}'s`);
  }

  return violations;
}

// ---- voice-guard validation ------------------------------------------------
// Task 3a (R2, voice-enforcement round, 2026-07-22): the coach's own voice
// rules (personas/coach.md's "## voice" block, Task 2 this round) ban raw
// notation as a move's name, the infra words "engine"/"eval(uation)"/
// "centipawn(s)"/"cp", and any stated number for the position -- but
// nothing previously checked a reply's OWN prose against those rules, the
// same gap checkDefenseClaims/checkPlacementClaims/checkSideAttributionClaims
// close for chess-fact claims. Modeled on those checkers: precision over
// recall, no engine call, three narrow claim shapes routed into the same
// violations array validateChat already returns.
// Round 3 (trace 126, old L2): "ply" added -- engine-internal half-move
// counting language, the same class of jargon as engine/eval/cp. She reads
// a game in move-number pairs (the `move` field perPlyForModel/focusForModel
// now carry alongside ply), never in raw plies.
const VOICE_BANNED_WORDS_RE = /\b(engine|evals?|evaluations?|centipawns?|cp|ply)\b/gi;
// A signed integer/decimal ("+50", "-3.4") -- a stated eval number for the
// position. Deliberately requires the leading sign: an unsigned integer
// ("mate in 3", "move 12") is a ply/mate count, not a position eval, and
// the plan's must-pass cases exist precisely to keep this from overreaching
// into them.
const VOICE_SIGNED_NUMBER_RE = /[+-]\d+(?:\.\d+)?/g;
// Any integer (signed or not) directly followed by "cp"/"centipawns", with
// or without a space ("50cp", "50 centipawns") -- catches the unspaced form
// VOICE_BANNED_WORDS_RE's \b can't (no word boundary between a digit and
// the letters immediately following it).
const VOICE_CP_NUMBER_RE = /\b\d+(?:\.\d+)?\s*(?:cp|centipawns?)\b/gi;

// Round 3 Task 13 (item 5/E, trust floor): a small, precision-over-recall
// detector for "did she explicitly ask for the number" -- deliberately
// narrow, the same discipline every other checker in this file follows: a
// false negative just means the coach keeps speaking in words (the existing
// safe default); a false positive would let a number slip out unprompted,
// exactly what the ban below exists to stop. Matches an explicit request
// for the eval/score/number itself ("what's the eval", "give me the
// number", "how many centipawns"), not any ordinary "who's better"/"am I
// winning" question, which stays a words-only answer.
const NUMBER_ASK_RE =
  /\b(what'?s|what is|give me|tell me|show me)\b[^.?!]{0,30}\b(the\s+)?(number|score|eval(uation)?s?|centipawns?|cp)\b|\bhow (many|much)\b[^.?!]{0,20}\bcentipawns?\b/i;

export function asksForNumber(message: string): boolean {
  return NUMBER_ASK_RE.test(message);
}

// Round 3 Task 13 attempted to scope `opts.userAskedForNumber` to lift ONLY
// the two stated-number checks below (a raw cp count, a signed eval number)
// when she explicitly asked for the figure. Whole-branch review (2026-08-03,
// Critical finding 1) reverted that lift: no TRUE cp/eval number is ever
// routed into the model-facing projection to begin with (readForPly emits
// WORDS only -- "you're much better" -- and chat.ts:433/1104/1285's own
// comments are explicit that "factsForModel must never leak evalCp/evalMate
// as numbers"). Disabling the number-ban on exactly the turn she asks for a
// number, with no true number anywhere in her prompt to ground a reply in,
// left the model free to fabricate one -- and turned off the one validator
// that would have caught it. CONSERVATIVE FIX: the ban stays unconditional
// regardless of `opts.userAskedForNumber` -- the coach must never state a
// number it was never given. `opts.userAskedForNumber` is accepted (call
// sites still pass it) but currently unused here; it becomes live again only
// if a future change grounds the real evalCp into the on-ask prompt so a
// TRUE number exists to validate against -- a behavior choice for the owner,
// not made here.
function checkVoice(text: string, _opts: { userAskedForNumber?: boolean } = {}): string[] {
  const violations: string[] = [];

  for (const raw of text.match(SAN_RE) ?? []) {
    const token = stripTrailingPunctuation(raw);
    if (isBareSquare(token)) continue; // geography, not notation -- cut #2 carve-out
    violations.push(`voice-notation: ${token}`);
  }

  for (const m of text.matchAll(VOICE_BANNED_WORDS_RE)) {
    violations.push(`voice-word: ${m[0].toLowerCase()}`);
  }

  for (const m of text.matchAll(VOICE_CP_NUMBER_RE)) {
    violations.push(`voice-number: ${m[0]}`);
  }
  for (const m of text.matchAll(VOICE_SIGNED_NUMBER_RE)) {
    violations.push(`voice-number: ${m[0]}`);
  }

  return violations;
}

// ---- opponent-move quality-claim validation (opponent-move-analysis plan) --
// Wave C (2026-08-03). Scoped NARROWLY to an ACTIVE opponent-move focus --
// never ordinary chat (the check-widening lesson, CLAUDE.md's invariant
// rule: audit what's newly in scope before shipping a widened checker,
// don't let the gate find a false positive). Fires only when
// facts.focusPosition is set AND the focused ply is mallow's
// (sideForPly(focus.ply) === "mallow" -- the same canonical function
// focusedMomentSection above uses, never a second parity computation), and
// only when facts.context.turningPointFocus itself carries matchedBest/
// quality (set exclusively by chatFocus.ts's opponentMoveFocusContext for a
// mallow-ply focus -- see ChatContext.turningPointFocus's own comment).
//
// The claim: the reply calls the focused move a mistake/blunder/bad while
// the facts say matchedBest===true or quality is "best"/"solid" -- the
// narrow, high-confidence honesty zone (§8 of the plan): a move that either
// matched the engine's own top choice, or missed it by less than the
// gapWord "no real gap" floor, can never legitimately read as a slip. A
// "fine"/"slip" quality is NOT flagged here even alongside "mistake" --
// this checker is not a second opinion on a genuine borderline call, only a
// guard against contradicting a clean fact already in hand.
//
// Deliberately NOT folded into validateChat's violations array: every kind
// in that array drives ONE regen (a second, ~20s model call, correctiveSuffix
// appended to the PROMPT). This violation is answerable from a fact already
// in hand (facts.context.turningPointFocus's own matchedBest/quality, both
// server-computed once by Wave A's highlightLines.ts, never re-derived
// here) -- correcting it costs a deterministic string append (0ms), not a
// second model call. chat() below applies this AFTER the model/regen loop,
// directly to the returned text, never inside the regen path.
//
// Producer grep (§4/§8's check-widening requirement, run before shipping):
// the only producer of mistake/blunder/"bad" vocabulary that can reach THIS
// route is the MODEL'S OWN generated reply text.
// src/review/highlightedMoves.ts's SEVERITY_LINE lives on the debrief-only
// path (verified 2026-07-29, CLAUDE.md: "the debrief/analysis path... contains
// no LLM call at all") and never reaches chat; personas/coach.md's own
// "never scold, never say mistake or wrong" line is an INSTRUCTION TO the
// model, not a producer of the words into a reply. So a false positive here
// can only ever come from the model's own prose, which is exactly what this
// checker exists to catch.
const OPPONENT_MISTAKE_WORD_RE = /\b(mistake|blunder(?:ed)?|bad move|a bad|played badly|screwed up|messed up)\b/i;

export function checkOpponentQualityClaims(text: string, facts: ChatFactList): string | undefined {
  const focus = facts.focusPosition;
  if (!focus) return undefined;
  if (sideForPly(focus.ply) !== "mallow") return undefined;
  const tp = facts.context?.turningPointFocus;
  if (!tp) return undefined;
  const clean = tp.matchedBest === true || tp.quality === "best" || tp.quality === "solid";
  if (!clean) return undefined;
  if (!OPPONENT_MISTAKE_WORD_RE.test(text)) return undefined;

  return tp.matchedBest === true || tp.quality === "best"
    ? "\n\nactually, that move matched the computer's own top choice here -- not a mistake."
    : "\n\nactually, that move was barely off the computer's own top choice here -- not a mistake.";
}

export function validateChat(
  text: string,
  facts: ChatFactList,
  opts: { userAskedForNumber?: boolean } = {}
): { ok: true } | { ok: false; violations: string[] } {
  const allowedSans = new Set(facts.allowedSans);
  const violations: string[] = [];

  for (const raw of text.match(SAN_RE) ?? []) {
    const token = stripTrailingPunctuation(raw);
    if (isBareSquare(token)) continue; // geography, always allowed -- cut #2
    if (!isAllowedSanToken(token, allowedSans)) violations.push(token);
  }

  // Round 2026-07-22: a focused turn is ABOUT a past moment, so a defense
  // claim true back then is not a lie now. Judge against both positions and
  // keep only what is false in BOTH -- a claim the checker flags in one
  // position but not the other is one the conversation's own moment
  // vindicates, and flagging it would cost a truthful reply a regen (and
  // possibly a template). The two runs produce identical strings when both
  // flag, because the message states the truth the claim contradicts and
  // the claim is fixed, so a plain intersection is exact here.
  const unsafeRecaptureSquares = unsafeRecaptureSquaresFrom(facts.context?.threat);
  const currentDefense = checkDefenseClaims(text, facts.currentFen, unsafeRecaptureSquares);
  if (facts.focusPosition) {
    const focusDefense = new Set(checkDefenseClaims(text, facts.focusPosition.fen, unsafeRecaptureSquares));
    violations.push(...currentDefense.filter((v) => focusDefense.has(v)));
  } else {
    violations.push(...currentDefense);
  }
  violations.push(...checkSideAttributionClaims(text, facts));
  // Task 1 (R3, 2026-07-22 fact-gap round): the placement-claim check takes
  // both occupancy lists itself and applies the same both-positions
  // intersection internally (see checkPlacementClaims's own comment) --
  // unlike checkDefenseClaims above, there's no separate current/focus call
  // + filter needed here.
  violations.push(...checkPlacementClaims(text, facts.occupancy, facts.focusPosition?.occupancy));
  // Task 3a (R2, voice-enforcement round): no facts needed -- this checker
  // is about the SHAPE of the prose (notation/banned words/numbers), not
  // whether a claim matches the position. Round 3 Task 13: opts threads
  // straight through, so this route's number ban scopes exactly the same
  // way the general route's does below.
  violations.push(...checkVoice(text, opts));
  // Forward-prediction round (2026-07-28): the then facts invite the model
  // to name mates by number -- adjudicate digit-form "mate in N" against
  // the Ns the fact list itself vouches for (evalMate, then claims, and a
  // focused line that visibly ends in #). Board route only: the general
  // route may legitimately reference mates outside this game.
  const focusMateNs: number[] = [];
  for (const line of [facts.context?.hintFocus?.pvSans, facts.context?.turningPointFocus?.pvSans]) {
    const last = line?.[line.length - 1];
    if (line && last && last.endsWith("#")) focusMateNs.push(Math.ceil(line.length / 2));
  }
  // Round 3 (Q2 step 4): facts.hintFindings?.evalMate is undefined when no
  // shelf entry matches this position (preserves the no-truth-source cut),
  // null when a shelf entry exists but found no forced mate (now
  // adjudicated), or a number the shelf vouches for -- see
  // checkMateClaims's own comment for why the undefined/null distinction
  // must NOT be collapsed with `?? null` here.
  violations.push(...checkMateClaims(text, facts.perPlyAnalysis ?? [], focusMateNs, facts.hintFindings?.evalMate));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}

// Task 2 (Wave D): whether the REPLY itself makes a claim about the
// position -- names a SAN-shaped token or a bare square. Reused as the gate
// for the three position-claim checkers in validateChatGeneral below: "if
// it makes no positional claim there is nothing to check" (the brief's own
// words). Same SAN_RE the board route's own validateChat scans with.
function replyReferencesPosition(text: string): boolean {
  return (text.match(SAN_RE) ?? []).length > 0;
}

// Task 2 (Wave D, general-chess route): validateChat's sibling for the
// general route -- kept as a SEPARATE function rather than an intent branch
// inside validateChat itself, so validateChat (and therefore the board
// route) stays byte-for-byte unchanged by this wave ("board route: change
// nothing").
//
// Review fix (Wave F, 2026-07-27, review.md finding 5): this function has NO
// allowedSans-membership check at all (unlike validateChat's SAN loop) --
// by design, a general answer may legitimately name a move that was never
// played in THIS game ("consider castling early" is a true, useful answer
// to a general question). The PREVIOUS version of this comment overclaimed
// what that relaxation buys: checkVoice (kept unconditionally, below)
// already flags EVERY non-bare-square SAN-shaped token as voice-notation
// regardless of whether it names a real/legal/played move, so
// "developing your knight with Nf3" is rejected on THIS route exactly as it
// would be on the board route -- not because it names an unplayed move
// (this route was built specifically not to police that), but because
// cookie never speaks in notation, on EITHER route. So the relaxation only
// ever has daylight to matter for a move named in PLAIN WORDS with no
// SAN-shaped token at all ("knight to f3", not "Nf3") -- see
// chat.general.test.ts for the honest version of this claim, replacing a
// prior test that asserted it vacuously (checking a violations array that
// was never going to contain the bare move token in the first place).
//
// Keeps checkVoice unconditionally: voice rules are about HOW cookie talks
// (no raw notation, no engine/eval/centipawn jargon, no signed numbers), not
// about what she may discuss.
//
// The three position-claim checkers (defense/side-attribution/placement)
// only run when the reply itself references the position
// (replyReferencesPosition above) -- a pure-principle answer with no move
// or square in it has nothing for them to check against.
export function validateChatGeneral(
  text: string,
  facts: ChatFactList,
  opts: { userAskedForNumber?: boolean } = {}
): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = [];

  if (replyReferencesPosition(text)) {
    const unsafeRecaptureSquares = unsafeRecaptureSquaresFrom(facts.context?.threat);
    const currentDefense = checkDefenseClaims(text, facts.currentFen, unsafeRecaptureSquares);
    if (facts.focusPosition) {
      const focusDefense = new Set(checkDefenseClaims(text, facts.focusPosition.fen, unsafeRecaptureSquares));
      violations.push(...currentDefense.filter((v) => focusDefense.has(v)));
    } else {
      violations.push(...currentDefense);
    }
    violations.push(...checkSideAttributionClaims(text, facts));
    violations.push(...checkPlacementClaims(text, facts.occupancy, facts.focusPosition?.occupancy));
  }

  violations.push(...checkVoice(text, opts));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}

// ---- prompt assembly ------------------------------------------------------

function stripThreatUci(t: ThreatFacts): Omit<ThreatFacts, "refutationUci"> {
  const { refutationUci, ...rest } = t;
  return rest;
}

// The fact JSON serialized into the chat prompt carries NO uci fields --
// san is all a model (or a player) ever needs; uci is an internal engine
// detail. context.best.uci, context.threat.refutationUci, and (as of Task
// 4, R1b) context.hintFocus.threat.refutationUci are the three places one
// could leak in, so those are the only fields stripped here.
// Owner playtest 2026-07-22: the focused fact list added ~2.2k characters
// to exactly the turns that were already the slowest, and her next two
// focused asks both hit the hard 20s timeout (traces 57/58, prompts 9.7k
// and 9.9k, against 4.6-5.1s answers at 7.5k). occupancy was 1521 of the
// 1976 added characters, and almost all of it is redundant: most pieces
// stood on the same squares then as now, and the model already has the
// current occupancy. So the model is sent only the squares that DIFFER,
// which is precisely the error this round fixed (mallow's queen described
// on a5 when it stood on d8). The full focus position stays on the fact
// list for validation, which needs the exact position, not a summary.
function focusForModel(facts: ChatFactList) {
  const focus = facts.focusPosition;
  if (!focus) return undefined;
  const key = (o: { square: string; pieceKind: string; color: string }) =>
    `${o.square}:${o.pieceKind}:${o.color}`;
  const nowKeys = new Set(facts.occupancy.map(key));
  const thenKeys = new Set(focus.occupancy.map(key));
  return {
    ply: focus.ply,
    move: moveNumberOf(focus.ply),
    fen: focus.fen,
    toMove: focus.toMove,
    contested: focus.contested,
    // Everything not listed here stood where it stands now.
    stoodHereThenButNotNow: focus.occupancy.filter((o) => !nowKeys.has(key(o))),
    standHereNowButNotThen: facts.occupancy.filter((o) => !thenKeys.has(key(o))),
  };
}

// Task 3 (R1a): the compact projection of perPlyAnalysis sent to the model
// -- ply/san/bestSan/phase plus only the first 2 pvSans (dropping the rest
// keeps the whole-game list readable; the full pv is never what "what
// should you have played" needs beyond a move or two of follow-up, and the
// focused hint/turning-point folds already carry a complete line when one
// is in view).
// Task 3b (R2, voice-enforcement round): evalCp/evalMate no longer reach
// this projection at all -- readForPly (above) replaces both with a single
// qualitative `read` string, and no key here contains the literal substring
// "eval". The raw numbers stay on the ChatFactList itself.
// Forward-prediction round (2026-07-28): raised 2 -> 6 for full-detail
// plies. Two moves of line cannot answer "and what happens after that" --
// six (three of hers, three of mallow's) walks a real sequence, and the
// full-detail set is small enough that the measured cost on a real 91-ply
// game was +35 tokens of the round's +363 total. Collapsed plies still ship
// no pvSans at all -- the `then` claim is their whole continuation story.
const PER_PLY_PV_MODEL_LIMIT = 6;

// B4b (2026-07-27, coach-truth-speed round): the whole-game perPlyAnalysis
// list is affordable to CARRY (assembleChatFactList still ships every ply,
// so the trace JSON stays complete for the Lab) but not to SEND to the
// model at full detail for every ply of a long game -- most of it is
// completely irrelevant to whatever she actually asked. Full detail
// (pvSans/phase, alongside san/bestSan/read) goes only to plies in the
// union of: turning-point plies (she can ask about any of them), the
// focused moment +/- FOCUS_PLY_RADIUS (a "why this move" follow-up usually
// means a move or two of surrounding context, not just the one ply), the
// live pending move's own ply (the move she's about to make sits right at
// the game's current tip -- included for the same "the moment in view gets
// full detail" reason, even though in practice RECENT_PLY_WINDOW already
// covers it since a pending move can only exist at the live tip), and the
// last RECENT_PLY_WINDOW plies (ordinary "how did I just do" chat, which is
// the common case). Every other ply collapses to {ply, san, bestSan, read}
// -- still enough to answer "what did I play, how did it go, and what
// should I have played instead" for the whole game, just without the
// pvSans/phase weight.
//
// B4c (2026-07-28, coach-truth-speed round, regression fix): B4b's original
// collapse dropped bestSan too, alongside pvSans/phase. That shipped a
// regression the same morning it landed (005b050): the owner asked about
// move 27/28 in a 91-ply game -- ~37 plies back, well outside
// RECENT_PLY_WINDOW -- and the coach had no bestSan for that ply at all, so
// it honestly (but wrongly, from her point of view) said it couldn't name
// the better move. bestSan is one short token per ply; restoring it on
// every collapsed ply is a small fraction of what dropping pvSans/phase
// still saves (measured on a real 91-ply game: see chat.ts's own change
// notes / the round's report for the before/after character count).
const RECENT_PLY_WINDOW = 12;
const FOCUS_PLY_RADIUS = 2;

// Union-review finding 2 (whole-branch review, coach-truth-speed round,
// 2026-07-28): the per-ply projection below carried no side marker at all,
// and coach.md's chat section told the model the story reads as "your move
// then her reply" -- but odd plies are the player's own move and even
// plies are mallow's (the player is always white, the same fixed mapping
// derivePositionFacts uses), and that alternation is invisible from a
// single collapsed ply's shape once it's pulled out of game order (a
// turning-point lookup, a "what about move 24" follow-up, a collapsed ply
// carrying only its own `then`). Real game 150 ply 24 -- an even, mallow
// ply -- shipped {"san":"Nc6","bestSan":"Re8","then":"you win the rook"}
// with nothing marking whose move `san` was, so a coach reading it
// literally could attribute mallow's move to the player.
// checkSideAttributionClaims can't catch this: it only adjudicates the
// CURRENT legalSans, never who-owns-which-ply. Fixed at the fact layer
// (this field), not by asking the model to compute ply parity itself.
function sideForPly(ply: number): "you" | "mallow" {
  return ply % 2 === 1 ? "you" : "mallow";
}

// Round 3 (trace 126, old L2): the move number she'd actually use to talk
// about this ply -- ply 7 and ply 8 are both "move 4" (white's half then
// black's), matching how a player reads a game in numbered move pairs, not
// raw engine-internal half-move plies. Additive alongside ply everywhere it
// appears in the model-facing projection (ply itself stays -- chat.sideLabel
// .test.ts pins "ply" and "side" appearing together in the same entry).
function moveNumberOf(ply: number): number {
  return Math.ceil(ply / 2);
}

function perPlyForModel(facts: ChatFactList, mentioned: number[] = []) {
  const perPlyAnalysis = facts.perPlyAnalysis;
  if (!perPlyAnalysis) return undefined;

  const maxPly = perPlyAnalysis.reduce((m, p) => Math.max(m, p.ply), 0);
  const fullDetailPlies = new Set<number>();
  for (const tp of facts.turningPoints ?? []) fullDetailPlies.add(tp.ply);
  if (facts.focusPosition) {
    for (let d = -FOCUS_PLY_RADIUS; d <= FOCUS_PLY_RADIUS; d++) {
      fullDetailPlies.add(facts.focusPosition.ply + d);
    }
  }
  if (facts.context?.pendingMove) fullDetailPlies.add(facts.gameSans.length + 1);
  for (const p of perPlyAnalysis) {
    if (p.ply > maxPly - RECENT_PLY_WINDOW) fullDetailPlies.add(p.ply);
  }
  // Forward-prediction round (2026-07-28): plies the player named in this
  // very message ("move 27", "ply 55") -- promoted with the same radius the
  // focused moment gets, for the same reason (a "what about that moment"
  // follow-up wants a move or two of surrounding context).
  for (const p of mentioned) {
    for (let d = -FOCUS_PLY_RADIUS; d <= FOCUS_PLY_RADIUS; d++) {
      fullDetailPlies.add(p + d);
    }
  }
  // Highlight-a-move (Task 8): a ply she flagged during live play always
  // ships full detail, no matter its age -- same exemption a turning point
  // or the focused ply already get above. Seeded directly here rather than
  // through facts.turningPoints (see that field's own comment: turning
  // points fold into allowedSans for validateChat, and a highlighted ply
  // that was never an actual turning point would drift that allow-list).
  for (const ply of facts.highlightedPlies ?? []) fullDetailPlies.add(ply);

  return perPlyAnalysis.map((p) => {
    const read = readForPly(p.ply, p.evalCp, p.evalMate);
    const side = sideForPly(p.ply);
    const move = moveNumberOf(p.ply);
    if (!fullDetailPlies.has(p.ply)) {
      // Collapsed plies: then only where she deviated from best -- the
      // "what did i miss" set (62/91 plies on real game 150; +363 tokens
      // measured for the whole rule vs +508 for then-everywhere). A ply
      // where she played the best move has nothing missed to explain.
      const deviated = p.bestSan !== null && p.bestSan !== p.san;
      // move sits AFTER bestSan, never between ply/san/side/bestSan -- those
      // four are byte-pinned adjacent in manager.test.ts/chat.sideLabel.test.ts
      // (the union-review side-marker fix), and this additive field must not
      // disturb that pin.
      return deviated && p.then
        ? { ply: p.ply, san: p.san, side, bestSan: p.bestSan, move, read, ...(p.gap ? { gap: p.gap } : {}), then: p.then }
        : { ply: p.ply, san: p.san, side, bestSan: p.bestSan, move, read, ...(p.gap ? { gap: p.gap } : {}) };
    }
    return {
      ply: p.ply,
      san: p.san,
      side,
      bestSan: p.bestSan,
      move,
      // Integration-round fix (2026-07-30): p.phase is null when
      // phasesForGame had no board to prove it from (see ChatFactList's own
      // comment on this field). Omit the key entirely rather than send
      // "phase":null, "undefined", or any placeholder -- a model reading a
      // present-but-empty phase key could still state it as fact. No board
      // means no phase claim, the same rule the debrief now follows.
      ...(p.phase !== null ? { phase: p.phase } : {}),
      pvSans: p.pvSans.slice(0, PER_PLY_PV_MODEL_LIMIT),
      read,
      ...(p.gap ? { gap: p.gap } : {}),
      ...(p.then ? { then: p.then } : {}),
    };
  });
}

// Task 4 (R1b): hintFocus's own threat carries the same refutationUci field
// context.threat does -- stripped the same way, so "no uci fields reach the
// model" stays true for this third place one could leak in (the other two
// are context.best.uci and context.threat.refutationUci, noted below).
function hintFocusForModel(hintFocus: ChatContext["hintFocus"]) {
  if (!hintFocus) return undefined;
  const { threat, ...rest } = hintFocus;
  return { ...rest, threat: threat ? stripThreatUci(threat) : undefined };
}

// Task 1 (R2): the pending move's model-facing projection. `confirmed:false`
// and `note` are both explicit -- currentFen/occupancy in the surrounding
// fact list describe the position BEFORE this move (it is not on the
// board yet), and without an explicit statement of that a model reasoning
// over "current" facts could easily treat a pending move as already played.
// No deltaCp or any other number here -- pendingMove never carried one to
// begin with (see ChatContext.pendingMove's own comment).
function pendingMoveForModel(pendingMove: ChatContext["pendingMove"]) {
  if (!pendingMove) return undefined;
  return {
    ...pendingMove,
    confirmed: false,
    note: "currentFen and occupancy above show the position BEFORE this move -- it has not been played yet.",
  };
}

// Task 3b (R2, voice-enforcement round): audited every other numeric field
// this function projects for the model -- context.best (san/pieceKind/from/
// to), context.threat (motif/squares/pieceKind, uci already stripped by
// stripThreatUci), context.hintFocus (same shape via hintFocusForModel),
// context.pendingMove (pieceKind/from/to/san/tier, deliberately never
// carried a number to begin with -- see pendingMoveForModel's own comment).
// None of them carry a cp/mate number today, so there is nothing else to
// sanitize; perPlyAnalysis (via readForPly above) is the one real leak this
// task closes.
// Round 3 (Q2/B1, Task 5): the hint shelf's own model-facing projection.
// evalCp is NEVER carried through as a raw number here -- same voice-rule
// discipline readForPly already applies to perPlyAnalysis (Task 3b) -- but
// evalMate IS stated as a number: it is a mate distance (a move count, like
// "mate in 3"), not a centipawn score, and checkVoice's own signed-number
// ban already exempts that exact shape (see voiceRules.test.ts's "mate in
// 3" pin). Returns undefined when there is no shelf entry, so the "fact
// list (json)" section omits the key entirely rather than emit a null.
// Whole-branch review (2026-08-03, Important finding 1): this used to
// unconditionally stamp EVERY shelf entry "verified... deep multipv search,
// trust this over your own reasoning" -- but the shelf has two producers of
// very different confidence (see HintFindings.verified's own comment), and
// in live chat the fast, explicitly-unverified computePositionView is the
// COMMON case (a real deep hint is player-initiated and rare). Wording now
// branches on that provenance flag: only a real deep hint earns "verified"/
// "trust over your own reasoning"; the fast path is framed as a quick,
// unverified engine look to weigh, never as verified-best -- its bestSan is
// still handed over (the fact itself is real and worth having), just never
// narrated with a confidence the search never earned.
function hintFindingsForModel(hintFindings: ChatFactList["hintFindings"]) {
  if (!hintFindings) return undefined;
  const h = hintFindings;
  // Note: the fast-path wording below must not contain the substring
  // "verified" at all (not even inside a word like "unverified") -- the
  // whole point is to never let the model read this shelf entry as
  // verified-anything. "quick"/"unconfirmed" carry the honest framing
  // instead. chat.perPly.test.ts's own /verified/i check pins this.
  const note = h.verified
    ? "the hint engine's verified line for this position (deep multipv search, trust this over your own reasoning)"
    : "a quick engine look at this position (single line, ~0.5s search, not deeply checked) -- weigh it, don't just defer to it";
  const score = h.verified
    ? h.evalMate !== null
      ? `verified forced mate in ${Math.abs(h.evalMate)}`
      : "a verified best line (no mate)"
    : h.evalMate !== null
      ? `an unconfirmed quick read: mate in ${Math.abs(h.evalMate)}`
      : "an unconfirmed quick read (no mate)";
  return {
    note,
    bestSan: h.bestSan,
    ...(h.trade ? { trade: "a trade, but the strongest move here" } : {}),
    score,
    ...(h.pvSans.length ? { line: h.pvSans.join(" ") } : {}),
    ...(h.recommendationSan ? { recommendationSan: h.recommendationSan } : {}),
  };
}

function factsForModel(facts: ChatFactList, mentioned: number[] = []) {
  const { allowedSans, context, focusPosition, perPlyAnalysis, hintFindings, ...rest } = facts;
  let strippedContext: Record<string, unknown> | undefined;
  if (context) {
    const { best, threat, herMove, hintFocus, pendingMove, ...restCtx } = context;
    strippedContext = {
      ...restCtx,
      // The model-facing key is yourMove (the player is always "you"), even
      // though the internal ChatContext field stays named herMove.
      yourMove: herMove,
      threat: threat ? stripThreatUci(threat) : undefined,
      best: best ? { san: best.san, pieceKind: best.pieceKind, from: best.from, to: best.to } : undefined,
      hintFocus: hintFocusForModel(hintFocus),
      pendingMove: pendingMoveForModel(pendingMove),
    };
  }
  // legalSansBelongTo labels the bare legalSans list with whose moves it
  // holds -- always equal to facts.toMove, kept as a separate key (rather
  // than renaming legalSans itself) so the model gets the label sitting
  // right next to the list without validateChat/allowedSans needing to
  // change shape.
  return {
    ...rest,
    legalSansBelongTo: facts.toMove,
    focusPosition: focusForModel(facts),
    perPlyAnalysis: perPlyForModel(facts, mentioned),
    context: strippedContext,
    hintFindings: hintFindingsForModel(hintFindings),
  };
}

// Task 2 (Wave D, general-chess route): the general route's own compact
// projection -- deliberately NOT factsForModel's shape. A general question
// isn't about the live position, so occupancy/legalSans/contested (this
// moment's heaviest, most position-specific facts) and the whole per-ply
// block (a full line-by-line analysis) buy nothing here but latency -- this
// IS the single largest latency win available on this route (per the
// brief). What's left is enough for cookie to ground a real chess answer in
// HER actual game when a genuine connection exists, without inventing one:
// the played move list, the finished-game outcome fact, and the
// already-curated turning points (cheap to carry -- no per-ply weight).
function generalFactsForModel(facts: ChatFactList) {
  return {
    status: facts.status,
    outcome: facts.outcome,
    gameSans: facts.gameSans,
    turningPoints: facts.turningPoints,
  };
}

// Wave 3, item 1 (F5 family, game-164 incident): when a focus is present the
// history is background, not the topic -- the header says so. `background`
// defaults false, so a no-focus prompt renders the exact "conversation so
// far:" header it always has (the byte-identity pin in chat.focusPrompt.test.ts
// depends on this default path staying untouched).
function formatHistory(history: { role: "user" | "coach"; text: string }[], background = false): string {
  if (history.length === 0) return "";
  const lines = history.map((h) => `${h.role === "user" ? "player" : "coach"}: ${h.text}`);
  const header = background
    ? "conversation so far (background only -- the focused moment below is what she's asking about):"
    : "conversation so far:";
  return ["", header, ...lines].join("\n");
}

// Wave 3, item 1 (F5 family): the dedicated focus section. Emitted only when a
// turning-point moment is in focus (facts.focusPosition, the same field
// focusForModel serializes) -- it names the focused move + its move number and
// quotes the moment's own fen, then states outright that this moment overrides
// the conversation so far. game-164: the player asked about move 5 with a
// correctly-attached focus and the coach twice answered from the 8-message-old
// topic; the fact list carried the focus (buried in 23KB of JSON) but nothing
// told the model to prefer it over the running conversation. Returns a block
// with a leading blank line so it joins as its own paragraph after history and
// before the player line; undefined (no change) when nothing is focused.
// Opponent-move-analysis plan (2026-08-03), Wave C: the focus section is
// side-aware -- a MALLOW-ply focus (chatFocus.ts's opponentMoveFocusContext
// on the client, threaded through ctx.turningPointFocus) gets a distinct
// framing that names this as an opponent-move-analysis question, grounded
// ONLY in the engine facts below it, and tells the model to say so plainly
// when mallow matched the engine's own best move rather than inventing a
// verdict the facts don't support. Side comes from sideForPly(focus.ply) --
// the SAME canonical per-ply function perPlyForModel already uses to mark
// every projected ply "you"/"mallow" (chat.sideLabel.test.ts) -- never a
// second, independent parity computation written fresh here. A her-ply
// focus takes the exact pre-existing branch, byte-identical to before this
// wave (chat.stablePrefix/chat.focusPrompt.test.ts's own pin) -- prompt
// caching and the latency baselines (CLAUDE.md) depend on that text never
// shifting for an existing call shape.
function focusedMomentSection(facts: ChatFactList): string | undefined {
  const focus = facts.focusPosition;
  const tp = facts.context?.turningPointFocus;
  if (!focus || !tp) return undefined;
  const moveNumber = Math.ceil(focus.ply / 2);
  if (sideForPly(focus.ply) === "mallow") {
    return (
      `\nfocused moment: the player is asking about MALLOW'S move ${tp.san} at move ${moveNumber} (${focus.fen}) -- ` +
      `explain what the computer was doing, grounded ONLY in the engine facts below; if mallow played the engine's ` +
      `own best move, say so plainly; if the facts don't show a plan, say you can't tell. ` +
      `this focused moment overrides whatever the conversation so far was about -- answer about THIS moment. ` +
      `the conversation history above is background only.`
    );
  }
  return (
    `\nfocused moment: the player is asking about ${tp.san} at move ${moveNumber} (${focus.fen}). ` +
    `this focused moment overrides whatever the conversation so far was about -- answer about THIS moment. ` +
    `the conversation history above is background only.`
  );
}

// Wave 3, item 3 (F5 family, game-164): the labeled context for a rejected
// prior draft. `text` is the rejected draft's raw output, `kinds` a
// comma-joined list of the validation kinds it failed. Assembled by chat()
// from getLatestRejectedChatTrace + a re-validation of the stored output (see
// there); undefined when there is no unseen rejected draft.
interface RejectedDraftContext {
  text: string;
  kinds: string;
}

// Wave 3, item 3: the block placed AFTER history and BEFORE the focus section.
// game-164: because rejected replies are never persisted to chat_messages
// (the source==="model" doom-loop gate in manager.ts, which must stay), her
// follow-up "this answer made no sense" had no referent -- the model had no
// idea a previous attempt had even happened. This gives it one, clearly
// labeled as a REJECTED draft the player never saw, with the checks it failed,
// so the model neither repeats the bad claims nor treats it as a real turn.
// First ~400 chars only -- enough to identify the draft without re-bloating the
// prompt. Leading blank line so it joins as its own paragraph.
const REJECTED_DRAFT_SNIPPET_LEN = 400;
function rejectedDraftBlock(rejected: RejectedDraftContext): string {
  const snippet = rejected.text.trim().slice(0, REJECTED_DRAFT_SNIPPET_LEN);
  return (
    `\nnote: your previous attempt to answer was rejected by validation and the player never saw a valid reply. ` +
    `rejected draft (do not repeat its claims; they failed checks: ${rejected.kinds}): "${snippet}"`
  );
}

// Wave 3, item 3: the validation-kind labels for the rejected-draft note --
// the KIND prefix each checker pushes (see validateChat's checkers), with a
// bare-SAN token (no ":" -- chess notation never contains one) labeled
// "off-game move", the same split correctiveSuffix uses.
function describeViolationKinds(violations: readonly string[]): string {
  const kinds = new Set<string>();
  for (const v of violations) {
    kinds.add(v.includes(":") ? v.split(":")[0] : "off-game move");
  }
  return [...kinds].join(", ");
}

// Wave 4, item 3 (2026-08-01, game-164): the "player's standing notes:" block
// -- the READ half of cross-game memory. Placed (see buildChatPrompt) AFTER
// the fact-list json and BEFORE the history block, on purpose: it keeps Wave
// 3's carefully-ordered history -> rejected-draft -> focus -> player tail
// byte-for-byte intact, and presents the notes as persistent background the
// coach carries into every game about this player -- distinct from this-game
// facts above it and the running conversation below it. Notes are already
// plain text (the caller builds them from the player's own words); rendered as
// a simple dashed list. undefined (no block at all) when there are none, so a
// player with no standing notes gets today's exact prompt.
function standingNotesBlock(notes: string[]): string | undefined {
  if (notes.length === 0) return undefined;
  return ["", "player's standing notes:", ...notes.map((n) => `- ${n}`)].join("\n");
}

// Task 2 (Wave D): intent picks BOTH halves of the prompt -- which system
// prompt fragment and which fact projection -- so "board route: change
// nothing" holds exactly: an undefined/"board" intent takes the identical
// path (persona.chatSystemPrompt alone, factsForModel(facts)) this function
// always took before this wave. "general" appends persona.chatGeneralPrompt
// (a separate, owner-editable section of personas/coach.md -- see
// server/coach/index.ts's Persona type) after the shared chat system prompt,
// and swaps in generalFactsForModel's compact projection.
//
// Prompt-caching round (2026-08-02 latency plan, Task 3a build-out): split
// out of a single-string builder into { stablePrefix, dynamic } so chat()
// can hand the byte-identical-per-voice-and-intent persona+answer-shapes
// block to a backend separately from the per-call variable content (facts,
// history, the player's message). stablePrefix + "\n" + dynamic is exactly
// the string the old single-string builder returned -- same sections, same
// order, nothing dropped or reordered (proven by
// chat.stablePrefix.test.ts's reassembly assertion). Exported for that
// direct unit test; chat() below is the only production caller.
export function buildChatPromptParts(
  facts: ChatFactList,
  history: { role: "user" | "coach"; text: string }[],
  userMessage: string,
  persona: ReturnType<typeof getPersona>,
  intent: ChatIntent,
  mentioned: number[] = [],
  rejected?: RejectedDraftContext,
  // Wave 4, item 3: the player's newest standing notes (already plain text),
  // rendered as their own block. Defaults empty, so every existing call site
  // and the no-notes case render exactly today's prompt.
  standingNotes: string[] = []
): { stablePrefix: string; dynamic: string } {
  // Wave 4, item 1 (2026-08-01, game-164 follow-up): the general fragment is
  // appended only on the general route (byte-identical board prompt preserved);
  // the answer shapes are appended UNCONDITIONALLY after that, because the two
  // owner-praised shapes apply to a threat-question (board) and a strategy
  // question (general) alike. filter(Boolean) keeps a persona with no shapes
  // section byte-identical to today's prompt on both routes.
  const baseSystemPrompt =
    intent === "general"
      ? [persona.chatSystemPrompt, persona.chatGeneralPrompt].filter(Boolean).join("\n\n")
      : persona.chatSystemPrompt;
  // This is the stable prefix: it varies only by coach-voice preference and
  // intent (board vs. general each get their own persona text) -- for a
  // fixed voice+intent pair it is byte-identical on every call, which is
  // exactly what the spike (spike-3a-caching.md) measured the SDK caching.
  // Each distinct voice/intent combination simply caches separately.
  const stablePrefix = [baseSystemPrompt, persona.chatAnswerShapes].filter(Boolean).join("\n\n");
  const factsPayload = intent === "general" ? generalFactsForModel(facts) : factsForModel(facts, mentioned);
  // Wave 3, item 1: the focus section rides only on the board route (the one
  // that carries focusPosition facts -- classifyIntent forces "board" whenever
  // a focus is present, so this never fires on "general", keeping general
  // prompts byte-identical). When it fires, the history block above it is
  // marked as background.
  const focusSection = intent === "general" ? undefined : focusedMomentSection(facts);
  const notesBlock = standingNotesBlock(standingNotes);
  const dynamic = [
    "",
    "fact list (json):",
    // B4c (2026-07-27, coach-truth-speed round): dropped the 2-space indent
    // -- compact JSON carries identical information at ~10-15% fewer
    // characters, and prompt size is what (b)'s ply-scoping is also
    // fighting. No indentation/newlines to strip means no information loss,
    // just no pretty-printing a model doesn't need.
    JSON.stringify(factsPayload),
    // Wave 4, item 3: standing notes ride here -- after the fact list, before
    // history -- so Wave 3's history/rejected/focus/player ordering is untouched.
    ...(notesBlock ? [notesBlock] : []),
    formatHistory(history, focusSection !== undefined),
    // Wave 3, item 3: after history, before the focus section -- so the model
    // reads the rejected-draft warning as recent context, then the moment it
    // must actually answer about.
    ...(rejected ? [rejectedDraftBlock(rejected)] : []),
    ...(focusSection ? [focusSection] : []),
    "",
    `player: ${userMessage}`,
  ].join("\n");
  return { stablePrefix, dynamic };
}

// Task 3a (R2, voice-enforcement round): one corrective line per violation
// KIND actually present, so a regen attempt gets told exactly what to fix.
// Keyed on the prefix each checker pushes onto its violation strings (see
// checkDefenseClaims, checkPlacementClaims, checkSideAttributionClaims,
// checkMateClaims, checkVoice).
//
// Wave 0, item 2 (F5.5): this used to be voice-only -- everything else
// (placement/side/defense/mate violations) fell through to one hardcoded
// base line written for bad SAN alone ("mentioned X, which isn't a move
// from this game"). A placement violation like "placement-claim: knight on
// b3 -- b3 is empty" got glued into that sentence, telling the model a
// piece-location claim "isn't a move" -- true but meaningless, and not the
// actual defect. Every kind now gets its own terse instruction here; a bad
// SAN token carries no prefix at all (chess notation never contains ":"),
// so it's keyed under "" below and is the only kind that still gets the
// original "isn't a move from this game" wording.
const VIOLATION_KIND_GUIDANCE: Record<string, string> = {
  "": "isn't a move from this game.",
  "placement-claim": "misstates where a piece is -- restate only what the fact list proves.",
  "side-claim": "names the wrong side -- that move belongs to the other side.",
  "defense-claim": "isn't a defense the position supports -- drop the defense claim.",
  "mate-claim": "doesn't match the analysis -- drop the mate claim.",
  "voice-notation": "say the piece and where it goes in plain words, not notation.",
  "voice-word": "never say engine -- say \"our chess brain\".",
  "voice-number": "never state a number for the position.",
};

export function correctiveSuffix(violations: readonly string[]): string {
  const lines = ["", ""];
  // Bad-SAN violations are raw tokens (no ":" prefix) and keep the original
  // one-line "mentioned X, Y, ..." sentence, since that wording is specific
  // to them; every other kind gets its own guidance line below instead.
  const sanTokens = violations.filter((v) => !v.includes(":"));
  if (sanTokens.length > 0) {
    lines.push(`your previous answer mentioned ${sanTokens.join(", ")}, which isn't a move from this game.`);
  }
  const seenKinds = new Set<string>();
  for (const v of violations) {
    if (!v.includes(":")) continue; // already covered by the SAN line above
    const kind = v.split(":")[0];
    const guidance = VIOLATION_KIND_GUIDANCE[kind];
    if (guidance && !seenKinds.has(kind)) {
      seenKinds.add(kind);
      lines.push(guidance);
    }
  }
  lines.push(
    "rewrite it using only moves from this game's fact list, 2-4 short lowercase sentences, no lists, no em-dashes, no emojis."
  );
  return lines.join("\n");
}

// ---- chat loop (F16) -------------------------------------------------------

// Flow: persona "## chat" system prompt + fact JSON (no uci) + last
// CHAT_HISTORY_WINDOW messages + the player's message -> generate() ->
// validateChat -> on violation (including empty output), ONE corrective
// regeneration -> on second violation, backend error/timeout, or a
// budget-exhausted skip of the regen, a persona template. Never throws;
// always returns text. Writes exactly one advice_traces row (kind "chat")
// per call that reaches this function -- i.e. per call that passes
// GameManager.chat's CHAT_MAX_LEN gate; over-length messages are rejected
// before chat() is ever called, so they write no trace row at all (see
// manager.ts's chat() method, the sole caller). history is caller-supplied
// (the server, never the client) so this function itself has no opinion
// about where history comes from beyond using it verbatim.
// Task 2 (2026-07-22, truthfulness leaks): a rejection whose message
// indicates the backend just ran out of time is a different fact from the
// backend actually being down -- the gate measured hard timeouts rendering
// the "offline" chip while other asks in the very same session answered in
// 4-5s. All three backends' timeout paths format their own error text
// through the literal words "timed out" (claude-cli.ts's formatTimeoutError,
// agent-sdk.ts's generate()/probe rejects, ollama.ts's probe reject) --
// detect on that substring rather than adding a typed error class, so this
// stays a one-line classification with no backend-side changes.
function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes("timed out");
}

export async function chat(
  userMessage: string,
  history: { role: "user" | "coach"; text: string }[],
  facts: ChatFactList,
  backend: CoachBackend,
  trace: NarrateTraceContext,
  // B1 (2026-07-27, coach-truth-speed round): additive optional last param --
  // every existing call site and test compiles untouched, defaulting to the
  // live CHAT_TIMEOUT_MS. manager.ts computes budgetMs server-side from the
  // db's own finished state and passes it here; this function has no
  // opinion about WHY the budget is what it is, only about spending it
  // correctly. Reserve this object for a later wave's `intent?:`/`onDelta?:`
  // (streaming) -- that is why it is an object and not a bare number.
  // B-stream (2026-07-27): onDelta is the streaming hook this comment
  // reserved space for. Additive/optional -- every existing call site
  // (chat.test.ts and its siblings, manager.ts pre-this-wave) omits it and
  // gets exactly today's behavior. onRedraft is a second, equally optional
  // hook: fired exactly once, right when the one-regen attempt actually
  // begins (survives the MIN_ATTEMPT_MS budget check below) -- the signal
  // the SSE route needs to emit its own `redraft` frame, without this
  // function's attempt loop being duplicated or exposed any other way.
  // Task 2 (Wave D): intent is the last field this comment reserved space
  // for. Additive/optional, defaulting to "board" -- every existing call
  // site (chat.test.ts and its siblings, manager.ts pre-this-wave) omits it
  // and gets exactly today's behavior (full facts, full validateChat).
  // Wave 4, item 3 (2026-08-01): standingNotes is the last field this opts
  // object carries -- additive/optional, defaulting to none, so every existing
  // call site (chat.test.ts and its siblings, manager.ts pre-this-wave) omits
  // it and gets exactly today's behavior. manager.ts reads listCoachNotes and
  // passes them here; this function only forwards them to buildChatPrompt.
  // Task 1c (coach-truth-speed latency round, 2026-08-02): onAttemptStart/
  // onValidateStart are the two hooks the staged status chip needs --
  // additive/optional, every existing call site untouched. Both fire with
  // NO arguments and carry no model text: onAttemptStart right before EACH
  // backend.generateStream/generate call (attempt 0 and, if a regen starts,
  // attempt 1 again -- the SSE route tells the two apart the same way it
  // already tells attempt 1 apart for onRedraft, by call order, not by an
  // argument this function would have to pass); onValidateStart right after
  // the backend returns, before validateChat/validateChatGeneral runs.
  // OD-3b (post-shelf eval instrumentation, 2026-08-02): onUsage is the
  // last field this opts object carries -- additive/optional, every
  // existing call site (chat.test.ts and its siblings, manager.ts) omits it
  // and gets exactly today's behavior. Forwarded straight through to
  // whichever backend call this attempt makes (see the ternary below); a
  // backend that doesn't call it back (ollama.ts, claude-cli.ts, the noop
  // template backend) simply never fires it -- no special-casing needed
  // here. Fires once PER ATTEMPT, including a validation-failed attempt 0
  // that never reaches a caller-visible answer -- that attempt still spent
  // real billed tokens, and the eval harness's whole point is to make that
  // spend visible even when the row's final answer is a template.
  opts?: {
    budgetMs?: number;
    intent?: ChatIntent;
    onDelta?: (text: string) => void;
    onRedraft?: () => void;
    onAttemptStart?: () => void;
    onValidateStart?: () => void;
    onUsage?: (usage: CoachUsage) => void;
    standingNotes?: string[];
  }
): Promise<{
  text: string;
  source: "model" | "template";
  cause?: "backend-down" | "templates-only" | "timeout" | "validation-failed" | "off-topic";
  traceId: number;
}> {
  const start = Date.now();
  const budgetMs = opts?.budgetMs ?? CHAT_TIMEOUT_MS;
  // The deadline is computed ONCE, from wall-clock start, not re-derived per
  // attempt -- so the regen attempt spends whatever budget the first attempt
  // left behind, never a fresh full budget. Worst case (attempt 0 alone
  // consumes the whole budget and then throws) is exactly budgetMs, never
  // budgetMs plus a second full timeout.
  const deadline = start + budgetMs;
  const persona = getPersona();
  const intent: ChatIntent = opts?.intent ?? "board";

  // Task 2 (Wave D): "keep the bar high, a chess question is never
  // off-topic" -- isOffTopic is a much narrower net than "no positional
  // signal" (which is exactly what routes a message to "general" already):
  // it only catches a message with NO chess relevance whatsoever. Checked
  // before any prompt is built or backend called, and skips the whole
  // attempt loop -- there is nothing for a model to answer here, and no
  // budget worth spending finding that out. Still writes exactly one
  // advice_traces row, same discipline as every other exit from this
  // function.
  if (isOffTopic(userMessage)) {
    // F2 (2026-08-03): funnel through the same normalizeEmDash seam every
    // other final-reply string in this function uses, so an em-dash typed
    // into a persona template can never reach advice_traces or the caller.
    const text = normalizeEmDash(
      persona.chatTemplates.redirect ??
        "keep it on the board. ask me about a move from this game and i'll break it down."
    );
    const traceId = insertAdviceTrace({
      gameId: trace.gameId,
      ply: trace.ply,
      kind: "chat",
      factsJson: JSON.stringify(facts),
      prompt: "",
      output: text,
      source: "template",
      backend: backend.name,
      validated: false,
      regenCount: 0,
      latencyMs: Date.now() - start,
    });
    return { text, source: "template", cause: "off-topic", traceId };
  }

  const mentioned = mentionedPlies(userMessage, facts.gameSans.length);
  // Round 3 Task 13 (item 5/E, trust floor): computed ONCE from THIS turn's
  // own message -- userMessage does not change across the attempt/regen
  // loop below, so this is the single source both validateChat/
  // validateChatGeneral calls for the live attempt read.
  const userAskedForNumber = asksForNumber(userMessage);
  // Wave 3, item 3 (F5 family, game-164): look up the most recent rejected
  // chat draft for this game that no valid reply has superseded (see
  // getLatestRejectedChatTrace). This call's OWN trace is written only at the
  // end of chat(), so it can never surface here. Re-validate the stored draft
  // against its own stored facts: only a draft that STILL fails validation is
  // a genuine rejected draft worth showing -- a backend-error string or the
  // off-topic redirect copy (both validated=0 templates too) validate clean,
  // so they yield no kinds and are skipped. The re-validation also recovers
  // the violation kinds the note quotes, with no schema change.
  let rejectedContext: RejectedDraftContext | undefined;
  const rejectedRow = getLatestRejectedChatTrace(trace.gameId);
  if (rejectedRow && typeof rejectedRow.output === "string" && rejectedRow.output.trim().length > 0) {
    try {
      const rejectedFacts = JSON.parse(rejectedRow.facts_json) as ChatFactList;
      const check = validateChat(rejectedRow.output, rejectedFacts);
      if (!check.ok) {
        rejectedContext = { text: rejectedRow.output, kinds: describeViolationKinds(check.violations) };
      }
    } catch {
      // Unparseable stored facts -- skip rather than guess; the note is
      // best-effort context, never load-bearing.
    }
  }
  // Prompt-caching round: stablePrefix is the byte-identical (per voice +
  // intent) persona+answer-shapes text, handed to the backend separately
  // below; basePrompt/attemptPrompt stay the FULL concatenation (unchanged
  // from before this round) -- every existing prompt-content assertion,
  // and the advice_traces row this function writes, keep seeing exactly
  // the same complete text they always did.
  const { stablePrefix, dynamic: baseDynamic } = buildChatPromptParts(
    facts, history, userMessage, persona, intent, mentioned, rejectedContext, opts?.standingNotes ?? []
  );
  const basePrompt = [stablePrefix, baseDynamic].join("\n");

  let attemptPrompt = basePrompt;
  let attemptOutput = "";
  let regenCount = 0;
  let modelText: string | null = null;
  let failureCause: "backend-down" | "timeout" | "validation-failed" | null = null;
  // B3a: true the moment ANY attempt's output fails validateChat (including
  // an empty/whitespace-only reply) without the backend itself throwing.
  // This is what makes "validation-failed" reachable at all -- before this
  // round, two failed validations in a row (no exception, just bad prose)
  // left failureCause null and fell all the way through to the `redirect`
  // template, which is the exact bug behind her "I did ask about the board"
  // note (trace 90: a placement-claim validation failure rendered the
  // off-topic redirect copy).
  let sawValidationFailure = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      // B1: the regen is only worth starting if enough budget remains for it
      // to plausibly finish -- otherwise it would just be a second attempt
      // guaranteed to die mid-flight. Skip straight to the template instead.
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break;
      opts?.onRedraft?.();
    }
    // Wave 3, item 4 (F5 family, game-164): attempt 0's timeout is clamped to
    // half the total budget so it cannot starve the regen (trace 161); the
    // regen (attempt 1) keeps the full remaining budget. The shared `deadline`
    // is unchanged either way, so the worst case stays exactly budgetMs.
    const remainingMs = Math.max(0, deadline - Date.now());
    const timeoutMs =
      attempt === 0 ? Math.min(remainingMs, Math.floor(budgetMs / ATTEMPT0_BUDGET_DIVISOR)) : remainingMs;
    // Wave 3, item 2 (F5 family, game-164): this attempt's deltas are buffered
    // here, NOT forwarded live. She watched a wrong-topic draft stream in real
    // time before validation zapped it -- so opts.onDelta is never handed
    // straight to the backend anymore. The buffer flushes through opts.onDelta
    // only after this attempt PASSES validation (see the result.ok branch
    // below); a rejected attempt's tokens are simply dropped. Accepted
    // trade-off (owner-approved): no live typing during generation, the
    // visible stream starts only after validation.
    const attemptDeltas: string[] = [];
    // OD-3b (coach thinking-config round, 2026-08-03): attempt 0 answers
    // fast/concise at the pref thinkingForIntent(intent) names (every
    // route defaults to 'low' today -- see that function's own seam
    // comment); a regen (attempt 1) UNCONDITIONALLY escalates to 'default'
    // (full unbounded adaptive thinking) regardless of intent -- it is the
    // rescue for an attempt that already failed validation once (or, for
    // the timeout-retry branch below, failed to finish at all), so it gets
    // the model's best effort rather than the fast path's cap. Decided
    // from `attempt` alone, not re-derived from intent, since both the
    // validation-failure and timeout-retry routes land on attempt 1.
    // Whole-branch review (2026-08-03), Important-1 flagged this as a
    // scope leak (review/postgame chat also dropping to 'low'), proposing
    // a mode gate. REVERSED same day on segmented OD-3b eval evidence
    // (board-review arm, n=48/pref): low wins on the FINISHED-game/review
    // arm too -- fewer templates (21% vs 29% default/35% disabled), fastest
    // (7.0s p50), and MORE complete answers (75 words vs default's 63); a
    // sampled review tactical question got a full correct answer from low
    // while default timed out into a template and disabled couldn't work
    // it out. CHAT_REVIEW_BUDGET_MS's 180s is a timeout ceiling, not a
    // think-harder directive -- there is no mode gate here; review chat
    // uses the exact same thinkingForIntent(intent) attempt-0 pref as live.
    const thinkingPref = attempt === 0 ? thinkingForIntent(intent) : "default";
    // Task 1c: fires right before the backend is actually called -- a REAL
    // pipeline event, not a guess. Attempt 0 fires this once; a regen
    // (attempt 1) fires it again, same as onRedraft just above.
    opts?.onAttemptStart?.();
    try {
      // B-stream: one ternary, no duplicated attempt loop. Streaming is used
      // only when the backend actually implements it AND the caller asked
      // for deltas -- every other caller (every pre-this-wave test, narrate's
      // own callers, a non-streaming backend) takes the untouched generate()
      // path.
      // F2 (2026-08-03): normalizeEmDash right where the backend's raw text
      // first becomes attemptOutput -- the single seam every downstream use
      // (validateChat, trimmed/modelText, and the advice_traces `output`
      // field this function persists at the end) reads from, so a model
      // reply can never carry an em-dash into the db or the caller. This is
      // also the value that ends up persisted on a REJECTED draft (a
      // template-fallback row's `output` is this raw last attempt, not the
      // apology copy the user sees) -- normalizing here is what covers that
      // path too, per the brief's "do not patch only the model branch".
      attemptOutput = normalizeEmDash(
        backend.generateStream && opts?.onDelta
          ? await backend.generateStream(
              attemptPrompt,
              timeoutMs,
              (t) => attemptDeltas.push(t),
              stablePrefix,
              opts?.onUsage,
              thinkingPref
            )
          : await backend.generate(attemptPrompt, timeoutMs, stablePrefix, opts?.onUsage, thinkingPref)
      );
    } catch (err) {
      attemptOutput = normalizeEmDash(`[backend error] ${err instanceof Error ? err.message : String(err)}`);
      failureCause = isTimeoutError(err) ? "timeout" : "backend-down";
      // Wave 3, item 4 regression (live-eval): an attempt-0 TIMEOUT must not
      // throw away the reserved half of the budget. The cap means "attempt 0
      // may not consume more than half", NOT "a slow answer dies at half" --
      // so a first-attempt timeout retries ONCE with the SAME base prompt
      // (nothing was invalid, so no corrective suffix) and the FULL remaining
      // budget. failureCause stays "timeout" as the marker for the cases where
      // the retry can't help (skipped under MIN_ATTEMPT_MS, or times out
      // again); it is cleared to null the moment the retry validates (see the
      // result.ok branch). A NON-timeout backend error, or a timeout on the
      // retry itself (attempt 1), still short-circuits straight to the
      // template -- never worth a third call.
      if (attempt === 0 && isTimeoutError(err)) {
        regenCount = 1; // the retry is a genuine second generation
        continue; // attempt 1's guard fires onRedraft + enforces the floor
      }
      break;
    }

    // Task 1c: fires the moment the backend has returned, right before
    // validateChat/validateChatGeneral runs -- a real event, not a delay.
    opts?.onValidateStart?.();
    const trimmed = attemptOutput.trim();
    // Task 2 (Wave D): the general route validates with validateChatGeneral
    // (no SAN-allowlist check) instead of validateChat -- everything else
    // about this loop (regen, corrective suffix, template fallback) is
    // shared between both routes untouched.
    const result =
      trimmed.length > 0
        ? intent === "general"
          ? validateChatGeneral(attemptOutput, facts, { userAskedForNumber })
          : validateChat(attemptOutput, facts, { userAskedForNumber })
        : ({ ok: false, violations: [] } as const);
    if (result.ok) {
      modelText = trimmed;
      // Wave 3, item 4 regression: a prior attempt-0 timeout set failureCause
      // as a marker -- clear it now that a later attempt produced a clean
      // model answer, so the recovered reply never reports a timeout cause.
      failureCause = null;
      // Wave 3, item 2: only now that the attempt validated do its buffered
      // deltas reach the client -- replayed in the same chunks the backend
      // produced (the client renders either a single flush or a chunked
      // replay). A rejected attempt never reaches this branch, so its buffer
      // is discarded unread.
      if (opts?.onDelta) for (const d of attemptDeltas) opts.onDelta(d);
      break;
    }
    sawValidationFailure = true;
    if (attempt === 0) {
      regenCount = 1;
      const violations = "violations" in result && result.violations.length > 0 ? result.violations : ["the previous answer"];
      attemptPrompt = basePrompt + correctiveSuffix(violations);
    }
  }

  // B3a: a validation failure (rather than a thrown backend error) that
  // never recovered into a clean model reply gets its own honest cause --
  // never silently falls through to `failureCause === null`, which is what
  // used to make the `redirect` template fire for a validation failure.
  if (!failureCause && modelText === null && sawValidationFailure) {
    failureCause = "validation-failed";
  }

  const source: "model" | "template" = modelText !== null ? "model" : "template";
  // Owner playtest 2026-07-22 / B3a (2026-07-27): each failure mode is a
  // different apology, and none of them may borrow another's copy. A slow
  // answer is ours to own (`slow`), a down backend is a capability statement
  // (`down`), a validation failure is an honest "that one came out garbled"
  // (`garbled`) -- and `redirect` is reserved for a genuine off-topic ask,
  // which nothing in this function emits: failureCause can only ever be
  // "backend-down" | "timeout" | "validation-failed" | null here, so the
  // `redirect` branch below is UNREACHABLE this wave. It stays wired for the
  // future intent router (the one thing that will ever set an "off-topic"
  // cause) rather than deleted. Persona-overridable (`slow:` / `down:` /
  // `garbled:` under the chat templates in coach.md) with an honest default
  // here so the fallback never lies about why it fired.
  // F2 (2026-08-03): normalizeEmDash covers this persona-template fallback
  // string too -- same seam as the model-reply branch above, so an
  // owner-edited coach.md template can never reintroduce an em-dash into a
  // returned reply (this string is never itself persisted to advice_traces;
  // attemptOutput above is what's persisted on a template-fallback row, and
  // that is already normalized at its own assignment).
  const failureTemplate = normalizeEmDash(
    failureCause === "timeout"
      ? persona.chatTemplates.slow ??
        "that one took me longer than i had. ask me again and i'll get you an answer."
      : failureCause === "backend-down"
        ? persona.chatTemplates.down ??
          "i can't reach my thinking right now. try me again in a moment."
        : failureCause === "validation-failed"
          ? persona.chatTemplates.garbled ??
            "i couldn't get that one clean. ask me again and i'll come at it from a different angle."
          : persona.chatTemplates.redirect ??
            "keep it on the board. ask me about a move from this game and i'll break it down."
  );
  // Opponent-move-analysis plan (2026-08-03), Wave C: applied HERE, after the
  // model/regen loop above -- never inside it. checkOpponentQualityClaims's
  // own header explains why: the violation is answerable from a fact already
  // in hand (facts.context.turningPointFocus's matchedBest/quality), so
  // fixing it costs a deterministic string append (0ms), not a second,
  // ~20s model call. Only ever applied to a genuine model reply (source
  // "model") -- a template/apology never makes a claim about the move to
  // begin with, so there is nothing for it to correct.
  let text = modelText ?? failureTemplate;
  if (modelText !== null) {
    const correction = checkOpponentQualityClaims(text, facts);
    if (correction) text = text + correction;
  }
  const latencyMs = Date.now() - start;

  // kind is always literally "chat" for this surface -- not caller
  // configurable via trace.kind, even though NarrateTraceContext's shape
  // carries that field for narrate()'s sake (nudge/warning).
  const traceId = insertAdviceTrace({
    gameId: trace.gameId,
    ply: trace.ply,
    kind: "chat",
    // Full facts, uci fields included -- intentional, not a leak: this is
    // F40 Lab trace data for the owner, not the model prompt. Only
    // factsForModel's stripped copy (built above, no uci) ever reaches the
    // backend; this is the one JSON.stringify(facts) in the whole function.
    factsJson: JSON.stringify(facts),
    prompt: attemptPrompt,
    output: attemptOutput,
    source,
    backend: backend.name,
    validated: source === "model",
    regenCount,
    latencyMs,
  });

  return failureCause ? { text, source, cause: failureCause, traceId } : { text, source, traceId };
}
