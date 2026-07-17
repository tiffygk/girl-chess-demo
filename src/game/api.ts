// Typed client for the girl-chess API (server/index.ts).

export interface NewSessionResponse {
  sessionId: number;
}

export interface NewGameResponse {
  gameId: number;
  fen: string;
  fallback: boolean;
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

// Mirrors server/annotator/classify.ts's Verdict. C1's judge is a stub —
// always "silent" — but the shape carries everything C2 needs.
export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
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

export function sendMove(
  gameId: number,
  from: string,
  to: string,
  promotion?: string,
  timeSpentMs?: number
): Promise<MoveResponse> {
  return postJson(`/game/${gameId}/move`, { from, to, promotion, timeSpentMs });
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
