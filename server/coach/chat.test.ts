import { describe, it, expect, beforeEach } from "vitest";
import { Chess } from "chess.js";
import {
  openDb, createSession, createGame, recordMove, finishGame,
  getAdviceTraces, getAllChatMessages, insertChatMessage,
} from "../store/db";
import {
  assembleChatFactList, validateChat, chat, CHAT_HISTORY_WINDOW, CHAT_MAX_LEN,
} from "./chat";
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
        "let's keep it on the board. ask me about a move from this game and i'll break it down."
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
        "let's keep it on the board. ask me about a move from this game and i'll break it down."
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
        "let's keep it on the board. ask me about a move from this game and i'll break it down."
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
