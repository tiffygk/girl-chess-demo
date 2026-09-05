// Typed client for the girl-chess API (server/index.ts).
import { initChatStream, pushChunk, type ChatStatusPhase } from "./chatStream";

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
  // Round 3 (session-gone recovery, owner ruling 2026-08-02): present, and
  // equal to "session_gone", exactly when the server's session row is gone
  // (server/index.ts's typed 404). postJson never throws on a non-2xx
  // status (it just parses the body), so this rides through as an ordinary
  // field -- modeTimer below is the one consumer that acts on it.
  error?: string;
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
  // Wave 1 (item 3 -- tier-1 motif fields): a quiet promoting refutation --
  // mirrors server/annotator/motifs.ts's ThreatMotif.
  | "promotion-threat"
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
  // Wave 1 (item 3 -- tier-1 motif fields): mirrors
  // server/annotator/motifs.ts's RecommendationAccomplishment.
  | "promotes"
  | "castles"
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
  // Wave 1 (verdict truth layer, item 2 -- typed mate): mirrors classify.ts's
  // Verdict. Forced-mate distance on each side, mover perspective (positive =
  // a mate for the player, negative = against her, null = no forced mate that
  // side) -- typed rather than folded into deltaCp (toMoverCp collapses a lost
  // mate-in-16 into deltaCp 99098). Threaded into the narrate() body below so
  // the coach prompt ships the typed distance instead of that folded number.
  mateBefore: number | null;
  mateAfter: number | null;
  latencyMs: number;
  facts?: MoveFacts;
  threat?: ThreatFacts;
  // H3 fix, logic-only half (union review, 2026-07-31): mirrors
  // classify.ts's own conversionCopy — set only on a "nudge" produced by
  // the decided-position conversion path (a mate-distance slip/missed-
  // mate/lost-mate, or a decided free-material giveaway). It was on the
  // wire (server/game/manager.ts's judgeMove already returns the whole
  // verdict) but absent from this mirror, so a move that tripped the
  // conversion detector rendered only the generic "hm, you sure?" badge
  // with no reason attached. Mirrored here and persisted (see manager.ts's
  // insertVerdict call) so the Lab can audit what she was told; RENDERING
  // it in GamePage.tsx is a separate K6 handoff (a surface she'll see needs
  // the Fable visual gate + component-library reflection, CLAUDE.md's
  // standing rule) and is deliberately not done here.
  conversionCopy?: string;
}

export interface JudgeResponse {
  ok: boolean;
  verdict?: Verdict;
}

// fetch rejects with a TypeError when nothing is listening (server not
// started, wrong port). Name it so the page can say so instead of hanging.
export class ServerUnreachableError extends Error {
  constructor() {
    super("the game server is not running");
    this.name = "ServerUnreachableError";
  }
}
async function fetchOrUnreachable(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) throw new ServerUnreachableError();
    throw err;
  }
}

// Under `vite`'s dev proxy (vite.config.ts's `/api` proxy) a server that
// isn't listening doesn't make fetch() itself throw -- the browser's fetch
// resolves fine against Vite's own dev server, which answers 502 when
// nothing is listening (Content-Type: text/plain, and vite logs "http proxy
// error ... ECONNREFUSED"). Same underlying fact surfacing one layer later,
// so it maps to the same error -- decided on the status code, not on
// whatever res.json() happens to throw, so a real server's own non-JSON
// error page (a 404 for a wrong route, a crashed handler's 500 HTML) is
// never mislabelled "the game server is not running."
async function jsonOrUnreachable<T>(res: Response): Promise<T> {
  if (res.status === 502) throw new ServerUnreachableError();
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchOrUnreachable(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrUnreachable<T>(res);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchOrUnreachable(`/api${path}`);
  return jsonOrUnreachable<T>(res);
}

// Wave 3.5, item 2 (owner ask, 2026-08-01): every other write helper in this
// file is a POST (postJson above); DELETE /api/game/:id is this file's first
// non-POST write, so it gets its own small helper following postJson's exact
// shape/error contract (no body, same bare-json-envelope response) rather
// than bending postJson to also carry a method override.
async function del<T>(path: string): Promise<T> {
  const res = await fetchOrUnreachable(`/api${path}`, { method: "DELETE" });
  return jsonOrUnreachable<T>(res);
}

export type CoachProbe = { state: "ready" | "not-installed" | "not-signed-in" | "down"; detail: string; checkedAt: number };

export function fetchCoachStatus(): Promise<CoachProbe> {
  return getJson("/coach/status");
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

// Highlight-a-move: the player flags a move (her own, up to three back) she
// wasn't sure about, during live play. Persisted immediately (moves.highlighted)
// so the highlight survives a reload -- it is db state, not React state.
export function highlightMove(gameId: number, ply: number, highlighted: boolean): Promise<{ ok: boolean }> {
  return postJson(`/game/${gameId}/move/${ply}/highlight`, { highlighted });
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
    // Wave 1 (item 2 -- typed mate): the typed mate distance (mover
    // perspective), threaded so the server coach prompt ships it instead of
    // the folded deltaCp. Optional -- an ordinary non-mate verdict omits them.
    mateBefore?: number | null;
    mateAfter?: number | null;
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
  // Without it, two different moments at the same hint rung collided -- an
  // opener's text is a fixed pool line, so "hint:${branch}:${press}:${text}"
  // alone was not a stable per-moment identity. This field is purely a
  // client-local identity for chatThread.ts's focusKey/shouldInjectAnchor;
  // the server does not read it.
  // Wave 2 (item 6): identity switched from a numeric `level` to the
  // two-branch press ladder's {branch, press} -- see chatFocus.ts's
  // hintFocusContext/reconcileChatFocus. The server (server/coach/chat.ts)
  // never read `level`, so this is a clean rename on the wire.
  // Task 4 (R1b, fact-gap round): mirrors server/coach/chat.ts's ChatContext.
  // hintFocus extension verbatim -- bestSan/pvSans already SAN (converted
  // client-side, see GamePage's hint-focus call site), threat is the right-P2
  // highlight's ThreatFacts, recommendation/trade are HintFacts' own fields.
  hintFocus?: {
    branch: "right" | "wrong";
    press: number;
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
    // Task 3 (Wave D, coach-truth-speed round): mirrors
    // server/coach/chat.ts's ChatContext.turningPointFocus verbatim -- see
    // that file's own comment. Populated by chatFocus.ts's
    // turningPointFocusContext via src/review/followedBest.ts's
    // followedBest(), the single source of truth reviewArrows.ts/
    // debriefBullets.ts/turningPointNote.ts already use for this same fact.
    playedNextSan?: string;
    followedBest?: boolean;
    // Opponent-move-analysis plan (2026-08-03), Wave C: only populated for a
    // MALLOW-ply focus (chatFocus.ts's opponentMoveFocusContext), straight off
    // the matching HighlightLine's own already-computed fields (Wave A,
    // server/annotator/highlightLines.ts -- one place, never re-derived
    // here). Absent for every her-ply focus (turningPointFocusContext never
    // sets these), so JSON.stringify drops the keys there and that prompt
    // path stays byte-identical (chat.stablePrefix discipline). Lets
    // server/coach/chat.ts's checkOpponentQualityClaims answer "did mallow
    // actually play the engine's own best move" from a fact already in hand,
    // never by re-deriving it from the model's own prose.
    matchedBest?: boolean | null;
    quality?: "best" | "solid" | "fine" | "slip" | "unknown";
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
  // as its own "slow" chip, never the offline chip. B3a (2026-07-27,
  // coach-truth-speed round): "validation-failed" is a fourth, honest cause
  // (a reply that never came out clean, rendered as a "garbled" chip) --
  // this is what makes `redirect`/"off-topic" reachable ONLY by a real
  // off-topic ask (the future intent router), never by a validation
  // failure, closing her "I did ask about the board" note.
  cause?: "backend-down" | "templates-only" | "timeout" | "validation-failed" | "off-topic";
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

// B-stream (2026-07-27, coach-truth-speed round): the SSE-over-POST sibling
// of chatWithCoach above, hitting the new /chat/stream route (server/
// index.ts). All the actual fetch/ReadableStream plumbing lives here, not in
// chatStream.ts (which stays a pure, DOM-free frame parser) and not in
// CoachChat.tsx (which only wires these callbacks into its own bubble
// state) -- same "network I/O lives in api.ts" convention every other
// function in this file already follows.
export interface ChatStreamHandlers {
  onDelta?: (text: string) => void;
  onRedraft?: () => void;
  // Task 1c (coach-truth-speed latency round, 2026-08-02): the staged
  // status chip. Fires with ONLY the phase -- never prose.
  onStatus?: (phase: ChatStatusPhase) => void;
  onDone?: (res: ChatResponse) => void;
  onError?: (res: ChatResponse) => void;
}

// Throws ONLY when the stream fails to OPEN at all (the fetch itself
// rejects, or the response is non-ok / carries no body) -- that is the one
// case CoachChat.tsx is meant to catch and degrade to the plain JSON
// endpoint for (see this wave's brief: "a transport problem degrades to
// today's behavior rather than to nothing"). Once reading has begun, a
// dropped connection resolves via handlers.onError with a synthetic
// {ok:false} envelope rather than rethrowing -- re-opening a fresh JSON
// request at that point would just duplicate whatever partial draft is
// already rendered, which the brief never asks for.
export async function streamChatWithCoach(
  gameId: number,
  body: { message: string; context: ChatContext; backendPref?: string },
  handlers: ChatStreamHandlers
): Promise<void> {
  const res = await fetch(`/api/game/${gameId}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat stream failed to open (status ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let state = initChatStream();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { frames, next } = pushChunk(state, decoder.decode(value, { stream: true }));
      state = next;
      for (const f of frames) {
        if (f.event === "delta") handlers.onDelta?.(f.data.text);
        else if (f.event === "redraft") handlers.onRedraft?.();
        else if (f.event === "status") handlers.onStatus?.(f.data.phase);
        else if (f.event === "done") handlers.onDone?.(f.data);
        else if (f.event === "error") handlers.onError?.(f.data);
      }
    }
  } catch {
    handlers.onError?.({ ok: false, error: "internal" });
  }
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
//
// Wave 0, item 1 (F0): `move` used to be a single positional `bestUci`
// string, and every level — including levels 1-3, whose hint IS the
// opponent's threat refutation, not the coach's best move — posted its
// value under the `bestUci` key. Any log analysis trusting the field name
// concluded the coach recommended illegal moves. The caller now names the
// key it means: `{ bestUci }` for the coach's actual best move (levels
// 4-5, and the invalid-hint log, whose value is still a would-be bestUci
// that failed the live legality check), `{ refutationUci }` for the
// opponent's threat move (levels 1-3). The wire body carries whichever key
// the caller passed — never both, never the wrong one.
//
// Wave 2 (item 2, telemetry continuity): `branch` ("right" | "wrong") rides
// alongside the move key so the Lab can tell a right-P2 opponent-threat
// reveal apart from a wrong-P2 best-piece reveal (both land at press 2 and
// both key refutationUci/bestUci, so the move key alone can't distinguish
// them). Optional and additive — the branch-less level-0 invalid-hint log
// omits it, and every earlier caller/field is unchanged.
export function logHint(
  gameId: number,
  level: number,
  tier: string,
  deltaCp: number | null,
  move: { bestUci: string } | { refutationUci: string },
  fen: string,
  branch?: "right" | "wrong"
): Promise<{ ok: boolean }> {
  return postJson(`/game/${gameId}/hint`, {
    level,
    tier,
    deltaCp,
    ...move,
    fen,
    ...(branch ? { branch } : {}),
  });
}

// Increment 3c: mirrors server/annotator/turningPoints.ts's TurningPoint
// (hand-mirroring, same convention as MoveFacts/ThreatFacts above).
// debrief-v2 (Task 1): added missedPunish, plyEnd, "episode" kind, and rank
// 4 (the episode card sits after up to 3 swing/backfill cards) — mirrors
// TP_ALGO_VERSION 2's additive shape exactly.
export interface TurningPoint {
  // Game-160 RCA round, Task K1 (2026-07-31): widened from a fixed 1..6
  // union to a plain number, mirroring the same widening in
  // server/annotator/turningPoints.ts (see that file's comment) — a long
  // real game can now carry more than 6 points (up to 3 swings/backfill +
  // an episode + an unconverted point + a missed-win point + a conversion
  // point).
  rank: number;
  ply: number;
  san: string;
  label: string;
  punishSan?: string;
  deltaP: number;
  lowConfidence: boolean;
  kind: "swing" | "backfill" | "episode" | "missed-win" | "unconverted" | "conversion" | "lead-change";
  missedPunish?: boolean;
  plyEnd?: number;
  // 2026-07-22: mirrors server TurningPoint's crossedAdvantage — see that
  // file's comment. Used by debrief copy (debriefBullets.ts/
  // debriefLesson.ts) to grade a mistake/inaccuracy's severity.
  crossedAdvantage?: boolean;
  // Missed-win round (2026-07-28): mirrors the server TurningPoint — set
  // only on kind "missed-win" points. mateIn = the forced-mate depth she
  // had; missedCount = how many times it slipped this game.
  mateIn?: number;
  missedCount?: number;
  // Game-151 round (2026-07-29): mirrors the server TurningPoint — set
  // only on kind "unconverted" points. How the game actually ended
  // (repetition, stalemate, fifty moves, called early).
  endKind?: string;
  // Fix wave (2026-07-29, review-3.md finding 1): mirrors the server
  // TurningPoint — "repetition-entry" means ply is a proven turning
  // moment (findRepetitionAnchor verified a stored non-repeating
  // alternative there); "run-start" means ply is only the first ply of
  // the held-winning run, never a claim about when the win ended.
  anchorKind?: "repetition-entry" | "run-start";
  // Wave E (2026-08-27): mirrors the server TurningPoint's leader/
  // leadMarginCp/leadNth -- set on kind "lead-change" points AND on any
  // point of another kind whose ply the confirmed crossing landed on (the
  // flag case, the main path on the real corpus). leader is the side that
  // became the leader; leadMarginCp is |white cp| at the confirmed
  // crossing; leadNth is the 1-based ordinal of this leader change.
  leader?: "her" | "mallow";
  leadMarginCp?: number;
  leadNth?: number;
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
  // Highlight-a-move: set when the player flagged this ply during live
  // play. Optional so any pre-existing summary caller (fixture, snapshot)
  // that doesn't supply it keeps compiling unchanged.
  highlighted?: boolean;
  // W5 (opponent-move highlight): whose move this is, sent by the server on
  // every summary row (manager.getSummary derives it once at its own data
  // load -- the conversion.ts precedent). Optional here only so the many
  // pre-existing review fixtures keep compiling; consumers read it as data
  // (see liveMoves.ts's liveMovesFromSummary) and never re-derive it from
  // the ply index in a view.
  side?: "her" | "mallow";
  // D4 (done-well composer): raw per-row engine facts, straight off the
  // moves row -- row P's evalCp/evalMate/bestUci describe the position
  // AFTER ply P, untransformed. Consumers apply the mover offset themselves
  // (the mover's best at ply P lives on row P-1's bestUci; evalCp is
  // side-to-move signed at fen_after, negate odd plies for her perspective)
  // -- see attachEval's doc comment in server/game/manager.ts. Optional and
  // absent/null on rows with no attached eval, same compiling-fixture
  // reasoning as `side` above.
  evalCp?: number | null;
  evalMate?: number | null;
  bestUci?: string | null;
}

export interface SummaryResponse {
  ok: boolean;
  turningPoints: TurningPoint[];
  classifications: MoveClassification[];
  moves: SummaryMove[];
  // Task 6 review: null while the game is live, the stored result string
  // (e.g. "1-0") once it's finished. Optional so any pre-existing fixture
  // that predates this field keeps compiling, same reasoning as the
  // `side`/`highlighted` fields on SummaryMove above.
  result?: string | null;
}

export function fetchSummary(gameId: number): Promise<SummaryResponse> {
  return getJson(`/game/${gameId}/summary`);
}

// Task 11.2 (stranger-clones-and-plays round): the game's persisted
// chat_messages rows, oldest first, off the new GET /api/game/:id/chat
// route -- lets a resumed game seed CoachChat's thread with what the
// player asked cookie and what she answered, instead of the panel coming
// back empty (chat-resume-research.md).
export interface ChatHistoryMessage {
  role: string;
  text: string;
  createdAt: string;
}

export function fetchChatHistory(gameId: number): Promise<{ ok: boolean; messages: ChatHistoryMessage[] }> {
  return getJson(`/game/${gameId}/chat`);
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

// Wave 3.5, item 2 (owner ask, 2026-08-01): the past-games drawer's delete X
// (two-step confirm, no undo -- see PastGamesDrawer). Mirrors server/index.ts's
// DELETE /api/game/:id: `ok:false` covers both "the game is still live" (the
// server answers 409 for that) and any other rejection -- the caller doesn't
// need to distinguish them, it just restores the optimistically-removed row.
export interface DeleteGameResponse {
  ok: boolean;
  reason?: string;
}

export function deleteGame(gameId: number): Promise<DeleteGameResponse> {
  return del(`/game/${gameId}`);
}

/**
 * Posts elapsed seconds for `mode` every 30s while mounted.
 * Call inside a useEffect and return the cleanup:
 *   useEffect(() => modeTimer(sessionId, "game"), [sessionId]);
 *
 * Round 3 (session-gone recovery, owner ruling 2026-08-02): `onGone` is an
 * additive optional 3rd param -- every pre-round-3 call site omits it and
 * keeps today's behavior (a session_gone response was already silently
 * swallowed by the `.catch`, just kept retrying forever; the only change
 * for an omitted onGone is that the dead heartbeat now also stops itself).
 * When the server reports the session is gone, the interval clears itself
 * immediately and `onGone` fires exactly once -- never a retry loop, never
 * repeat calls.
 */
export function modeTimer(sessionId: number, mode: string, onGone?: () => void): () => void {
  let stopped = false;
  const id = setInterval(async () => {
    if (stopped) return;
    const res = await reportMode(sessionId, mode, 30).catch(() => undefined);
    if (res?.error === "session_gone") {
      stopped = true;
      clearInterval(id);
      onGone?.();
    }
  }, 30_000);
  return () => {
    stopped = true;
    clearInterval(id);
  };
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
  // Turning-card arrow extension plan (2026-08-05), Task 1: the engine's
  // best move for whoever was actually to move AT this ply -- distinct
  // from bestFromTo (her best reply) on an opponent (even) ply. See
  // server/game/manager.ts's TurningLine comment for the full derivation.
  moverBestFromTo?: { from: string; to: string };
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

// Opponent-move-analysis plan (2026-08-03), Wave A: mirrors
// server/annotator/highlightLines.ts's HighlightLine (hand-mirroring, same
// convention as TurningLine above) -- one row per HIGHLIGHTED ply, EITHER
// side, seeded at p-1 universally (the seam TurningLine's own seedPly
// formula deliberately cannot provide for mallow's plies). Every from/to
// and SAN on the wire is server-derived by chess.js replay, never guessed
// client-side; `side` rides the row, derived once server-side at the data
// load -- never re-derived from `ply % 2` here.
export interface HighlightLine {
  ply: number;
  side: "her" | "mallow";
  san: string;
  bestSan?: string;
  bestFromTo?: { from: string; to: string };
  // Task 5 (cards-and-drawers arrow parity, 2026-08-05): mirrors
  // server/annotator/highlightLines.ts's HighlightLine.replyBestFromTo --
  // the OTHER actor's-best (whoever replies at ply+1's engine best), seeded
  // at row `ply` itself (fenAfter(ply)), distinct from bestFromTo's p-1
  // seed. See that file's comment for the offset rationale.
  replyBestFromTo?: { from: string; to: string };
  pvSans: string[];
  matchedBest: boolean | null;
  quality: "best" | "solid" | "fine" | "slip" | "unknown";
  gapCp: number | null;
  mateInvolved: boolean;
  decided: boolean;
}

export interface HighlightLinesResponse {
  ok: boolean;
  lines: HighlightLine[];
}

export function getHighlightLines(gameId: number): Promise<HighlightLinesResponse> {
  return getJson(`/game/${gameId}/highlight-lines`);
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
