import type { GameOverInfo } from "./api";
import type { Takedown } from "./terminal";

interface StubSection {
  key: string;
  label: string;
}

// Labeled seams for increments 3/4 to extend — kept as an array (not
// hand-rolled JSX per section) so a future increment adds a row here
// instead of restructuring this component.
const STUB_SECTIONS: StubSection[] = [
  { key: "analysis", label: "analysis, coming with the coach" },
  { key: "streaks", label: "streaks and rating, coming with the dashboard" },
];

function resultText(result: string): string {
  if (result === "1-0") return "you win. mallow melts.";
  if (result === "0-1") return "mallow wins this one.";
  return "draw.";
}

// Win only gets the wordmark's layered glitch construction (celebration
// scale) — loss and draw stay plain text at the existing 20px .result
// style. Three of the four layers are aria-hidden so a screen reader
// still gets a single clean readout from .wt-base.
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
  return resultText(result);
}

interface GameEndPanelProps {
  gameOver: GameOverInfo;
  takedownMove: Takedown | null;
  onReplayTakedown: () => void;
  onNewGame: () => void;
}

export function GameEndPanel({ gameOver, takedownMove, onReplayTakedown, onNewGame }: GameEndPanelProps) {
  return (
    <div className="game-over pop-in">
      <div className="result">{renderResult(gameOver.result)}</div>
      {takedownMove && (
        <button className="small" onClick={onReplayTakedown}>
          replay the takedown
        </button>
      )}
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
