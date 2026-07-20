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

// Increment 3a Wave 3: mirrors server/annotator/motifs.ts's
// RecommendationFacts (same hand-mirroring convention + HONESTY GATE as
// ThreatFacts above) — "what the recommended move accomplishes," derived
// from hint.ts's already-chosen best move.
export type RecommendationAccomplishment =
  | "captures"
  | "gives-check"
  | "gives-mate"
  | "forks"
  | "attacks"
  | "develops";

export interface RecommendationFacts {
  accomplishment: RecommendationAccomplishment;
  pieceKind: string;
  fromSquare: string;
  toSquare: string;
  san: string;
  capturesSquare?: string; // real square (en passant resolved), only on "captures"
  capturedPieceKind?: string; // only on "captures"
  forkTargets?: { square: string; pieceKind: string }[]; // only on "forks", length >= 2
  attackedSquare?: string; // only on "attacks"
  attackedPieceKind?: string; // only on "attacks"
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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
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
    // Increment 3a Wave 3: "why the recommended move is good" — mirrors
    // server/annotator/hint.ts's HintFacts.recommendation.
    recommendation?: RecommendationFacts;
  };
}

export function fetchHintFacts(gameId: number): Promise<HintFactsResponse> {
  return postJson(`/game/${gameId}/hint-facts`, {});
}

// Increment 3a Wave 3: the coach's corner async narration call. Posts the
// structured facts the client already holds (from its own judge + hint-facts
// calls); the server never errors out (template fallback on any model
// failure — see server/coach/index.ts), so `ok: false` only means the game
// itself was unknown/finished. Callers token-guard the response the same
// way the hint fetch does.
export interface NarrateResponse {
  ok: boolean;
  text?: string;
  source?: string;
}

export function narrate(
  gameId: number,
  body: {
    herPiece: string;
    from: string;
    to: string;
    tier: string;
    deltaCp: number | null;
    threat?: ThreatFacts;
    best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
    recommendation?: RecommendationFacts;
  }
): Promise<NarrateResponse> {
  return postJson(`/game/${gameId}/narrate`, body);
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

// Increment 3c: mirrors server/annotator/turningPoints.ts's TurningPoint
// (hand-mirroring, same convention as MoveFacts/ThreatFacts above).
// debrief-v2 (Task 1): added missedPunish, plyEnd, "episode" kind, and rank
// 4 (the episode card sits after up to 3 swing/backfill cards) — mirrors
// TP_ALGO_VERSION 2's additive shape exactly.
export interface TurningPoint {
  rank: 1 | 2 | 3 | 4;
  ply: number;
  san: string;
  label: string;
  punishSan?: string;
  deltaP: number;
  lowConfidence: boolean;
  kind: "swing" | "backfill" | "episode";
  missedPunish?: boolean;
  plyEnd?: number;
}

export interface MoveClassification {
  ply: number;
  classification: string;
}

// ply/san only — no eval leakage to the client. Enough to replay the game
// on a fresh chess.js for the debrief's rewind seam (src/review/Rewind.tsx).
export interface SummaryMove {
  ply: number;
  san: string;
}

export interface SummaryResponse {
  ok: boolean;
  turningPoints: TurningPoint[];
  classifications: MoveClassification[];
  moves: SummaryMove[];
}

export function fetchSummary(gameId: number): Promise<SummaryResponse> {
  return getJson(`/game/${gameId}/summary`);
}

// Increment 3c: the "past games" saved-games menu list.
export interface GameListEntry {
  id: number;
  startedAt: string;
  opponent: string;
  result: string;
  endReason: string | null;
  lesson: string | null;
}

export interface GamesListResponse {
  ok: boolean;
  games: GameListEntry[];
}

export function fetchGames(): Promise<GamesListResponse> {
  return getJson("/games");
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

// Increment 3.91 (Task 2): mirrors server/game/manager.ts's TurningLine
// (hand-mirroring, same convention as TurningPoint above) — the persisted
// Stockfish best-move/pv for each turning point, additive to /summary.
// Every from/to on the wire is server-derived by chess.js replay, never
// guessed client-side.
export interface TurningLine {
  ply: number;
  playedFromTo?: { from: string; to: string };
  bestSan?: string;
  bestFromTo?: { from: string; to: string };
  pvSans: string[];
  threat?: { from: string; to: string };
}

export interface TurningLinesResponse {
  ok: boolean;
  lines: TurningLine[];
}

export function getTurningLines(gameId: number): Promise<TurningLinesResponse> {
  return getJson(`/game/${gameId}/turning-lines`);
}
