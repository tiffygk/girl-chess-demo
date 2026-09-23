# Docs pages

Purpose: how a public write-up under `docs/` (a technical decision, a results note, a README section) is drafted and approved, so it lands in one pass instead of three (the quiet-move decision took three on 2026-09-21).

The draft is shown to the owner in chat, in full, before it is committed, and so is every revision: never a pointer to the draft file ("Put the step 5 draft in here for me to read because I don't want to have to hunt down the MD file", 2026-09-22). She rules on text she can read, not on a description of it.

Enumerable content is a table, never a paragraph listing items: a vocabulary, a set of options, the layers of an enforcement, the mechanics that fall inside a category ("castling, promotion, en passant and trade should be in the appropriate table not just as text under the tables"). Colour the header row of every table with the docs diagram palette (lavender `#6c5ce7` on white, light lavender `#f3f0fb`, gray `#e5e5e5`) as inline HTML; github.com strips the style and still renders the table.

The limits section names the concrete thing given up and the concrete thing still unchecked, in plain words, under a heading that says what it holds ("What it cannot catch yet"); "What it cost" only when something was actually given up. A risk nobody has observed is stated as unmeasured, never as a cost and never as "I have not seen it", which claims a search that did not happen. When the limits section ends the entry, close on what comes next (owner rulings on the 2026-09-22 technical decision). No booster adjective on an abstract noun ("an honest term", "a real edge", "a genuine gain"): the voice profile bans "real" and the same test applies to every booster.

The section follows the existing shape of the page it joins (`docs/technical-decisions.md`: for the player, the evidence, its limits, where this lives) and stays in the first person.

Every table gets a title that defines its units in plain words (what a "statement" or a "rejection" is). Statistical terms mean exactly this: precision is the share of rejections that were actually wrong, quoted from real data only because a generated set's mix is chosen; recall is the share of false items caught; the false positive rate is the share of true items wrongly rejected. A small note under a table says which set each row was measured on and why.

Run `avoid-ai-writing` on the draft; the owner still reads it.
