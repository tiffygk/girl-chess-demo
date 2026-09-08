// tools/voice-tells.ts
//
// Voice-align round 2026-09-08, wave V4. The owner's ruling for this round
// was "I just importantly want this to not increase latency by more than 1
// or 2 seconds," with the chat construction rate to be "lower, measured
// each round" -- this tool is that measurement. It is a report, never a
// gate: it always exits 0 and never fails a build.
//
// Reads advice_traces rows with source = 'model' (a real model reply, never
// a persona-template fallback) whose created_at is on or after --since,
// grouped by kind (chat, nudge, warning), and counts how many match each
// AI-writing "tell" pattern. Opens the db exactly the way tools/gate.ts's
// checkInPlay does (Database(dbPath, { readonly: true })) -- readonly,
// never checkpoints, never writes -- per the round's standing rule that her
// data/girlchess.db is never opened read-write by an agent.

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KINDS = ["chat", "nudge", "warning"] as const;
export type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export interface Tell {
  name: string;
  pattern: RegExp;
}

// Case-insensitive by construction (the "i" flag) -- the brief is explicit
// that matching is case-insensitive. Order matches the brief's list so the
// printed table lines up with what a reader would expect from it.
export const TELLS: Tell[] = [
  { name: "em or en dash", pattern: /[—–]/i },
  { name: "double hyphen", pattern: / -- /i },
  { name: "spaced hyphen as dash", pattern: /\S - \S/i },
  {
    name: "contrast shape",
    pattern:
      /it's not [^.]{0,60}, it's|isn't about|not just [^.]{0,40}, |not really [^.]{0,40}, more /i,
  },
  {
    name: "hollow real",
    pattern: /\breal (slip|gift|ground|pressure|issue|reason|plan|mistake|answer|comparison)\b/i,
  },
  { name: "worth", pattern: /\bworth (a look|knowing|noting|flagging|a rewind)\b/i },
  { name: "hook", pattern: /\bthat's the thing\b|\bhere's the (real|thing)\b/i },
  { name: "let's", pattern: /\blet's\b/i },
  { name: "quietly as softener", pattern: /\bquietly\b/i },
  {
    name: "persona word list",
    pattern:
      /\b(delve|leverage|robust|comprehensive|seamless|pivotal|crucial|nuanced|genuinely|myriad|plethora|holistic|impactful)\b/i,
  },
];

// Reported alongside the tells but never counted as one: "quiet move",
// "quiet developing move", "quiet king" are ordinary chess vocabulary, not
// the softener use of "quietly" the tell above is trying to catch.
export const QUIET_CHESS_CARVE_OUT: RegExp = /\bquiet (move|developing|king)\b/i;

// Reported-only rows (controller ruling, ledgered report-V4.md, 2026-09-08):
// the strict "contrast shape" and "hollow real" tells above came in well
// under this wave's ballpark estimate (contrast 4/67 vs ~15/67, hollow real
// 5/67 vs ~12/67 against her real db). These two loosen the shape back to
// what the ballpark likely counted, but are printed for visibility only --
// never counted toward tellCounts or anyTellCounts. The strict rows above
// stay the counted metric per the controller's ruling.
export const LOOSE_CONTRAST: RegExp = /\bit's not\b|\bisn't about\b|\bnot just\b|\bnot really\b/i;
export const BARE_REAL: RegExp = /\breal \w+\b/i;

function zeroKindRecord(): Record<Kind, number> {
  return { chat: 0, nudge: 0, warning: 0 };
}

export interface VoiceTellsResult {
  totals: Record<Kind, number>;
  tellCounts: Record<string, Record<Kind, number>>;
  quietCarveOutCounts: Record<Kind, number>;
  anyTellCounts: Record<Kind, number>;
  looseContrastCounts: Record<Kind, number>;
  bareRealCounts: Record<Kind, number>;
}

// Opens dbPath { readonly: true } -- copied from tools/gate.ts's
// checkInPlay (Database(dbPath, { readonly: true })) -- reads, and closes.
// Never writes, never checkpoints, never VACUUMs.
export function computeVoiceTells(dbPath: string, since: string): VoiceTellsResult {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT kind, output FROM advice_traces WHERE source = 'model' AND created_at >= ?`
      )
      .all(since) as { kind: string; output: string | null }[];

    const totals = zeroKindRecord();
    const tellCounts: Record<string, Record<Kind, number>> = {};
    for (const tell of TELLS) tellCounts[tell.name] = zeroKindRecord();
    const quietCarveOutCounts = zeroKindRecord();
    const anyTellCounts = zeroKindRecord();
    const looseContrastCounts = zeroKindRecord();
    const bareRealCounts = zeroKindRecord();

    for (const row of rows) {
      if (!isKind(row.kind)) continue;
      const kind = row.kind;
      totals[kind]++;
      const text = row.output ?? "";
      let matchedAny = false;
      for (const tell of TELLS) {
        if (tell.pattern.test(text)) {
          tellCounts[tell.name][kind]++;
          matchedAny = true;
        }
      }
      if (QUIET_CHESS_CARVE_OUT.test(text)) quietCarveOutCounts[kind]++;
      if (LOOSE_CONTRAST.test(text)) looseContrastCounts[kind]++;
      if (BARE_REAL.test(text)) bareRealCounts[kind]++;
      if (matchedAny) anyTellCounts[kind]++;
    }

    return {
      totals,
      tellCounts,
      quietCarveOutCounts,
      anyTellCounts,
      looseContrastCounts,
      bareRealCounts,
    };
  } finally {
    db.close();
  }
}

function fraction(n: number, total: number, label: Kind): string {
  return `${label} ${n}/${total}`;
}

export function formatReport(result: VoiceTellsResult): string {
  const lines: string[] = [];
  lines.push("tell | chat n/N | nudge n/N | warning n/N");
  for (const tell of TELLS) {
    const c = result.tellCounts[tell.name];
    lines.push(
      `${tell.name} | ${fraction(c.chat, result.totals.chat, "chat")} | ` +
        `${fraction(c.nudge, result.totals.nudge, "nudge")} | ` +
        `${fraction(c.warning, result.totals.warning, "warning")}`
    );
  }
  lines.push(
    `quiet chess carve-out (not counted as a tell) | ` +
      `${fraction(result.quietCarveOutCounts.chat, result.totals.chat, "chat")} | ` +
      `${fraction(result.quietCarveOutCounts.nudge, result.totals.nudge, "nudge")} | ` +
      `${fraction(result.quietCarveOutCounts.warning, result.totals.warning, "warning")}`
  );
  lines.push(
    `loose contrast (reported) | ` +
      `${fraction(result.looseContrastCounts.chat, result.totals.chat, "chat")} | ` +
      `${fraction(result.looseContrastCounts.nudge, result.totals.nudge, "nudge")} | ` +
      `${fraction(result.looseContrastCounts.warning, result.totals.warning, "warning")}`
  );
  lines.push(
    `bare real (reported) | ` +
      `${fraction(result.bareRealCounts.chat, result.totals.chat, "chat")} | ` +
      `${fraction(result.bareRealCounts.nudge, result.totals.nudge, "nudge")} | ` +
      `${fraction(result.bareRealCounts.warning, result.totals.warning, "warning")}`
  );
  lines.push(
    `rows with any tell: chat ${result.anyTellCounts.chat}/${result.totals.chat}, ` +
      `nudge ${result.anyTellCounts.nudge}/${result.totals.nudge}, ` +
      `warning ${result.anyTellCounts.warning}/${result.totals.warning}`
  );
  return lines.join("\n");
}

export function parseArgs(argv: string[]): { db: string; since: string } {
  let db = "data/girlchess.db";
  let since = "2026-08-04";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db" && argv[i + 1] != null) {
      db = argv[++i];
    } else if (argv[i] === "--since" && argv[i + 1] != null) {
      since = argv[++i];
    }
  }
  return { db, since };
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { db, since } = parseArgs(process.argv.slice(2));
  const result = computeVoiceTells(db, since);
  console.log(formatReport(result));
  process.exit(0);
}
