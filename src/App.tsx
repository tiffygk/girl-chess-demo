import { PieceDefs } from "./board/pieces";
import { GamePage } from "./game/GamePage";
import "./skin/sugar-glitch.css";

function App() {
  return (
    <div className="gc-app">
      <PieceDefs />
      <span className="px">GIRL CHESS</span>
      <div className="wordmark">
        <h1 className="glitch" data-text="Girl Chess">
          Girl Chess
        </h1>
        <p className="tagline">tutor with benefits</p>
      </div>
      <GamePage />
    </div>
  );
}

export default App;
