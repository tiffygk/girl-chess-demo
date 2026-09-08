// Wave A2 (2026-09-08, voice-align): owner's ask, verbatim -- she asked
// "why would I do knight to e4 when I could bring my queen to a4"; the
// chat said "our chess brain hasn't worked out that line for this
// position"; when she then picked up queen to a4, the ladder computed it
// and found the fork. This is the pure parser behind the on-demand lookup
// manager.ts's chat handler runs for exactly that shape of question: a move
// she names but has not picked up on the board. No engine call here, no
// side effects -- given her message and the live fen, resolves at most one
// unambiguous LEGAL candidate move, or returns undefined. Never a guess:
// zero matches, more than one legal move matching one phrase, or the
// message naming two or more distinct candidate moves all resolve to
// undefined ("an 'A or B' question is out of scope for this wave" -- brief).
//
// Mirrors src/game/describeSanMove.ts's pieceName word map, implemented
// server-side so this file has no import across the client/server seam.
import { Chess, type Move } from "chess.js";
import { SAN_RE } from "./validate";

const WORD_TO_PIECE: Record<string, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

export interface CandidateMove {
  san: string;
  uci: string;
}

function toCandidate(mv: Move): CandidateMove {
  return { san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ""}` };
}

// The one resolution rule every phrase below shares: try every legal move
// at fen, keep only the ones the filter accepts, and only ever return a
// candidate when EXACTLY one survives -- zero (illegal/no such move) and
// two-or-more (ambiguous, e.g. two knights reaching the same square) both
// mean "no candidate from this phrase," never a guess at which one she
// meant.
function resolveUnique(fen: string, filter: (m: Move) => boolean): CandidateMove | undefined {
  const probe = new Chess(fen);
  const matches = probe.moves({ verbose: true }).filter(filter);
  if (matches.length !== 1) return undefined;
  return toCandidate(matches[0]);
}

function resolveCastle(fen: string, side: string | undefined): CandidateMove | undefined {
  const wantShort = side === "short" || side === "kingside";
  const wantLong = side === "long" || side === "queenside";
  return resolveUnique(fen, (m) => {
    if (wantShort) return m.flags.includes("k");
    if (wantLong) return m.flags.includes("q");
    // Bare "castle", no side named: legal only if exactly one side is
    // actually available to castle right now -- resolveUnique's own
    // "exactly one match" rule handles both-sides-legal (ambiguous, so
    // undefined) for us.
    return m.flags.includes("k") || m.flags.includes("q");
  });
}

function resolvePieceMove(
  fen: string,
  pieceLetter: string,
  from: string | undefined,
  to: string,
  requireCapture: boolean
): CandidateMove | undefined {
  return resolveUnique(fen, (m) => {
    if (m.piece !== pieceLetter) return false;
    if (m.to !== to) return false;
    if (from && m.from !== from) return false;
    if (requireCapture && !(m.flags.includes("c") || m.flags.includes("e"))) return false;
    return true;
  });
}

const CASTLE_RE = /\bcastl(?:e|ing|es|ed)\b(?:\s+(short|long|kingside|queenside))?/gi;
// "piece [from ORIGIN] to DEST" -- covers "queen to a4", "pawn to e5",
// "rook from b1 to b7".
const TO_RE = /\b(pawn|knight|bishop|rook|queen|king)\b(?:\s+from\s+([a-h][1-8]))?\s+to\s+([a-h][1-8])\b/gi;
// "piece [ORIGIN] takes [on] DEST" -- covers "knight takes e7",
// "bishop takes on b5", "pawn d5 takes on e6".
const TAKES_RE = /\b(pawn|knight|bishop|rook|queen|king)\b(?:\s+([a-h][1-8]))?\s+takes(?:\s+on)?\s+([a-h][1-8])\b/gi;

export function parseCandidateMove(message: string, fen: string): CandidateMove | undefined {
  // Keyed by uci so the same move named twice (e.g. once in SAN, once
  // spelled out) collapses to one entry -- only two DISTINCT moves should
  // ever push this to "two named."
  const found = new Map<string, CandidateMove>();

  for (const token of message.match(SAN_RE) ?? []) {
    // A bare square ("c3") is free geography, not a move mention -- the
    // same distinction chat.ts's own isBareSquare draws for validateChat.
    // Without this, a spelled phrase's own destination square ("knight to
    // c3") gets double-counted: once as "Nc3" via the spelled-form parser
    // below, once as the pawn move "c3" chess.js also happily parses as
    // SAN, manufacturing a false "two moves named."
    if (/^[a-h][1-8]$/.test(token)) continue;
    try {
      const probe = new Chess(fen);
      const mv = probe.move(token);
      if (mv) {
        const cand = toCandidate(mv);
        found.set(cand.uci, cand);
      }
    } catch {
      // Not a legal move from this position (or not really SAN) -- ignore,
      // same "no facts, no claim" discipline as the rest of the file.
    }
  }

  let m: RegExpExecArray | null;
  CASTLE_RE.lastIndex = 0;
  while ((m = CASTLE_RE.exec(message))) {
    const cand = resolveCastle(fen, m[1]?.toLowerCase());
    if (cand) found.set(cand.uci, cand);
  }

  TO_RE.lastIndex = 0;
  while ((m = TO_RE.exec(message))) {
    const piece = WORD_TO_PIECE[m[1].toLowerCase()];
    const from = m[2]?.toLowerCase();
    const to = m[3].toLowerCase();
    const cand = resolvePieceMove(fen, piece, from, to, false);
    if (cand) found.set(cand.uci, cand);
  }

  TAKES_RE.lastIndex = 0;
  while ((m = TAKES_RE.exec(message))) {
    const piece = WORD_TO_PIECE[m[1].toLowerCase()];
    const from = m[2]?.toLowerCase();
    const to = m[3].toLowerCase();
    const cand = resolvePieceMove(fen, piece, from, to, true);
    if (cand) found.set(cand.uci, cand);
  }

  if (found.size !== 1) return undefined;
  return [...found.values()][0];
}
