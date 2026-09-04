export function ServerDownNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="server-down" role="alert">
      <p>the game server is not running.</p>
      <p>in Terminal, inside the girl-chess-demo folder, run npm run dev, then click try again.</p>
      <button type="button" className="small" onClick={onRetry}>try again</button>
    </div>
  );
}
