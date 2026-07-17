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
  { key: "analysis", label: "analysis — coming with the coach" },
  { key: "streaks", label: "streaks and rating — coming with the dashboard" },
];

function resultText(result: string): string {
  if (result === "1-0") return "you win. mallow melts.";
  if (result === "0-1") return "mallow wins this one.";
  return "draw.";
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
      <div className="result">{resultText(gameOver.result)}</div>
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
        New game
      </button>
    </div>
  );
}
