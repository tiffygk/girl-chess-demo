import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import { Piece, type PieceColor, type PieceKind } from "./pieces";
import { beep } from "./sounds";
import type { MoveRender } from "../game/describeMove";

interface PieceEntry {
  id: string;
  kind: PieceKind;
  color: PieceColor;
  square: string;
  hidden: boolean;
  moving: boolean;
  preGlitch: boolean;
  land: boolean;
  glitchIn: boolean;
  noTrans: boolean;
}

export interface BoardHandle {
  glide(move: MoveRender): Promise<void>;
  glitchCapture(move: MoveRender): Promise<void>;
  confetti(): void;
}

interface BoardProps {
  fen: string;
  onMove: (from: string, to: string) => void;
  lastCapture?: { square: string };
  checkSquare?: string | null;
  checkmate?: boolean;
}

// ambient decorative jitter squares, same indices as the demo
const AMBIENT_CORRUPT = new Set([20, 43]);
const PALETTE = ["#23E5FF", "#FF3DA6", "#FF8FBF", "#8ED9F9", "#CBBFFF", "#FFD84D"];

function squareToIdx(square: string) {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - Number(square[1]);
  return row * 8 + col;
}
function idxToSquare(idx: number) {
  const row = Math.floor(idx / 8);
  const col = idx % 8;
  return String.fromCharCode(97 + col) + (8 - row);
}
function idToUid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function entriesFromFen(fen: string): PieceEntry[] {
  const board = new Chess(fen).board();
  const out: PieceEntry[] = [];
  board.forEach((row) =>
    row.forEach((cell) => {
      if (!cell) return;
      out.push({
        id: idToUid(),
        kind: cell.type,
        color: cell.color,
        square: cell.square,
        hidden: false,
        moving: false,
        preGlitch: false,
        land: false,
        glitchIn: false,
        noTrans: false,
      });
    })
  );
  return out;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(
  { fen, onMove, lastCapture, checkSquare, checkmate },
  ref
) {
  const [entries, setEntries] = useState<PieceEntry[]>(() => entriesFromFen(fen));
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const entriesRef = useRef(entries);
  const innerRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  const updateEntries = useCallback((updater: (prev: PieceEntry[]) => PieceEntry[]) => {
    setEntries((prev) => {
      const next = updater(prev);
      entriesRef.current = next;
      return next;
    });
  }, []);

  const patchEntry = useCallback(
    (id: string, patch: Partial<PieceEntry>) => {
      updateEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    [updateEntries]
  );

  const burst = useCallback((idx: number, count: number) => {
    const innerEl = innerRef.current;
    if (!innerEl) return;
    const rect = innerEl.getBoundingClientRect();
    const row = Math.floor(idx / 8);
    const col = idx % 8;
    const cx = ((col + 0.5) * rect.width) / 8;
    const cy = ((row + 0.5) * rect.height) / 8;
    for (let i = 0; i < count; i++) {
      const px = document.createElement("div");
      px.className = "pixel";
      const s = 4 + Math.random() * 7;
      px.style.width = px.style.height = s + "px";
      px.style.background = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      px.style.left = cx + "px";
      px.style.top = cy + "px";
      innerEl.appendChild(px);
      const ang = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 55;
      px
        .animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            {
              transform: `translate(${Math.cos(ang) * dist}px, ${
                Math.sin(ang) * dist - 14
              }px) rotate(${(Math.random() - 0.5) * 300}deg)`,
              opacity: 0,
            },
          ],
          { duration: 480 + Math.random() * 250, easing: "cubic-bezier(.2,.7,.4,1)" }
        )
        .addEventListener("finish", () => px.remove());
    }
  }, []);

  // Relocates a single entry from -> to with the plain glide animation,
  // without touching animatingRef (callers own that lifecycle so multiple
  // entries — e.g. king + rook on a castle — can glide concurrently).
  const glideEntry = useCallback(
    async (from: string, to: string) => {
      const mover = entriesRef.current.find((e) => e.square === from);
      if (!mover) return;
      patchEntry(mover.id, { square: to, moving: true });
      await sleep(500);
      patchEntry(mover.id, { moving: false, land: true });
      await sleep(280);
      patchEntry(mover.id, { land: false });
    },
    [patchEntry]
  );

  // After a piece has landed on `to`, if the move was a promotion, swap its
  // sprite to the promoted kind with a short glitch-morph (reusing the
  // existing glitch-in animation) so the pawn visibly "corrupts into" the
  // new piece. Kind is updated in Board state so later renders stay correct.
  const morphPromotion = useCallback(
    async (to: string, promotion: string) => {
      const landed = entriesRef.current.find((e) => e.square === to);
      if (!landed) return;
      patchEntry(landed.id, { kind: promotion as PieceKind, glitchIn: true });
      await sleep(420);
      patchEntry(landed.id, { glitchIn: false });
    },
    [patchEntry]
  );

  const glide = useCallback(
    async (move: MoveRender) => {
      animatingRef.current = true;
      beep("move");
      const tasks = [glideEntry(move.from, move.to)];
      if (move.secondary) tasks.push(glideEntry(move.secondary.from, move.secondary.to));
      await Promise.all(tasks);
      if (move.promotion) await morphPromotion(move.to, move.promotion);
      animatingRef.current = false;
    },
    [glideEntry, morphPromotion]
  );

  const glitchCapture = useCallback(
    async (move: MoveRender) => {
      const { from, to } = move;
      const capturedSquare = move.capturedSquare ?? to;
      const mover = entriesRef.current.find((e) => e.square === from);
      if (!mover) return;
      animatingRef.current = true;
      const fromIdx = squareToIdx(from);
      const victimIdx = squareToIdx(capturedSquare);
      const victim = entriesRef.current.find(
        (e) => e.square === capturedSquare && e.id !== mover.id
      );

      patchEntry(mover.id, { moving: true, preGlitch: true });
      beep("glitch");
      await sleep(300);

      burst(fromIdx, 12);
      patchEntry(mover.id, { preGlitch: false, hidden: true });
      await sleep(120);

      if (victim) {
        burst(victimIdx, 20);
        const victimId = victim.id;
        updateEntries((prev) => prev.filter((e) => e.id !== victimId));
      }

      patchEntry(mover.id, { square: to, noTrans: true });
      await sleep(30);
      patchEntry(mover.id, { hidden: false, glitchIn: true });
      requestAnimationFrame(() => patchEntry(mover.id, { noTrans: false }));
      setShake(true);
      await sleep(430);
      patchEntry(mover.id, { glitchIn: false, moving: false });
      setShake(false);

      if (move.secondary) {
        await glideEntry(move.secondary.from, move.secondary.to);
      }

      if (move.promotion) {
        await morphPromotion(move.to, move.promotion);
      }

      animatingRef.current = false;
    },
    [patchEntry, updateEntries, burst, glideEntry, morphPromotion]
  );

  const confetti = useCallback(() => {
    for (let i = 0; i < 10; i++) {
      const idx = Math.floor(Math.random() * 64);
      setTimeout(() => burst(idx, 14), i * 55);
    }
  }, [burst]);

  useImperativeHandle(ref, () => ({ glide, glitchCapture, confetti }), [glide, glitchCapture, confetti]);

  const turn = fen.split(" ")[1] === "b" ? "b" : "w";

  const handlePieceClick = useCallback(
    (square: string, color: PieceColor) => {
      if (animatingRef.current) return;
      if (selectedSquare && selectedSquare !== square) {
        const from = selectedSquare;
        setSelectedSquare(null);
        onMove(from, square);
        return;
      }
      if (color !== turn) return;
      setSelectedSquare(square);
      beep("select");
    },
    [selectedSquare, onMove, turn]
  );

  const handleSquareClick = useCallback(
    (square: string) => {
      if (animatingRef.current || !selectedSquare) return;
      const from = selectedSquare;
      setSelectedSquare(null);
      onMove(from, square);
    },
    [selectedSquare, onMove]
  );

  const corruptIdx = lastCapture ? new Set([...AMBIENT_CORRUPT, squareToIdx(lastCapture.square)]) : AMBIENT_CORRUPT;

  return (
    <div className="stage">
      <div className={"board-frame" + (shake ? " shake" : "")}>
        <div className="board-inner" ref={innerRef}>
          <div className="squares">
            {Array.from({ length: 64 }, (_, idx) => {
              const square = idxToSquare(idx);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              const light = (row + col) % 2 === 0;
              const classes = [
                "sq",
                light ? "light" : "dark",
                corruptIdx.has(idx) ? "corrupt" : "",
                square === selectedSquare ? "target-hint" : "",
                square === checkSquare ? "check-ring" : "",
                square === checkSquare && checkmate ? "mate" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={square}
                  className={classes}
                  data-square={square}
                  onClick={() => handleSquareClick(square)}
                />
              );
            })}
          </div>
          <div className="pieces">
            {entries.map((e) => {
              const idx = squareToIdx(e.square);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              const classes = [
                "pc",
                e.color,
                e.moving ? "moving" : "",
                e.preGlitch ? "pre-glitch" : "",
                e.land ? "land" : "",
                e.glitchIn ? "glitch-in" : "",
                e.noTrans ? "no-trans" : "",
                e.square === selectedSquare ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={e.id}
                  className={classes}
                  data-square={e.square}
                  style={{ left: col * 12.5 + "%", top: row * 12.5 + "%", visibility: e.hidden ? "hidden" : "visible" }}
                  onClick={() => handlePieceClick(e.square, e.color)}
                >
                  <Piece kind={e.kind} color={e.color} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
