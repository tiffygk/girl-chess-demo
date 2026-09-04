import { PieceDefs } from "./board/pieces";
import { GamePage } from "./game/GamePage";
import { ErrorBoundary } from "./ErrorBoundary";
import "./skin/sugar-glitch.css";

function App() {
  return (
    <div className="gc-app">
      <PieceDefs />
      <ErrorBoundary>
        <GamePage />
      </ErrorBoundary>
    </div>
  );
}

export default App;
