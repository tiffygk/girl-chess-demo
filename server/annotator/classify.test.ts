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
  // Wave 1 (verdict truth layer, free-material engine-corroboration guard):
  // this fixture used to assert a NUDGE here -- a decided-won position
  // (beforeEval.cp=500) where her quiet knight move hangs the knight to an
  // undefended rook, with the deltaCp math DELIBERATELY tuned below nudgeCp
  // (500 - 450 = 50 < 60). Under the game-164 guard that is now WRONG: the
  // one-ply free-material scan may never out-vote the engine's own delta. If
  // the engine says the move loses less than a nudge's worth (deltaCp 50 <
  // nudgeCp 60), the "giveaway" is compensated somewhere in the line the
  // scan can't see (game 164's Nf6+ gxf6 Bxa8 is the live incident this
  // exists to fix -- see the regression test below), so the "for nothing"
  // copy would be false and the branch must stay SILENT. The free-material
  // nudge only fires WITH engine corroboration (deltaCp >= nudgeCp) -- see
  // the sibling test immediately below, which keeps that honest case alive.
  it("decided-won position, quiet move hangs a knight but engine delta is below nudgeCp -> SILENT (engine out-votes the one-ply scan)", async () => {
    const chess = new Chess("3rk3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet, not a capture
    const evaluator = new ScriptedEvaluator(
      { cp: 500, mate: null, bestMove: "e1e2", pv: [] }, // beforeEval: decided-won, |cp| >= 300
      { cp: -450, mate: null, bestMove: "d8d5", pv: [] } // afterEval: Rxd5 undefended, deltaCp 50 < nudgeCp
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.deltaCp).toBe(50); // below nudgeCp(60): the engine says this is compensated
    expect(verdict.tier).toBe("silent");
    expect(verdict.conversionCopy).toBeUndefined();
  });

  // Wave 1 sibling: the SAME free-material shape (decided position, quiet
  // knight move, undefended rook recapture), but now the engine's own delta
  // corroborates the loss (deltaCp 70 >= nudgeCp 60). The guard must not kill
  // the honest case -- with engine corroboration the free-material nudge
  // still fires, still carrying the "for nothing" copy.
  it("decided-won position, quiet move hangs a knight AND engine delta >= nudgeCp -> nudge, copy says 'for nothing'", async () => {
    const chess = new Chess("3rk3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet, not a capture
    const evaluator = new ScriptedEvaluator(
      { cp: 500, mate: null, bestMove: "e1e2", pv: [] }, // beforeEval: decided-won
      { cp: -430, mate: null, bestMove: "d8d5", pv: [] } // afterEval: Rxd5 undefended, deltaCp 70 >= nudgeCp
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.deltaCp).toBe(70); // at/above nudgeCp(60): engine corroborates the giveaway
    expect(verdict.tier).toBe("nudge");
    expect(verdict.conversionCopy).toBeDefined();
    expect(verdict.conversionCopy).toContain("for nothing");
    expect(verdict.conversionCopy).toContain("knight");
  });

  // Wave 1 regression, the live incident this whole guard exists for (game
  // 164): the player previewed Nf6+ -- the engine's OWN best move, a sound
  // exchange-winning sacrifice (Nf6+ gxf6 Bxa8, deltaCp ~= 0) -- and got a
  // "you sure?" nudge claiming she "gives back your knight for nothing." The
  // one-ply free-material scan sees the knight recaptured on f6 with no
  // recapture available and cries giveaway; it never consults the engine's
  // own delta, which says the position is unchanged (the rook comes off next
  // move). Scripted here from the incident: beforeEval +490 (bestMove Nf6+),
  // afterEval -490 opponent-perspective (bestMove gxf6, the recapture) --
  // decided=true, deltaCp ~= 0, threat capture-moved on her just-moved
  // knight with capturedSquareDefended=false. The engine out-votes the scan:
  // deltaCp 0 < nudgeCp 60 => SILENT, never the false "for nothing" nudge.
  it("game 164 regression: Nf6+ (the engine's own best move, a sound exchange sac, deltaCp ~0) -> silent, never 'for nothing'", async () => {
    const chess = new Chess("r1b2rk1/2p2pp1/1p5p/p3n3/2P1N3/1N1P1B1P/P4PP1/1R3RK1 w - - 2 21");
    const move = chess.move({ from: "e4", to: "f6" }); // Nf6+, the engine's own best move
    const evaluator = new ScriptedEvaluator(
      { cp: 490, mate: null, bestMove: "e4f6", pv: [] }, // beforeEval: +490, Nf6+ is best
      { cp: -490, mate: null, bestMove: "g7f6", pv: [] } // afterEval (opp perspective): -490, gxf6 recapture
    );
    const verdict = await classifyMove(chess, move, evaluator);
    // Sanity: this really is the free-material SHAPE the guard must override.
    expect(verdict.threat?.motif).toBe("capture-moved");
    expect(verdict.threat?.capturesHerJustMovedPiece).toBe(true);
    expect(verdict.threat?.capturedSquareDefended).toBe(false);
    expect(verdict.deltaCp).toBe(0); // engine: the sac is fully compensated in the line
    expect(verdict.tier).toBe("silent");
    expect(verdict.conversionCopy).toBeUndefined();
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

  // Union review fix (H4, 2026-07-31): `decided` used Math.abs(beforeEval.cp)
  // >= DECIDED_BAND_CP, which is SIGN-BLIND -- a position she is decidedly
  // LOSING (cp -500) counted as "decided" exactly like a position she is
  // decidedly winning, so the free-material branch's hardcoded copy ("still
  // winning, but that gives back your {piece} for nothing.") could fire
  // while she is down 500cp. Same board/move as the "decided-won" fixture
  // above (fixture (a)), signs flipped: beforeEval.cp is now NEGATIVE
  // (-500, decidedly LOSING) and afterEval is tuned so deltaCp stays under
  // nudgeCp (mirroring fixture (a)'s exact saturated-eval shape), so this is
  // reachable ONLY through the same last-else-if free-material branch
  // fixture (a) exercises -- proving the fix, not a different code path. A
  // wrong (unfixed) implementation answers "nudge" with "still winning..."
  // here; the fixed one must never say she's winning while beforeEval.cp is
  // negative -- visibly different, not a coincidental match.
  it("decided-LOSING position (cp -500), quiet move hangs a knight for nothing -> never claims 'still winning'", async () => {
    const chess = new Chess("3rk3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet, not a capture
    const evaluator = new ScriptedEvaluator(
      { cp: -500, mate: null, bestMove: "e1e2", pv: [] }, // beforeEval: decided-LOSING, cp < -DECIDED_BAND_CP
      { cp: 450, mate: null, bestMove: "d8d5", pv: [] } // afterEval: Rxd5, deltaCp stays small (saturated-eval shape)
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.deltaCp).toBeLessThan(60); // confirms this is NOT reachable via the ordinary nudgeCp path
    expect(verdict.tier).toBe("silent"); // decided must now mean "decided FOR her", not "decided at all"
    expect(verdict.conversionCopy).toBeUndefined(); // never "still winning" while beforeEval.cp is negative
  });

  // Union review fix (M4, 2026-07-31): conversionCopyFor's "lost-mate"
  // branch was unreachable dead code -- its only call site required
  // mateForMover (afterEval.mate !== null), but conversionForMove only ever
  // returns "lost-mate" when afterMate IS null. She holds mate-in-5, plays a
  // quiet move that lets the mate reading vanish entirely (afterEval.mate:
  // null) -- the huge MATE_SCORE_CP-backed deltaCp routes this to "warning"
  // via the ordinary mateAgainst/deltaCp path, not the mateForMover branch.
  // A wrong (unfixed) implementation answers "warning" with NO
  // conversionCopy (the generic "careful, this one hurts" badge and nothing
  // else); the fix must thread the real "the forced mate is gone for now"
  // story into the tier that's actually reachable.
  //
  // Wave 1 (verdict truth layer, item 2 -- typed mate): the routing is now
  // EXPLICIT rather than an accident of the MATE_SCORE_CP fold. The warning
  // branch fires on the typed condition `mateBefore > 0 && !mateForMover` --
  // she HELD a mate and the move lost it -- independent of the folded
  // deltaCp's magnitude. This test additionally pins the two new typed
  // fields: mateBefore carries the held mate distance (5, mover perspective),
  // mateAfter is null (the reading vanished), and the copy still lands.
  it("losing a held mate entirely -> warning via the typed mateBefore>0 && !mateForMover condition, STILL carries the lost-mate copy", async () => {
    const chess = new Chess("4k3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet
    const evaluator = new ScriptedEvaluator(
      { cp: 0, mate: 5, bestMove: "e1e2", pv: [] }, // beforeEval: mate-in-5 held
      { cp: 500, mate: null, bestMove: "e8d8", pv: [] } // afterEval: the mate reading is GONE
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.mateBefore).toBe(5); // she held mate-in-5 (mover perspective)
    expect(verdict.mateAfter).toBeNull(); // the reading is gone -> typed as null, not folded into a 99098 delta
    expect(verdict.tier).toBe("warning"); // fires via the typed lost-mate condition
    expect(verdict.conversionCopy).toBe("still winning, but the forced mate is gone for now.");
  });
});

// Wave 1 (verdict truth layer, item 2 -- typed mate): the Verdict now carries
// mateBefore/mateAfter, BOTH from the mover's perspective, so lost-mate
// routing and the coach prompt stop depending on the MATE_SCORE_CP fold
// (toMoverCp turns a lost mate-in-16 into deltaCp 99098). These pin the two
// fields against the existing mateAgainst/mateForMover derivations they must
// agree with (mateAgainst <=> mateAfter < 0; mateForMover <=> mateAfter > 0).
describe("classifyMove — typed mate fields (Wave 1, item 2)", () => {
  it("mateBefore = beforeEval.mate; mateAfter negates the opponent-perspective afterEval.mate (mate held for her)", async () => {
    const chess = new Chess("4k3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" }); // Nd5, quiet, keeps the mate on schedule
    const evaluator = new ScriptedEvaluator(
      { cp: 0, mate: 2, bestMove: "e1e2", pv: [] }, // beforeEval (mover perspective): mate-in-2
      { cp: 0, mate: -1, bestMove: "e8d8", pv: [] } // afterEval (opponent perspective): mated-in-1 -> still HER mate
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.mateBefore).toBe(2);
    expect(verdict.mateAfter).toBe(1); // -(-1): a mate FOR the mover, positive
    expect(verdict.mateAfter! > 0).toBe(true);
    expect(verdict.mateAgainst).toBe(false); // mateAfter > 0 <=> mateForMover, not against
  });

  it("mateAfter is negative when the move hands the opponent a forced mate (agrees with mateAgainst)", async () => {
    const chess = new Chess("4k3/8/8/8/8/2N5/8/4K3 w - - 0 1");
    const move = chess.move({ from: "c3", to: "d5" });
    const evaluator = new ScriptedEvaluator(
      { cp: 0, mate: null, bestMove: "e1e2", pv: [] }, // beforeEval: no mate before
      { cp: 0, mate: 3, bestMove: "e8d8", pv: [] } // afterEval (opponent to move): opponent mates in 3 -> against her
    );
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.mateBefore).toBeNull();
    expect(verdict.mateAfter).toBe(-3); // -(3): a mate AGAINST the mover, negative
    expect(verdict.mateAgainst).toBe(true); // mateAfter < 0 <=> mateAgainst
    expect(verdict.tier).toBe("warning");
  });

  it("both fields are null on an ordinary non-mate position", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, new FixedDeltaEvaluator(100));
    expect(verdict.mateBefore).toBeNull();
    expect(verdict.mateAfter).toBeNull();
  });

  it("the checkmate short-circuit also carries the (null) typed mate fields", async () => {
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    setup.move("g4");
    const move = setup.move("Qh4"); // Qh4#
    expect(setup.isCheckmate()).toBe(true);
    const verdict = await classifyMove(setup, move, new FixedDeltaEvaluator(0));
    expect(verdict.mateBefore).toBeNull();
    expect(verdict.mateAfter).toBeNull();
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
