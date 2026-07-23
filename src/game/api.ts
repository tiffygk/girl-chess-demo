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
  // Task 1 (defender grounding): true when the player has a piece that
  // recaptures on the actual captured square -- a defended capture is a
  // trade, not a clean loss. Always present; only meaningful on capture
  // motifs (false otherwise, since there's nothing to defend).
  capturedSquareDefended: boolean;
  // Controller follow-up (issue A, 2026-07-22 truthfulness-leaks review):
  // the piece kind HER OWN move captured, if it was a capture at all --
  // distinct from capturedPieceKind above (what the REFUTATION captures
  // FROM her). Undefined when her move wasn't a capture.
  herCapturedPieceKind?: string;
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
// `strictness` (Task 6, F10 tuning — UI label "judge strictness"): the
// caller reads this from localStorage `gc-judge-strictness` (GamePage) and
// passes it straight through; omitted, the server judges at "standard".
export function judgeMove(
  gameId: number,
  from: string,
  to: string,
  promotion?: string,
  mode?: string,
  strictness?: string
): Promise<JudgeResponse> {
  return postJson(`/game/${gameId}/judge`, { from, to, promotion, mode, strictness });
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
    // Task 5 (trade-aware hints, increment 3.95): mirrors server/annotator/
    // hint.ts's HintFacts.pv/.trade — always present, same as the server.
    pv: string[];
    trade: boolean;
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
  traceId?: number;
}

// backendPref (Task 5, F17): "claude" | "ollama" | "template" | undefined,
// read from localStorage gc-coach-backend by the caller (GamePage.tsx) and
// passed straight through — this client stays a thin typed wrapper with no
// opinion of its own about the preference's source or default.
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
    backendPref?: string;
  }
): Promise<NarrateResponse> {
  return postJson(`/game/${gameId}/narrate`, body);
}

// Increment 3.9, Task 3 (F16 chat client): client-side mirror of
// server/coach/chat.ts's ChatContext — same hand-mirroring convention as
// ThreatFacts/RecommendationFacts above. Live mode carries whatever
// pending/verdict/hint facts GamePage has in hand at send time; review mode
// is bare (the server already has the whole game to ground against, per
// manager.ts's chat() — it never trusts body.context.mode over the db's own
// result column).
export interface ChatContext {
  mode: "live" | "review";
  herMove?: { pieceKind: string; from: string; to: string };
  tier?: "nudge" | "warning";
  threat?: ThreatFacts;
  best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
  recommendation?: RecommendationFacts;
  // Task 7 (increment 3.95, "ask about this"): mirrors server/coach/chat.ts's
  // ChatContext additions verbatim -- see chatFocus.ts for the pure focus ->
  // context mapping that populates these two fields.
  // Phase 3 review fix (F1): `ply` is the pending move's own ply (the
  // position it would become once confirmed -- mirrorRef.current.history()
  // .length + 1, since the mirror is untouched while a move is pending).
  // Without it, two different moments at the same hint level collided --
  // hintCopy's level-1/2 text is a fixed template (hintFlow.ts:304), so
  // "hint:${level}:${text}" alone was not a stable per-moment identity. This
  // field is purely a client-local identity for chatThread.ts's focusKey/
  // shouldInjectAnchor; the server does not read it.
  // Task 4 (R1b, fact-gap round): mirrors server/coach/chat.ts's ChatContext.
  // hintFocus extension verbatim -- bestSan/pvSans already SAN (converted
  // client-side, see GamePage's hint-focus call site), threat is the
  // level-3 highlight's ThreatFacts, recommendation/trade are HintFacts'
  // own fields.
  hintFocus?: {
    level: number;
    text: string;
    ply: number;
    bestSan?: string;
    pvSans?: string[];
    threat?: ThreatFacts;
    recommendation?: RecommendationFacts;
    trade?: boolean;
  };
  turningPointFocus?: {
    ply: number;
    san: string;
    label: string;
    punishSan?: string;
    bestSan?: string;
    pvSans?: string[];
  };
  // Task 1 (R2, pending-move context threading): mirrors
  // server/coach/chat.ts's ChatContext.pendingMove verbatim -- see
  // chatFocus.ts's pendingMoveContext for the pure mapper that populates
  // this. Sent whenever `pending` is truthy, regardless of verdict/tier
  // state (silent/in-flight/coach-off all included) -- the R2 fix for "why
  // should i not put it here?" going unanswered on a fine (silent) move.
  pendingMove?: {
    pieceKind: string;
    from: string;
    to: string;
    san?: string;
    tier?: "silent" | "nudge" | "warning";
    judged: boolean;
  };
}

// Mirrors manager.ts's chat() return envelope (ok:true text/source/cause?/
// traceId, or a bare ok:false on an unknown game / an over-length message).
export interface ChatResponse {
  ok: boolean;
  text?: string;
  source?: "model" | "template";
  // Task 8 (inc 3.95, Fix 1): "templates-only" (a deliberate voice choice)
  // vs "backend-down" (a genuine failure) -- see manager.ts's chat() and
  // CoachChat.tsx's offline-chip predicate, which renders only for the
  // latter. Task 2 (2026-07-22, truthfulness leaks): "timeout" is a third,
  // distinct cause -- a slow-but-healthy backend, not a down one -- rendered
  // as its own "slow" chip, never the offline chip.
  cause?: "backend-down" | "templates-only" | "timeout";
  traceId?: number;
  error?: string;
}

// backendPref (Task 5, F17): now live end to end — server/index.ts reads it
// off the body and threads it to GameManager.chat's pickCoachBackend. Same
// "caller supplies it, this client has no opinion" convention as narrate()
// above.
export function chatWithCoach(
  gameId: number,
  body: { message: string; context: ChatContext; backendPref?: string }
): Promise<ChatResponse> {
  return postJson(`/game/${gameId}/chat`, body);
}

// Increment 3.9, Task 4 (F19): thumbs up/down with optional one-line
// feedback on a traced coach output (coach's corner narration or a chat
// reply -- anything carrying a traceId). Mirrors server/index.ts's route
// contract exactly: rating is 1 | -1, feedback is thumbs-down-only and
// optional (skipping it keeps the -1), and re-rating the same trace
// overwrites -- latest wins.
export interface RateTraceResponse {
  ok: boolean;
}

export function rateTrace(traceId: number, rating: 1 | -1, feedback?: string): Promise<RateTraceResponse> {
  return postJson(`/trace/${traceId}/rate`, feedback !== undefined ? { rating, feedback } : { rating });
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
  // 2026-07-22: mirrors server TurningPoint's crossedAdvantage — see that
  // file's comment. Used by debrief copy (debriefBullets.ts/
  // debriefLesson.ts) to grade a mistake/inaccuracy's severity.
  crossedAdvantage?: boolean;
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

// Increment 3.91 (Task 5): the "try the line" sandbox's engine move.
// Stateless — no gameId, nothing persisted server-side (see server/index.ts's
// POST /api/explore/reply + manager.ts's exploreReply).
export interface ExploreReply {
  from: string;
  to: string;
  promotion?: string;
  san: string;
}

export interface ExploreReplyResponse {
  ok: boolean;
  reply?: ExploreReply;
  gameOver?: boolean;
}

export function exploreReply(fen: string, elo: number): Promise<ExploreReplyResponse> {
  return postJson("/explore/reply", { fen, elo });
}
