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
        {/* ROUND 2 redraw (item 6): Pixar bodies from circle/ellipse unions,
            stroke 2.0, toy-gloss double-glint on every piece, ground shadows +2.
            The only miter joins in the physical world: crown spikes, king's
            cross, knight ears. bodies are candy, regalia is power. */}
        <symbol id="pc-p" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="41" rx="12" ry="2" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M22.5 18.5c-9.6 1.8-16.5 8.6-16.5 15.9 0 4.5 7.4 6.8 16.5 6.8s16.5-2.3 16.5-6.8c0-7.3-6.9-14.1-16.5-15.9z"
          />
          <circle cx="22.5" cy="12.5" r="8" fill="var(--fill)" stroke="var(--line)" strokeWidth="2" />
          <ellipse cx="17" cy="31" rx="4.2" ry="5.6" fill="#fff" opacity=".55" />
          <circle cx="26.3" cy="9.6" r="1.5" fill="#fff" opacity=".8" />
        </symbol>
        <symbol id="pc-r" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="41" rx="13" ry="2" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M14 15.5c-3.2 7.2-3.9 15.4-2.5 22.6 2.4 1.9 6.5 3.1 11 3.1s8.6-1.2 11-3.1c1.4-7.2.7-15.4-2.5-22.6z"
          />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M12.4 12.8c0-2.3 1.9-4.2 4.2-4.2.3 0 .6 0 .9.1.8-1.9 2.7-3.2 5-3.2s4.2 1.3 5 3.2c.3-.1.6-.1.9-.1 2.3 0 4.2 1.9 4.2 4.2 0 2-1.4 3.6-3.2 4.1H15.6c-1.8-.5-3.2-2.1-3.2-4.1z"
          />
          <ellipse cx="17" cy="28.5" rx="3.6" ry="6.5" fill="#fff" opacity=".55" />
          <circle cx="27.6" cy="11.5" r="1.4" fill="#fff" opacity=".8" />
        </symbol>
        <symbol id="pc-n" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="41" rx="13" ry="2" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="miter"
            strokeMiterlimit="8"
            d="M17.8 9 15.9 3l5.3 2.6z"
          />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="miter"
            strokeMiterlimit="8"
            d="M22.6 7.8 24 2.2l3.6 4.2z"
          />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M12.5 39.5H34c.9-11.5-1.1-23.5-12.4-26.7l-.9-4.2-3.2 2.8c-2.9 1.1-4.5 3.8-4.5 6.2l4 3.2 2.6-2c.7 4.8-2.4 7.1-4.3 10.3-2 3.4-2.5 7.4-1.3 10.4z"
          />
          <path
            d="M27.4 15.2c2 .5 3 2.2 2.4 3.9 2 .7 2.9 2.5 2.2 4.2 1.9.9 2.6 2.8 1.8 4.5"
            stroke="var(--line)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="18.9" cy="13.4" r="1.8" fill="var(--line)" />
          <circle cx="19.5" cy="12.8" r=".6" fill="#fff" />
          <path d="M13.4 16.2l2.3-.4-.9 2z" fill="var(--line)" />
          <path
            d="M12.9 15.2 9.3 14M12.7 17 8.9 17.2M13.1 18.7 9.7 20.1"
            stroke="var(--line)"
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M15.2 28.6c1.3-1 2.9-.8 3.7.4.9-1.2 2.5-1.4 3.7-.4"
            stroke="var(--line)"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="25.5" cy="29.5" rx="4.4" ry="6.2" fill="#fff" opacity=".55" />
          <circle cx="30" cy="34" r="1.4" fill="#fff" opacity=".8" />
        </symbol>
        <symbol id="pc-b" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="41" rx="12.5" ry="2" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M22.5 11.5c-9.9 4.6-16.5 12-16.5 18.9 0 6.1 6.9 9.6 16.5 9.6s16.5-3.5 16.5-9.6c0-6.9-6.6-14.3-16.5-18.9z"
          />
          <circle cx="22.5" cy="8.5" r="3" fill="var(--fill)" stroke="var(--line)" strokeWidth="2" />
          <path d="M22.5 19v8.5M18.5 23.2h8" stroke="var(--line)" strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx="16.5" cy="30" rx="4" ry="5.8" fill="#fff" opacity=".55" />
          <circle cx="27.8" cy="16.5" r="1.4" fill="#fff" opacity=".8" />
        </symbol>
        <symbol id="pc-q" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="42" rx="14" ry="1.8" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M22.5 6c2.76 0 5 2.24 5 5 0 1.55-.7 2.93-1.8 3.85 2.95 1.15 5.05 3.95 5.05 7.25 0 1.6-.5 3.1-1.35 4.35 6.5 1.45 12.1 5.95 12.1 10.55 0 1.5-.6 2.9-1.7 3.9-3.9 1.4-10.3 2.1-17.3 2.1s-13.4-.7-17.3-2.1c-1.1-1-1.7-2.4-1.7-3.9 0-4.6 5.6-9.1 12.1-10.55-.85-1.25-1.35-2.75-1.35-4.35 0-3.3 2.1-6.1 5.05-7.25-1.1-.92-1.8-2.3-1.8-3.85 0-2.76 2.24-5 5-5z"
          />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2.2"
            strokeLinejoin="miter"
            strokeMiterlimit="6"
            d="M12.5 9.5 13.8 2.4l2.6 4 2.5-5 2.1 4.8 1.5-5.4 1.5 5.4 2.1-4.8 2.5 5 2.6-4 1.3 7.1z"
          />
          <ellipse cx="15.5" cy="34" rx="5" ry="5.5" fill="#fff" opacity=".55" />
          <circle cx="27.5" cy="17.5" r="1.4" fill="#fff" opacity=".8" />
        </symbol>
        <symbol id="pc-k" viewBox="0 0 45 45">
          <ellipse cx="22.5" cy="42" rx="14" ry="1.8" fill="#000" opacity=".12" />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M22.5 7.5c3 0 5.5 2.5 5.5 5.5 0 1.7-.8 3.2-2 4.2 7.8 2 13.5 8.6 13.5 15.4 0 3.5-1.9 6.8-4.9 8.9H10.4c-3-2.1-4.9-5.4-4.9-8.9 0-6.8 5.7-13.4 13.5-15.4-1.2-1-2-2.5-2-4.2 0-3 2.5-5.5 5.5-5.5z"
          />
          <path
            fill="var(--fill)"
            stroke="var(--line)"
            strokeWidth="2.2"
            strokeLinejoin="miter"
            strokeMiterlimit="6"
            d="M21.8 4.5 20.6.9h3.8l-1.2 3.6 3.6-1.2v3.8l-3.6-1.2 1.2 3.6h-3.8l1.2-3.6-3.6 1.2V3.3z"
          />
          <ellipse cx="16" cy="31" rx="5" ry="6" fill="#fff" opacity=".55" />
          <circle cx="28.5" cy="16.5" r="1.4" fill="#fff" opacity=".8" />
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
