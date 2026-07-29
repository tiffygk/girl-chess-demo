// tools/phase-before-after.ts
//
// Phase round (2026-07-30), Task 4. Her verbatim condition, captured in
// .superpowers/sdd/rounds/2026-07-29-truth/owner-rulings-phase-and-postgame.md:
// "I would also want us to fix number two as long as we make sure we copy
// the data in case it's lost. It should rewrite the labels that are
// incorrect on my past games." The backup is a HARD PRECONDITION of the
// heal, not a nice-to-have -- and the "rewrite" itself never touches a row:
// phase is computed on every read (Tasks 1-3 of this round), so there is no
// migration, no TP_ALGO_VERSION bump, and this script writes nothing,
// anywhere, ever. It exists purely so she can SEE, game by game, exactly
// what the new computation changes on her real history before the round
// merges -- and so the promised backup is verified, even though nothing
// writes to her db.
//
// Isolation contract (same hard rule as tools/truth-check.ts and
// tools/replay-check.ts, tightened one notch further per this task's brief):
//   - Opens ONLY the already-made backup copy at
//     data/backups/2026-07-30-phase/girlchess.db (created by a separate,
//     manual step BEFORE this script ever runs -- see the vault doc for the
//     exact commands and the counts recorded at copy time).
//   - Never opens data/girlchess.db (this worktree) or the main worktree's
//     live db, in any mode, for any reason.
//   - Opens the backup { readonly: true } ONLY -- never read-write. This is
//     why every read below is a raw prepared statement against a readonly
//     better-sqlite3 handle, not server/store/db.ts's openDb (which runs
//     migrateSchema -- an ALTER TABLE -- as a side effect of opening).
//   - Asserts the resolved db file (PRAGMA database_list) really is the
//     backup path before reading anything.
//   - No LLM call, no Stockfish/engine call, no server, anywhere in this
//     file's paths. Pure chess.js replay + SQL reads.
//
// Run: npx tsx tools/phase-before-after.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { Chess } from "chess.js";
import { phasesForGame, type MidgameTrigger } from "../src/review/gamePhases";
import { nearlyBarePlies, ENDGAME_BARE_PIECE_MAX } from "../src/review/phase";
import type { SummaryMove } from "../src/game/api";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const BACKUP_DB_PATH = path.join(REPO_ROOT, "data", "backups", "2026-07-30-phase", "girlchess.db");
const FORBIDDEN_LIVE_PATHS = [
  path.join(REPO_ROOT, "data", "girlchess.db"),
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/data/girlchess.db",
];

type Phase = "opening" | "middlegame" | "endgame";

// ---------------------------------------------------------------------------
// FROZEN copies of the two deleted algorithms. Never import, never
// re-export, never "clean up" to match the new algorithm -- the entire
// point of freezing them here is that the BEFORE column reflects what she
// actually saw on screen before this round, forever, regardless of what
// happens to the live source. The self-check below exists specifically to
// catch someone "fixing" these constants to agree with the new port.
// ---------------------------------------------------------------------------

// frozen copy of the deleted debrief phaseForPly (src/review/debriefBullets.ts:69
// at defee63) -- exists only so the before column reflects what she actually
// saw; never import or re-export this
const OLD_DEBRIEF_OPENING_PLY_CAP = 16;
const OLD_DEBRIEF_OPENING_FRACTION = 3;
const OLD_DEBRIEF_ENDGAME_MIN_TOTAL_PLIES = 40;
const OLD_DEBRIEF_ENDGAME_TAIL_FLOOR = 8;
const OLD_DEBRIEF_ENDGAME_TAIL_FRACTION = 4;

function oldDebriefPhaseForPly(ply: number, totalPlies: number, endgamePlies: Set<number>): Phase {
  if (endgamePlies.has(ply)) return "endgame";
  const openingBound = Math.min(OLD_DEBRIEF_OPENING_PLY_CAP, Math.floor(totalPlies / OLD_DEBRIEF_OPENING_FRACTION));
  if (ply <= openingBound) return "opening";
  if (totalPlies >= OLD_DEBRIEF_ENDGAME_MIN_TOTAL_PLIES) {
    const endgameTail = Math.max(
      OLD_DEBRIEF_ENDGAME_TAIL_FLOOR,
      Math.floor(totalPlies / OLD_DEBRIEF_ENDGAME_TAIL_FRACTION)
    );
    if (totalPlies - ply <= endgameTail) return "endgame";
  }
  return "middlegame";
}

// frozen copy of the deleted coach derivePhase (server/coach/chat.ts:47 at
// defee63) -- exists only so the before column reflects what she actually
// saw; never import or re-export this
const OLD_COACH_OPENING_PLY_MAX = 20;
const OLD_COACH_ENDGAME_PIECE_MAX = 12;
// Hand-duplicates src/review/phase.ts's ENDGAME_BARE_PIECE_MAX the same way
// the real dead code did (server code never imported from src/) -- imported
// here for the VALUE only (both must equal 1), never for behavior.
const OLD_COACH_ENDGAME_BARE_PIECE_MAX = ENDGAME_BARE_PIECE_MAX;

function oldCoachDerivePhase(ply: number, pieceCount: number, nearlyBare: boolean): Phase {
  if (nearlyBare) return "endgame";
  if (ply <= OLD_COACH_OPENING_PLY_MAX) return "opening";
  if (pieceCount <= OLD_COACH_ENDGAME_PIECE_MAX) return "endgame";
  return "middlegame";
}

// ---------------------------------------------------------------------------
// Test-honesty demand: this script is an instrument, and an instrument that
// cannot fail is not measuring. A hand-known case -- a 48-ply, capture-free,
// full-material game whose back rank empties from ordinary development --
// must disagree between old and new: the old debrief fallback calls its
// final plies "endgame" purely because the game is long (totalPlies >= 40
// and within the tail), while the new material/board-fact timeline correctly
// calls them "middlegame" (majorsAndMinors never drops to <=6 with zero
// captures -- this game literally has no endgame under the real rule).
// Verified once by hand (2026-07-30): breaking OLD_DEBRIEF_ENDGAME_MIN_TOTAL_PLIES
// down to 4 made this refuse with a thrown error; restored, it passes again.
// ---------------------------------------------------------------------------
const KNOWN_CASE_SANS: string[] = [
  "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5",
  "Bb3", "d6", "c3", "O-O", "h3", "Nb8", "d4", "Nbd7", "Nbd2", "Bb7", "Bc2", "Re8",
  "Nf1", "Bf8", "Ng3", "g6", "a4", "Bg7", "Be3", "c5",
  "Qd2", "Kh8", "Rad1", "Kg8", "Kh2", "Kh8", "Kg1", "Kg8", "Kh2", "Kh8", "Kg1", "Kg8", "Kh2", "Kh8", "Kg1", "Kg8",
];

function selfCheckOrThrow(): void {
  const chess = new Chess();
  for (let i = 0; i < KNOWN_CASE_SANS.length; i++) {
    const san = KNOWN_CASE_SANS[i];
    if (san.includes("x")) {
      throw new Error(`[phase-before-after] self-check fixture is corrupted: capture "${san}" at ply ${i + 1} -- this fixture must be capture-free and full-material by construction`);
    }
    const mv = chess.move(san);
    if (!mv) {
      throw new Error(`[phase-before-after] self-check fixture is corrupted: illegal move "${san}" at ply ${i + 1}`);
    }
  }
  const finalPieceCount = chess.board().flat().filter((p) => p != null).length;
  if (finalPieceCount !== 32) {
    throw new Error(
      `[phase-before-after] self-check fixture is corrupted: expected 32 pieces on the board after ${KNOWN_CASE_SANS.length} capture-free plies, found ${finalPieceCount}`
    );
  }

  const gameSans: SummaryMove[] = KNOWN_CASE_SANS.map((san, i) => ({ ply: i + 1, san }));
  const totalPlies = gameSans.length;
  const nearlyBare = nearlyBarePlies(gameSans);
  const oldFinal = oldDebriefPhaseForPly(totalPlies, totalPlies, nearlyBare);
  const timeline = phasesForGame(gameSans);
  const newFinal = timeline.phaseAt(totalPlies);

  if (oldFinal !== "endgame") {
    throw new Error(
      `[phase-before-after] SELF-CHECK REFUSED: the old debrief fallback was expected to call ply ${totalPlies} of this ${totalPlies}-ply full-material fixture "endgame" (that is the bug this round fixed) but computed "${oldFinal}" instead -- a frozen constant has drifted. Refusing to emit output.`
    );
  }
  if (newFinal !== "middlegame") {
    throw new Error(
      `[phase-before-after] SELF-CHECK REFUSED: the new lichess-divider timeline was expected to call ply ${totalPlies} of this ${totalPlies}-ply full-material, never-captured fixture "middlegame" (majorsAndMinors never reaches <=6 here -- this game has no endgame) but computed "${newFinal}" instead. Refusing to emit output -- either gamePhases.ts changed underneath this script or the fixture no longer proves what it claims.`
    );
  }
  console.log(
    `[phase-before-after] self-check OK: known 48-ply full-material fixture -- old debrief says "${oldFinal}" at the final ply, new timeline says "${newFinal}". They disagree, as they must.`
  );
}

// ---------------------------------------------------------------------------
// Backup isolation guard
// ---------------------------------------------------------------------------

function assertBackupOnly(db: Database.Database): void {
  const resolved = (db.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(BACKUP_DB_PATH)) {
    throw new Error(
      `[phase-before-after] db isolation violated: resolved to "${resolved}", expected the backup at "${BACKUP_DB_PATH}". Aborting before any read.`
    );
  }
  for (const forbidden of FORBIDDEN_LIVE_PATHS) {
    if (path.resolve(resolved) === path.resolve(forbidden)) {
      throw new Error(`[phase-before-after] REFUSING: resolved db path equals a live db path (${forbidden}). Aborting.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-game measurement
// ---------------------------------------------------------------------------

interface TurningPointRow {
  rank: number;
  ply: number;
  san: string;
  label: string;
  kind: string;
  algo_version: number | null;
}

interface TurningPointChange {
  ply: number;
  san: string;
  label: string;
  kind: string;
  oldPhase: Phase;
  newPhase: Phase;
  changed: boolean;
}

interface GameReport {
  gameId: number;
  totalPlies: number;
  turningPointChanges: TurningPointChange[];
  turningPointVisibleChange: boolean; // a change at a ply with a CURRENTLY PERSISTED turning-point row -- what a debrief card would show her right now
  mislabeledByOldFallback: boolean; // any ply anywhere in the game where the old ply-fraction rule says "endgame" and the new material rule disagrees -- the actual "was this game's story ever told wrong" question, independent of whether a turning-point row happens to be persisted today
  mislabeledPlies: number[];
  midgameStartPly: number | null;
  endgameStartPly: number | null;
  midgameTriggers: MidgameTrigger[];
  midgameStartPlyWithoutMixedness: number | null;
  mixednessMovedBoundary: boolean;
  mixednessDeltaPlies: number | null;
  mixednessChangesAVisibleTurningPointLabel: boolean;
  hasNoEndgame: boolean;
  coachDeltaCount: number;
  coachDeltaTotalPlies: number;
}

function piecesByPly(gameSans: SummaryMove[]): Map<number, number> {
  const out = new Map<number, number>();
  const chess = new Chess();
  for (const m of gameSans) {
    try {
      chess.move(m.san);
    } catch {
      break;
    }
    out.set(m.ply, chess.board().flat().filter((p) => p != null).length);
  }
  return out;
}

// Replays phaseAt's own logic (src/review/gamePhases.ts) with a substituted
// midgame boundary -- used only to answer "would this ply's label change if
// mixedness had not moved the boundary", never to compute a shown phase.
function phaseAtGivenBoundary(
  ply: number,
  midgameBoundary: number | null,
  endgameStartPly: number | null,
  nearlyBare: Set<number>
): Phase {
  if (nearlyBare.has(ply)) return "endgame";
  if (endgameStartPly !== null && ply >= endgameStartPly) return "endgame";
  if (midgameBoundary !== null && ply >= midgameBoundary) return "middlegame";
  return "opening";
}

function measureGame(gameId: number, gameSans: SummaryMove[], tpRows: TurningPointRow[]): GameReport {
  const totalPlies = gameSans.length > 0 ? gameSans[gameSans.length - 1].ply : 0;
  const nearlyBare = nearlyBarePlies(gameSans);
  const timeline = phasesForGame(gameSans);

  const turningPointChanges: TurningPointChange[] = tpRows
    .slice()
    .sort((a, b) => a.ply - b.ply)
    .map((tp) => {
      const oldPhase = oldDebriefPhaseForPly(tp.ply, totalPlies, nearlyBare);
      const newPhase = timeline.phaseAt(tp.ply);
      return { ply: tp.ply, san: tp.san, label: tp.label, kind: tp.kind, oldPhase, newPhase, changed: oldPhase !== newPhase };
    });
  const turningPointVisibleChange = turningPointChanges.some((c) => c.changed);

  // The real "was this game's story ever told wrong" question: scan EVERY
  // ply, not just plies with a currently-persisted turning-point row (some
  // finished games -- see the report -- have zero persisted turning points
  // yet to be healed on next open, which would otherwise hide a real
  // mislabel from this sweep).
  const mislabeledPlies: number[] = [];
  for (let ply = 1; ply <= totalPlies; ply++) {
    const oldPhase = oldDebriefPhaseForPly(ply, totalPlies, nearlyBare);
    const newPhase = timeline.phaseAt(ply);
    if (oldPhase === "endgame" && newPhase !== "endgame") mislabeledPlies.push(ply);
  }
  const mislabeledByOldFallback = mislabeledPlies.length > 0;

  const mixednessMovedBoundary = timeline.midgameStartPly !== timeline.midgameStartPlyWithoutMixedness;
  const mixednessDeltaPlies =
    mixednessMovedBoundary && timeline.midgameStartPly !== null && timeline.midgameStartPlyWithoutMixedness !== null
      ? timeline.midgameStartPlyWithoutMixedness - timeline.midgameStartPly
      : null;
  // Does mixedness moving the boundary change the phase word at any ply
  // that ALREADY has a persisted turning-point row -- i.e. a place a
  // debrief card could actually quote a phase word today.
  const mixednessChangesAVisibleTurningPointLabel =
    mixednessMovedBoundary &&
    tpRows.some(
      (tp) =>
        phaseAtGivenBoundary(tp.ply, timeline.midgameStartPly, timeline.endgameStartPly, nearlyBare) !==
        phaseAtGivenBoundary(tp.ply, timeline.midgameStartPlyWithoutMixedness, timeline.endgameStartPly, nearlyBare)
    );

  const pieces = piecesByPly(gameSans);
  let coachDeltaCount = 0;
  for (let ply = 1; ply <= totalPlies; ply++) {
    const pieceCount = pieces.get(ply) ?? 32;
    const oldCoach = oldCoachDerivePhase(ply, pieceCount, nearlyBare.has(ply));
    const newPhase = timeline.phaseAt(ply);
    if (oldCoach !== newPhase) coachDeltaCount++;
  }

  return {
    gameId,
    totalPlies,
    turningPointChanges,
    turningPointVisibleChange,
    mislabeledByOldFallback,
    mislabeledPlies,
    midgameStartPly: timeline.midgameStartPly,
    endgameStartPly: timeline.endgameStartPly,
    midgameTriggers: timeline.midgameTriggers,
    midgameStartPlyWithoutMixedness: timeline.midgameStartPlyWithoutMixedness,
    mixednessMovedBoundary,
    mixednessDeltaPlies,
    mixednessChangesAVisibleTurningPointLabel,
    hasNoEndgame: timeline.endgameStartPly === null,
    coachDeltaCount,
    coachDeltaTotalPlies: totalPlies,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const SCOUT_PREDICTED_CHANGED_IDS = [24, 105, 131, 132, 141, 143, 146, 151];

function main(): void {
  selfCheckOrThrow();

  if (!fs.existsSync(BACKUP_DB_PATH)) {
    throw new Error(
      `[phase-before-after] backup not found at ${BACKUP_DB_PATH} -- run the Step 1 backup (see the vault doc) before this script`
    );
  }

  const db = new Database(BACKUP_DB_PATH, { readonly: true });
  assertBackupOnly(db);
  console.log(`[phase-before-after] db isolation confirmed, readonly, backup-only: ${BACKUP_DB_PATH}`);

  const integrity = (db.pragma("integrity_check") as { integrity_check: string }[])[0].integrity_check;
  const gamesCount = (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
  const movesCount = (db.prepare("SELECT COUNT(*) c FROM moves").get() as { c: number }).c;
  console.log(`[phase-before-after] backup snapshot: integrity_check=${integrity}, games=${gamesCount}, moves=${movesCount}`);

  const finishedGames = db
    .prepare("SELECT id FROM games WHERE result IS NOT NULL ORDER BY id")
    .all() as { id: number }[];
  console.log(`[phase-before-after] finished games (result IS NOT NULL): ${finishedGames.length}`);

  const movesStmt = db.prepare("SELECT ply, san FROM moves WHERE game_id = ? ORDER BY ply");
  // Mirrors server/store/db.ts's getTurningPoints exactly (latest algo_version
  // only) -- written as raw SQL because this script may only ever open the
  // backup readonly, never via openDb (which opens read-write).
  const tpStmt = db.prepare(
    `SELECT rank, ply, san, label, kind, algo_version FROM turning_points WHERE game_id = ?
       AND COALESCE(algo_version, 1) = (
         SELECT MAX(COALESCE(algo_version, 1)) FROM turning_points WHERE game_id = ?
       )
     ORDER BY rank`
  );

  const reports: GameReport[] = [];
  for (const { id: gameId } of finishedGames) {
    const movesRows = movesStmt.all(gameId) as { ply: number; san: string }[];
    if (movesRows.length === 0) continue;
    const gameSans: SummaryMove[] = movesRows.map((r) => ({ ply: r.ply, san: r.san }));
    const tpRows = tpStmt.all(gameId, gameId) as TurningPointRow[];
    reports.push(measureGame(gameId, gameSans, tpRows));
  }

  const mislabeledGames = reports.filter((r) => r.mislabeledByOldFallback);
  const mislabeledIds = mislabeledGames.map((r) => r.gameId).sort((a, b) => a - b);
  const turningPointVisibleGames = reports.filter((r) => r.turningPointVisibleChange);
  const mixednessGames = reports.filter((r) => r.mixednessMovedBoundary);
  const noEndgameGames = reports.filter((r) => r.hasNoEndgame);

  console.log("\n[phase-before-after] ---- report ----");
  console.log(`games measured (finished, with moves): ${reports.length}`);
  console.log(
    `games with >=1 ply anywhere the old ply-fraction fallback calls "endgame" and the new material rule disagrees (the real "was this game's story ever told wrong" sweep): ${mislabeledGames.length}`
  );
  console.log(`mislabeled game ids (full-corpus sweep): ${mislabeledIds.join(", ") || "(none)"}`);
  console.log(
    `of those, games where a CURRENTLY PERSISTED turning-point row sits at a mislabeled ply (what a debrief card shows her right now): ${turningPointVisibleGames.map((r) => r.gameId).sort((a, b) => a - b).join(", ") || "(none)"}`
  );

  const predictedSet = new Set(SCOUT_PREDICTED_CHANGED_IDS);
  const actualSet = new Set(mislabeledIds);
  const extra = mislabeledIds.filter((id) => !predictedSet.has(id));
  const missing = SCOUT_PREDICTED_CHANGED_IDS.filter((id) => !actualSet.has(id));
  console.log(`\nscout predicted: ${SCOUT_PREDICTED_CHANGED_IDS.join(", ")}`);
  console.log(`extra (mislabeled but not predicted): ${extra.join(", ") || "(none)"}`);
  console.log(`missing (predicted but not found mislabeled): ${missing.join(", ") || "(none)"}`);

  console.log("\n[phase-before-after] ---- per mislabeled game detail ----");
  for (const r of mislabeledGames) {
    console.log(`\ngame ${r.gameId} (totalPlies=${r.totalPlies}):`);
    console.log(`  mislabeled plies (old=endgame, new!=endgame): ${r.mislabeledPlies.join(", ")}`);
    console.log(
      `  new timeline: midgameStartPly=${r.midgameStartPly ?? "null"} (triggers: ${r.midgameTriggers.join(",") || "none"}), endgameStartPly=${r.endgameStartPly ?? "no endgame in this game"}`
    );
    console.log(
      `  midgameStartPlyWithoutMixedness=${r.midgameStartPlyWithoutMixedness ?? "null"} (mixedness moved boundary: ${r.mixednessMovedBoundary}${r.mixednessDeltaPlies !== null ? `, by ${r.mixednessDeltaPlies} plies` : ""})`
    );
    console.log(`  coach-side per-ply delta vs old derivePhase: ${r.coachDeltaCount} / ${r.coachDeltaTotalPlies} plies disagree`);
    if (r.turningPointChanges.length === 0) {
      console.log("  (no turning_points rows currently persisted for this game -- nothing renders a phase word for it in the debrief today)");
    }
    for (const c of r.turningPointChanges) {
      const flag = c.changed ? "CHANGED" : "same";
      console.log(`    ply ${c.ply} (${c.san}, ${c.label} [${c.kind}]): old=${c.oldPhase} -> new=${c.newPhase} [${flag}]`);
    }
  }

  console.log("\n[phase-before-after] ---- mixedness measurement ----");
  console.log(`games where mixedness moved the midgame boundary vs the cheap-predicates-only answer: ${mixednessGames.length} / ${reports.length}`);
  if (mixednessGames.length > 0) {
    for (const r of mixednessGames) {
      console.log(
        `  game ${r.gameId}: midgameStartPly=${r.midgameStartPly} vs withoutMixedness=${r.midgameStartPlyWithoutMixedness} (delta ${r.mixednessDeltaPlies} plies)`
      );
    }
  } else {
    console.log("  never, on this corpus.");
  }
  const mixednessEverChangesShownLabel = mixednessGames.some((r) => r.mixednessChangesAVisibleTurningPointLabel);
  console.log(
    `does mixedness ever change a phase word at a ply a debrief card currently shows her: ${mixednessEverChangesShownLabel}`
  );
  if (mixednessEverChangesShownLabel) {
    for (const r of mixednessGames.filter((g) => g.mixednessChangesAVisibleTurningPointLabel)) {
      console.log(`  game ${r.gameId}: yes, at a persisted turning-point ply`);
    }
  }

  console.log("\n[phase-before-after] ---- games with no endgame at all ----");
  console.log(`${noEndgameGames.length} / ${reports.length}: ${noEndgameGames.map((r) => r.gameId).join(", ") || "(none)"}`);

  const totalCoachDeltaPlies = reports.reduce((a, r) => a + r.coachDeltaCount, 0);
  const totalPliesAll = reports.reduce((a, r) => a + r.coachDeltaTotalPlies, 0);
  console.log(`\ncoach-side per-ply delta, whole corpus: ${totalCoachDeltaPlies} / ${totalPliesAll} plies disagree between old derivePhase and the new timeline`);

  console.log("\n[phase-before-after] no row was read/written to any live db; backup opened readonly only.");
  console.log("[phase-before-after] VERDICT: DONE");
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
