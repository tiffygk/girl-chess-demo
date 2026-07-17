import { PieceDefs } from "./board/pieces";
import { GamePage } from "./game/GamePage";
import "./skin/sugar-glitch.css";

function App() {
  return (
    <div className="gc-app">
      <PieceDefs />
      <GamePage />
    </div>
  );
}

export default App;
