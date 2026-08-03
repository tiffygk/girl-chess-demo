import { describe, it, expect } from "vitest";
import { computeHint } from "../annotator/hint";
import { assembleChatFactList } from "./chat";
import { checkMateClaims } from "./mateClaims";
import { StockfishEvaluator } from "../engines/stockfish";

// W1 acceptance (round 3, fact-shelf coach): the plan's own headline success
// criteria, replayed end to end through the REAL chain: computeHint ->
// assembleChatFactList's fen-matched fold -> checkMateClaims -- the shelf a
// live chat call would actually receive.
//
// FINDING recorded here, not silently worked around (per the brief's
// falsifiable-prediction discipline): the plan's trace-190 fen
// ("1rbr2k1/p1p3pp/1pB2P2/7n/3P3B/2P1PN1P/P2K1P2/R2Q3R w - - 0 1", copied
// from the investigation with its move counters reset) is the real position
// from advice_traces id 190 (game 167, ply 36; her feedback verbatim: "the
// hint said that there's a forced mate ... if I move my knight to G5 ... I
// know that it has [one]"). Investigated directly against real Stockfish
// before writing this test: at computeHint's PRODUCTION search depth
// (HINT_MOVETIME_MS 1500ms multipv), Ng5 (f3g5) IS the top-ranked candidate
// by cp -- but no forced mate is confirmed (evalMate stays null) at
// anywhere from 1.5s to 8s of search. Forcing the search to ~20s DOES turn
// up mate:-10, but at that same depth the top-ranked CANDIDATE itself
// changes to a different move (Ne5) -- Stockfish's own best-move ranking on
// this real position is genuinely depth-unstable, so no fixed assertion
// about "the" best move at 20s is reproducible enough for a committed test.
// This is a real, separate gap from what Wave 1's tasks touch:
// HINT_MOVETIME_MS is an explicitly owner-calibratable constant (hint.ts's
// own header comment), not something this wave's tasks asked to change --
// flagged for the controller (relevant to OD-3's thinking-bound decision
// and any future hint-depth retune) rather than papered over with a
// flaky, slow, depth-sensitive test. The acceptance criterion below is
// proven instead against a simple, deterministic forced mate (Qxf7#, mate
// in 1, confirmed instantly and stably at any search depth, on a real
// replayable game) -- the WIRING under test (Tasks 1-5) does not care
// whether the mate is 1 ply or 10.
describe("W1 acceptance: the fact shelf", () => {
  it("ACCEPTANCE: the coach can now CITE a shelf-grounded forced mate end to end", async () => {
    // A real, replayable game (scholar's-mate shape: 1.e4 e5 2.Bc4 Nc6
    // 3.Qh5 Nf6??) landing on a position with a genuine, INSTANT, and
    // depth-stable forced mate (Qxf7#) -- chosen over the real trace-190
    // fen precisely because that fen turned out to be depth-unstable (see
    // the FINDING above); gameSans replay to this exact fen (verified via
    // chess.js), so the shelf's fen-match fold (Task 3) fires for real, not
    // just via a trivial start-position coincidence.
    const gameSans = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"];
    const gameMoves = gameSans.map((san, i) => ({ ply: i + 1, san }));
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

    const evaluator = new StockfishEvaluator();
    await evaluator.init();
    const hint = await computeHint(fen, evaluator);
    await evaluator.quit();

    expect(hint).not.toBeNull();
    expect(hint!.bestSan).toBe("Qxf7#"); // Task 1: the chosen move
    expect(hint!.evalMate).toBe(1); // Task 1: the score that made it a hint

    // Fold onto the fact list -- gameSans replays to exactly this fen, so
    // the shelf matches the live position for real (Task 3).
    const facts = assembleChatFactList(
      gameMoves,
      { mode: "live" },
      undefined, undefined, undefined, undefined,
      { fen, facts: hint! }
    );
    expect(facts.currentFen).toBe(fen); // fixture sanity: the replay really lands here
    expect(facts.hintFindings).toBeDefined();
    expect(facts.hintFindings!.bestSan).toBe("Qxf7#");
    expect(facts.hintFindings!.evalMate).toBe(1);

    // The mate claim now validates clean instead of being denied (Task 4).
    const violations = checkMateClaims(
      `there's a forced mate in 1 starting with ${facts.hintFindings!.bestSan}`,
      [], [],
      facts.hintFindings!.evalMate
    );
    expect(violations).toHaveLength(0);
    // Sanity: the SAME claim with no shelf grounding at all still reads as invented.
    const ungrounded = checkMateClaims(`there's a forced mate in 1 starting with ${hint!.bestSan}`, [], [], null);
    expect(ungrounded.length).toBeGreaterThan(0);
  }, 30000);

  it("the shelf fold is fen-keyed: a hint for a position NOT in play is honestly dropped, never shown as if it still applied", async () => {
    // trace-190's real fen (see the FINDING above) -- used here purely as a
    // stale/mismatched shelf entry, not for its mate content.
    const staleFen = "1rbr2k1/p1p3pp/1pB2P2/7n/3P3B/2P1PN1P/P2K1P2/R2Q3R w - - 1 19";
    const evaluator = new StockfishEvaluator();
    await evaluator.init();
    const hint = await computeHint(staleFen, evaluator);
    await evaluator.quit();
    expect(hint).not.toBeNull();

    // An empty gameSans replay's currentFen is the standard start position,
    // which does not match the stale fen -- Task 3's fen-match discipline
    // must drop the shelf entry rather than fold in a hint that no longer
    // applies.
    const facts = assembleChatFactList(
      [],
      { mode: "live" },
      undefined, undefined, undefined, undefined,
      { fen: staleFen, facts: hint! }
    );
    expect(facts.currentFen).not.toBe(staleFen);
    expect(facts.hintFindings).toBeUndefined();
  }, 30000);

  it("ACCEPTANCE trace-185: a why-question has an engine line to ground on", async () => {
    // advice_traces id 185 (game 167, ply 20): her feedback -- "can't
    // understand the basic strategy for why the move was recommended" --
    // about Kd2, several plies earlier. gameSans replayed verbatim from the
    // trace's own persisted fact list lands on this exact currentFen
    // (verified independently via chess.js before writing this fixture).
    const gameSans = [
      "c4", "e6", "d4", "Qh4", "Nf3", "Qf6", "Bg5", "Qg6", "e3", "Bb4+",
      "Nc3", "Nf6", "Bd3", "Bxc3+", "bxc3", "Qh5", "h3", "Nc6", "Kd2", "O-O",
    ];
    const gameMoves = gameSans.map((san, i) => ({ ply: i + 1, san }));
    const currentFen = "r1b2rk1/pppp1ppp/2n1pn2/6Bq/2PP4/2PBPN1P/P2K1PP1/R2Q3R w - - 3 11";

    const evaluator = new StockfishEvaluator();
    await evaluator.init();
    const hint = await computeHint(currentFen, evaluator);
    await evaluator.quit();
    expect(hint).not.toBeNull();

    const facts = assembleChatFactList(
      gameMoves,
      { mode: "live" },
      undefined, undefined, undefined, undefined,
      { fen: currentFen, facts: hint! }
    );
    expect(facts.currentFen).toBe(currentFen); // fixture sanity: the replay really lands here
    expect(facts.hintFindings).toBeDefined();
    expect(facts.hintFindings!.pvSans.length).toBeGreaterThan(0);
  }, 30000);
});
