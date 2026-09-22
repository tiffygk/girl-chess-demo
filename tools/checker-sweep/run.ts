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
  const relationInGrammarCell = newCell();
  const relationSemanticCutCell = newCell();
  const relationOutOfScope = { n: 0 };
  const relationParaphrase = { n: 0, caught: 0 };
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
      relationInGrammarCell.n++;
      if (claim.label && relationFlagged) {
        relationInGrammarCell.falseAlarms++;
        pushExample(relationInGrammarCell, claim.text, claim.label, `trace ${id}: true claim flagged as a violation`);
      }
      if (!claim.label && !relationFlagged) {
        relationInGrammarCell.misses++;
        pushExample(relationInGrammarCell, claim.text, claim.label, `trace ${id}: false claim NOT flagged (miss)`);
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

      // paraphrases: recall table only, never scored as pass/fail
      for (const p of claim.paraphrases) {
        const { relationFlagged: pFlagged } = runBoth(p, facts);
        relationParaphrase.n++;
        // "caught" = the checker flagged a claim that is actually FALSE --
        // the only case where an out-of-grammar catch would matter.
        if (!claim.label && pFlagged) relationParaphrase.caught++;
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
    `| relation, in-grammar | ${relationInGrammarCell.n} | ${relationInGrammarCell.falseAlarms} | ${pct(relationInGrammarCell.falseAlarms, relationInGrammarCell.n)} | ${relationInGrammarCell.misses} | ${pct(relationInGrammarCell.misses, relationInGrammarCell.n)} | -- | -- |`
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
  lines.push("## relation paraphrase recall table (UNMEASURED, never scored as passes)");
  lines.push("");
  lines.push(
    `n = ${relationParaphrase.n} paraphrases of false in-grammar relation claims; ${relationParaphrase.caught} were flagged anyway (recall ${pct(relationParaphrase.caught, relationParaphrase.n)})`
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
  dumpCell("relation in-grammar", relationInGrammarCell);
  dumpCell("relation semantic cut", relationSemanticCutCell);
  dumpCell("today's-board placement control", placementControlCell);
  dumpCell("today's-board relation control", relationControlCell);
  fs.writeFileSync(examplesPath, ex.join("\n") + "\n");

  db.close();

  console.log(`[checker-sweep] label=${args.label} wrote ${sweepPath}`);
  console.log(
    `[checker-sweep] placement false-alarm ${pct(placementCell.falseAlarms, placementCell.n)} (n=${placementCell.n}), ` +
      `placement miss ${pct(placementMissCell.misses, placementMissCell.n)} (n=${placementMissCell.n}), ` +
      `relation false-alarm ${pct(relationInGrammarCell.falseAlarms, relationInGrammarCell.n)}, relation miss ${pct(
        relationInGrammarCell.misses,
        relationInGrammarCell.n
      )} (n=${relationInGrammarCell.n})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
