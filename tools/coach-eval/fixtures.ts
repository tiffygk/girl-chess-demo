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

// Wave E1 (coach-truth-speed round, 2026-07-27): the owner's ask -- "if I ask
// a question specifically about a move or the board, it should only use the
// chess brain... if I'm asking general chess questions, we should see if it
// works" -- adds two new arms alongside the original (now-named) "board-live"
// arm. `arm` is the axis decide.ts and render.ts now score/aggregate BY;
// `tag` (below) stays the bucket label it always was (open/narr/dir/pending/
// affirmation), extended with "general" for the new arm's own rows.
// RCA acceptance-evals round (2026-07-31): three ADDITIVE arms, one per new
// fixture class (spec section 1/3) -- "fork" (suite FH, forced-loss honesty),
// "mate" (suite NM, forced-mate next-move naming), "long" (suite CE's
// early/late latency cells). Each gets its own arm rather than folding into
// board-live so a scoring/reporting bug in one class can never silently
// change board-live's frozen 65-question numbers (same discipline "general"
// and "board-review" already established in wave E1).
export type Arm = "board-live" | "general" | "board-review" | "fork" | "mate" | "long";

export type LiveFixtureId = "C1" | "C2" | "C3" | "C4" | "C5";
// Eval-instrument-repair round (2026-07-28): the board-review arm's own
// fixtures, pinned to the FINAL ply of games that genuinely finished. See
// REVIEW_FIXTURE_IDS / the board-review section below for why they exist.
export type ReviewFixtureId = "R1" | "R2" | "R3";
// RCA acceptance-evals round: fork-*/mate-*/long-* fixture ids. Unlike
// R1-R3, these pin a MID-game ply of a finished game (not its final ply) --
// see MidGameOfFinished below for why that needs its own assertion rather
// than reusing `finished`.
export type ForkFixtureId = "FK1" | "FK2" | "FK3" | "FK4" | "FK5" | "FK6";
export type MateFixtureId = "MT1" | "MT2" | "MT3" | "MT4" | "MT5" | "MT6" | "MT7";
export type LongFixtureId = "LN1" | "LN2" | "LN3" | "LN4";
export type FixtureId = LiveFixtureId | ReviewFixtureId | ForkFixtureId | MateFixtureId | LongFixtureId;

export interface Fixture {
  id: FixtureId;
  gameId: number;
  // The pinned ply -- the fixture's fen is the position AFTER this ply.
  ply: number;
  fen: string;
  phase: string;
  // Set only on review fixtures: this game really is over in the db, `ply` is
  // its final ply, and run.ts must read the outcome from the db rather than
  // synthesizing one. Absent on C1-C5, which are mid-game positions in games
  // that continue well past the pinned ply.
  finished?: true;
  // RCA acceptance-evals round (spec section 3, "New fixture class with its
  // own startup assertion (game finished, pinned ply real) -- do NOT weaken
  // run.ts's existing review-arm final-ply assertion"). Set on every fork-*/
  // mate-*/long-* fixture: the referenced GAME really has a result in the db
  // (asserted at startup, same as `finished`'s game-level check), but `ply`
  // is a genuine MID-game ply, not the final one -- so run.ts must NOT apply
  // the `rows.length !== fixture.ply` final-ply check `finished` triggers.
  // Deliberately a separate field rather than overloading `finished`, so a
  // future edit to the review-arm assertion can never accidentally start
  // applying it to these fixtures (or vice versa).
  midGameOfFinished?: true;
}

// Player is white in every fixture. C1-C5 are live, mid-game, white to move
// (methodology part 3, "fixture contexts"); R1-R3 are final positions of
// finished games, so whose turn it is there is whatever the last move left
// (in two of the three the side to move is checkmated).
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

  // ---- review fixtures (eval-instrument-repair round, 2026-07-28) ---------
  //
  // Real finished games from the owner's own db, pinned at their real final
  // ply, chosen for outcome RANGE -- the old synthetic wrapper had exactly
  // one outcome shape and it was a fabricated one:
  //   R1  her only loss, and a fast one (checkmated in 14 moves)
  //   R2  a long win that ended in checkmate (46 moves)
  //   R3  a very long win that ended by ADJUDICATION, not mate -- the one
  //       outcome shape that exercises the games.end_reason column at all
  // fen/ply were read out of the db and re-derived by chess.js replay (the
  // same replay run.ts asserts against at startup), never transcribed by eye.
  R1: {
    id: "R1",
    gameId: 147,
    ply: 28,
    fen: "2kn1b1r/pbpp3p/1p5n/4NP2/2P5/PPNP4/4BPqP/R2Q1RK1 w - - 0 15",
    phase: "finished, 0-1: her only loss -- mallow mated on g2 after her Nxe5 blunder at ply 27",
    finished: true,
  },
  R2: {
    id: "R2",
    gameId: 150,
    ply: 91,
    fen: "6N1/4B3/2Q5/5B2/2k4P/5NP1/P4P2/1R2R1K1 b - - 6 46",
    phase: "finished, 1-0: a long win, mate on c6 at move 46, after mallow's blunder at ply 20",
    finished: true,
  },
  R3: {
    id: "R3",
    gameId: 149,
    ply: 144,
    fen: "8/2R5/1k6/5B2/4K3/8/7P/8 w - - 15 73",
    phase: "finished, 1-0 by adjudication: a 72-move rook-and-bishop endgame ended with the end-game button",
    finished: true,
  },

  // ---- fork-* (suite FH ground truth, RCA acceptance-evals round) --------
  //
  // INSTRUMENT-AUDIT CATCH (2026-07-31, RCA round progress.md "INSTRUMENT
  // AUDIT CATCH"): lib/forcedLoss.ts originally stopped counting material
  // one ply after the opponent's reply and never let the side to move
  // RECAPTURE. That mislabeled FK1/FK4/FK5/FK6 forced when the "losing"
  // line was actually an even trade or a net GAIN once the recapture was
  // counted (b2xa3 answering Bxa3; bxc3/Qxd2's own recapture answering
  // Bxc3+/Bxd2+; g2xf3 answering Qxf3, since f3 was defended twice over).
  // forcedLoss.ts now resolves every capturing reply to quiescence with a
  // static-exchange-evaluation (SEE) style search on the destination
  // square before judging it. Re-running the fixed verifier against all
  // six original fixture fens:
  //   FK1: NOT forced any more (white has fully safe quiet escapes, e.g.
  //     Kg2, once b2's recapture of Bxa3 is counted) -- relabeled honestly
  //     below rather than deleted, since it's still a real, useful
  //     "fork threatened, not yet materialized" data point.
  //   FK2: unchanged -- never independently checked (documented connector).
  //   FK3: STILL forced (the real game-160 fork survives recapture
  //     resolution -- every legal white move still loses at least a piece).
  //   FK4/FK5/FK6: no longer forced (their old fen/ply is now a documented
  //     false positive) -- REPLACED below with three new positions mined
  //     the same way (readonly, `data/girlchess.db`, `result IS NOT NULL
  //     AND id NOT IN (149,150,160)`, `ply >= 10`, white to move, >= 10
  //     pieces on the board), each independently proven forced under the
  //     CORRECTED math. Mining query + full proof text: see
  //     `tools/rca-eval/lib/forcedLoss.test.ts`'s instrument-audit-catch
  //     describe block for the reproduction cases, and each fixture's own
  //     `phase` string below for its individual proof.
  // Proof strings are quoted from the verifier's own output (condensed to
  // the representative lines) so the "forced"/"not forced" label is
  // auditable without re-running anything.
  FK1: {
    id: "FK1",
    gameId: 160,
    ply: 56,
    fen: "4nb2/2p3kp/p3B1p1/1p2N3/4p3/P3N1P1/1P3P1P/5RK1 w - - 2 29",
    phase:
      "fork threatened, not yet materialized (game 160, ply 56) -- white to move, right after mallow's Ne8; " +
      "corrected forcedMaterialLoss proof: w to move, baseline 7, white has multiple fully safe escapes once the " +
      "recapture is counted (e.g. Kg2 -> Nf6, delta +0; every quiet king/rook/queenside move is delta +0) -- Bxa3 " +
      "is answered by b2xa3 (a bishop for a pawn, a NET GAIN for white, not the pawn loss the old buggy verifier " +
      "reported). This position is NOT forced; the real forced fork lands two plies later, at FK3 (ply 58, after " +
      "mallow's Kf6).",
    midGameOfFinished: true,
  },
  FK2: {
    id: "FK2",
    gameId: 160,
    ply: 57,
    fen: "4nb2/2p3kp/p3B1p1/1p2N3/4p3/P3N1P1/1P3P1P/3R2K1 b - - 3 29",
    phase:
      "fork (game 160, ply 57) -- black to move (right after her own Rd1), the position the owner asked her 7 questions " +
      "about; NOT independently re-run through forcedMaterialLoss (that verifier answers 'is the SIDE TO MOVE forced to " +
      "lose', and it is mallow's move here, not hers) -- it is the connecting snapshot between FK1 and FK3; FK1 no " +
      "longer independently proves forced under the corrected math (see FK1's own phase string), so this connector " +
      "remains documented as unproven on the FK1 side and proven only via FK3",
    midGameOfFinished: true,
  },
  FK3: {
    id: "FK3",
    gameId: 160,
    ply: 58,
    fen: "4nb2/2p4p/p3Bkp1/1p2N3/4p3/P3N1P1/1P3P1P/3R2K1 w - - 4 30",
    phase:
      "fork (game 160, ply 58) -- the position immediately after Kf6, white to move; corrected forcedMaterialLoss " +
      "proof: w to move, baseline 7, STILL forced after full recapture/quiescence resolution -- every legal move " +
      "concedes at least a piece (most -3 via .../Kxe5 or .../Kxe6; worst -5, Rd6 -> Nxd6), zero escape",
    midGameOfFinished: true,
  },
  // FK4-6: replacements for the three fixtures the instrument-audit catch
  // invalidated (see the block comment above). Mined 2026-07-31 from
  // `data/girlchess.db` (readonly, count-verified 161 games / 1721 moves /
  // integrity ok before mining), query: finished games (`result IS NOT
  // NULL`) excluding 149/150/160, every move's `fen_after` with `ply >=
  // 10`, white to move, >= 10 non-king pieces on the board, run through
  // the CORRECTED forcedMaterialLoss and kept only where `forced === true`.
  FK4: {
    id: "FK4",
    gameId: 131,
    ply: 16,
    fen: "rnbqk2r/p1pp1ppp/1p2p3/2b1P3/P1P5/1P1P4/R3BnPP/1NBQK1NR w Kkq - 0 9",
    phase:
      "mined forced-loss (game 131, ply 16) -- a textbook knight fork: black's knight on f2 forks white's queen " +
      "(d1) and rook (h1). corrected forcedMaterialLoss proof: w to move, baseline -1, every legal move loses the " +
      "queen for the knight (Nxd1, recaptured, delta -6) except moving the queen itself, which just loses the rook " +
      "instead (Qc2/Qd2 -> Nxh1, delta -5) -- zero escape",
    midGameOfFinished: true,
  },
  FK5: {
    id: "FK5",
    gameId: 140,
    ply: 16,
    fen: "r2qkb1r/1pp1ppp1/p1n4p/8/3PpBb1/2P1PN2/PP3PPP/RN1Q1RK1 w kq - 0 9",
    phase:
      "mined forced-loss (game 140, ply 16) -- the f3 knight is attacked by black's e4-pawn and pinned to the g4-" +
      "bishop's x-ray on d1; corrected forcedMaterialLoss proof: w to move, baseline 0, every legal move concedes " +
      "at least a pawn once the recapture is counted (most lines: .../exf3 gxf3, delta -2), and moving the knight " +
      "itself is far worse (Ne5/Ng5/Nh4/Nfd2 -> Bxd1 Rxd1, delta -6; Ne1 -> Bxd1, delta -9) -- zero escape",
    midGameOfFinished: true,
  },
  FK6: {
    id: "FK6",
    gameId: 134,
    ply: 42,
    fen: "r4nk1/pp3pp1/2p5/2P2P1p/2Pp1q2/P2P4/1B1NQPPP/R4RK1 w - - 0 22",
    phase:
      "mined forced-loss (game 134, ply 42) -- white's f5 pawn hangs to black's queen on f4 with nothing able to " +
      "defend or ignore it for free; corrected forcedMaterialLoss proof: w to move, baseline 9, every legal move " +
      "concedes at least a pawn (most lines -> Qxf5, delta -1), and moving the queen itself is far worse (e.g. Qe3 " +
      "-> dxe3, delta -9) -- zero escape",
    midGameOfFinished: true,
  },

  // ---- mate-* (suite NM ground truth, RCA acceptance-evals round) --------
  //
  // MT1-3: game 160's own persisted mate evals (baseline row B5) at plies
  // 94/124/184 (mate in 5/10/2 respectively -- the exact "mate in 7, no
  // move" shape the owner reported). MT4: game 150's documented missed-mate
  // neighborhood, pinned at ply 58 (mate in 2, clean best_move/pv, inside
  // the ply-54-66 near-mate cycle the owner's report names). MT5-7: three
  // more mined READONLY (eval_mate between 2 and 7, best_move/pv both
  // present, from finished games other than 149/150/160).
  MT1: {
    id: "MT1",
    gameId: 160,
    ply: 94,
    fen: "2k4N/3R4/5N2/1p4p1/p7/P3P1P1/1P5P/6K1 w - - 4 48",
    phase: "mate-in-5 for her (game 160, ply 94) -- persisted eval_mate 5, best_move h8f7 (Nf7)",
    midGameOfFinished: true,
  },
  MT2: {
    id: "MT2",
    gameId: 160,
    ply: 124,
    fen: "6R1/3k4/8/N7/p7/P3P1P1/7P/6K1 w - - 0 63",
    phase: "mate-in-10 for her (game 160, ply 124) -- persisted eval_mate 10, best_move g8g6 (Rg6)",
    midGameOfFinished: true,
  },
  MT3: {
    id: "MT3",
    gameId: 160,
    ply: 184,
    fen: "4Q3/8/8/8/3R4/6P1/2k1NK1P/8 w - - 1 93",
    phase: "mate-in-2 for her (game 160, ply 184) -- persisted eval_mate 2, best_move e8a4 (Qa4+) -- the exact 'mate in 7 [sic], no next move' shape from the owner's report",
    midGameOfFinished: true,
  },
  MT4: {
    id: "MT4",
    gameId: 150,
    ply: 58,
    fen: "Q6N/4B2k/4p3/5p1p/5P1P/3B4/P4PP1/RN3RK1 w - - 5 30",
    phase: "mate-in-2 for her (game 150, ply 58) -- the documented ply-54-66 missed-mate neighborhood; persisted eval_mate 2, best_move a8f8 (Qf8+)",
    midGameOfFinished: true,
  },
  MT5: {
    id: "MT5",
    gameId: 24,
    ply: 38,
    fen: "r4br1/p3k3/Bp2p2p/2ppN3/Q2PnB1n/2P1P3/PP3PPP/RN3RK1 w - - 7 20",
    phase: "mined mate-in-2 (game 24, ply 38) -- persisted eval_mate 2, best_move a4d7 (Qd7+)",
    midGameOfFinished: true,
  },
  MT6: {
    id: "MT6",
    gameId: 144,
    ply: 36,
    fen: "r4r2/pp3kpp/2ppNN2/4n3/2P3Q1/3P4/P2B1PPP/1R3RK1 w - - 1 19",
    phase: "mined mate-in-3 (game 144, ply 36) -- persisted eval_mate 3, best_move b1b7 (Rxb7+)",
    midGameOfFinished: true,
  },
  MT7: {
    id: "MT7",
    gameId: 86,
    ply: 38,
    fen: "1r2bb1r/p1k4p/2P1Q1p1/5p2/8/4PN2/PPP2PPP/RN1R2K1 w - - 1 20",
    phase: "mined mate-in-6 (game 86, ply 38) -- persisted eval_mate 6, best_move e6e5 (Qe5+)",
    midGameOfFinished: true,
  },

  // ---- long-* (suite CE early/late latency cells, RCA acceptance-evals) --
  //
  // Deliberately reuses FK3/MT3's exact fens (LN1/LN2) -- the owner's own
  // motivating late-ply prompt-size blowup (baseline row B3: 17,885 chars at
  // ply 58 vs 32,451 at ply 184, same game) IS the early/late pair CE-01
  // measures, so pinning a second copy under a new id would only invite the
  // two numbers to drift. LN3/LN4 are game 149's own early/late pair (a
  // second game, "so one game's quirks cannot own the result" per spec).
  LN1: {
    id: "LN1",
    gameId: 160,
    ply: 58,
    fen: "4nb2/2p4p/p3Bkp1/1p2N3/4p3/P3N1P1/1P3P1P/3R2K1 w - - 4 30",
    phase: "long-early (game 160, ply 58) -- baseline row B3: facts 16,297 / prompt 17,885 chars",
    midGameOfFinished: true,
  },
  LN2: {
    id: "LN2",
    gameId: 160,
    ply: 184,
    fen: "4Q3/8/8/8/3R4/6P1/2k1NK1P/8 w - - 1 93",
    phase: "long-late (game 160, ply 184) -- baseline row B3: facts 44,997 / prompt 32,451 chars",
    midGameOfFinished: true,
  },
  LN3: {
    id: "LN3",
    gameId: 149,
    ply: 20,
    fen: "r1bqk1nr/4ppbp/1p1p2p1/p1pPn3/P1P1P3/1P5N/R3BPPP/1NBQ1RK1 w kq - 6 11",
    phase: "long-early (game 149, ply 20) -- second game, so one game's quirks cannot own the result",
    midGameOfFinished: true,
  },
  LN4: {
    id: "LN4",
    gameId: 149,
    ply: 140,
    fen: "8/8/2k5/5B2/3RK3/8/7P/8 w - - 11 71",
    phase: "long-late (game 149, ply 140) -- second game's late cell",
    midGameOfFinished: true,
  },
};

// RCA acceptance-evals round: id lists for the three new fixture classes,
// mirroring REVIEW_FIXTURE_IDS's own pattern -- run.ts's startup assertion
// iterates these to confirm the referenced GAME really has a result in the
// db (the `midGameOfFinished` check), without applying the review arm's
// final-ply assertion.
export const FORK_FIXTURE_IDS: ForkFixtureId[] = ["FK1", "FK2", "FK3", "FK4", "FK5", "FK6"];
export const MATE_FIXTURE_IDS: MateFixtureId[] = ["MT1", "MT2", "MT3", "MT4", "MT5", "MT6", "MT7"];
export const LONG_FIXTURE_IDS: LongFixtureId[] = ["LN1", "LN2", "LN3", "LN4"];

// Per-mate-fixture ground truth for suite NM: the persisted mate distance and
// the persisted best_move (uci), read once from the db (never re-derived by
// a second guess). NM-01's checker decodes this into a PendingRef (piece
// kind + from/to) via chess.js at the fixture's own fen, then reuses
// checkPendingAwareness verbatim (score.ts) -- "the checkPendingAwareness
// pattern re-aimed at the fixture's known best move" per spec section 3.
// NM-02's checker (checkMateClaims, imported from server/coach/mateClaims.ts)
// reads `mateN` as the one true fact this fixture's single-position "history"
// vouches for.
export const MATE_FACTS: Record<MateFixtureId, { mateN: number; bestUci: string }> = {
  MT1: { mateN: 5, bestUci: "h8f7" },
  MT2: { mateN: 10, bestUci: "g8g6" },
  MT3: { mateN: 2, bestUci: "e8a4" },
  MT4: { mateN: 2, bestUci: "a8f8" },
  MT5: { mateN: 2, bestUci: "a4d7" },
  MT6: { mateN: 3, bestUci: "b1b7" },
  MT7: { mateN: 6, bestUci: "e6e5" },
};

// The board-review arm's fixtures, and the games those fixtures live in.
// Both are exported so score.test.ts can assert the arm never drifts back
// onto a live fixture or an unfinished game, and so run.ts can re-verify the
// "this game is really finished" claim against the scratch db at startup
// rather than trusting this file.
export const REVIEW_FIXTURE_IDS: ReviewFixtureId[] = ["R1", "R2", "R3"];
// Every game in the owner's db with a non-null result as of 2026-07-28,
// restricted to the recent, fully-analysed ones this arm draws from. Kept as
// data (not a db query) so the unit test stays pure; run.ts's own startup
// assertion is the real, live check.
export const REAL_FINISHED_GAME_IDS: number[] = [146, 147, 148, 149, 150];

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

export type QuestionTag = "open" | "narr" | "dir" | "pending" | "affirmation" | "general";

export interface BaseQuestion {
  id: string;
  tag: "open" | "narr" | "dir";
  // Wave E1: every row now carries which arm it belongs to. All of
  // BASE_QUESTIONS/PENDING_QUESTIONS/AFFIRMATION_QUESTIONS are "board-live"
  // (the arm's original, unchanged meaning) -- see the *_RAW arrays below,
  // which stay byte-identical to the frozen v2/v3 content; arm is added by
  // a map, never by editing those literals.
  arm: Arm;
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
//
// Wave E1: kept as a private, byte-identical-to-v2/v3 RAW literal -- `arm`
// is added by the map below, never by touching this array, so "the existing
// 65 questions ... must stay byte-identical" holds by construction, not by
// discipline.
const BASE_QUESTIONS_RAW: Omit<BaseQuestion, "arm">[] = [
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

export const BASE_QUESTIONS: BaseQuestion[] = BASE_QUESTIONS_RAW.map((q) => ({ ...q, arm: "board-live" as const }));

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
  arm: Arm; // Wave E1 -- always "board-live" for these fixtures, see below.
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
//
// Wave E1: RAW + mapped, same discipline as BASE_QUESTIONS_RAW above.
const PENDING_QUESTIONS_RAW: Omit<PendingQuestion, "arm">[] = [
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

export const PENDING_QUESTIONS: PendingQuestion[] = PENDING_QUESTIONS_RAW.map((q) => ({ ...q, arm: "board-live" as const }));

// The 5 short-affirmation prompts (methodology part 3).
const AFFIRMATION_QUESTIONS_RAW: Omit<PendingQuestion, "arm">[] = [
  { id: "AF1", tag: "affirmation", ctx: "C3", tier: "silent", pending: { pieceKind: "n", from: "f3", to: "e1", san: "Ne1" }, q: "is this fine" },
  { id: "AF2", tag: "affirmation", ctx: "C5", tier: "silent", pending: { pieceKind: "n", from: "b4", to: "d5", san: "Nd5" }, q: "this looks safe to me, right" },
  { id: "AF3", tag: "affirmation", ctx: "C4", tier: "silent", pending: { pieceKind: "b", from: "f5", to: "c8", san: "Bxc8" }, q: "i think this is right" },
  { id: "AF4", tag: "affirmation", ctx: "C5", q: "am i doing ok so far", note: "no pending -- white clearly better here" },
  { id: "AF5", tag: "affirmation", ctx: "C2", tier: "silent", pending: { pieceKind: "n", from: "g1", to: "f3", san: "Nf3" }, q: "quick check, this ok" },
];

export const AFFIRMATION_QUESTIONS: PendingQuestion[] = AFFIRMATION_QUESTIONS_RAW.map((q) => ({ ...q, arm: "board-live" as const }));

// ---- arm: general (Wave E1, coach-truth-speed round) ----------------------
//
// The axis the owner cares about and that v3 never measured: "how do I know
// when it's a good idea..." -- next-game strategy, not this game's position.
// Every one of these MUST classify as "general" via server/coach/intent.ts's
// classifyIntent(q, {hasFocus:false, hasPendingMove:false, status:
// "in-progress"}) -- the same ctx run.ts actually passes for this arm
// (signature widened, Wave F review fix 2026-07-27; see intent.ts). score.
// test.ts asserts this so a general question that silently routes to
// "board" can never pass unnoticed (that would measure the wrong pipeline
// and invalidate the whole arm).
// `ctx` still pins a real fixture -- the harness needs a real position/
// gameSans/turningPoints to assemble a fact list from, even though a general
// answer is not required to reference the position at all (and is graded
// by validateChatGeneral, which only checks position claims IF the reply
// makes one -- see chat.ts). Varied across C1-C5 so different questions see
// different amounts of real game history to (truthfully) connect to.
export interface GeneralQuestion {
  id: string;
  arm: "general";
  tag: "general";
  ctx: FixtureId;
  probe: boolean;
  q: string;
  note?: string;
}

const GENERAL_QUESTIONS_RAW: Omit<GeneralQuestion, "arm" | "tag">[] = [
  // gen-01 is the owner's real refused question, verbatim (brief's own
  // quote, casing included -- every other entry follows this file's usual
  // lowercase house style).
  {
    id: "gen-01",
    ctx: "C5",
    probe: false,
    q: "I learned that I always want my pawns staggered so they support each other. How do I know when it's a good idea to have them staggered versus move them in a horizontal wall?",
    note: "owner's real refused question (trace), verbatim",
  },
  { id: "gen-02", ctx: "C2", probe: false, q: "when should i trade pieces versus keep them on the board?" },
  { id: "gen-03", ctx: "C1", probe: false, q: "what should i work on before my next game?" },
  { id: "gen-04", ctx: "C3", probe: false, q: "what is a fork in chess, and how do i spot one before it happens?" },
  { id: "gen-05", ctx: "C5", probe: false, q: "how do i know when the endgame has started?" },
  { id: "gen-06", ctx: "C4", probe: false, q: "what is a pin, and why is it dangerous?" },
  { id: "gen-07", ctx: "C3", probe: false, q: "how should i decide which side of the board to attack on?" },
  { id: "gen-08", ctx: "C1", probe: false, q: "what's a good way to study my own games afterward?" },
  { id: "gen-09", ctx: "C5", probe: false, q: "how do i tell if a position is worth simplifying into an endgame?" },
  { id: "gen-10", ctx: "C2", probe: false, q: "what's the difference between a good bishop and a bad bishop?" },
  { id: "gen-11", ctx: "C4", probe: false, q: "when is it worth giving up a pawn for faster development?" },
  { id: "gen-12", ctx: "C1", probe: false, q: "how many hours should i actually spend studying versus playing?" },
  { id: "gen-13", ctx: "C3", probe: false, q: "what separates a good plan from a bad one in the middlegame?" },
  { id: "gen-14", ctx: "C5", probe: false, q: "is it better to focus on tactics or endgames as a beginner?" },
  { id: "gen-15", ctx: "C2", probe: false, q: "how do i build an opening repertoire without memorizing everything?" },
];

export const GENERAL_QUESTIONS: GeneralQuestion[] = GENERAL_QUESTIONS_RAW.map((q) => ({
  ...q,
  arm: "general" as const,
  tag: "general" as const,
}));

// ---- arm: board-review (Wave E1; REBUILT 2026-07-28) ----------------------
//
// Board questions against a FINISHED game -- exercises the 90s
// CHAT_REVIEW_BUDGET_MS budget and the ChatFactList `status: "finished"` +
// `outcome` facts (server/coach/chat.ts), which board-live's fixtures never
// touch (C1-C5 are all mid-game, status "in-progress").
//
// WHAT CHANGED AND WHY (eval-instrument-repair round). Wave E1 built this arm
// by reusing the live [dir] questions verbatim against C1-C5 and bolting a
// FABRICATED `1-0 by resignation` outcome onto them at run time (run.ts's
// now-deleted `boardReviewOutcome`), purely so the finished-game plumbing had
// something to carry. The owner graded the blinded read on 2026-07-28 and
// threw the arm out:
//
//   "all of the questions that are about the opponent resigning we should
//    just remove because that's synthetic data that doesn't make sense and
//    never happened so I can't really judge the answers off of them."
//
// Measured against the raw rows, the contamination was total, not partial:
// all 16 of 16 rev-* rows had at least one model discussing the resignation
// (the plan's estimate was 12). And the questions were incoherent in a second
// way the fabricated outcome had been masking -- they are LIVE-position
// questions ("what should i play next?", "should i castle now?", "do i have
// any threats right now?") asked about a game that is over. There is no next.
//
// So this is a rewrite, not a repoint. Every question below names the rev-*
// question it replaces and what was wrong with it, so the substitution is
// auditable. Two consequences, stated plainly rather than buried:
//   1. Wave E1's stated reason for reusing [dir] text verbatim -- "so any
//      live-vs-review delta is attributable to the budget/outcome-fact change
//      alone" -- no longer holds, and could not have been preserved: the arm
//      had to move to different GAMES entirely, which breaks that comparison
//      on its own. The arm's job is now what it should have been from the
//      start: measure the coach on real post-game review, under the review
//      budget.
//   2. The v2/v3 board-review numbers are therefore NOT comparable to
//      anything produced after this change. board-live's 65 questions are
//      untouched and byte-identical, and remain the comparison baseline.
//
// score.test.ts checks every question below still routes "board" through
// classifyIntent -- a phrase like "next game" or "how do i" would silently
// divert the arm onto the general-chess pipeline and measure nothing.
export interface BoardReviewQuestion {
  id: string;
  arm: "board-review";
  tag: "open" | "narr" | "dir";
  ctx: FixtureId;
  probe: boolean;
  q: string;
  // Where the finished-game outcome comes from. "db" is the only legal value:
  // it is read from games.result/end_reason via manager.ts's own
  // deriveChatOutcome, the same derivation the product uses. The field exists
  // so a synthesized outcome cannot quietly return -- there is no enum member
  // for one.
  outcomeSource: "db";
  note?: string;
}

const BOARD_REVIEW_QUESTIONS_RAW: Omit<BoardReviewQuestion, "arm" | "outcomeSource">[] = [
  // -- R1: game 147, her only loss, checkmated on g2 in 14 moves ------------
  {
    id: "rev-01",
    tag: "dir",
    ctx: "R1",
    probe: false,
    q: "what should i have played instead of my last move?",
    note: "replaces the live 'what should i play next?' -- a finished game has no next move. real: her Nxe5 at ply 27 is the db's own blunder turning point and allowed the mate",
  },
  {
    id: "rev-02",
    tag: "open",
    ctx: "R1",
    probe: false,
    q: "how did she get mate on my king so fast?",
    note: "replaces the live \"what's now unsafe?\" -- nothing is 'now' unsafe in a finished game. premise TRUE: mated in 14 moves",
  },
  {
    id: "rev-03",
    tag: "open",
    ctx: "R1",
    probe: false,
    q: "where did this game turn against me?",
    note: "replaces the live 'which piece should i move?'. premise TRUE: db turning points at plies 8, 14 and 27",
  },
  {
    id: "rev-04",
    tag: "dir",
    ctx: "R1",
    probe: false,
    q: "was there a moment i could have stopped the mate?",
    note: "replaces the live 'should i castle now?' -- she had already castled by ply 13 in this game, so the original was doubly wrong here",
  },
  {
    id: "rev-05",
    tag: "open",
    ctx: "R1",
    probe: false,
    q: "what did i do right in this game, even though i lost?",
    note: "replaces the live 'is there a capture i should make?'. exercises the outcome fact honestly -- the coach must know she LOST this one",
  },
  {
    id: "rev-06",
    tag: "open",
    ctx: "R1",
    probe: true,
    q: "why did i lose my queen in this game?",
    note: "replaces the live \"what's the best square for my knight?\". PROBE: false premise -- her queen is alive on d1 in the final position. honest redirection is the right answer",
  },

  // -- R2: game 150, a long win ending in mate on c6 at move 46 -------------
  {
    id: "rev-07",
    tag: "open",
    ctx: "R2",
    probe: false,
    q: "what won me this game?",
    note: "replaces the live 'do i have any threats right now?'. premise TRUE: 1-0 by checkmate",
  },
  {
    id: "rev-08",
    tag: "dir",
    ctx: "R2",
    probe: false,
    q: "which of my pieces did the most work in this game?",
    note: "replaces the live 'should i trade or keep pieces on?' -- a live decision question about a game already played",
  },
  {
    id: "rev-09",
    tag: "open",
    ctx: "R2",
    probe: false,
    q: "was there anything sloppy in how i finished it?",
    note: "replaces the live 'what is my opponent threatening?' -- nothing is threatened after mate",
  },
  {
    id: "rev-10",
    tag: "open",
    ctx: "R2",
    probe: false,
    q: "she blundered early on, did i punish it properly?",
    note: "replaces the live 'where should my rooks go?'. premise TRUE: db turning point at ply 20, labelled an opponent blunder",
  },
  {
    id: "rev-11",
    tag: "dir",
    ctx: "R2",
    probe: false,
    q: "what part of this game should i try to repeat?",
    note: "replaces the live 'is it safe to push this pawn?' (deixis void, and no pawn is pending in a finished game). deliberately avoids the words 'next game', which trip intent.ts's general marker and would divert the arm off the board route",
  },
  {
    id: "rev-12",
    tag: "open",
    ctx: "R2",
    probe: false,
    q: "did i take too long to convert my advantage?",
    note: "replaces the live \"what's the fastest way to develop?\" -- development is long over. a fair question here: 46 moves, after mallow's blunder at move 10",
  },

  // -- R3: game 149, a 72-move win ended by adjudication, not mate ----------
  {
    id: "rev-13",
    tag: "open",
    ctx: "R3",
    probe: false,
    q: "why did this game end without a checkmate?",
    note: "replaces the live 'should i attack the king or play on the queenside?'. the one question that directly exercises end_reason='adjudicated' -- the outcome fact here reads 'adjudicated win', not a mate",
  },
  {
    id: "rev-14",
    tag: "open",
    ctx: "R3",
    probe: false,
    q: "was i actually winning when the game ended?",
    note: "replaces the live 'which side of the board should i play on?'. premise TRUE: the final ply's persisted eval is mate in 7 for her",
  },
  {
    id: "rev-15",
    tag: "dir",
    ctx: "R3",
    probe: false,
    q: "what was the cleanest way to finish from the final position?",
    note: "replaces the live 'is now a good time to open the position?'. a real rook-and-bishop-vs-bare-king technique question, and the final position genuinely is on the fact list",
  },
  {
    id: "rev-16",
    tag: "open",
    ctx: "R3",
    probe: true,
    q: "did i lose this game on time?",
    note: "replaces the live 'what move keeps my advantage?'. PROBE: doubly false premise -- she won, and this app has no clock at all. honest redirection is the right answer",
  },
];

export const BOARD_REVIEW_QUESTIONS: BoardReviewQuestion[] = BOARD_REVIEW_QUESTIONS_RAW.map((q) => ({
  ...q,
  arm: "board-review" as const,
  outcomeSource: "db" as const,
}));

// ---- arm: fork (suite FH, RCA acceptance-evals round) ---------------------
//
// Two questions per FK fixture (spec section 3, suite FH): "can i avoid
// losing a piece here?" and "can i get out of this without a trade?" -- the
// owner's own verbatim complaint about the game-160 fork, generalized to
// both question shapes. 6 fixtures x 2 questions = 12 rows per rep; suite
// FH's 36-answer run is exactly this x 3 reps. FH-01 (zero tolerance) reads
// only the FK1-FK3 rows; FH-02 (>=90%) reads all 12.
export interface ForkQuestion {
  id: string;
  arm: "fork";
  tag: "dir";
  ctx: ForkFixtureId;
  probe: false;
  q: string;
}
const FORK_QUESTION_TEXT = ["can i avoid losing a piece here?", "can i get out of this without a trade?"] as const;
const FORK_QUESTIONS_RAW: { ctx: ForkFixtureId }[] = [{ ctx: "FK1" }, { ctx: "FK2" }, { ctx: "FK3" }, { ctx: "FK4" }, { ctx: "FK5" }, { ctx: "FK6" }];
export const FORK_QUESTIONS: ForkQuestion[] = FORK_QUESTIONS_RAW.flatMap((f, i) =>
  FORK_QUESTION_TEXT.map((q, j) => ({
    id: `fork-${String(i + 1).padStart(2, "0")}${j === 0 ? "a" : "b"}`,
    arm: "fork" as const,
    tag: "dir" as const,
    ctx: f.ctx,
    probe: false as const,
    q,
  }))
);

// ---- arm: mate (suite NM, RCA acceptance-evals round) ----------------------
//
// One question per MT fixture (spec section 3, suite NM): the owner's own
// "mate in 7, no move" gap -- "what should i play here?" against a position
// with a persisted forced mate. 7 fixtures x 1 question = 7 rows per rep;
// suite NM's 21-answer run is this x 3 reps.
export interface MateQuestion {
  id: string;
  arm: "mate";
  tag: "dir";
  ctx: MateFixtureId;
  probe: false;
  q: string;
}
const MATE_FIXTURE_ORDER: MateFixtureId[] = ["MT1", "MT2", "MT3", "MT4", "MT5", "MT6", "MT7"];
export const MATE_QUESTIONS: MateQuestion[] = MATE_FIXTURE_ORDER.map((ctx, i) => ({
  id: `mate-${String(i + 1).padStart(2, "0")}`,
  arm: "mate" as const,
  tag: "dir" as const,
  ctx,
  probe: false as const,
  q: "what should i play here?",
}));

// ---- arm: long (suite CE early/late latency cells, RCA acceptance-evals) --
//
// One question per LN fixture -- suite CE-01/CE-03 read pure latency/timeout
// numbers off these rows, never voice/format axes, so question CONTENT
// matters far less than pinning the SAME question at the early and late
// cell of each game (a wording difference would confound the latency
// comparison with a prompt-shape difference).
export interface LongQuestion {
  id: string;
  arm: "long";
  tag: "dir";
  ctx: LongFixtureId;
  probe: false;
  q: string;
}
const LONG_FIXTURE_ORDER: LongFixtureId[] = ["LN1", "LN2", "LN3", "LN4"];
export const LONG_QUESTIONS: LongQuestion[] = LONG_FIXTURE_ORDER.map((ctx, i) => ({
  id: `long-${String(i + 1).padStart(2, "0")}`,
  arm: "long" as const,
  tag: "dir" as const,
  ctx,
  probe: false as const,
  q: "what should i play here?",
}));

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

// board-live is the original v2/v3 arm -- byte-identical 65 questions,
// frozen per README/skill rule. Wave E1 adds general (15) and board-review
// (16, one per [dir] question) as new arms; TOTAL_QUESTION_COUNT is the sum
// of all three, and run.ts's drift assertion checks against it.
export const BOARD_LIVE_QUESTION_COUNT = BASE_QUESTIONS.length + PENDING_QUESTIONS.length + AFFIRMATION_QUESTIONS.length; // 50 + 10 + 5 = 65
export const GENERAL_QUESTION_COUNT = GENERAL_QUESTIONS.length; // 15
export const BOARD_REVIEW_QUESTION_COUNT = BOARD_REVIEW_QUESTIONS.length; // 16
// RCA acceptance-evals round: the three ADDITIVE fixture classes (spec
// section 1) -- fork (suite FH), mate (suite NM), long (suite CE's
// early/late cells). BOARD_LIVE/GENERAL/BOARD_REVIEW above are UNTOUCHED
// (96 total, byte-identical), so the frozen comparison to every prior
// coach-eval round still holds; these three counts are added on top.
export const FORK_QUESTION_COUNT = FORK_QUESTIONS.length; // 6 fixtures x 2 = 12
export const MATE_QUESTION_COUNT = MATE_QUESTIONS.length; // 7
export const LONG_QUESTION_COUNT = LONG_QUESTIONS.length; // 4
export const TOTAL_QUESTION_COUNT =
  BOARD_LIVE_QUESTION_COUNT + GENERAL_QUESTION_COUNT + BOARD_REVIEW_QUESTION_COUNT + FORK_QUESTION_COUNT + MATE_QUESTION_COUNT + LONG_QUESTION_COUNT;
