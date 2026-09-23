// tools/checker-sweep/run.ts
//
// 2a follow-up round (2026-09-22). Loads the 201 stored chat fact lists
// (advice_traces where kind = 'chat', facts_json), readonly, absolute db
// path (see brief-2a.md's rules-block.md, section "Standing rules"). Uses
// generate.ts to produce labelled claims and validates each through BOTH
// production entry points, validateChat and validateChatGeneral
// (server/coach/chat.ts), with the stored fact list unchanged.
//
// Usage: npx tsx tools/checker-sweep/run.ts --label <sha-or-mutation-name>
//   [--db <absolute path>] [--placement-cap N] [--relation-cap N]
//   [--control-sample N] [--out-dir <dir>]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { validateChat, validateChatGeneral, type ChatFactList } from "../../server/coach/chat";
import {
  placementBoards,
  relationBoards,
  generatePlacementClaims,
  generateRelationClaims,
  generateControlClaims,
  type StoredFactsShape,
  type PlacementClaim,
  type RelationClaim,
} from "./generate";

const DEFAULT_DB =
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/data/girlchess.db";
const DEFAULT_OUT_DIR =
  "/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents/.superpowers/sdd/rounds/2026-09-22-game198-followup/results";

interface Args {
  label: string;
  dbPath: string;
  placementCap: number;
  relationCap: number;
  controlSample: number;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, dflt: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const label = get("--label", "");
  if (!label) throw new Error("--label is required (SHA or mutation name)");
  return {
    label,
    dbPath: get("--db", DEFAULT_DB),
    placementCap: Number(get("--placement-cap", "12")),
    relationCap: Number(get("--relation-cap", "6")),
    controlSample: Number(get("--control-sample", "80")),
    outDir: get("--out-dir", DEFAULT_OUT_DIR),
  };
}

// The message-prefix attribution rule (m2): a violation counts toward a
// family only by its own message prefix, same rule tools/replay-trace.ts's
// scorer uses. Nothing else -- not defense-claim, voice-word, mate-claim,
// or a bare SAN-token allow-list violation.
function hasPrefix(violations: string[], prefix: string): boolean {
  return violations.some((v) => v.startsWith(prefix));
}

function runBoth(text: string, facts: ChatFactList): { placementFlagged: boolean; relationFlagged: boolean } {
  const r1 = validateChat(text, facts);
  const r2 = validateChatGeneral(text, facts);
  const v1 = r1.ok ? [] : r1.violations;
  const v2 = r2.ok ? [] : r2.violations;
  return {
    placementFlagged: hasPrefix(v1, "placement-claim:") || hasPrefix(v2, "placement-claim:"),
    relationFlagged: hasPrefix(v1, "relation-claim:") || hasPrefix(v2, "relation-claim:"),
  };
}

// A claim-free control sentence: no SAN-shaped token, no piece+square
// pattern, no negation word. Must pass both validators or the fact list is
// dropped (m2).
const CONTROL_SENTENCE = "let's keep going and see how the position develops from here.";

interface Cell {
  n: number;
  falseAlarms: number;
  misses: number;
  leniency: number;
  semanticCut: number;
  examples: { text: string; label: unknown; note: string }[];
}

function newCell(): Cell {
  return { n: 0, falseAlarms: 0, misses: 0, leniency: 0, semanticCut: 0, examples: [] };
}

function pushExample(cell: Cell, text: string, label: unknown, note: string): void {
  if (cell.examples.length < 20) cell.examples.push({ text, label, note });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });

  const chatRows = db
    .prepare(
      `SELECT id, game_id as gameId, facts_json as factsJson
       FROM advice_traces WHERE kind = 'chat' AND facts_json IS NOT NULL ORDER BY id`
    )
    .all() as { id: number; gameId: number; factsJson: string }[];

  let droppedControlFail = 0;
  const usable: { id: number; facts: ChatFactList; raw: StoredFactsShape }[] = [];

  for (const row of chatRows) {
    let facts: ChatFactList;
    try {
      facts = JSON.parse(row.factsJson);
    } catch {
      droppedControlFail++;
      continue;
    }
    const { placementFlagged, relationFlagged } = runBoth(CONTROL_SENTENCE, facts);
    if (placementFlagged || relationFlagged) {
      droppedControlFail++;
      continue;
    }
    usable.push({ id: row.id, facts, raw: facts as unknown as StoredFactsShape });
  }

  const placementCell = newCell();
  const placementMissCell = newCell(); // M2: separate miss cell for placement
  // Fix round (2c has its own cause-1 line, after-move false alarms at or
  // under 0.5%, distinct from the whole-family line): a claim is
  // "after-move only" when it is false on the live board and true ONLY via
  // the focused board or a line board (every "adversarial" claim already
  // has trueOnLive === false by construction -- generate.ts always picks a
  // wrong kind -- so this is exactly the label===true subset of
  // "adversarial" claims). Split focus-only vs line-only vs both, since the
  // fields are already on the claim.
  const placementAfterMoveOnlyCell = newCell();
  const placementAfterMoveFocusOnlyCell = newCell();
  const placementAfterMoveLineOnlyCell = newCell();
  const placementAfterMoveBothCell = newCell();
  // Split into a false-alarm arm (n = label-true claims only) and a miss
  // arm (n = label-false claims only), same discipline as the placement
  // family's two cells -- a single mixed-denominator cell understates the
  // miss rate among the claims that can actually be missed.
  const relationFalseAlarmCell = newCell();
  const relationMissCell = newCell();
  const relationSemanticCutCell = newCell();
  const relationOutOfScope = { n: 0 };
  // Fix round (2026-09-22): per-verb, not one lumped number -- "could
  // capture" parses inside standingRelationRe's own grammar
  // (relationClaims.ts:55: its negation-prefix group accepts "could"
  // without treating it as a negation), so it is in-grammar by accident of
  // the paraphrase list, not out-of-grammar, and inflated the combined
  // recall number. Reported separately so the genuinely out-of-grammar
  // recall (the other two verbs) stands on its own.
  const paraphraseByVerb: Record<string, { n: number; caught: number }> = {
    "could capture": { n: 0, caught: 0 },
    "is aiming at": { n: 0, caught: 0 },
    "can be taken by": { n: 0, caught: 0 },
  };
  const placementControlCell = newCell();
  const relationControlCell = newCell();

  for (const { id, facts, raw } of usable) {
    // --- placement family ---
    const pBoards = placementBoards(raw);
    const pClaims: PlacementClaim[] = generatePlacementClaims(pBoards, args.placementCap);
    for (const claim of pClaims) {
      const { placementFlagged } = runBoth(claim.text, facts);
      placementCell.n++;
      if (claim.label && placementFlagged) {
        placementCell.falseAlarms++;
        pushExample(placementCell, claim.text, claim.label, `trace ${id}: true claim flagged as a violation`);
      }
      if (!claim.label) {
        placementMissCell.n++;
        if (!placementFlagged) {
          placementMissCell.misses++;
          pushExample(placementMissCell, claim.text, claim.label, `trace ${id}: false claim NOT flagged (miss)`);
        }
      }
      if (claim.leniency) {
        placementCell.leniency++;
        pushExample(placementCell, claim.text, claim.label, `trace ${id}: leniency (true only via depth ${claim.trueOnLineDepth})`);
      }
      if (claim.kind === "adversarial" && claim.label) {
        // trueOnLive is always false for an adversarial claim (generate.ts
        // picks a kind that is not the live occupant's), so label===true
        // here means true ONLY via the focused board or a line board.
        placementAfterMoveOnlyCell.n++;
        if (placementFlagged) {
          placementAfterMoveOnlyCell.falseAlarms++;
          pushExample(placementAfterMoveOnlyCell, claim.text, claim.label, `trace ${id}: after-move-only true claim flagged as a violation`);
        }
        const focusOnly = !!claim.trueOnFocus && claim.trueOnLineDepth === null;
        const lineOnly = claim.trueOnLineDepth !== null && !claim.trueOnFocus;
        const both = !!claim.trueOnFocus && claim.trueOnLineDepth !== null;
        const bucket = focusOnly
          ? placementAfterMoveFocusOnlyCell
          : lineOnly
            ? placementAfterMoveLineOnlyCell
            : both
              ? placementAfterMoveBothCell
              : null;
        if (bucket) {
          bucket.n++;
          if (placementFlagged) {
            bucket.falseAlarms++;
            pushExample(bucket, claim.text, claim.label, `trace ${id}: flagged as a violation`);
          }
        }
      }
    }

    // --- relation family ---
    const rBoards = relationBoards(raw);
    const rClaims: RelationClaim[] = generateRelationClaims(rBoards, args.relationCap);
    for (const claim of rClaims) {
      if (claim.label === null) {
        relationOutOfScope.n++;
        continue;
      }
      const { relationFlagged } = runBoth(claim.text, facts);
      if (claim.label) {
        relationFalseAlarmCell.n++;
        if (relationFlagged) {
          relationFalseAlarmCell.falseAlarms++;
          pushExample(relationFalseAlarmCell, claim.text, claim.label, `trace ${id}: true claim flagged as a violation`);
        }
      } else {
        relationMissCell.n++;
        if (!relationFlagged) {
          relationMissCell.misses++;
          pushExample(relationMissCell, claim.text, claim.label, `trace ${id}: false claim NOT flagged (miss)`);
        }
      }
      if (claim.semanticCut) {
        relationSemanticCutCell.n++;
        relationSemanticCutCell.semanticCut++;
        pushExample(
          relationSemanticCutCell,
          claim.text,
          claim.label,
          `trace ${id}: attackers()=${claim.attackersLabel} legalCapture=${claim.legalCaptureLabel}`
        );
      }

      // paraphrases: recall table only, never scored as pass/fail. Fix
      // round (2026-09-22), brief-T fix 2: n must count only false claims
      // (recall over false claims is the only quantity "caught" can ever
      // measure) -- counting every in-scope claim, true and false, in n
      // understated recall by folding in true claims that can never be
      // "caught". generate.ts's paraphrasesFor now emits a negated,
      // denial-shaped paraphrase for a denial claim, so a denial's
      // paraphrase truth value matches its own label.
      for (const p of claim.paraphrases) {
        if (claim.label) continue;
        const { relationFlagged: pFlagged } = runBoth(p.text, facts);
        const bucket = paraphraseByVerb[p.verb];
        bucket.n++;
        // "caught" = the checker flagged a claim that is actually FALSE --
        // the only case where an out-of-grammar catch would matter.
        if (pFlagged) bucket.caught++;
      }
    }
  }

  // --- today's-board control family (finished-game positions) ---
  const finishedPositions = db
    .prepare(
      `SELECT m.fen_after as fen
       FROM moves m JOIN games g ON g.id = m.game_id
       WHERE g.result IS NOT NULL AND m.fen_after IS NOT NULL
       ORDER BY g.id, m.ply`
    )
    .all() as { fen: string }[];

  const sampleStep = Math.max(1, Math.floor(finishedPositions.length / Math.max(1, args.controlSample)));
  const sampled = finishedPositions.filter((_, i) => i % sampleStep === 0).slice(0, args.controlSample);

  // Minimal ChatFactList-shaped object for a bare position, built with
  // chess.js directly (run.ts already imports server/coach/chat.ts for the
  // validators, so this is not a generate.ts-style restriction) -- only the
  // fields checkPlacementClaims/checkRelationClaims/validateChat's SAN
  // allow-list actually read.
  const { Chess } = await import("chess.js");
  for (const { fen } of sampled) {
    let occupancy: ChatFactList["occupancy"] = [];
    let legalSans: string[] = [];
    let contested: ChatFactList["contested"] = [];
    try {
      const c = new Chess(fen);
      for (const row of c.board()) {
        for (const cell of row) {
          if (cell) occupancy.push({ square: cell.square, pieceKind: cell.type, color: cell.color === "w" ? "you" : "mallow" });
        }
      }
      legalSans = c.moves();
    } catch {
      continue;
    }
    const minimalFacts: ChatFactList = {
      gameSans: [],
      currentFen: fen,
      toMove: "you",
      occupancy,
      legalSans,
      status: "finished",
      allowedSans: legalSans,
      contested,
    };
    const ctrl = generateControlClaims(fen);
    for (const claim of ctrl.placement) {
      const { placementFlagged } = runBoth(claim.text, minimalFacts);
      placementControlCell.n++;
      if (placementFlagged) {
        placementControlCell.falseAlarms++;
        pushExample(placementControlCell, claim.text, true, "today's-board control, unexpected false alarm");
      }
    }
    for (const claim of ctrl.relation) {
      const { relationFlagged } = runBoth(claim.text, minimalFacts);
      relationControlCell.n++;
      if (relationFlagged) {
        relationControlCell.falseAlarms++;
        pushExample(relationControlCell, claim.text, true, "today's-board control, unexpected false alarm");
      }
    }
  }

  // --- write results ---
  fs.mkdirSync(args.outDir, { recursive: true });
  const sweepPath = path.join(args.outDir, `2a-sweep-${args.label}.md`);
  const examplesPath = path.join(args.outDir, `2a-examples-${args.label}.md`);

  const pct = (num: number, denom: number) => (denom === 0 ? "n/a" : `${((num / denom) * 100).toFixed(2)}%`);

  const lines: string[] = [];
  lines.push(`# checker sweep -- ${args.label}`);
  lines.push("");
  lines.push(`db: \`${args.dbPath}\``);
  lines.push(`chat rows total: ${chatRows.length}; usable after control-sentence check: ${usable.length}; dropped: ${droppedControlFail}`);
  lines.push(`today's-board control positions sampled: ${sampled.length} of ${finishedPositions.length} finished-game positions`);
  lines.push("");
  lines.push("| family | n | false alarms | rate | misses | rate | leniency | semantic cut |");
  lines.push("|---|---|---|---|---|---|---|---|");
  lines.push(
    `| placement (false-alarm arm) | ${placementCell.n} | ${placementCell.falseAlarms} | ${pct(placementCell.falseAlarms, placementCell.n)} | -- | -- | ${placementCell.leniency} | -- |`
  );
  lines.push(
    `| placement (miss arm, false claims only) | ${placementMissCell.n} | -- | -- | ${placementMissCell.misses} | ${pct(placementMissCell.misses, placementMissCell.n)} | -- | -- |`
  );
  lines.push(
    `| placement, after-move only (2c's own cause-1 line: false on live, true only via focus/line) | ${placementAfterMoveOnlyCell.n} | ${placementAfterMoveOnlyCell.falseAlarms} | ${pct(placementAfterMoveOnlyCell.falseAlarms, placementAfterMoveOnlyCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| placement, after-move only -- focus-only | ${placementAfterMoveFocusOnlyCell.n} | ${placementAfterMoveFocusOnlyCell.falseAlarms} | ${pct(placementAfterMoveFocusOnlyCell.falseAlarms, placementAfterMoveFocusOnlyCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| placement, after-move only -- line-only | ${placementAfterMoveLineOnlyCell.n} | ${placementAfterMoveLineOnlyCell.falseAlarms} | ${pct(placementAfterMoveLineOnlyCell.falseAlarms, placementAfterMoveLineOnlyCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| placement, after-move only -- both focus and line | ${placementAfterMoveBothCell.n} | ${placementAfterMoveBothCell.falseAlarms} | ${pct(placementAfterMoveBothCell.falseAlarms, placementAfterMoveBothCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| relation, in-grammar (false-alarm arm) | ${relationFalseAlarmCell.n} | ${relationFalseAlarmCell.falseAlarms} | ${pct(relationFalseAlarmCell.falseAlarms, relationFalseAlarmCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| relation, in-grammar (miss arm, false claims only) | ${relationMissCell.n} | -- | -- | ${relationMissCell.misses} | ${pct(relationMissCell.misses, relationMissCell.n)} | -- | -- |`
  );
  lines.push(
    `| relation, semantic cut (attackers() vs legal capture disagree) | ${relationSemanticCutCell.n} | -- | -- | -- | -- | -- | ${relationSemanticCutCell.semanticCut} |`
  );
  lines.push(
    `| relation, out of scope (non-mover denial, unadjudicable) | ${relationOutOfScope.n} | n/a | n/a | n/a | n/a | n/a | n/a |`
  );
  lines.push(
    `| today's-board placement control | ${placementControlCell.n} | ${placementControlCell.falseAlarms} | ${pct(placementControlCell.falseAlarms, placementControlCell.n)} | -- | -- | -- | -- |`
  );
  lines.push(
    `| today's-board relation control | ${relationControlCell.n} | ${relationControlCell.falseAlarms} | ${pct(relationControlCell.falseAlarms, relationControlCell.n)} | -- | -- | -- | -- |`
  );
  lines.push("");
  lines.push("## relation paraphrase recall table, per verb (UNMEASURED, never scored as passes)");
  lines.push("");
  lines.push("| verb | in grammar? | n (false in-grammar claims paraphrased) | caught anyway | recall |");
  lines.push("|---|---|---|---|---|");
  const cc = paraphraseByVerb["could capture"];
  const ia = paraphraseByVerb["is aiming at"];
  const cb = paraphraseByVerb["can be taken by"];
  lines.push(
    `| "could capture" | YES -- parses inside standingRelationRe (relationClaims.ts:55); its negation-prefix group accepts "could" without treating it as a negation, so this is the paraphrase list's mistake, not a checker bug | ${cc.n} | ${cc.caught} | ${pct(cc.caught, cc.n)} |`
  );
  lines.push(`| "is aiming at" | no | ${ia.n} | ${ia.caught} | ${pct(ia.caught, ia.n)} |`);
  lines.push(`| "can be taken by" | no | ${cb.n} | ${cb.caught} | ${pct(cb.caught, cb.n)} |`);
  lines.push("");
  const outOfGrammarN = ia.n + cb.n;
  const outOfGrammarCaught = ia.caught + cb.caught;
  lines.push(
    `out-of-grammar recall (the two genuinely out-of-grammar verbs combined, "could capture" excluded): ${outOfGrammarCaught} of ${outOfGrammarN} (${pct(outOfGrammarCaught, outOfGrammarN)})`
  );
  lines.push("");

  fs.writeFileSync(sweepPath, lines.join("\n") + "\n");

  const ex: string[] = [`# checker sweep examples -- ${args.label}`, ""];
  const dumpCell = (title: string, cell: Cell) => {
    ex.push(`## ${title}`);
    ex.push("");
    if (cell.examples.length === 0) ex.push("(no example rows -- cell is zero or all examples exceeded the 20-row cap upstream)");
    for (const e of cell.examples) {
      ex.push(`- \`${e.text}\` -- label ${JSON.stringify(e.label)} -- ${e.note}`);
    }
    ex.push("");
  };
  dumpCell("placement false alarms / leniency", placementCell);
  dumpCell("placement misses", placementMissCell);
  dumpCell("placement after-move only", placementAfterMoveOnlyCell);
  dumpCell("placement after-move only, focus-only", placementAfterMoveFocusOnlyCell);
  dumpCell("placement after-move only, line-only", placementAfterMoveLineOnlyCell);
  dumpCell("placement after-move only, both", placementAfterMoveBothCell);
  dumpCell("relation in-grammar false alarms", relationFalseAlarmCell);
  dumpCell("relation in-grammar misses", relationMissCell);
  dumpCell("relation semantic cut", relationSemanticCutCell);
  dumpCell("today's-board placement control", placementControlCell);
  dumpCell("today's-board relation control", relationControlCell);
  fs.writeFileSync(examplesPath, ex.join("\n") + "\n");

  db.close();

  console.log(`[checker-sweep] label=${args.label} wrote ${sweepPath}`);
  console.log(
    `[checker-sweep] placement false-alarm ${pct(placementCell.falseAlarms, placementCell.n)} (n=${placementCell.n}), ` +
      `placement miss ${pct(placementMissCell.misses, placementMissCell.n)} (n=${placementMissCell.n}), ` +
      `relation false-alarm ${pct(relationFalseAlarmCell.falseAlarms, relationFalseAlarmCell.n)} (n=${relationFalseAlarmCell.n}), ` +
      `relation miss ${pct(relationMissCell.misses, relationMissCell.n)} (n=${relationMissCell.n}), ` +
      `after-move-only false-alarm ${pct(placementAfterMoveOnlyCell.falseAlarms, placementAfterMoveOnlyCell.n)} (n=${placementAfterMoveOnlyCell.n})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
