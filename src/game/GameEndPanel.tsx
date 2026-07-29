import type { ReactNode } from "react";
import type { GameOverInfo } from "./api";
import type { Takedown } from "./terminal";
import { RESULT_COPY, resultText } from "./endCopy";

interface StubSection {
  key: string;
  label: string;
}

// Labeled seam for increment 4 to extend — kept as an array (not
// hand-rolled JSX per section) so a future increment adds a row here
// instead of restructuring this component. The "analysis" stub this used to
// carry is now the real debrief (increment 3c) — see the `debrief` prop.
const STUB_SECTIONS: StubSection[] = [
  { key: "streaks", label: "streaks and rating, coming with the dashboard" },
];

// All three endings wear the wordmark's layered glitch construction
// (owner ruling 2026-07-29) — win keeps its melt shear, draw and loss get
// flat bases in their own inks. The ghost layers are aria-hidden so a
// screen reader still gets a single clean readout per title.
function renderResult(result: string) {
  if (result === "1-0") {
    return (
      <span className="win-title">
        <span className="wt-layer wt-cyan" aria-hidden="true">
          you win. mallow melts.
        </span>
        <span className="wt-layer wt-mag" aria-hidden="true">
          you win. mallow melts.
        </span>
        <span className="wt-layer wt-shadow" aria-hidden="true">
          you win. mallow melts.
        </span>
        <span className="wt-base">
          you win. mallow{" "}
          <span className="wt-melt">
            <span className="wt-melt-top">melts.</span>
            <span className="wt-melt-bottom" aria-hidden="true">
              melts.
            </span>
          </span>
        </span>
      </span>
    );
  }
  if (result === "1/2-1/2") {
    const copy = RESULT_COPY["1/2-1/2"];
    return (
      <span className="draw-title">
        <span className="dt-layer dt-cyan" aria-hidden="true">{copy}</span>
        <span className="dt-layer dt-mag" aria-hidden="true">{copy}</span>
        <span className="dt-layer dt-shadow" aria-hidden="true">{copy}</span>
        <span className="dt-base">{copy}</span>
      </span>
    );
  }
  if (result === "0-1") {
    const copy = RESULT_COPY["0-1"];
    return (
      <span className="loss-title">
        <span className="lt-layer lt-cyan" aria-hidden="true">{copy}</span>
        <span className="lt-layer lt-mag" aria-hidden="true">{copy}</span>
        <span className="lt-layer lt-shadow" aria-hidden="true">{copy}</span>
        <span className="lt-base">{copy}</span>
      </span>
    );
  }
  return resultText(result);
}

interface GameEndPanelProps {
  gameOver: GameOverInfo;
  takedownMove: Takedown | null;
  onReplayTakedown: () => void;
  onNewGame: () => void;
  // Increment 3c: the debrief (lesson line + turning-point cards), rendered
  // in the same visual cluster as the board per the UX research — null
  // while the summary fetch is still in flight.
  debrief?: ReactNode;
}

export function GameEndPanel({ gameOver, takedownMove, onReplayTakedown, onNewGame, debrief }: GameEndPanelProps) {
  return (
    <div className="game-over pop-in">
      <div className="result">{renderResult(gameOver.result)}</div>
      {takedownMove && (
        <button className="small" onClick={onReplayTakedown}>
          replay the takedown
        </button>
      )}
      {debrief}
      <div className="game-end-stubs">
        {STUB_SECTIONS.map((section) => (
          <div key={section.key} className="game-end-stub">
            {section.label}
          </div>
        ))}
      </div>
      <button className="primary" onClick={onNewGame}>
        new game
      </button>
    </div>
  );
}
