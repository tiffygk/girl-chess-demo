// Highlight-a-move (Task 3): the bar pocket — the live control for flagging
// a move she was unsure about. Mockup of record: vault "3 visual/Girl Chess
// — Mark a Move (mockup, 2026-07-28).html", direction D2 (owner ruling),
// ported with the owner's word: highlight, never mark. A 24px candy pill in
// her own player bar (next to the turn chip) opens a popover tray anchored
// 8px above the bar's right edge. Once anything is highlighted the pill
// carries a 7px cyan dot, so the state survives the tray closing.
//
// W5 (opponent-move highlight, shipped 2026-08-02 — proposal of record:
// vault "3 visual/opponent-move-highlight-proposal.html", owner-approved):
// the tray's rows are move-PAIR badge rows now. Her move badge on the LEFT
// in her cyan voice, mallow's reply badge to its RIGHT in mallow's magenta
// (mallow is the OPPONENT — never lavender, that's cookie's). SAN is
// machine move data, so the badges are SHARP (Chakra Petch 700, chamfered
// clip-path, hard drop-shadow, no press shadow — you cannot press words).
// Resting = light outline chip; highlighted = SOLID pour of the seat's
// saturated voice. Each badge toggles on its own and BOTH can be lit at
// once (owner ruling 2026-08-02, non-exclusive — lighting hers never
// clears mallow's, and vice versa). Seats come from each datum's `side`
// field, never from ply parity (the ply-parity-encode-in-types rule).
//
// The pill is a SIBLING control in the player bar — it never touches the
// move-confirm affordance ("confirm g4, tap it again"), which is a defect to
// change, not a refactor (owner ruling). While a move is pending confirm the
// caller passes disabled=true (the shipped togglesDisabled rule) and the
// tray closes: while the game is asking a question, the annotation tool
// goes quiet, so the two controls can never be active at once.
import { useEffect, useState } from "react";
import type { LiveMove, MovePair } from "./liveMoves";

interface BadgeProps {
  move: LiveMove;
  onToggle: (ply: number, on: boolean) => void;
}

// One badge — seat class comes from the DATUM's side, nothing else.
function MoveBadge({ move, onToggle }: BadgeProps) {
  const seat = move.side === "her" ? "mv-you" : "mv-mallow";
  return (
    <button
      type="button"
      className={"mv-badge " + seat + (move.highlighted ? " lit" : "")}
      aria-pressed={move.highlighted}
      onClick={() => onToggle(move.ply, !move.highlighted)}
    >
      <span className="mv-body">{move.san}</span>
    </button>
  );
}

export interface MovePairRowProps {
  pair: MovePair;
  onToggle: (ply: number, on: boolean) => void;
}

// Exported for the render tests (the DebriefPage.test.tsx pattern): the
// pair row is pure render over its pair datum — no effects, no state.
export function MovePairRow({ pair, onToggle }: MovePairRowProps) {
  return (
    <div className="highlight-pair-row">
      <span className="mv-num">{pair.moveNumber}.</span>
      {pair.her && <MoveBadge move={pair.her} onToggle={onToggle} />}
      {pair.mallow && <MoveBadge move={pair.mallow} onToggle={onToggle} />}
    </div>
  );
}

export interface HighlightPocketProps {
  /** Already windowed (pairWindow), newest pair first. */
  pairs: MovePair[];
  onToggle: (ply: number, on: boolean) => void;
  /** The shipped togglesDisabled rule: true while uiBusy or a move pends. */
  disabled: boolean;
}

export function HighlightPocket({ pairs, onToggle, disabled }: HighlightPocketProps) {
  const [open, setOpen] = useState(false);
  // A pending confirm closes the tray (and the disabled pill won't reopen
  // it) — state (the cyan dot) stays visible even dimmed; only the action
  // is withdrawn.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const anyHighlighted = pairs.some((p) => p.her?.highlighted || p.mallow?.highlighted);
  // Renders null until a markable move exists — no dead chrome at game
  // start (the 2026-07-22 dead-chrome ruling; guarded by the
  // "pocket is empty before her first move" test in liveMoves.test.ts).
  if (pairs.length === 0) return null;
  return (
    <div className="highlight-pocket">
      <button
        type="button"
        className="highlight-pill"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="highlight-ring" aria-hidden="true" />
        highlight
        {anyHighlighted && <span className="highlight-pill-dot" aria-hidden="true" />}
      </button>
      {open && !disabled && (
        <div className="highlight-tray" role="group" aria-label="highlight a move you weren't sure about">
          <span className="highlight-tray-kicker">highlight a move you weren't sure about</span>
          {pairs.map((p) => (
            <MovePairRow key={p.moveNumber} pair={p} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
