// Highlight-a-move (Task 6): the study ledger — the debrief section where
// her live highlights land. Mockup of record: vault "3 visual/Girl Chess —
// Highlighted Moves Section (mockup, 2026-07-28).html", direction D2 (owner
// ruling). Each highlight rests as a 37.5px candy row (dot · move number ·
// plain phrase · verdict chip · caret); tapping a row opens it into the
// full flat-cyan card. Exactly one open at a time; the first highlight
// opens by default, so a single highlight renders already-open and costs
// no tap (and, with nothing to collapse into, carries no caret).
//
// Verdict chips read `done well` / `could be better` — deliberately the
// bullet sections' own vocabulary (owner ruling 2026-07-28): the chip and
// the section mean the same thing, so she learns ONE vocabulary for the
// whole analysis. Never disambiguated, never capitalised.
//
// `try the line` is ABSENT when canTryLine is false — no better line
// exists, so the button would be a lie (owner ruling). Zero highlights:
// DebriefPage never mounts this section (and rows.length === 0 returns
// null here too) — no ghost chrome, per the 2026-07-22 dead-chrome ruling.
// Render-only over buildHighlightedRows (highlightedMoves.ts); the three
// buttons reuse the turning-point cards' exact classes and their
// disabled-while-exploring rule.
import { useState } from "react";
import type { SummaryMove } from "../game/api";
import type { HighlightedRow } from "./highlightedMoves";

export interface HighlightedMovesSectionProps {
  /** Already built (buildHighlightedRows), in game order. */
  rows: HighlightedRow[];
  /** For the open card's SAN token beside the plain phrase (true case). */
  gameSans: SummaryMove[];
  onRewind: (ply: number) => void;
  onTryLine: (ply: number) => void;
  onAskAboutPly: (ply: number) => void;
  /** Same "the live board can't be yanked out from under itself" rule as
   *  every other debrief button — disables replay/try/ask, never the
   *  accordion itself (reading her list stays free while a sandbox runs). */
  exploring: boolean;
}

function chipClass(verdict: HighlightedRow["verdict"]): string {
  return verdict === "done well" ? "highlight-chip highlight-chip-done" : "highlight-chip highlight-chip-better";
}

export function HighlightedMovesSection({
  rows,
  gameSans,
  onRewind,
  onTryLine,
  onAskAboutPly,
  exploring,
}: HighlightedMovesSectionProps) {
  // First open by default. null = she deliberately collapsed the open one;
  // a stale ply (rows changed under a kept-mounted debrief, e.g. a new
  // reviewed game) falls back to the first row rather than pointing at a
  // moment that no longer exists.
  const [openPly, setOpenPly] = useState<number | null>(rows[0]?.ply ?? null);
  if (rows.length === 0) return null;
  const single = rows.length === 1;
  const shownOpen =
    openPly === null ? null : rows.some((r) => r.ply === openPly) ? openPly : rows[0].ply;

  return (
    <div className="highlight-ledger">
      <span className="debrief-bullet-kicker">
        {/* OD-D detail (owner ruling, 2026-08-03): names the seat so it
            parallels the magenta sibling's "mallow's moves you highlighted".
            Reversible copy. */}
        your moves you highlighted · {rows.length} move{rows.length === 1 ? "" : "s"}
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
              <span className="highlight-dot" aria-hidden="true" />
              <span className="highlight-ledger-num">{row.moveNumber}.</span>
              <span className="highlight-ledger-phrase">{row.phrase}</span>
              <span className={chipClass(row.verdict)}>{row.verdict}</span>
              <span className="highlight-caret" aria-hidden="true" />
            </button>
          );
        }
        const san = gameSans.find((m) => m.ply === row.ply)?.san;
        const head = (
          <>
            <span className="highlight-dot" aria-hidden="true" />
            <span className="highlight-card-kicker">move {row.moveNumber} · you highlighted</span>
            <span className={chipClass(row.verdict)}>{row.verdict}</span>
            {!single && <span className="highlight-caret highlight-caret-up" aria-hidden="true" />}
          </>
        );
        return (
          <div className="highlight-card" key={row.ply}>
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
              {san && <span className="highlight-card-san">{san}</span>}
            </div>
            <p className="highlight-card-note">{row.note}</p>
            <div className="highlight-card-actions">
              <button className="small debrief-replay-btn" disabled={exploring} onClick={() => onRewind(row.ply)}>
                replay
              </button>
              {row.canTryLine && (
                <button className="small debrief-tryline-btn" disabled={exploring} onClick={() => onTryLine(row.ply)}>
                  try the line
                </button>
              )}
              <button className="small debrief-ask-btn" disabled={exploring} onClick={() => onAskAboutPly(row.ply)}>
                ask about this
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
