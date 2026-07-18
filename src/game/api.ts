// Typed client for the girl-chess API (server/index.ts).

export interface NewSessionResponse {
  sessionId: number;
}

export interface NewGameResponse {
  gameId: number;
  fen: string;
  fallback: boolean;
  elo: number;
}

export interface MoveReply {
  san: string;
  uci: string;
  capture: boolean;
}

export interface GameOverInfo {
  result: string;
}

export interface MoveResponse {
  ok: boolean;
  fen: string;
  playerSan?: string;
  playerCapture?: boolean;
  reply?: MoveReply;
  gameOver?: GameOverInfo;
}

export interface ModeResponse {
  ok: boolean;
}

export interface ResignResponse {
  ok: boolean;
  result?: string;
}

export interface DrawOfferResponse {
  ok: boolean;
  accepted?: boolean;
  result?: string;
}

// Wave C, task C-A: the single "end the game?" flow's response — mirrors
// server/annotator/adjudicate.ts's AdjudicationDecision plus the raw
// playerCp (unused by the UI today, but handed through in case a future
// increment wants to show it).
export interface AdjudicateResponse {
  ok: boolean;
  outcome?: "win" | "draw" | "resign";
  result?: string;
  reason?: string;
  playerCp?: number;
}

// Wave C, task C-B: mirrors server/annotator/classify.ts's MoveFacts — "what
// was best instead" at the position before the judged move.
export interface MoveFacts {
  bestUci: string;
  bestSan: string;
  bestPieceKind: string;
  bestToSquare: string;
}

// Increment 2.7 (why-hints): mirrors server/annotator/motifs.ts's
// ThreatFacts (hand-mirroring is the codebase convention — see MoveFacts
// above). Every populated field is literally true from the server's
// chess.js replay of the judge's discarded refutation; the client template
// layer (src/game/hintFlow.ts) must never read a field outside the motif
// branch that populated it — that would be fabricating, not reporting.
export type ThreatMotif =
  | "capture-moved"
  | "capture-other"
  | "fork"
  | "mate-threat"
  | "check-threat"
  | "positional";

export interface ThreatFacts {
  motif: ThreatMotif;
  refutationUci: string;
  refutationSan: string;
  refutationPieceKind: string;
  refutationFromSquare: string;
  refutationToSquare: string;
  givesCheck: boolean;
  capturesSquare?: string; // REAL captured square (en passant resolved), only on capture motifs
  capturedPieceKind?: string; // only on capture motifs
  capturesHerJustMovedPiece: boolean;
  forkTargets?: { square: string; pieceKind: string }[]; // only when motif === "fork", length >= 2
}

// Mirrors server/annotator/classify.ts's Verdict. C1's judge is a stub —
// always "silent" — but the shape carries everything C2 needs.
export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
  facts?: MoveFacts;
  threat?: ThreatFacts;
}

export interface JudgeResponse {
  ok: boolean;
  verdict?: Verdict;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function newSession(): Promise<NewSessionResponse> {
  return postJson("/session", {});
}

export function newGame(sessionId: number, elo: number): Promise<NewGameResponse> {
  return postJson("/game", { sessionId, elo });
}

// `override` (C4): set only when this move is a confirm of a pending move
// the judge marked "warning" (see isOverrideConfirm in moveFlow.ts). The
// client already holds the verdict at confirm time, so deltaCp/mateAgainst
// travel along with the flag rather than the server re-deriving them.
// Omitted entirely for an ordinary move — the server writes no
// game_events row when it's absent.
export function sendMove(
  gameId: number,
  from: string,
  to: string,
  promotion?: string,
  timeSpentMs?: number,
  override?: { deltaCp: number | null; mateAgainst: boolean }
): Promise<MoveResponse> {
  return postJson(`/game/${gameId}/move`, {
    from,
    to,
    promotion,
    timeSpentMs,
    ...(override ? { override: true, deltaCp: override.deltaCp, mateAgainst: override.mateAgainst } : {}),
  });
}

export function reportMode(sessionId: number, mode: string, seconds: number): Promise<ModeResponse> {
  return postJson(`/session/${sessionId}/mode`, { mode, seconds });
}

// Stateless: the server validates against a clone and never advances the
// game (retract is purely client-side — nothing to undo on the server).
// `mode` (C3): trace-tagging only — omit for the ordinary pre-move
// (pending) judge call (server defaults it to "guardian"); pass "post"
// when judging in parallel with an already-played move (coach-only mode).
export function judgeMove(
  gameId: number,
  from: string,
  to: string,
  promotion?: string,
  mode?: string
): Promise<JudgeResponse> {
  return postJson(`/game/${gameId}/judge`, { from, to, promotion, mode });
}

export function resign(gameId: number): Promise<ResignResponse> {
  return postJson(`/game/${gameId}/resign`, {});
}

export function offerDraw(gameId: number): Promise<DrawOfferResponse> {
  return postJson(`/game/${gameId}/draw-offer`, {});
}

// Wave C, task C-A: the single "end the game?" flow. `execute: false` is
// the arm-step preview (what would this be, without ending anything);
// `execute: true` is the real second-click execution. Both hit the same
// server-side decision — the server re-derives the outcome fresh every
// call, so the client's remembered preview is never trusted for the
// actual ending.
export function adjudicate(gameId: number, execute: boolean): Promise<AdjudicateResponse> {
  return postJson(`/game/${gameId}/adjudicate`, { execute });
}

// Wave B (increment 2.5): the on-demand deep verified hint search — fetched
// only when the player clicks "help?", decoupled from the judge's shallow
// 350ms eval. Mirrors server/annotator/hint.ts's HintFacts.
export interface HintFactsResponse {
  ok: boolean;
  facts?: {
    bestUci: string;
    bestSan: string;
    bestPieceKind: string;
    bestFromSquare: string;
    bestToSquare: string;
    escalated: boolean;
  };
}

export function fetchHintFacts(gameId: number): Promise<HintFactsResponse> {
  return postJson(`/game/${gameId}/hint-facts`, {});
}

// Wave C, task C-B: fire-and-forget hint-escalation observability. Never
// awaited by its caller for anything but a `.catch` — a failed log write
// must never block confirm/retract or the hint reveal itself.
export function logHint(
  gameId: number,
  level: number,
  tier: string,
  deltaCp: number | null,
  bestUci: string,
  fen: string
): Promise<{ ok: boolean }> {
  return postJson(`/game/${gameId}/hint`, { level, tier, deltaCp, bestUci, fen });
}

/**
 * Posts elapsed seconds for `mode` every 30s while mounted.
 * Call inside a useEffect and return the cleanup:
 *   useEffect(() => modeTimer(sessionId, "game"), [sessionId]);
 */
export function modeTimer(sessionId: number, mode: string): () => void {
  const id = setInterval(() => {
    reportMode(sessionId, mode, 30).catch(() => undefined);
  }, 30_000);
  return () => clearInterval(id);
}
