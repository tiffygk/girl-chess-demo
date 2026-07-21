# Where the review earned its keep

*Why this matters: this is the argument that adversarial review isn't overhead. It caught an honesty bug, a security hole, and a regression before any of them shipped, in one increment, one week.*

Every build round at Girl Chess runs a build agent, then a separate reviewer that reads the diff cold and pushes back. Three catches from increment 3.95 show what that second pass is actually for.

## 1. The honesty gate had the direction backwards

**Caught:** debrief notes tell you what a better move would have opened up: "wins the knight," "leads to mate in 4." The first version of that logic (`src/review/opportunity.ts`) checked whether a mate or a capture happened anywhere in the line. It never checked which side it favored. Since the player is always white, a line where *she* got mated, or where the *opponent* won material, could still read as good news.

**Why it mattered:** three real lines proved it wasn't theoretical. A Fool's Mate line reported "leads to mate in 2" while she was the one getting mated. A line where black captured her pawn reported "wins the pawn." A zwischenzug (capture, check, block, recapture two moves later) read as "wins the bishop" for what was actually an even trade, because the guard only looked one move ahead. For a tutor whose entire pitch is that its claims are provably true, telling a beginner a losing line is a win is the worst possible failure mode.

**What shipped instead:** the logic was rewritten so every claim proves a gain for the player specifically. A mate claim only fires if the model confirms the opponent is the one mated. A material claim sums the full swing across the whole line, signed by side, and only fires above a minor-piece threshold: a single pawn doesn't count, and a delayed recapture nets to zero instead of reading as a miss. If white's net is negative, the fallback text doesn't fire either. Nothing gets dressed up as good news that isn't.

## 2. A build agent reached for the wrong permissions flag

**Caught:** the live-coach feature spawns a `claude` subprocess to generate chat replies and in-game narration. The first working version used `--dangerously-skip-permissions` to stop the subprocess from hanging on an interactive trust prompt.

**Why it mattered:** the coach reads player-typed chat text straight into the model's context, since that's the point of a chat feature, it answers questions about your game. A flag that disarms every permission check on that subprocess means a prompt-injection attempt hidden in a chat message wouldn't just be able to *ask* for something dangerous. It could *execute* it.

**What shipped instead:** `--strict-mcp-config --tools ""`, no MCP servers, no tools at all. Same fix for the original problem (the subprocess stops hanging), but now there's nothing for an injected instruction to run even if the model got fooled by one. Verified directly: asked the CLI, under the new flags, to ignore its instructions and write a file. It refused, and no file appeared.

## 3. A fix for one bug shipped a second one

**Caught:** the "ask about this" feature lets you click a turning point or an open hint and ask the coach about that specific moment. A fix earlier in the same round made the chat drop a stale focus, so asking about move 14 didn't accidentally answer as if you'd asked about move 30 instead. On re-review, that fix turned out to break the feature it was protecting: clicking "ask about this" straight from the debrief (the main way anyone would use it) silently lost its own focus before the message ever sent, because the fix's own state check expected a board position that hadn't been set yet.

**Why it mattered:** the bug was invisible from the outside. The chat still responded, just with generic, ungrounded answers instead of naming the actual best move for the moment you clicked on. That's the kind of regression that survives a demo and only shows up once someone's actually relying on it.

**What shipped instead:** `reconcileChatFocus`, the function added to fix the first bug, was left untouched. It was correct. The actual fix was in the click handler: set the board's replay state and the chat focus in the right order, so the state the focus check depends on exists before the check runs. Re-verified live: clicking "ask about this" straight from a turning-point card now gets a real, moment-grounded reply naming the correct move.
