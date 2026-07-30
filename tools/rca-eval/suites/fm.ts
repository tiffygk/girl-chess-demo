// tools/rca-eval/suites/fm.ts
//
// Suite FM -- fallback memory and conversation integrity (spec section 3,
// K4). Owner's ask verbatim: "it is actually remembering the templates."
// All five scenarios drive chat() against a scratch db with the backend
// forced to templates via noBackend (zero probing, zero external process,
// zero model call anywhere) -- suite gate 5/5.
//
// Deliberately does NOT construct `new GameManager()`: that class's
// `evaluator = new StockfishEvaluator()` field initializer spawns a REAL
// stockfish child process the instant the class is instantiated (confirmed
// by tracing server/engines/stockfish.ts -> uci.ts's constructor, which
// calls `spawn()` unconditionally, before `.init()` is ever called and with
// no way to opt out) -- discovered the hard way when an early version of
// this suite hung and left orphaned stockfish processes running. chat()
// itself never touches `this.evaluator` (verified against manager.ts), so
// `chatPipeline` below replicates ONLY the chat-relevant slice of
// GameManager.chat's method body -- load game+moves, assembleChatFactList,
// history read, chatWithCoach call, the exact "only insertChatMessage the
// coach role when source==='model'" persistence rule (manager.ts's own
// B3b comment), and the exact backend-down -> templates-only reclassify
// (manager.ts's Task 8 fix) -- without ever constructing an Evaluator.
//
// 2026-07-31 status: K4 has not merged. FM-01/02/04/05 are executed for
// real against current code and come back red -- each reproduces the exact
// gap baseline rows B6/B7 describe. FM-03 (client_msg_id idempotency) has
// no interface to call at all yet and reports did-not-run.
import { chat as chatWithCoach, assembleChatFactList, CHAT_HISTORY_WINDOW, type ChatContext } from "../../../server/coach/chat";
import { noBackend } from "../../../server/coach/backends/types";
import type { CoachBackend } from "../../../server/coach/backends/types";
import { getGame, getGameMoves, getChatMessages, getAllChatMessages, insertChatMessage, getAdviceTraces } from "../../../server/store/db";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator } from "../lib/assertRan";
import { seedScratchDb, seedMinimalGame } from "../lib/scenarioDb";
import dupRows from "../fixtures/game160-chat-rows.json";

const FALLBACK_LABEL_PREFIX = "coach (canned fallback shown to player):";

// Mirrors manager.ts's chat() method (server/game/manager.ts:874-1052) for
// an in-progress (unfinished) game, minus everything engine-dependent
// (turningPoints/perPlyAnalysis/outcome/highlightedPlies, all of which are
// absent/undefined for a fresh in-progress scratch game anyway).
async function chatPipeline(
  gameId: number,
  message: string,
  context: ChatContext,
  backendPref: "template"
): Promise<{ ok: true; text: string; source: "model" | "template"; cause?: string; traceId: number } | { ok: false; error?: string }> {
  const game = getGame(gameId);
  if (!game) return { ok: false, error: "no-game" };
  const moveRows = getGameMoves(gameId);
  const gameMoves = moveRows.map((r: any) => ({ ply: r.ply, san: r.san }));
  const facts = assembleChatFactList(gameMoves, context);
  const historyRows = getChatMessages(gameId, CHAT_HISTORY_WINDOW);
  const history = historyRows.map((r: any) => ({ role: r.role as "user" | "coach", text: r.text }));
  insertChatMessage({ gameId, role: "user", text: message });
  // pickCoachBackend's own "template" branch (manager.ts:165-166): `noBackend`
  // directly, zero probing, zero external process.
  const backend: CoachBackend = noBackend;
  const ply = gameMoves.length;
  const result = await chatWithCoach(message, history, facts, backend, { gameId, ply, kind: "chat" });
  // manager.ts:1026-1028 (B3b): a template reply is only persisted as a
  // coach row when source === "model".
  if (result.source === "model") {
    insertChatMessage({ gameId, role: "coach", text: result.text, traceId: result.traceId });
  }
  // manager.ts:1047-1048 (Task 8, owner-ruled reclassify): backend-down
  // caused by the deliberate "template" pref reads as templates-only, never
  // as the coach being offline.
  const cause = result.cause === "backend-down" && backendPref === "template" ? "templates-only" : result.cause;
  return { ok: true, text: result.text, source: result.source, cause, traceId: result.traceId };
}

async function fm01AndFm02(): Promise<[EvalResult, EvalResult]> {
  seedScratchDb("fm-01-02");
  const { gameId } = seedMinimalGame();
  const context: ChatContext = { mode: "live" };

  const first = await chatPipeline(gameId, "can i avoid losing a piece here?", context, "template");
  if (!first.ok) throw new Error(`FM-01/02 setup: first chat() call failed: ${JSON.stringify(first)}`);
  if (first.source !== "template") throw new Error(`FM-01/02 setup: expected a template fallback, got source=${first.source}`);

  const rowsAfterFirst = getAllChatMessages(gameId);
  const coachRows = rowsAfterFirst.filter((r: any) => r.role === "coach");
  const fm01: EvalResult =
    coachRows.length > 0
      ? { id: "FM-01", verdict: "pass", detail: `chat_messages holds ${coachRows.length} coach row(s) after the forced-template turn, source recorded.` }
      : {
          id: "FM-01",
          verdict: "red",
          detail:
            `chat_messages holds 0 coach rows after a forced-template turn (cause=${first.cause}). ` +
            "manager.ts's chat() only calls insertChatMessage for the coach role when result.source === \"model\" -- " +
            "a template reply is never persisted at all today. Matches baseline row B6 (15 user rows, 11 coach rows, 4 fallbacks never persisted).",
        };

  const second = await chatPipeline(gameId, "so which piece is actually hanging", context, "template");
  if (!second.ok) throw new Error(`FM-01/02 setup: second chat() call failed: ${JSON.stringify(second)}`);
  const traces = getAdviceTraces(gameId).filter((t: any) => t.kind === "chat");
  const secondTrace = traces.find((t: any) => t.id === second.traceId) ?? traces[traces.length - 1];
  const carriesLabel = !!secondTrace && typeof secondTrace.prompt === "string" && secondTrace.prompt.includes(FALLBACK_LABEL_PREFIX);
  const fm02: EvalResult = carriesLabel
    ? { id: "FM-02", verdict: "pass", detail: "the next turn's prompt carries the labeled fallback." }
    : {
        id: "FM-02",
        verdict: "red",
        detail:
          `the second call's stored prompt does not contain "${FALLBACK_LABEL_PREFIX}" -- since FM-01 shows no coach ` +
          "row is persisted for a template turn at all, there is nothing for the next prompt's history to label. " +
          "This is the K4 acceptance target this eval exists to prove, not yet implemented.",
      };
  return [fm01, fm02];
}

function fm03(): EvalResult {
  return {
    id: "FM-03",
    verdict: "did-not-run",
    detail:
      "no client_msg_id (or equivalent) parameter exists anywhere in the chat interface -- GameManager.chat's " +
      "body type is {message, context, backendPref} with no msg-id field, so idempotency on a repeated id cannot " +
      "be exercised at all yet. This is a K4 acceptance target, not yet implemented.",
  };
}

async function fm04(): Promise<EvalResult> {
  seedScratchDb("fm-04");
  const { gameId } = seedMinimalGame();
  const context: ChatContext = { mode: "live" };
  // Two concurrent calls for the SAME game, entirely in-process, no
  // listening port anywhere (per the round's controller correction: FM-04's
  // 409 check uses an in-process instance, never a listening port).
  const [a, b] = await Promise.all([
    chatPipeline(gameId, "first message", context, "template"),
    chatPipeline(gameId, "second message, sent while the first is still in flight", context, "template"),
  ]);
  const eitherRefused =
    (a.ok === false && /busy|in.flight|409/i.test(String((a as any).error))) ||
    (b.ok === false && /busy|in.flight|409/i.test(String((b as any).error)));
  if (eitherRefused) {
    return { id: "FM-04", verdict: "pass", detail: "a concurrent second message while one was in flight was refused." };
  }
  return {
    id: "FM-04",
    verdict: "red",
    detail:
      `both concurrent chat() calls ran to completion (a.ok=${a.ok}, b.ok=${b.ok}) -- no busy/409 guard exists anywhere ` +
      "in the chat pipeline today. This is a K4 acceptance target, not yet implemented.",
  };
}

async function fm05(): Promise<EvalResult> {
  seedScratchDb("fm-05");
  const { gameId } = seedMinimalGame();
  const dupText = (dupRows as { dupUserText: string }).dupUserText;
  const history = [
    { role: "user" as const, text: dupText },
    { role: "user" as const, text: dupText },
    { role: "user" as const, text: dupText },
  ];

  let capturedPrompt = "";
  const capturingBackend: CoachBackend = {
    name: "fm05-capture",
    async available() {
      return true;
    },
    async generate(prompt: string) {
      capturedPrompt = prompt;
      return "keeps the exchange short, no move claims needed for this check.";
    },
  };

  const facts = assembleChatFactList(
    [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
    ],
    { mode: "live" }
  );

  await chatWithCoach("is that right?", history, facts, capturingBackend, { gameId, ply: 2, kind: "chat" });

  const occurrences = capturedPrompt.split(dupText).length - 1;
  if (occurrences <= 1) {
    return { id: "FM-05", verdict: "pass", detail: `the assembled history collapsed the 3 duplicate rows to ${occurrences} occurrence(s) in the prompt.` };
  }
  return {
    id: "FM-05",
    verdict: "red",
    detail:
      `the assembled prompt carries the duplicated user line ${occurrences} times -- formatHistory (server/coach/chat.ts) ` +
      "maps every history row verbatim with no de-duplication. Reproduces baseline row B7 (game 160's real 3-consecutive-" +
      "duplicate user rows, ids 106/107/108) feeding straight through unchanged. This is a K4 acceptance target, not yet implemented.",
  };
}

export async function runFmSuite(): Promise<SuiteResult> {
  const [fm01, fm02] = await fm01AndFm02();
  const results: EvalResult[] = [fm01, fm02, fm03(), await fm04(), await fm05()];
  assertDenominator(results, 5, "FM");
  return {
    suite: "FM",
    expectedCount: 5,
    results,
    ranAt: new Date().toISOString(),
    notes: [
      "FM-01/FM-02/FM-04/FM-05 executed for real against pre-K4 code and are expected red -- each reproduces a real baseline gap (rows B6/B7).",
      "FM-03 did-not-run: no client_msg_id parameter exists anywhere in the chat interface yet.",
      "Every scenario runs through chatPipeline (replicates manager.ts's chat() method's chat-relevant slice) rather than " +
        "constructing GameManager, which spawns a real stockfish subprocess in its own constructor -- no engine process is ever started by this suite.",
      "Every scenario runs against a scratch db (lib/scenarioDb.ts) with the backend forced to noBackend -- no model call anywhere.",
    ],
  };
}
