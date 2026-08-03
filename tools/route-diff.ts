// tools/route-diff.ts -- one-shot audit for the 2026-08-03 router fix:
// route every REAL player chat message under the pre-fix router (tier-1
// only, frozen inline below) and the shipped classifyIntent, print every
// flip for hand review. By construction flips can only be board->general
// (tier 1 and the board default are byte-identical); any flip whose message
// is genuinely a board question means a tier-2 marker is too wide -- tighten
// it BEFORE shipping, don't let the owner's playtest find it.
//
// Caveat for the reviewer: historical focus/pending state is not persisted
// per message, so this diffs TEXT-ONLY routing (bare live ctx). A real call
// that had hasFocus/hasPendingMove would have routed board under both old
// and new regardless -- so the flip list here is a superset of real
// behavior changes, which is the safe direction for an audit.
//
// NOTE (Task 4 Step 1, verified 2026-08-03): the plan assumed the non-coach
// role value is 'player'; the real chat_messages table stores 'user' (the
// only other value alongside 'coach') -- see server/store/db.ts's
// insertChatMessage and manager.ts's chat() call sites. Adjusted below per
// the plan's own contingency instruction ("if it differs, adjust the
// constant").
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIntent } from "../server/coach/intent";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(repoRoot, "data", "girlchess.db");
const db = new Database(dbPath, { readonly: true });

// Owner-db rule: verify by counting before trusting any girlchess.db.
const counts = db
  .prepare("SELECT (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM moves) AS moves")
  .get() as { games: number; moves: number };
if (!counts.games || !counts.moves) {
  throw new Error(`refusing ${dbPath}: zero counts (games=${counts.games}, moves=${counts.moves}) -- shadow copy?`);
}
console.log(`db: ${dbPath} (games=${counts.games}, moves=${counts.moves})`);

// The PRE-FIX router, frozen: tier-1 marker => general, else board.
// (GENERAL_MARKER_RE as shipped at commit time of the fix -- keep in sync
// with the git history, not with live intent.ts, or the diff is vacuous.)
const TIER1_RE =
  /\b(how do i|how should i|when should i|what is an?|why do people|in general|generally|next game|next time i play|get better at|is it worth|is it better|difference between|separates|stud(?:y|ying|ies))\b/i;
const oldRoute = (m: string) => (TIER1_RE.test(m) ? "general" : "board");

const rows = db
  .prepare("SELECT game_id, text FROM chat_messages WHERE role = 'user' ORDER BY id")
  .all() as { game_id: number; text: string }[];

let flips = 0;
for (const r of rows) {
  const before = oldRoute(r.text);
  const after = classifyIntent(r.text, { hasFocus: false, hasPendingMove: false, status: "in-progress" });
  if (before !== after) {
    flips++;
    console.log(`FLIP game ${r.game_id}: ${before} -> ${after} :: ${JSON.stringify(r.text)}`);
  }
}
console.log(`${rows.length} real player messages scanned, ${flips} route flips`);
