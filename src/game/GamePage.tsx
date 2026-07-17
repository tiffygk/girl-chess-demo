import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Board, type BoardHandle } from "../board/Board";
import { newSession, newGame, sendMove, modeTimer, type MoveResponse, type GameOverInfo } from "./api";

const OPPONENT_ELO = 1100;

function resultText(result: string): string {
  if (result === "1-0") return "you win. mallow melts.";
  if (result === "0-1") return "mallow wins this one.";
  return "draw.";
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
      const capture = mv.isCapture() || mv.isEnPassant();

      try {
        if (board) {
          if (capture) await board.glitchCapture(from, to);
          else await board.glide(from, to);
        }

        const timeSpentMs = Date.now() - lastReplyAtRef.current;
        setStatus("mallow is thinking...");

        let res: MoveResponse;
        try {
          res = await sendMove(gameId, from, to, mv.promotion, timeSpentMs);
        } catch {
          mirror.undo();
          setResyncTick((t) => t + 1);
          setStatus("connection hiccup — try that move again");
          return;
        }
        lastReplyAtRef.current = Date.now();

        if (!res.ok) {
          mirror.undo();
          setResyncTick((t) => t + 1);
          setStatus("that didn't land — try another move");
          return;
        }

        setFen(res.fen);

        if (res.reply) {
          const replyFrom = res.reply.uci.slice(0, 2);
          const replyTo = res.reply.uci.slice(2, 4);
          const replyPromotion = res.reply.uci.length > 4 ? res.reply.uci[4] : "q";
          mirror.move({ from: replyFrom, to: replyTo, promotion: replyPromotion });
          if (board) {
            if (res.reply.capture) await board.glitchCapture(replyFrom, replyTo);
            else await board.glide(replyFrom, replyTo);
          }
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
      <Board key={`${gameId ?? "loading"}-${resyncTick}`} ref={boardRef} fen={fen} onMove={handleMove} />
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
