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
import { resolveClickMove, isCastleAttempt } from "../game/resolveClick";
import { resolvePendingClick } from "../game/resolvePendingClick";
import type { Takedown } from "../game/terminal";
import { squareToIdx, idxToSquare } from "./squareMapping";

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
  /**
   * Wave D: overrides the CSS transition-duration for this entry's
   * left/top glide while `moving` — lets the cinematic replay run its
   * lead-up plies at a quickened pace without a second animation path
   * (see glideEntry). Undefined = the CSS default (500ms).
   */
  moveDurationMs?: number;
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
  /**
   * Wave D: "replay the takedown" as a lead-up cinematic. Resets the board
   * to `startFen`, plays `moves` back-to-back (all but the last at a
   * quickened cinematic pace with a small beat between plies; the last —
   * the mate move — at normal pace), then runs the same takedown
   * glide+shatter finale as a first-time checkmate. `animatingRef` stays
   * true for the whole call, so clicks stay gated through every beat, not
   * just each individual glide. Repeatable: every call resets fresh from
   * `startFen`, so re-running never depends on where the last run left off.
   * Ends on the true final position, same as a first-time takedown.
   */
  replayCinematic(startFen: string, moves: MoveRender[], takedownMove: Takedown): Promise<void>;
  /** `big`: Wave D's replay-finish celebration — denser/longer than the
   * first-time one. Parameterized rather than a separate copy-pasted path. */
  confetti(opts?: { big?: boolean }): void;
  storm(opts?: { big?: boolean }): void;
  shimmer(opts?: { big?: boolean }): void;
}

interface BoardProps {
  fen: string;
  onMove: (from: string, to: string) => void;
  lastCapture?: { square: string };
  checkSquare?: string | null;
  checkmate?: boolean;
  /**
   * Guardian Angel pending-move (C1, extended in A1): when set, the mover
   * renders (ghosted, "held not confirmed") at `to`, its origin dims, and
   * — new in A1 — the FULL final position previews too: a castling rook
   * ghosts at its own destination (origin dimmed) and a captured victim
   * (at `capturedSquare`, or `to` for anything but en passant) dims/hides.
   * Purely a render overlay — `entries` (and the fen/mirror upstream) are
   * untouched, so confirming still runs the normal glide/glitchCapture
   * entry from a settled position, and retracting is just clearing this.
   */
  pending?: {
    from: string;
    to: string;
    promotion?: string;
    secondary?: { from: string; to: string };
    capturedSquare?: string;
  } | null;
  /**
   * A2 (pending retarget): fired when a click while pending resolves to a
   * different legal destination for the SAME origin (pending.from) — the
   * board itself never changes `pending`; GamePage owns retracting the old
   * pending and starting the new one through the same move flow.
   */
  onRetarget?: (to: string) => void;
  /** A2: fired when a click while pending cancels it outright (clicking the
   * origin piece again, or the held ghost at `to`) — same effect as "take
   * it back". */
  onCancelPending?: () => void;
  /** A5: fired with a short human-readable reason when a click is
   * meaningful but couldn't do what it looked like it was trying to do
   * (currently: king selected, own rook clicked, castling isn't legal
   * right now). GamePage renders it in the status line for a few seconds. */
  onInputHint?: (message: string) => void;
  /**
   * A4: the most recently SETTLED move (player's or Mallow's) — both
   * squares get a mint "this happened here" wash, persisting until the
   * next move settles. For castling this is the king's from/to only.
   */
  lastMove?: { from: string; to: string } | null;
  /**
   * Wave C, task C-B: level-3 hint escalation reveal — the judge's
   * suggested best move's from/to squares, for the position BEFORE the
   * player's pending move. Render-only, same pattern as `lastMove`: never
   * touches `entries`, just adds a class. Deliberately a DIFFERENT visual
   * treatment (a pulsing ring, `.hint-reveal`) from `.hint`/`.hint-capture`
   * (plain legal-move highlights) and `.last-move`, since any of those may
   * be showing on the same square at the same time.
   */
  hintReveal?: { from: string; to: string } | null;
}

// ambient decorative jitter squares, same indices as the demo
const AMBIENT_CORRUPT = new Set([20, 43]);
const PALETTE = ["#23E5FF", "#FF3DA6", "#FF8FBF", "#8ED9F9", "#CBBFFF", "#FFD84D"];

// Increment 2.5: squareToIdx/idxToSquare moved to ./squareMapping.ts (owner
// playtest square-coordinate verification) — see that module for the full
// mapping spec and the render-order proof.
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

// Wave D pacing: normal single-move glide (unchanged from before this wave)
// vs. the cinematic replay's lead-up pace. Owner feedback, verbatim: "play
// the last three moves or four moves without delays in between but not too
// fast" — the lead-up plies run quickened-but-readable, back-to-back with
// only a small beat, while the FINAL (mate) ply plays at full normal speed
// and flows straight into the takedown glide+shatter.
const NORMAL_GLIDE_MS = 500;
const NORMAL_LAND_MS = 280;
const CINEMATIC_GLIDE_MS = 260;
const CINEMATIC_LAND_MS = 150;
const CINEMATIC_BEAT_MS = 150;

interface CaptureTimings {
  preGlitchMs: number;
  gapMs: number;
  shakeMs: number;
}
const NORMAL_CAPTURE_TIMINGS: CaptureTimings = { preGlitchMs: 300, gapMs: 120, shakeMs: 430 };
const CINEMATIC_CAPTURE_TIMINGS: CaptureTimings = { preGlitchMs: 165, gapMs: 70, shakeMs: 240 };

// Wave D: replay-finish celebration intensities — same confetti/storm/
// shimmer, parameterized rather than duplicated. "big" is denser/longer;
// used only when the replay cinematic completes (see GamePage).
const CONFETTI_COUNT = 90;
const CONFETTI_BIG_COUNT = 180;
const CONFETTI_LIFE_MS = 2200;
const CONFETTI_BIG_LIFE_MS = 3400;
const STORM_MS = 2000;
const STORM_BIG_MS = 3200;
const SHIMMER_MS = 1800;
const SHIMMER_BIG_MS = 2800;

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(
  {
    fen,
    onMove,
    lastCapture,
    checkSquare,
    checkmate,
    pending,
    onRetarget,
    onCancelPending,
    onInputHint,
    lastMove,
    hintReveal,
  },
  ref
) {
  const [entries, setEntries] = useState<PieceEntry[]>(() => entriesFromFen(fen));
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [glow, setGlow] = useState<false | "normal" | "big">(false);
  // Wave D: true for the whole span of a replayCinematic call (lead-up plies
  // + beats + final move + takedown finale). The board's checkSquare/
  // checkmate/lastMove/hintReveal props still describe the TRUE final
  // position (GamePage's fen never changes for a replay) — while entries
  // are temporarily reset to an earlier position mid-cinematic, those
  // derived overlays would otherwise render against the wrong frame (e.g. a
  // "locked mate ring" on a king that hasn't been mated yet in the frame
  // currently on screen). This flag suppresses them for the duration.
  const [cinematicActive, setCinematicActive] = useState(false);

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
  // durationMs/landMs default to the normal single-move pace; the cinematic
  // replay's lead-up plies pass the quickened constants instead — same
  // animation path, parameterized, not duplicated.
  const glideEntry = useCallback(
    async (from: string, to: string, durationMs = NORMAL_GLIDE_MS, landMs = NORMAL_LAND_MS) => {
      const mover = entriesRef.current.find((e) => e.square === from);
      if (!mover) return;
      patchEntry(mover.id, { square: to, moving: true, moveDurationMs: durationMs });
      await sleep(durationMs);
      patchEntry(mover.id, { moving: false, land: true });
      await sleep(landMs);
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

  // Animation body only — does NOT touch animatingRef. Shared by the public
  // `glide` (which wraps it with the ref for a single move) and
  // `replayCinematic` (which holds the ref for the whole multi-move
  // sequence, beats included, instead of dropping it between plies).
  const glideAnim = useCallback(
    async (move: MoveRender, durationMs = NORMAL_GLIDE_MS, landMs = NORMAL_LAND_MS) => {
      beep("move");
      const tasks = [glideEntry(move.from, move.to, durationMs, landMs)];
      if (move.secondary) tasks.push(glideEntry(move.secondary.from, move.secondary.to, durationMs, landMs));
      await Promise.all(tasks);
      if (move.promotion) await morphPromotion(move.to, move.promotion);
    },
    [glideEntry, morphPromotion]
  );

  const glide = useCallback(
    async (move: MoveRender) => {
      animatingRef.current = true;
      await glideAnim(move);
      animatingRef.current = false;
    },
    [glideAnim]
  );

  // Animation body only — no animatingRef, same split rationale as
  // glideAnim above. `timings` defaults to the normal capture pace; the
  // cinematic replay's lead-up plies pass the quickened constants.
  const glitchCaptureAnim = useCallback(
    async (move: MoveRender, timings: CaptureTimings = NORMAL_CAPTURE_TIMINGS) => {
      const { from, to } = move;
      const capturedSquare = move.capturedSquare ?? to;
      const mover = entriesRef.current.find((e) => e.square === from);
      if (!mover) return;
      const fromIdx = squareToIdx(from);
      const victimIdx = squareToIdx(capturedSquare);
      const victim = entriesRef.current.find(
        (e) => e.square === capturedSquare && e.id !== mover.id
      );

      patchEntry(mover.id, { moving: true, preGlitch: true });
      beep("glitch");
      await sleep(timings.preGlitchMs);

      burst(fromIdx, 12);
      patchEntry(mover.id, { preGlitch: false, hidden: true });
      await sleep(timings.gapMs);

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
      await sleep(timings.shakeMs);
      patchEntry(mover.id, { glitchIn: false, moving: false });
      setShake(false);

      if (move.secondary) {
        await glideEntry(move.secondary.from, move.secondary.to);
      }

      if (move.promotion) {
        await morphPromotion(move.to, move.promotion);
      }
    },
    [patchEntry, updateEntries, burst, glideEntry, morphPromotion]
  );

  const glitchCapture = useCallback(
    async (move: MoveRender) => {
      animatingRef.current = true;
      await glitchCaptureAnim(move);
      animatingRef.current = false;
    },
    [glitchCaptureAnim]
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

  // Wave D: "replay the takedown" as a lead-up cinematic instead of just
  // re-playing the shatter in place. Owner feedback, verbatim: "play the
  // last three moves or four moves without delays in between but not too
  // fast... that way I just see the act of the Queen checkmating the King
  // but I get to see what was my lead up."
  //
  // Resets entries to `startFen` (the position before the first replayed
  // ply — see replayPlan in src/game/replay.ts) and replays `moves`
  // back-to-back: every ply but the last at the quickened cinematic pace
  // with a small beat after it, the FINAL ply (the mate move) at full
  // normal pace, flowing straight into the existing `takedown` glide+
  // shatter finale — no separate animation path, no beat before it.
  //
  // animatingRef stays true for the ENTIRE call (set once here, not toggled
  // per-ply by glideAnim/glitchCaptureAnim, which deliberately don't touch
  // it) so clicks stay gated through the beats too, not just each
  // individual glide. `takedown` itself still toggles the ref around its
  // own body, but since it's already true when we call it and it clears the
  // ref only once its shatter finishes, that's exactly where the whole
  // cinematic should end anyway.
  //
  // Always resets fresh from `startFen`, so calling this again (re-running
  // the replay) never depends on where the previous run left off — unlike
  // the plain `takedown`, there's no "already at destination" branch to
  // reason about here.
  const replayCinematic = useCallback(
    async (startFen: string, moves: MoveRender[], takedownMove: Takedown) => {
      if (moves.length === 0) return;
      animatingRef.current = true;
      setCinematicActive(true);
      try {
        const initial = entriesFromFen(startFen);
        entriesRef.current = initial;
        setEntries(initial);

        const leadUp = moves.slice(0, -1);
        const finale = moves[moves.length - 1];

        for (const move of leadUp) {
          if (move.capture) await glitchCaptureAnim(move, CINEMATIC_CAPTURE_TIMINGS);
          else await glideAnim(move, CINEMATIC_GLIDE_MS, CINEMATIC_LAND_MS);
          await sleep(CINEMATIC_BEAT_MS);
        }

        if (finale.capture) await glitchCaptureAnim(finale);
        else await glideAnim(finale);

        await takedown(takedownMove);
      } finally {
        setCinematicActive(false);
        animatingRef.current = false;
      }
    },
    [glideAnim, glitchCaptureAnim, takedown]
  );

  // Full-screen win celebration — appended to document.body (not innerRef's
  // board rect) so it covers the whole viewport, not just the board. Fully
  // self-cleans: every particle removes itself on animation finish, and the
  // overlay removes itself after ~2.2s (~3.4s for `big` — Wave D's
  // replay-finish celebration, denser and longer-lived than the first-time
  // one, same overlay/parameters just scaled up rather than duplicated).
  const confetti = useCallback((opts?: { big?: boolean }) => {
    const big = opts?.big ?? false;
    const overlay = document.createElement("div");
    overlay.className = "gc-confetti-overlay" + (big ? " big" : "");
    document.body.appendChild(overlay);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const count = big ? CONFETTI_BIG_COUNT : CONFETTI_COUNT;
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
      const duration = (big ? 1900 : 1500) + Math.random() * (big ? 900 : 700);
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
    setTimeout(() => overlay.remove(), big ? CONFETTI_BIG_LIFE_MS : CONFETTI_LIFE_MS);
  }, []);

  // Loss celebration: an "electric storm" — screen-edge lightning flicker in
  // the glitch palette, driven entirely by the gcStormFlicker CSS keyframe
  // (see sugar-glitch.css). Non-blocking, ~2s, self-removing (~3.2s for
  // `big`, via the CSS `.big` modifier stretching the same keyframe).
  const storm = useCallback((opts?: { big?: boolean }) => {
    const big = opts?.big ?? false;
    const overlay = document.createElement("div");
    overlay.className = "gc-storm-overlay" + (big ? " big" : "");
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), big ? STORM_BIG_MS : STORM_MS);
  }, []);

  // Draw celebration (or lack thereof): a soft glow pulse on the board frame
  // itself rather than a full-screen effect — a draw isn't a win or a loss,
  // so it gets a quieter acknowledgment. `big` stretches the same
  // boardShimmer keyframe via the CSS `.big` modifier.
  const shimmer = useCallback((opts?: { big?: boolean }) => {
    const big = opts?.big ?? false;
    setGlow(big ? "big" : "normal");
    setTimeout(() => setGlow(false), big ? SHIMMER_BIG_MS : SHIMMER_MS);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ glide, glitchCapture, takedown, replayCinematic, confetti, storm, shimmer }),
    [glide, glitchCapture, takedown, replayCinematic, confetti, storm, shimmer]
  );

  const turn = fen.split(" ")[1] === "b" ? "b" : "w";

  // Rebuilt whenever fen changes (only ever while the board is idle — clicks
  // are gated behind animatingRef.current — so this always reflects the
  // settled position a selection is made against). Used both to resolve
  // clicks (castle-by-rook-click, reselect) and to compute legal-move
  // highlights for the current selection.
  const chess = useMemo(() => new Chess(fen), [fen]);

  // A2: while a move is pending, its origin is conceptually still
  // "selected" (the owner: "I want that piece selected and then I just
  // press another square..."), even though Board's own `selectedSquare`
  // state was already cleared before the pending click reached GamePage.
  // Everything that used to read `selectedSquare` for "what's selected
  // right now" (legal-move highlights, the target-hint ring) reads this
  // instead, so those highlights stay visible through pending, same as a
  // normal selection.
  const effectiveSelected = pending ? pending.from : selectedSquare;

  // Legal destination squares for the current selection, split into plain
  // moves and captures (en passant counts as a capture) so they can render
  // with different mint treatments. When the selection is the king and
  // castling is legal, the rook's square is added to `normal` too — that's
  // the affordance for Part 1's castle-by-rook-click (and, during pending,
  // the A2 retarget-by-rook-click affordance).
  const legalTargets = useMemo(() => {
    const normal = new Set<string>();
    const capture = new Set<string>();
    if (!effectiveSelected) return { normal, capture };
    if (!chess.get(effectiveSelected as Square)) return { normal, capture };
    const moves = chess.moves({ square: effectiveSelected as Square, verbose: true });
    const rank = effectiveSelected[1];
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
  }, [chess, effectiveSelected]);

  const handlePieceClick = useCallback(
    (square: string, color: PieceColor) => {
      if (animatingRef.current) return;

      // A2: pending retarget/cancel/reselect state machine replaces the old
      // blanket `locked` gate. resolvePendingClick is the pinned decision —
      // see src/game/resolvePendingClick.ts for the branch-by-branch spec.
      if (pending) {
        const decision = resolvePendingClick(chess, pending, square);
        if (decision.action === "cancel") {
          onCancelPending?.();
        } else if (decision.action === "retarget") {
          onRetarget?.(decision.to);
        } else if (decision.action === "select") {
          // A5: this reselect specifically happened because the king was
          // pending and this rook-click isn't a legal castle right now —
          // surface the hint instead of failing silently.
          if (decision.castleBlocked) onInputHint?.("can't castle right now");
          onCancelPending?.();
          setSelectedSquare(decision.square);
          beep("select");
        }
        // "noop": illegal square / uncapturable enemy piece — do nothing.
        return;
      }

      // A3: clicking the currently selected piece deselects it.
      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      if (selectedSquare) {
        const result = resolveClickMove(chess, selectedSquare, square);
        if (result === "reselect") {
          if (color !== turn) return; // defensive: reselect only ever targets an own piece
          // A5: same king+own-rook-click-but-illegal-castle case as above,
          // outside of any pending state.
          if (isCastleAttempt(chess, selectedSquare, square)) {
            onInputHint?.("can't castle right now");
          }
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
    [selectedSquare, onMove, turn, chess, pending, onRetarget, onCancelPending, onInputHint]
  );

  const handleSquareClick = useCallback(
    (square: string) => {
      if (animatingRef.current) return;

      if (pending) {
        const decision = resolvePendingClick(chess, pending, square);
        if (decision.action === "cancel") onCancelPending?.();
        else if (decision.action === "retarget") onRetarget?.(decision.to);
        // "select" can't arise from an empty-square click (no piece to
        // reselect there); "noop" already does nothing.
        return;
      }

      if (!selectedSquare) return;
      const from = selectedSquare;
      setSelectedSquare(null);
      onMove(from, square);
    },
    [selectedSquare, onMove, pending, chess, onCancelPending, onRetarget]
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

  // Guardian Angel pending-move (C1) ghost: rendered from the (still
  // pre-move) entry at pending.from, on pending.to — never by mutating
  // `entries`, so the underlying fen/mirror stay untouched until confirm.
  const pendingOrigin = pending ? entries.find((e) => e.square === pending.from) : undefined;
  const pendingGhostKind = pending?.promotion ? (pending.promotion as PieceKind) : pendingOrigin?.kind;
  // A1: full final-state preview — the castling rook (if any) ghosts at its
  // own destination the same way the mover does, and the square a capture
  // would empty (capturedSquare for en passant, else `to`) gets dimmed too.
  // Still never touches `entries` — pure overlay, exactly like the ghost.
  const pendingRookOrigin =
    pending?.secondary ? entries.find((e) => e.square === pending.secondary!.from) : undefined;
  const pendingVictimSquare = pending ? pending.capturedSquare ?? pending.to : undefined;

  return (
    <div className="stage">
      <div
        className={
          "board-frame" +
          (shake ? " shake" : "") +
          (glow ? " shimmer" : "") +
          (glow === "big" ? " big" : "")
        }
      >
        <div className="board-inner" ref={innerRef}>
          <div className="squares">
            {Array.from({ length: 64 }, (_, idx) => {
              const square = idxToSquare(idx);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              const light = (row + col) % 2 === 0;
              // Wave D: suppressed mid-cinematic — these overlays are all
              // derived from GamePage's fen/lastMove/hintReveal, which still
              // describe the TRUE final position while entries are
              // temporarily showing an earlier lead-up frame.
              const isCheckRing = !cinematicActive && square === checkSquare && !matedKingGone;
              const isLastMove =
                !cinematicActive && !!lastMove && (square === lastMove.from || square === lastMove.to);
              const isHintReveal =
                !cinematicActive && !!hintReveal && (square === hintReveal.from || square === hintReveal.to);
              const classes = [
                "sq",
                light ? "light" : "dark",
                corruptIdx.has(idx) ? "corrupt" : "",
                isLastMove ? "last-move" : "",
                square === effectiveSelected ? "target-hint" : "",
                legalTargets.capture.has(square) ? "hint-capture" : "",
                legalTargets.normal.has(square) ? "hint" : "",
                isHintReveal ? "hint-reveal" : "",
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
                // A1: dim the mover's origin, the castling rook's origin
                // (if any), and the square a capture would clear out —
                // the full final-state preview, not just the mover ghost.
                pending && e.square === pending.from ? "pending-dim" : "",
                pending && pending.secondary && e.square === pending.secondary.from ? "pending-dim" : "",
                pending && pendingVictimSquare && e.square === pendingVictimSquare ? "pending-dim" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={e.id}
                  className={classes}
                  data-square={e.square}
                  style={{
                    left: col * 12.5 + "%",
                    top: row * 12.5 + "%",
                    visibility: e.hidden ? "hidden" : "visible",
                    // Wave D: overrides the CSS transition-duration (left/top
                    // glide) for the cinematic replay's quickened lead-up
                    // plies — see glideEntry. Undefined leaves the CSS
                    // default (500ms) for every ordinary move.
                    transitionDuration: e.moveDurationMs ? `${e.moveDurationMs}ms` : undefined,
                  }}
                  onClick={() => handlePieceClick(e.square, e.color)}
                >
                  <Piece kind={e.kind} color={e.color} />
                </div>
              );
            })}
            {pending && pendingOrigin && pendingGhostKind && (() => {
              const idx = squareToIdx(pending.to);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              return (
                <div
                  key="pending-ghost"
                  className="pc pending-ghost"
                  data-square={pending.to}
                  style={{ left: col * 12.5 + "%", top: row * 12.5 + "%" }}
                >
                  <Piece kind={pendingGhostKind} color={pendingOrigin.color} />
                </div>
              );
            })()}
            {pending && pending.secondary && pendingRookOrigin && (() => {
              const idx = squareToIdx(pending.secondary.to);
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              return (
                <div
                  key="pending-ghost-rook"
                  className="pc pending-ghost"
                  data-square={pending.secondary.to}
                  style={{ left: col * 12.5 + "%", top: row * 12.5 + "%" }}
                >
                  <Piece kind={pendingRookOrigin.kind} color={pendingRookOrigin.color} />
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
});
