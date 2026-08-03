// Opponent-move-analysis plan (2026-08-03), Wave B: the MAGENTA drawer --
// the mallow moves she highlighted, mounted by DebriefPage directly below
// the cyan study ledger. Proposal of record: vault
// "3 visual/opponent-drawer-proposal.html" (owner-approved, OD-D).
//
// One anatomy, two seats: this mirrors HighlightedMovesSection's accordion
// EXACTLY (37.5px candy rows; first open by default; one open at a time;
// single row = no caret, head is a plain statement) so she learns one
// interaction. The voice swap is carried by the mhl-* classes alone (dot,
// chips, card tint, card kicker, SAN ink -> the #C22B7E/#FFD6EC family);
// the neutral furniture (white rows, section kicker, move numbers, caret)
// is the cyan ledger's own classes, reused verbatim.
//
// Register: the open card is a STATEMENT (flat magenta tint + inset left
// rule) -- the machine analyzing mallow, never whisper-tier (whisper is
// character speech only). Buttons: replay + `ask cookie about this` ONLY --
// no try-the-line (OD-C: the sandbox plays HER side; "trying" mallow's
// better move would be a confusing inversion). The ask button stays
// cookie's lavender .debrief-ask-btn recipe deliberately: it is cookie's
// own affordance (it names cookie, it opens cookie), not mallow's voice.
//
// Zero rows: DebriefPage never mounts this (and rows.length === 0 returns
// null here too) -- no ghost chrome, the dead-chrome ruling. Render-only
// over buildMallowHighlightedRows; no LLM anywhere in the debrief path.
import { useState } from "react";
import type { MallowHighlightedRow, MallowChip } from "./mallowHighlightedMoves";

export interface MallowHighlightedSectionProps {
  /** Already built (buildMallowHighlightedRows), in game order. */
  rows: MallowHighlightedRow[];
  /** The debrief's existing rewind handler -- same prop the cyan ledger uses. */
  onRewind: (ply: number) => void;
  /** The debrief's existing ask handler; Wave C makes it work for mallow
   *  plies (today it is a silent no-op there -- the button still wires to
   *  it so Wave C changes no markup). */
  onAskAboutPly: (ply: number) => void;
  /** Same disabled-while-exploring rule as every other debrief button --
   *  never disables the accordion itself. */
  exploring: boolean;
}

function chipClass(chip: MallowChip): string {
  switch (chip) {
    case "the computer's pick":
      return "highlight-chip mhl-chip-best";
    case "solid":
      return "highlight-chip mhl-chip-solid";
    case "mallow slipped":
      return "highlight-chip mhl-chip-slip";
    case "no read":
      return "highlight-chip mhl-chip-noread";
  }
}

export function MallowHighlightedSection({
  rows,
  onRewind,
  onAskAboutPly,
  exploring,
}: MallowHighlightedSectionProps) {
  // First open by default; null = she deliberately collapsed the open one;
  // a stale ply falls back to the first row -- the cyan ledger's exact
  // state machine.
  const [openPly, setOpenPly] = useState<number | null>(rows[0]?.ply ?? null);
  if (rows.length === 0) return null;
  const single = rows.length === 1;
  const shownOpen =
    openPly === null ? null : rows.some((r) => r.ply === openPly) ? openPly : rows[0].ply;

  return (
    <div className="highlight-ledger">
      <span className="debrief-bullet-kicker">
        mallow's moves you highlighted · {rows.length} move{rows.length === 1 ? "" : "s"}
      </span>
      {rows.map((row) => {
        if (row.ply !== shownOpen && !single) {
          return (
            <button
              key={row.ply}
              type="button"
              className="highlight-ledger-row"
              aria-expanded={false}
              onClick={() => setOpenPly(row.ply)}
            >
              <span className="mhl-dot" aria-hidden="true" />
              <span className="highlight-ledger-num">{row.moveNumber}.</span>
              <span className="highlight-ledger-phrase">{row.phrase}</span>
              <span className={chipClass(row.chip)}>{row.chip}</span>
              <span className="highlight-caret" aria-hidden="true" />
            </button>
          );
        }
        const head = (
          <>
            <span className="mhl-dot" aria-hidden="true" />
            <span className="mhl-card-kicker">move {row.moveNumber} · mallow's move</span>
            <span className={chipClass(row.chip)}>{row.chip}</span>
            {!single && <span className="highlight-caret highlight-caret-up" aria-hidden="true" />}
          </>
        );
        return (
          <div className="mhl-card" key={row.ply}>
            {single ? (
              // One highlight: nothing to collapse into, so the head is a
              // pure machine statement, not a pressable.
              <div className="highlight-card-head">{head}</div>
            ) : (
              <button
                type="button"
                className="highlight-card-head"
                aria-expanded={true}
                onClick={() => setOpenPly(null)}
              >
                {head}
              </button>
            )}
            <div className="highlight-card-move">
              <span className="highlight-card-phrase">{row.phrase}</span>
              <span className="mhl-card-san">{row.san}</span>
            </div>
            <p className="highlight-card-note">{row.note}</p>
            <div className="highlight-card-actions">
              <button className="small debrief-replay-btn" disabled={exploring} onClick={() => onRewind(row.ply)}>
                replay
              </button>
              <button className="small debrief-ask-btn" disabled={exploring} onClick={() => onAskAboutPly(row.ply)}>
                ask cookie about this
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
