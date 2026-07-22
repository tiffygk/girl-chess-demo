# The coach was too slow. I didn't pay to fix it.

*Why this matters: the obvious fix was the wrong one. The coach's live narration was timing out and quietly serving canned templates instead of real answers. The fast fix was a metered API, a monthly bill for a tool only I use. I diagnosed it from my own telemetry and kept it free. The fix also proved the architecture was built to absorb it.*

*Status: decided 2026-07-21, in build. Post-3.95, not part of the shipped increment below. Update this line to "shipped" once the agent-sdk backend merges, before this repo goes to anyone.*

## The problem, from the traces, not a hunch

Every coach reply writes a trace row: which backend served it, whether it was a real model answer or a fallback template, and how long it took. I read the rows instead of guessing.

Chat was fine, about 9 seconds a reply. The live narration was not. The in-game nudges and warnings run on a 15-second budget, and 13 of 14 nudges and 16 of 23 warnings had blown that budget and dropped to a canned template. On those surfaces I mostly wasn't getting the coach at all. I was getting the deterministic fallback, and from the outside it looked identical.

The cause: the coach spawns a fresh `claude` process for every message. Most of those 9 seconds is the process booting, not the model thinking. Same brain, cold start, every time.

## Three options, weighed

| Option | Speed / reply | Marginal cost | Verdict |
| --- | --- | --- | --- |
| Metered API (Sonnet) | ~1-2s | ~$10-15/mo, off my plan | Rejected |
| Warm the CLI (Agent SDK) | boot once, then ~2-4s | $0, stays on my plan | Chosen |
| Leave it | ~9s, timing out to templates | $0 | Not viable |

The API was the fast, easy answer. I turned it down. This is a personal, single-user tool. Paying a recurring bill to shave seconds off a coach only I talk to is spending money for no reason. The API stays documented as the path for a future hosted version anyone can play, where my personal account can't be the auth anyway. Not now.

The warm fix keeps one process alive instead of rebuilding it per message. The boot cost gets paid once at startup, not on every question. It stays on my Claude plan, so it's still $0. A warm reply lands in a few seconds, well inside the 15-second budget, which is what actually kills the template fallback.

## The part that made it cheap to build

The warm path drops in as a third `CoachBackend`: a name, an availability check, generate, behind the swap-seam interface I designed three increments earlier. The narrator, the chat, and the validator already take a backend without caring which one. Adding this one won't touch any of them. The switch that picks a backend gains one branch.

When the requirement showed up, the architecture had already made room for it.

## The other half: it felt fast because I stopped blocking myself

The chat popped up as a window in the middle of the screen, over the board. Even a fast reply made me stop and wait on it. The fix moves the chat into the coach's corner under the board, where the coach already lives, and makes it non-blocking. I can keep playing while a reply generates.

That split is the point. The warm backend fixes how long the reply takes. The corner fixes how long it feels. Different problems. A fast reply behind a blocking modal still stops you. A slow reply you can play through mostly doesn't. I needed both, and the fixes are independent.

One detail I insisted on. When I ask about a specific hint, the chat records that hint as a message from the coach, tagged with the move number, before my question. Without it the thread is a list of my questions with no context, because the hint used to live in a separate part of the screen the chat never saw. The coach's answer only reads as an answer if the thing it's answering is in the thread.

---

# The coach gave me bad advice. I didn't reach for a bigger model.

*Why this matters: the coach told me something false about my own position, confidently. The reflex is to throw a stronger model or an engine check at it. Both are the wrong tool. The bug was that the coach couldn't see defenders, and whether one piece guards another is not something an engine tells you. I fixed it by computing the fact and checking the answer against it, which was cheaper and more certain than either.*

*Status: built 2026-07-21, on the defender-grounding branch, pending merge. Update this line to "shipped" once it merges.*

## What it got wrong

Mid-game I asked the coach whether my pawn on e4 protected my bishop on f5. It said no, that e4 did not guard f5, and that my bishop was hanging. That is wrong. A pawn on e4 covers f5. I know, because a few moves later that exact trade happened: her bishop took mine on f5, my e4 pawn took back. The coach had told me a defended piece was in danger.

The judge made the same mistake from the other side. When I lined up a move it warned me I was opening the door and losing the f5 bishop. I was not. The pawn still guarded it. Two surfaces, one blind spot: neither could see that a piece was defended.

## The fix I didn't build

The tempting fix is to run every coach answer past Stockfish before it sends. Verify the chess, then reply. I didn't.

Stockfish hands back a move and an evaluation. It never says "e4 guards f5." Whether one square defends another is geometry, and geometry is a lookup, not a search. Reaching for the engine to answer it is reaching for the wrong tool. It would cost me, too: an engine call on every chat message, on the one surface I had just worked to make fast, and it breaks a rule I set early that the chat never touches the engine's queue.

## The fix I did

Compute the defenders directly. chess.js already knows, in a fraction of a millisecond, which pieces attack and defend any square. So I hand the coach that map as a fact before it answers, and I check its answer against the same map before it sends. If it claims a defended piece is hanging, that is a contradiction, and it retries or falls back on the path that was already there. No engine, no new latency.

The deterministic warning got the same fix, and there it is a guarantee, no model in the loop to second-guess. A capture on a square you can recapture on is a trade, and the copy now says so instead of calling it a loss.

## What it doesn't fix

It is still a language model. The defender facts close the specific hole, the false claims about what guards what. They do not make the coach right about everything. And notice what a bigger model would have bought me here: nothing on the deterministic half, which was half the bug. The answer was not a smarter brain. It was giving the one I had the facts, and refusing to let it contradict them.
