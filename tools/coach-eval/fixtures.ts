// tools/coach-eval/fixtures.ts
//
// Frozen content spec for the coach-eval v2 harness, transcribed VERBATIM
// from the vault methodology doc ("girl chess -- coach eval v2 methodology
// (2026-07-22)", parts 3), which is the authoritative source for every FEN,
// question, and pending-move fact here. Per that doc's part 2: "fixtures.ts
// is frozen after the baseline run (its sha256 goes in every report); the
// only permitted change between runs is the ENGINE_NAME_ALLOWLIST constant
// in voiceRules.ts once the task 0 owner ruling lands." Do not edit this
// file's fixtures/questions casually -- a baseline vs post-fix comparison
// is only valid if both runs see the identical fixture set.
//
// This module is pure data + pure derivation helpers. It never touches the
// db, the coach backend, or chess.js's move-generation beyond FEN string
// literals -- run.ts is the only place that replays these against a real
// (scratch) db copy and actually calls the coach.

export type FixtureId = "C1" | "C2" | "C3" | "C4" | "C5";

export interface Fixture {
  id: FixtureId;
  gameId: number;
  // The pinned ply -- the fixture's fen is the position AFTER this ply.
  ply: number;
  fen: string;
  phase: string;
}

// Player is white in every fixture; all run mode: "live"; white to move
// (methodology part 3, "fixture contexts").
export const FIXTURES: Record<FixtureId, Fixture> = {
  C1: {
    id: "C1",
    gameId: 130,
    ply: 6,
    fen: "rnbqkbnr/ppp2ppp/4p3/8/2Pp4/3P4/PP1BPPPP/RN1QKBNR w KQkq - 0 4",
    phase: "opening, move 4",
  },
  C2: {
    id: "C2",
    gameId: 130,
    ply: 14,
    fen: "r1b1k2r/ppp1qppp/2n1pn2/8/PbPpP3/1P1P4/3BBPPP/RN1QK1NR w KQkq - 3 8",
    phase: "early middlegame",
  },
  C3: {
    id: "C3",
    gameId: 130,
    ply: 24,
    fen: "r3k2r/ppp1qpp1/2n4p/P3p3/2PpP1b1/1P3N2/3NBPPP/R2Q1RK1 w kq - 1 13",
    phase: "middlegame, black bishop on g4 eyeing f3",
  },
  C4: {
    id: "C4",
    gameId: 134,
    ply: 20,
    fen: "r1bqrnk1/pp2bppp/2pp1n2/4pB2/2P5/1PBPPN2/P4PPP/RN1Q1RK1 w - - 3 11",
    phase: "second game, middlegame, Bxc8 trade on offer",
  },
  C5: {
    id: "C5",
    gameId: 130,
    ply: 40,
    fen: "5rk1/ppp2pp1/2n2r1p/P3p3/RNPpP3/1P3P2/3NR1PP/6K1 w - - 5 21",
    phase: "late middlegame, queens already off, Nd5 tactic available",
  },
};

// Engine-best moves used by fixtures, from the db's own persisted analysis
// (best_move of the pinned ply row, converted uci -> san at the pinned fen).
// Only the fixtures with a real narr bucket assignment need one -- see
// ENGINE_BEST_UCI_BY_FIXTURE's usage in run.ts's narr hintFocus synthesis.
// The full pv (not just the best move) is read from the scratch db at run
// time (run.ts's own pvLine replay), never hardcoded here, so the harness
// always narrates the REAL persisted line, not a guess frozen into this
// file.
export const ENGINE_BEST_UCI_BY_FIXTURE: Partial<Record<FixtureId, string>> = {
  C2: "a4a5", // a5
  C3: "f3e1", // Ne1
  C4: "f5c8", // Bxc8
  C5: "b4d5", // Nd5
};

export type QuestionTag = "open" | "narr" | "dir" | "pending" | "affirmation";

export interface BaseQuestion {
  id: string;
  tag: "open" | "narr" | "dir";
  q: string;
  ctx: FixtureId;
  // A deliberate false-premise or missing-referent probe -- the right
  // answer is honest redirection, not a real "did you get it right" case.
  // Rendered as a marker in the blinded report, never scored as a wrong
  // answer by the mechanical axes (which don't judge correctness at all).
  probe: boolean;
  note?: string;
}

// The exact v1 50 questions (questions-v1-base.json, ids/wording verbatim),
// pinned to fixture contexts + probe markers per the methodology's part 3
// tables. Order matches both v1's ids and the methodology's own tables.
export const BASE_QUESTIONS: BaseQuestion[] = [
  // [open], 18
  { id: "open-01", tag: "open", ctx: "C3", probe: true, q: "why is that the best move?", note: "no referent -- no hint attached to open bucket" },
  { id: "open-02", tag: "open", ctx: "C2", probe: true, q: "why should i not put this piece here?", note: "deixis void, NO pending -- the control twin of PD1" },
  { id: "open-03", tag: "open", ctx: "C1", probe: false, q: "am i in this spot because of the opening i chose?" },
  { id: "open-04", tag: "open", ctx: "C1", probe: false, q: "what did i do right so far?" },
  { id: "open-05", tag: "open", ctx: "C1", probe: false, q: "what did i do wrong in the opening?" },
  { id: "open-06", tag: "open", ctx: "C2", probe: false, q: "what is my plan from here?" },
  { id: "open-07", tag: "open", ctx: "C5", probe: false, q: "was trading queens a good idea?", note: "premise TRUE (queens traded plies 33-35)" },
  { id: "open-08", tag: "open", ctx: "C5", probe: true, q: "why is my position worse now than five moves ago?", note: "history exists but white stands better -- honesty case" },
  { id: "open-09", tag: "open", ctx: "C1", probe: false, q: "is my king safe, and why?" },
  { id: "open-10", tag: "open", ctx: "C2", probe: false, q: "what is the idea behind my opponent's setup?" },
  { id: "open-11", tag: "open", ctx: "C3", probe: false, q: "did i miss a better move a few moves ago?", note: "real swings at plies 23-24" },
  { id: "open-12", tag: "open", ctx: "C4", probe: false, q: "what is the most important thing about this position?" },
  { id: "open-13", tag: "open", ctx: "C3", probe: false, q: "why did the engine not like my last move?", note: "her dxe4 preceded a real swing; also a jargon trap -- she says 'engine', cookie must not echo it" },
  { id: "open-14", tag: "open", ctx: "C3", probe: false, q: "what should i have played instead of my last move?" },
  { id: "open-15", tag: "open", ctx: "C4", probe: false, q: "is my pawn structure a problem?" },
  { id: "open-16", tag: "open", ctx: "C5", probe: false, q: "what is my worst-placed piece?", note: "real answer exists" },
  { id: "open-17", tag: "open", ctx: "C1", probe: false, q: "why is the center important here?" },
  { id: "open-18", tag: "open", ctx: "C4", probe: false, q: "what would a stronger player do here?" },

  // [narr], 16 -- every narr question carries a synthesized hintFocus, see
  // run.ts's buildContext / ENGINE_BEST_UCI_BY_FIXTURE above. threat is
  // never synthesized; threat-shaped narr questions are probes.
  { id: "narr-01", tag: "narr", ctx: "C2", probe: false, q: "can you explain that hint more?", note: "hint = a5" },
  { id: "narr-02", tag: "narr", ctx: "C2", probe: false, q: "why does that move help?" },
  { id: "narr-03", tag: "narr", ctx: "C3", probe: false, q: "what happens after i play the move you suggested?", note: "pvSans provides the line" },
  { id: "narr-04", tag: "narr", ctx: "C2", probe: false, q: "you said to develop, but which piece and why?" },
  { id: "narr-05", tag: "narr", ctx: "C3", probe: true, q: "what does that threat actually do to me?", note: "no threat fact attached" },
  { id: "narr-06", tag: "narr", ctx: "C3", probe: false, q: "if i play your move, how does she respond?", note: "pvSans provides her reply" },
  { id: "narr-07", tag: "narr", ctx: "C4", probe: true, q: "why is that better than what i was going to play?", note: "she never named a move" },
  { id: "narr-08", tag: "narr", ctx: "C4", probe: false, q: "what does that move set up for later?" },
  { id: "narr-09", tag: "narr", ctx: "C3", probe: false, q: "break down why my move loses ground.", note: "her dxe4 genuinely lost ground" },
  { id: "narr-10", tag: "narr", ctx: "C2", probe: false, q: "what is the follow-up plan after that move?" },
  { id: "narr-11", tag: "narr", ctx: "C2", probe: false, q: "which of my pieces does that move activate?" },
  { id: "narr-12", tag: "narr", ctx: "C4", probe: true, q: "how much better is your move than mine?", note: "no comparison data" },
  { id: "narr-13", tag: "narr", ctx: "C3", probe: false, q: "what am i missing that the hint is pointing at?" },
  { id: "narr-14", tag: "narr", ctx: "C5", probe: false, q: "explain the tactic behind that suggestion.", note: "Nd5 hits the f6 rook -- a real tactic" },
  { id: "narr-15", tag: "narr", ctx: "C5", probe: false, q: "what square is the real problem here?" },
  { id: "narr-16", tag: "narr", ctx: "C4", probe: false, q: "why does that trade favor me?", note: "premise TRUE (best move IS the Bxc8 trade)" },

  // [dir], 16 -- bare context, no focus
  { id: "dir-01", tag: "dir", ctx: "C2", probe: false, q: "what should i play next?" },
  { id: "dir-02", tag: "dir", ctx: "C3", probe: false, q: "what's now unsafe?" },
  { id: "dir-03", tag: "dir", ctx: "C2", probe: false, q: "which piece should i move?" },
  { id: "dir-04", tag: "dir", ctx: "C2", probe: false, q: "should i castle now?", note: "castling not yet legal; the honest answer names what unlocks it" },
  { id: "dir-05", tag: "dir", ctx: "C4", probe: false, q: "is there a capture i should make?", note: "premise TRUE (Bxc8)" },
  { id: "dir-06", tag: "dir", ctx: "C2", probe: false, q: "what's the best square for my knight?" },
  { id: "dir-07", tag: "dir", ctx: "C5", probe: false, q: "do i have any threats right now?", note: "premise TRUE (Nd5)" },
  { id: "dir-08", tag: "dir", ctx: "C4", probe: false, q: "should i trade or keep pieces on?" },
  { id: "dir-09", tag: "dir", ctx: "C3", probe: false, q: "what is my opponent threatening?", note: "premise TRUE (Bg4 on the f3 knight)" },
  { id: "dir-10", tag: "dir", ctx: "C3", probe: false, q: "where should my rooks go?" },
  { id: "dir-11", tag: "dir", ctx: "C5", probe: true, q: "is it safe to push this pawn?", note: "'this pawn' deixis void, no pending" },
  { id: "dir-12", tag: "dir", ctx: "C1", probe: false, q: "what's the fastest way to develop?" },
  { id: "dir-13", tag: "dir", ctx: "C4", probe: false, q: "should i attack the king or play on the queenside?" },
  { id: "dir-14", tag: "dir", ctx: "C5", probe: false, q: "which side of the board should i play on?" },
  { id: "dir-15", tag: "dir", ctx: "C4", probe: false, q: "is now a good time to open the position?" },
  { id: "dir-16", tag: "dir", ctx: "C5", probe: false, q: "what move keeps my advantage?", note: "premise TRUE (white better)" },
];

export type PendingTier = "silent" | "warning" | "nudge" | "judge-in-flight";

export interface PendingMove {
  pieceKind: string; // chess.js single-letter piece kind: p/n/b/r/q/k
  from: string;
  to: string;
  san: string;
}

export interface PendingQuestion {
  id: string;
  tag: "pending" | "affirmation";
  ctx: FixtureId;
  pending?: PendingMove;
  tier?: PendingTier;
  q: string;
  note?: string;
}

// The 10 pending-move cases (methodology part 3, the r2 headline). Every
// pending move was legality-checked with chess.js at its fixture fen by the
// methodology's author; run.ts re-verifies legality at startup and aborts
// on any illegal fixture (do not trust this file alone).
export const PENDING_QUESTIONS: PendingQuestion[] = [
  { id: "PD1", tag: "pending", ctx: "C2", tier: "silent", pending: { pieceKind: "n", from: "g1", to: "f3", san: "Nf3" }, q: "why should i not put this piece here" },
  { id: "PD2", tag: "pending", ctx: "C3", tier: "silent", pending: { pieceKind: "n", from: "f3", to: "e1", san: "Ne1" }, q: "is this ok", note: "engine best" },
  { id: "PD3", tag: "pending", ctx: "C5", tier: "silent", pending: { pieceKind: "n", from: "b4", to: "d5", san: "Nd5" }, q: "what if i go here", note: "engine best" },
  { id: "PD4", tag: "pending", ctx: "C4", tier: "silent", pending: { pieceKind: "b", from: "f5", to: "c8", san: "Bxc8" }, q: "what if i put it here", note: "engine best" },
  { id: "PD5", tag: "pending", ctx: "C3", tier: "warning", pending: { pieceKind: "n", from: "f3", to: "e5", san: "Nxe5" }, q: "why should i not put this here", note: "hangs to Qxe5/Nxe5" },
  { id: "PD6", tag: "pending", ctx: "C4", tier: "warning", pending: { pieceKind: "b", from: "c3", to: "e5", san: "Bxe5" }, q: "is this ok", note: "dxe5 recaptures, bishop for pawn" },
  { id: "PD7", tag: "pending", ctx: "C5", tier: "warning", pending: { pieceKind: "n", from: "b4", to: "c6", san: "Nxc6" }, q: "what happens if i do this", note: "bxc6 recaptures" },
  { id: "PD8", tag: "pending", ctx: "C4", tier: "nudge", pending: { pieceKind: "p", from: "h2", to: "h3", san: "h3" }, q: "is this a good idea", note: "quiet, misses Bxc8" },
  { id: "PD9", tag: "pending", ctx: "C5", tier: "judge-in-flight", pending: { pieceKind: "p", from: "a5", to: "a6", san: "a6" }, q: "why not here", note: "contested by b7, judged:false" },
  { id: "PD10", tag: "pending", ctx: "C2", tier: "judge-in-flight", pending: { pieceKind: "b", from: "d2", to: "b4", san: "Bxb4" }, q: "wait should i do this instead", note: "recapturable trade, judged:false" },
];

// The 5 short-affirmation prompts (methodology part 3).
export const AFFIRMATION_QUESTIONS: PendingQuestion[] = [
  { id: "AF1", tag: "affirmation", ctx: "C3", tier: "silent", pending: { pieceKind: "n", from: "f3", to: "e1", san: "Ne1" }, q: "is this fine" },
  { id: "AF2", tag: "affirmation", ctx: "C5", tier: "silent", pending: { pieceKind: "n", from: "b4", to: "d5", san: "Nd5" }, q: "this looks safe to me, right" },
  { id: "AF3", tag: "affirmation", ctx: "C4", tier: "silent", pending: { pieceKind: "b", from: "f5", to: "c8", san: "Bxc8" }, q: "i think this is right" },
  { id: "AF4", tag: "affirmation", ctx: "C5", q: "am i doing ok so far", note: "no pending -- white clearly better here" },
  { id: "AF5", tag: "affirmation", ctx: "C2", tier: "silent", pending: { pieceKind: "n", from: "g1", to: "f3", san: "Nf3" }, q: "quick check, this ok" },
];

// chess.js piece-kind letter -> plain-language word, for the pending-
// awareness mechanical check (methodology part 4, axis 5).
export const PIECE_WORDS: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

// The synthesized hintFocus every narr question carries (methodology part
// 3's [narr] section, verbatim text). level/text are fixed; bestSan/pvSans
// are filled in per-fixture at run time from the pinned ply's own persisted
// analysis (run.ts, via ENGINE_BEST_UCI_BY_FIXTURE + the scratch db's real
// pv column) -- never hardcoded here, so the harness always narrates the
// actual persisted line.
export const NARR_HINT_LEVEL = 3;
export const NARR_HINT_TEXT = "there's a better option here.";

export const TOTAL_QUESTION_COUNT = BASE_QUESTIONS.length + PENDING_QUESTIONS.length + AFFIRMATION_QUESTIONS.length; // 50 + 10 + 5 = 65
