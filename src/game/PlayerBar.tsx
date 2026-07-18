import { Piece, type PieceColor, type PieceKind } from "../board/pieces";
import { pieceValue } from "./captures";

interface PlayerBarProps {
  seat: "mallow" | "you";
  /** Append-order captured pieces this side has taken; sorted for display only. */
  captured: PieceKind[];
  /** Sprite color to render the captured strip in (the color of the pieces taken). */
  capturedColor: PieceColor;
  /** "+N" material-lead badge value for THIS bar; null renders no badge. */
  materialLead: number | null;
  /** Active-turn visual treatment (highlight/glow on this bar). */
  active: boolean;
  /** Turn/state chip text (e.g. "your move", "thinking..."); null renders no chip. */
  chip: string | null;
  /** Fullmove counter, shown only on the bar that's asked to carry it. */
  moveNumber?: number | null;
  /** Mallow-only decline bark, anchored to this bar. */
  bark?: string | null;
  /** Rating to surface inside the name plate; null/undefined renders no rating. */
  elo?: number | null;
}

// Stable keys independent of display position: pairing each captured piece
// with its original (capture-order) index, then sorting by the same
// standard value scale sortByValue (captures.ts) uses — Array.sort's
// stability means this produces the exact same visual order sortByValue
// would, while a resort never changes a previously-captured piece's key.
// Only a genuinely new capture gets a new key, so React never remounts
// (and never replays the pop-in on) a piece already sitting in the tray.
function sortedWithKeys(pieces: PieceKind[]): { kind: PieceKind; origIndex: number }[] {
  return pieces
    .map((kind, origIndex) => ({ kind, origIndex }))
    .sort((a, b) => pieceValue(a.kind) - pieceValue(b.kind));
}

export function PlayerBar({
  seat,
  captured,
  capturedColor,
  materialLead,
  active,
  chip,
  moveNumber,
  bark,
  elo,
}: PlayerBarProps) {
  const label = seat === "mallow" ? "pieces mallow has captured" : "pieces you've captured";
  const sorted = sortedWithKeys(captured);

  return (
    <div className={`player-bar ${seat}${active ? " active" : ""}`}>
      <div className="bar-identity">
        {seat === "mallow" ? (
          <span className="name-plate np-mallow">
            <span className="np-body">
              <svg className="np-glyph" width="10" height="9" viewBox="0 0 7 6" aria-hidden="true">
                <path
                  fill="#FF3DA6"
                  d="M1 0h1v1h1v1h1V1h1V0h1v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"
                />
              </svg>
              <span className="np-name">
                <span className="np-name-real">mallow</span>
                <span className="np-name-glitch" aria-hidden="true">m4llow</span>
              </span>
              <span className="np-div" aria-hidden="true"></span>
              {elo != null && <span className="bar-elo">{elo}</span>}
            </span>
          </span>
        ) : (
          <span className="name-plate np-you">
            <span className="np-body">
              <svg className="np-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8z"
                  fill="#23E5FF"
                  stroke="#1A7A93"
                  strokeWidth="1"
                  strokeLinejoin="miter"
                />
              </svg>
              <span className="np-name">you</span>
              <span className="np-div" aria-hidden="true"></span>
              {elo != null && <span className="bar-elo">{elo}</span>}
            </span>
          </span>
        )}
        {typeof moveNumber === "number" && <span className="bar-move-count">move {moveNumber}</span>}
      </div>
      <div className="bar-captures" aria-label={label}>
        {sorted.map(({ kind, origIndex }) => (
          <div key={`${seat}-${origIndex}`} className="bar-piece pop-in">
            <Piece kind={kind} color={capturedColor} />
          </div>
        ))}
        {materialLead != null && <span className="bar-material-badge">+{materialLead}</span>}
      </div>
      <div className="bar-chip-slot">
        {chip && (
          <span
            key={chip}
            className={"bar-chip" + (chip === "thinking..." ? " tc-flicker" : "")}
            role="status"
            aria-live="polite"
          >
            {chip}
          </span>
        )}
      </div>
      {seat === "mallow" && bark && (
        <div className="bark-bubble pop-in" role="status">
          {bark}
        </div>
      )}
    </div>
  );
}
