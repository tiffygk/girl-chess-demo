import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import { Piece, type PieceKind } from "../board/pieces";
import { newSession, newGame, sendMove, modeTimer, resign, offerDraw, type MoveResponse, type GameOverInfo } from "./api";
import { describeMove } from "./describeMove";
import { victimKind } from "./captures";
import { kingInCheckSquare } from "./checkState";
import { reconcile } from "./reconcile";

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

// How long a resign/draw button stays morphed into "you sure?" before it
// reverts on its own — an in-world confirm step instead of a modal.
const CONFIRM_MS = 3000;

// How long the opponent's decline bark stays on screen.
const BARK_MS = 4000;

const DRAW_DECLINE_BARK = "mallow declines. play on.";

function resultText(result: string): string {
  if (result === "1-0") return "you win. mallow melts.";
  if (result === "0-1") return "mallow wins this one.";
  return "draw.";
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
  const [resyncTick, setResyncTick] = useState(0);
  const [captured, setCaptured] = useState<Captured>({ w: [], b: [] });
  // Which end-of-game button (if any) is currently morphed to "you sure?".
  const [confirming, setConfirming] = useState<"resign" | "draw" | null>(null);
  const [bark, setBark] = useState<string | null>(null);

  const boardRef = useRef<BoardHandle>(null);
  const mirrorRef = useRef(new Chess());
  const lastReplyAtRef = useRef(Date.now());
  const busyRef = useRef(false);
  const confirmTimerRef = useRef<number | null>(null);
  const barkTimerRef = useRef<number | null>(null);

  const check = useMemo(() => {
    const c = new Chess(fen);
    return { square: kingInCheckSquare(c), mate: c.isCheckmate() };
  }, [fen]);

  const startGame = useCallback(async (sid: number) => {
    setGameOver(null);
    setStatus("finding an opponent...");
    setCaptured({ w: [], b: [] });
    setConfirming(null);
    setBark(null);
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
          setGameOver(res.gameOver);
          setStatus("");
          board?.confetti();
        } else {
          setStatus("your move");
        }
      } finally {
        busyRef.current = false;
      }
    },
    [gameId, gameOver]
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
      try {
        const r = await resign(gameId);
        if (r.ok && r.result) {
          setGameOver({ result: r.result });
          setStatus("");
        }
      } finally {
        busyRef.current = false;
      }
    })();
  }, [gameId, gameOver, confirming, armConfirm, clearConfirmTimer]);

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
      setStatus("mallow is thinking...");
      try {
        const r = await offerDraw(gameId);
        if (r.ok && r.accepted && r.result) {
          setGameOver({ result: r.result });
          setStatus("");
        } else {
          setStatus("your move");
          setBark(DRAW_DECLINE_BARK);
          if (barkTimerRef.current) window.clearTimeout(barkTimerRef.current);
          barkTimerRef.current = window.setTimeout(() => setBark(null), BARK_MS);
        }
      } finally {
        busyRef.current = false;
      }
    })();
  }, [gameId, gameOver, confirming, armConfirm, clearConfirmTimer]);

  const handleNewGame = useCallback(() => {
    if (sessionId != null) startGame(sessionId);
  }, [sessionId, startGame]);

  return (
    <div className="game-page">
      {fallback && <div className="fallback-banner">fallback opponents (lc0 unavailable)</div>}
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
          onMove={handleMove}
          checkSquare={check.square}
          checkmate={check.mate}
        />
        <CaptureTray pieces={captured.b} color="b" label="pieces you've captured" />
      </div>
      {!gameOver && (
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
      )}
      <p className="status-line">{status}</p>
      {gameOver && (
        <div className="game-over pop-in">
          <div className="result">{resultText(gameOver.result)}</div>
          <button className="primary" onClick={handleNewGame}>
            New game
          </button>
        </div>
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
