// Ported verbatim from Sugar Glitch Demo.html's hidden <svg> defs block:
// two gradients (grad-sg-w, grad-sg-b) and six piece <symbol> defs.
import type { CSSProperties } from "react";

export function PieceDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="grad-sg-w" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D6F4FF" />
          <stop offset=".55" stopColor="#8ED9F9" />
          <stop offset="1" stopColor="#5FB8E8" />
        </linearGradient>
        <linearGradient id="grad-sg-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD3E7" />
          <stop offset=".55" stopColor="#FF8FBF" />
          <stop offset="1" stopColor="#F0619E" />
        </linearGradient>
        <symbol id="pc-p" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="10" ry="1.8" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M22.5 9.5c-2.6 0-4.7 2.1-4.7 4.7 0 1.5.7 2.9 1.9 3.8-2.4 1.4-3.9 4-3.9 6.7 0 1.9.7 3.7 1.9 5.1-2.9 1.4-4.9 4.3-4.9 7.5v1.2h19.4v-1.2c0-3.2-2-6.1-4.9-7.5 1.2-1.4 1.9-3.2 1.9-5.1 0-2.7-1.5-5.3-3.9-6.7 1.2-.9 1.9-2.3 1.9-3.8 0-2.6-2.1-4.7-4.7-4.7z"
          />
          <ellipse cx="20" cy="13" rx="1.6" ry="2.1" fill="#fff" opacity=".55" />
        </symbol>
        <symbol id="pc-r" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="11" ry="1.8" fill="#000" opacity=".12" />
          <g fill="var(--fill)" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M11.5 39h22l-1.6-3.6H13.1zM13.8 34h17.4l-1.2-2.8H15zM15.5 29.8h14v-12h-14zM13 16.5V9h4.4v3h3.3V9h3.6v3h3.3V9H32v7.5l-2.2 1.8H15.2z" />
          </g>
          <ellipse cx="18.5" cy="22" rx="1.6" ry="4.2" fill="#fff" opacity=".4" />
        </symbol>
        <symbol id="pc-n" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="11" ry="1.8" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M14 39h19c.5-11-1.5-22.5-11.5-25.5l-.8-4-3 2.6c-2.7 1-4.2 3.6-4.2 5.9l3.7 3 2.4-1.9c.7 4.5-2.2 6.7-4 9.7-1.9 3.2-2.3 7-1.6 10.2z"
          />
          <circle cx="17.2" cy="17" r="1.1" fill="var(--line)" />
          <ellipse cx="26.5" cy="24" rx="1.9" ry="5" fill="#fff" opacity=".35" />
        </symbol>
        <symbol id="pc-b" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="10.5" ry="1.8" fill="#000" opacity=".12" />
          <g fill="var(--fill)" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round">
            <circle cx="22.5" cy="9.3" r="2.3" />
            <path d="M22.5 12.5c-4.6 2.6-7.5 7-7.5 11 0 2.4.9 4.6 2.5 6.2l-2.3 3.6h14.6l-2.3-3.6c1.6-1.6 2.5-3.8 2.5-6.2 0-4-2.9-8.4-7.5-11z" />
            <path d="M12.5 39h20l-1.7-3.4H14.2z" />
          </g>
          <path d="M22.5 18v7M19.5 21.5h6" stroke="var(--line)" strokeWidth="1.4" fill="none" />
        </symbol>
        <symbol id="pc-q" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="11.5" ry="1.8" fill="#000" opacity=".12" />
          <g fill="var(--fill)" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M22.5 10l2.6 8.2 6-5.4-1.2 8.6 6.8-2.8-3.9 8.9c1.3 4.5-.7 8.2-2.5 10.5h-15.6c-1.8-2.3-3.8-6-2.5-10.5l-3.9-8.9 6.8 2.8-1.2-8.6 6 5.4z" />
            <path d="M12 39h21l-1.7-3.4H13.7z" />
          </g>
          <circle cx="22.5" cy="8.6" r="1.7" fill="var(--fill)" stroke="var(--line)" strokeWidth="1.3" />
          <circle cx="13.4" cy="11.5" r="1.4" fill="var(--fill)" stroke="var(--line)" strokeWidth="1.2" />
          <circle cx="31.6" cy="11.5" r="1.4" fill="var(--fill)" stroke="var(--line)" strokeWidth="1.2" />
        </symbol>
        <symbol id="pc-k" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="40" rx="11.5" ry="1.8" fill="#000" opacity=".12" />
          <g fill="var(--fill)" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M21.2 5.5h2.6v2.8h2.8v2.6h-2.8v2.8h-2.6v-2.8h-2.8V8.3h2.8z" />
            <path d="M22.5 15.2c-5.9 0-9.8 4.7-9.8 9.4 0 3.8 2.3 7.5 4.7 9.4h10.2c2.4-1.9 4.7-5.6 4.7-9.4 0-4.7-3.9-9.4-9.8-9.4z" />
            <path d="M12 39h21l-1.7-3.4H13.7z" />
          </g>
        </symbol>
      </defs>
    </svg>
  );
}

export type PieceKind = "p" | "r" | "n" | "b" | "q" | "k";
export type PieceColor = "w" | "b";

const GLYPH: Record<PieceKind, string> = {
  p: "pc-p",
  r: "pc-r",
  n: "pc-n",
  b: "pc-b",
  q: "pc-q",
  k: "pc-k",
};

export function Piece({ kind, color }: { kind: PieceKind; color: PieceColor }) {
  const isWhite = color === "w";
  return (
    <svg
      className={`piece ${color}`}
      viewBox="0 0 45 45"
      style={
        {
          "--fill": `url(#grad-sg-${isWhite ? "w" : "b"})`,
          "--line": isWhite ? "#3E8FC7" : "#C74A85",
        } as CSSProperties
      }
    >
      <use href={`#${GLYPH[kind]}`} />
    </svg>
  );
}
