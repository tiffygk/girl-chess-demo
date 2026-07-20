import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import type { Evaluation, Evaluator } from "../engines/types";
import { StockfishEvaluator } from "../engines/stockfish";
import { classifyMove, ADVICE_LEVELS, DEFAULT_ADVICE_LEVEL } from "./classify";

// Task 6 (judge strictness dial, F10 tuning): a mocked evaluator per
// existing classify.test patterns (see adjudicate.test.ts's MockEvaluator)
// — a real-engine fixture that lands on an exact, known eval delta at a
// chosen position is impractical, so this pins the eval-delta math to a
// controlled, deterministic value and only varies `level`. classifyMove
// calls evaluator.evaluate() exactly twice per verdict via Promise.all,
// before-position first — the two evaluate() calls happen synchronously in
// that order even though both promises resolve concurrently, so the first
// call's return is deterministically the before-eval and the second the
// after-eval. This mock returns the requested deltaCp (mover's
// perspective, "objectively best") on the first call and a flat 0 (the
// opponent's reported perspective, negated to 0 by classifyMove) on the
// second — so bestEvalCp - actualEvalCp == deltaCp exactly, regardless of
// which fen is passed.
class FixedDeltaEvaluator implements Evaluator {
  private calls = 0;
  constructor(private deltaCp: number) {}
  async init() {}
  async evaluate(_fen: string, _movetimeMs?: number): Promise<Evaluation> {
    this.calls += 1;
    return this.calls === 1
      ? { cp: this.deltaCp, mate: null, bestMove: "e2e4", pv: [] }
      : { cp: 0, mate: null, bestMove: "e7e5", pv: [] };
  }
  quit() {}
}

describe("classify.ts LLM-free gate", () => {
  // HARD CONSTRAINT (PRD gate, verbatim): the verdict path makes no LLM
  // call, ever — it is engine math only. This pins that constraint for C1's
  // stub and every later increment that fills classifyMove in: a plain
  // source-scan of the import lines is enough, and stays valid even before
  // server/coach/ exists (increment 3).
  it("never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "classify.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });

  // C4, inherited gap #3 (increment-1 review, verbatim): the gate above only
  // ever scanned classify.ts itself. server/game/manager.ts's judgeMove is
  // the other half of the verdict path (it clones the live game and calls
  // classifyMove) — extend the same source-scan there so a future edit
  // can't quietly reintroduce a coach import on that side of the seam.
  //
  // Increment 3a Wave 2 (coach foundation): manager.ts's TOP LEVEL now does
  // import from server/coach — the file also owns the separate async
  // narrate() surface (see manager.ts's own header comment on that method).
  // The invariant that actually matters, per the brief's hard boundary, is
  // narrower than "this file never imports coach": it's "judgeMove itself
  // never touches coach". So this gate now scopes its scan to judgeMove's
  // own method body (from its signature to the next method declaration)
  // rather than the whole file, and checks for any "coach" reference at all
  // (not just import lines) since a body could reach it via a re-export
  // without a literal `from ".../coach"` import line.
  // Increment 3a review fast-follow (F1): a plain /coach/i scan on the body
  // is only as strong as the assumption that every reference spells the
  // word "coach" somewhere — manager.ts's own top-level import proves that
  // false: `import { assembleFactList, narrate as narrateFacts } from
  // "../coach"` binds the local identifiers `assembleFactList` and
  // `narrateFacts`, neither of which contains the substring "coach". A
  // judgeMove body that called `narrateFacts(...)` or `assembleFactList(...)`
  // directly would slip straight past the /coach/i check below without
  // ever tripping it — verified by injection during this fix. So the gate
  // now also parses that import line's local identifiers (post-`as` alias
  // when present) and asserts none of them appear anywhere in judgeMove's
  // body, on top of the original /coach/i scan. This stays correct even if
  // server/coach grows new exports later, since the identifier list is
  // read from the live import line rather than hardcoded.
  it("server/game/manager.ts's judgeMove method never references server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "../game/manager.ts"), "utf-8");
    const start = src.indexOf("async judgeMove(");
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + "async judgeMove(".length);
    const nextMethodMatch = /\n {2}(?:async |private |public )?[A-Za-z_$][\w$]*\s*\(/.exec(rest);
    const body = nextMethodMatch ? rest.slice(0, nextMethodMatch.index) : rest;
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/coach/i);

    const importLine = src.split("\n").find((line) => /from\s+["']\.\.?\/coach["']/.test(line));
    expect(importLine).toBeTruthy();
    const specifierMatch = /import\s*\{([^}]+)\}/.exec(importLine!);
    expect(specifierMatch).toBeTruthy();
    const localIdentifiers = specifierMatch![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const asMatch = /^\S+\s+as\s+(\S+)$/.exec(s);
        return asMatch ? asMatch[1] : s;
      });
    expect(localIdentifiers.length).toBeGreaterThan(0);
    expect(localIdentifiers).toEqual(expect.arrayContaining(["assembleFactList", "narrateFacts"]));

    for (const id of localIdentifiers) {
      expect(body).not.toMatch(new RegExp(`\\b${id}\\b`));
    }
  });

  // Fix wave (code review, verbatim intent): adjudicate.ts carries the same
  // "engine math only, no LLM call, ever" hard constraint (see its own
  // header comment) as classify.ts and manager.ts's judge path above — the
  // same source-scan gate belongs here too so a future edit can't quietly
  // reintroduce a coach import on the adjudication seam either.
  it("adjudicate.ts never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "adjudicate.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });

  // Increment 2.7: motifs.ts is the other half of the why-hints verdict
  // path (classifyMove calls deriveThreatFacts from it) — same hard
  // constraint, same gate.
  it("motifs.ts never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "motifs.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });

  // Increment 3b: turningPoints.ts + classifications.ts read STORED evals
  // only (never touch the live evaluator or coach) — same hard constraint,
  // same gate.
  it("turningPoints.ts never imports from server/coach", () => {
    // Self-contained (no imports at all — pure math over the moves array
    // callers pass in), so there's nothing to require importLines.length
    // > 0 for, unlike the other files in this gate.
    const src = fs.readFileSync(path.join(__dirname, "turningPoints.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });

  it("classifications.ts never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "classifications.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });
});

describe("ADVICE_LEVELS seam", () => {
  it("has a standard default level with the brief's starting thresholds", () => {
    expect(DEFAULT_ADVICE_LEVEL).toBe("standard");
    expect(ADVICE_LEVELS[DEFAULT_ADVICE_LEVEL]).toEqual({ nudgeCp: 60, warningCp: 150 });
  });

  // Task 6 (judge strictness dial, F10 tuning): gentle/blunt gain the
  // brief's owner-calibratable starting values (panel A6, verbatim).
  it("has gentle and blunt levels with the brief's starting thresholds", () => {
    expect(ADVICE_LEVELS.gentle).toEqual({ nudgeCp: 90, warningCp: 200 });
    expect(ADVICE_LEVELS.blunt).toEqual({ nudgeCp: 40, warningCp: 110 });
  });
});

// Task 6 (judge strictness dial, F10 tuning): classifyMove's new `level`
// param threads straight into the ADVICE_LEVELS lookup that decides
// tier. Note on the brief's "a fixed 100cp delta is silent at gentle,
// nudge at standard, warning at blunt": under the brief's own locked
// threshold values (gentle 90/200, standard 60/150, blunt 40/110) a
// single 100cp delta actually lands in "nudge" at all three levels (100
// is >= every nudgeCp and < every warningCp) — silent-at-gentle requires
// delta < 90, and warning-at-blunt requires delta >= 110, which no single
// delta can satisfy simultaneously. So this exercises the same intent
// (silent at gentle / nudge at standard / warning at blunt) with three
// deltas chosen to land in each level's respective band, all still in the
// same ~100cp neighborhood the brief describes, plus a same-delta
// same-level control between the standard and default-omitted cases.
describe("classifyMove — judge strictness dial (Task 6, mocked evaluator)", () => {
  it("an 80cp delta is silent at gentle (below gentle's 90cp nudge threshold)", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(80), "gentle");
    expect(verdict.tier).toBe("silent");
  });

  it("a 100cp delta is a nudge at standard (in standard's [60,150) nudge band)", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(100), "standard");
    expect(verdict.tier).toBe("nudge");
  });

  it("a 120cp delta is a warning at blunt (at/above blunt's 110cp warning threshold)", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(120), "blunt");
    expect(verdict.tier).toBe("warning");
  });

  it("the same 100cp delta that nudges at standard also nudges when level is omitted (defaults to standard)", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(100));
    expect(verdict.tier).toBe("nudge");
  });

  it("an unrecognized level falls back to standard rather than throwing", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(100), "not-a-real-level");
    expect(verdict.tier).toBe("nudge"); // standard: nudgeCp=60, warningCp=150
  });
});

describe("classifyMove — real engine math", () => {
  const sf = new StockfishEvaluator();
  beforeAll(async () => {
    await sf.init();
  }, 20000);
  afterAll(() => sf.quit());

  it("hangs the queen for free -> warning, with a big positive delta", async () => {
    // White King g6... no: King e1, Queen a1; Black King e8, Knight b4.
    // Nb4 doesn't attack a1, so the queen is safe before the move. Qa1-a2
    // walks it onto a square the knight *does* attack (b4 -> a2), and
    // nothing defends a2, so Black just wins the queen for free.
    const chess = new Chess("4k3/8/8/8/1n6/8/8/Q3K3 w - - 0 1");
    const move = chess.move({ from: "a1", to: "a2" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.mateAgainst).toBe(false);
    expect(verdict.deltaCp).not.toBeNull();
    expect(verdict.deltaCp!).toBeGreaterThan(150);
  }, 15000);

  // Wave 1 (increment 2.7, why-hints): a warning-tier judged move also gets
  // threat facts, derived from the SAME afterEval this function already
  // computes — no third eval call. The refutation must be legal on the
  // after-position (the position `chess` is already in once the move is
  // applied).
  it("attaches threat facts on a warning-tier move, with a legal refutation on the after-position", async () => {
    const chess = new Chess("4k3/8/8/8/1n6/8/8/Q3K3 w - - 0 1");
    const move = chess.move({ from: "a1", to: "a2" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.threat).toBeTruthy();
    expect(verdict.threat!.refutationUci).toMatch(/^[a-h][1-8][a-h][1-8][nbrq]?$/);
    const probe = new Chess(chess.fen());
    const from = verdict.threat!.refutationUci.slice(0, 2);
    const to = verdict.threat!.refutationUci.slice(2, 4);
    expect(() => probe.move({ from, to, promotion: "q" })).not.toThrow();
  }, 15000);

  it("a quiet developing move at startpos -> silent", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("a move that allows forced mate against the mover -> warning + mateAgainst", async () => {
    // Fool's mate setup: after 1.f3 e5 2.g4??, Black has Qh4# next move —
    // g4 itself isn't check or mate, but it hands Black a forced mate.
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    const move = setup.move("g4");
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.mateAgainst).toBe(true);
  }, 15000);

  it("a move that is itself checkmate -> silent (never warn on a winning move)", async () => {
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    setup.move("g4");
    const move = setup.move("Qh4"); // Qh4#
    expect(setup.isCheckmate()).toBe(true);
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("a move that leaves the opponent walking into forced mate -> silent (mate FOR the mover)", async () => {
    // White King g6, Rook b2, Black King h8 (cornered, only flight square
    // g8 — g7/h7 are covered by the White king). Rb2-b6 is a quiet lift,
    // not check: it forces ...Kg8, after which Rb8# is mate. So after this
    // move, Black (to move) is walking into a forced mate.
    const setup = new Chess("7k/8/6K1/8/8/8/1R6/8 w - - 0 1");
    const move = setup.move({ from: "b2", to: "b6" });
    expect(setup.isCheckmate()).toBe(false);
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("never mutates the passed chess instance", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const fenBefore = chess.fen();
    await classifyMove(chess, move, sf);
    expect(chess.fen()).toBe(fenBefore);
  }, 15000);

  // Wave C, task C-B: the hint-escalation facts, derived from the SAME
  // before-position eval this function already runs — no third eval call.
  it("attaches facts (bestUci/bestSan/bestPieceKind/bestToSquare) derived from the before-position eval", async () => {
    const chess = new Chess("4k3/8/8/8/1n6/8/8/Q3K3 w - - 0 1");
    const move = chess.move({ from: "a1", to: "a2" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.facts).toBeTruthy();
    expect(verdict.facts!.bestUci).toMatch(/^[a-h][1-8][a-h][1-8][nbrq]?$/);
    expect(verdict.facts!.bestSan.length).toBeGreaterThan(0);
    expect(["p", "n", "b", "r", "q", "k"]).toContain(verdict.facts!.bestPieceKind);
    expect(verdict.facts!.bestToSquare).toBe(verdict.facts!.bestUci.slice(2, 4));
  }, 15000);

  it("omits facts on a checkmating move (short-circuited before any eval ever runs)", async () => {
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    setup.move("g4");
    const move = setup.move("Qh4"); // Qh4#
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.facts).toBeUndefined();
  }, 15000);
});
