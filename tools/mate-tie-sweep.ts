// Game 198 follow-up (2026-09-22), brief 2b, part 2: a readonly sweep over
// the owner's real db that labels every mate-tie ply from `moves` rows
// alone (no GameManager, no Stockfish, no model call -- pure arithmetic
// over already-persisted columns, same discipline every annotator in this
// repo follows) and asks four production reporters whether each one reads
// the tie as "best" or "not best."
//
// Label (mirrors keepsMateSchedule, server/annotator/mateTie.ts -- never
// re-derived): a mate tie at ply P is row P-1 (the "seed" row) with
// eval_mate = N > 0, the played uci at ply P differs from row P-1's
// best_move, and row P's eval_mate is -(N-1) (or 0 when N = 1). Two
// neighbouring, unscored cells are reported separately, never folded into
// the tie count or read as a pass/fail: "shorter" (the played move mates
// FASTER than the stored best's schedule -- a strictly better move, not a
// tie) and "no-eval" (row P exists but never got an eval_mate, so the
// schedule can't be checked at all).
//
// Reporters (four; two more are NOT swept, see NOT_SWEPT below):
//   1. TurningLine.equalMate, from tools/replay-check.ts's buildTurningLines
//      (fixed this round, part 1) -- reused verbatim, never re-implemented.
//   2. followedBest.followed (src/review/followedBest.ts), fed the same
//      TurningLine.
//   3. highlightLines.matchedBest (server/annotator/highlightLines.ts's
//      buildHighlightLines) -- already reuses keepsMateSchedule directly
//      (confirmed by reading the file, 2026-09-22), so this reporter is
//      swept as a cross-check, not because it needed part 1's fix.
//   4. The review arrow producer (src/game/reviewArrows.ts's
//      reviewArrowsForMove) -- reads TurningLine.equalMate for the
//      "found" (single, best) arrow colour on her own ply.
//
// Run: npx tsx tools/mate-tie-sweep.ts [--db <absolute path>] [--label <sha>]
// Writes one markdown table (this reporter run) to stdout AND to
// .superpowers/sdd/rounds/2026-09-22-game198-followup/results/2b-mate-tie-<label>.md
// when --label is given; with no --label, stdout only (baselines at other
// SHAs pass their own --label).

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
// Dynamic, not a static import: part 3 of this brief copies this one file
// into a scratch worktree checked out at an old SHA (99d4231, before PR
// #38) where server/annotator/mateTie.ts does not exist yet -- a static
// import would crash the whole tool before it could even label the
// population there. Resolved once in main() via loadKeepsMateSchedule().
type KeepsMateScheduleFn = (
  before: { evalMate: number | null },
  after: { evalMate: number | null }
) => boolean;
let keepsMateSchedule: KeepsMateScheduleFn;
let keepsMateScheduleSource = "(not yet loaded)";
async function loadKeepsMateSchedule(): Promise<void> {
  try {
    const mod = await import("../server/annotator/mateTie");
    keepsMateSchedule = mod.keepsMateSchedule;
    keepsMateScheduleSource = "server/annotator/mateTie.ts (production, imported)";
  } catch {
    // Fallback: byte-identical arithmetic to keepsMateSchedule's own body
    // (server/annotator/mateTie.ts, as of the game 198 fixes round) --
    // kept here ONLY so the population label is computable at a SHA
    // before that file existed. Never used when the real module is
    // available; every report states which path ran.
    keepsMateSchedule = (before, after) => {
      const n = before.evalMate;
      if (n === null || n <= 0) return false;
      const a = after.evalMate;
      if (a === null) return false;
      if (a === 0) return n === 1;
      return -a === n - 1;
    };
    keepsMateScheduleSource = "inline fallback copy (server/annotator/mateTie.ts absent at this SHA)";
  }
}

// -- NOT SWEPT -----------------------------------------------------------
// The chat gap tag (server/coach/chat.ts:794, the `gap: ... && !keepsMate
// Schedule(...)` clause inside assembleChatFactList's perPlyAnalysis) and
// the manager-side flag (server/game/manager.ts:992-994, getTurningLines'
// own `line.equalMate = true` assignment) are NOT swept here. Both take a
// ChatPerPlyInput[]/TurningPoint[] built only inside GameManager (its
// private pvLine, a live Stockfish-backed getGameMoves walk) -- exactly
// the "no GameManager, no Stockfish" constraint this sweep runs under
// forbids constructing that input honestly. Their mate-tie behaviour is
// covered by unit tests instead: server/coach/chat.test.ts (the gap tag)
// and server/game/manager.test.ts (the equalMate assignment) both carry
// red-before-fix cases for this exact schedule-kept arithmetic.
export const NOT_SWEPT = [
  "chat gap tag (server/coach/chat.ts:794) -- unit-tested in server/coach/chat.test.ts",
  "manager-side equalMate flag (server/game/manager.ts:992-994) -- unit-tested in server/game/manager.test.ts",
] as const;

interface Args {
  dbPath: string;
  label: string | undefined;
  resultsDir: string;
}

// Hardcoded absolute paths, not resolved from import.meta.url: this file
// is copied into scratch worktrees at other SHAs (part 3 of this brief),
// where "relative to this file" would resolve inside the scratch worktree
// instead of the one round folder every baseline's results belong in.
const DEFAULT_DB_PATH =
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/data/girlchess.db";
const DEFAULT_RESULTS_DIR =
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/.superpowers/sdd/rounds/2026-09-22-game198-followup/results";

function parseArgs(argv: string[]): Args {
  let dbPath = DEFAULT_DB_PATH;
  let label: string | undefined;
  let resultsDir = DEFAULT_RESULTS_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db" && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === "--label" && argv[i + 1]) label = argv[++i];
    else if (argv[i] === "--results-dir" && argv[i + 1]) resultsDir = argv[++i];
  }
  return { dbPath, label, resultsDir };
}

interface RawPair {
  gameId: number;
  seedPly: number; // P-1
  n: number; // seedRow.eval_mate
  bestMove: string | null; // seedRow.best_move (uci)
  playedPly: number; // P
  playedUci: string | null;
  playedSan: string;
  afterMate: number | null; // playedRow.eval_mate
}

type Bucket = "tie" | "shorter" | "no-eval" | "other";

function classify(p: RawPair): Bucket {
  if (p.afterMate === null) return "no-eval";
  if (keepsMateSchedule({ evalMate: p.n }, { evalMate: p.afterMate })) return "tie";
  // "shorter": the played move mates faster than the stored best's
  // schedule would have -- |afterMate| < N-1 (N=1 has no room to be
  // shorter: N-1=0, and mate is already delivered at afterMate=0, which
  // classify's keepsMateSchedule branch above already claimed as a tie).
  const scheduled = p.n - 1;
  if (Math.abs(p.afterMate) < scheduled) return "shorter";
  return "other";
}

function loadRawPairs(db: Database.Database): RawPair[] {
  const rows = db
    .prepare(
      `SELECT m1.game_id as gameId, m1.ply as seedPly, m1.eval_mate as n, m1.best_move as bestMove,
              m2.ply as playedPly, m2.uci as playedUci, m2.san as playedSan, m2.eval_mate as afterMate
       FROM moves m1
       JOIN moves m2 ON m2.game_id = m1.game_id AND m2.ply = m1.ply + 1
       WHERE m1.eval_mate IS NOT NULL AND m1.eval_mate > 0
       ORDER BY m1.game_id, m1.ply`
    )
    .all() as RawPair[];
  // "other move" only: the played uci differs from the stored best.
  return rows.filter((r) => r.playedUci !== r.bestMove);
}

interface GameSans {
  ply: number;
  san: string;
}

function loadGameSans(db: Database.Database, gameId: number): GameSans[] {
  return db
    .prepare("SELECT ply, san FROM moves WHERE game_id = ? ORDER BY ply")
    .all(gameId) as GameSans[];
}

interface ReporterResult {
  name: string;
  status: "ok" | "n/a";
  detail?: string;
  total: number;
  reportedBest: number;
  notBest: { gameId: number; ply: number }[];
  // Reporter 3 only: plies this reporter never renders a verdict for at
  // all (not a highlighted ply), reported separately from a real
  // not-best -- see the invariant rule (a check narrower than its claim
  // reports clean over real cases; the inverse bug here would be scoring
  // "no verdict" as a miss when the reporter was never asked).
  outOfScope?: { gameId: number; ply: number }[];
}

async function evalReporter1(
  ties: RawPair[],
  gameSansByGame: Map<number, GameSans[]>
): Promise<ReporterResult> {
  const name = "1. TurningLine.equalMate (replay-check.buildTurningLines mirror)";
  let buildTurningLines: any;
  try {
    ({ buildTurningLines } = await import("./replay-check"));
  } catch (e) {
    return { name, status: "n/a", detail: `import failed: ${(e as Error).message}`, total: ties.length, reportedBest: 0, notBest: [] };
  }
  const notBest: { gameId: number; ply: number }[] = [];
  let reportedBest = 0;
  for (const t of ties) {
    const gameSans = gameSansByGame.get(t.gameId)!;
    const tp = { rank: 1, ply: t.playedPly, san: t.playedSan };
    let lines;
    try {
      lines = buildTurningLines(t.gameId, [tp], gameSans);
    } catch (e) {
      notBest.push({ gameId: t.gameId, ply: t.playedPly });
      continue;
    }
    if (lines?.[0]?.equalMate === true) reportedBest++;
    else notBest.push({ gameId: t.gameId, ply: t.playedPly });
  }
  return { name, status: "ok", total: ties.length, reportedBest, notBest };
}

async function evalReporter2(
  ties: RawPair[],
  gameSansByGame: Map<number, GameSans[]>
): Promise<ReporterResult> {
  const name = "2. followedBest.followed";
  let buildTurningLines: any;
  let followedBest: any;
  try {
    ({ buildTurningLines } = await import("./replay-check"));
    ({ followedBest } = await import("../src/review/followedBest"));
  } catch (e) {
    return { name, status: "n/a", detail: `import failed: ${(e as Error).message}`, total: ties.length, reportedBest: 0, notBest: [] };
  }
  const notBest: { gameId: number; ply: number }[] = [];
  let reportedBest = 0;
  for (const t of ties) {
    const gameSans = gameSansByGame.get(t.gameId)!;
    const tp = { rank: 1, ply: t.playedPly, san: t.playedSan };
    let line;
    try {
      line = buildTurningLines(t.gameId, [tp], gameSans)?.[0];
    } catch {
      notBest.push({ gameId: t.gameId, ply: t.playedPly });
      continue;
    }
    const fb = followedBest(line, gameSans);
    if (fb?.followed === true) reportedBest++;
    else notBest.push({ gameId: t.gameId, ply: t.playedPly });
  }
  return { name, status: "ok", total: ties.length, reportedBest, notBest };
}

async function evalReporter3(ties: RawPair[], db: Database.Database): Promise<ReporterResult> {
  const name = "3. highlightLines.matchedBest (buildHighlightLines)";
  let buildHighlightLines: any;
  let reconstructPvLine: any;
  try {
    ({ buildHighlightLines } = await import("../server/annotator/highlightLines"));
    ({ reconstructPvLine } = await import("./truth-check"));
  } catch (e) {
    return { name, status: "n/a", detail: `import failed: ${(e as Error).message}`, total: ties.length, reportedBest: 0, notBest: [] };
  }
  const notBest: { gameId: number; ply: number }[] = [];
  const outOfScope: { gameId: number; ply: number }[] = [];
  let reportedBest = 0;
  const rowsCache = new Map<number, any[]>();
  const linesCache = new Map<number, any[]>();
  for (const t of ties) {
    let rows = rowsCache.get(t.gameId);
    if (!rows) {
      const raw = db
        .prepare(
          "SELECT ply, san, uci, eval_cp as evalCp, eval_mate as evalMate, best_move as bestMove, pv, highlighted, side FROM moves WHERE game_id = ? ORDER BY ply"
        )
        .all(t.gameId) as any[];
      rows = raw.map((r) => ({ ...r, highlighted: !!r.highlighted, side: r.side ?? undefined }));
      rowsCache.set(t.gameId, rows);
    }
    // buildHighlightLines only emits a line for a ply with moves.highlighted
    // = 1 (its own filter, server/annotator/highlightLines.ts:179) -- a
    // mate-tie ply she never marked highlighted has NO verdict from this
    // reporter at all, which is not the same as a not-best verdict.
    const isHighlighted = !!rows.find((r) => r.ply === t.playedPly)?.highlighted;
    if (!isHighlighted) {
      outOfScope.push({ gameId: t.gameId, ply: t.playedPly });
      continue;
    }
    let lines: any[] | undefined = linesCache.get(t.gameId);
    if (!lines) {
      try {
        lines = buildHighlightLines(rows, (fenSeed: string, ev: any) => reconstructPvLine(fenSeed, ev));
      } catch (e) {
        lines = [];
      }
      linesCache.set(t.gameId, lines ?? []);
    }
    const line = (lines ?? []).find((l: any) => l.ply === t.playedPly);
    if (line?.matchedBest === true) reportedBest++;
    else notBest.push({ gameId: t.gameId, ply: t.playedPly });
  }
  return { name, status: "ok", total: ties.length, reportedBest, notBest, outOfScope };
}

async function evalReporter4(
  ties: RawPair[],
  gameSansByGame: Map<number, GameSans[]>
): Promise<ReporterResult> {
  const name = "4. review arrow producer (reviewArrowsForMove)";
  let buildTurningLines: any;
  let followedBest: any;
  let reviewArrowsForMove: any;
  try {
    ({ buildTurningLines } = await import("./replay-check"));
    ({ followedBest } = await import("../src/review/followedBest"));
    ({ reviewArrowsForMove } = await import("../src/game/reviewArrows"));
  } catch (e) {
    return { name, status: "n/a", detail: `import failed: ${(e as Error).message}`, total: ties.length, reportedBest: 0, notBest: [] };
  }
  const notBest: { gameId: number; ply: number }[] = [];
  let reportedBest = 0;
  for (const t of ties) {
    const gameSans = gameSansByGame.get(t.gameId)!;
    const tp = { rank: 1, ply: t.playedPly, san: t.playedSan };
    let line;
    try {
      line = buildTurningLines(t.gameId, [tp], gameSans)?.[0];
    } catch {
      notBest.push({ gameId: t.gameId, ply: t.playedPly });
      continue;
    }
    const fb = followedBest(line, gameSans);
    let arrows: any[];
    try {
      arrows = reviewArrowsForMove(line, { fb, gameSans });
    } catch {
      notBest.push({ gameId: t.gameId, ply: t.playedPly });
      continue;
    }
    // Her own ply (mate ties are all hers, per the label): the SUBJECT
    // half collapses her played move to a single "found" arrow when the
    // producer reads it as best (madeIsBest). reviewArrowsForMove ALSO
    // always draws an OTHER-half arrow (mallow's own reply, colour
    // "mallow"/secondary) regardless of the subject verdict -- so the
    // right check is "a found-coloured arrow at the played square,"
    // never "exactly one arrow total" (that undercounted on first pass:
    // a real 2-arrow render with the subject correctly collapsed to
    // found was misread as not-best until this was corrected against a
    // hand-checked example, game 85 ply 69).
    const madeArrowIsFound = arrows.some(
      (a) => a.color === "found" && a.from === line.playedFromTo?.from && a.to === line.playedFromTo?.to
    );
    if (madeArrowIsFound) reportedBest++;
    else notBest.push({ gameId: t.gameId, ply: t.playedPly });
  }
  return { name, status: "ok", total: ties.length, reportedBest, notBest };
}

function renderTable(r: ReporterResult): string {
  if (r.status === "n/a") return `### ${r.name}\n\nn/a: ${r.detail}\n`;
  const lines = r.notBest.map((x) => `${x.gameId}:${x.ply}`).join(", ") || "(none)";
  const scored = r.outOfScope ? r.total - r.outOfScope.length : r.total;
  const rows = [
    `### ${r.name}`,
    "",
    "| n scored | reported best | reported not-best | not-best list |",
    "|---|---|---|---|",
    `| ${scored} | ${r.reportedBest} | ${r.notBest.length} | ${lines} |`,
  ];
  if (r.outOfScope) {
    const oos = r.outOfScope.map((x) => `${x.gameId}:${x.ply}`).join(", ") || "(none)";
    rows.push("", `out of this reporter's scope (not a highlighted ply, no verdict at all): ${r.outOfScope.length} -- ${oos}`);
  }
  rows.push("");
  return rows.join("\n");
}

async function main() {
  const { dbPath, label, resultsDir } = parseArgs(process.argv.slice(2));
  await loadKeepsMateSchedule();
  // Reporters 1/2/4 call buildTurningLines, which reads through
  // getMoveEvalsByPlies over server/store/db.ts's own module-level `db`
  // singleton -- only ever opened by openDb(), which is read-write (WAL
  // pragma + migrateSchema). The rules-block's "never openDb(), never a
  // write" is about the OWNER'S db; it is honoured here by never pointing
  // openDb() at dbPath itself. Instead: copy the db triple to a scratch
  // path (copyScratchDb, the same routine truth-check.ts/replay-check.ts
  // already use for exactly this reason -- never reinvented), openDb()
  // only that copy, and read the label/raw pairs off the SAME copy so
  // every number in this report comes from one consistent snapshot.
  const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
  const scratchPath = path.join(TOOL_DIR, ".mate-tie-sweep-scratch", "girlchess.db");
  const { copyScratchDb } = await import("./truth-check");
  copyScratchDb(dbPath, scratchPath);
  const { openDb } = await import("../server/store/db");
  const db = openDb(scratchPath);
  try {
    const rawPairs = loadRawPairs(db);
    const buckets = new Map<Bucket, RawPair[]>([
      ["tie", []],
      ["shorter", []],
      ["no-eval", []],
      ["other", []],
    ]);
    for (const p of rawPairs) buckets.get(classify(p))!.push(p);
    const ties = buckets.get("tie")!;
    const shorter = buckets.get("shorter")!;
    const noEval = buckets.get("no-eval")!;
    const other = buckets.get("other")!;

    const gameIds = Array.from(new Set(ties.map((t) => t.gameId)));
    const gameSansByGame = new Map<number, GameSans[]>();
    for (const id of gameIds) gameSansByGame.set(id, loadGameSans(db, id));

    const r1 = await evalReporter1(ties, gameSansByGame);
    const r2 = await evalReporter2(ties, gameSansByGame);
    const r3 = await evalReporter3(ties, db);
    const r4 = await evalReporter4(ties, gameSansByGame);

    const out: string[] = [];
    out.push(`# mate-tie sweep${label ? ` -- ${label}` : ""}`);
    out.push("");
    out.push(`db: ${dbPath}`);
    out.push(`keepsMateSchedule source: ${keepsMateScheduleSource}`);
    out.push("");
    out.push("## population");
    out.push("");
    out.push("| bucket | n | expected |");
    out.push("|---|---|---|");
    out.push(`| tie (exact schedule kept) | ${ties.length} | 34 |`);
    out.push(`| shorter (played mate faster than the stored best's) | ${shorter.length} | 5 |`);
    out.push(`| no-eval (no eval stored after the move) | ${noEval.length} | 18 |`);
    out.push(`| other (a real, worse deviation -- not scored here) | ${other.length} | (unreported) |`);
    out.push("");
    out.push("## reporters, over the 34 tie plies");
    out.push("");
    out.push(renderTable(r1));
    out.push(renderTable(r2));
    out.push(renderTable(r3));
    out.push(renderTable(r4));
    out.push("## not swept");
    out.push("");
    for (const n of NOT_SWEPT) out.push(`- ${n}`);
    out.push("");

    const text = out.join("\n");
    console.log(text);

    if (label) {
      fs.mkdirSync(resultsDir, { recursive: true });
      const outPath = path.join(resultsDir, `2b-mate-tie-${label}.md`);
      fs.writeFileSync(outPath, text);
      console.log(`\nwrote ${outPath}`);
    }
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
