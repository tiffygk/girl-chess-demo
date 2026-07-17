import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess, type Square } from "chess.js";
import { Piece, type PieceColor, type PieceKind } from "./pieces";
import { beep } from "./sounds";
import type { MoveRender } from "../game/describeMove";
import { resolveClickMove } from "../game/resolveClick";

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
  /**
   * Checkmate-only terminal sequence: the attacker at `from` glides onto
   * the mated king's square at `to`, then the king glitch-shatters. Safe to
   * call again on the same {from, to} after the first run completes (e.g.
   * "replay the takedown") — the attacker is by then already sitting on
   * `to`, so the replay just re-plays the shatter flourish in place.
   */
  takedown(move: { from: string; to: string }): Promise<void>;
  confetti(): void;
  storm(): void;
  shimmer(): void;
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
  const [glow, setGlow] = useState(false);

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

  // `big` scales up a capture-style pixel burst for the king-takedown shatter
  // (Part 1 of the terminal sequence) — larger fragments, longer flight,
  // longer duration than the plain glitchCapture burst.
  const burst = useCallback((idx: number, count: number, big = false) => {
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
      const s = big ? 9 + Math.random() * 14 : 4 + Math.random() * 7;
      px.style.width = px.style.height = s + "px";
      px.style.background = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      px.style.left = cx + "px";
      px.style.top = cy + "px";
      innerEl.appendChild(px);
      const ang = Math.random() * Math.PI * 2;
      const dist = big ? 40 + Math.random() * 90 : 22 + Math.random() * 55;
      px
        .animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            {
              transform: `translate(${Math.cos(ang) * dist}px, ${
                Math.sin(ang) * dist - (big ? 22 : 14)
              }px) rotate(${(Math.random() - 0.5) * 300}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: (big ? 650 : 480) + Math.random() * (big ? 400 : 250),
            easing: "cubic-bezier(.2,.7,.4,1)",
          }
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

  // Checkmate-only terminal sequence (Part 1): glide the attacker onto the
  // king's square, then shatter the king with a scaled-up burst. Tolerant of
  // being called a second time on the same {from, to} (the "replay the
  // takedown" button in GameEndPanel) — by then the attacker is already
  // sitting on `to` and there's no king left to remove, so the replay just
  // re-plays the shatter in place.
  const takedown = useCallback(
    async (move: { from: string; to: string }) => {
      const { from, to } = move;
      animatingRef.current = true;
      const mover = entriesRef.current.find((e) => e.square === from);

      if (mover) {
        beep("move");
        patchEntry(mover.id, { square: to, moving: true });
        await sleep(500);
        patchEntry(mover.id, { moving: false, land: true });
        await sleep(150);
        patchEntry(mover.id, { land: false });

        const king = entriesRef.current.find((e) => e.square === to && e.id !== mover.id);
        beep("glitch");
        burst(squareToIdx(to), 26, true);
        if (king) {
          const kingId = king.id;
          updateEntries((prev) => prev.filter((e) => e.id !== kingId));
        }
        setShake(true);
        await sleep(650);
        setShake(false);
      } else {
        // Replay: the attacker already settled on `to` from the first run.
        const settled = entriesRef.current.find((e) => e.square === to);
        beep("glitch");
        if (settled) patchEntry(settled.id, { glitchIn: true });
        burst(squareToIdx(to), 26, true);
        setShake(true);
        await sleep(650);
        setShake(false);
        if (settled) patchEntry(settled.id, { glitchIn: false });
      }

      animatingRef.current = false;
    },
    [patchEntry, updateEntries, burst]
  );

  // Full-screen win celebration — appended to document.body (not innerRef's
  // board rect) so it covers the whole viewport, not just the board. Fully
  // self-cleans: every particle removes itself on animation finish, and the
  // overlay removes itself after ~2.2s.
  const confetti = useCallback(() => {
    const overlay = document.createElement("div");
    overlay.className = "gc-confetti-overlay";
    document.body.appendChild(overlay);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const count = 90;
    for (let i = 0; i < count; i++) {
      const px = document.createElement("div");
      px.className = "gc-confetti-piece";
      const s = 6 + Math.random() * 10;
      px.style.width = px.style.height = s + "px";
      px.style.background = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      px.style.left = Math.random() * w + "px";
      px.style.top = "-20px";
      overlay.appendChild(px);
      const drift = (Math.random() - 0.5) * 160;
      const duration = 1500 + Math.random() * 700;
      px
        .animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            {
              transform: `translate(${drift}px, ${h + 40}px) rotate(${(Math.random() - 0.5) * 720}deg)`,
              opacity: 1,
            },
          ],
          { duration, delay: Math.random() * 200, easing: "cubic-bezier(.2,.6,.35,1)" }
        )
        .addEventListener("finish", () => px.remove());
    }
    setTimeout(() => overlay.remove(), 2200);
  }, []);

  // Loss celebration: an "electric storm" — screen-edge lightning flicker in
  // the glitch palette, driven entirely by the gcStormFlicker CSS keyframe
  // (see sugar-glitch.css). Non-blocking, ~2s, self-removing.
  const storm = useCallback(() => {
    const overlay = document.createElement("div");
    overlay.className = "gc-storm-overlay";
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 2000);
  }, []);

  // Draw celebration (or lack thereof): a soft glow pulse on the board frame
  // itself rather than a full-screen effect — a draw isn't a win or a loss,
  // so it gets a quieter acknowledgment.
  const shimmer = useCallback(() => {
    setGlow(true);
    setTimeout(() => setGlow(false), 1800);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ glide, glitchCapture, takedown, confetti, storm, shimmer }),
    [glide, glitchCapture, takedown, confetti, storm, shimmer]
  );

  const turn = fen.split(" ")[1] === "b" ? "b" : "w";

  // Rebuilt whenever fen changes (only ever while the board is idle — clicks
  // are gated behind animatingRef.current — so this always reflects the
  // settled position a selection is made against). Used both to resolve
  // clicks (castle-by-rook-click, reselect) and to compute legal-move
  // highlights for the current selection.
  const chess = useMemo(() => new Chess(fen), [fen]);

  // Legal destination squares for the current selection, split into plain
  // moves and captures (en passant counts as a capture) so they can render
  // with different mint treatments. When the selection is the king and
  // castling is legal, the rook's square is added to `normal` too — that's
  // the affordance for Part 1's castle-by-rook-click.
  const legalTargets = useMemo(() => {
    const normal = new Set<string>();
    const capture = new Set<string>();
    if (!selectedSquare) return { normal, capture };
    if (!chess.get(selectedSquare as Square)) return { normal, capture };
    const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
    const rank = selectedSquare[1];
    for (const m of moves) {
      if (m.flags.includes("c") || m.flags.includes("e")) {
        capture.add(m.to);
        continue;
      }
      normal.add(m.to);
      if (m.flags.includes("k")) normal.add(`h${rank}`);
      else if (m.flags.includes("q")) normal.add(`a${rank}`);
    }
    return { normal, capture };
  }, [chess, selectedSquare]);

  const handlePieceClick = useCallback(
    (square: string, color: PieceColor) => {
      if (animatingRef.current) return;
      if (selectedSquare && selectedSquare !== square) {
        const result = resolveClickMove(chess, selectedSquare, square);
        if (result === "reselect") {
          if (color !== turn) return; // defensive: reselect only ever targets an own piece
          setSelectedSquare(square);
          beep("select");
          return;
        }
        setSelectedSquare(null);
        if (result) onMove(result.from, result.to);
        return;
      }
      if (color !== turn) return;
      setSelectedSquare(square);
      beep("select");
    },
    [selectedSquare, onMove, turn, chess]
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

  // Guards specifically against the mate ring lingering on an empty square:
  // once the king-takedown shatters the mated king, its entry is removed
  // from `entries` entirely (not just moved), even though checkSquare and
  // checkmate (props derived from GamePage's fen, which doesn't change
  // during/after the takedown) still point at that square. Scoped to the
  // checkmate case only — ordinary in-progress check-ring rendering must
  // stay untouched, since a king merely *moving* out of check (its entry's
  // square changing, not being removed) is a normal, frequent case during
  // move animation and must keep following the old checkSquare-only rule.
  const matedKingGone = useMemo(
    () => checkmate && checkSquare != null && !entries.some((e) => e.square === checkSquare && e.kind === "k"),
    [entries, checkSquare, checkmate]
  );

  return (
    <div className="stage">
      <div className={"board-frame" + (shake ? " shake" : "") + (glow ? " shimmer" : "")}>
        <div className="board-inner" ref={innerRef}>
          <div className="squares">
            {Array.from({ length: 64 }, (_, idx) => {
              const square = idxToSquare(idx);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              const light = (row + col) % 2 === 0;
              const isCheckRing = square === checkSquare && !matedKingGone;
              const classes = [
                "sq",
                light ? "light" : "dark",
                corruptIdx.has(idx) ? "corrupt" : "",
                square === selectedSquare ? "target-hint" : "",
                legalTargets.capture.has(square) ? "hint-capture" : "",
                legalTargets.normal.has(square) ? "hint" : "",
                isCheckRing ? "check-ring" : "",
                isCheckRing && checkmate ? "mate" : "",
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
