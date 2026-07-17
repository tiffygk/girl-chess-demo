import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import { Piece, type PieceKind } from "../board/pieces";
import {
  newSession,
  newGame,
  sendMove,
  modeTimer,
  resign,
  offerDraw,
  judgeMove,
  type MoveResponse,
  type GameOverInfo,
  type Verdict,
} from "./api";
import { describeMove } from "./describeMove";
import { victimKind } from "./captures";
import { kingInCheckSquare } from "./checkState";
import { reconcile } from "./reconcile";
import { findTakedownPiece, type Takedown } from "./terminal";
import { GameEndPanel } from "./GameEndPanel";
import { resolveMoveFlow } from "./moveFlow";

interface Captured {
  w: PieceKind[]; // white pieces captured (by the opponent)
  b: PieceKind[]; // black pieces captured (by the player)
}

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

// How long a resign/draw button stays morphed into "you sure?" before it
// reverts on its own — an in-world confirm step instead of a modal.
const CONFIRM_MS = 3000;

// How long the opponent's decline bark stays on screen.
const BARK_MS = 4000;

const DRAW_DECLINE_BARK = "mallow declines. play on.";

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
  // Which end-of-game button (if any) is currently morphed to "you sure?".
  const [confirming, setConfirming] = useState<"resign" | "draw" | null>(null);
  const [bark, setBark] = useState<string | null>(null);
  // Guardian Angel pending-move (C1): the move the player clicked but
  // hasn't confirmed yet. The mirror/fen are NOT touched while this is set
  // — Board renders it as a pure overlay (dimmed origin + ghost on `to`).
  const [pending, setPending] = useState<{ from: string; to: string; promotion?: string } | null>(null);
  const [judgePhase, setJudgePhase] = useState<"judging" | "judged" | null>(null);
  // C2: the verdict itself, once judged — drives the badge rendered into
  // C1's "judged ✓" slot. null while judging, and for tier "silent" (no
  // badge, just the plain "judged ✓" C1 already had).
  const [verdict, setVerdict] = useState<Verdict | null>(null);
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
  const confirmTimerRef = useRef<number | null>(null);
  const barkTimerRef = useRef<number | null>(null);
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
    setConfirming(null);
    setBark(null);
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
    postVerdictTokenRef.current += 1;
    setPostVerdict(null);
    const g = await newGame(sid, OPPONENT_ELO);
    mirrorRef.current = new Chess(g.fen);
    setFen(g.fen);
    setFallback(g.fallback);
    setGameId(g.gameId);
    lastReplyAtRef.current = Date.now();
    setStatus("your move");
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

  const handleMove = useCallback(
    async (from: string, to: string) => {
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

        const timeSpentMs = Date.now() - lastReplyAtRef.current;
        setStatus("mallow is thinking...");

        let res: MoveResponse;
        try {
          res = await sendMove(gameId, from, to, mv.promotion, timeSpentMs);
        } catch {
          // No server response at all — nothing authoritative to adopt.
          setFen(adoptServerFen(mirror, undefined));
          setResyncTick((t) => t + 1);
          setStatus("connection hiccup — try that move again");
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
        } else {
          setStatus("your move");
        }
      } finally {
        busyRef.current = false;
        setUiBusy(false);
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
  const handlePendingStart = useCallback(
    (from: string, to: string, withJudge: boolean) => {
      if (!gameId || busyRef.current || gameOver || pending) return;
      const probe = new Chess(mirrorRef.current.fen());
      let mv;
      try {
        mv = probe.move({ from, to, promotion: "q" });
      } catch {
        return; // illegal locally — never sent to the server
      }

      const token = (pendingTokenRef.current += 1);
      setPending({ from, to, promotion: mv.promotion });

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
          const res = await judgeMove(gameId, from, to, mv.promotion);
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
    [gameId, gameOver, pending]
  );

  // Confirm: never blocked by the verdict, whatever it says — runs the
  // existing handleMove flow exactly as today (mirror apply + POST /move +
  // animation). Clearing pending first (rather than in handleMove) keeps
  // handleMove itself unchanged from its pre-C1 shape.
  const handleConfirmPending = useCallback(() => {
    if (!pending) return;
    const { from, to } = pending;
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
    handleMove(from, to);
  }, [pending, handleMove]);

  // Retract: purely client-side — the server never stored any pending
  // state to undo. Selection was already cleared by Board before onMove
  // fired, so there's nothing else to reset.
  const handleRetractPending = useCallback(() => {
    pendingTokenRef.current += 1;
    setPending(null);
    setJudgePhase(null);
    setVerdict(null);
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
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
      if (barkTimerRef.current) window.clearTimeout(barkTimerRef.current);
    };
  }, []);

  const clearConfirmTimer = useCallback(() => {
    if (confirmTimerRef.current) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  // Arms the "you sure?" morph for `action`; a second click on the same
  // button within CONFIRM_MS is treated as the real confirmation by the
  // caller. Left alone, the morph reverts on its own.
  const armConfirm = useCallback(
    (action: "resign" | "draw") => {
      setConfirming(action);
      clearConfirmTimer();
      confirmTimerRef.current = window.setTimeout(() => setConfirming(null), CONFIRM_MS);
    },
    [clearConfirmTimer]
  );

  const handleResignClick = useCallback(() => {
    if (!gameId || busyRef.current || gameOver) return;
    if (confirming !== "resign") {
      armConfirm("resign");
      return;
    }
    clearConfirmTimer();
    setConfirming(null);

    (async () => {
      busyRef.current = true;
      setUiBusy(true);
      try {
        const r = await resign(gameId);
        if (r.ok && r.result) {
          // Resign skips the takedown (there's no checkmate to stage).
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
  }, [gameId, gameOver, confirming, armConfirm, clearConfirmTimer, celebrate]);

  const handleDrawClick = useCallback(() => {
    if (!gameId || busyRef.current || gameOver) return;
    if (confirming !== "draw") {
      armConfirm("draw");
      return;
    }
    clearConfirmTimer();
    setConfirming(null);

    (async () => {
      busyRef.current = true;
      setUiBusy(true);
      setStatus("mallow is thinking...");
      try {
        const r = await offerDraw(gameId);
        if (r.ok && r.accepted && r.result) {
          // Accepted draw skips the takedown too.
          setTakedownMove(null);
          setGameOver({ result: r.result });
          setStatus("");
          celebrate(r.result);
        } else {
          setStatus("your move");
          setBark(DRAW_DECLINE_BARK);
          if (barkTimerRef.current) window.clearTimeout(barkTimerRef.current);
          barkTimerRef.current = window.setTimeout(() => setBark(null), BARK_MS);
        }
      } finally {
        busyRef.current = false;
        setUiBusy(false);
      }
    })();
  }, [gameId, gameOver, confirming, armConfirm, clearConfirmTimer, celebrate]);

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

  return (
    <div className="game-page">
      {fallback && <div className="fallback-banner">fallback opponents (lc0 unavailable)</div>}
      <div className="coach-toggle-row" ref={settingsRef}>
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
      <div className="board-with-trays">
        <div className="opponent-side">
          <CaptureTray pieces={captured.w} color="w" label="pieces mallow has captured" />
          {bark && (
            <div className="bark-bubble pop-in" role="status">
              {bark}
            </div>
          )}
        </div>
        <Board
          key={`${gameId ?? "loading"}-${resyncTick}`}
          ref={boardRef}
          fen={fen}
          onMove={handleBoardMove}
          checkSquare={check.square}
          checkmate={check.mate}
          pending={pending}
          locked={pending !== null}
        />
        <CaptureTray pieces={captured.b} color="b" label="pieces you've captured" />
      </div>
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
      {!gameOver &&
        (pending ? (
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
            <button
              className={`small${confirming === "resign" ? " confirming" : ""}`}
              disabled={!gameId}
              onClick={handleResignClick}
            >
              {confirming === "resign" ? "you sure?" : "resign"}
            </button>
            <button
              className={`small${confirming === "draw" ? " confirming" : ""}`}
              disabled={!gameId}
              onClick={handleDrawClick}
            >
              {confirming === "draw" ? "you sure?" : "offer draw"}
            </button>
          </div>
        ))}
      <p className="status-line">{status}</p>
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

// A side tray of captured-piece sprites. `pieces` is append-only (capture
// order preserved, newest last), so index-based keys are stable — a
// re-render only ever mounts one new node, which is what lets the `pop-in`
// pop keyframe play once per capture instead of replaying on every render.
function CaptureTray({ pieces, color, label }: { pieces: PieceKind[]; color: "w" | "b"; label: string }) {
  return (
    <div className="tray" aria-label={label}>
      {pieces.map((kind, i) => (
        <div key={`${color}-${i}`} className="tray-piece pop-in">
          <Piece kind={kind} color={color} />
        </div>
      ))}
    </div>
  );
}
