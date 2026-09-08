// tools/coach-ladder-agreement.ts
//
// Wave A0 (2026-09-08 voice-align round), measurement only. Owner's ask:
// "sometimes the coach chat contradicts the live coaching [the hint
// ladder]. The live coaching under the ladder is always more trustworthy
// and better." This tool does not diagnose why and proposes no fix -- it
// pairs every stored chat reply with the ladder's own facts for the same
// position and classifies whether the reply agreed, disagreed, denied a
// motif the ladder/verdict asserted, or made no claim at all. The
// controller reads the population this produces and holds its own prior
// about the cause.
//
// READ-ONLY, always. Opens the db with better-sqlite3 {readonly: true}
// exactly as tools/gate.ts:59-67 does -- never openDb() (which runs
// migrateSchema, a write) and never a read-write handle. Never
// checkpoints, never VACUUMs. Run:
//   npx tsx tools/coach-ladder-agreement.ts [--db ../data/girlchess.db] [--since 2026-07-22] [--json out.json]
//
// Fen provenance for the CHAT side is deliberately a fallback chain, not a
// single field: chatFen = hintFindings.fen (the exact position the ladder
// last computed for, when the fact list carried one) ?? currentFen (live
// position at send time) ?? focusPosition.fen (an "ask about this" focused
// question about a past moment). A row can legitimately have none of these
// (very old rows, or a malformed facts_json) -- that is `chatFen === null`,
// never coerced to a placeholder.
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Database from "better-sqlite3";
import { Chess } from "chess.js";
import { SAN_RE, normalizeSan } from "../server/coach/validate";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- CLI args --------------------------------------------------------

interface Args {
  db: string;
  since: string;
  json?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { db: "../data/girlchess.db", since: "2026-07-22" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") args.db = argv[++i];
    else if (argv[i] === "--since") args.since = argv[++i];
    else if (argv[i] === "--json") args.json = argv[++i];
  }
  return args;
}

// ---- shapes ------------------------------------------------------------

export type AgreementClass =
  | "agree"
  | "disagree-best"
  | "mixed"
  | "two-bests-in-prompt"
  | "motif-denied"
  | "no-ladder-fact"
  | "no-claim";

// Priority order when a row fits more than one class: the first one in
// this list that fits is the primary; the next one that fits (if any) is
// recorded as the secondary. "mixed" (pass 2 item 1: the reply mentions the
// ladder's own best AND separately recommends a different, legal move) sits
// right after two-bests-in-prompt -- it is the most specific "both signals
// present" shape, the same reasoning that put two-bests-in-prompt first.
const CLASS_PRIORITY: AgreementClass[] = [
  "two-bests-in-prompt",
  "mixed",
  "disagree-best",
  "motif-denied",
  "agree",
  "no-ladder-fact",
  "no-claim",
];

export interface LadderFact {
  fen: string;
  at: string;
  eventType: "hint" | "hint_compute";
  bestSan?: string;
  refutationSan?: string;
  // "verified" here is a proxy, not a stored field on game_events itself:
  // hint_compute's own `escalated` flag distinguishes a real deep search
  // from the fast unverified position view (the same distinction
  // HintFindings.verified makes on the chat side -- see chat.ts's own
  // comment on that field). A `hint` event (the client's own reveal log)
  // carries no such flag, so it is left undefined ("?" in the printed
  // table), not coerced to a guess.
  verified?: boolean;
}

export interface VerdictMotif {
  motif: string | null;
  refutationSan: string | null;
}

export interface RowRecord {
  traceId: number;
  gameId: number;
  ply: number | null;
  rating: number | null;
  createdAt: string;
  kind: string;
  source: string;
  output: string;
  chatFen: string | null;
  chatBest: string | null;
  chatBestVerified: boolean | null;
  ctxBest: string | null;
  mode: string | null;
  threatMotif: string | null;
  threatRefutationSan: string | null;
  recommendedMoves: string[];
  mentionedMoves: string[];
  // null when there is no ladder best to compare against at all (the
  // no-ladder-fact case) -- never coerced to false, which would silently
  // read as "checked and disagrees."
  mentionsLadderBest: boolean | null;
  recommendsOther: boolean | null;
  denialFragments: string[];
  ladderBest: LadderFact | null;
  ladderBestAfter: LadderFact | null; // nearest matching event AFTER created_at, within 5 min
  verdict: VerdictMotif | null;
  cls: AgreementClass;
  secondaryCls: AgreementClass | null;
}

// ---- SAN / uci helpers ---------------------------------------------------

function uciToSan(fen: string, uci: string | null | undefined): string | undefined {
  if (!uci || uci.length < 4) return undefined;
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" });
    return mv?.san;
  } catch {
    return undefined;
  }
}

// Comparison form: normalize case, strip a trailing check/mate suffix (a
// suffix annotates the position, not a different move -- same rule
// validate.ts's isAllowedSanToken applies for the identical reason).
function sanBase(s: string): string {
  return normalizeSan(s).replace(/[+#]$/, "");
}

const PIECE_WORDS: Record<string, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

// Resolves a spelled-out move ("queen to a4", "knight takes on e7") to SAN
// by trying each LEGAL move at `fen` whose piece and destination match
// (brief step 3) -- never a string transform, so an illegal or
// fabricated-square mention resolves to undefined rather than a guessed
// SAN. `fromSquare` narrows to a move starting there too, when the spelled
// phrase named it ("pawn d5 takes on e6", "knight from f5 to g7") -- this
// is what disambiguates when two same-kind pieces could reach the same
// destination.
function resolveSpelledMove(
  fen: string,
  pieceWord: string,
  square: string,
  fromSquare?: string
): string | undefined {
  try {
    const chess = new Chess(fen);
    const kind = PIECE_WORDS[pieceWord.toLowerCase()];
    if (!kind) return undefined;
    const moves = chess.moves({ verbose: true }) as any[];
    const m = moves.find(
      (mv) => mv.piece === kind && mv.to === square.toLowerCase() && (!fromSquare || mv.from === fromSquare.toLowerCase())
    );
    return m?.san;
  } catch {
    return undefined;
  }
}

function resolveCastle(fen: string, side?: string): string | undefined {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true }) as any[];
    if (side && /long|queenside/i.test(side)) return moves.find((m) => m.flags.includes("q"))?.san;
    if (side && /short|kingside/i.test(side)) return moves.find((m) => m.flags.includes("k"))?.san;
    // Bare "castle": ambiguous between short/long when both are legal.
    // Prefer short (the far more common real-game case) and fall back to
    // long -- this is a best-effort resolution for a measurement tool, not
    // a claim about which side the model meant.
    return moves.find((m) => m.flags.includes("k"))?.san ?? moves.find((m) => m.flags.includes("q"))?.san;
  } catch {
    return undefined;
  }
}

// True when `san` (as extracted, or its normalized form) is a legal move at
// `fen` -- the only test that can tell a real recommendation ("dxe6",
// resolved from a legal capture) from a wrong-notation or purely
// descriptive mention (a bare "b3" naming a square that's occupied by the
// opponent's pawn, where the actual legal capture is "axb3", a different
// SAN string entirely). Pass 2 item 1: recommendsOther is defined in terms
// of a move that is LEGAL at chatFen, not merely SAN-shaped.
function isLegalAt(fen: string | null, san: string): boolean {
  if (!fen) return false;
  for (const candidate of [san, normalizeSan(san)]) {
    try {
      const chess = new Chess(fen);
      if (chess.move(candidate)) return true;
    } catch {
      // try the next candidate form
    }
  }
  return false;
}

// ---- sentence-bounded recommendation extraction (pass 2 item 1) ---------
//
// Owner-adjudicated pass 1 rows (132, 252, 299, 300, 304) were ALL tool
// false positives from an 80-character forward window that swept up a
// move from an unrelated clause ("...best move for move 23, but you
// actually played your queen to f6 there instead" flagged f6, a purely
// historical statement, as asserted). A sentence boundary is a much
// tighter scope: the keyword and the move must be claims about the SAME
// clause. ": " is deliberately NOT a boundary (brief step 1) -- "pawn d5
// takes on e6 is stronger: our chess brain has that leading to forced mate
// in 7" is one continuous claim, and splitting on the colon would sever
// the move from the keyword that licenses it.
export function splitSentences(text: string): string[] {
  return text
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const RECOMMEND_KEYWORDS = [
  "stronger",
  "better",
  "best",
  "instead",
  "recommend",
  "should",
  "the move",
  "the one",
  "top pick",
  "likes",
  "wants",
  "cashes in",
  "is the move",
  "go with",
];

// A sentence recommends a move when it contains one of the keyword phrases
// above, OR opens with an imperative "play" ("play h4 instead" -- already
// covered by "instead" too, but "play h4 now" has no other keyword). A
// bare "play" mid-sentence is descriptive ("if you play it, mallow can
// push...") and is deliberately NOT imperative -- only sentence-initial
// counts.
export function sentenceRecommends(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (RECOMMEND_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return /^play\b/.test(lower.trim());
}

// "<piece> <fromSq> takes on <toSq>" ("pawn d5 takes on e6") -- checked
// FIRST, before the plainer "<piece> takes on <sq>" pattern, since it is
// strictly more specific and would otherwise never get a chance to match
// (the plainer pattern's own "takes on" requires the piece word right
// before it, which "pawn d5 takes on e6" does not have).
const SPELLED_FROM_TAKES_RE = /\b(pawn|knight|bishop|rook|queen|king)\s+([a-h][1-8])\s+takes on\s+([a-h][1-8])\b/gi;
// "<piece> from <sq> to <sq>"
const SPELLED_FROM_TO_RE = /\b(pawn|knight|bishop|rook|queen|king)\s+from\s+([a-h][1-8])\s+to\s+([a-h][1-8])\b/gi;
// "<piece> takes on <sq>" / "<piece> takes <sq>" / "<piece> to <sq>"
const SPELLED_RE = /\b(pawn|knight|bishop|rook|queen|king)\s+(?:takes on|takes|to)\s+([a-h][1-8])\b/gi;
const CASTLE_RE = /\bcastl(?:e|es|ing)\b(?:\s+(short|long|kingside|queenside))?/gi;

export interface ExtractedMoves {
  recommended: string[];
  mentioned: string[];
}

// Extracts every move a single sentence names -- SAN-shaped tokens (via
// SAN_RE, the exact loose pattern narrate()/chat() validate against -- it
// also matches a bare square, intentional looseness inherited from that
// pattern) plus spelled-out piece moves and castling, resolved to SAN at
// `fen`. Order-preserving, not deduplicated (the caller dedupes across
// sentences).
function movesInSentence(fen: string | null, sentence: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;

  const sanRe = new RegExp(SAN_RE.source, "g");
  while ((m = sanRe.exec(sentence))) {
    const raw = m[0].replace(/[.,!?;:'"]+$/, "");
    if (raw.length >= 2) out.push(raw);
  }

  if (fen) {
    const fromTakesRe = new RegExp(SPELLED_FROM_TAKES_RE.source, "gi");
    const consumed = new Set<number>(); // char positions claimed by the more specific pattern
    while ((m = fromTakesRe.exec(sentence))) {
      const san = resolveSpelledMove(fen, m[1], m[3], m[2]);
      if (san) out.push(san);
      consumed.add(m.index);
    }
    const fromToRe = new RegExp(SPELLED_FROM_TO_RE.source, "gi");
    while ((m = fromToRe.exec(sentence))) {
      const san = resolveSpelledMove(fen, m[1], m[3], m[2]);
      if (san) out.push(san);
      consumed.add(m.index);
    }
    const spelledRe = new RegExp(SPELLED_RE.source, "gi");
    while ((m = spelledRe.exec(sentence))) {
      if (consumed.has(m.index)) continue; // already handled by a more specific pattern above
      const san = resolveSpelledMove(fen, m[1], m[2]);
      if (san) out.push(san);
    }
    const castleRe = new RegExp(CASTLE_RE.source, "gi");
    while ((m = castleRe.exec(sentence))) {
      const san = resolveCastle(fen, m[1]);
      if (san) out.push(san);
    }
  }

  return out;
}

// Splits `text` into sentences, then extracts moves per sentence: every
// move found anywhere goes into `mentioned`; a move found in a sentence
// that ALSO recommends (per sentenceRecommends above) goes into
// `recommended`. Both deduplicated (by sanBase) but order-preserving.
function extractMoves(fen: string | null, text: string): ExtractedMoves {
  const recommended: string[] = [];
  const mentioned: string[] = [];
  const seenRecommended = new Set<string>();
  const seenMentioned = new Set<string>();

  for (const sentence of splitSentences(text)) {
    const recommends = sentenceRecommends(sentence);
    for (const san of movesInSentence(fen, sentence)) {
      const base = sanBase(san);
      if (!seenMentioned.has(base)) {
        seenMentioned.add(base);
        mentioned.push(san);
      }
      if (recommends && !seenRecommended.has(base)) {
        seenRecommended.add(base);
        recommended.push(san);
      }
    }
  }

  return { recommended, mentioned };
}

// ---- motif denial --------------------------------------------------------

const DENIAL_RE =
  /\b(no fork|not a fork|isn't a fork|no discovered|no mate|not mate|isn't mate|no threat|isn't a threat|doesn't work|hasn't worked out|no line|can't tell you what happens)\b/gi;

function findDenials(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(DENIAL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

// ---- db access -----------------------------------------------------------

function safeParse(json: string | null): any {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

interface GameEventRow {
  id: number;
  game_id: number;
  type: string;
  detail: string | null;
  at: string;
}

// Latest ladder event (hint | hint_compute) whose own detail.fen matches
// chatFen, at or before created_at -- and separately, the nearest one
// AFTER, within 5 minutes (brief step 2: she may have asked before
// pressing "more"). Both converted uci->san by replay from that event's OWN
// fen, never chatFen (they can differ if the ladder moved on by the time
// she asked).
function findLadderFacts(
  events: GameEventRow[],
  chatFen: string,
  createdAt: string
): { before: LadderFact | null; after: LadderFact | null } {
  let before: GameEventRow | null = null;
  let after: GameEventRow | null = null;
  const createdMs = Date.parse(createdAt.replace(" ", "T") + "Z");
  for (const ev of events) {
    if (ev.type !== "hint" && ev.type !== "hint_compute") continue;
    const detail = safeParse(ev.detail);
    if (!detail || detail.fen !== chatFen) continue;
    if (ev.at <= createdAt) {
      if (!before || ev.at > before.at) before = ev;
    } else {
      const evMs = Date.parse(ev.at.replace(" ", "T") + "Z");
      if (evMs - createdMs <= 5 * 60 * 1000) {
        if (!after || ev.at < after.at) after = ev;
      }
    }
  }
  const toFact = (ev: GameEventRow | null): LadderFact | null => {
    if (!ev) return null;
    const detail = safeParse(ev.detail) ?? {};
    return {
      fen: detail.fen,
      at: ev.at,
      eventType: ev.type as "hint" | "hint_compute",
      bestSan: uciToSan(detail.fen, detail.bestUci),
      refutationSan: uciToSan(detail.fen, detail.refutationUci),
      verified: ev.type === "hint_compute" ? Boolean(detail.escalated) : undefined,
    };
  };
  return { before: toFact(before), after: toFact(after) };
}

// ---- classification --------------------------------------------------

export function classifyRow(row: {
  chatBest: string | null;
  ctxBest: string | null;
  recommendedMoves: string[];
  mentionsLadderBest: boolean | null;
  recommendsOther: boolean | null;
  ladderBest: LadderFact | null;
  verdict: VerdictMotif | null;
  threatMotif: string | null;
  threatRefutationSan: string | null;
  denialFragments: string[];
}): { primary: AgreementClass; secondary: AgreementClass | null } {
  const fits: Record<AgreementClass, boolean> = {
    "two-bests-in-prompt": false,
    mixed: false,
    "disagree-best": false,
    "motif-denied": false,
    agree: false,
    "no-ladder-fact": false,
    "no-claim": false,
  };

  if (row.chatBest && row.ctxBest && sanBase(row.chatBest) !== sanBase(row.ctxBest)) {
    fits["two-bests-in-prompt"] = true;
  }

  // Pass 2 item 1: agree/disagree-best/mixed are now defined on
  // mentionsLadderBest (the ladder's best appears ANYWHERE in the reply)
  // and recommendsOther (a sentence-bounded, legal-at-chatFen recommended
  // move that differs from it) -- both null when there is no ladder best
  // to compare against, which is the no-ladder-fact branch below.
  if (row.ladderBest?.bestSan) {
    if (row.mentionsLadderBest && row.recommendsOther) fits.mixed = true;
    else if (row.mentionsLadderBest) fits.agree = true;
    else if (row.recommendsOther) fits["disagree-best"] = true;
  } else if (!row.ladderBest && !row.verdict) {
    // No ladder event matched this fen at all, and no verdict row exists
    // for this ply either -- there is simply nothing from the ladder side
    // to agree or disagree with.
    fits["no-ladder-fact"] = true;
  }

  const motif = row.threatMotif ?? row.verdict?.motif ?? null;
  const refutation = row.threatRefutationSan ?? row.verdict?.refutationSan ?? null;
  if (motif && refutation && row.denialFragments.length > 0) fits["motif-denied"] = true;

  if (row.recommendedMoves.length === 0 && row.denialFragments.length === 0) fits["no-claim"] = true;

  const applicable = CLASS_PRIORITY.filter((c) => fits[c]);
  if (applicable.length === 0) return { primary: "no-claim", secondary: null };
  return { primary: applicable[0], secondary: applicable[1] ?? null };
}

// ---- main sweep -----------------------------------------------------

interface ChatTraceRow {
  id: number;
  game_id: number;
  ply: number | null;
  kind: string;
  source: string;
  facts_json: string | null;
  output: string;
  rating: number | null;
  created_at: string;
}

// Shared by the main --since sweep and the owner-recorded-case lookups
// (which must always resolve regardless of --since): builds one full
// RowRecord for a chat trace row, given the game's own game_events and
// verdicts already fetched.
export function buildRowRecord(row: ChatTraceRow, gameEvents: GameEventRow[], verdictRows: any[]): RowRecord {
  const facts = safeParse(row.facts_json) ?? {};
  const chatFen: string | null = facts.hintFindings?.fen ?? facts.currentFen ?? facts.focusPosition?.fen ?? null;
  const chatBest: string | null = facts.hintFindings?.bestSan ?? null;
  const chatBestVerified: boolean | null =
    typeof facts.hintFindings?.verified === "boolean" ? facts.hintFindings.verified : null;
  const ctxBest: string | null = facts.context?.best?.san ?? null;
  const mode: string | null = facts.context?.mode ?? null;
  const threat = facts.context?.threat ?? facts.context?.hintFocus?.threat ?? null;
  const threatMotif: string | null = threat?.motif ?? null;
  const threatRefutationSan: string | null = threat?.refutationSan ?? null;

  const { recommended, mentioned } = extractMoves(chatFen, row.output ?? "");
  const denialFragments = findDenials(row.output ?? "");

  const ladder = chatFen ? findLadderFacts(gameEvents, chatFen, row.created_at) : { before: null, after: null };
  const ladderBestSan = ladder.before?.bestSan;

  // Both null (never false) when there's no ladder best to compare against
  // at all -- see RowRecord's own comment on these two fields.
  const mentionsLadderBest = ladderBestSan
    ? mentioned.map(sanBase).includes(sanBase(ladderBestSan))
    : null;
  const recommendsOther = ladderBestSan
    ? recommended.some((san) => sanBase(san) !== sanBase(ladderBestSan) && isLegalAt(chatFen, san))
    : null;

  const matchingVerdicts = verdictRows.filter((v) => v.ply === row.ply);
  let verdict: VerdictMotif | null = null;
  if (matchingVerdicts.length > 0) {
    const last = matchingVerdicts[matchingVerdicts.length - 1];
    const vf = safeParse(last.facts_json);
    verdict = { motif: vf?.motif ?? null, refutationSan: vf?.refutationSan ?? null };
  }

  const { primary, secondary } = classifyRow({
    chatBest,
    ctxBest,
    recommendedMoves: recommended,
    mentionsLadderBest,
    recommendsOther,
    ladderBest: ladder.before,
    verdict,
    threatMotif,
    threatRefutationSan,
    denialFragments,
  });

  return {
    traceId: row.id,
    gameId: row.game_id,
    ply: row.ply,
    rating: row.rating,
    createdAt: row.created_at,
    kind: row.kind,
    source: row.source,
    output: row.output ?? "",
    chatFen,
    chatBest,
    chatBestVerified,
    ctxBest,
    mode,
    threatMotif,
    threatRefutationSan,
    recommendedMoves: recommended,
    mentionedMoves: mentioned,
    mentionsLadderBest,
    recommendsOther,
    denialFragments,
    ladderBest: ladder.before,
    ladderBestAfter: ladder.after,
    verdict,
    cls: primary,
    secondaryCls: secondary,
  };
}

function fmtLadder(l: LadderFact | null): string {
  if (!l) return "none";
  const v = l.verified === true ? "verified" : l.verified === false ? "unverified" : "?";
  return `${l.bestSan ?? "(no best)"} (${v})`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// ---- fact presence (pass 2 item 2) ---------------------------------------

export interface PresenceTotals {
  total: number;
  ctxBestPresent: number;
  hintFindingsBestPresent: number;
  bothPresent: number;
  bothEqual: number;
  bothDifferent: number;
  verifiedTrue: number;
  verifiedFalse: number;
  verifiedAbsent: number;
}

// Counts how often the two independent "what's best here" facts a chat
// prompt can carry -- context.best.san (the judge's fact about her
// just-played move) and hintFindings.bestSan (the ladder's fact about the
// position she's asking about) -- are present, and when both are present,
// whether they agree. This is the population two-bests-in-prompt draws
// from; reporting it directly answers "why was that class 0" without
// requiring a re-read of every row.
export function factPresenceTotals(records: RowRecord[]): PresenceTotals {
  const t: PresenceTotals = {
    total: records.length,
    ctxBestPresent: 0,
    hintFindingsBestPresent: 0,
    bothPresent: 0,
    bothEqual: 0,
    bothDifferent: 0,
    verifiedTrue: 0,
    verifiedFalse: 0,
    verifiedAbsent: 0,
  };
  for (const r of records) {
    if (r.ctxBest) t.ctxBestPresent++;
    if (r.chatBest) t.hintFindingsBestPresent++;
    if (r.ctxBest && r.chatBest) {
      t.bothPresent++;
      if (sanBase(r.ctxBest) === sanBase(r.chatBest)) t.bothEqual++;
      else t.bothDifferent++;
    }
    if (r.chatBestVerified === true) t.verifiedTrue++;
    else if (r.chatBestVerified === false) t.verifiedFalse++;
    else t.verifiedAbsent++;
  }
  return t;
}

// Opens the real db readonly (the only way this tool is ever invoked
// against her data) and delegates to analyze(). Split out so tests can
// call analyze() directly against an openDb(":memory:") handle -- a
// readonly connection to a SEPARATE :memory: db shares nothing with the
// writable connection a test just populated (better-sqlite3's :memory: is
// private per connection), so the readonly-open step itself is untestable
// and is not what this tool's correctness lives in; analyze()'s query and
// classification logic is.
export function runReport(dbPath: string, since: string, jsonOut?: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return analyze(db, since, jsonOut);
  } finally {
    db.close();
  }
}

export function analyze(db: InstanceType<typeof Database>, since: string, jsonOut?: string) {
  {
    const chatRows = db
      .prepare(
        `SELECT * FROM advice_traces WHERE kind = 'chat' AND source = 'model' AND created_at >= ? ORDER BY id`
      )
      .all(since) as ChatTraceRow[];

    const eventsByGame = new Map<number, GameEventRow[]>();
    const verdictsByGame = new Map<number, any[]>();
    const records: RowRecord[] = [];

    for (const row of chatRows) {
      if (!eventsByGame.has(row.game_id)) {
        eventsByGame.set(
          row.game_id,
          db
            .prepare(`SELECT * FROM game_events WHERE game_id = ? AND type IN ('hint','hint_compute') ORDER BY at, id`)
            .all(row.game_id) as GameEventRow[]
        );
      }
      if (!verdictsByGame.has(row.game_id)) {
        verdictsByGame.set(
          row.game_id,
          db.prepare(`SELECT * FROM verdicts WHERE game_id = ? ORDER BY id`).all(row.game_id) as any[]
        );
      }
      records.push(buildRowRecord(row, eventsByGame.get(row.game_id)!, verdictsByGame.get(row.game_id)!));
    }

    // ---- totals, split pre/post the 2026-08-28 same-fen search-variance
    // guard (commit da3be2d) ------------------------------------------
    const SPLIT_DATE = "2026-08-28";
    const totals: Record<AgreementClass, { pre: number; post: number }> = {
      "two-bests-in-prompt": { pre: 0, post: 0 },
      mixed: { pre: 0, post: 0 },
      "disagree-best": { pre: 0, post: 0 },
      "motif-denied": { pre: 0, post: 0 },
      agree: { pre: 0, post: 0 },
      "no-ladder-fact": { pre: 0, post: 0 },
      "no-claim": { pre: 0, post: 0 },
    };
    for (const r of records) {
      const bucket = r.createdAt < SPLIT_DATE ? "pre" : "post";
      totals[r.cls][bucket]++;
    }

    console.log(`chat rows since ${since}: ${records.length}`);
    console.log(`\nTotals per class (pre ${SPLIT_DATE} / post ${SPLIT_DATE}):`);
    for (const cls of CLASS_PRIORITY) {
      console.log(`  ${cls}: ${totals[cls].pre} / ${totals[cls].post} (total ${totals[cls].pre + totals[cls].post})`);
    }

    for (const cls of ["disagree-best", "mixed", "two-bests-in-prompt", "motif-denied"] as AgreementClass[]) {
      const rows = records.filter((r) => r.cls === cls);
      console.log(`\n--- ${cls} (${rows.length}) ---`);
      for (const r of rows) {
        const denial = r.denialFragments[0] ?? "";
        console.log(
          `${r.traceId} | game ${r.gameId} | ply ${r.ply} | rating ${r.rating ?? "none"} | ` +
            `recommended ${r.recommendedMoves.join(",") || "(none)"} | ladder ${fmtLadder(r.ladderBest)} | ` +
            `ctx ${r.ctxBest ?? "none"} | motif ${r.threatMotif ?? r.verdict?.motif ?? "none"} | ` +
            `denial "${truncate(denial, 60)}"`
        );
      }
    }

    // ---- fact presence (pass 2 item 2): how often the two independent
    // "what's best here" facts even exist, agree, or disagree in the
    // prompt itself -- this is why two-bests-in-prompt came out 0 in pass
    // 1: it requires BOTH context.best.san and hintFindings.bestSan to be
    // present on the SAME row, which is rare (context.best is a judge-time
    // fact about her just-played move; hintFindings is only populated when
    // a ladder hint's fen happened to match currentFen/focusPosition.fen).
    const presencePre = factPresenceTotals(records.filter((r) => r.createdAt < SPLIT_DATE));
    const presencePost = factPresenceTotals(records.filter((r) => r.createdAt >= SPLIT_DATE));
    console.log(`\nFact presence, pre ${SPLIT_DATE} / post ${SPLIT_DATE}:`);
    console.log(`  rows: ${presencePre.total} / ${presencePost.total}`);
    console.log(`  ctxBest present: ${presencePre.ctxBestPresent} / ${presencePost.ctxBestPresent}`);
    console.log(
      `  hintFindings.bestSan present: ${presencePre.hintFindingsBestPresent} / ${presencePost.hintFindingsBestPresent}`
    );
    console.log(`  both present: ${presencePre.bothPresent} / ${presencePost.bothPresent}`);
    console.log(`  both present, equal: ${presencePre.bothEqual} / ${presencePost.bothEqual}`);
    console.log(`  both present, different: ${presencePre.bothDifferent} / ${presencePost.bothDifferent}`);
    console.log(
      `  hintFindings.verified: true ${presencePre.verifiedTrue}/${presencePost.verifiedTrue}, ` +
        `false ${presencePre.verifiedFalse}/${presencePost.verifiedFalse}, ` +
        `absent ${presencePre.verifiedAbsent}/${presencePost.verifiedAbsent}`
    );

    // ---- owner-recorded cases, regardless of class or --since window --
    const ownerIds = [159, 161, 190, 291, 292, 297, 319, 329];
    console.log(`\n--- owner-recorded cases (by trace id) ---`);
    for (const id of ownerIds) {
      const trace = db.prepare(`SELECT * FROM advice_traces WHERE id = ?`).get(id) as ChatTraceRow | undefined;
      if (!trace) {
        console.log(`${id}: no such advice_traces row`);
        continue;
      }
      if (trace.kind === "chat" && trace.source === "model") {
        const events =
          eventsByGame.get(trace.game_id) ??
          (db
            .prepare(`SELECT * FROM game_events WHERE game_id = ? AND type IN ('hint','hint_compute') ORDER BY at, id`)
            .all(trace.game_id) as GameEventRow[]);
        const verdictRows =
          verdictsByGame.get(trace.game_id) ??
          (db.prepare(`SELECT * FROM verdicts WHERE game_id = ? ORDER BY id`).all(trace.game_id) as any[]);
        const rec = buildRowRecord(trace, events, verdictRows);
        console.log(
          `${id}: kind=chat class=${rec.cls}${rec.secondaryCls ? `/${rec.secondaryCls}` : ""} ` +
            `recommended=${rec.recommendedMoves.join(",") || "(none)"} ladder=${fmtLadder(rec.ladderBest)} ` +
            `ctxBest=${rec.ctxBest ?? "none"} denial="${truncate(rec.denialFragments[0] ?? "", 60)}"`
        );
      } else {
        console.log(`${id}: kind=${trace.kind} source=${trace.source} output="${truncate(trace.output ?? "", 200)}"`);
        const windowMs = 2 * 60 * 1000;
        const created = Date.parse(trace.created_at.replace(" ", "T") + "Z");
        const nearby = (
          db.prepare(`SELECT * FROM advice_traces WHERE game_id = ? AND kind = 'chat' AND source = 'model'`).all(
            trace.game_id
          ) as ChatTraceRow[]
        ).filter((r) => Math.abs(Date.parse(r.created_at.replace(" ", "T") + "Z") - created) <= windowMs);
        for (const n of nearby) {
          const events =
            eventsByGame.get(n.game_id) ??
            (db
              .prepare(
                `SELECT * FROM game_events WHERE game_id = ? AND type IN ('hint','hint_compute') ORDER BY at, id`
              )
              .all(n.game_id) as GameEventRow[]);
          const verdictRows =
            verdictsByGame.get(n.game_id) ??
            (db.prepare(`SELECT * FROM verdicts WHERE game_id = ? ORDER BY id`).all(n.game_id) as any[]);
          const rec = buildRowRecord(n, events, verdictRows);
          console.log(
            `  nearby chat trace ${n.id}: class=${rec.cls} recommended=${rec.recommendedMoves.join(",") || "(none)"} ` +
              `output="${truncate(n.output ?? "", 150)}"`
          );
        }
      }
    }

    if (jsonOut) {
      fs.writeFileSync(jsonOut, JSON.stringify(records, null, 2));
      console.log(`\nwrote ${records.length} records to ${jsonOut}`);
    }

    return records;
  }
}

// Only run when invoked directly (tsx tools/coach-ladder-agreement.ts), not
// when imported by the test file.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(TOOL_DIR, "coach-ladder-agreement.ts");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(process.cwd(), args.db);
  runReport(dbPath, args.since, args.json);
}
