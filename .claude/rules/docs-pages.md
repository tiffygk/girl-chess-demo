# Docs pages

Purpose: how a public write-up under `docs/` (a technical decision, a results note, a README section) is drafted and approved, so it lands in one pass instead of three (the quiet-move decision took three on 2026-09-21).

The draft is shown to the owner in chat, in full, before it is committed. She rules on text she can read, not on a description of it.

Enumerable content is a table, never a paragraph listing items: a vocabulary, a set of options, the layers of an enforcement, the mechanics that fall inside a category ("castling, promotion, en passant and trade should be in the appropriate table not just as text under the tables"). Colour the header row of every table with the docs diagram palette (lavender `#6c5ce7` on white, light lavender `#f3f0fb`, gray `#e5e5e5`) as inline HTML; github.com strips the style and still renders the table.

The "what it cost" paragraph names the concrete thing given up and the concrete thing still unchecked, in plain words. No booster adjective on an abstract noun ("an honest term", "a real edge", "a genuine gain"): the voice profile bans "real" and the same test applies to every booster.

The section follows the existing shape of the page it joins (`docs/technical-decisions.md`: for the player, the evidence, what it cost, where this lives) and stays in the first person.

Run `avoid-ai-writing` on the draft; the owner still reads it.
