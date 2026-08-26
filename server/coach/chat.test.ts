import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Chess } from "chess.js";
import {
  openDb, createSession, createGame, recordMove, finishGame,
  getAdviceTraces, getAllChatMessages, insertChatMessage,
} from "../store/db";
import {
  assembleChatFactList, validateChat, validateChatGeneral, chat, CHAT_HISTORY_WINDOW, CHAT_MAX_LEN,
  correctiveSuffix, gapWord, asksForNumber, buildChatPromptParts,
} from "./chat";
import type { ChatFactList } from "./chat";
import { GameManager } from "../game/manager";
import { getPersona } from "./index";
import type { CoachBackend } from "./backends/types";

// Sanctioned exception to the no-mocks convention (per the brief, and per
// server/coach/index.test.ts's own precedent): the real claude CLI cannot
// run in CI, and must never be invoked from a test — every test below uses
// a fake implementing CoachBackend inline, never backends/claude-cli.ts or
// backends/ollama.ts.
function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>, name = "fake"): CoachBackend {
  return {
    name,
    async available() {
      return true;
    },
    generate,
  };
}

// Seeds a game's moves table directly (bypassing gm.newGame/playerMove, and
// therefore the live maia/stockfish engines entirely) — chat() never reads
// fenAfter/uci from the moves table (assembleChatFactList replays gameSans
// itself via chess.js), so placeholder values are fine here, same pattern
// manager.test.ts's own "heals a stale turning_points row set" test uses.
function seedGame(sansPlayed: string[]): number {
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1100");
  sansPlayed.forEach((san, i) => {
    recordMove({ gameId, ply: i + 1, san, uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
  });
  return gameId;
}

// GROUNDING FIXTURE (panel A9): a real game containing BOTH castling and a
// promotion, built move-by-move against a live chess.js instance (rather
// than hand-typed SAN strings, which risk disambiguation/notation mismatch)
// and read back via .history(). Verified directly against an independent
// replay in test (a) below.
function buildFixtureGame(): string[] {
  const chess = new Chess();
  const plies: [string, string, string?][] = [
    ["e2", "e4"], ["g8", "f6"],
    ["g1", "f3"], ["f6", "g8"],
    ["f1", "c4"], ["g8", "f6"],
    ["e1", "g1"], ["f6", "g8"], // white castles kingside
    ["g2", "g4"], ["g8", "f6"],
    ["g4", "g5"], ["f6", "g8"],
    ["g5", "g6"], ["g8", "f6"],
    ["g6", "h7"], ["f6", "g8"], // white pawn captures onto h7
    ["h7", "g8", "q"], // promotion, capturing the knight back on g8
  ];
  for (const [from, to, promotion] of plies) {
    chess.move(promotion ? { from, to, promotion } : { from, to });
  }
  return chess.history();
}

describe("coach/chat.ts (F16, this-game grounding)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  // (a)
  describe("assembleChatFactList / validateChat — grounding fixture (panel A9)", () => {
    it("derives currentFen/occupancy/legalSans by an independent chess.js replay (castling + promotion included), and a reply naming the post-castle rook's square passes", () => {
      const sans = buildFixtureGame();
      const gameMoves = sans.map((san, i) => ({ ply: i + 1, san }));

      const facts = assembleChatFactList(gameMoves, { mode: "review" });

      // Independent replay — never shares code with assembleChatFactList's
      // own chess.js call, so this is a genuine cross-check, not a tautology.
      const independent = new Chess();
      for (const san of sans) independent.move(san);

      expect(facts.currentFen).toBe(independent.fen());
      expect(facts.legalSans.slice().sort()).toEqual(independent.moves().slice().sort());

      const expectedOccupancy = independent
        .board()
        .flat()
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ square: c.square, pieceKind: c.type, color: (c.color === "w" ? "you" : "mallow") as "you" | "mallow" }))
        .sort((x, y) => x.square.localeCompare(y.square));
      expect(facts.occupancy.slice().sort((x, y) => x.square.localeCompare(y.square))).toEqual(expectedOccupancy);

      // The rook that castled to f1 is still there post-castle.
      expect(facts.occupancy).toContainEqual({ square: "f1", pieceKind: "r", color: "you" });

      // "f1" is a bare square — geography, always allowed regardless of
      // allowedSans (declared cut #2; see validateChat's comment).
      const reply = "nice, your rook on f1 is tucked in safely now.";
      expect(validateChat(reply, facts)).toEqual({ ok: true });
    });
  });

  // Task 7 (increment 3.95, "ask about this" chat): the focused turning
  // point's best line fold. Before this fold, a turning point's own
  // san/punishSan were allowed (folded above from the turningPoints list)
  // but its BEST line was not -- so a reply naming the better move would
  // wrongly redirect even though the card the player asked about displays
  // that exact line. ctx.turningPointFocus is the one piece that changes
  // this; everything else about validateChat (geography-free squares,
  // strict SAN) stays exactly as (d)/lowercase-normalization above exercise.
  describe("assembleChatFactList — turningPointFocus folds bestSan/pvSans into allowedSans (Task 7)", () => {
    it("a reply naming the focused best line passes validation instead of redirecting", () => {
      const facts = assembleChatFactList(
        [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }, { ply: 3, san: "Bc4" }],
        {
          mode: "review",
          turningPointFocus: {
            ply: 3,
            san: "Bc4",
            label: "inaccuracy",
            bestSan: "Nf3",
            pvSans: ["Nf3", "Nc6", "Bb5"],
          },
        }
      );
      expect(facts.allowedSans).toContain("Nf3");
      expect(facts.allowedSans).toContain("Nc6");
      expect(facts.allowedSans).toContain("Bb5");

      // Task 3a (R2, voice-enforcement round): raw notation is now ALWAYS a
      // voice violation regardless of legality, so this reply's overall
      // verdict is (correctly) false -- but the fold itself is proven by
      // the absence of the bare "nf3" illegal-SAN violation that would fire
      // if the fold hadn't run.
      const reply = "nf3 would have been stronger here, developing toward the center first.";
      const result = validateChat(reply, facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations).not.toContain("nf3");
    });

    it("a reply naming an UNfocused/illegal san still redirects (the fold doesn't open the gate wide)", () => {
      const facts = assembleChatFactList(
        [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }, { ply: 3, san: "Bc4" }],
        {
          mode: "review",
          turningPointFocus: {
            ply: 3,
            san: "Bc4",
            label: "inaccuracy",
            bestSan: "Nf3",
            pvSans: ["Nf3", "Nc6", "Bb5"],
          },
        }
      );
      expect(facts.allowedSans).not.toContain("Qxh7");

      const reply = "qxh7 wins the game right now.";
      const result = validateChat(reply, facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations).toContain("qxh7");
    });
  });

  describe("assembleChatFactList — per-ply bestSan/pvSans fold into allowedSans (missed-win round, 2026-07-28)", () => {
    it("per-ply bestSan and pvSans are allowed sans, so the coach can name the mate it was handed", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const perPly = [{ ply: 55, san: "Nf7+", evalCp: null, evalMate: -3, bestSan: "Qh8#", pvSans: ["Qh8#"] }];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.allowedSans).toContain("Qh8#");
    });
  });

  // Round 3 Task 12 (item 5/Q3, trust floor): relative-gap words -- distinct
  // from readForPly's per-position bucket, gapWord answers "how much worse
  // was the played move than the best one," in words a model may say without
  // ever stating the underlying number.
  describe("gapWord (Task 12)", () => {
    it("gap words distinguish a style call from a real edge", () => {
      expect(gapWord(30, false)).toBe("no real gap");
      expect(gapWord(73, false)).toBe("slightly better");
      expect(gapWord(210, false)).toBe("clearly better");
      expect(gapWord(400, false)).toBe("decisively better");
      expect(gapWord(20, true)).toBe("decisively better"); // mate/motif overrides
    });

    it("is symmetric on sign -- a negative deltaCp buckets the same as its magnitude", () => {
      expect(gapWord(-73, false)).toBe("slightly better");
      expect(gapWord(-400, false)).toBe("decisively better");
    });
  });

  // Integration: assembleChatFactList threads gapWord onto each perPlyAnalysis
  // entry, honestly derived from the array's own consecutive evalCp/evalMate
  // pairs (fenAfter(ply-1) == fenBefore(ply)) -- no new engine call, no new
  // stored column.
  describe("assembleChatFactList — perPlyAnalysis carries gap (Task 12)", () => {
    it("the first ply has no prior eval to compare against, so gap is undefined", () => {
      const gameMoves = [{ ply: 1, san: "e4" }];
      const perPly = [{ ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: null, pvSans: [] }];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[0].gap).toBeUndefined();
    });

    it("a small played-vs-best gap reads as 'no real gap'", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      // prior (ply 1) mover-perspective before-eval: +50. current (ply 2)
      // opponent-perspective after-eval: -30 -> mover(ply2)-perspective 30.
      // deltaCp = 50 - 30 = 20 < 35 -> "no real gap".
      const perPly = [
        { ply: 1, san: "e4", evalCp: 50, evalMate: null, bestSan: null, pvSans: [] },
        { ply: 2, san: "e5", evalCp: -30, evalMate: null, bestSan: "c5", pvSans: ["c5"] },
      ];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[1].gap).toBe("no real gap");
    });

    it("a large played-vs-best gap reads as 'decisively better'", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      // deltaCp = 500 - (-400) = 900 -> decisively better.
      const perPly = [
        { ply: 1, san: "e4", evalCp: 500, evalMate: null, bestSan: null, pvSans: [] },
        { ply: 2, san: "e5", evalCp: 400, evalMate: null, bestSan: "c5", pvSans: ["c5"] },
      ];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[1].gap).toBe("decisively better");
    });

    it("a mate appearing on either side of the pair overrides straight to 'decisively better'", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const perPly = [
        { ply: 1, san: "e4", evalCp: null, evalMate: 4, bestSan: null, pvSans: [] },
        { ply: 2, san: "e5", evalCp: 10, evalMate: null, bestSan: "c5", pvSans: ["c5"] },
      ];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[1].gap).toBe("decisively better");
    });

    // Whole-branch review (2026-08-03, Important finding 2): the mate
    // override in gapWord forced "decisively better" whenever a mate
    // appeared on either side of the pair, and gap was attached to the
    // output regardless of whether the played move actually deviated from
    // bestSan. Converting a mate correctly (prior mate:5 for her, current
    // mate:-4 signed for the opponent she just moved against -> honest
    // deltaCp is tiny/negative, "no real gap") on a ply where she played the
    // engine's own best move (bestSan === san, no deviation at all) wrongly
    // came out "decisively better" -- inventing a decisive miss on a move
    // she played BEST. Gap must only ever describe a real deviation.
    it("a well-played mate-converting move (bestSan === san) gets no gap at all, never a false 'decisively better'", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const perPly = [
        { ply: 1, san: "e4", evalCp: null, evalMate: 5, bestSan: null, pvSans: [] },
        // She played the engine's own best move -- bestSan === san, not a
        // deviation -- while still converting the mate (mate:-4, signed for
        // the opponent to move next).
        { ply: 2, san: "e5", evalCp: null, evalMate: -4, bestSan: "e5", pvSans: ["e5"] },
      ];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[1].gap).toBeUndefined();
    });

    it("a ply with no eval captured on either side of the pair leaves gap undefined, never a guessed number", () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const perPly = [
        { ply: 1, san: "e4", evalCp: null, evalMate: null, bestSan: null, pvSans: [] },
        { ply: 2, san: "e5", evalCp: -30, evalMate: null, bestSan: "c5", pvSans: ["c5"] },
      ];
      const facts = assembleChatFactList(gameMoves, {}, [], perPly);
      expect(facts.perPlyAnalysis?.[1].gap).toBeUndefined();
    });

    it("gap reaches the serialized fact JSON the model prompt is built from", async () => {
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const perPly = [
        { ply: 1, san: "e4", evalCp: 500, evalMate: null, bestSan: null, pvSans: [] },
        { ply: 2, san: "e5", evalCp: 400, evalMate: null, bestSan: "c5", pvSans: ["c5"] },
      ];
      const facts = assembleChatFactList(gameMoves, { mode: "review" }, [], perPly);

      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "that gap was decisively better -- e5 gave back the whole edge.";
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      await chat("how did move 1 go?", [], facts, backend, { gameId, ply: 2, kind: "chat" });

      expect(capturedPrompt).toContain('"gap":"decisively better"');
    });
  });

  // (c2) Task 2 (defender grounding): contested squares -- the coach chat
  // once told a player "the pawn on e4 doesn't guard f5" when white's e4
  // pawn genuinely defends f5 (Bxf5 exf5). assembleChatFactList now computes
  // a deterministic attacker/defender map per occupied+attacked square so
  // the model has the truth in hand instead of reasoning about defense
  // itself. assembleChatFactList only ever replays gameSans from the start
  // position (no raw-FEN injection seam), so this fixture is a minimal
  // legal move sequence reconstructing the reported bug's exact relationship
  // rather than the literal mid-game FEN from the bug report: white bishop
  // f5, black bishop c8, white pawn e4 -- f5 is attacked by the c8 bishop
  // AND defended by the e4 pawn (verified: Bxf5 exf5).
  describe("assembleChatFactList — contested squares (defender/attacker grounding, Task 2)", () => {
    function buildBugFixtureGame(): string[] {
      const chess = new Chess();
      // e3/Bd3/Bf5 (not the direct e4 first) so the bishop can cross e4/e2
      // while they're still empty; e4 lands last, after the bishop is
      // already resting on f5, giving exactly: white pawn e4, white bishop
      // f5, black bishop untouched on c8 with an open c8-d7-e6-f5 diagonal
      // (black's d5/e5 pawns, not d6/e6, keep d7 and e6 clear).
      for (const san of ["e3", "d5", "Bd3", "e5", "Bf5", "Nf6", "e4"]) {
        const res = chess.move(san);
        if (!res) throw new Error(`fixture move ${san} was illegal`);
      }
      return chess.history();
    }

    it("f5 is contested: attacked by the c8 bishop, defended by the e4 pawn", () => {
      const sans = buildBugFixtureGame();
      const gameMoves = sans.map((san, i) => ({ ply: i + 1, san }));

      const facts = assembleChatFactList(gameMoves, { mode: "live" });

      const f5 = facts.contested.find((c) => c.square === "f5");
      expect(f5).toBeDefined();
      expect(f5?.color).toBe("you");
      expect(f5?.pieceKind).toBe("b");
      expect(f5?.attackedBy).toContainEqual({ square: "c8", pieceKind: "b" });
      expect(f5?.defendedBy).toContainEqual({ square: "e4", pieceKind: "p" });
    });

    it("a piece not attacked by the opponent does not appear in contested", () => {
      const sans = buildBugFixtureGame();
      const gameMoves = sans.map((san, i) => ({ ply: i + 1, san }));

      const facts = assembleChatFactList(gameMoves, { mode: "live" });

      // White's king on e1 is not attacked by anything in this position --
      // contested must omit it entirely rather than include it with an
      // empty attackedBy array.
      expect(facts.contested.find((c) => c.square === "e1")).toBeUndefined();
    });

    // buildChatPrompt/factsForModel are private (same reason Task 7's
    // hintFocus test above asserts against the actual prompt string rather
    // than a private helper) -- this proves contested reaches the model,
    // not just the ChatFactList object, by inspecting what chat() actually
    // sends the backend.
    it("contested reaches the serialized fact JSON the model prompt is built from", async () => {
      const sans = buildBugFixtureGame();
      const gameMoves = sans.map((san, i) => ({ ply: i + 1, san }));
      const facts = assembleChatFactList(gameMoves, { mode: "live" });

      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "your bishop on f5 is defended by the pawn on e4.";
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      await chat("is my bishop on f5 safe?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(capturedPrompt).toContain('"contested"');
      expect(capturedPrompt).toContain('"square":"f5"');
      expect(capturedPrompt).toContain('"square":"c8"');
      expect(capturedPrompt).toContain('"square":"e4"');
    });
  });

  // Task (2026-07-21, defender-claim validation): the coach once told a
  // player "the pawn on e4 doesn't guard f5" when e4 demonstrably guards
  // f5 (Bxf5 exf5) -- contested (above) gives the model the truth as a
  // fact, but nothing previously checked the model's OWN prose against
  // that truth. DEFENDER_FEN is the exact relationship from the bug
  // report: white pawn e4 defends white bishop f5, f5 is attacked by
  // black's c8 bishop, black's f6 knight is defended (e7 bishop + g7
  // pawn), black's e5 pawn has no defenders at all. A minimal literal
  // ChatFactList is used (not assembleChatFactList, which only replays
  // gameSans from the start position and has no raw-FEN injection seam)
  // since only currentFen matters for these checks.
  const DEFENDER_FEN = "r1bqrnk1/pp2bppp/2p2n2/3ppB2/2P1P3/1PBP1N2/P4PPP/RN1Q1RK1 w - - 0 12";
  function defenderFacts(): ChatFactList {
    // occupancy is derived from DEFENDER_FEN (Task 1, R3 fact-gap round: the
    // new placement-claim check reads occupancy, so it can no longer be a
    // placeholder empty list the way it was when only defense/safety claims
    // were checked here -- same derivation derivePositionFacts uses).
    const chess = new Chess(DEFENDER_FEN);
    const occupancy: ChatFactList["occupancy"] = [];
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
      }
    }
    return {
      gameSans: [],
      currentFen: DEFENDER_FEN,
      toMove: "you", // DEFENDER_FEN is a "w" fen -- white (you) to move
      occupancy,
      legalSans: [],
      allowedSans: [],
      contested: [],
    };
  }

  describe("validateChat -- defender-claim validation (defense grounding)", () => {
    it("flags a false negative guard claim: e4 DOES guard f5", () => {
      const facts = defenderFacts();
      const result = validateChat("the pawn on e4 doesn't guard f5.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
      }
    });

    it("flags a false undefended/safety claim: f5 IS defended (by e4)", () => {
      const facts = defenderFacts();
      const result = validateChat("your bishop on f5 is undefended.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
      }
    });

    it("does not flag a TRUE guard claim: e4 guards f5", () => {
      const facts = defenderFacts();
      const result = validateChat("e4 guards f5, so the bishop is safe there.", facts);
      expect(result.ok).toBe(true);
    });

    it("flags a false 'hanging' claim on a piece that IS defended (f6 knight, defended by e7 bishop + g7 pawn)", () => {
      const facts = defenderFacts();
      const result = validateChat("your knight on f6 is hanging.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
      }
    });

    it("does not flag a TRUE 'hanging' claim on a piece with no defenders (e5 pawn has zero black defenders)", () => {
      const facts = defenderFacts();
      // "the" not "your" -- e5 holds mallow's pawn in DEFENDER_FEN (Task 1,
      // R3: the new placement-claim check would correctly flag "your pawn
      // on e5" as a false ownership claim, since this test is only about
      // the safety/hanging predicate, not ownership).
      const result = validateChat("the pawn on e5 is hanging.", facts);
      expect(result.ok).toBe(true);
    });

    it("does not flag a reply with no defense/safety claim at all", () => {
      const facts = defenderFacts();
      const result = validateChat("nice, that develops your knight and fights for the center.", facts);
      expect(result.ok).toBe(true);
    });

    it("does not flag an empty-square/unparseable claim (d4 is empty in this position)", () => {
      const facts = defenderFacts();
      const result = validateChat("the knight on b1 guards d4.", facts);
      expect(result.ok).toBe(true);
    });
  });

  // Task 4 (2026-08-26, coach-truth round): the intersection rule above and
  // checkPlacementClaims's own copy of it (server/coach/placementClaims.ts)
  // exist so a claim true at the moment being discussed is never penalised
  // for being untrue today -- right in general, but SYMMETRIC, which is how
  // the coach told the owner a bishop was on d6 while she was asking about
  // ply 31, a moment where that bishop still stood on e7 (it only reached
  // d6 three of mallow's moves later). The intersection equally protected a
  // claim true TODAY and false THEN. The fix is one-directional: when a
  // turning point is in focus, the focused position governs alone.
  //
  // Fixture (game 190, trace 284 shape): focusFen is the position just
  // before ply 31 -- mallow's dark-squared bishop on e7, her other knight
  // on d7. finalFen is a later position where that bishop has relocated to
  // d6 and the d7 knight has moved to b6 -- built by hand (not a real
  // replayed game) but a legal position either way, verified directly
  // against chess.js in the console before being pasted in here.
  describe("validateChat — focused asks bind placement claims to the focused position (game 190, trace 284)", () => {
    const focusFen = "r2q1rk1/pp1nbpp1/5n1p/8/N2pP3/1P1B1Q1P/P2B1PP1/R4RK1 w - - 0 16";
    const finalFen = "r2q1rk1/pp3pp1/1n1b1n1p/8/N2pP3/1P1B1Q1P/P2B1PP1/R4RK1 w - - 0 16";

    function occupancyFromFen(fen: string): ChatFactList["occupancy"] {
      const chess = new Chess(fen);
      const occupancy: ChatFactList["occupancy"] = [];
      for (const row of chess.board()) {
        for (const cell of row) {
          if (!cell) continue;
          occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
        }
      }
      return occupancy;
    }

    // turningPointFocus present -> facts.focusPosition is derived from
    // focusFen and facts.context.turningPointFocus is set, mirroring
    // assembleChatFactList's own "focusPly present -> derive focusPosition"
    // fold (chat.ts ~line 627). turningPointFocus absent (the {} case,
    // test 3 below) -> neither field is set, the same as an ordinary
    // (non-focused) live message.
    function factsWithFocus(
      focusFenArg: string,
      finalFenArg: string,
      contextOverrides: { turningPointFocus?: { ply: number } }
    ): ChatFactList {
      const finalChess = new Chess(finalFenArg);
      const base: ChatFactList = {
        gameSans: [],
        currentFen: finalFenArg,
        toMove: finalChess.turn() === "w" ? "you" : "mallow",
        occupancy: occupancyFromFen(finalFenArg),
        legalSans: [],
        allowedSans: [],
        contested: [],
        status: "finished",
      };
      if (!contextOverrides.turningPointFocus) return base;
      const focusChess = new Chess(focusFenArg);
      return {
        ...base,
        context: {
          mode: "review",
          turningPointFocus: {
            ply: contextOverrides.turningPointFocus.ply,
            san: "Bd6",
            label: "test",
          },
        },
        focusPosition: {
          ply: contextOverrides.turningPointFocus.ply,
          fen: focusFenArg,
          toMove: focusChess.turn() === "w" ? "you" : "mallow",
          occupancy: occupancyFromFen(focusFenArg),
          legalSans: [],
          contested: [],
        },
      };
    }

    it("flags a piece named from today's board when a turning point is in focus", () => {
      const facts = factsWithFocus(focusFen, finalFen, { turningPointFocus: { ply: 31 } });
      const result = validateChat("once it's on the board, it eyes her bishop on d6", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.includes("d6"))).toBe(true);
    });

    // Guard rail: the fix must not reintroduce the false positives the
    // intersection rule was written to prevent -- a claim true at the
    // focused moment (mallow's knight really is on d7 at ply 31, it has
    // since moved to b6) must still be accepted even though it is no
    // longer true today.
    it("still accepts a claim true at the focused moment but false today", () => {
      const facts = factsWithFocus(focusFen, finalFen, { turningPointFocus: { ply: 31 } });
      const result = validateChat("her knight sits on d7 there", facts);
      expect(result.ok).toBe(true);
    });

    // Guard rail: with no turning point in focus, ordinary chat about the
    // current board is untouched by this change -- a true claim about
    // today's position (the bishop really is on d6 by finalFen) still
    // passes.
    it("keeps the lenient rule when no turning point is in focus", () => {
      const facts = factsWithFocus(focusFen, finalFen, {});
      const result = validateChat("her bishop is on d6", facts);
      expect(result.ok).toBe(true);
    });
  });

  // Side-to-move fact (round 2026-07-22): the coach once attributed the
  // PLAYER's own pending move to mallow ("you win her queen for free" about
  // the player's own Qh5) because ChatFactList had no fact stating whose
  // turn it is -- legalSans is an unlabeled bare list, and the model was
  // left to infer perspective from the FEN's side-to-move field alone.
  // toMove is derived from chess.turn() at the same replay currentFen comes
  // from: w -> "you", b -> "mallow" -- the same fixed "player is always
  // white in v1" mapping occupancy already uses.
  describe("assembleChatFactList — toMove fact (side-to-move grounding)", () => {
    it("start position (no moves played) -> toMove is you (white to move)", () => {
      const facts = assembleChatFactList([], { mode: "live" });
      expect(facts.toMove).toBe("you");
    });

    it("after an odd number of plies (e.g. e4) -> toMove is mallow", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      expect(facts.toMove).toBe("mallow");
    });

    it("after an even number of plies (e.g. e4, e5) -> toMove is you", () => {
      const facts = assembleChatFactList(
        [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }],
        { mode: "live" }
      );
      expect(facts.toMove).toBe("you");
    });

    it("the prompt's fact JSON carries toMove and legalSansBelongTo, equal to each other", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      expect(facts.toMove).toBe("mallow");

      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "mallow has several replies here.";
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      await chat("whose move is it?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(capturedPrompt).toContain('"toMove":"mallow"');
      expect(capturedPrompt).toContain('"legalSansBelongTo":"mallow"');
    });
  });

  // Side-to-move validation (round 2026-07-22, Task 2 -- "the stronger
  // version"): the coach once attributed the PLAYER's own move to mallow
  // ("mallow plays Qh5" while it was actually the player's own pending
  // move). toMove/legalSansBelongTo (above) give the model the fact;
  // checkSideAttributionClaims checks the model's OWN prose against it,
  // modeled directly on checkDefenseClaims's shape: a fixed, narrow set of
  // subject+verb forms, no synonym expansion, no pronoun resolution across
  // sentences. A hand-built literal ChatFactList is used (not
  // assembleChatFactList, which only replays gameSans from the start
  // position) -- same pattern defenderFacts() above uses -- since only
  // toMove/legalSans/allowedSans matter for this check. allowedSans mirrors
  // legalSans (as assembleChatFactList's real fold always does) so the
  // primary SAN-shaped-token check never fires here, isolating the
  // side-claim check in each assertion below.
  function sideAttrFacts(overrides: Partial<ChatFactList> = {}): ChatFactList {
    const legalSans = ["Qh5", "Nf3", "e4"];
    return {
      gameSans: [],
      currentFen: DEFENDER_FEN,
      toMove: "you",
      occupancy: [],
      legalSans,
      allowedSans: [...legalSans],
      contested: [],
      ...overrides,
    };
  }

  describe("validateChat — side-attribution claim validation (side-to-move grounding, Task 2)", () => {
    it("flags 'mallow plays Qh5' when toMove is you and Qh5 is the player's own legal move", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("mallow plays Qh5, winning material.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(true);
    });

    // Task 3a (R2, voice-enforcement round): these three cases still test
    // that checkSideAttributionClaims itself does NOT flag a correct/
    // ambiguous attribution -- but the fixture text names a move in raw
    // notation ("Qh5"), which the voice guard now separately and always
    // bans, so the overall verdict is (correctly) false. The assertion
    // narrows to "no side-claim violation" rather than "ok: true" so it
    // keeps proving the property it was written for.
    it("does not flag a side-claim violation for 'mallow plays Qh5' when toMove is mallow and Qh5 genuinely is mallow's legal move", () => {
      const facts = sideAttrFacts({ toMove: "mallow" });
      const result = validateChat("mallow plays Qh5, winning material.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    it("does not flag a side-claim violation for 'you play Qh5' in the same (toMove: you) position -- correct attribution", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("you play Qh5 and win her queen.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    it("does not flag a side-claim violation for an ambiguous phrasing outside the fixed verb list (the cut)", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("mallow could try Qh5 here.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    // FP class 1 (controller review, 2026-07-22): a past-tense verb almost
    // always refers to a move already made, not a claim about the CURRENT
    // toMove side's options -- Nf3 is legal for white right now, but "mallow
    // played Nf3" truthfully describes an earlier black move. Adjudicating
    // past tense against legalSans was wrong; only present-tense forms are
    // adjudicated now.
    // Task 3a note applies to the three FP-class tests below too: the
    // fixture text names a move in raw notation, which voice now always
    // bans, so the overall verdict is (correctly) false; the assertion
    // narrows to "no side-claim violation" to keep proving each FP class.
    it("does not flag a side-claim violation for a past-tense mention of an earlier move ('mallow played Nf3') even though Nf3 is also currently legal", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["Nf3", "Qh5", "e4"], allowedSans: ["Nf3", "Qh5", "e4"] });
      const result = validateChat("mallow played Nf3 a few moves back.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    // FP class 2: O-O/O-O-O is the same token for both colors, so it can
    // never be adjudicated by legalSans membership alone -- castling tokens
    // are skipped outright.
    it("does not flag a side-claim violation for a castling mention ('mallow plays O-O') even though castling is also currently legal for the player", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["O-O", "Qh5", "e4"], allowedSans: ["O-O", "Qh5", "e4"] });
      const result = validateChat("mallow plays O-O next.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    // FP class 3: the coach reasons in hypothetical lines constantly ("if
    // you play X, she plays Y") -- a conditional marker earlier in the same
    // sentence means the named side is inside a hypothetical, not a literal
    // attribution of the current position.
    it("does not flag a side-claim violation for a conditional/hypothetical line ('if you push d4, she plays Nc6')", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["Nc6", "Qh5", "e4"], allowedSans: ["Nc6", "Qh5", "e4"] });
      const result = validateChat("if you push d4, she plays Nc6 next.", facts);
      expect(result.ok).toBe(false); // voice bans the raw notation regardless
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(false);
    });

    // Regression guard: the original observed bug must still fire after the
    // narrowing above, or the narrowing went too far.
    it("still flags the original bug: present-tense, non-castling, non-conditional 'mallow plays Qh5' attributed to the wrong side", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("mallow plays Qh5, winning material.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.includes("side-claim"))).toBe(true);
    });
  });

  // (d)
  describe("validateChat — declared cut #2 (geography is unverifiable by design)", () => {
    it("fluent off-topic prose with no square- or san-shaped tokens passes validation — chat polices only move-shaped tokens against the fact list, never topical relevance", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const offTopic = "chess helps you learn patience and it is a wonderful game to grow up with.";
      expect(validateChat(offTopic, facts)).toEqual({ ok: true });
    });
  });

  // Whole-branch review Important #1: SAN_RE required an uppercase piece
  // letter, so a fabricated lowercase SAN (e.g. "qxh7") was never even
  // extracted as a SAN-shaped token and passed validation by default,
  // sourced "model" -- while the identical fabrication typed uppercase
  // ("Qxh7") was correctly blocked. The chat persona demands lowercase
  // prose, so a lowercased fabrication is the likely case, not an edge one.
  describe("validateChat — lowercase SAN normalization (Important #1 fix)", () => {
    it("rejects a fabricated lowercase-piece-letter SAN not backed by any allowed move", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const result = validateChat("qxh7 wins the game right now.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations).toContain("qxh7");
    });

    it("normalizes a lowercase legal SAN so the strict-SAN legality check does not flag it (Task 3a's voice guard separately and always bans the raw notation itself)", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      expect(facts.legalSans).toContain("Nc6");
      const result = validateChat("nc6 develops your knight nicely.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations).not.toContain("nc6"); // legality check recognizes it via normalization
        expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true); // voice still bans it
      }
    });
  });

  // Task 7 (increment 3.95): the hint focus threads the hint level + text
  // into the fact JSON the model prompt is built from (buildChatPrompt ->
  // factsForModel is private, so this asserts against the actual prompt
  // string chat() sends the backend, the same way test (f)'s history-window
  // assertion below inspects capturedPrompt).
  describe("chat() — hintFocus threads into the prompt (Task 7)", () => {
    it("the prompt's fact JSON carries the hint's level and rendered text", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], {
        mode: "live",
        hintFocus: { level: 3, text: "her knight to f6 opens the door. her bishop takes your rook on d5." },
      });
      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "e4 is a fine start for you.";
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      await chat("why is this hint going here?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(capturedPrompt).toContain('"hintFocus"');
      expect(capturedPrompt).toContain('"level":3');
      expect(capturedPrompt).toContain("her knight to f6 opens the door. her bishop takes your rook on d5.");
    });
  });

  // The player is always "you"/"your"; "she"/"her" must only ever mean
  // mallow (the opponent). ChatContext.herMove stays named herMove as a TS
  // field (internal identifier, not model-facing), but the key serialized
  // into the model's fact-list JSON must read yourMove.
  describe("chat() — the player's move reaches the model as yourMove, not herMove (Task pronoun sweep)", () => {
    it("a live-context herMove serializes into the prompt fact JSON under the key yourMove", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], {
        mode: "live",
        herMove: { pieceKind: "n", from: "f6", to: "g4" },
      });
      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "e4 is a fine start for you.";
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      await chat("what's going on here?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(capturedPrompt).toContain('"yourMove"');
      expect(capturedPrompt).not.toContain('"herMove"');
    });
  });

  // (e)
  describe("chat() — low-level surface", () => {
    it("backend down -> redirect text with cause backend-down, no second attempt", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      let calls = 0;
      const backend = fakeBackend(async () => {
        calls += 1;
        throw new Error("down");
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      const result = await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(result.source).toBe("template");
      expect(result.cause).toBe("backend-down");
      expect(calls).toBe(1);
      expect(result.text).toBe(
        "i can't reach my thinking right now. try me again in a moment."
      );
    });

    // Task 2 (2026-07-22, truthfulness leaks): a rejection whose message
    // indicates a timeout is a distinct cause from a genuine backend-down --
    // the gate measured two hard 20.0s timeouts rendering the "offline" chip
    // while other asks in the same session answered in 4-5s (backend was up
    // the whole time). The template text stays the redirect either way.
    it("backend rejects with a timeout-shaped error -> cause timeout, not backend-down", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const backend = fakeBackend(async () => {
        throw new Error("claude cli timed out after 20000ms");
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      const result = await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(result.source).toBe("template");
      expect(result.cause).toBe("timeout");
      expect(result.text).toBe(
        "that one took me longer than i had. ask me again and i'll get you an answer."
      );
    });

    it("backend rejects with any other error -> cause stays backend-down", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const backend = fakeBackend(async () => {
        throw new Error("econnrefused");
      });
      const sessionId = createSession();
      const gameId = createGame(sessionId, "maia-1100");

      const result = await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

      expect(result.source).toBe("template");
      expect(result.cause).toBe("backend-down");
      expect(result.text).toBe(
        "i can't reach my thinking right now. try me again in a moment."
      );
    });
  });

  // (b), (c), (f), (g), (h)
  describe("GameManager.chat (F16 integration)", () => {
    let gm: GameManager;

    beforeEach(() => {
      // Correction (gate-determinism fix, 2026-07-31): the comment this
      // replaces claimed "no gm.init() here, so the real stockfish/maia
      // engines are never started for these tests" -- that's wrong.
      // `evaluator = new StockfishEvaluator()` in manager.ts is a field
      // initializer: UciEngine's constructor calls child_process.spawn()
      // SYNCHRONOUSLY, so the real stockfish binary starts the instant
      // `new GameManager()` runs below, regardless of init(). What's true
      // is narrower: chat() itself never touches this.evaluator (only
      // judgeMove/playerMove do), so the spawned process is never SENT a
      // search -- it just sits there, alive, unkilled. With 21 tests in
      // this block that meant 21 leaked real stockfish processes per full
      // run, all surviving to the end of whatever vitest worker happened
      // to run this file (workers are reused across files, not respawned
      // per file), which is exactly the load-sensitivity that made
      // server/index.stream.test.ts's "done frame" test flake with
      // "socket hang up" under the full suite. setCoachBackendForTesting is
      // still always called before any gm.chat() call below, so the real
      // claude CLI is still never invoked -- that part of the old comment
      // was correct and is unchanged.
      gm = new GameManager();
    });

    afterEach(() => gm.shutdown());

    it("(b) a reply naming a played san passes validation -> source model, writes both chat_messages rows and one advice_traces row kind chat", async () => {
      const gameId = seedGame(["e4"]);
      gm.setCoachBackendForTesting(fakeBackend(async () => "e4 opens things up nicely for you."));

      const result = await gm.chat(gameId, { message: "what did I just play?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("model");

      const messages = getAllChatMessages(gameId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].text).toBe("what did I just play?");
      expect(messages[1].role).toBe("coach");
      expect(messages[1].trace_id).toBe(result.traceId);

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].id).toBe(result.traceId);
      expect(traces[0].kind).toBe("chat");
    });

    // B3a (2026-07-27, coach-truth-speed round): this used to assert the
    // `redirect` template ("keep it on the board...") -- that WAS the bug
    // her "I did ask about the board" note caught (trace 90): a validation
    // failure (never a real off-topic ask) rendered the off-topic-sounding
    // redirect copy. Two failed validations in a row now get their own
    // honest cause/copy ("garbled") instead; `redirect` is reserved for a
    // genuine off-topic ask, which nothing in this wave emits.
    it("(c) inventing an unplayed, illegal san regenerates once, then falls back to the garbled template with cause validation-failed", async () => {
      const gameId = seedGame(["e4"]);
      gm.setCoachBackendForTesting(fakeBackend(async () => "Qxh7 wins the game right now."));

      const result = await gm.chat(gameId, { message: "what should I do next?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("template");
      expect(result.cause).toBe("validation-failed");
      expect(result.text).toBe(
        "i couldn't get that one clean. ask me again and i'll come at it from a different angle."
      );

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].regen_count).toBe(1);
      expect(traces[0].kind).toBe("chat");
    });

    it("(c2) inventing an unplayed, illegal san in LOWERCASE regenerates once, then falls back to the garbled template — the reviewer's probe case", async () => {
      const gameId = seedGame(["e4"]);
      gm.setCoachBackendForTesting(fakeBackend(async () => "qxh7 wins the game right now."));

      const result = await gm.chat(gameId, { message: "what should I do next?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("template");
      expect(result.cause).toBe("validation-failed");
      expect(result.text).toBe(
        "i couldn't get that one clean. ask me again and i'll come at it from a different angle."
      );

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].regen_count).toBe(1);
      expect(traces[0].kind).toBe("chat");
    });

    it("(f) server truncates history to the last CHAT_HISTORY_WINDOW messages by id, ignoring anything older", async () => {
      const gameId = seedGame(["e4"]);
      // 10 prior messages (5 exchanges), oldest first — window is 8, so the
      // two oldest (old-message-1, old-message-2) must fall outside it.
      for (let i = 1; i <= 10; i++) {
        insertChatMessage({ gameId, role: i % 2 === 1 ? "user" : "coach", text: `old-message-${i}` });
      }
      expect(CHAT_HISTORY_WINDOW).toBe(8);

      let capturedPrompt = "";
      gm.setCoachBackendForTesting(
        fakeBackend(async (prompt) => {
          capturedPrompt = prompt;
          return "e4 is a fine start for you.";
        })
      );

      await gm.chat(gameId, { message: "new question", context: { mode: "live" } });

      expect(capturedPrompt).not.toContain("old-message-1\n");
      expect(capturedPrompt).not.toContain("old-message-2\n");
      for (let i = 3; i <= 10; i++) {
        expect(capturedPrompt).toContain(`old-message-${i}`);
      }
    });

    it("(g) review-mode chat works on a finished game absent from the live map (db-backed), and traces at the game's total ply count", async () => {
      const gameId = seedGame(["e4", "e5", "Nf3"]);
      finishGame(gameId, "1-0");
      // Never called gm.newGame for this id — it genuinely is not in
      // this.games, proving gm.chat() is DB-backed, not live-map-backed.
      gm.setCoachBackendForTesting(fakeBackend(async () => "Nf3 develops a piece toward the center for you."));

      const result = await gm.chat(gameId, { message: "how did this game go?", context: { mode: "review" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].ply).toBe(3);
    });

    it("(h) rejects a message longer than CHAT_MAX_LEN without writing any rows", async () => {
      const gameId = seedGame(["e4"]);
      const longMessage = "x".repeat(CHAT_MAX_LEN + 1);

      const result = await gm.chat(gameId, { message: longMessage, context: { mode: "live" } });
      expect(result).toEqual({ ok: false, error: "too-long" });
      expect(getAllChatMessages(gameId)).toHaveLength(0);
      expect(getAdviceTraces(gameId)).toHaveLength(0);
    });
  });

  // Task 3a (R2, voice-enforcement round, 2026-07-22): the coach's own
  // voice rules (personas/coach.md's "## voice" block, Task 2 this round)
  // ban raw notation as a move's name, the infra words "engine"/
  // "eval(uation)"/"centipawn(s)"/"cp", and any stated number for the
  // position -- but nothing previously checked a reply's OWN prose against
  // those rules. Modeled on checkDefenseClaims/checkPlacementClaims/
  // checkSideAttributionClaims: precision over recall, no engine call,
  // routed into the same violations array validateChat already returns.
  describe("validateChat — voice guard (Task 3a)", () => {
    function voiceFacts(): ChatFactList {
      return assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    }

    it("flags raw notation naming a move (Nf3) even when it's a legal move", () => {
      const facts = voiceFacts();
      expect(facts.legalSans).toContain("Nf3");
      const result = validateChat("she takes with Nf3, developing a piece.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
    });

    it("flags raw notation for a capture (Bxe4)", () => {
      const facts = voiceFacts();
      const result = validateChat("Bxe4 wins a piece right now.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
    });

    it("flags raw castling notation (O-O)", () => {
      const facts = voiceFacts();
      const result = validateChat("mallow plays O-O next.", facts);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
      expect(result.ok).toBe(false);
    });

    it("does not flag a bare square named on its own (geography, cut #2)", () => {
      const facts = voiceFacts();
      const result = validateChat("push to e4 and you're fine.", facts);
      expect(result.ok).toBe(true);
    });

    it("flags the standalone word 'engine'", () => {
      const facts = voiceFacts();
      const result = validateChat("the engine says you're fine here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v === "voice-word: engine")).toBe(true);
    });

    it("flags the standalone word 'eval'", () => {
      const facts = voiceFacts();
      const result = validateChat("your eval here is good.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-word"))).toBe(true);
    });

    it("flags the standalone word 'evaluation'", () => {
      const facts = voiceFacts();
      const result = validateChat("the evaluation likes this for you.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-word"))).toBe(true);
    });

    it("flags the standalone word 'centipawns'", () => {
      const facts = voiceFacts();
      const result = validateChat("you're up a few centipawns here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-word"))).toBe(true);
    });

    it("flags the standalone word 'cp'", () => {
      const facts = voiceFacts();
      const result = validateChat("you're up 50 cp here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice"))).toBe(true);
    });

    // Round 3 (trace 126, old L2): "ply" is engine-internal counting
    // language ("ply 7" for what she reads as "move 4") -- the same class
    // of jargon engine/eval/cp already ban, matching how she actually reads
    // a game (in move-number pairs, not raw half-move plies).
    it("flags the standalone word 'ply'", () => {
      const facts = voiceFacts();
      const result = validateChat("that happened back at ply 7 for you.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-word"))).toBe(true);
    });

    it("does not flag 'apply' or 'multiply' -- 'ply' is banned as a whole word only", () => {
      const facts = voiceFacts();
      const result = validateChat("apply pressure here, then multiply the threats.", facts);
      expect(result.ok).toBe(true);
    });

    it("flags a signed positive number for the position", () => {
      const facts = voiceFacts();
      const result = validateChat("you're at +50 here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    it("flags a signed negative number for the position", () => {
      const facts = voiceFacts();
      const result = validateChat("you're at -30 here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    it("flags an unspaced cp number ('50cp')", () => {
      const facts = voiceFacts();
      const result = validateChat("you're up 50cp here.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    // Deliberately narrow (the plan's must-pass cases): a plain, unsigned
    // integer with no cp suffix is a ply/mate count, not a stated position
    // eval, and must never be flagged.
    it("does NOT flag 'mate in 3' (an unsigned mate count)", () => {
      const facts = voiceFacts();
      const result = validateChat("there's mate in 3 for you here.", facts);
      expect(result.ok).toBe(true);
    });

    it("does NOT flag 'move 12' (an unsigned move number)", () => {
      const facts = voiceFacts();
      const result = validateChat("back on move 12 you had a good chance.", facts);
      expect(result.ok).toBe(true);
    });

    it("does NOT flag 'move 8' (an unsigned move number)", () => {
      const facts = voiceFacts();
      const result = validateChat("move 8 was the moment things turned.", facts);
      expect(result.ok).toBe(true);
    });
  });

  // Whole-branch review (2026-08-03, Critical finding 1): W2 originally
  // lifted the output number-ban whenever `userAskedForNumber` was true, on
  // the theory that "she asked for it, so let it through" -- but no true cp
  // value is EVER routed into the model's prompt (readForPly emits words
  // only; see that function's own header comment and chat.ts:433/1104/1285's
  // "never leak evalCp/evalMate as numbers" invariant). With the ban
  // disabled on exactly the turn she asks for a number, and no true number
  // in the fact list to ground a reply in, the model has no honest number to
  // give and the validator that would have caught a fabricated one is
  // exactly the one that got turned off. CONSERVATIVE FIX: keep the ban in
  // effect even when she asked -- the coach must never state a number it
  // was never given. `userAskedForNumber` is now unused by checkVoice/
  // validateChat/validateChatGeneral (kept as an accepted, ignored opt for
  // call-site compatibility) until a future change actually grounds the
  // real evalCp into the on-ask prompt (see coach.md's "own opinion, not the
  // number" guidance below for the honest decline in the meantime).
  describe("validateChat / validateChatGeneral — a number is never allowed, even on explicit ask (Task 13 / review fix)", () => {
    function voiceFacts(): ChatFactList {
      return assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    }

    it("stating a signed number unprompted is banned (default, no opts)", () => {
      const facts = voiceFacts();
      const result = validateChat("you're about +2.1 there.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    it("stating a signed number STAYS banned even when the opts flag says she asked for it -- no true number exists to ground it", () => {
      const facts = voiceFacts();
      const result = validateChat("you're about +2.1 there.", facts, { userAskedForNumber: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    // Unspaced ("50cp"), same as the existing "flags an unspaced cp number"
    // pin above -- the bare word-jargon ban's \b can't reach inside "50cp"
    // (no word boundary between a digit and a letter), so this text would
    // ONLY trip the number-cp check if that check were scoped off -- it
    // must not be, so this stays flagged too.
    it("an unspaced cp count STAYS banned even when she asked for it", () => {
      const facts = voiceFacts();
      const result = validateChat("you're up 50cp there.", facts, { userAskedForNumber: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-number"))).toBe(true);
    });

    it("the jargon-word ban stays on even when she asked for the number -- 'centipawns' as a bare word is still flagged", () => {
      const facts = voiceFacts();
      const result = validateChat("that's a big centipawns swing.", facts, { userAskedForNumber: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-word"))).toBe(true);
    });

    it("the notation ban stays on even when she asked for the number", () => {
      const facts = voiceFacts();
      const result = validateChat("Nf3 is worth about +2.1.", facts, { userAskedForNumber: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
    });

    it("validateChatGeneral never lets a number through either, opt or no opt", () => {
      const facts = voiceFacts();
      expect(validateChatGeneral("you're about +2.1 there.", facts).ok).toBe(false);
      expect(validateChatGeneral("you're about +2.1 there.", facts, { userAskedForNumber: true }).ok).toBe(false);
    });
  });

  describe("asksForNumber (Task 13)", () => {
    it("recognizes an explicit ask for the eval/score/number", () => {
      expect(asksForNumber("what's the eval here?")).toBe(true);
      expect(asksForNumber("what is the score right now?")).toBe(true);
      expect(asksForNumber("can you give me the number?")).toBe(true);
      expect(asksForNumber("just tell me the centipawns")).toBe(true);
      expect(asksForNumber("how many centipawns am I up?")).toBe(true);
    });

    it("does not treat an ordinary strength question as an ask for the number", () => {
      expect(asksForNumber("am I winning?")).toBe(false);
      expect(asksForNumber("who's better here?")).toBe(false);
      expect(asksForNumber("what's my best move?")).toBe(false);
    });
  });

  // Wave 0, item 2 (F5.5): correctiveSuffix used to glue EVERY violation
  // into one sentence hardcoded for bad SAN ("mentioned X, which isn't a
  // move from this game") -- so a placement-claim violation like
  // "placement-claim: knight on b3 -- b3 is empty" got told it "isn't a
  // move from this game", which is nonsense: the model never claimed
  // "placement-claim: ..." was a move at all. Each violation kind now
  // routes to its own corrective line, the way voice violations already
  // did via VOICE_KIND_GUIDANCE.
  describe("correctiveSuffix (Wave 0, item 2 / F5.5): kind-appropriate guidance", () => {
    it("a bad-SAN violation gets the 'isn't a move from this game' line", () => {
      const suffix = correctiveSuffix(["Qxh7"]);
      expect(suffix).toContain("mentioned Qxh7, which isn't a move from this game.");
    });

    it("a placement violation does NOT get the bad-SAN catch-all, and gets its own guidance instead", () => {
      const suffix = correctiveSuffix(["placement-claim: your knight on b3 -- b3 is empty"]);
      expect(suffix).not.toContain("isn't a move from this game");
      expect(suffix.toLowerCase()).toContain("restate only what the fact list proves");
    });

    it("a side-claim violation gets its own guidance, not the SAN catch-all", () => {
      const suffix = correctiveSuffix(["side-claim: Nf3 is mallow's move to play, not you's"]);
      expect(suffix).not.toContain("isn't a move from this game");
      expect(suffix.toLowerCase()).toContain("other side");
    });

    it("a defense-claim violation gets its own guidance, not the SAN catch-all", () => {
      const suffix = correctiveSuffix(["defense-claim: e4 is defended"]);
      expect(suffix).not.toContain("isn't a move from this game");
      expect(suffix.toLowerCase()).toContain("defense claim");
    });

    it("a mate-claim violation gets its own guidance, not the SAN catch-all", () => {
      const suffix = correctiveSuffix(["mate-claim: no line in this game's facts mates in 5"]);
      expect(suffix).not.toContain("isn't a move from this game");
      expect(suffix.toLowerCase()).toContain("mate claim");
    });

    it("mixed violations produce both their guidance lines, each once", () => {
      const suffix = correctiveSuffix([
        "placement-claim: your knight on b3 -- b3 is empty",
        "Qxh7",
      ]);
      expect(suffix).toContain("mentioned Qxh7, which isn't a move from this game.");
      expect(suffix.toLowerCase()).toContain("restate only what the fact list proves");
    });
  });

  // Round 3 (Q2 step 3): the hint shelf fold. lastHint is keyed to the exact
  // fen it was computed for -- a match against the live currentFen (or a
  // focused turning point's own pre-move fen) folds it in; anything else is
  // a stale hint from a position the board has moved past and must be
  // dropped.
  describe("assembleChatFactList: hint shelf fold (Q2 step 3)", () => {
    const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    it("projects the hint shelf when the hint's fen matches the live currentFen", () => {
      const facts = assembleChatFactList(
        [], // no moves played -- currentFen is the start position
        { mode: "live" },
        undefined,
        undefined,
        undefined,
        undefined,
        {
          fen: START_FEN,
          facts: {
            bestUci: "e2e4",
            pv: ["e2e4", "e7e5"],
            evalCp: null,
            evalMate: 3,
            trade: false,
            escalated: false,
            verified: true,
          },
        }
      );
      expect(facts.hintFindings).toBeDefined();
      expect(facts.hintFindings!.fen).toBe(START_FEN);
      expect(facts.hintFindings!.bestSan).toBe("e4");
      expect(facts.hintFindings!.bestUci).toBe("e2e4");
      expect(facts.hintFindings!.pvSans).toEqual(["e4", "e5"]);
      expect(facts.hintFindings!.evalMate).toBe(3);
      expect(facts.hintFindings!.evalCp).toBeNull();
      // the shelf's own best/pv sans must be legally speakable
      expect(facts.allowedSans).toContain("e4");
      expect(facts.allowedSans).toContain("e5");
    });

    it("projects the hint shelf when the hint's fen matches a focused turning point's pre-move position", () => {
      const facts = assembleChatFactList(
        [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }],
        { mode: "live", turningPointFocus: { ply: 1, san: "e4", label: "opening" } },
        undefined,
        undefined,
        undefined,
        undefined,
        {
          fen: START_FEN, // the position BEFORE ply 1 -- what focusPosition derives to
          facts: {
            bestUci: "e2e4",
            pv: ["e2e4"],
            evalCp: 30,
            evalMate: null,
            trade: false,
            escalated: false,
            verified: true,
            recommendation: { san: "e4" },
          },
        }
      );
      expect(facts.hintFindings).toBeDefined();
      expect(facts.hintFindings!.fen).toBe(facts.focusPosition!.fen);
      expect(facts.hintFindings!.recommendationSan).toBe("e4");
    });

    it("drops the hint shelf when the board has moved on (stale fen)", () => {
      const facts = assembleChatFactList(
        [{ ply: 1, san: "e4" }], // currentFen is now AFTER e4, not the start position
        { mode: "live" },
        undefined,
        undefined,
        undefined,
        undefined,
        {
          fen: START_FEN,
          facts: {
            bestUci: "e2e4",
            pv: ["e2e4"],
            evalCp: null,
            evalMate: 3,
            trade: false,
            escalated: false,
            verified: true,
          },
        }
      );
      expect(facts.hintFindings).toBeUndefined();
    });

    it("every existing call site (no 7th arg) is unaffected -- hintFindings stays undefined", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      expect(facts.hintFindings).toBeUndefined();
    });
  });

  // Task 3 (coach-truth round): the postgame incident -- the coach told the
  // player a bishop was on d6 while she was asking about a ply where it
  // stood on e7; it reached d6 three of mallow's moves later. The fact list
  // carries BOTH the focused position and today's live position
  // (currentFen/occupancy/contested, spread at the top level by
  // factsForModel) with nothing telling the model which one governs a
  // claim. This section proves focusedMomentSection now says so plainly, on
  // both the her-ply and mallow-ply branches.
  describe("buildChatPromptParts: the focused moment says the top-level position is a different moment (Task 3)", () => {
    const GAME = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "d3", "Qf6"];
    const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

    it("her-ply focus: warns that currentFen/occupancy/contested describe a different moment than the focus", () => {
      const facts = assembleChatFactList(moves(GAME), {
        mode: "live",
        turningPointFocus: { ply: 9, san: "d3", label: "inaccuracy" },
      });
      const parts = buildChatPromptParts(facts, [], "where's my bishop?", getPersona(), "board");

      expect(parts.dynamic).toMatch(/currentFen.*occupancy.*describe a different moment/i);
      // Review fix (Important): the instruction used to point at "the focused
      // position above" for every claim, but focusForModel (chat.ts) never
      // sends that position -- only a diff of what changed. This pins the
      // corrected instruction's warning against standHereNowButNotThen
      // specifically, since that field holds TODAY's squares and sits inside
      // the focusPosition object -- naming a piece from it as "the focused
      // moment" is the original bug inverted.
      expect(parts.dynamic).toContain("never name a square from standHereNowButNotThen");
    });

    it("mallow-ply focus: carries the same warning on the opponent-move branch", () => {
      const facts = assembleChatFactList(moves(GAME), {
        mode: "live",
        turningPointFocus: { ply: 8, san: "dxc6", label: "opponent" },
      });
      const parts = buildChatPromptParts(facts, [], "what was mallow doing there?", getPersona(), "board");

      expect(parts.dynamic).toMatch(/currentFen.*occupancy.*describe a different moment/i);
      // Minor review fix: without this, a ply-parity inversion would still
      // land in the her-ply branch and this test would pass for the wrong
      // reason -- prove which branch actually ran.
      expect(parts.dynamic).toContain("MALLOW'S move");
    });
  });
});
