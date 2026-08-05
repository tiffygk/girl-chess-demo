import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import {
  newSession,
  newGame,
  sendMove,
  modeTimer,
  adjudicate,
  judgeMove,
  logHint,
  fetchHintFacts,
  narrate,
  fetchSummary,
  fetchGames,
  deleteGame,
  getTurningLines,
  getHighlightLines,
  exploreReply,
  highlightMove,
  type MoveResponse,
  type GameOverInfo,
  type Verdict,
  type HintFactsResponse,
  type SummaryResponse,
  type GameListEntry,
  type ChatContext,
  type TurningLine,
  type TurningPoint,
  type MoveClassification,
  type HighlightLine,
} from "./api";
import { CoachChat, ThumbRating } from "./CoachChat";
import {
  hintFocusContext,
  turningPointFocusContext,
  reconcileChatFocus,
  pvUciToSan,
  pendingMoveContext,
  resolvePlyFocus,
} from "./chatFocus";
import { arrowsToHighlights, type ArrowColor, type ReviewArrow } from "./reviewArrows";
import { buildArrowsForPly as buildArrowsForPlyPure } from "./arrowSelection";
import { describeMove, type MoveRender } from "./describeMove";
import { pushLiveMove, setHighlight, pairWindow, liveMovesFromSummary, type LiveMove } from "./liveMoves";
import { HighlightPocket } from "./HighlightPocket";
import { victimKind, materialDiff, rollbackCapture, capturesAtPly, type CapturedBySide } from "./captures";
import { kingInCheckSquare } from "./checkState";
import { reconcile } from "./reconcile";
import { findTakedownPiece, type Takedown } from "./terminal";
import { replayPlan } from "./replay";
import { GameEndPanel } from "./GameEndPanel";
import { DebriefPage, PastGamesButton, PastGamesDrawer } from "../review/DebriefPage";
// Wave 3.5 fix (Important, review 2026-08-01): the pure "does deleting this
// game also mean clearing the live just-finished debrief" predicate -- see
// deleteArm.ts's own comment.
import { shouldClearLiveDebrief } from "../review/deleteArm";
import { fenAtPly } from "../review/Rewind";
import { resolveMoveFlow, isOverrideConfirm } from "./moveFlow";
import { readGameParam, withGameParam, isResumableSummary } from "./resumeParam";
import {
  decideBranch,
  maxPress,
  rungCopy,
  hintRevealSquares,
  threatRevealSquares,
  hintIsLegal,
  type HintBranch,
  type HintCopyCtx,
} from "./hintFlow";
import { PlayerBar } from "./PlayerBar";
import {
  startExplore,
  applyPlayerMove,
  applyEngineReply,
  exploreSeedPly,
  guidingArrow,
  type ExploreState,
} from "./explore";
import {
  COACH_BACKEND_KEY,
  COACH_BACKEND_OPTIONS,
  readCoachBackendPref,
  type CoachBackendPref,
} from "./coachBackendPref";

type Captured = CapturedBySide;

// The five bands with real maia weights in weights/ (server snaps anyway).
const OPPONENT_ELOS = [1100, 1200, 1300, 1400, 1500];
const OPPONENT_ELO_KEY = "gc-opponent-elo";

function readEloPref(): number {
  const raw = Number(localStorage.getItem(OPPONENT_ELO_KEY));
  return OPPONENT_ELOS.includes(raw) ? raw : 1100;
}

// Task 4 (warm-coach-backend round): wire tokens, options, and the
// localStorage default now live in coachBackendPref.ts (a testable seam
// separate from this file's heavy component import graph) — "claude" |
// "ollama" | "template" | "agent-sdk", default "agent-sdk".

// Task 6 (F10 tuning): the judge-strictness dial — which ADVICE_LEVELS
// threshold table classify.ts judges against. UI label is "judge
// strictness", deliberately NOT "advice level" (panel B5 ruling: the PRD
// reserves that name for the future F13 comprehension-ELO dial). Wire
// tokens match the server's ADVICE_LEVELS keys verbatim, default
// "standard" — independent of coachOn/coachHints/coachBackend, this tunes
// verdict-tier sensitivity itself, not whether/how the coach speaks.
const JUDGE_STRICTNESS_KEY = "gc-judge-strictness";
type JudgeStrictnessPref = "gentle" | "standard" | "blunt";
const JUDGE_STRICTNESS_OPTIONS: { value: JudgeStrictnessPref; label: string }[] = [
  { value: "gentle", label: "gentle" },
  { value: "standard", label: "standard" },
  { value: "blunt", label: "blunt" },
];

function readJudgeStrictnessPref(): JudgeStrictnessPref {
  const raw = localStorage.getItem(JUDGE_STRICTNESS_KEY);
  return raw === "gentle" || raw === "standard" || raw === "blunt" ? raw : "standard";
}

// Owner-calibratable: her displayed rating. A later increment computes this
// from game history in data/girlchess.db; until then it is a fixed label
// (owner, 2026-07-17: "for now let's just put that my elo is 1350").
const PLAYER_ELO = 1350;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Minimum time the check ring must stay on screen before the reply
// animation starts covering it, so a fast server response can't skip the
// player past ever seeing the check they just delivered.
const CHECK_VISIBILITY_MS = 450;

// Guardian Angel pending-move (C1): fixed minimum duration the "judging…"
// indicator holds before flipping to "judged", regardless of how fast (or
// slow) the server actually answers. NO TIMING TELLS (owner requirement,
// verbatim): the cadence must be identical for every verdict tier, so the
// reveal waits for both the response AND this minimum to have elapsed.
// Labeled starting value, same as CHECK_VISIBILITY_MS above.
const JUDGE_MIN_MS = 900;

// How long the "end the game?" button stays morphed into its outcome copy
// before it reverts on its own — an in-world confirm step instead of a
// modal. Wave C: was resign/draw-specific; now the single adjudicated
// end-game button's arm-then-confirm window.
const CONFIRM_MS = 3000;

// A5: how long the "can't castle right now" (etc.) input hint stays in the
// status line before reverting to whatever `status` currently holds.
const INPUT_HINT_MS = 3000;

// C3 (Silent Partner toggle + confirm decoupling): localStorage keys, exact
// names per the brief — the Lab / a future settings sync can rely on these.
const COACH_MODE_KEY = "gc-coach-mode";
const CONFIRM_STEP_KEY = "gc-confirm-step";
// V1 (visual-components round): new independent "coach gives hints" toggle.
// Ships the toggle + its persisted state only this wave — no hint-fetch or
// suppression wiring here (that belongs to the concurrent logic round).
// Defaults to true, same as the siblings (see readBoolPref below).
const COACH_HINTS_KEY = "gc-coach-hints";

// Both default ON: with nothing in localStorage yet, resolveMoveFlow(true,
// true) is "judge-confirm" — the C1/C2 flow, unchanged default behavior.
// "confirm's default follows coach mode" (brief) is satisfied by sharing
// this same default; once a value is ever persisted the two keys are
// fully independent from then on.
function readBoolPref(key: string): boolean {
  const raw = window.localStorage.getItem(key);
  return raw === null ? true : raw === "true";
}

// Server-authoritative desync recovery: when the server hands back a fen
// (on ok:false, or when a post-success reconcile() finds a mismatch),
// adopt it directly instead of guessing at a local undo. Only when the
// server gave us nothing usable (network failure, or the rare ok:false
// with no fen — e.g. move on an already-gone game) do we fall back to
// unwinding the client's own last move.
function adoptServerFen(mirror: Chess, serverFen: string | undefined | null): string {
  if (serverFen) {
    try {
      mirror.load(serverFen);
      return mirror.fen();
    } catch {
      // server sent something unparseable; fall through to the undo fallback
    }
  }
  mirror.undo();
  return mirror.fen();
}

// Increment 3.91 (Task 4)/Coach truth-speed round (Wave C1, 2026-07-27): a
// turning-point card's "replay" click threads a TurningLine (already
// replay-derived server-side, see api.ts's TurningLine comment) into the
// board's arrows/highlightSquares props. The derivation itself (plus the
// "found" dedup + her-actual-reply behavior this round adds) now lives in
// reviewArrows.ts — one home for endpoint math, per A1's report — and
// playedArrowForPly (the played-arrow fallback for a ply with no matching
// TurningLine) lives in review/followedBest.ts, lifted verbatim from this
// file by that same wave. Both are imported back below rather than
// re-declared here.

// Increment 3.91 (Task 6): explore's engine-reply elo — the live debrief's
// opponentElo state is correct for the game that just finished, but a
// REVIEWED past game may have been played at a different elo, so this
// parses it back out of the persisted "maia-1400"/"fallback-1400" opponent
// string. Same hand-mirroring convention as DebriefPage's own eloFromOpponent
// (kept local here rather than exported across the file's ownership line).
function exploreElo(reviewOpponent: string | null, liveElo: number): number {
  if (!reviewOpponent) return liveElo;
  const m = reviewOpponent.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : liveElo;
}

export function GamePage() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [fen, setFen] = useState(() => new Chess().fen());
  const [fallback, setFallback] = useState(false);
  // Round 3 (session-gone recovery, owner ruling 2026-08-02): "can we
  // include in the round something that fixes that thing with the session
  // ID? it's very confusing." Set once, by modeTimer's onGone hook, when
  // the server reports this session's row no longer exists (a restart or
  // db swap while this tab sat open). No toast spam, no retry loop -- one
  // calm state, one action that recovers it.
  const [sessionGone, setSessionGone] = useState(false);
  const [status, setStatus] = useState("finding an opponent...");
  const [gameOver, setGameOver] = useState<GameOverInfo | null>(null);
  const [takedownMove, setTakedownMove] = useState<Takedown | null>(null);
  const [resyncTick, setResyncTick] = useState(0);
  const [captured, setCaptured] = useState<Captured>({ w: [], b: [] });
  // Wave C, task C-A: the single "end the game?" button's armed state — set
  // once the preview call resolves, to the outcome it previewed ("win" |
  // "draw" | "resign"). Null = not armed (button reads "end the game?").
  // Reverts to null on its own after CONFIRM_MS, same in-world
  // arm-then-confirm pattern the old separate resign/draw buttons used.
  const [endGameOutcome, setEndGameOutcome] = useState<"win" | "draw" | "resign" | null>(null);
  // Guardian Angel pending-move (C1, extended in A1): the move the player
  // clicked but hasn't confirmed yet. The mirror/fen are NOT touched while
  // this is set — Board renders it as a pure overlay (dimmed origin(s) +
  // ghost(s), victim dimmed). Carries the full MoveRender shape (not just
  // from/to/promotion) so Board can preview the complete final position —
  // castling rook included — while the judge holds the move.
  const [pending, setPending] = useState<Pick<
    MoveRender,
    "from" | "to" | "promotion" | "secondary" | "capturedSquare"
  > | null>(null);
  // A4: the most recently settled move (player's or Mallow's) — mint
  // last-move highlight, lichess convention. Set once the move's animation
  // finishes (not before — a rejected/reverted move must never light up),
  // cleared on new game. For castling this is always the king's from/to,
  // since describeMove's render.from/to are the king's squares already.
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  // Highlight-a-move (Task 2): a reactive live SAN list, since
  // activeReviewMoves is null mid-game (liveSummary is fetched only once
  // the game is over, and mirrorRef is a ref -- it never triggers a
  // render). Appended alongside lastMove at each settle site below, cleared
  // on new game the same place lastMove is. Read by the highlight pocket
  // (Task 3, W5 pairs) via pairWindow, mounted in her PlayerBar below.
  const [liveMoves, setLiveMoves] = useState<LiveMove[]>([]);
  // A5: transient status-line hint for a click that was meaningful but
  // couldn't do what it looked like (currently: "can't castle right now").
  const [inputHint, setInputHint] = useState<string | null>(null);
  const [judgePhase, setJudgePhase] = useState<"judging" | "judged" | null>(null);
  // C2: the verdict itself, once judged — drives the badge rendered into
  // C1's "judged ✓" slot. null while judging, and for tier "silent" (no
  // badge, just the plain "judged ✓" C1 already had).
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // Wave 2 (the hint decision tree): the CURRENT pending move's press ladder.
  // hintPress is 0 (nothing revealed, only "help?") .. maxPress(branch); the
  // help click IS press 1. hintBranch is decided once, at the 0->1 step, from
  // the deep facts (decideBranch(pending.from, bestFacts.bestFromSquare)) and
  // is null until then. Both reset on retarget/cancel/confirm/new pending --
  // see handlePendingStart/handleConfirmPending/handleRetractPending below.
  const [hintPress, setHintPress] = useState(0);
  const [hintBranch, setHintBranch] = useState<HintBranch | null>(null);
  // Round 2, item 6 (owner ruling, 2026-08-01 playtest): "the board-
  // coordinate glitch effect ... want the old feel back." Bumped on EVERY
  // hint-ladder press (handleHintClick), not just the reveal rung -- Board
  // turns each change into a brief non-directional glitch burst on the
  // coordinate spans (coordGlitchBurst.ts). Deliberately never reset
  // alongside hintPress/hintBranch: a fresh pending move's first press
  // must still count as a change from whatever tick the last pending move
  // left behind, which a plain increment already guarantees without needing
  // its own reset wiring.
  const [hintGlitchTick, setHintGlitchTick] = useState(0);
  // Increment 3.95, Task 7 ("ask about this"): the focus half of a chat
  // message's context — at most one of hintFocus/turningPointFocus is set
  // at a time (whichever entry point the player last clicked), merged into
  // buildChatContext's return further down. Deliberately NOT reset on every
  // focus change or rewind — per the brief, keeping the same conversation
  // thread while the focus switches within a game is acceptable, simpler
  // than wiping it; it IS reset alongside the rest of the per-game state in
  // resetGameState/selectPastGame/backToPlay below (a genuine game switch).
  const [chatFocus, setChatFocus] = useState<Pick<ChatContext, "hintFocus" | "turningPointFocus">>({});
  // Bumped by either "ask about this" entry point to force the single
  // always-mounted CoachChat open from outside (see CoachChat.tsx's
  // openSignal prop) — the drawer's own "chat with the coach" button is the
  // only other way it opens.
  const [chatOpenSignal, setChatOpenSignal] = useState(0);
  // Wave B (increment 2.5): the deep verified facts fetched on the FIRST
  // "help?" click for the current pending move — the api response type, not
  // hintFlow's HintFacts: the state must carry bestUci (for reveal squares
  // and logging), which the copy-only client interface deliberately omits.
  // Structural typing lets this feed rungCopy directly. Reset alongside
  // hintPress/hintBranch at every pending-lifecycle boundary (new game,
  // pending start/retarget, confirm, retract) — a stale fetch from the last
  // destination would point at the wrong "instead" square.
  const [hintFacts, setHintFacts] = useState<NonNullable<HintFactsResponse["facts"]> | null>(null);
  const [hintFetching, setHintFetching] = useState(false);
  // Increment 3a Wave 3: coach's corner narration for the current pending
  // move. null text = nothing to show yet (idle placeholder, or nothing
  // fired this pending). Reset alongside hintPress/hintFacts at every
  // pending-lifecycle boundary (new game, pending start/retarget, confirm,
  // retract) — same four sites, same reason (a stale narration from the
  // last destination would talk about the wrong move).
  const [coachText, setCoachText] = useState<string | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  // Task 4 (F19): the trace id narrate() wrote for the currently-shown
  // coachText, so a thumb click can rate the exact output on screen. Reset
  // alongside coachText at every one of its reset sites, set alongside it
  // in the narrate() success handler below.
  const [coachTraceId, setCoachTraceId] = useState<number | null>(null);
  // C3: the two independent switches. coachOn = "coach judges my moves"
  // (the pill); confirmOn = "confirm before playing". Crossed via
  // resolveMoveFlow to pick one of the 4 move flows on every destination
  // click. Both persist to localStorage so they survive across games
  // within the session (brief: state per-session).
  const [coachOn, setCoachOn] = useState<boolean>(() => readBoolPref(COACH_MODE_KEY));
  const [confirmOn, setConfirmOn] = useState<boolean>(() => readBoolPref(CONFIRM_STEP_KEY));
  // Increment 2.5: opponent strength, chosen pre-game and persisted; the
  // server snaps whatever we send to the nearest real maia band (Task 7) and
  // echoes it back, so this state always converges on a real band even if
  // localStorage somehow held something stale.
  const [opponentElo, setOpponentElo] = useState<number>(readEloPref);
  // V1: independent of coachOn (judging) — not read by any hint logic yet.
  const [coachHints, setCoachHints] = useState<boolean>(() => readBoolPref(COACH_HINTS_KEY));
  // Task 5 (F17): which backend narrate()/chatWithCoach() ask for, per
  // request — independent of coachOn/coachHints (a picked voice has nothing
  // to do with whether judging or hints are on).
  const [coachBackend, setCoachBackend] = useState<CoachBackendPref>(() => readCoachBackendPref());
  // Task 6 (F10 tuning): independent of coachBackend/coachOn/coachHints —
  // this is the judge path's own threshold-table pick, not a coach setting.
  const [judgeStrictness, setJudgeStrictness] = useState<JudgeStrictnessPref>(() => readJudgeStrictnessPref());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // judge-post (coach-only) mode: the move already played, so there's no
  // pending overlay to hang a badge off of — this is that badge's own
  // state, rendered next to the status line instead of in the (absent)
  // judge-indicator. Cleared whenever a new board interaction starts.
  const [postVerdict, setPostVerdict] = useState<Verdict | null>(null);
  // Mirrors busyRef (a ref, non-reactive) so the toggle/switches can show a
  // real disabled state while a move is in flight — brief: "toggle
  // disabled while pending/animating ... no queuing".
  const [uiBusy, setUiBusy] = useState(false);
  // Wave B: true specifically from the moment the player's move is sent to
  // the server (the actual network round-trip) until a reply arrives or the
  // request fails — narrower than uiBusy, which also covers the player's
  // own move animation. Drives the top (mallow) player bar's "thinking..."
  // chip; when uiBusy is true but this is still false, the bar shows the
  // quieter "mallow's move" text instead (her turn is coming up but the
  // request hasn't gone out yet). Turn/state text no longer routes through
  // `status` at all — see the bars in the render below.
  const [mallowThinking, setMallowThinking] = useState(false);
  // Increment 3c: the debrief under the game. liveSummary is fetched once
  // per finished game (see the effect below). reviewGame holds a PAST
  // game's own summary when the player is browsing the saved-games menu —
  // REVIEW MODE — distinct from the just-finished live game's own debrief;
  // the two are never rendered at the same time (see the render below).
  // rewindPly is shared by both debriefs: null means "show the final
  // position," a ply count means "show the position after that many plies,"
  // driven by a turning-point card's "replay" button.
  const [liveSummary, setLiveSummary] = useState<SummaryResponse | null>(null);
  const [reviewGame, setReviewGame] = useState<{
    id: number;
    opponent: string;
    result: string;
    summary: SummaryResponse;
  } | null>(null);
  const [rewindPly, setRewindPly] = useState<number | null>(null);
  const [pastGamesOpen, setPastGamesOpen] = useState(false);
  const [pastGames, setPastGames] = useState<GameListEntry[] | null>(null);
  // Wave 3.5, item 2 (owner ask, 2026-08-01): the drawer's own inline error
  // affordance for a failed delete -- there's no toast machinery in this
  // app, so this renders past-games-empty-styled text in the drawer instead.
  // Cleared on every new delete attempt and on a fresh drawer open.
  const [pastGamesDeleteError, setPastGamesDeleteError] = useState<string | null>(null);
  // Increment 3.91 (Task 4): the current debrief's persisted turning-point
  // PV/best-move lines, fetched once per debrief (see the effect below) and
  // looked up by ply in handleRewind. reviewArrows/reviewHighlights are the
  // board overlay derived from whichever turning-point card's "replay" was
  // last clicked; both clear on backToEnd/backToPlay/new game so they never
  // bleed into live play.
  const [turningLines, setTurningLines] = useState<TurningLine[]>([]);
  // Opponent-move-analysis plan (2026-08-03), Wave C: the debrief's per-
  // highlighted-ply engine facts for EITHER side (Wave A's endpoint),
  // fetched alongside turningLines below and looked up by ply in
  // handleAskAboutPly (via resolvePlyFocus) -- turningLines only ever
  // carries HER turning points, so a mallow-ply "ask about this" has nothing
  // to ground itself in without this.
  const [highlightLines, setHighlightLines] = useState<HighlightLine[]>([]);
  const [reviewArrows, setReviewArrows] = useState<ReviewArrow[]>([]);
  const [reviewHighlights, setReviewHighlights] = useState<{ square: string; kind: ArrowColor }[]>([]);
  // Increment 3.91 (Task 6): "try the line" — a debrief turning-point card's
  // sandbox against mallow. null = not exploring (the debrief is static, the
  // board shows whatever rewindPly/back-to-end left it at). Non-null drives
  // the SAME <Board> live: its own onMove seam (handleExploreMove below)
  // replaces handleBoardMove, and arrows/highlightSquares are forced off
  // (declared cut #2) while it's active. Nothing here ever calls sendMove,
  // judgeMove, or any persisting endpoint — exploreReply is the only network
  // call and it writes nothing server-side (see server/game/manager.ts's
  // exploreReply + its zero-row-count test).
  const [explore, setExplore] = useState<ExploreState | null>(null);
  // True only while a exploreReply request is in flight, so a second click
  // can't fire a second one on top of it (mirrors busyRef's role for the
  // real game, scoped to the sandbox instead).
  const [exploreThinking, setExploreThinking] = useState(false);
  // Task 3 (increment 3.95): the single green "best" guiding arrow shown
  // while a sandbox is open (guidingArrow, src/game/explore.ts) — set once
  // at openExplore, cleared after her first move in the sandbox lands (see
  // handleExploreMove below) since it's a "do this" prompt, not persistent
  // annotation.
  const [exploreArrow, setExploreArrow] = useState<{
    from: string;
    to: string;
    color: "best";
  } | null>(null);
  // Increment 3.95 (Task 4, Part 1): the turning point's own ply the
  // currently-open sandbox was seeded from (openExplore's own argument,
  // NOT exploreSeedPly's rounded-down seed — same convention guidingArrow
  // above already uses to look turningLines up by). Threaded to
  // DebriefPage's `exploring` prop so the try-the-line banner can look up
  // the matching TurningLine and render its opportunity clause; null
  // whenever no sandbox is open.
  const [exploreSourcePly, setExploreSourcePly] = useState<number | null>(null);

  const boardRef = useRef<BoardHandle>(null);
  const mirrorRef = useRef(new Chess());
  const lastReplyAtRef = useRef(Date.now());
  const busyRef = useRef(false);
  // Increment 3c: the live `fen` at the moment REVIEW MODE was entered, so
  // "back to play" can restore it exactly rather than re-deriving it (the
  // live game may be mid-play, pregame, or just-finished — this is the one
  // source of truth for "what the board looked like before browsing").
  const preReviewFenRef = useRef<string | null>(null);
  // Bumped on every handleMoveWithPostJudge call (and reset on new game) so
  // a /judge response for a superseded post-judge move never overwrites a
  // newer move's badge.
  const postVerdictTokenRef = useRef(0);
  // Bumped on every confirm/retract (and new game) so a judge response that
  // resolves after the pending move it belongs to was superseded is a
  // no-op — never flips judgePhase to "judged" for a move that's already
  // gone.
  const pendingTokenRef = useRef(0);
  // Increment 3a Wave 3: guards the narrate call to firing exactly once per
  // pending move — holds the pendingTokenRef value narrate has already
  // fired (or is in flight) for, so re-renders while L3+ holds don't refire.
  const narratedTokenRef = useRef<number | null>(null);
  // Wave 2 (item 1): mirrors narratedTokenRef -- holds the pendingTokenRef
  // value the verdict-time deep-facts PREFETCH has already fired for, so it
  // runs exactly once per pending move (a re-render while the verdict holds
  // never refires it). Cleared alongside narratedTokenRef at the four reset
  // sites below.
  const prefetchedTokenRef = useRef<number | null>(null);
  // Wave C, task C-A: the "end the game?" arm-then-confirm revert timer,
  // and a re-entrancy guard for the preview call itself (distinct from
  // busyRef, which gates the main move flow — arming end-game shouldn't be
  // blocked by, or block, an in-flight move).
  const endGameTimerRef = useRef<number | null>(null);
  const endGameBusyRef = useRef(false);
  const inputHintTimerRef = useRef<number | null>(null);
  const replayingRef = useRef(false);
  // Fix (task-reviewer, post task-3 approval): reactive twin of replayingRef,
  // for the one thing a ref can't do — drive conditional UI (here, hiding
  // coach chat during the takedown cinematic so its full-screen overlay
  // can't cover the board mid-replay). replayingRef stays as the
  // synchronous re-entrancy guard (a state update isn't safe to rely on for
  // that — see handleReplayTakedown); this is purely additive.
  const [cinematicActive, setCinematicActive] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  // Increment 3.91 (Task 6): the debrief `fen` at the moment "try the line"
  // was clicked — exit restores exactly this, same pattern as
  // preReviewFenRef restoring the pre-review live fen. exploreBusyRef gates
  // a second player move from firing a second exploreReply while one is
  // already in flight; exploreTokenRef supersedes an in-flight exploreReply
  // when the player exits (or starts a fresh session) before it resolves —
  // its response must never land on a session it no longer belongs to.
  const preExploreFenRef = useRef<string | null>(null);
  const exploreBusyRef = useRef(false);
  const exploreTokenRef = useRef(0);

  // Fires the right terminal-sequence celebration for a game-over result:
  // confetti for a player win, an electric storm for a loss, a soft shimmer
  // for a draw. Fire-and-forget, non-blocking — matches the existing
  // board?.confetti() call style. Wave D: `big` fires the denser/longer
  // replay-finish variant instead of the first-time one — same three
  // celebrations, just parameterized (see Board's confetti/storm/shimmer).
  const celebrate = useCallback((result: string, opts?: { big?: boolean }) => {
    const board = boardRef.current;
    if (!board) return;
    if (result === "1-0") board.confetti(opts);
    else if (result === "0-1") board.storm(opts);
    else board.shimmer({ ...opts, big: true }); // draw ceremony: 2.8s big variant -- the 1.8s glow was invisible to the owner (visual-rca 1)
  }, []);

  const check = useMemo(() => {
    const c = new Chess(fen);
    return { square: kingInCheckSquare(c), mate: c.isCheckmate() };
  }, [fen]);

  // Shared by startGame (before fetching a fresh game) and handleNewGame
  // (before dropping back to the pregame elo picker) — every piece of
  // in-flight move/judge/hint/end-game state that must not survive into
  // the next game. Deliberately leaves sessionId/opponentElo/gameId alone;
  // callers decide those.
  const resetGameState = useCallback(() => {
    setGameOver(null);
    setTakedownMove(null);
    setStatus("finding an opponent...");
    setCaptured({ w: [], b: [] });
    if (endGameTimerRef.current) {
      window.clearTimeout(endGameTimerRef.current);
      endGameTimerRef.current = null;
    }
    setEndGameOutcome(null);
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
    setHintPress(0);
    setHintBranch(null);
    setHintFacts(null);
    setHintFetching(false);
    setCoachText(null);
    setCoachTraceId(null);
    setCoachLoading(false);
    narratedTokenRef.current = null;
    prefetchedTokenRef.current = null;
    postVerdictTokenRef.current += 1;
    setPostVerdict(null);
    setLastMove(null);
    setLiveMoves([]);
    setMallowThinking(false);
    if (inputHintTimerRef.current) {
      window.clearTimeout(inputHintTimerRef.current);
      inputHintTimerRef.current = null;
    }
    setInputHint(null);
    // Increment 3c: a fresh/new game must never carry over the last game's
    // debrief, an active review of a past game, or a mid-rewind position.
    setLiveSummary(null);
    setReviewGame(null);
    setRewindPly(null);
    preReviewFenRef.current = null;
    // Increment 3.95 (Task 7): a fresh/new game must never carry an "ask
    // about this" focus over from the last one.
    setChatFocus({});
    // Increment 3.91 (Task 4): a fresh/new game must never carry over the
    // last debrief's turning-lines cache or board arrows.
    setTurningLines([]);
    // Opponent-move-analysis plan (2026-08-03), Wave C: same reasoning --
    // highlightLines is per-debrief, never carried into a fresh game.
    setHighlightLines([]);
    setReviewArrows([]);
    setReviewHighlights([]);
  }, []);

  const startGame = useCallback(async (sid: number, elo: number) => {
    resetGameState();
    const g = await newGame(sid, elo);
    mirrorRef.current = new Chess(g.fen);
    setFen(g.fen);
    setFallback(g.fallback);
    setGameId(g.gameId);
    setOpponentElo(g.elo ?? elo);
    lastReplyAtRef.current = Date.now();
    // Resume self-arm (Wave 3.5): stamp ?game=<id> into the URL so a reload
    // RESUMES this game instead of orphaning it. replaceState (not pushState)
    // -- a live game is one browser entry, not a back-button step.
    window.history.replaceState(null, "", withGameParam(window.location.pathname, window.location.search, g.gameId));
    // Turn state now lives in the player bars (see render) — clear the
    // "finding an opponent..." transient now that the game is ready, but
    // don't replace it with "your move" text; status is transient-only.
    setStatus("");
  }, [resetGameState]);

  // Recovery path (2026-07-29, owner incident): an in-progress game was
  // UNREACHABLE once anything interrupted the tab. startGame is the only way
  // into a game and it always POSTs a brand NEW one, and there is no
  // GET /api/game/:id, so a reload could only ever abandon a live game --
  // that is where the 0-and-1-move stubs in her history come from. The server
  // still holds the position in GameManager's own map (playerMove reads
  // `this.games.get(gameId)`), so the only missing piece was the client
  // knowing which id to attach to. `?game=<id>` supplies it, and because the
  // param stays in the URL a reload now RESUMES instead of orphaning.
  //
  // Nothing here is guessed. The fen comes from a chess.js replay of the
  // already-stored SANs (the same replay-from-scratch pattern Rewind.tsx
  // uses) and the capture trays from capturesAtPly, which is authoritative
  // because it reads each Move object's own `captured` field. Server-side
  // this is read-only: fetchSummary on an UNFINISHED game cannot write,
  // because getSummary's on-read backfill is gated on `game?.result` being
  // set, and an unfinished game has none.
  const resumeGame = useCallback(
    async (id: number) => {
      resetGameState();
      const s = await fetchSummary(id);
      // Dead-id guard: a summary with no moves is the orphaned 0-move stub --
      // resuming it would mount an empty board wired to a gameId the server
      // no longer holds live. Treat it as a failed resume (throw -> the
      // effect's catch clears the param and stays on the start state) instead
      // of silently arming a dead game.
      if (!isResumableSummary(s)) throw new Error("no resumable game for that id");
      const mirror = new Chess();
      for (const m of s.moves) mirror.move(m.san);
      mirrorRef.current = mirror;
      setFen(mirror.fen());
      setGameId(id);
      // W5: side rides the summary datum (server-derived once at load) and
      // is carried through as data by the liveMoves boundary mapper.
      setLiveMoves(liveMovesFromSummary(s.moves));
      setCaptured(capturesAtPly(s.moves, s.moves.length));
      lastReplyAtRef.current = Date.now();
      // Normalize the URL to exactly ?game=<id> on a successful resume (the
      // param is already there, but this keeps every entry point consistent).
      window.history.replaceState(null, "", withGameParam(window.location.pathname, window.location.search, id));
      setStatus("");
    },
    [resetGameState]
  );

  useEffect(() => {
    const id = readGameParam(window.location.search);
    if (id == null) return;
    let cancelled = false;
    resumeGame(id).catch(() => {
      if (cancelled) return;
      // Failed/dead resume: drop the param so a further reload doesn't retry
      // a game that can't be resumed, and stay on the start state.
      window.history.replaceState(null, "", withGameParam(window.location.pathname, window.location.search, null));
      setStatus("could not resume that game");
    });
    return () => {
      cancelled = true;
    };
  }, [resumeGame]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await newSession();
      if (cancelled) return;
      setSessionId(s.sessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    return modeTimer(sessionId, "game", () => setSessionGone(true));
  }, [sessionId]);

  useEffect(() => {
    window.localStorage.setItem(COACH_MODE_KEY, String(coachOn));
  }, [coachOn]);

  useEffect(() => {
    window.localStorage.setItem(CONFIRM_STEP_KEY, String(confirmOn));
  }, [confirmOn]);

  // Increment 3c: fetch the debrief's turning points/classifications/moves
  // once a game finishes. gameOver flips true from several independent
  // sites (playerMove's gameOver branch, resign, offerDraw's accept,
  // adjudicate's execute) — this effect is the single place that reacts to
  // all of them, rather than duplicating the fetch at each call site.
  useEffect(() => {
    if (!gameOver || !gameId) return;
    let cancelled = false;
    fetchSummary(gameId)
      .then((s) => {
        if (!cancelled) setLiveSummary(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gameOver, gameId]);

  // Resume self-arm (Wave 3.5): once the game is over there is nothing live
  // to resume, so disarm the URL -- a reload on the debrief should land on the
  // start state, not try to re-mount a finished game as if it were live.
  useEffect(() => {
    if (gameOver) window.history.replaceState(null, "", withGameParam(window.location.pathname, window.location.search, null));
  }, [gameOver]);

  // Game-151 round (visual-rca 1): every ending lands on screen. Win/loss
  // only survived the fold because confetti/storm are fixed-position
  // overlays; the panel itself is the guarantee now. The 80ms defer lets
  // the panel mount before the scroll runs.
  useEffect(() => {
    if (!gameOver) return;
    const id = window.setTimeout(() => {
      document.querySelector(".game-over .result")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [gameOver]);

  // Increment 3.91 (Task 4): fetch the persisted per-turning-point PV/best-
  // move lines once per debrief — live-just-finished game or a reviewed
  // past game, same "which debrief is active" id as activeReviewMoves below
  // computes. Cached in state and looked up by ply in handleRewind; never
  // refetched just because rewindPly changes.
  useEffect(() => {
    const debriefGameId = reviewGame ? reviewGame.id : gameOver ? gameId : null;
    if (!debriefGameId) return;
    let cancelled = false;
    getTurningLines(debriefGameId)
      .then((r) => {
        if (!cancelled) setTurningLines(r.ok ? r.lines : []);
      })
      .catch(() => {
        if (!cancelled) setTurningLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewGame, gameOver, gameId]);

  // Opponent-move-analysis plan (2026-08-03), Wave C: fetch the per-
  // highlighted-ply engine facts for EITHER side (Wave A's endpoint)
  // alongside turningLines above -- same "which debrief is active" id, its
  // own effect so a failure/slow response on one fetch never blocks the
  // other. Looked up by ply in handleAskAboutPly (via resolvePlyFocus) and
  // passed straight to DebriefPage for the magenta drawer (Wave B).
  useEffect(() => {
    const debriefGameId = reviewGame ? reviewGame.id : gameOver ? gameId : null;
    if (!debriefGameId) return;
    let cancelled = false;
    getHighlightLines(debriefGameId)
      .then((r) => {
        if (!cancelled) setHighlightLines(r.ok ? r.lines : []);
      })
      .catch(() => {
        if (!cancelled) setHighlightLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewGame, gameOver, gameId]);

  useEffect(() => {
    window.localStorage.setItem(COACH_HINTS_KEY, String(coachHints));
  }, [coachHints]);

  useEffect(() => {
    window.localStorage.setItem(COACH_BACKEND_KEY, coachBackend);
  }, [coachBackend]);

  useEffect(() => {
    window.localStorage.setItem(JUDGE_STRICTNESS_KEY, judgeStrictness);
  }, [judgeStrictness]);

  // The popover shouldn't linger open across a move it can no longer
  // safely act on — close it the moment input locks up, same "no queuing"
  // spirit as disabling the switches themselves.
  useEffect(() => {
    if (uiBusy || pending) setSettingsOpen(false);
  }, [uiBusy, pending]);

  // Small in-world popover, not a modal — dismiss on any click outside it
  // rather than trapping focus or blocking the board.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [settingsOpen]);

  // `overrideVerdict` (C4): non-null only when this confirm is an override
  // (a "warning"-tier confirm — see isOverrideConfirm in moveFlow.ts and
  // handleConfirmPending below, the only caller that ever passes it).
  // one-tap and judge-post both call handleMove with no third argument, so
  // they never write an override event.
  const handleMove = useCallback(
    async (from: string, to: string, overrideVerdict?: Verdict | null) => {
      if (!gameId || busyRef.current || gameOver) return;
      const mirror = mirrorRef.current;
      // Snapshot before mutating: the victim's kind (and, for en passant,
      // even its presence at capturedSquare) can only be read pre-move.
      const preMove = new Chess(mirror.fen());
      let mv;
      try {
        mv = mirror.move({ from, to, promotion: "q" });
      } catch {
        return; // illegal locally — never sent to the server
      }

      busyRef.current = true;
      setUiBusy(true);
      setStatus("");
      const board = boardRef.current;
      const render = describeMove(mv);
      const victim = victimKind(preMove, render);
      if (victim) {
        setCaptured((prev) => ({ ...prev, b: [...prev.b, victim] }));
      }

      try {
        if (board) {
          if (render.capture) await board.glitchCapture(render);
          else await board.glide(render);
        }
        // A4: the player's move just settled (animation complete) — light
        // up its squares. render.from/to are the king's squares even for a
        // castle (describeMove keeps the rook in `secondary`), so this is
        // already "the king's from/to" for castling, no special-casing.
        setLastMove({ from: render.from, to: render.to });
        // Highlight-a-move (Task 2): her move just settled — she can now
        // highlight it. mirror.history().length is the ply just played
        // (chess.js already pushed it onto history at the mirror.move()
        // call above), 1-indexed same as the server's ply column. Captured
        // once here so the revert branches below can roll back the SAME
        // ply if the move never actually lands server-side.
        const playedPly = mirror.history().length;
        setLiveMoves((prev) => pushLiveMove(prev, { ply: playedPly, san: mv.san, highlighted: false, side: "her" }));

        const timeSpentMs = Date.now() - lastReplyAtRef.current;
        // Turn state lives in the player bars now (top bar's "thinking..."
        // chip) — this ref/state pair is what drives it, not `status`.
        setMallowThinking(true);

        let res: MoveResponse;
        try {
          res = await sendMove(
            gameId,
            from,
            to,
            mv.promotion,
            timeSpentMs,
            overrideVerdict ? { deltaCp: overrideVerdict.deltaCp, mateAgainst: overrideVerdict.mateAgainst } : undefined
          );
        } catch {
          // No server response at all — nothing authoritative to adopt.
          // Roll back the optimistic capture we added above: `victim` was
          // only ever pushed onto captured.b, never captured.w (the reply
          // victim is appended later, strictly after the res.ok check below
          // returns true), so rollbackCapture here always removes exactly
          // the phantom entry this attempt added and nothing else.
          setCaptured((prev) => rollbackCapture(prev, "b", victim));
          setFen(adoptServerFen(mirror, undefined));
          setResyncTick((t) => t + 1);
          setStatus("connection hiccup. try that move again");
          setLastMove(null); // the move never actually landed — nothing to highlight
          // adoptServerFen's undo fallback just unwound mirror's history --
          // the ply we optimistically pushed above no longer exists, so the
          // live list must drop it too or a later highlight call targets a
          // ply the server never recorded.
          setLiveMoves((prev) => prev.filter((m) => m.ply !== playedPly));
          return;
        }
        lastReplyAtRef.current = Date.now();

        if (!res.ok) {
          // Same rollback as the catch branch above, for the same reason:
          // this return is still strictly before captured.w's reply-victim
          // append, so captured.b's last entry is still exactly our victim.
          setCaptured((prev) => rollbackCapture(prev, "b", victim));
          // Server-authoritative desync guard: adopt res.fen when the
          // server gave us one (it's the true post-rejection state), only
          // falling back to a local undo when it didn't send a usable fen.
          setFen(adoptServerFen(mirror, res.fen));
          setResyncTick((t) => t + 1);
          setStatus("that didn't land. try another move");
          setLastMove(null); // reverted — the highlighted move didn't actually happen
          // Same reasoning as the catch branch above: the server rejected
          // this move, so its ply was never recorded -- drop it from the
          // live list too.
          setLiveMoves((prev) => prev.filter((m) => m.ply !== playedPly));
          return;
        }

        if (res.reply) {
          // Render the intermediate post-player-move position (mirror already
          // holds it; the reply hasn't been applied yet) before jumping to
          // res.fen. Maia's legal reply necessarily resolves any check on her
          // own king, so if we set res.fen (the post-reply position) first,
          // a non-mate check the player just delivered would never be
          // rendered at all — this is the intermediate render that fixes that.
          setFen(mirror.fen());

          // If the player's move gave check, hold this position for a
          // minimum window so the ring is perceivable even when the server
          // replies fast, before the reply animation starts playing over it.
          if (kingInCheckSquare(mirror) !== null) {
            await sleep(CHECK_VISIBILITY_MS);
          }

          const replyFrom = res.reply.uci.slice(0, 2);
          const replyTo = res.reply.uci.slice(2, 4);
          const replyPromotion = res.reply.uci.length > 4 ? res.reply.uci[4] : "q";
          // Same pre-move snapshot rule as the player's move, above.
          const preReply = new Chess(mirror.fen());
          const replyMove = mirror.move({ from: replyFrom, to: replyTo, promotion: replyPromotion });
          const replyRender = describeMove(replyMove);
          const replyVictim = victimKind(preReply, replyRender);
          if (replyVictim) {
            setCaptured((prev) => ({ ...prev, w: [...prev.w, replyVictim] }));
          }
          if (board) {
            if (replyRender.capture) await board.glitchCapture(replyRender);
            else await board.glide(replyRender);
          }
          // A4: Mallow's reply just settled — the highlight moves to her
          // move now, same "both sides" lichess convention.
          setLastMove({ from: replyRender.from, to: replyRender.to });
          // Mallow's move joins the live list AND is highlightable now (W5
          // opponent-move highlight, owner-approved 2026-08-02): it becomes
          // the right-hand magenta badge of the newest pair in the pocket.
          // side is set here, at the producer that knows whose move it is.
          setLiveMoves((prev) => pushLiveMove(prev, { ply: mirror.history().length, san: replyMove.san, highlighted: false, side: "mallow" }));
        }

        setFen(res.fen);

        if (reconcile(mirror.fen(), res.fen).action === "adopt") {
          console.warn("[girl-chess] desync healed", { client: mirror.fen(), server: res.fen });
          setFen(adoptServerFen(mirror, res.fen));
          setResyncTick((t) => t + 1);
        }

        if (res.gameOver) {
          // Part 1 (checkmate only): find the winning side's nearest
          // attacker and play the king-takedown before the panel appears.
          // Resign/draw endings never reach here (they set gameOver from
          // their own handlers), so this is the only gameOver path that
          // needs the checkmate check.
          const tm = mirror.isCheckmate() ? findTakedownPiece(mirror) : null;
          if (tm && board) {
            await board.takedown(tm);
          }
          setTakedownMove(tm);
          setGameOver(res.gameOver);
          setStatus("");
          celebrate(res.gameOver.result);
        }
        // else: back to the player's turn — the bottom bar's "your move"
        // chip picks this up from uiBusy going false below; no status text.
      } finally {
        busyRef.current = false;
        setUiBusy(false);
        setMallowThinking(false);
      }
    },
    [gameId, gameOver, celebrate]
  );

  // Guardian Angel pending-move (C1): the destination click Board reports
  // now starts the pending flow instead of applying to the mirror directly.
  // Legality is checked against a throwaway clone — the mirror itself is
  // never touched until confirm — same "illegal locally, never sent to the
  // server" rule handleMove already follows for the real move.
  //
  // C3: `withJudge` splits this one entry point across two of the 4 move
  // flows — judge-confirm (coach+confirm, the C1/C2 shape below unchanged)
  // and confirm-only (confirm alone: same pending render, but skips the
  // /judge call and never sets judgePhase, so no indicator ever renders —
  // "play it" / "take it back" is all there is).
  //
  // A2: no longer guarded on `pending` being falsy — it's also the entry
  // point handleRetargetPending calls to restart a pending move at a new
  // destination while one is already pending. That's safe specifically
  // because it's the ONLY caller allowed to invoke this while pending is
  // truthy: Board never calls the plain onMove (which leads here via
  // handleBoardMove) while pending — it calls onRetarget/onCancelPending
  // instead (see Board's pending-aware click handlers). The token bump
  // below still supersedes whatever pending (and its in-flight judge call,
  // if any) came before it.
  const handlePendingStart = useCallback(
    (from: string, to: string, withJudge: boolean) => {
      if (!gameId || busyRef.current || gameOver) return;
      const probe = new Chess(mirrorRef.current.fen());
      let mv;
      try {
        mv = probe.move({ from, to, promotion: "q" });
      } catch {
        return; // illegal locally — never sent to the server
      }

      // A1: full post-move render — not just from/to/promotion — so Board
      // can preview the complete final position (castling rook included,
      // any capture's victim dimmed) while the move sits pending.
      const render = describeMove(mv);

      const token = (pendingTokenRef.current += 1);
      setPending(render);
      // Wave C, task C-B: every new pending (including a retarget, which
      // re-enters here via handleRetargetPending) starts the hint ladder
      // fresh — a stale hint from the last destination would point at the
      // wrong "instead" square.
      setHintPress(0);
      setHintBranch(null);
      setHintFacts(null);
      setHintFetching(false);
      setCoachText(null);
      setCoachTraceId(null);
      setCoachLoading(false);
      narratedTokenRef.current = null;
      prefetchedTokenRef.current = null;
      // Reviewer fix (Task 7 follow-up, tidiness): a fresh pending move is a
      // fresh moment — buildChatContext's reconcileChatFocus guard is what
      // actually prevents a stale hintFocus from leaking into a message, but
      // clearing it here too means the drawer's next context is never even
      // built from a focus that's about to be invalidated.
      setChatFocus({});

      if (!withJudge) {
        // confirm-only: pure two-step, zero /judge calls, no indicator.
        setJudgePhase(null);
        setVerdict(null);
        return;
      }

      setJudgePhase("judging");
      setVerdict(null);

      (async () => {
        const startedAt = Date.now();
        let result: Verdict | null = null;
        try {
          const res = await judgeMove(gameId, from, to, render.promotion, undefined, judgeStrictness);
          result = res.verdict ?? null;
        } catch {
          // No verdict to show — confirm/retract never depend on this call
          // succeeding, so this just falls back to the plain "judged ✓"
          // (no badge) state.
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed < JUDGE_MIN_MS) await sleep(JUDGE_MIN_MS - elapsed);
        if (pendingTokenRef.current !== token) return; // superseded — stale, ignore
        setVerdict(result);
        setJudgePhase("judged");

        // Wave 2 (item 1): prefetch the DEEP hint facts the instant a
        // nudge/warning-with-threat lands, so the branch decision (which
        // needs bestFacts.bestFromSquare) is ready before she clicks "help?".
        // Reuses the SAME `token` this judge callback already holds -- never
        // re-reads pendingTokenRef.current after an await except to compare
        // against that captured token (the staleness guard). Fires at most
        // once per pending move via prefetchedTokenRef. Best-effort: if it
        // fails or the player outruns it, handleHintClick has its own
        // fallback fetch and the button shows "thinking..." until facts land.
        if (result && result.threat && (result.tier === "nudge" || result.tier === "warning")) {
          if (prefetchedTokenRef.current !== token) {
            prefetchedTokenRef.current = token;
            (async () => {
              try {
                const res = await fetchHintFacts(gameId);
                if (pendingTokenRef.current !== token) return; // superseded
                if (!res.ok || !res.facts || !hintIsLegal(mirrorRef.current.fen(), res.facts.bestUci)) {
                  // Never let an illegal/stale hint reach the branch decision --
                  // log it for the Lab (the "impossible square" playtest bug),
                  // exactly as the old 3->4 fetch did.
                  logHint(
                    gameId,
                    0,
                    "invalid",
                    null,
                    { bestUci: res.facts?.bestUci ?? "none" },
                    mirrorRef.current.fen()
                  ).catch(() => undefined);
                  return;
                }
                setHintFacts(res.facts);
              } catch {
                // best-effort; the help click's own fetch covers a miss.
              }
            })();
          }
        }
      })();
    },
    [gameId, gameOver, judgeStrictness]
  );

  // Confirm: never blocked by the verdict, whatever it says — runs the
  // existing handleMove flow exactly as today (mirror apply + POST /move +
  // animation). Clearing pending first (rather than in handleMove) keeps
  // handleMove itself unchanged from its pre-C1 shape.
  const handleConfirmPending = useCallback(() => {
    if (!pending) return;
    const { from, to } = pending;
    // C4: override logging — an override is confirming a move the judge
    // marked "warning" (a "nudge" confirm is deliberately NOT an override;
    // isOverrideConfirm is the pinned, unit-tested decision). This is the
    // only place the flag is ever set: judge-post (coach-only) mode has no
    // confirm step at all, so it can never produce an override — see
    // handleMoveWithPostJudge, which calls handleMove with no third arg.
    const overrideVerdict = isOverrideConfirm(verdict?.tier) ? verdict : null;
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
    setHintPress(0); // Wave 2: press ladder resets on confirm
    setHintBranch(null);
    setHintFacts(null);
    setHintFetching(false);
    setCoachText(null);
    setCoachTraceId(null);
    setCoachLoading(false);
    narratedTokenRef.current = null;
    prefetchedTokenRef.current = null;
    // Reviewer fix (Task 7 follow-up, tidiness): see handlePendingStart's
    // comment above — a confirmed move ends this moment.
    setChatFocus({});
    handleMove(from, to, overrideVerdict);
  }, [pending, verdict, handleMove]);

  // Retract: purely client-side — the server never stored any pending
  // state to undo. Selection was already cleared by Board before onMove
  // fired, so there's nothing else to reset.
  const handleRetractPending = useCallback(() => {
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
    setHintPress(0); // Wave 2: press ladder resets on cancel
    setHintBranch(null);
    setHintFacts(null);
    setHintFetching(false);
    setCoachText(null);
    setCoachTraceId(null);
    setCoachLoading(false);
    narratedTokenRef.current = null;
    prefetchedTokenRef.current = null;
    // Reviewer fix (Task 7 follow-up, tidiness): see handlePendingStart's
    // comment above — a retracted move ends this moment too.
    setChatFocus({});
  }, []);

  // Wave C, tasks 5-6 (owner): "if I hit Enter on the keyboard... I'm not
  // always having to click confirm in order to go to the next move." Enter =
  // play it, Escape = take it back. Window-level and pending-gated; the
  // guard skips form fields so a future input (elo select, coach chat) never
  // fights it.
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmPending();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleRetractPending();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, handleConfirmPending, handleRetractPending]);

  // A2 (pending retarget): Board resolved a click to "a different legal
  // destination for the same origin" (resolvePendingClick's "retarget"
  // action) — retract the current pending and start a fresh one at the new
  // destination, through the SAME flow the original pending used (judge-
  // confirm re-judges; confirm-only doesn't). Reuses handlePendingStart
  // wholesale: it bumps pendingTokenRef itself (superseding this pending's
  // in-flight judge call, if any) and fully re-renders pending/judgePhase/
  // verdict for the new destination — no separate retract step needed.
  // coachOn/confirmOn can't have changed mid-pending (the toggles disable
  // themselves while pending), so re-deriving the flow from them here is
  // exactly the flow the original pending was started with.
  const handleRetargetPending = useCallback(
    (to: string) => {
      if (!pending) return;
      const withJudge = resolveMoveFlow(coachOn, confirmOn) === "judge-confirm";
      handlePendingStart(pending.from, to, withJudge);
    },
    [pending, coachOn, confirmOn, handlePendingStart]
  );

  // Wave 2 (the hint decision tree): every press is a pure increment now --
  // the branch decision + all copy come from the DEEP facts, prefetched at
  // verdict time (see the judge callback above). The only network fetch left
  // here is the FALLBACK for when the player outruns that prefetch. The fen
  // logged is the position BEFORE the pending move (mirrorRef is untouched
  // while a move is pending) -- "what was best instead" needs it.
  //
  // Telemetry (Wave 0's honest keys): a press whose copy is threat-based /
  // vague logs the opponent's threat move under refutationUci; a press whose
  // copy is about the recommended move (the full reveal, and the wrong
  // branch's "your {piece}" / "what it does" rungs) logs bestUci.
  const logHintPress = (branch: HintBranch, press: number, facts: NonNullable<HintFactsResponse["facts"]>) => {
    if (!gameId || !verdict?.threat) return;
    const isReveal = press === maxPress(branch);
    const aboutBestMove = isReveal || (branch === "wrong" && press >= 2);
    logHint(
      gameId,
      press,
      verdict.tier,
      verdict.deltaCp,
      aboutBestMove ? { bestUci: facts.bestUci } : { refutationUci: verdict.threat.refutationUci },
      mirrorRef.current.fen(),
      branch
    ).catch(() => undefined);
  };

  const handleHintClick = useCallback(() => {
    if (!gameId || !verdict?.threat || !pending) return;

    // Facts already in hand (prefetched, or a prior fallback fetch): a pure
    // press increment. The branch is decided once, at the 0->1 step.
    if (hintFacts) {
      const branch = hintBranch ?? decideBranch(pending.from, hintFacts.bestFromSquare);
      const next = Math.min(hintPress + 1, maxPress(branch));
      if (next === hintPress) return; // capped -- "more?" is a no-op at the top
      if (hintBranch == null) setHintBranch(branch);
      setHintPress(next);
      // Round 2, item 6: every real press bumps the burst tick, capped press
      // above already returned early so this never fires for a no-op click.
      setHintGlitchTick((t) => t + 1);
      logHintPress(branch, next, hintFacts);
      return;
    }

    // She outran the prefetch: press 1 needs the branch decision, which needs
    // the facts. Fetch them (token-guarded like the judge call), then land on
    // press 1 with the branch decided. Until this resolves the button shows
    // the "thinking..." disabled state -- there is no facts-free rung.
    if (hintFetching) return;
    const token = pendingTokenRef.current;
    const fromSquare = pending.from;
    setHintFetching(true);
    (async () => {
      try {
        const res = await fetchHintFacts(gameId);
        if (pendingTokenRef.current !== token) return; // superseded
        if (!res.ok || !res.facts || !hintIsLegal(mirrorRef.current.fen(), res.facts.bestUci)) {
          logHint(
            gameId,
            0,
            "invalid",
            null,
            { bestUci: res.facts?.bestUci ?? "none" },
            mirrorRef.current.fen()
          ).catch(() => undefined);
          return;
        }
        const branch = decideBranch(fromSquare, res.facts.bestFromSquare);
        setHintFacts(res.facts);
        setHintBranch(branch);
        setHintPress(1);
        // Round 2, item 6: the outran-the-prefetch path also lands on a real
        // press (press 1) once the facts resolve -- same burst as the fast
        // path above.
        setHintGlitchTick((t) => t + 1);
        logHintPress(branch, 1, res.facts);
      } finally {
        if (pendingTokenRef.current === token) setHintFetching(false);
      }
    })();
  }, [gameId, verdict, pending, hintFacts, hintBranch, hintPress, hintFetching]);

  // Increment 3a Wave 3: coach's corner narration. Fires once per pending
  // move, once the player has engaged the ladder (press >= 2 -- right-P2 is
  // the "what the opponent is doing" WHY moment) for a nudge/warning verdict.
  // Reuses pendingTokenRef -- the same guard the judge call and hint fetch
  // use -- so a response for a since-superseded pending move is dropped.
  // Never gates anything on the ladder itself.
  //
  // Wave 2 (item 5): this MUST gate on press >= 2 explicitly, not on
  // hintFacts presence. With the verdict-time prefetch, hintFacts now lands
  // the instant the move is judged -- so the old "hintFacts && level >= 3"
  // shape would narrate (and burn a real backend call + advice_traces write)
  // before she has clicked anything at all.
  useEffect(() => {
    // Review fast-follow (F3, increment 3a): this effect used to fire at L3+
    // regardless of the coachHints toggle, while the corner's own render
    // below is gated on it — a real claude-CLI call plus an advice_traces
    // write for output that then never rendered. Gate on coachHints here
    // too, and clear any stale text/loading state so a corner that was
    // showing something before the player flipped hints off (toggling is
    // blocked mid-pending by setCoachHintsPref, but a stale value from an
    // earlier pending move could still be sitting in state) doesn't linger.
    if (!coachHints) {
      setCoachText(null);
      setCoachTraceId(null);
      setCoachLoading(false);
      return;
    }
    if (!pending || !gameId || !verdict || !hintFacts) return;
    if (verdict.tier !== "nudge" && verdict.tier !== "warning") return;
    if (hintPress < 2) return;
    const token = pendingTokenRef.current;
    if (narratedTokenRef.current === token) return;
    narratedTokenRef.current = token;

    const herPieceKind = mirrorRef.current.get(pending.from as Square)?.type ?? "piece";
    setCoachLoading(true);
    narrate(gameId, {
      herPiece: herPieceKind,
      from: pending.from,
      to: pending.to,
      tier: verdict.tier,
      deltaCp: verdict.deltaCp,
      // Wave 1 (item 2 -- typed mate): thread the typed mate distance through
      // so the coach prompt ships it instead of the folded deltaCp (99098).
      mateBefore: verdict.mateBefore,
      mateAfter: verdict.mateAfter,
      threat: verdict.threat,
      best: {
        san: hintFacts.bestSan,
        uci: hintFacts.bestUci,
        pieceKind: hintFacts.bestPieceKind,
        from: hintFacts.bestFromSquare,
        to: hintFacts.bestToSquare,
      },
      recommendation: hintFacts.recommendation,
      backendPref: coachBackend,
    })
      .then((res) => {
        if (pendingTokenRef.current !== token) return; // superseded — drop it
        setCoachLoading(false);
        if (res.ok && res.text) {
          setCoachText(res.text);
          setCoachTraceId(res.traceId ?? null);
        }
      })
      .catch(() => {
        if (pendingTokenRef.current !== token) return;
        setCoachLoading(false);
      });
  }, [gameId, pending, verdict, hintPress, hintFacts, coachHints, coachBackend]);

  // A5: surfaces a short "you tried something, here's why it didn't work"
  // message in the status line for a few seconds (currently only "can't
  // castle right now" — see Board's isCastleAttempt-gated onInputHint call).
  const handleInputHint = useCallback((message: string) => {
    setInputHint(message);
    if (inputHintTimerRef.current) window.clearTimeout(inputHintTimerRef.current);
    inputHintTimerRef.current = window.setTimeout(() => setInputHint(null), INPUT_HINT_MS);
  }, []);

  // judge-post (coach only, confirm off): the third of the 4 move flows.
  // No pending step at all — the move plays immediately through the
  // ordinary handleMove path, exactly like one-tap, while /judge (mode:
  // "post") runs in parallel and the badge appears whenever it resolves.
  // Deliberately does NOT pad to JUDGE_MIN_MS: the no-timing-tells cadence
  // only matters where a pending "judging…" indicator exists for a player
  // to read timing into — there isn't one here, so the badge just shows up
  // whenever the eval actually finishes.
  const handleMoveWithPostJudge = useCallback(
    (from: string, to: string) => {
      if (!gameId || busyRef.current || gameOver) return;
      const token = (postVerdictTokenRef.current += 1);
      judgeMove(gameId, from, to, undefined, "post", judgeStrictness)
        .then((res) => {
          if (postVerdictTokenRef.current !== token) return; // superseded by a newer move
          setPostVerdict(res.verdict ?? null);
        })
        .catch(() => {
          // No badge — the move itself never depends on this call.
        });
      handleMove(from, to);
    },
    [gameId, gameOver, handleMove, judgeStrictness]
  );

  // Single dispatch point for every destination click Board reports.
  // resolveMoveFlow (src/game/moveFlow.ts) is the pinned spec for which of
  // the 4 flows a given (coachOn, confirmOn) pair maps to.
  const handleBoardMove = useCallback(
    (from: string, to: string) => {
      // Disarm any armed "take the win?" end-game confirm the instant the
      // board takes input: the server re-derives the outcome fresh on
      // execute, but the client's armed copy (win/draw/resign label) was
      // computed from whatever the position was at arm-time. If the player
      // makes a move instead of confirming, that armed state is now stale —
      // clear it (and its confirm-window timer) rather than let a later,
      // unrelated click on the end-game button execute against a preview
      // that no longer describes the current position.
      if (endGameTimerRef.current) {
        window.clearTimeout(endGameTimerRef.current);
        endGameTimerRef.current = null;
      }
      setEndGameOutcome(null);

      if (postVerdict) setPostVerdict(null); // clear the previous move's post-judge badge
      const flow = resolveMoveFlow(coachOn, confirmOn);
      if (flow === "one-tap") {
        handleMove(from, to);
      } else if (flow === "judge-post") {
        handleMoveWithPostJudge(from, to);
      } else {
        handlePendingStart(from, to, flow === "judge-confirm");
      }
    },
    [coachOn, confirmOn, postVerdict, handleMove, handleMoveWithPostJudge, handlePendingStart]
  );

  const toggleCoach = useCallback(() => {
    if (uiBusy || pending) return;
    setCoachOn((v) => !v);
  }, [uiBusy, pending]);

  const setCoachPref = useCallback(
    (v: boolean) => {
      if (uiBusy || pending) return;
      setCoachOn(v);
    },
    [uiBusy, pending]
  );

  const setConfirmPref = useCallback(
    (v: boolean) => {
      if (uiBusy || pending) return;
      setConfirmOn(v);
    },
    [uiBusy, pending]
  );

  const setCoachHintsPref = useCallback(
    (v: boolean) => {
      if (uiBusy || pending) return;
      setCoachHints(v);
    },
    [uiBusy, pending]
  );

  const setCoachBackendPref = useCallback(
    (v: CoachBackendPref) => {
      if (uiBusy || pending) return;
      setCoachBackend(v);
    },
    [uiBusy, pending]
  );

  const setJudgeStrictnessPref = useCallback(
    (v: JudgeStrictnessPref) => {
      if (uiBusy || pending) return;
      setJudgeStrictness(v);
    },
    [uiBusy, pending]
  );

  useEffect(() => {
    return () => {
      if (endGameTimerRef.current) window.clearTimeout(endGameTimerRef.current);
      if (inputHintTimerRef.current) window.clearTimeout(inputHintTimerRef.current);
    };
  }, []);

  const clearEndGameTimer = useCallback(() => {
    if (endGameTimerRef.current) {
      window.clearTimeout(endGameTimerRef.current);
      endGameTimerRef.current = null;
    }
  }, []);

  // Wave C, task C-A: the single "end the game?" button. Owner feedback,
  // verbatim intent: "I can't just offer a draw if I am falling way
  // behind... use chess.js [and the engine] to figure out what governs in
  // a tournament when someone says 'I don't want to continue.'" — the
  // engine decides which of win/draw/resign actually applies, not the
  // player.
  //
  // First click: calls adjudicate with execute:false (a preview — nothing
  // ends yet) and, once it resolves, arms the button with the outcome copy
  // for CONFIRM_MS, same in-world arm-then-confirm pattern the old
  // separate resign/draw buttons used (never a silent relabel — the armed
  // state always shows what a second click would actually do).
  //
  // Second click within the window: calls adjudicate again with
  // execute:true. The server re-derives the outcome fresh rather than
  // trusting anything this client remembers from the preview — board input
  // is NOT locked while armed (handleBoardMove disarms on any board move,
  // see there), so the position genuinely can shift between the two clicks;
  // the execution reflects reality, not the stale preview.
  const handleEndGameClick = useCallback(() => {
    if (!gameId || busyRef.current || gameOver || endGameBusyRef.current) return;

    if (endGameOutcome) {
      clearEndGameTimer();
      setEndGameOutcome(null);
      (async () => {
        busyRef.current = true;
        setUiBusy(true);
        try {
          const r = await adjudicate(gameId, true);
          if (r.ok && r.result) {
            // Adjudicated endings skip the takedown, same as resign/draw
            // did — there's no checkmate sequence to stage.
            setTakedownMove(null);
            setGameOver({ result: r.result });
            setStatus("");
            celebrate(r.result);
          }
        } finally {
          busyRef.current = false;
          setUiBusy(false);
        }
      })();
      return;
    }

    (async () => {
      endGameBusyRef.current = true;
      try {
        const r = await adjudicate(gameId, false);
        if (r.ok && r.outcome) {
          setEndGameOutcome(r.outcome);
          clearEndGameTimer();
          endGameTimerRef.current = window.setTimeout(() => setEndGameOutcome(null), CONFIRM_MS);
        }
      } finally {
        endGameBusyRef.current = false;
      }
    })();
  }, [gameId, gameOver, endGameOutcome, clearEndGameTimer, celebrate]);

  // Increment 3c: the debrief's rewind seam. `activeReviewMoves` is
  // whichever game's move list the currently-visible debrief belongs to —
  // a reviewed past game takes priority; otherwise, once the live game has
  // ended, its own just-fetched summary. Reuses the same fen/resyncTick
  // hard-remount seam reconcile.ts's "adopt" branch already uses to snap
  // Board to a fen without animating through it (see Rewind.tsx's header
  // comment) — never builds a second board.
  const activeReviewMoves = reviewGame ? reviewGame.summary.moves : gameOver ? (liveSummary?.moves ?? null) : null;
  // Coach truth-speed round (Wave C1, 2026-07-27): same "whichever debrief is
  // active" derivation as activeReviewMoves above, for the two other summary
  // fields handleAskAboutPly needs to look up a bullet's own turning point
  // (or fall back to its bare classification) by ply.
  const activeTurningPoints: TurningPoint[] = reviewGame
    ? reviewGame.summary.turningPoints
    : gameOver
      ? (liveSummary?.turningPoints ?? [])
      : [];
  const activeClassifications: MoveClassification[] = reviewGame
    ? reviewGame.summary.classifications
    : gameOver
      ? (liveSummary?.classifications ?? [])
      : [];

  const requestChatOpen = useCallback(() => setChatOpenSignal((t) => t + 1), []);

  // Coach truth-speed round (Wave C1, 2026-07-27): the arrow-building steps
  // handleRewind/handleAskAboutTurningPoint/handleAskAboutPly all repeat —
  // followedBest against activeReviewMoves, reviewArrows.ts's
  // turningLineArrows, then the played-arrow fallback for a ply with no
  // matching TurningLine (or a TurningLine whose own playedFromTo never
  // resolved). Centralized so the "found" dedup case (which legitimately has
  // no "played"-coloured arrow at all — see reviewArrows.ts) doesn't
  // re-trigger the fallback and double up on the same move.
  // F4 (owner ruling 2026-08-03, game 169): `intent` splits the two framings
  // this helper serves. "ask" (the default — handleAskAboutTurningPoint/
  // handleAskAboutPly) keeps the full-context arrow set; "replay"
  // (handleRewind only) routes through turningLineReplayArrows, which for an
  // OPPONENT-ply line focuses the inaccuracy itself as the sole magenta
  // arrow and is byte-identical to the context framing for everything else —
  // see that function's header and reviewArrows.test.ts's regression pins.
  //
  // Postgame arrow redesign, Task 2 (2026-08-04, conservative-scope
  // override owner-approved same date): the branch on whether a
  // HighlightLine exists for `ply` -- and therefore whether this ply routes
  // through the new reviewArrowsForMove three-arrow model instead of the
  // paragraph above's pre-existing framing -- now lives in arrowSelection.ts
  // (extracted so it's unit-testable without a GamePage render harness; see
  // that file's own header for the full rationale). This is a thin wrapper
  // over it so every existing call site (handleRewind,
  // handleAskAboutTurningPoint, handleAskAboutPly) is unchanged.
  const buildArrowsForPly = useCallback(
    (line: TurningLine | undefined, ply: number, intent: "ask" | "replay" = "ask"): ReviewArrow[] =>
      buildArrowsForPlyPure(line, ply, activeReviewMoves ?? undefined, highlightLines, intent),
    [activeReviewMoves, highlightLines]
  );

  // Increment 3.9, Task 3: coach chat's per-message context. Review mode is
  // bare (the server grounds against the whole stored game); live mode
  // mirrors the exact pending/verdict/hintFacts trio the coach's corner
  // narrate() call above builds from, when that trio is actually in hand —
  // otherwise just {mode:"live"} (per the brief: "current pending/verdict/
  // hintFacts when present else {mode:'live'}"). A fresh closure read at
  // send time, not memoized to a token — chat is player-initiated, so
  // there's no "fires once per pending move" concern the narrate effect has.
  // Task 7 adds chatFocus's fields on top of either branch's own facts —
  // a focused hint/turning-point can be asked about in either mode.
  //
  // Reviewer fix (Task 7 follow-up): chatFocus is only cleared at full
  // game/review-switch boundaries, not at the finer ones where the on-screen
  // MOMENT changes (a new pending move resets and re-climbs the hint ladder;
  // a different turning-point card gets replayed) — so a message could still
  // carry a focus for a moment that's no longer on screen. Rather than
  // relying on every state-transition handler to remember to clear it, this
  // recomputes the CURRENT hint text fresh (exactly the same herPieceKind/
  // herToSquare/threat/bestFacts/fen -> rungCopy path the visible hint-copy
  // span uses) and runs reconcileChatFocus every send — a focus survives
  // only if it still matches what's actually on screen right now.
  const buildChatContext = useCallback((): ChatContext => {
    // Phase 3 review fix (F1): the pending move's own ply -- mirrorRef is
    // untouched while a move is pending, so history().length + 1 is exactly
    // the position the hint ladder (and any hintFocus set from it) is scoped
    // to right now. Passed alongside the branch/press/text check so a stale
    // focus from a DIFFERENT pending move at the same rung with a fixed opener
    // line (see reconcileChatFocus's header) is correctly dropped.
    const pendingPly = pending ? mirrorRef.current.history().length + 1 : null;
    const liveHintCtx: HintCopyCtx | null = pending
      ? {
          herPieceKind: mirrorRef.current.get(pending.from as Square)?.type ?? "piece",
          herToSquare: pending.to,
          threat: verdict?.threat,
          bestFacts: hintFacts ?? undefined,
          fen,
          gameId: gameId ?? 0,
          pendingPly: pendingPly ?? 0,
          conversionCopy: verdict?.conversionCopy,
          mateAfter: verdict?.mateAfter,
        }
      : null;
    // Wave 2: recompute the current rung's copy the same way the visible
    // hint-copy span does, so reconcile drops a focus whose text has moved on.
    const currentHintText =
      hintPress > 0 && hintBranch && liveHintCtx ? rungCopy(hintBranch, hintPress, liveHintCtx) : null;
    const focus = reconcileChatFocus(chatFocus, {
      hintBranch,
      hintPress,
      renderedHintText: currentHintText,
      pendingPly,
      rewindPly,
    });
    // Task 1 (R2, pending-move context threading): called UNCONDITIONALLY
    // whenever `pending` is truthy -- unlike the herMove/tier fields below,
    // which only populate once verdict.tier is nudge/warning, this covers
    // silent/in-flight/coach-off too (pendingMoveContext returns undefined
    // when nothing is pending, so it's always safe to spread).
    const pendingMove = pendingMoveContext(pending, fen, verdict);
    const extra = pendingMove ? { ...focus, pendingMove } : focus;

    if (reviewGame) return { mode: "review", ...extra };
    if (pending && verdict && verdict.tier !== "silent") {
      const herPieceKind = mirrorRef.current.get(pending.from as Square)?.type ?? "piece";
      return {
        mode: "live",
        herMove: { pieceKind: herPieceKind, from: pending.from, to: pending.to },
        tier: verdict.tier,
        threat: verdict.threat,
        best: hintFacts
          ? {
              san: hintFacts.bestSan,
              uci: hintFacts.bestUci,
              pieceKind: hintFacts.bestPieceKind,
              from: hintFacts.bestFromSquare,
              to: hintFacts.bestToSquare,
            }
          : undefined,
        recommendation: hintFacts?.recommendation,
        ...extra,
      };
    }
    return { mode: "live", ...extra };
  }, [reviewGame, pending, verdict, hintFacts, chatFocus, hintBranch, hintPress, gameId, fen, rewindPly]);

  // Increment 3.95, Task 7: a debrief turning-point card's own "ask about
  // this" — looks up the matching TurningLine itself (turningLines is
  // already in hand from the debrief's own fetch) so the coach can legally
  // name the best line once assembleChatFactList folds it into allowedSans.
  //
  // Reviewer fix (Task 7 follow-up #2, CRITICAL): reconcileChatFocus (see
  // buildChatContext below) only keeps a turningPointFocus whose `ply`
  // equals the CURRENT `rewindPly` — a card clicked directly from the
  // debrief landing (rewindPly still null) would otherwise have its own
  // just-set focus dropped at send time, silently losing the allowedSans
  // fold and the coach's ability to name the best line. So this now puts
  // the board into that card's own replay state too (the exact same fen/
  // arrows/highlights handleRewind computes) rather than only setting the
  // focus — both showing the moment being asked about AND satisfying
  // reconcileChatFocus's ply match.
  //
  // Deliberately NOT a call to handleRewind: that function now also clears
  // chatFocus for its own "replaying is a new moment" tidiness (see its own
  // comment) — calling it here would immediately wipe the focus this
  // function is about to set. Board-state fields are set directly instead,
  // and chatFocus is set AFTER them, so the final state has both
  // rewindPly === point.ply and turningPointFocus.ply === point.ply.
  const handleAskAboutTurningPoint = useCallback(
    (point: TurningPoint) => {
      const line = turningLines.find((l) => l.ply === point.ply);
      if (activeReviewMoves) {
        setFen(fenAtPly(activeReviewMoves, point.ply));
        setResyncTick((t) => t + 1);
        setRewindPly(point.ply);
        const arrows = buildArrowsForPly(line, point.ply);
        setReviewArrows(arrows);
        setReviewHighlights(arrowsToHighlights(arrows));
      }
      setChatFocus({ turningPointFocus: turningPointFocusContext(point, line, activeReviewMoves ?? undefined) });
      requestChatOpen();
    },
    [activeReviewMoves, turningLines, buildArrowsForPly, requestChatOpen]
  );

  // Coach truth-speed round (Wave C1, 2026-07-27): a debrief BULLET's own
  // "ask about this"/"try the line"/"replay" — bullets (unlike curated
  // turning-point cards) may point at a ply with no TurningPoint at all (the
  // could-be-better/watch-next-time fallback candidates draw from the wider
  // `classifications` list — see debriefBullets.ts's buildCouldBeBetter).
  // When a real TurningPoint exists at this ply, this is just
  // handleAskAboutTurningPoint's own path (reuse it, don't fork the arrow/
  // focus logic in two places).
  //
  // Opponent-move-analysis plan (2026-08-03), Wave C: everything past the
  // TurningPoint check now delegates to chatFocus.ts's resolvePlyFocus,
  // which picks between the three remaining cases (a mallow ply; a her ply
  // WITH a classification, the pre-existing path; a her ply with NO
  // classification) and builds that case's focus from real facts only --
  // see that function's own header. This closes TWO no-ops the old
  // `if (!cls || !san) return;` gate silently produced: a highlighted mallow
  // ply (classifications are her-moves-only by design, so `cls` was always
  // undefined) and the ~97% of her own highlighted moves that also carry no
  // classification. A ply resolvePlyFocus can't resolve at all (should not
  // happen — affordancesForBullet only gates on ply != null) stays a no-op
  // rather than a guess.
  const handleAskAboutPly = useCallback(
    (ply: number) => {
      const point = activeTurningPoints.find((p) => p.ply === ply);
      if (point) {
        handleAskAboutTurningPoint(point);
        return;
      }
      const resolution = resolvePlyFocus(
        ply,
        activeReviewMoves ?? undefined,
        activeClassifications,
        turningLines,
        highlightLines
      );
      if (!resolution) return;
      if (activeReviewMoves) {
        setFen(fenAtPly(activeReviewMoves, ply));
        setResyncTick((t) => t + 1);
        setRewindPly(ply);
        const arrows = buildArrowsForPly(resolution.line, ply);
        setReviewArrows(arrows);
        setReviewHighlights(arrowsToHighlights(arrows));
      }
      setChatFocus({ turningPointFocus: resolution.focus });
      requestChatOpen();
    },
    [
      activeTurningPoints,
      activeClassifications,
      activeReviewMoves,
      turningLines,
      highlightLines,
      buildArrowsForPly,
      handleAskAboutTurningPoint,
      requestChatOpen,
    ]
  );

  // Visibility (panel B1, binding): gameId present OR reviewGame — NOT
  // gated on coachOn (the pull-based chat is always reachable; coachOn only
  // suppresses unsolicited verdicts). reviewGame takes priority over a
  // finished live gameId, same precedence as activeReviewMoves above.
  const chatGameId = reviewGame ? reviewGame.id : gameId;
  // Fix (task-reviewer, post task-3 approval): this is now a `hidden` flag
  // fed to an always-mounted CoachChat, not a mount/unmount gate — an
  // unmount was silently wiping the conversation on every rewind (state
  // must reset ONLY on a gameId change, per the brief). Hidden whenever
  // there's no game to talk about yet, or mid-cinematic (cinematicActive —
  // the end-game takedown replay, whose full-screen chat overlay would
  // otherwise cover it).
  //
  // Increment 3.95, Task 7: the rewindPly!=null gate that used to sit here
  // too is gone — that condition only ever fires while looking at a
  // replayed turning point (rewindPly is exclusively set by a debrief
  // "replay" click and cleared on every game switch/back-to-end; it's never
  // true during a live in-progress turn), which is exactly the moment a
  // "ask about this" click on a turning-point card needs the drawer to be
  // reachable. The cinematic gate is the one that still has to hide it.
  const chatHidden = chatGameId == null || cinematicActive;

  const handleRewind = useCallback(
    (ply: number) => {
      if (!activeReviewMoves) return;
      setFen(fenAtPly(activeReviewMoves, ply));
      setResyncTick((t) => t + 1);
      setRewindPly(ply);
      // Increment 3.91 (Task 4): a turning-point card's replay threads its
      // TurningLine into the board's arrows/highlightSquares.
      // Increment 3.95 (Task 4, Part 2): every rewind gets at least the
      // played (cyan) arrow now, even with no matching TurningLine (a plain
      // bullet-section replay) or one whose own playedFromTo never
      // resolved — see buildArrowsForPly's own fallback above.
      const line = turningLines.find((l) => l.ply === ply);
      // F4 (owner ruling 2026-08-03): "replay" intent — an opponent-ply
      // card's replay frames the inaccuracy itself (sole magenta arrow),
      // never her punish; a her-ply replay is byte-unchanged. The lookup
      // above stays keyed by the point's OWN ply — the investigation's
      // `point.ply + 1` was ruled backwards AND would make this find() miss.
      const arrows = buildArrowsForPly(line, ply, "replay");
      setReviewArrows(arrows);
      setReviewHighlights(arrowsToHighlights(arrows));
      // Reviewer fix (Task 7 follow-up, tidiness): replaying ANY card (the
      // same one again, or a different one) is a new "moment" — see
      // handlePendingStart's comment above; buildChatContext's
      // reconcileChatFocus guard is what actually prevents a mismatched
      // turningPointFocus from leaking (see there), this just means the
      // drawer isn't still holding a soon-to-be-invalidated one around.
      setChatFocus({});
    },
    [activeReviewMoves, turningLines, buildArrowsForPly]
  );

  const handleBackToEnd = useCallback(() => {
    if (!activeReviewMoves) return;
    setFen(fenAtPly(activeReviewMoves, activeReviewMoves.length));
    setResyncTick((t) => t + 1);
    setRewindPly(null);
    setReviewArrows([]);
    setReviewHighlights([]);
  }, [activeReviewMoves]);

  // Increment 3.91 (Task 6): keeps the board's `fen` (and its hard-remount
  // resyncTick) in lockstep with the explore session's own fen — the single
  // source of truth for the position is `explore.fen` while a session is
  // active, mirrored out here rather than set redundantly at every call site
  // that changes it (openExplore/handleExploreMove/the engine-reply
  // handler). Fires only on a genuine explore state transition (each
  // reducer call returns a fresh object; a rejected illegal move returns the
  // SAME object back, so no-op moves never remount the board). Skips
  // entirely once explore goes back to null — exitExplore restores the
  // pre-explore fen itself, below.
  useEffect(() => {
    if (!explore) return;
    setFen(explore.fen);
    setResyncTick((t) => t + 1);
  }, [explore]);

  // Seeds a sandbox at the player-to-move position and hands the board over
  // to it live. Task 3 (increment 3.95) fix: `ply` is the turning point's own
  // ply — her mistake move itself — so fenAtPly(ply) directly is the
  // position AFTER she played it (opponent to move, her white pieces
  // untouchable). exploreSeedPly rounds that down to the position where she
  // was actually on move, matching Task 2's getTurningLines seed exactly.
  // The guiding arrow is looked up by the ORIGINAL ply (turning lines are
  // keyed by the mistake's own ply, same convention as handleRewind above).
  // Snapshotting `fen` first is what lets exitExplore return to exactly
  // where the static debrief was, whether that was the final position or a
  // rewound one.
  const openExplore = useCallback(
    (ply: number) => {
      if (!activeReviewMoves) return;
      preExploreFenRef.current = fen;
      exploreTokenRef.current += 1; // supersede any still-in-flight reply from a prior session
      exploreBusyRef.current = false;
      setExploreThinking(false);
      setExplore(startExplore(fenAtPly(activeReviewMoves, exploreSeedPly(ply))));
      setExploreArrow(guidingArrow(ply, turningLines));
      setExploreSourcePly(ply);
    },
    [activeReviewMoves, fen, turningLines]
  );

  // Tears the session down and hands the board back to the static debrief —
  // nothing to persist, nothing to undo server-side, just discard the
  // sandbox state and restore the fen it started from.
  const exitExplore = useCallback(() => {
    exploreTokenRef.current += 1; // any reply that lands after this is stale
    exploreBusyRef.current = false;
    setExploreThinking(false);
    setExplore(null);
    setExploreSourcePly(null);
    if (preExploreFenRef.current != null) {
      setFen(preExploreFenRef.current);
      setResyncTick((t) => t + 1);
    }
  }, []);

  // The explore-specific onMove Board is given while a session is active —
  // parallels handleBoardMove's role for the real game, but validates
  // locally (applyPlayerMove, same chess.js-clone-and-try pattern
  // handlePendingStart uses for the pending preview) and never touches
  // gameId, mirrorRef, sendMove, or judgeMove. On a legal move that isn't
  // itself game-over, fires exploreReply at the game's own elo and applies
  // whatever it comes back with — the ONLY network call this whole mode
  // makes, and it persists nothing (server/game/manager.ts's exploreReply).
  const handleExploreMove = useCallback(
    (from: string, to: string) => {
      if (!explore || exploreBusyRef.current) return;
      const { next, ok } = applyPlayerMove(explore, from, to);
      if (!ok) return;
      setExplore(next);
      // Task 3 (increment 3.95): the guiding arrow is a "do this" prompt for
      // the position she's retrying, not a persistent annotation — it's
      // stale the instant her first move in the sandbox lands.
      setExploreArrow(null);
      if (!next.awaitingReply) return; // move ended the sandbox position — nothing to reply to
      exploreBusyRef.current = true;
      setExploreThinking(true);
      const token = exploreTokenRef.current;
      const elo = exploreElo(reviewGame?.opponent ?? null, opponentElo);
      exploreReply(next.fen, elo)
        .then((res) => {
          if (exploreTokenRef.current !== token) return; // superseded — drop it
          if (!res.ok || !res.reply) return;
          setExplore((cur) => (cur ? applyEngineReply(cur, res.reply!) : cur));
        })
        .catch(() => undefined)
        .finally(() => {
          if (exploreTokenRef.current === token) {
            exploreBusyRef.current = false;
            setExploreThinking(false);
          }
        });
    },
    [explore, reviewGame, opponentElo]
  );

  // "file it away" saved-games menu. Reachable only from the pregame panel
  // and the live debrief (see render below) — both contexts already
  // guarantee no game is live-and-unfinished, so no extra guard is needed
  // here to satisfy "entering review while a game is live prompts nothing."
  const openPastGames = useCallback(() => {
    setPastGamesOpen(true);
    setPastGames(null);
    // Wave 3.5, item 2: a stale error from a PREVIOUS drawer session must
    // never survive into this one.
    setPastGamesDeleteError(null);
    fetchGames()
      .then((r) => setPastGames(r.games))
      .catch(() => setPastGames([]));
  }, []);

  const closePastGames = useCallback(() => setPastGamesOpen(false), []);

  // Entering REVIEW MODE: snapshot the live fen so "back to play" can
  // restore it exactly, then snap the board to the reviewed game's final
  // position via the same fen/resyncTick seam handleRewind uses.
  const selectPastGame = useCallback(
    async (g: GameListEntry) => {
      const summary = await fetchSummary(g.id);
      preReviewFenRef.current = fen;
      setReviewGame({ id: g.id, opponent: g.opponent, result: g.result, summary });
      setFen(fenAtPly(summary.moves, summary.moves.length));
      setResyncTick((t) => t + 1);
      setRewindPly(null);
      setReviewArrows([]);
      setReviewHighlights([]);
      setTurningLines([]);
      setHighlightLines([]);
      setPastGamesOpen(false);
      // Increment 3.95 (Task 7): a newly-opened past game must never carry
      // the last one's "ask about this" focus.
      setChatFocus({});
      // Increment 3.91 (Task 6): switching past games while a sandbox from
      // the PREVIOUS one is open would otherwise leave it live over a fen
      // that no longer belongs to it — drop it, no restore needed since the
      // fen above already wins.
      exploreTokenRef.current += 1;
      exploreBusyRef.current = false;
      setExploreThinking(false);
      setExplore(null);
      setExploreSourcePly(null);
    },
    [fen]
  );

  const backToPlay = useCallback(() => {
    if (preReviewFenRef.current != null) {
      setFen(preReviewFenRef.current);
      setResyncTick((t) => t + 1);
    }
    setReviewGame(null);
    setRewindPly(null);
    setReviewArrows([]);
    setReviewHighlights([]);
    setTurningLines([]);
    setHighlightLines([]);
    // Increment 3.95 (Task 7): leaving review mode drops its focus too.
    setChatFocus({});
    // Increment 3.91 (Task 6): same reasoning as selectPastGame above — an
    // open sandbox must not survive leaving review mode.
    exploreTokenRef.current += 1;
    exploreBusyRef.current = false;
    setExploreThinking(false);
    setExplore(null);
    setExploreSourcePly(null);
  }, []);

  // Owner feedback 2026-07-17: the pregame elo picker was only reappearing
  // on a hard refresh, not after finishing a game. Reversing the 2.5
  // decision (rematch reused the last elo silently) — "new game" now drops
  // gameId back to null so the `sessionId && !gameId` pregame gate re-shows
  // the panel, preselected with the last elo (state + localStorage untouched
  // here on purpose). Guarded by the same replayingRef the takedown
  // cinematic uses, so a click mid-replay is a no-op rather than yanking
  // the board out from under an in-flight animation.
  const handleNewGame = useCallback(() => {
    if (replayingRef.current) return;
    resetGameState();
    setGameId(null);
    // Resume self-arm (Wave 3.5): dropping back to the pregame picker must
    // disarm the URL -- a reload here should NOT resume the game she just left.
    window.history.replaceState(null, "", withGameParam(window.location.pathname, window.location.search, null));
    mirrorRef.current = new Chess();
    setFen(mirrorRef.current.fen());
    setStatus("");
    // Increment 3.91 (Task 6): a sandbox from the game that just ended must
    // not survive into the fresh pregame state.
    exploreTokenRef.current += 1;
    exploreBusyRef.current = false;
    setExploreThinking(false);
    setExplore(null);
    setExploreSourcePly(null);
  }, [resetGameState]);

  // Wave 3.5, item 2 (owner ask, 2026-08-01): real per-game deletion, fired
  // only on the drawer's own confirmed (second-click) delete. Optimistic --
  // the row disappears immediately, restored on failure since there's no
  // toast machinery to report a delayed error against.
  //
  // Two "this game is currently on screen" surfaces to close, both checked
  // against the DELETED id (the parameter is named `deletedId`, not
  // `gameId`, specifically so it never shadows this component's own `gameId`
  // state -- that shadowing bug is exactly what the review fix below caught):
  //   - REVIEW MODE (reviewGame): closes via the existing backToPlay(), same
  //     as its own explicit button -- deleting the game you're looking at is
  //     just another way of leaving it.
  //   - Wave 3.5 fix (Important, review 2026-08-01): the LIVE just-finished
  //     debrief is ALSO a "review/debrief view" PastGamesButton renders on
  //     (GameEndPanel's debrief slot, wired below) -- so she can finish a
  //     game, open past games from THAT game's own debrief, and delete it.
  //     shouldClearLiveDebrief (deleteArm.ts) is the pure predicate for
  //     "is this the live debrief's own game"; when true this calls
  //     handleNewGame() -- the EXACT same reset path the "new game" button
  //     already uses (resetGameState + dropping gameId to null so the
  //     pregame elo picker re-shows) -- rather than hand-rolling a partial
  //     reset here.
  const deletePastGame = useCallback(
    async (deletedId: number) => {
      setPastGamesDeleteError(null);
      const previous = pastGames;
      setPastGames((cur) => (cur ? cur.filter((g) => g.id !== deletedId) : cur));
      try {
        const res = await deleteGame(deletedId);
        if (!res.ok) {
          setPastGames(previous);
          setPastGamesDeleteError("could not delete that game. try again.");
          return;
        }
        // Minor B: only tear down the on-screen view AFTER the delete actually
        // succeeded -- a failed delete must never yank the screen (the row
        // restore above is all a failure does). The list update stays
        // optimistic; the view teardown is not.
        if (reviewGame && reviewGame.id === deletedId) backToPlay();
        if (shouldClearLiveDebrief(!!gameOver, gameId, deletedId)) handleNewGame();
      } catch {
        setPastGames(previous);
        setPastGamesDeleteError("could not delete that game. try again.");
      }
    },
    [pastGames, reviewGame, backToPlay, gameOver, gameId, handleNewGame]
  );

  // "replay the takedown" (Wave D) — owner feedback, verbatim: "play the
  // last three moves or four moves without delays in between but not too
  // fast... that way I just see the act of the Queen checkmating the King
  // but I get to see what was my lead up." Reconstructs the position 4
  // plies before the end (replayPlan caps at whatever the game actually
  // has) from the client mirror's own full history — the mirror is never
  // touched after game-over, so it's still an accurate source of truth —
  // and plays that lead-up back-to-back into the existing takedown glide+
  // shatter finale via Board's replayCinematic. On completion, fires the
  // bigger replay celebration (Task D-2) instead of a second first-time one.
  //
  // Guarded against re-entrancy the same way as before, but the guard now
  // spans the WHOLE cinematic (the await covers the entire multi-move
  // sequence), not just a single shatter — a double-click mid-cinematic is
  // a no-op, and Board's own animatingRef additionally keeps board clicks
  // gated for that same whole span.
  const handleReplayTakedown = useCallback(async () => {
    if (!takedownMove || replayingRef.current) return;
    replayingRef.current = true;
    setCinematicActive(true);
    try {
      const history = mirrorRef.current.history({ verbose: true });
      const plan = replayPlan(history, 4);
      const moves = plan.moves.map(describeMove);
      await boardRef.current?.replayCinematic(plan.startFen, moves, takedownMove);
      if (gameOver) celebrate(gameOver.result, { big: true });
    } finally {
      replayingRef.current = false;
      setCinematicActive(false);
    }
  }, [takedownMove, gameOver, celebrate]);

  const togglesDisabled = uiBusy || pending !== null;

  // Highlight-a-move (Task 3): optimistic flip, persisted immediately
  // (moves.highlighted) so the highlight survives a reload — it is db
  // state, not React state. On a failed write the flip reverts: the db is
  // the debrief's source of truth, and a pill that lies about what was
  // recorded is worse than a bounced tap.
  const handleHighlightToggle = useCallback(
    (ply: number, on: boolean) => {
      setLiveMoves((prev) => setHighlight(prev, ply, on));
      if (gameId != null) {
        highlightMove(gameId, ply, on).catch(() => {
          setLiveMoves((prev) => setHighlight(prev, ply, !on));
        });
      }
    },
    [gameId]
  );

  // Wave B: turn/state info lives entirely in the two player bars now.
  // uiBusy is true for the whole span from "player's move confirmed" to
  // "reply (or failure) resolved" — that's mallow's side of the board being
  // "in play"; anything else is the player's side. mallowThinking narrows
  // the mallow-active window to just the network round-trip (see handleMove).
  // Increment 3.95 (Task 10, capture-tray fold-in): review mode has no
  // incrementally-tracked `captured` state the way a live in-progress game
  // does — loading a past game (or scrubbing an already-finished one) never
  // replays its moves through handleMove's optimistic pushes, so the trays
  // used to just sit wherever they were left before "past games" was
  // opened, regardless of the rewound ply (the known v1 gap this task folds
  // in). Whenever a debrief is actually showing (activeReviewMoves
  // non-null — either a reviewed past game or a just-finished live game),
  // the trays are recomputed purely for whatever ply is on screen right now
  // (rewindPly, or the full game once back at "the end"/never rewound) via
  // capturesAtPly, the fenAtPly counterpart for captures. Mid-game live play
  // (activeReviewMoves null) is untouched: `captured` keeps being the
  // incrementally-pushed/rolled-back state handleMove already maintains.
  const displayedCaptured = activeReviewMoves
    ? capturesAtPly(activeReviewMoves, rewindPly ?? activeReviewMoves.length)
    : captured;
  const material = materialDiff(displayedCaptured);
  const moveNumber = Number(fen.split(" ")[5]) || 1;
  const mallowActive = !!gameId && !gameOver && uiBusy;
  const youActive = !!gameId && !gameOver && !uiBusy;
  const mallowChip = mallowActive ? (mallowThinking ? "thinking..." : "mallow's move") : null;
  const youChip = youActive ? (pending ? "deciding..." : "your move") : null;

  // V5, task 4: winning-resign edge case — read-only use of the existing
  // material lead. material.leader === "you" means the value is the
  // player's own lead (see materialLead={...leader === "you" ? ...} on the
  // player's own bar below), so >= 3 here means the player is ahead by 3+.
  const winningResign =
    endGameOutcome === "resign" && material.leader === "you" && material.points >= 3;

  // Wave C, task C-A: the button's copy, arm state included — never a
  // silent relabel, the armed text always states the outcome a second
  // click would execute. V5, task 4 adds the winning-resign override.
  const endGameLabel = winningResign
    ? "you're ahead. really hand it to mallow?"
    : endGameOutcome === "win"
      ? "call it: you're winning. take the win?"
      : endGameOutcome === "draw"
        ? "call it a draw?"
        : endGameOutcome === "resign"
          ? "call it: mallow has this. resign?"
          : "end the game?";

  // Wave 2: the full-reveal board highlight (right-P3 / wrong-P4) -- shown
  // only at the last press of the decided branch, derived from the fetched
  // hintFacts. The earlier presses reveal the WHY without pointing at a
  // square to play.
  const hintReveal =
    hintBranch != null && hintPress >= maxPress(hintBranch) && hintFacts
      ? hintRevealSquares(hintFacts.bestUci)
      : null;

  // Wave 2: the threat highlight remaps to right-P2 (the "what the opponent
  // is doing" rung) -- only while sitting exactly there, with a real threat
  // and a pending move to anchor herToSquare. The wrong branch never paints
  // the opponent's threat (its rungs are about HER best piece).
  // Minor A: when conversionCopy is present it REPLACES the threat ladder copy
  // at right-P2, so the threat rings would tell a different story than the
  // words -- suppress them so board and copy stay in one voice.
  const threatReveal =
    hintBranch === "right" && hintPress === 2 && verdict?.threat && !verdict.conversionCopy && pending
      ? threatRevealSquares(verdict.threat, pending.to)
      : null;

  // The pending move's own ply -- mirrorRef is untouched while pending, so
  // history().length + 1 is the position the ladder is scoped to. Feeds both
  // the pool-rotation seed and the hintFocus position identity.
  const hintPendingPly = pending ? mirrorRef.current.history().length + 1 : 0;

  // Everything rungCopy needs for the current pending move. herPieceKind
  // comes off the live mirror (free, no network) -- the piece she just moved
  // is always mirrorRef's occupant at pending.from since pending never
  // touches the mirror. gameId/pendingPly seed the pool rotation;
  // conversionCopy/mateAfter feed the right-P2 override + ladder rung 1.
  const hintCtx: HintCopyCtx | null = pending
    ? {
        herPieceKind: mirrorRef.current.get(pending.from as Square)?.type ?? "piece",
        herToSquare: pending.to,
        threat: verdict?.threat,
        bestFacts: hintFacts ?? undefined,
        fen,
        gameId: gameId ?? 0,
        pendingPly: hintPendingPly,
        conversionCopy: verdict?.conversionCopy,
        mateAfter: verdict?.mateAfter,
      }
    : null;

  // Increment 3.95, Task 7: the exact rendered hint text at the current rung
  // -- computed once here so both the visible <span> below and the "ask about
  // this" click use the identical string (never a separate re-derivation).
  const renderedHintCopy =
    hintPress > 0 && hintBranch && hintCtx ? rungCopy(hintBranch, hintPress, hintCtx) : null;

  // Increment 3.95, Task 7: the hint ladder's own "ask about this" -- opens
  // the always-mounted CoachChat scoped to the hint text the player is
  // actually looking at. A no-op before any rung has rendered anything
  // (branch undecided at press 0, or rungCopy still null mid-fetch).
  const handleAskAboutHint = () => {
    if (!hintBranch || !renderedHintCopy) return;
    // Task 4 (R1b, fact-gap round): the on-screen HintFacts, when the deep
    // fetch has landed. `fen` here is the same before-position hintCtx uses
    // (matching what computeHint evaluated server-side) -- pv is UCI on the
    // wire, converted to SAN here via the same replay discipline manager.ts's
    // pvLine uses. threat is the right-P2 highlight's own ThreatFacts.
    const extra = hintFacts
      ? {
          bestSan: hintFacts.bestSan,
          pvSans: pvUciToSan(fen, hintFacts.pv),
          trade: hintFacts.trade,
          recommendation: hintFacts.recommendation,
          threat: verdict?.threat,
        }
      : undefined;
    const focus = hintFocusContext(hintBranch, hintPress, renderedHintCopy, hintPendingPly, extra);
    if (!focus) return;
    setChatFocus({ hintFocus: focus });
    requestChatOpen();
  };

  return (
    <div className={"game-page" + (gameOver || reviewGame ? " postgame" : "")}>
      {fallback && <div className="fallback-banner">fallback opponents (lc0 unavailable)</div>}
      {sessionGone && (
        <div className="session-gone-banner">
          <span>the server restarted while you were away, so this session closed.</span>
          <button type="button" onClick={() => window.location.reload()}>
            tap here to pick up fresh
          </button>
        </div>
      )}
      <header className="header-band">
        <div className="header-lockup">
          <span className="wm" id="wordmark">
            <span className="wm-layer wm-cyan" aria-hidden="true">GIRL CHESS</span>
            <span className="wm-layer wm-mag" aria-hidden="true">GIRL CHESS</span>
            <span className="wm-layer wm-shadow" aria-hidden="true">GIRL CHESS</span>
            <span className="wm-base">
              GIRL CHES
              <span className="wm-s">
                <span className="wm-s-cyan" aria-hidden="true">S</span>
                <span className="wm-s-mag" aria-hidden="true">S</span>
                <span className="wm-s-top">S</span>
                <span className="wm-s-bottom" aria-hidden="true">S</span>
              </span>
            </span>
          </span>
          <p className="tagline">
            <svg className="px-heart" width="7" height="6" viewBox="0 0 7 6" aria-hidden="true">
              <path
                fill="#FF3DA6"
                d="M1 0h1v1h1v1h1V1h1V0h1v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"
              />
            </svg>
            tutor with benefits
          </p>
        </div>
        <div className="header-actions" ref={settingsRef}>
          <button
            type="button"
            className={`coach-pill${coachOn ? " coach-pill-on" : " coach-pill-off"}`}
            onClick={toggleCoach}
            disabled={togglesDisabled}
            aria-pressed={coachOn}
          >
            {coachOn ? "coach: on" : "coach: off"}
          </button>
          <button
            type="button"
            className="settings-gear"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-label="move settings"
          >
            <svg className="gear-svg" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <g stroke="#7A6BB5" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <line x1="11" y1="3.5" x2="11" y2="1.8" />
                <line x1="18.5" y1="11" x2="20.2" y2="11" />
                <line x1="16.3" y1="16.3" x2="17.5" y2="17.5" />
                <line x1="11" y1="18.5" x2="11" y2="20.2" />
                <line x1="5.7" y1="16.3" x2="4.5" y2="17.5" />
                <line x1="3.5" y1="11" x2="1.8" y2="11" />
                <line x1="5.7" y1="5.7" x2="4.5" y2="4.5" />
                <circle cx="11" cy="11" r="6" />
                <circle cx="11" cy="11" r="2" />
              </g>
              <line
                x1="17.4"
                y1="7.3"
                x2="18.9"
                y2="6.4"
                stroke="#23E5FF"
                strokeWidth="2.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {settingsOpen && (
            <div className="settings-popover pop-in">
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={confirmOn}
                  disabled={togglesDisabled}
                  onChange={(e) => setConfirmPref(e.target.checked)}
                />
                confirm before playing
              </label>
              <div className="settings-divider" aria-hidden="true"></div>
              <span className="settings-section-head">judge strictness</span>
              <div className="settings-radio-group" role="radiogroup" aria-label="judge strictness">
                {JUDGE_STRICTNESS_OPTIONS.map((opt) => (
                  <label key={opt.value} className="settings-switch">
                    <input
                      type="radio"
                      name="judge-strictness"
                      checked={judgeStrictness === opt.value}
                      disabled={togglesDisabled}
                      onChange={() => setJudgeStrictnessPref(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="settings-divider" aria-hidden="true"></div>
              <span className="settings-section-head">coach</span>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={coachOn}
                  disabled={togglesDisabled}
                  onChange={(e) => setCoachPref(e.target.checked)}
                />
                coach judges my moves
              </label>
              <label className="settings-switch sw-cyan">
                <input
                  type="checkbox"
                  checked={coachHints}
                  disabled={togglesDisabled}
                  onChange={(e) => setCoachHintsPref(e.target.checked)}
                />
                <svg className="np-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8z"
                    fill="#23E5FF"
                    stroke="#1A7A93"
                    strokeWidth="1"
                    strokeLinejoin="miter"
                  />
                </svg>
                coach gives hints
              </label>
              <div className="settings-divider" aria-hidden="true"></div>
              <span className="settings-section-head">coach voice</span>
              <div className="settings-radio-group" role="radiogroup" aria-label="coach voice">
                {COACH_BACKEND_OPTIONS.map((opt) => (
                  <label key={opt.value} className="settings-switch">
                    <input
                      type="radio"
                      name="coach-backend"
                      checked={coachBackend === opt.value}
                      disabled={togglesDisabled}
                      onChange={() => setCoachBackendPref(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>
      <div className="board-stack">
        <PlayerBar
          seat="mallow"
          captured={displayedCaptured.w}
          capturedColor="w"
          materialLead={material.leader === "mallow" ? material.points : null}
          active={mallowActive}
          chip={mallowChip}
          elo={opponentElo}
        />
        <div className={"mallow-stripe " + (mallowThinking ? "ms-thinking" : "ms-dormant")} aria-hidden="true"></div>
        <Board
          key={`${gameId ?? "loading"}-${resyncTick}`}
          ref={boardRef}
          fen={fen}
          // Increment 3.91 (Task 6): explore mode swaps the whole pending-
          // move seam out for its own direct onMove — pending/judge/hint
          // overlays and the reviewArrows/reviewHighlights debrief furniture
          // have no meaning once the board is a live sandbox. Task 3
          // (increment 3.95): arrows aren't forced off during explore any
          // more, though — see the `arrows` prop below, which swaps in the
          // single exploreArrow guiding-move prompt instead.
          onMove={explore ? handleExploreMove : handleBoardMove}
          checkSquare={check.square}
          checkmate={check.mate}
          pending={explore ? null : pending}
          onRetarget={handleRetargetPending}
          onCancelPending={handleRetractPending}
          onConfirmPending={handleConfirmPending}
          onInputHint={handleInputHint}
          lastMove={lastMove}
          hintReveal={hintReveal}
          hintGlitchTick={hintGlitchTick}
          threatReveal={threatReveal}
          arrows={explore ? (exploreArrow ? [exploreArrow] : []) : reviewArrows}
          highlightSquares={explore ? [] : reviewHighlights}
        />
        <PlayerBar
          seat="you"
          captured={displayedCaptured.b}
          capturedColor="b"
          materialLead={material.leader === "you" ? material.points : null}
          active={youActive}
          chip={youChip}
          moveNumber={moveNumber}
          elo={PLAYER_ELO}
          // Highlight-a-move (Task 3): live play only — in review mode
          // liveMoves belongs to the live game, not the reviewed one, and
          // post-game the debrief's study ledger is the highlight surface
          // ("highlight from the recap" is explicitly a later, additive
          // feature). Disabled by the same togglesDisabled rule as every
          // other toggle, so it can never sit active beside a pending
          // "confirm g4, tap it again" — which this control never touches.
          pocket={
            gameOver == null && !reviewGame ? (
              <HighlightPocket
                pairs={pairWindow(liveMoves, 3)}
                disabled={togglesDisabled}
                onToggle={handleHighlightToggle}
              />
            ) : null
          }
        />
      </div>
      {/* Fixed-height reserve so the judge indicator and controls appearing
          or disappearing never nudges the board — both slots always occupy
          their space; only their contents come and go. */}
      <div className="action-slot">
        <div className="action-slot-judge">
          {pending && judgePhase && (
            <div className="judge-indicator" role="status" aria-live="polite">
              {judgePhase === "judged" ? (
                <span>
                  judged <span className="judge-check">✓</span>
                  {/* C2: the badge for the "judged" slot C1 built. silent stays
                      the plain check above (no badge) — cadence (JUDGE_MIN_MS)
                      is identical for every tier, only what appears differs. */}
                  {verdict?.tier === "nudge" && (
                    <span className="judge-badge judge-badge-nudge">hm, you sure?</span>
                  )}
                  {verdict?.tier === "warning" && (
                    <span className="judge-badge judge-badge-warning">careful. this one hurts.</span>
                  )}
                  {/* Increment 2.7 (why-hints): deterministic hint
                      escalation — only when the judge actually derived a
                      threat to offer (an eval failure just means this never
                      renders; confirm/retract are never blocked on it). */}
                  {verdict?.threat && (verdict.tier === "nudge" || verdict.tier === "warning") && (
                    <span className="hint-block">
                      {renderedHintCopy && <span className="hint-copy">{renderedHintCopy}</span>}
                      {/* Increment 3.95, Task 7: "ask about this" — only once
                          there's an actual rendered hint to ask about. */}
                      {renderedHintCopy && (
                        <button
                          type="button"
                          className="small hint-ask-btn"
                          onClick={handleAskAboutHint}
                        >
                          ask about this
                        </button>
                      )}
                      {!(hintBranch != null && hintPress >= maxPress(hintBranch)) && (
                        <button
                          type="button"
                          className="hint-affordance"
                          onClick={handleHintClick}
                          disabled={hintFetching}
                        >
                          {hintFetching ? "thinking..." : hintPress === 0 ? "help?" : "more?"}
                        </button>
                      )}
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  judging
                  <span className="judge-dots" aria-hidden="true">
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                  </span>
                </span>
              )}
            </div>
          )}
          {/* judge-post (coach only, confirm off): no pending step exists to
              hang a "judging…"/"judged" indicator off of, so the badge for the
              move that just played renders here instead, as soon as /judge
              resolves — see handleMoveWithPostJudge. */}
          {!pending && postVerdict && (
            <div className="judge-indicator post-judge" role="status" aria-live="polite">
              {/* game-169 minors fix: the checkmark renders unconditionally
                  across tiers here, mirroring guardian mode's unconditional
                  "judged ✓" above -- it used to be gated on tier==="silent",
                  which withheld it from nudge/warning verdicts. */}
              <span className="judge-check">✓</span>
              {postVerdict.tier === "nudge" && (
                <span className="judge-badge judge-badge-nudge">hm, you sure?</span>
              )}
              {postVerdict.tier === "warning" && (
                <span className="judge-badge judge-badge-warning">careful. this one hurts.</span>
              )}
            </div>
          )}
        </div>
        {!gameOver && (
          <div className="action-slot-controls">
            {pending ? (
              <div className="controls game-controls pending-controls">
                <button className="small confirm-pending" onClick={handleConfirmPending}>
                  play it
                </button>
                <button className="small" onClick={handleRetractPending}>
                  take it back
                </button>
              </div>
            ) : sessionId && !gameId ? (
              <div className="controls game-controls pregame-panel">
                <label className="pregame-label" htmlFor="pregame-elo">
                  mallow plays at
                </label>
                <select
                  id="pregame-elo"
                  className="pregame-select"
                  value={opponentElo}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setOpponentElo(v);
                    localStorage.setItem(OPPONENT_ELO_KEY, String(v));
                  }}
                >
                  {OPPONENT_ELOS.map((elo) => (
                    <option key={elo} value={elo}>
                      {elo}
                    </option>
                  ))}
                </select>
                <button className="small" onClick={() => startGame(sessionId, opponentElo)}>
                  start game
                </button>
                <PastGamesButton onClick={openPastGames} />
              </div>
            ) : (
              <div className="controls game-controls">
                {/* Wave C, task C-A: one button replaces separate resign /
                    offer-draw. First click previews the engine's own call
                    on the position; the armed second click always shows
                    (never silently relabels) the outcome it's about to
                    execute. */}
                <button
                  className={
                    "small " +
                    (endGameOutcome === "resign"
                      ? "egc-resign"
                      : endGameOutcome === "draw"
                        ? "egc-draw"
                        : endGameOutcome === "win"
                          ? "egc-win"
                          : "egc-idle") +
                    (winningResign ? " egc-shake" : "")
                  }
                  disabled={!gameId}
                  onClick={handleEndGameClick}
                >
                  {endGameLabel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="coach-hint-band">
        {coachHints && (coachText != null || coachLoading) && (
          <div className="coach-hint-slot">
            <span className="coach-slot-copy">
              {coachText ?? "cookie is looking…"}
            </span>
            {coachText != null && coachTraceId != null && <ThumbRating traceId={coachTraceId} />}
          </div>
        )}
      </div>
      {/* chat-in-corner, wave 3 (B1/B6): the chat lives in the coach's own
          region, directly under the hint band -- in BOTH live and review
          modes, independent of the coachHints toggle (the band above stays
          mounted either way; only its slot is gated). Still always mounted
          with `hidden` as the visibility flag (same precedent as
          PastGamesDrawer's `open` prop), so its conversation survives a
          rewind or the takedown cinematic instead of being wiped and
          remounted blank. At >=1200px CSS grid placement moves this same
          node to the right rail (D1) -- one mount site, never two. */}
      <CoachChat
        gameId={chatGameId}
        mode={reviewGame ? "review" : "live"}
        buildContext={buildChatContext}
        hidden={chatHidden}
        backendPref={coachBackend}
        openSignal={chatOpenSignal}
        hintFocus={chatFocus.hintFocus}
        turningPointFocus={chatFocus.turningPointFocus}
      />
      <p className="status-line">{inputHint ?? status}</p>
      {gameOver && (
        <GameEndPanel
          gameOver={gameOver}
          takedownMove={takedownMove}
          onReplayTakedown={handleReplayTakedown}
          onNewGame={handleNewGame}
          debrief={
            // Increment 3c: never render the live game's own debrief while
            // REVIEW MODE (a past game) is active — the review debrief below
            // takes over the same visual cluster instead.
            !reviewGame && liveSummary ? (
              <DebriefPage
                turningPoints={liveSummary.turningPoints}
                classifications={liveSummary.classifications}
                turningLines={turningLines}
                highlightLines={highlightLines}
                gameSans={liveSummary.moves}
                totalPlies={liveSummary.moves.length}
                result={gameOver.result}
                rewindPly={rewindPly}
                onRewind={handleRewind}
                onBackToEnd={handleBackToEnd}
                onOpenPastGames={openPastGames}
                exploring={
                  explore ? { thinking: exploreThinking, over: explore.over, ply: exploreSourcePly } : null
                }
                onTryLine={openExplore}
                onExitExplore={exitExplore}
                onAskAboutTurningPoint={handleAskAboutTurningPoint}
                onAskAboutPly={handleAskAboutPly}
              />
            ) : null
          }
        />
      )}
      {reviewGame && (
        <DebriefPage
          turningPoints={reviewGame.summary.turningPoints}
          classifications={reviewGame.summary.classifications}
          turningLines={turningLines}
          highlightLines={highlightLines}
          gameSans={reviewGame.summary.moves}
          totalPlies={reviewGame.summary.moves.length}
          result={reviewGame.result}
          rewindPly={rewindPly}
          onRewind={handleRewind}
          onBackToEnd={handleBackToEnd}
          onOpenPastGames={openPastGames}
          reviewing={{ opponent: reviewGame.opponent, result: reviewGame.result }}
          onBackToPlay={backToPlay}
          exploring={explore ? { thinking: exploreThinking, over: explore.over, ply: exploreSourcePly } : null}
          onTryLine={openExplore}
          onExitExplore={exitExplore}
          onAskAboutTurningPoint={handleAskAboutTurningPoint}
          onAskAboutPly={handleAskAboutPly}
        />
      )}
      <PastGamesDrawer
        open={pastGamesOpen}
        games={pastGames}
        onSelect={selectPastGame}
        onClose={closePastGames}
        onDelete={deletePastGame}
        deleteError={pastGamesDeleteError}
      />
    </div>
  );
}
