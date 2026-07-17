import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import {
  newSession,
  newGame,
  sendMove,
  modeTimer,
  adjudicate,
  judgeMove,
  logHint,
  type MoveResponse,
  type GameOverInfo,
  type Verdict,
} from "./api";
import { describeMove, type MoveRender } from "./describeMove";
import { victimKind, materialDiff, type CapturedBySide } from "./captures";
import { kingInCheckSquare } from "./checkState";
import { reconcile } from "./reconcile";
import { findTakedownPiece, type Takedown } from "./terminal";
import { GameEndPanel } from "./GameEndPanel";
import { resolveMoveFlow, isOverrideConfirm } from "./moveFlow";
import { nextHintLevel, hintCopy, hintRevealSquares, type HintLevel } from "./hintFlow";
import { PlayerBar } from "./PlayerBar";

type Captured = CapturedBySide;

const OPPONENT_ELO = 1100;

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

export function GamePage() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [fen, setFen] = useState(() => new Chess().fen());
  const [fallback, setFallback] = useState(false);
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
  // A5: transient status-line hint for a click that was meaningful but
  // couldn't do what it looked like (currently: "can't castle right now").
  const [inputHint, setInputHint] = useState<string | null>(null);
  const [judgePhase, setJudgePhase] = useState<"judging" | "judged" | null>(null);
  // C2: the verdict itself, once judged — drives the badge rendered into
  // C1's "judged ✓" slot. null while judging, and for tier "silent" (no
  // badge, just the plain "judged ✓" C1 already had).
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // Wave C, task C-B: deterministic hint escalation ladder for the CURRENT
  // pending move's judged verdict. 0 = nothing revealed (only the "help?"
  // affordance shows for nudge/warning). Resets to 0 on retarget/cancel/
  // confirm/new pending — see handlePendingStart/handleConfirmPending/
  // handleRetractPending below.
  const [hintLevel, setHintLevel] = useState<HintLevel>(0);
  // C3: the two independent switches. coachOn = "coach judges my moves"
  // (the pill); confirmOn = "confirm before playing". Crossed via
  // resolveMoveFlow to pick one of the 4 move flows on every destination
  // click. Both persist to localStorage so they survive across games
  // within the session (brief: state per-session).
  const [coachOn, setCoachOn] = useState<boolean>(() => readBoolPref(COACH_MODE_KEY));
  const [confirmOn, setConfirmOn] = useState<boolean>(() => readBoolPref(CONFIRM_STEP_KEY));
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

  const boardRef = useRef<BoardHandle>(null);
  const mirrorRef = useRef(new Chess());
  const lastReplyAtRef = useRef(Date.now());
  const busyRef = useRef(false);
  // Bumped on every handleMoveWithPostJudge call (and reset on new game) so
  // a /judge response for a superseded post-judge move never overwrites a
  // newer move's badge.
  const postVerdictTokenRef = useRef(0);
  // Bumped on every confirm/retract (and new game) so a judge response that
  // resolves after the pending move it belongs to was superseded is a
  // no-op — never flips judgePhase to "judged" for a move that's already
  // gone.
  const pendingTokenRef = useRef(0);
  // Wave C, task C-A: the "end the game?" arm-then-confirm revert timer,
  // and a re-entrancy guard for the preview call itself (distinct from
  // busyRef, which gates the main move flow — arming end-game shouldn't be
  // blocked by, or block, an in-flight move).
  const endGameTimerRef = useRef<number | null>(null);
  const endGameBusyRef = useRef(false);
  const inputHintTimerRef = useRef<number | null>(null);
  const replayingRef = useRef(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Fires the right terminal-sequence celebration for a game-over result:
  // confetti for a player win, an electric storm for a loss, a soft shimmer
  // for a draw. Fire-and-forget, non-blocking — matches the existing
  // board?.confetti() call style.
  const celebrate = useCallback((result: string) => {
    const board = boardRef.current;
    if (!board) return;
    if (result === "1-0") board.confetti();
    else if (result === "0-1") board.storm();
    else board.shimmer();
  }, []);

  const check = useMemo(() => {
    const c = new Chess(fen);
    return { square: kingInCheckSquare(c), mate: c.isCheckmate() };
  }, [fen]);

  const startGame = useCallback(async (sid: number) => {
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
    setHintLevel(0);
    postVerdictTokenRef.current += 1;
    setPostVerdict(null);
    setLastMove(null);
    setMallowThinking(false);
    if (inputHintTimerRef.current) {
      window.clearTimeout(inputHintTimerRef.current);
      inputHintTimerRef.current = null;
    }
    setInputHint(null);
    const g = await newGame(sid, OPPONENT_ELO);
    mirrorRef.current = new Chess(g.fen);
    setFen(g.fen);
    setFallback(g.fallback);
    setGameId(g.gameId);
    lastReplyAtRef.current = Date.now();
    // Turn state now lives in the player bars (see render) — clear the
    // "finding an opponent..." transient now that the game is ready, but
    // don't replace it with "your move" text; status is transient-only.
    setStatus("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await newSession();
      if (cancelled) return;
      setSessionId(s.sessionId);
      await startGame(s.sessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, [startGame]);

  useEffect(() => {
    if (!sessionId) return;
    return modeTimer(sessionId, "game");
  }, [sessionId]);

  useEffect(() => {
    window.localStorage.setItem(COACH_MODE_KEY, String(coachOn));
  }, [coachOn]);

  useEffect(() => {
    window.localStorage.setItem(CONFIRM_STEP_KEY, String(confirmOn));
  }, [confirmOn]);

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
          setFen(adoptServerFen(mirror, undefined));
          setResyncTick((t) => t + 1);
          setStatus("connection hiccup — try that move again");
          setLastMove(null); // the move never actually landed — nothing to highlight
          return;
        }
        lastReplyAtRef.current = Date.now();

        if (!res.ok) {
          // Server-authoritative desync guard: adopt res.fen when the
          // server gave us one (it's the true post-rejection state), only
          // falling back to a local undo when it didn't send a usable fen.
          setFen(adoptServerFen(mirror, res.fen));
          setResyncTick((t) => t + 1);
          setStatus("that didn't land — try another move");
          setLastMove(null); // reverted — the highlighted move didn't actually happen
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
      setHintLevel(0);

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
          const res = await judgeMove(gameId, from, to, render.promotion);
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
      })();
    },
    [gameId, gameOver]
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
    setHintLevel(0); // Wave C, task C-B: level resets on confirm
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
    setHintLevel(0); // Wave C, task C-B: level resets on cancel
  }, []);

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

  // Wave C, task C-B: deterministic hint escalation. Only ever callable
  // when the current pending's verdict actually carries facts (the render
  // below gates the affordance on the same condition), so there's nothing
  // to guard against a facts-less verdict here beyond the defensive check.
  // The fen logged is the position BEFORE the pending move (mirrorRef is
  // untouched while a move is pending) — "what was best instead" is
  // meaningless without it.
  const handleHintClick = useCallback(() => {
    if (!gameId || !verdict?.facts) return;
    const next = nextHintLevel(hintLevel);
    setHintLevel(next);
    logHint(gameId, next, verdict.tier, verdict.deltaCp, verdict.facts.bestUci, mirrorRef.current.fen()).catch(
      () => undefined
    );
  }, [gameId, verdict, hintLevel]);

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
      judgeMove(gameId, from, to, undefined, "post")
        .then((res) => {
          if (postVerdictTokenRef.current !== token) return; // superseded by a newer move
          setPostVerdict(res.verdict ?? null);
        })
        .catch(() => {
          // No badge — the move itself never depends on this call.
        });
      handleMove(from, to);
    },
    [gameId, gameOver, handleMove]
  );

  // Single dispatch point for every destination click Board reports.
  // resolveMoveFlow (src/game/moveFlow.ts) is the pinned spec for which of
  // the 4 flows a given (coachOn, confirmOn) pair maps to.
  const handleBoardMove = useCallback(
    (from: string, to: string) => {
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
  // trusting anything this client remembers from the preview — if the
  // position somehow shifted between the two clicks (it can't today, since
  // input is locked while armed, but the contract holds regardless), the
  // execution reflects reality, not the stale preview.
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

  const handleNewGame = useCallback(() => {
    if (sessionId != null) startGame(sessionId);
  }, [sessionId, startGame]);

  // "replay the takedown" — re-runs Part 1's glide+shatter without touching
  // any game state. Guarded against re-entrancy so a double-click can't
  // stack two shatter bursts on top of each other.
  const handleReplayTakedown = useCallback(async () => {
    if (!takedownMove || replayingRef.current) return;
    replayingRef.current = true;
    try {
      await boardRef.current?.takedown(takedownMove);
    } finally {
      replayingRef.current = false;
    }
  }, [takedownMove]);

  const togglesDisabled = uiBusy || pending !== null;

  // Wave B: turn/state info lives entirely in the two player bars now.
  // uiBusy is true for the whole span from "player's move confirmed" to
  // "reply (or failure) resolved" — that's mallow's side of the board being
  // "in play"; anything else is the player's side. mallowThinking narrows
  // the mallow-active window to just the network round-trip (see handleMove).
  const material = materialDiff(captured);
  const moveNumber = Number(fen.split(" ")[5]) || 1;
  const mallowActive = !!gameId && !gameOver && uiBusy;
  const youActive = !!gameId && !gameOver && !uiBusy;
  const mallowChip = mallowActive ? (mallowThinking ? "thinking..." : "mallow's move") : null;
  const youChip = youActive ? (pending ? "deciding..." : "your move") : null;

  // Wave C, task C-A: the button's copy, arm state included — never a
  // silent relabel, the armed text always states the outcome a second
  // click would execute.
  const endGameLabel =
    endGameOutcome === "win"
      ? "call it: you're winning. take the win?"
      : endGameOutcome === "draw"
        ? "call it a draw?"
        : endGameOutcome === "resign"
          ? "call it: mallow has this. resign?"
          : "end the game?";

  // Wave C, task C-B: level-3 board highlight for the judge's suggested
  // best move, derived straight from the verdict's facts — no separate
  // state needed beyond hintLevel itself.
  const hintReveal =
    hintLevel >= 3 && verdict?.facts ? hintRevealSquares(verdict.facts.bestUci) : null;

  return (
    <div className="game-page">
      {fallback && <div className="fallback-banner">fallback opponents (lc0 unavailable)</div>}
      <header className="header-band">
        <div className="header-lockup">
          <span className="px">GIRL CHESS</span>
          <p className="tagline">tutor with benefits</p>
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
            ⚙
          </button>
          {settingsOpen && (
            <div className="settings-popover pop-in">
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={coachOn}
                  disabled={togglesDisabled}
                  onChange={(e) => setCoachPref(e.target.checked)}
                />
                coach judges my moves
              </label>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={confirmOn}
                  disabled={togglesDisabled}
                  onChange={(e) => setConfirmPref(e.target.checked)}
                />
                confirm before playing
              </label>
            </div>
          )}
        </div>
      </header>
      <div className="board-stack">
        <PlayerBar
          seat="mallow"
          captured={captured.w}
          capturedColor="w"
          materialLead={material.leader === "mallow" ? material.points : null}
          active={mallowActive}
          chip={mallowChip}
        />
        <Board
          key={`${gameId ?? "loading"}-${resyncTick}`}
          ref={boardRef}
          fen={fen}
          onMove={handleBoardMove}
          checkSquare={check.square}
          checkmate={check.mate}
          pending={pending}
          onRetarget={handleRetargetPending}
          onCancelPending={handleRetractPending}
          onInputHint={handleInputHint}
          lastMove={lastMove}
          hintReveal={hintReveal}
        />
        <PlayerBar
          seat="you"
          captured={captured.b}
          capturedColor="b"
          materialLead={material.leader === "you" ? material.points : null}
          active={youActive}
          chip={youChip}
          moveNumber={moveNumber}
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
                    <span className="judge-badge judge-badge-nudge">hm — you sure?</span>
                  )}
                  {verdict?.tier === "warning" && (
                    <span className="judge-badge judge-badge-warning">careful. this one hurts.</span>
                  )}
                  {/* Wave C, task C-B: deterministic hint escalation — only
                      when the judge actually has facts to offer (an eval
                      failure just means this never renders; confirm/retract
                      are never blocked on it). */}
                  {verdict?.facts && (verdict.tier === "nudge" || verdict.tier === "warning") && (
                    <span className="hint-block">
                      {hintLevel > 0 && (
                        <span className="hint-copy">{hintCopy(hintLevel, verdict.facts)}</span>
                      )}
                      {hintLevel < 3 && (
                        <button type="button" className="hint-affordance" onClick={handleHintClick}>
                          {hintLevel === 0 ? "help?" : "more?"}
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
              {postVerdict.tier === "silent" && <span className="judge-check">✓</span>}
              {postVerdict.tier === "nudge" && (
                <span className="judge-badge judge-badge-nudge">hm — you sure?</span>
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
            ) : (
              <div className="controls game-controls">
                {/* Wave C, task C-A: one button replaces separate resign /
                    offer-draw. First click previews the engine's own call
                    on the position; the armed second click always shows
                    (never silently relabels) the outcome it's about to
                    execute. */}
                <button
                  className={`small${endGameOutcome ? " confirming" : ""}`}
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
      <p className="status-line">{inputHint ?? status}</p>
      {gameOver && (
        <GameEndPanel
          gameOver={gameOver}
          takedownMove={takedownMove}
          onReplayTakedown={handleReplayTakedown}
          onNewGame={handleNewGame}
        />
      )}
    </div>
  );
}
