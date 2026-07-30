import { describe, it, expect } from "vitest";
import { assembleChatFactList } from "./chat";
import type { ChatPerPlyInput } from "./chat";
import { phasesForGame } from "../../src/review/gamePhases";
import { debriefBullets } from "../../src/review/debriefBullets";
import type { TurningPoint } from "../../src/game/api";

// The anti-sixth-instance tripwire. This codebase produced FIVE instances
// of duplicated logic; phase was the fifth (phaseForPly in the debrief,
// derivePhase in chat, different fallbacks, both wrong differently on the
// owner's real games). Both are dead; every consumer reads
// src/review/gamePhases. This test replays the same game through the chat
// facts path and the shared timeline and demands identical labels ply by
// ply -- the moment ANY consumer grows a local phase opinion again, this
// goes red. If it is red and you are tempted to fix it by adjusting the
// expectation: the expectation IS the rule.

// Shared with chat.perPly.test.ts's own fixture (same repo convention as
// GAME150_SANS being repeated across files) -- 54 plies, real captures, and
// its old-vs-new phase labels diverge on 13 of those 54 plies (opening vs
// middlegame at plies 18-20, middlegame vs endgame at plies 44-53), so a
// reintroduced local phase opinion has nowhere to hide: this fixture does
// not let old and new algorithms coincidentally agree everywhere.
const LONG_GAME = [
  "f4", "d6", "Nf3", "e6", "h3", "c6", "c4", "Qf6", "f5", "exf5", "h4", "Qxb2",
  "Bxb2", "f6", "Bxf6", "Nxf6", "Nd4", "Ne4", "Nxf5", "Nxd2", "Nxd2", "Bxf5",
  "Kf2", "Na6", "Qa4", "Bb1", "Rxb1", "Rd8", "Qxc6+", "bxc6", "h5", "Kf7",
  "g4", "Nc7", "e3", "Nd5", "cxd5", "cxd5", "Rb7+", "Kg8", "Rxa7", "h6",
  "Rxg7+", "Bxg7", "Bh3", "Kf7", "Rc1", "Rd7", "Re1", "Ra8", "g5", "Rxa2",
  "gxh6", "Bxh6",
];
const moves = LONG_GAME.map((san, i) => ({ ply: i + 1, san }));

describe("phase parity: chat's perPlyAnalysis vs the shared timeline", () => {
  it("every ply's phase served to the coach matches phasesForGame's phaseAt for the same ply", () => {
    const perPly: ChatPerPlyInput[] = moves.map((m) => ({
      ply: m.ply,
      san: m.san,
      evalCp: 0,
      evalMate: null,
      bestSan: null,
      pvSans: [],
    }));
    const facts = assembleChatFactList(moves, {}, undefined, perPly);
    const timeline = phasesForGame(moves);

    expect(facts.perPlyAnalysis).toBeDefined();
    for (const p of facts.perPlyAnalysis!) {
      expect(p.phase).toBe(timeline.phaseAt(p.ply));
    }
  });
});

// Important 4 (2026-07-30 fix wave): Brief 3 Step 3, verbatim, says this
// file's job is "one fixture game through debriefBullets phases and through
// the chat facts builder; assert identical labels ply by ply." The test
// above only ever routes through the CHAT consumer -- both sides of its
// assertion call phasesForGame, so it is close to phasesForGame(x) ===
// phasesForGame(x) and cannot see a local phase opinion regrown inside
// debriefBullets.ts. Proven (see this fix wave's report): swapping
// debriefBullets's `phases` for a fully local `ply <= 20 ? "opening" :
// "middlegame"` heuristic left this file green while debriefBullets.test.ts
// went red -- the tripwire named for the job missed it. This second describe
// block closes that gap by routing THIS file's own assertion through
// debriefBullets on the same LONG_GAME fixture, so a debrief-side regrowth
// reddens the file whose header claims to guard "every consumer."
describe("phase parity: debriefBullets' bullets vs the shared timeline (Important 4 -- the debrief consumer, closing the blind spot)", () => {
  it("every bullet's phase field matches phasesForGame's phaseAt for its own ply, across a spread of plies through LONG_GAME", () => {
    const turningPoints: TurningPoint[] = [
      { rank: 1, ply: 12, san: "Qxb2", label: "opponent mistake", deltaP: 0.15, lowConfidence: false, kind: "swing" },
      { rank: 2, ply: 30, san: "Kf7", label: "blunder", deltaP: -0.3, lowConfidence: false, kind: "swing" },
      { rank: 3, ply: 44, san: "Bh3", label: "mistake", deltaP: -0.15, lowConfidence: false, kind: "swing" },
    ];
    const timeline = phasesForGame(moves);
    const bullets = debriefBullets({
      turningPoints,
      classifications: [],
      result: null,
      totalPlies: moves.length,
      gameSans: moves,
    });
    const withPly = bullets.filter((b) => b.ply != null);
    expect(withPly.length).toBeGreaterThan(0); // fixture sanity: this actually exercises the assertion below
    for (const b of withPly) {
      expect(b.phase).toBe(timeline.phaseAt(b.ply!));
    }
  });
});
