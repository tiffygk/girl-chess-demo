// tools/focus-binding-audit.ts
//
// Task 5 of the 2026-08-26 coach-truth round: the false-positive audit that
// gates whether Task 4's validator tightening (commit da350e5, "a focused
// moment governs its own claims, one direction only") may ship.
//
// THE QUESTION
//
// Task 4 made placement and defence claims judge against the FOCUSED
// position when a turning point is in focus. facts.focusPosition is the
// position BEFORE the focused ply (chat.ts:299-305, derived at :627-635 by
// stopping the replay at `m.ply >= focusPly`). But a focused ask is usually
// "what did this move DO", and a truthful answer names squares that only
// exist AFTER the move. Those sentences used to pass because they were true
// in the current position; under Task 4 they flag. The round's own plan
// says: if any TRUE answer newly flags, stop and report -- do not relax the
// rule to make the audit quiet.
//
// So this tool re-adjudicates every focused chat reply the owner has ever
// received, against her own stored facts, under three rules:
//
//   A (old)            a claim passes if it is true in EITHER the current
//                      position or the focused position (the symmetric
//                      intersection that shipped before da350e5).
//   B (new, shipped)   the focused position alone governs.
//   C (focus+1)        the reviewer's proposed remedy: a claim passes if it
//                      is true at the focused position OR at the position
//                      immediately AFTER the focused ply.
//   D (exact A)        rule A's own stated intent, keyed on the CLAIM
//                      rather than on the violation message string. Added
//                      by this audit after rule A was found to leak (see
//                      below); not part of the brief, but it is the rule
//                      the numbers actually point at.
//
// WHY RULE D EXISTS
//
// placementClaims.ts's own header asserts that "the same false claim
// produces the identical string against either position, which is what
// makes the plain-set intersection ... exact". That is FALSE, and this
// audit found the counterexample in her real history. The message's SUFFIX
// records which failure mode fired, and that depends on the position:
//   "placement-claim: your bishop on d6 -- d6 is empty"   (focused position)
//   "placement-claim: your bishop on d6 -- not there"     (current position)
// are the SAME false claim, false in BOTH positions, and the plain-set
// intersection drops it because the strings differ. That is trace 284, the
// round's motivating bug -- the one the owner caught herself with "There is
// no bishop on d6, so I don't really understand what you're talking about."
// Rule A did not let it through because the intersection was too generous
// in principle; it let it through because the intersection was WRONGLY
// IMPLEMENTED. Rule D keys the intersection on the claim (everything before
// " -- " for a placement claim, the square pair for a defence claim) so it
// does what rule A's comment already says it does. Defence-claim messages
// are stable by comparison (they state the truth, which is the negation of
// a fixed claim in every position that flags it), so keying them changes
// nothing; they are keyed anyway so the rule is uniform rather than
// depending on that happening to stay true.
//
// HOW THE THREE RULES ARE COMPUTED (composition, never a reimplementation)
//
// The constraint on this task is that chat.ts and placementClaims.ts must
// not be edited, and rule C must be built by composing what they already
// export. That is possible exactly because A/B/C differ ONLY in which
// position(s) the defence block and the placement call are judged against.
// Everything else validateChat does -- the allowedSans SAN loop,
// checkSideAttributionClaims, checkVoice, checkMateClaims -- reads fields
// (allowedSans, legalSans, toMove, perPlyAnalysis, context.hintFocus,
// context.turningPointFocus) that are IDENTICAL across the three runs and
// never reads facts.focusPosition at all (verified by grep: focusPosition
// appears in validateChat only at chat.ts:1051-1068).
//
// That gives one primitive -- "run the shipped validateChat strictly
// against position P" -- and all three rules fall out of it:
//
//   strict(current) = validateChat(text, {...facts, focusPosition: undefined})
//        with no focusPosition, focusGoverns is false, the defence block
//        takes its `else` branch (the whole currentDefense), and
//        checkPlacementClaims gets no focusOccupancy and returns `current`.
//        That IS strict-against-the-current-position.
//   strict(focus)   = validateChat(text, facts)                    -- rule B as shipped
//   strict(focus+1) = validateChat(text, {...facts, focusPosition: focusPlusOne})
//
//   A = strict(current) INTERSECT strict(focus)                 (by message)
//   B = strict(focus)
//   C = strict(focus)   INTERSECT strict(focus+1)               (by message)
//   D = strict(current) INTERSECT strict(focus)                 (by claim)
//
// The rule-invariant violations appear in both operands of an intersection
// and therefore survive it untouched; only the focus-sensitive ones are
// filtered, which is precisely what rules A and C say. A is thus literally
// the pre-da350e5 behaviour and C is literally "true at focus OR at
// focus+1".
//
// That argument is not taken on faith. Every row additionally runs a
// SELF-CHECK (checkComposition below) that recomputes rule A's placement
// half by calling the exported checkPlacementClaims with focusGoverns=false
// -- the actual shipped intersection code path -- and rule A's defence half
// by intersecting two direct checkDefenseClaims calls, and asserts both
// agree exactly with what the composition produced. The tool aborts if they
// ever disagree.
//
// The defence self-check passes unsafeRecaptureSquares=[] because
// unsafeRecaptureSquaresFrom is not exported; that is only sound while no
// row carries context.threat. Every row is asserted threat-free (see
// assertNoThreat) rather than assumed to be, so the self-check can never
// silently degrade into an approximation.
//
// REPLAY VERIFICATION
//
// focus+1 is derived by replaying the game's own `moves` rows one ply
// further than assembleChatFactList stops. To prove that replay is the same
// replay chat.ts did, the tool FIRST reconstructs the focused position
// itself (stopping at `m.ply >= focusPly`) and asserts the resulting FEN
// equals the stored facts.focusPosition.fen byte for byte. A row whose
// replay disagrees is reported, never quietly scored.
//
// ISOLATION (same hard rule and pattern as tools/truth-check.ts)
//   - NEVER opens data/girlchess.db directly. Copies it plus its -wal/-shm
//     siblings to a gitignored scratch path under tools/.focus-audit-scratch/
//     and calls openDb() only on that copy.
//   - Asserts the opened db's own resolved file (PRAGMA database_list)
//     equals the scratch path, and aborts before reading anything if not.
//   - Counts games/moves and runs integrity_check on the real db before and
//     after (countDbSnapshot/checkDbIntact, imported, never reimplemented).
//     Counts are expected to GROW -- she plays on the main worktree.
//   - Never deletes, writes, or checkpoints the real db; starts no server;
//     spawns no engine.
//
// Run: npx tsx tools/focus-binding-audit.ts
// Exit code 0 when the audit completes; the VERDICT line, not the exit
// code, carries the answer. A structural failure (replay mismatch,
// composition self-check disagreement, isolation violation) exits 1.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import { openDb, getGameMoves } from "../server/store/db";
import { countDbSnapshot, checkDbIntact, resolveRealDbPath } from "./dbCountSnapshot";
import { copyScratchDb } from "./truth-check";
import { validateChat, type ChatFactList } from "../server/coach/chat";
import { checkPlacementClaims, placementClaimRe } from "../server/coach/placementClaims";
import { checkDefenseClaims } from "../server/coach/defenseClaims";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".focus-audit-scratch", "girlchess.db");

interface TraceRow {
  id: number;
  game_id: number;
  ply: number;
  facts_json: string;
  output: string;
}

type FocusPosition = NonNullable<ChatFactList["focusPosition"]>;

// Mirrors server/coach/chat.ts's derivePositionFacts EXACTLY for the two
// fields the focus-sensitive checkers consume (fen + occupancy) plus the
// legalSans/toMove/contested the ChatFactList shape requires. Pure data
// plumbing over a chess.js board -- none of the adjudication logic under
// test lives here, and the fen half of it is falsified against the stored
// focusPosition.fen on every row before any of it is trusted.
//
// The colour mapping is chat.ts's own fixed one: the player is always white
// in v1, so w -> "you" and b -> "mallow".
function derivePosition(chess: Chess, ply: number): FocusPosition {
  const occupancy: FocusPosition["occupancy"] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      occupancy.push({
        square: cell.square,
        pieceKind: cell.type,
        color: cell.color === "w" ? "you" : "mallow",
      });
    }
  }
  const contested: ChatFactList["contested"] = [];
  for (const entry of occupancy) {
    const cell = chess.get(entry.square as Parameters<typeof chess.get>[0]);
    if (!cell) continue;
    const oppColor = cell.color === "w" ? "b" : "w";
    const attackerSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], oppColor);
    if (attackerSquares.length === 0) continue;
    const defenderSquares = chess.attackers(entry.square as Parameters<typeof chess.get>[0], cell.color);
    const toPiece = (sq: string) => {
      const p = chess.get(sq as Parameters<typeof chess.get>[0]);
      return { square: sq, pieceKind: p ? p.type : "" };
    };
    contested.push({
      square: entry.square,
      pieceKind: entry.pieceKind,
      color: entry.color,
      attackedBy: attackerSquares.map(toPiece),
      defendedBy: defenderSquares.map(toPiece),
    });
  }
  return {
    ply,
    fen: chess.fen(),
    toMove: chess.turn() === "w" ? "you" : "mallow",
    occupancy,
    legalSans: chess.moves(),
    contested,
  };
}

function violationsOf(r: { ok: true } | { ok: false; violations: string[] }): string[] {
  return r.ok ? [] : r.violations;
}

function intersect(a: string[], b: string[]): string[] {
  const inB = new Set(b);
  return [...new Set(a.filter((v) => inB.has(v)))];
}

// The identity of the CLAIM a violation message is about, stripped of
// whatever the checker found to be true at the position it ran against.
// Only two message families are position-dependent in that way; everything
// else (voice, side-attribution, mate, unsanctioned SAN) is rule-invariant
// and keys to itself, so intersecting on keys leaves it untouched.
//
//   "placement-claim: <label> -- d6 is empty" / "-- not there"
//        -> "placement-claim: <label>"            (drop the found-reason)
//   "defense-claim: e4 does not guard f5"         -> guard pair (e4, f5)
//   "defense-claim: f5 is undefended"             -> safety square f5
function claimKey(v: string): string {
  if (v.startsWith("placement-claim: ")) {
    const cut = v.indexOf(" -- ");
    return cut === -1 ? v : v.slice(0, cut);
  }
  const guard = /^defense-claim: ([a-h][1-8]) does (?:not )?guard ([a-h][1-8])$/.exec(v);
  if (guard) return `defense-claim/guard: ${guard[1]},${guard[2]}`;
  const safety = /^defense-claim: ([a-h][1-8]) is (?:un)?defended$/.exec(v);
  if (safety) return `defense-claim/safety: ${safety[1]}`;
  return v;
}

// Intersect two violation lists on claim identity rather than on message
// text, keeping the FOCUSED run's own message for each surviving claim.
function intersectByClaim(current: string[], focus: string[]): string[] {
  const currentKeys = new Set(current.map(claimKey));
  return [...new Set(focus.filter((v) => currentKeys.has(claimKey(v))))];
}

function isFocusSensitive(v: string): boolean {
  return v.startsWith("placement-claim:") || v.startsWith("guard-claim:") || v.startsWith("safety-claim:");
}

// Every row must be threat-free for the defence self-check below to be
// exact (see the header). Loud failure, never a silent downgrade.
function assertNoThreat(row: TraceRow, facts: ChatFactList): void {
  if (facts.context?.threat != null) {
    throw new Error(
      `trace ${row.id} carries context.threat -- the composition self-check passes ` +
        `unsafeRecaptureSquares=[] and would silently become an approximation. Thread ` +
        `unsafeRecaptureSquaresFrom through before trusting this run.`
    );
  }
}

// Proves the A-by-composition claim in the header against the shipped code
// paths themselves, per row. Throws on any disagreement.
function checkComposition(
  row: TraceRow,
  facts: ChatFactList,
  focus: FocusPosition,
  composedA: string[]
): void {
  const directPlacementA = checkPlacementClaims(row.output, facts.occupancy, focus.occupancy, false);
  const directDefenseCurrent = checkDefenseClaims(row.output, facts.currentFen, []);
  const directDefenseFocus = new Set(checkDefenseClaims(row.output, focus.fen, []));
  const directDefenseA = directDefenseCurrent.filter((v) => directDefenseFocus.has(v));

  const expected = new Set([...directPlacementA, ...directDefenseA]);
  const got = new Set(composedA.filter(isFocusSensitive));

  const missing = [...expected].filter((v) => !got.has(v));
  const extra = [...got].filter((v) => !expected.has(v));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `trace ${row.id}: composition self-check FAILED for rule A.\n` +
        `  expected (direct calls): ${JSON.stringify([...expected])}\n` +
        `  got (composed):          ${JSON.stringify([...got])}\n` +
        `  missing: ${JSON.stringify(missing)}  extra: ${JSON.stringify(extra)}`
    );
  }
}

// LIVENESS SELF-TEST for rule C.
//
// The audit's headline finding about C is a NULL: no claim in her corpus is
// false at the focused position and true one ply later, so C never rescues
// anything B flags. A null is only worth reporting if the instrument that
// produced it can be shown to fire -- otherwise "C rescues nothing" is
// indistinguishable from "the focus+1 replay is inert". So before scoring
// anything, this synthesises the reviewer's exact shape against a REAL row
// and asserts that B flags it and C does not.
//
// The probe sentence names the square the focused move actually moved a
// piece ONTO, derived from the row's own verified replay -- so it is by
// construction false at the focused position and true at focus+1. If rule C
// does not rescue it, the focus+1 machinery is broken and every C number
// below is meaningless.
function assertFocusPlusOneIsLive(
  facts: ChatFactList,
  focus: FocusPosition,
  focusPlusOne: FocusPosition,
  landedOn: { square: string; pieceWord: string }
): void {
  const probe = `the ${landedOn.pieceWord} on ${landedOn.square} is what changes things here.`;
  const b = violationsOf(validateChat(probe, { ...facts, focusPosition: focus }));
  const c = intersect(b, violationsOf(validateChat(probe, { ...facts, focusPosition: focusPlusOne })));
  const flagsB = b.some((v) => v.startsWith("placement-claim:"));
  const flagsC = c.some((v) => v.startsWith("placement-claim:"));
  if (!flagsB || flagsC) {
    throw new Error(
      `focus+1 liveness self-test FAILED on probe ${JSON.stringify(probe)}: expected rule B to flag ` +
        `and rule C to rescue, got B=${JSON.stringify(b)} C=${JSON.stringify(c)}. The focus+1 replay ` +
        `is not doing what this audit reports it doing; do not trust any C number.`
    );
  }
  console.log(
    `[focus-audit] focus+1 liveness confirmed: probe ${JSON.stringify(probe)} flags under B ` +
      `(${JSON.stringify(b.filter((v) => v.startsWith("placement-claim:")))}) and is clean under C.\n`
  );
}

const PIECE_LETTER_TO_WORD: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

interface RowResult {
  id: number;
  gameId: number;
  focusPly: number;
  focusSide: "hers" | "mallow's";
  a: string[];
  b: string[];
  c: string[];
  d: string[];
  focusPlusOneExists: boolean;
  focusFen: string;
  focusPlusOneFen: string | null;
  output: string;
  // Exposure: how many claims the two focus-sensitive checkers actually
  // adjudicated on this row, and where each landed. A rule that scores
  // "clean" on a reply containing zero placement/defence claims has proven
  // nothing about that rule (CLAUDE.md's invariant rule), so this is
  // reported alongside the verdicts rather than left implicit.
  placementClaimCount: number;
  claimBuckets: string[];
}

// Categorise every placement claim in one reply by where it is true. This
// is the measurement that says whether the corpus actually exercised the
// rule difference at all, or whether B just never had anything to flag.
function bucketPlacementClaims(
  text: string,
  currentOcc: FocusPosition["occupancy"],
  focusOcc: FocusPosition["occupancy"],
  focusPlusOneOcc: FocusPosition["occupancy"] | null
): { total: number; buckets: string[] } {
  const total = [...text.matchAll(placementClaimRe())].length;
  const keysFalseAt = (occ: FocusPosition["occupancy"]) =>
    new Set(checkPlacementClaims(text, occ).map(claimKey));
  const falseNow = keysFalseAt(currentOcc);
  const falseFocus = keysFalseAt(focusOcc);
  const falseP1 = focusPlusOneOcc ? keysFalseAt(focusPlusOneOcc) : null;

  const allKeys = new Set([...falseNow, ...falseFocus, ...(falseP1 ?? [])]);
  const buckets: string[] = [];
  for (const k of allKeys) {
    // Exact triple, never a summarised label -- an approximate bucket name
    // here would be this tool making its own false claim about the data it
    // exists to adjudicate (CLAUDE.md's invariant rule).
    const n = falseNow.has(k),
      f = falseFocus.has(k),
      p = falseP1?.has(k) ?? f;
    const t = (b: boolean) => (b ? "FALSE" : "true");
    const label = `today=${t(n)} focus=${t(f)} focus+1=${t(p)}`;
    let gloss: string;
    if (n && f && p) gloss = "false everywhere -- a real error under every rule";
    else if (!n && f && !p) gloss = "REVIEWER'S SHAPE: names a square the focused move created; C rescues it, B does not";
    else if (n && f && !p) gloss = "REVIEWER'S SHAPE (piece later moved on): C rescues it, B and A do not";
    else if (!n && f && p) gloss = "true only today: A and D pass it, B and C both flag it";
    else if (n && !f) gloss = "true at focus, false today -- the case rule A exists to protect; B, C and D all pass it";
    else gloss = "unclassified";
    buckets.push(`${k} -> ${label}  (${gloss})`);
  }
  return { total, buckets };
}

async function main() {
  const dbResolution = resolveRealDbPath(REPO_ROOT);
  const REAL_DB_PATH = dbResolution.path;
  console.log(`[focus-audit] db source: ${REAL_DB_PATH} (${dbResolution.source})`);
  if (!fs.existsSync(REAL_DB_PATH)) {
    throw new Error(`real db not found at ${REAL_DB_PATH} -- nothing to copy from`);
  }

  const beforeSnapshot = countDbSnapshot(REAL_DB_PATH);
  copyScratchDb(REAL_DB_PATH, SCRATCH_DB_PATH);
  console.log(`[focus-audit] copied ${REAL_DB_PATH} -> ${SCRATCH_DB_PATH}`);

  const dbHandle = openDb(SCRATCH_DB_PATH);
  const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(SCRATCH_DB_PATH)) {
    throw new Error(
      `db isolation violated: openDb resolved to "${resolved}", expected scratch path "${SCRATCH_DB_PATH}". Aborting before any read.`
    );
  }
  console.log(`[focus-audit] db isolation confirmed: ${resolved}`);

  const rows = dbHandle
    .prepare(
      `SELECT id, game_id, ply, facts_json, output
         FROM advice_traces
        WHERE kind = 'chat' AND source = 'model'
          AND json_extract(facts_json, '$.focusPosition.ply') IS NOT NULL
        ORDER BY id`
    )
    .all() as TraceRow[];

  if (rows.length === 0) {
    throw new Error(
      `focus-binding-audit examined ZERO focused chat traces from ${REAL_DB_PATH} -- an audit that ` +
        `reports totals having adjudicated nothing is a false green, not a pass.`
    );
  }
  console.log(`[focus-audit] ${rows.length} focused model chat traces to adjudicate\n`);

  // The reviewer's second claim, verified here rather than asserted: is the
  // turningPointFocus half of validateChat's focusGoverns conjunction an
  // actual narrowing, or is it always true whenever focusPosition is set?
  const focusWithoutTpf = dbHandle
    .prepare(
      `SELECT COUNT(*) c
         FROM advice_traces
        WHERE kind = 'chat' AND source = 'model'
          AND json_extract(facts_json, '$.focusPosition.ply') IS NOT NULL
          AND json_extract(facts_json, '$.context.turningPointFocus') IS NULL`
    )
    .get() as { c: number };

  const results: RowResult[] = [];
  const noFocusPlusOne: number[] = [];
  let livenessProved = false;

  for (const row of rows) {
    const facts = JSON.parse(row.facts_json) as ChatFactList;
    const focus = facts.focusPosition;
    if (!focus) throw new Error(`trace ${row.id}: focusPosition missing after parse`);
    assertNoThreat(row, facts);

    const moves = getGameMoves(row.game_id) as { ply: number; san: string }[];
    const ordered = [...moves].sort((a, b) => a.ply - b.ply);

    // Reconstruct the focused position the way chat.ts:627-635 does, and
    // falsify it against the stored fen before trusting the replay at all.
    const focusChess = new Chess();
    for (const m of ordered) {
      if (m.ply >= focus.ply) break;
      focusChess.move(m.san);
    }
    if (focusChess.fen() !== focus.fen) {
      throw new Error(
        `trace ${row.id} (game ${row.game_id}, focus ply ${focus.ply}): replay does not reproduce the ` +
          `stored focusPosition.fen.\n  replayed: ${focusChess.fen()}\n  stored:   ${focus.fen}\n` +
          `focus+1 cannot be trusted for this row.`
      );
    }

    // focus+1: the position immediately AFTER the focused ply.
    const focusMove = ordered.find((m) => m.ply === focus.ply);
    let focusPlusOne: FocusPosition | null = null;
    if (focusMove) {
      const plusOne = new Chess(focus.fen);
      const applied = plusOne.move(focusMove.san);
      if (!applied) {
        throw new Error(
          `trace ${row.id}: focused move ${focusMove.san} is illegal from the verified focus fen -- ` +
            `the moves table and the stored facts disagree.`
        );
      }
      focusPlusOne = derivePosition(plusOne, focus.ply);
      // Prove once, on real data, that the focus+1 replay can actually
      // change a verdict -- see assertFocusPlusOneIsLive's header. `applied`
      // is chess.js's own move result, so `to`/`piece` are the square the
      // move really landed on, never a guess.
      if (!livenessProved && applied.piece !== "k") {
        assertFocusPlusOneIsLive(facts, focus, focusPlusOne, {
          square: applied.to,
          pieceWord: PIECE_LETTER_TO_WORD[applied.piece],
        });
        livenessProved = true;
      }
    } else {
      noFocusPlusOne.push(row.id);
    }

    const strictCurrent = violationsOf(validateChat(row.output, { ...facts, focusPosition: undefined }));
    const strictFocus = violationsOf(validateChat(row.output, facts));
    const strictFocusPlusOne = focusPlusOne
      ? violationsOf(validateChat(row.output, { ...facts, focusPosition: focusPlusOne }))
      : strictFocus; // no move after the focused ply: C degenerates to B

    const a = intersect(strictCurrent, strictFocus);
    const b = [...new Set(strictFocus)];
    const c = intersect(strictFocus, strictFocusPlusOne);
    const d = intersectByClaim(strictCurrent, strictFocus);

    checkComposition(row, facts, focus, a);

    // Structural invariants: A, C and D are all intersections that include
    // strict(focus), so none can flag anything B does not.
    for (const [name, set] of [
      ["A", a],
      ["C", c],
      ["D", d],
    ] as const) {
      const bSet = new Set(b);
      const rogue = set.filter((v) => !bSet.has(v));
      if (rogue.length > 0) {
        throw new Error(`trace ${row.id}: rule ${name} flagged ${JSON.stringify(rogue)} that rule B does not -- impossible, the composition is wrong`);
      }
    }

    const exposure = bucketPlacementClaims(
      row.output,
      facts.occupancy,
      focus.occupancy,
      focusPlusOne?.occupancy ?? null
    );

    results.push({
      id: row.id,
      gameId: row.game_id,
      focusPly: focus.ply,
      focusSide: focus.ply % 2 === 1 ? "hers" : "mallow's",
      a,
      b,
      c,
      d,
      focusPlusOneExists: focusPlusOne != null,
      focusFen: focus.fen,
      focusPlusOneFen: focusPlusOne?.fen ?? null,
      output: row.output,
      placementClaimCount: exposure.total,
      claimBuckets: exposure.buckets,
    });
  }

  const afterSnapshot = countDbSnapshot(REAL_DB_PATH);
  const intactReason = checkDbIntact(beforeSnapshot, afterSnapshot);
  if (intactReason) throw new Error(intactReason);
  console.log(
    `[focus-audit] real db intact: games ${beforeSnapshot.games} -> ${afterSnapshot.games}, ` +
      `moves ${beforeSnapshot.moves} -> ${afterSnapshot.moves}, integrity ${afterSnapshot.integrity}\n`
  );

  // ---- per-trace table ----
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(
    `${pad("trace", 6)}${pad("game", 6)}${pad("fply", 6)}${pad("side", 9)}${pad("pc", 4)}${pad("A", 5)}${pad("B", 5)}${pad("C", 5)}${pad("D", 5)}  notes`
  );
  console.log("-".repeat(88));
  const mark = (v: string[]) => (v.length === 0 ? "ok" : `x${v.length}`);
  for (const r of results) {
    const notes: string[] = [];
    if (!r.focusPlusOneExists) notes.push("no ply after focus (C=B)");
    if (r.a.length === 0 && r.b.length > 0) notes.push("NEW under B");
    if (r.a.length === 0 && r.c.length > 0) notes.push("NEW under C");
    if (r.a.length === 0 && r.d.length > 0) notes.push("NEW under D");
    console.log(
      `${pad(r.id, 6)}${pad(r.gameId, 6)}${pad(r.focusPly, 6)}${pad(r.focusSide, 9)}${pad(r.placementClaimCount, 4)}` +
        `${pad(mark(r.a), 5)}${pad(mark(r.b), 5)}${pad(mark(r.c), 5)}${pad(mark(r.d), 5)}  ${notes.join("; ")}`
    );
  }
  console.log(`(pc = placement claims the checker actually adjudicated in that reply)`);

  // ---- totals ----
  const cleanA = results.filter((r) => r.a.length === 0);
  const cleanB = results.filter((r) => r.b.length === 0);
  const cleanC = results.filter((r) => r.c.length === 0);
  const cleanD = results.filter((r) => r.d.length === 0);
  const newB = results.filter((r) => r.a.length === 0 && r.b.length > 0);
  const newC = results.filter((r) => r.a.length === 0 && r.c.length > 0);
  const newD = results.filter((r) => r.a.length === 0 && r.d.length > 0);

  console.log(`\n=== totals over ${results.length} focused model chat traces ===`);
  console.log(`clean under A (old, symmetric intersection): ${cleanA.length}/${results.length}`);
  console.log(`clean under B (new, focus governs):          ${cleanB.length}/${results.length}`);
  console.log(`clean under C (focus or focus+1):            ${cleanC.length}/${results.length}`);
  console.log(`clean under D (A, keyed on the claim):       ${cleanD.length}/${results.length}`);
  console.log(`NEWLY flagged by B versus A:                 ${newB.length}`);
  console.log(`NEWLY flagged by C versus A:                 ${newC.length}`);
  console.log(`NEWLY flagged by D versus A:                 ${newD.length}`);

  // ---- exposure: did the corpus actually exercise the rule difference? ----
  const withClaims = results.filter((r) => r.placementClaimCount > 0);
  const totalClaims = results.reduce((n, r) => n + r.placementClaimCount, 0);
  console.log(
    `\nexposure: ${totalClaims} placement claims adjudicated across ${withClaims.length}/${results.length} replies ` +
      `(${results.length - withClaims.length} replies contain NO placement claim at all, so their "clean" verdict ` +
      `is vacuous for every rule).`
  );
  // Task 4 changed the DEFENCE binding as well as the placement binding, so
  // report whether that half was exercised at all rather than letting a
  // corpus-wide "clean" imply it was. A rule difference nothing triggers is
  // untested, not vindicated.
  const defenceExposure = results.reduce(
    (acc, r) => {
      const row = rows.find((x) => x.id === r.id)!;
      const facts = JSON.parse(row.facts_json) as ChatFactList;
      const nCur = checkDefenseClaims(r.output, facts.currentFen, []).length;
      const nFoc = checkDefenseClaims(r.output, r.focusFen, []).length;
      if (nCur > 0 || nFoc > 0) acc.rows += 1;
      acc.current += nCur;
      acc.focus += nFoc;
      return acc;
    },
    { rows: 0, current: 0, focus: 0 }
  );
  console.log(
    `defence claims: ${defenceExposure.rows}/${results.length} replies produce ANY defence-claim ` +
      `violation in either position (${defenceExposure.current} against today, ${defenceExposure.focus} ` +
      `against the focus). ${defenceExposure.rows === 0 ? "The defence half of the A/B/C difference is UNEXERCISED by this corpus -- these numbers say nothing about it." : ""}`
  );

  const bucketTally = new Map<string, number>();
  for (const r of results) {
    for (const b of r.claimBuckets) {
      const label = b.slice(b.indexOf("  (") + 3, -1);
      bucketTally.set(label, (bucketTally.get(label) ?? 0) + 1);
    }
  }
  if (bucketTally.size > 0) {
    console.log(`claims that are false in at least one of the three positions:`);
    for (const [label, n] of [...bucketTally].sort((x, y) => y[1] - x[1])) {
      console.log(`  ${n}  ${label}`);
    }
    for (const r of results) {
      for (const b of r.claimBuckets) console.log(`    trace ${r.id}: ${b}`);
    }
  }
  console.log(
    `\nturningPointFocus gate: ${focusWithoutTpf.c} of the ${results.length} rows have focusPosition ` +
      `WITHOUT context.turningPointFocus.\n  -> the turningPointFocus half of focusGoverns is ` +
      `${focusWithoutTpf.c === 0 ? "NOT a narrowing on this corpus: every focused ask takes the strict path" : "a real narrowing"}.`
  );
  if (noFocusPlusOne.length > 0) {
    console.log(`\nrows with no move after the focused ply (C could not differ from B): ${noFocusPlusOne.join(", ")}`);
  }

  // ---- the newly-flagged rows, in full, for hand adjudication ----
  const toAdjudicate = results.filter(
    (r) => r.a.length === 0 && (r.b.length > 0 || r.c.length > 0 || r.d.length > 0)
  );
  console.log(`\n=== ${toAdjudicate.length} rows to adjudicate by hand ===`);
  const question = dbHandle.prepare(
    `SELECT text FROM chat_messages
      WHERE game_id = ? AND role = 'user'
        AND id < (SELECT id FROM chat_messages WHERE trace_id = ?)
      ORDER BY id DESC LIMIT 1`
  );
  for (const r of toAdjudicate) {
    console.log(`\n--- trace ${r.id} | game ${r.gameId} | focus ply ${r.focusPly} (${r.focusSide}) ---`);
    console.log(`focus fen:    ${r.focusFen}`);
    console.log(`focus+1 fen:  ${r.focusPlusOneFen ?? "(none)"}`);
    console.log(`B flags: ${JSON.stringify(r.b)}`);
    console.log(`C flags: ${JSON.stringify(r.c)}`);
    console.log(`D flags: ${JSON.stringify(r.d)}`);
    const q = question.get(r.gameId, r.id) as { text: string } | undefined;
    console.log(`she asked: ${q ? JSON.stringify(q.text) : "(no preceding user message found)"}`);
    console.log(`output:\n${r.output}`);
  }

  // ---- rows flagged under ALL THREE rules: pre-existing catches, not this round's business ----
  const flaggedUnderA = results.filter((r) => r.a.length > 0);
  if (flaggedUnderA.length > 0) {
    console.log(`\n=== ${flaggedUnderA.length} rows already flagged under A (pre-existing, informational) ===`);
    for (const r of flaggedUnderA) {
      console.log(`trace ${r.id} (game ${r.gameId}, fply ${r.focusPly}): A=${JSON.stringify(r.a)}`);
    }
  }

  console.log(
    `\nVERDICT: B newly flags ${newB.length} of ${results.length} focused replies; C newly flags ${newC.length}; ` +
      `D newly flags ${newD.length}. Whether those are false positives is decided by hand, not by this count ` +
      `-- see .superpowers/sdd/task-5-report.md.`
  );
}

main().catch((err) => {
  console.error(`[focus-audit] FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
});
