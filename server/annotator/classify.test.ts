import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import type { Evaluation, Evaluator } from "../engines/types";
import { StockfishEvaluator } from "../engines/stockfish";
import { classifyMove, ADVICE_LEVELS, DEFAULT_ADVICE_LEVEL, isAdviceLevel } from "./classify";

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

  // Fix (task-reviewer, post Task 6 approval — Critical): "constructor" (and
  // "toString"/"valueOf"/"__proto__"/etc.) is an Object.prototype-colliding
  // string. A naive `ADVICE_LEVELS[level]` bracket lookup resolves this to
  // the inherited Object constructor function — truthy, so a plain
  // `level && ADVICE_LEVELS[level]` truthy check (the pre-fix bug) treats it
  // as a "recognized" level, then destructuring `{ nudgeCp, warningCp }`
  // from a function yields undefined for both, every `deltaCp >= threshold`
  // comparison is false, and every verdict silently becomes "silent" — a
  // hung queen reports silent. isAdviceLevel's explicit literal allowlist
  // must reject this and fall back to standard: proven here by a 120cp
  // delta, which standard's real thresholds (nudgeCp:60, warningCp:150)
  // classify as "nudge", not "silent".
  it("an Object.prototype-colliding level ('constructor') falls back to standard, not to garbage thresholds", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(120), "constructor");
    expect(verdict.tier).toBe("nudge");
  });
});

describe("isAdviceLevel", () => {
  it("accepts exactly the three real ADVICE_LEVELS keys", () => {
    expect(isAdviceLevel("gentle")).toBe(true);
    expect(isAdviceLevel("standard")).toBe(true);
    expect(isAdviceLevel("blunt")).toBe(true);
  });

  // The exact bug class this guard exists to close: these are all "truthy"
  // under a plain ADVICE_LEVELS[x] bracket lookup (they resolve to real,
  // inherited Object.prototype members) despite never being assigned keys.
  it("rejects Object.prototype-colliding strings", () => {
    expect(isAdviceLevel("constructor")).toBe(false);
    expect(isAdviceLevel("toString")).toBe(false);
    expect(isAdviceLevel("valueOf")).toBe(false);
    expect(isAdviceLevel("__proto__")).toBe(false);
    expect(isAdviceLevel("hasOwnProperty")).toBe(false);
  });

  it("rejects other unrecognized strings and non-strings", () => {
    expect(isAdviceLevel("not-a-real-level")).toBe(false);
    expect(isAdviceLevel(undefined)).toBe(false);
    expect(isAdviceLevel(null)).toBe(false);
    expect(isAdviceLevel(123)).toBe(false);
  });
});

// Task K2 (conversion-aware judge, context-v2-changes-and-contract.md
// section 2, owner ruling 1): a mocked evaluator that scripts BOTH
// classifyMove calls independently (unlike FixedDeltaEvaluator above, which
// only controls a single deltaCp derived from a flat cp pair) -- these
// tests need to control mate/bestMove on each call separately, since the
// whole point is exercising the mate-distance and free-material paths that
// FixedDeltaEvaluator's shape cannot express at all.
class ScriptedEvaluator implements Evaluator {
  private calls = 0;
  constructor(
    private beforeEval: Evaluation,
    private afterEval: Evaluation
  ) {}
  async init() {}
  async evaluate(_fen: string, _movetimeMs?: number): Promise<Evaluation> {
    this.calls += 1;
    return this.calls === 1 ? this.beforeEval : this.afterEval;
  }
  quit() {}
}

describe("classifyMove — decided-position conversion (Task K2)", () => {
  // Discriminating fixture (a): a decided-won position (beforeEval.cp=500,
  // no mate) where her quiet (non-capturing) knight move hangs the knight
  // to the black rook, undefended. The deltaCp math alone is DELIBERATELY
  // tuned to stay below nudgeCp (500 - 450 = 50 < 60) -- this is the exact
  // saturated-eval shape the round exists to fix: raw cp delta stays small
  // once a position is already decided, even though a whole piece just
  // went for nothing. A wrong implementation that never adds the
  // free-material check answers "silent" here (the CLAUDE.md-recorded bug);
  // a correct one answers "nudge" with "for nothing" in the copy -- the two
  // answers are visibly different, not a coincidental match.
  it("decided-won position, quiet move hangs a knight for nothing -> nudge, copy says 'for nothing'", async () => {
    const chess = new Chess("3rk3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet, not a capture
    const evaluator = new ScriptedEvaluator(
      { cp: 500, mate: null, bestMove: "e1e2", pv: [] }, // beforeEval: decided-won, |cp| >= 300
      { cp: -450, mate: null, bestMove: "d8d5", pv: [] } // afterEval: Rxd5 undefended, still ~decided
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.tier).toBe("nudge");
    expect(verdict.deltaCp).toBe(50); // confirms this is NOT reachable via the existing nudgeCp(60) path
    expect(verdict.conversionCopy).toBeDefined();
    expect(verdict.conversionCopy).toContain("for nothing");
    expect(verdict.conversionCopy).toContain("knight");
  });

  // Discriminating fixture (b): she holds mate-in-2 before her move; her
  // quiet move keeps the mate but lets it slip all the way to mate-in-9.
  // Under the OLD code, `mateForMover` alone short-circuits straight to
  // "silent" regardless of how much the mate distance slipped -- so a wrong
  // implementation (this exact branch, unfixed) answers "silent"; the
  // correct one routes through conversionForMove and answers "nudge",
  // naming both the held and the new mate distance in the copy.
  it("mate-in-2 held, played move leaves mate-in-9 -> nudge naming the faster finish", async () => {
    const chess = new Chess("4k3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet
    const evaluator = new ScriptedEvaluator(
      { cp: 0, mate: 2, bestMove: "e1e2", pv: [] }, // beforeEval: mate-in-2 held
      { cp: 0, mate: -9, bestMove: "e8d8", pv: [] } // afterEval: opponent to move, mated in 9 (still hers, just slower)
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.tier).toBe("nudge");
    expect(verdict.mateAgainst).toBe(false); // still her mate -- never misreport this as against her
    expect(verdict.conversionCopy).toBeDefined();
    expect(verdict.conversionCopy).toContain("mate in 2");
    expect(verdict.conversionCopy).toContain("mate in 9");
  });

  // Discriminating fixture (c): the same mate-in-2 setup, but this time the
  // quiet move keeps the mate exactly on schedule (mate-in-2 -> mate-in-1,
  // slip 0) and the opponent's best reply is not a capture of her
  // just-moved piece either. This must stay silent -- proving the fix
  // doesn't turn every decided position into noise (which would be worse
  // than the original silence). A wrong implementation that nudges on ANY
  // decided mateForMover position (ignoring the slip magnitude entirely)
  // fails this one specifically.
  it("mate-in-2 held, played move keeps mate-in-1 on schedule (slip 0) -> stays silent", async () => {
    const chess = new Chess("4k3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet
    const evaluator = new ScriptedEvaluator(
      { cp: 0, mate: 2, bestMove: "e1e2", pv: [] }, // beforeEval: mate-in-2 held
      { cp: 0, mate: -1, bestMove: "e8d8", pv: [] } // afterEval: on schedule, slip 0
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.tier).toBe("silent");
    expect(verdict.conversionCopy).toBeUndefined();
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
    // King + rook vs lone king, White King c6, Rook h2, Black King e8
    // (mate-in-7 per Stockfish). Rh2-h7 IS the engine's own top choice at
    // the before-position (confirmed live: beforeEval.bestMove === "h2h7"),
    // and it keeps the mate distance exactly on schedule (mate-in-7 ->
    // mate-in-6, zero slip) — never check, never a capture. This is Task
    // K2's replacement for the prior fixture here (White King g6, Rook b2,
    // Black King h8, Rb2-b6): that one's own claimed "only flight square
    // g8" was true of the KING alone, but the rook's own attack line along
    // the back rank also covers g8 once it lands there, so Rb2-b8 was
    // actually an immediate mate-in-1 the whole time — meaning Rb6 was a
    // real (if tiny) missed-mate under conversionForMove's own rules
    // (MISSED_MATE_DEPTH gates on ANY slip when the held mate is shallow,
    // by design — see conversion.ts's header), and correctly nudges under
    // the new decided-position logic below. That fixture accidentally
    // tested "does my move choice happen to dodge a hidden faster mate,"
    // not "is an on-schedule mate silent" — this one tests the latter
    // cleanly, by construction (the played move IS the fastest one).
    const setup = new Chess("4k3/8/2K5/8/8/8/7R/8 w - - 0 1");
    const move = setup.move({ from: "h2", to: "h7" });
    expect(setup.isCheckmate()).toBe(false);
    expect(setup.inCheck()).toBe(false);
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
    expect(verdict.conversionCopy).toBeUndefined();
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
