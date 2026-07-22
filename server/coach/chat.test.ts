import { describe, it, expect, beforeEach } from "vitest";
import { Chess } from "chess.js";
import {
  openDb, createSession, createGame, recordMove, finishGame,
  getAdviceTraces, getAllChatMessages, insertChatMessage,
} from "../store/db";
import {
  assembleChatFactList, validateChat, chat, CHAT_HISTORY_WINDOW, CHAT_MAX_LEN,
} from "./chat";
import type { ChatFactList } from "./chat";
import { GameManager } from "../game/manager";
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

      const reply = "nf3 would have been stronger here, developing toward the center first.";
      expect(validateChat(reply, facts)).toEqual({ ok: true });
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
      expect(capturedPrompt).toContain('"square": "f5"');
      expect(capturedPrompt).toContain('"square": "c8"');
      expect(capturedPrompt).toContain('"square": "e4"');
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
    return {
      gameSans: [],
      currentFen: DEFENDER_FEN,
      toMove: "you", // DEFENDER_FEN is a "w" fen -- white (you) to move
      occupancy: [],
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
      const result = validateChat("your pawn on e5 is hanging.", facts);
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

      expect(capturedPrompt).toContain('"toMove": "mallow"');
      expect(capturedPrompt).toContain('"legalSansBelongTo": "mallow"');
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

    it("does not flag 'mallow plays Qh5' when toMove is mallow and Qh5 genuinely is mallow's legal move", () => {
      const facts = sideAttrFacts({ toMove: "mallow" });
      const result = validateChat("mallow plays Qh5, winning material.", facts);
      expect(result.ok).toBe(true);
    });

    it("does not flag 'you play Qh5' in the same (toMove: you) position -- correct attribution", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("you play Qh5 and win her queen.", facts);
      expect(result.ok).toBe(true);
    });

    it("does not flag an ambiguous phrasing outside the fixed verb list (the cut)", () => {
      const facts = sideAttrFacts({ toMove: "you" });
      const result = validateChat("mallow could try Qh5 here.", facts);
      expect(result.ok).toBe(true);
    });

    // FP class 1 (controller review, 2026-07-22): a past-tense verb almost
    // always refers to a move already made, not a claim about the CURRENT
    // toMove side's options -- Nf3 is legal for white right now, but "mallow
    // played Nf3" truthfully describes an earlier black move. Adjudicating
    // past tense against legalSans was wrong; only present-tense forms are
    // adjudicated now.
    it("does not flag a past-tense mention of an earlier move ('mallow played Nf3') even though Nf3 is also currently legal", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["Nf3", "Qh5", "e4"], allowedSans: ["Nf3", "Qh5", "e4"] });
      const result = validateChat("mallow played Nf3 a few moves back.", facts);
      expect(result.ok).toBe(true);
    });

    // FP class 2: O-O/O-O-O is the same token for both colors, so it can
    // never be adjudicated by legalSans membership alone -- castling tokens
    // are skipped outright.
    it("does not flag a castling mention ('mallow plays O-O') even though castling is also currently legal for the player", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["O-O", "Qh5", "e4"], allowedSans: ["O-O", "Qh5", "e4"] });
      const result = validateChat("mallow plays O-O next.", facts);
      expect(result.ok).toBe(true);
    });

    // FP class 3: the coach reasons in hypothetical lines constantly ("if
    // you play X, she plays Y") -- a conditional marker earlier in the same
    // sentence means the named side is inside a hypothetical, not a literal
    // attribution of the current position.
    it("does not flag a conditional/hypothetical line ('if you push d4, she plays Nc6')", () => {
      const facts = sideAttrFacts({ toMove: "you", legalSans: ["Nc6", "Qh5", "e4"], allowedSans: ["Nc6", "Qh5", "e4"] });
      const result = validateChat("if you push d4, she plays Nc6 next.", facts);
      expect(result.ok).toBe(true);
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

    it("passes a lowercase echo of a legal move once piece-letter case is normalized (Nc6 is legal for black to reply to e4)", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      expect(facts.legalSans).toContain("Nc6");
      const result = validateChat("nc6 develops your knight nicely.", facts);
      expect(result).toEqual({ ok: true });
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
      expect(capturedPrompt).toContain('"level": 3');
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
        "keep it on the board. ask me about a move from this game and i'll break it down."
      );
    });
  });

  // (b), (c), (f), (g), (h)
  describe("GameManager.chat (F16 integration)", () => {
    let gm: GameManager;

    beforeEach(() => {
      // No gm.init() here: chat() never touches this.evaluator (only
      // judgeMove/playerMove do), so the real stockfish/maia engines are
      // never started for these tests. setCoachBackendForTesting is always
      // called before any gm.chat() call below, which short-circuits
      // pickCoachBackend's probe entirely — the real claude CLI is never
      // invoked.
      gm = new GameManager();
    });

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

    it("(c) inventing an unplayed, illegal san regenerates once, then falls back to the redirect template", async () => {
      const gameId = seedGame(["e4"]);
      gm.setCoachBackendForTesting(fakeBackend(async () => "Qxh7 wins the game right now."));

      const result = await gm.chat(gameId, { message: "what should I do next?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("template");
      expect(result.text).toBe(
        "keep it on the board. ask me about a move from this game and i'll break it down."
      );

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].regen_count).toBe(1);
      expect(traces[0].kind).toBe("chat");
    });

    it("(c2) inventing an unplayed, illegal san in LOWERCASE regenerates once, then falls back to the redirect template — the reviewer's probe case", async () => {
      const gameId = seedGame(["e4"]);
      gm.setCoachBackendForTesting(fakeBackend(async () => "qxh7 wins the game right now."));

      const result = await gm.chat(gameId, { message: "what should I do next?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("template");
      expect(result.text).toBe(
        "keep it on the board. ask me about a move from this game and i'll break it down."
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
});
