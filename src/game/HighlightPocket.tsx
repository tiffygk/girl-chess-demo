// Highlight-a-move (Task 3): the bar pocket — the live control for flagging
// a move she was unsure about. Mockup of record: vault "3 visual/Girl Chess
// — Mark a Move (mockup, 2026-07-28).html", direction D2 (owner ruling),
// ported with the owner's word: highlight, never mark. A 24px candy pill in
// her own player bar (next to the turn chip) opens a 216px popover tray
// anchored 8px above the bar's right edge, listing her last three moves
// newest first (markableWindow). Once anything is highlighted the pill
// carries a 7px cyan dot, so the state survives the tray closing.
//
// The pill is a SIBLING control in the player bar — it never touches the
// move-confirm affordance ("confirm g4, tap it again"), which is a defect to
// change, not a refactor (owner ruling). While a move is pending confirm the
// caller passes disabled=true (the shipped togglesDisabled rule) and the
// tray closes: while the game is asking a question, the annotation tool
// goes quiet, so the two controls can never be active at once.
//
// The leading glyph is the control's own 7px checkbox ring, NOT a flag — in
// a chess app a flag reads as resign / lose on time, exactly the game-action
// confusion the falsification test forbids.
import { useEffect, useState } from "react";
import type { LiveMove } from "./liveMoves";

export interface HighlightPocketProps {
  /** Already windowed (markableWindow), newest first — her moves only. */
  moves: LiveMove[];
  onToggle: (ply: number, on: boolean) => void;
  /** The shipped togglesDisabled rule: true while uiBusy or a move pends. */
  disabled: boolean;
}

export function HighlightPocket({ moves, onToggle, disabled }: HighlightPocketProps) {
  const [open, setOpen] = useState(false);
  // A pending confirm closes the tray (and the disabled pill won't reopen
  // it) — state (the cyan dot) stays visible even dimmed; only the action
  // is withdrawn.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const anyHighlighted = moves.some((m) => m.highlighted);
  // Renders null until a markable move exists — no dead chrome at game
  // start (the 2026-07-22 dead-chrome ruling; guarded by the
  // "pocket is empty before her first move" test in liveMoves.test.ts).
  if (moves.length === 0) return null;
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
          {moves.map((m) => (
            <button
              key={m.ply}
              type="button"
              className={"highlight-toggle" + (m.highlighted ? " highlighted" : "")}
              aria-pressed={m.highlighted}
              onClick={() => onToggle(m.ply, !m.highlighted)}
            >
              <span className="highlight-ring" aria-hidden="true" />
              <span className="highlight-toggle-num">{Math.ceil(m.ply / 2)}.</span>
              <span className="highlight-toggle-san">{m.san}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
