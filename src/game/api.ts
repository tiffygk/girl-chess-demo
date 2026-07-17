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
