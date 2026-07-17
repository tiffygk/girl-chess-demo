import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import { newSession, newGame, sendMove, modeTimer, type MoveResponse, type GameOverInfo } from "./api";
import { describeMove } from "./describeMove";
import { kingInCheckSquare } from "./checkState";
import { reconcile } from "./reconcile";

const OPPONENT_ELO = 1100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Minimum time the check ring must stay on screen before the reply
// animation starts covering it, so a fast server response can't skip the
// player past ever seeing the check they just delivered.
const CHECK_VISIBILITY_MS = 450;

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

  const boardRef = useRef<BoardHandle>(null);
  const mirrorRef = useRef(new Chess());
  const lastReplyAtRef = useRef(Date.now());
  const busyRef = useRef(false);

  const check = useMemo(() => {
    const c = new Chess(fen);
    return { square: kingInCheckSquare(c), mate: c.isCheckmate() };
  }, [fen]);

  const startGame = useCallback(async (sid: number) => {
    setGameOver(null);
    setStatus("finding an opponent...");
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
          const replyMove = mirror.move({ from: replyFrom, to: replyTo, promotion: replyPromotion });
          const replyRender = describeMove(replyMove);
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

  const handleNewGame = useCallback(() => {
    if (sessionId != null) startGame(sessionId);
  }, [sessionId, startGame]);

  return (
    <div className="game-page">
      {fallback && <div className="fallback-banner">fallback opponents (lc0 unavailable)</div>}
      <Board
        key={`${gameId ?? "loading"}-${resyncTick}`}
        ref={boardRef}
        fen={fen}
        onMove={handleMove}
        checkSquare={check.square}
        checkmate={check.mate}
      />
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
