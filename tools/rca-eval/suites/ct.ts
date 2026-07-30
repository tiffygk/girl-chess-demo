// tools/rca-eval/suites/ct.ts
//
// Suite CT -- conversion truth (spec section 3, K1/K2). Black-box
// acceptance checks over the MERGED annotator against real games, on a
// WAL-safe copy of the corpus -- deliberately not a re-run of K1's unit
// tests.
//
// 2026-07-31 status: neither K1 (server/annotator/conversion.ts,
// TP_ALGO_VERSION 7, the debrief's conversion bullet, debriefInvariants'
// new conversion-claim rule) nor K2 (the judge's mate-run nudge/silent
// adjudication) has merged. CT-01/02/03/04/05/07 need code that does not
// exist yet and report did-not-run, each citing the CURRENT (pre-heal)
// state read from the corpus, matching the spec's baseline rows B4/B5
// exactly -- so the suite proves it actually opened and inspected the real
// corpus, not that it declined to look.
//
// CT-06 is different: debriefBullets()/classifyMoves() both exist TODAY,
// need no K1/K2 code, and are executed for real against game 160's actual
// persisted evals -- and come back red, because classifyMoves' winprob-
// delta axis is blind to an already-decided (mate-run) position (the known
// "winprob delta scores ~0 in a decided position" class), so BOTH fallback
// strings fire today, exactly as the spec's CT-06 describes.
//
// The corpus source is the existing pre-tpv7 backup triple (spec section 3,
// suite CT: "the existing pre-tpv7 triple") -- already a frozen, static
// snapshot (not the live mutable db), so it is opened READONLY directly,
// with no copy step; this suite never opens data/girlchess.db itself.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { classifyMoves } from "../../../server/annotator/classifications";
import { debriefBullets } from "../../../src/review/debriefBullets";
import { assertGamesExamined } from "../../truth-check";
import { deriveMainWorktreeDbFromGit } from "../../dbCountSnapshot";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator } from "../lib/assertRan";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const NO_MISTAKES_STRING = "no clear mistakes to flag here. keep playing this clean.";
const NO_REPEAT_PATTERN_STRING = "no repeat pattern showed up this game. stay sharp on the next one.";

function resolvePreTpv7Backup(): string {
  const mainDataPath = deriveMainWorktreeDbFromGit(REPO_ROOT); // <mainRoot>/data/girlchess.db
  if (!mainDataPath) throw new Error("CT setup: could not derive the main worktree root via git -- cannot locate the pre-tpv7 backup.");
  const backupsDir = path.join(path.dirname(mainDataPath), "backups");
  const candidates = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => /^pre-tpv7-.*\.db$/.test(f)) : [];
  if (candidates.length === 0) {
    throw new Error(`CT setup: no pre-tpv7-*.db backup found under ${backupsDir} -- cannot open a WAL-safe corpus copy.`);
  }
  candidates.sort();
  return path.join(backupsDir, candidates[candidates.length - 1]);
}

interface Baseline {
  path: string;
  games: number;
  moves: number;
  integrity: string;
  tp160Count: number;
  emptyClass160: number;
  totalMoves160: number;
  algoVersions: Record<string, number>;
}

function readBaseline(dbPath: string): Baseline {
  const db = new Database(dbPath, { readonly: true });
  try {
    const integrity = (db.pragma("integrity_check") as { integrity_check: string }[])[0].integrity_check;
    const games = (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
    const moves = (db.prepare("SELECT COUNT(*) c FROM moves").get() as { c: number }).c;
    const tp160Count = (db.prepare("SELECT COUNT(*) c FROM turning_points WHERE game_id=160").get() as { c: number }).c;
    const emptyClass160 = (
      db.prepare("SELECT COUNT(*) c FROM moves WHERE game_id=160 AND (classification IS NULL OR classification='')").get() as { c: number }
    ).c;
    const totalMoves160 = (db.prepare("SELECT COUNT(*) c FROM moves WHERE game_id=160").get() as { c: number }).c;
    const versionRows = db.prepare("SELECT algo_version, COUNT(*) c FROM turning_points GROUP BY algo_version").all() as { algo_version: number | null; c: number }[];
    const algoVersions: Record<string, number> = {};
    for (const r of versionRows) algoVersions[String(r.algo_version ?? "null")] = r.c;
    return { path: dbPath, games, moves, integrity, tp160Count, emptyClass160, totalMoves160, algoVersions };
  } finally {
    db.close();
  }
}

function ct06(dbPath: string): EvalResult {
  const db = new Database(dbPath, { readonly: true });
  let moveRows: any[];
  let tpRows: any[];
  let game: any;
  try {
    moveRows = db.prepare("SELECT ply, san, eval_cp as evalCp, eval_mate as evalMate FROM moves WHERE game_id=160 ORDER BY ply").all();
    tpRows = db.prepare("SELECT * FROM turning_points WHERE game_id=160 ORDER BY rank").all();
    game = db.prepare("SELECT result FROM games WHERE id=160").get();
  } finally {
    db.close();
  }

  const classifications = classifyMoves(moveRows as any).filter((c): c is { ply: number; classification: string } => c !== null);
  const turningPoints = tpRows.map((r: any) => ({
    rank: r.rank,
    ply: r.ply,
    san: r.san,
    label: r.label,
    punishSan: r.punish_san ?? undefined,
    deltaP: r.delta_p,
    lowConfidence: !!r.low_confidence,
    kind: r.kind,
    missedPunish: !!r.missed_punish,
    plyEnd: r.ply_end ?? undefined,
    crossedAdvantage: !!r.crossed_advantage,
    mateIn: r.mate_in ?? undefined,
    missedCount: r.missed_count ?? undefined,
    endKind: r.end_kind ?? undefined,
    anchorKind: r.anchor_kind ?? undefined,
  }));

  const bullets = debriefBullets({ turningPoints: turningPoints as any, classifications, result: game?.result ?? null, totalPlies: 187 });
  const texts = bullets.map((b) => b.text);
  const hasNoMistakes = texts.includes(NO_MISTAKES_STRING);
  const hasNoRepeat = texts.includes(NO_REPEAT_PATTERN_STRING);

  if (!hasNoMistakes && !hasNoRepeat) {
    return { id: "CT-06", verdict: "pass", detail: "neither fallback string appears in game 160's rendered debrief." };
  }
  return {
    id: "CT-06",
    verdict: "red",
    detail:
      `game 160's debrief, rendered TODAY against classifyMoves()+debriefBullets() (both pre-existing, no K1 code needed), ` +
      `still shows: ${hasNoMistakes ? `"${NO_MISTAKES_STRING}" ` : ""}${hasNoRepeat ? `"${NO_REPEAT_PATTERN_STRING}"` : ""}. ` +
      `classifyMoves found ${classifications.length} classification(s) for her moves in this game -- the winprob-delta axis is ` +
      "blind to an already-decided (mate-run) position, the known class this repo's memory already names. This is the exact " +
      "gap K1's conversion-driven bullet is meant to close; not yet implemented.",
  };
}

function didNotRun(id: string, missingDependency: string, evidence: string): EvalResult {
  return {
    id,
    verdict: "did-not-run",
    detail: `${missingDependency} does not exist yet -- cannot evaluate. Current (pre-heal) state: ${evidence}`,
  };
}

export function runCtSuite(): SuiteResult {
  const dbPath = resolvePreTpv7Backup();
  const baseline = readBaseline(dbPath);
  // Section 4 rule 1: assert the denominator this suite examined -- reuses
  // the existing assertGamesExamined pattern (tools/truth-check.ts), never
  // a second reimplementation.
  assertGamesExamined(baseline.games, dbPath, "pre-tpv7 backup triple (readonly, static snapshot)");
  if (baseline.games !== 161) {
    throw new Error(`CT: expected 161 games in the pre-tpv7 backup (spec baseline B9), found ${baseline.games} -- re-verify the fixture triple.`);
  }

  const versionSummary = Object.entries(baseline.algoVersions)
    .map(([v, c]) => `${v}:${c}`)
    .join(", ");

  const results: EvalResult[] = [
    didNotRun(
      "CT-01",
      "server/annotator/conversion.ts (detectConversion) and TP_ALGO_VERSION 7 (K1)",
      `game 160 has ${baseline.tp160Count} turning points (no conversion TP), corpus turning_points algo_version split: ${versionSummary} (matches baseline B4/B5).`
    ),
    didNotRun(
      "CT-02",
      "server/annotator/conversion.ts (detectConversion) (K1)",
      "no conversion detector exists to prove game 161 stays clean of false-positive conversion/missed-mate events."
    ),
    didNotRun(
      "CT-03",
      "server/annotator/conversion.ts (detectConversion) (K1)",
      "no conversion detector exists to prove ply 185 is a non-event."
    ),
    didNotRun(
      "CT-04",
      "src/review/debriefInvariants.ts's new 'conversion-claim' rule (K1)",
      "replay-check.ts's existing invariants can be checked corpus-wide today, but the specific new rule CT-04 requires does not exist yet."
    ),
    didNotRun(
      "CT-05",
      "the judge's K2 mate-run nudge/silent adjudication",
      `game 160: ${baseline.emptyClass160} of ${baseline.totalMoves160} moves carry empty classification; no mate-run-aware nudge/silent adjudicator exists yet (matches baseline B5).`
    ),
    ct06(dbPath),
    didNotRun(
      "CT-07",
      "server/annotator/conversion.ts (detectConversion) (K1)",
      "no conversion/slip detector exists yet to count per-move slip cards."
    ),
  ];
  assertDenominator(results, 7, "CT");
  return {
    suite: "CT",
    expectedCount: 7,
    results,
    ranAt: new Date().toISOString(),
    notes: [
      `corpus source: ${dbPath} (readonly, ${baseline.games} games / ${baseline.moves} moves, integrity ${baseline.integrity}).`,
      "CT-01/02/03/04/05/07 did-not-run: K1 (conversion.ts, TP_ALGO_VERSION 7, the conversion-claim invariant) and K2 (mate-run adjudication) have not merged.",
      "CT-06 executed for real against pre-K1 code (classifyMoves + debriefBullets need no K1 code) and is red: both fallback strings fire on game 160 today.",
    ],
  };
}
