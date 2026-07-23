# The coach's advice was sometimes wrong, and it wasn't the model.

*Why this matters: the coach was giving confidently wrong chess answers. The obvious read is "the model isn't smart enough, try a bigger one." I measured before I believed that story. The real problem was a fact gap, not a model-quality gap: the coach was doing chess reasoning it should never have been doing, from facts it was never given. Feeding it the facts the app had already computed fixed accuracy and latency at the same time, for a smaller model and a larger one, which turned model choice into a downstream decision instead of the fix.*

*Status: shipped 2026-07-22, merged to main. Placement-claim errors: 7.5% -> 0. Explanation-question latency: 13-15s -> ~4s. Both numbers held for Sonnet and Opus.*

## What was wrong

The coach answers questions about your game in chat. That meant handing the model a game history and letting it reason out where pieces were and what a position meant. It got that wrong often enough to matter: 1 in 13 piece-placement statements were false, and nothing checked them before they reached the screen. Explanation questions ("why is this move good") were also the slowest surface, 13-15 seconds, because the model was doing chess reasoning live instead of reading an answer that already existed.

## The fix I didn't reach for

The tempting fix is a bigger model: Opus over Sonnet, reasoning its way to a better answer. I didn't do that first, on purpose. A model asked to reconstruct a chess position from a move list is redoing work the app already did, more slowly and less reliably, no matter its size.

## The fix I did

The engine had already analyzed every ply, and the hint system had already computed its own facts, both sitting in the database, unused by chat. I threaded that persisted analysis into the coach's fact list instead of asking the model to re-derive it, and added a deterministic placement-claim check that catches a contradiction before it renders. The coach went from reasoning about the position to reading it.

## Both numbers moved together, for both models

Placement errors: 7.5% to 0. Explanation latency: 13-15s to about 4s. Neither fix was aimed at the other; both came from the same change, because the same missing facts were causing both problems. After the fix, Sonnet and Opus were tied on both axes.

**The consequence:** model tier is a downstream decision. A bigger model cannot fix a missing-fact, structural problem; it only reasons more eloquently wrong. Fix the structure first, then measure whether the model even matters.

## Measuring it instead of trusting it

The first version of this measurement had its own bugs: a display that truncated long answers and made complete replies look cut off, an LLM judge whose "wrong" and "accurate" piles disagreed with ground truth at almost the same rate (13% vs 5%, no discriminating power, retired), and two models answering from different, uncontrolled positions. I rebuilt the eval as a committed, re-runnable harness (`tools/coach-eval/`): 65 questions per model, pinned to five fixed real-game positions, both models answering the identical position, blinded columns, six deterministic mechanical checks, no LLM judge.

Then I audited the checks themselves before reporting them. The jargon checker held up under an independent recount. The "does the coach know about your pending move" checker did not: its raw ~70% counted coincidental square matches (the pending square is often just where a piece already was), and a hand audit found the genuine rate closer to 4 in 14. I reported the audited number, not the flattering one. Baseline v2 results: completeness 100%/100%; length-within-budget 25%/3% (Sonnet/Opus); jargon-free 53%/15%; latency medians ~9.7s both, roughly comparable and not rankable. Full results and the instrument audit: the eval dashboard (vault).

# The coach was too slow. I didn't pay to fix it.

*Why this matters: the obvious fix was the wrong one. The coach's live narration was timing out and quietly serving canned templates instead of real answers. The fast fix was a metered API, a monthly bill for a tool only I use. I diagnosed it from my own telemetry and kept it free.*

*Status: shipped 2026-07-22. The warm agent-sdk backend is the default coach transport on main. Live narration lands in about 3.6 seconds and chat in about 7: real model replies instead of the template fallback the traces caught.*

## The problem, from the traces, not a hunch

Every coach reply writes a trace row: which backend served it, whether it was a real model answer or a fallback template, and how long it took. I read the rows instead of guessing.

Chat was fine, about 9 seconds a reply. The live narration was not. In-game nudges and warnings run on a 15-second budget, and 13 of 14 nudges and 16 of 23 warnings had blown it and dropped to a canned template. On those surfaces I mostly wasn't getting the coach at all, and from the outside the fallback looked identical.

The cause: the coach spawns a fresh `claude` process for every message. Most of those 9 seconds is the process booting, not the model thinking. Same brain, cold start, every time.

## Three options, weighed

| Option | Speed / reply | Marginal cost | Verdict |
| --- | --- | --- | --- |
| Metered API (Sonnet) | ~1-2s | ~$10-15/mo, off my plan | Rejected |
| Warm the CLI (Agent SDK) | boot once, then ~2-4s | $0, stays on my plan | Chosen |
| Leave it | ~9s, timing out to templates | $0 | Not viable |

The API was the fast, easy answer. I turned it down. This is a personal, single-user tool; a recurring bill to shave seconds off a coach only I talk to is money for nothing. The API stays documented as the path for a future hosted version, where my personal account can't be the auth anyway.

The warm fix keeps one process alive instead of rebuilding it per message. The boot cost gets paid once at startup. It stays on my Claude plan, so it's still $0, and a warm reply lands well inside the 15-second budget, which is what actually kills the template fallback.

## The part that made it cheap to build

The warm path drops in as a third `CoachBackend`: a name, an availability check, generate, behind the swap-seam interface I designed three increments earlier. The narrator, the chat, and the validator already take a backend without caring which one. The switch that picks a backend gains one branch. When the requirement showed up, the architecture had already made room for it.

## The other half: it felt fast because I stopped blocking myself

The chat popped up as a window in the middle of the screen, over the board. Even a fast reply made me stop and wait. The fix moves the chat into the coach's corner, beside the board on a wide screen and under it on a laptop, and makes it non-blocking. I can keep playing while a reply generates.

That split is the point. The warm backend fixes how long the reply takes; the corner fixes how long it feels. A fast reply behind a blocking modal still stops you. A slow reply you can play through mostly doesn't. I needed both, and the fixes are independent.

One detail I insisted on: when I ask about a specific hint, the chat records that hint as a coach message, tagged with the move number, before my question. Without it the thread is a list of my questions with no context. The coach's answer only reads as an answer if the thing it's answering is in the thread.

---

# The coach gave me bad advice. I didn't reach for a bigger model.

*Why this matters: the coach told me something false about my own position, confidently. The reflex is to throw a stronger model or an engine check at it. Both are the wrong tool. The bug was that the coach couldn't see defenders, and whether one piece guards another is not something an engine tells you. I fixed it by computing the fact and checking the answer against it: cheaper and more certain than either.*

*Status: shipped 2026-07-22, merged to main. The coach checks its own defender claims against the position before sending, and the deterministic warning calls a recapturable trade a trade instead of a loss.*

## What it got wrong

Mid-game I asked the coach whether my pawn on e4 protected my bishop on f5. It said no: e4 did not guard f5, my bishop was hanging. That is wrong. A pawn on e4 covers f5. I know, because a few moves later that exact trade happened: her bishop took mine on f5, my e4 pawn took back. The coach had told me a defended piece was in danger.

The judge made the same mistake from the other side. When I lined up a move it warned me I was losing the f5 bishop. I was not; the pawn still guarded it. Two surfaces, one blind spot: neither could see that a piece was defended.

## The fix I didn't build

The tempting fix is to run every coach answer past Stockfish before it sends. I didn't. Stockfish hands back a move and an evaluation; it never says "e4 guards f5." Whether one square defends another is geometry, and geometry is a lookup, not a search. It would also cost me an engine call on every chat message, on the one surface I had just made fast, and it breaks a rule I set early: the chat never touches the engine's queue.

## The fix I did

Compute the defenders directly. chess.js already knows, in a fraction of a millisecond, which pieces attack and defend any square. So I hand the coach that map as a fact before it answers, and I check its answer against the same map before it sends. If it claims a defended piece is hanging, that is a contradiction, and it retries or falls back on the path that was already there. No engine, no new latency.

The deterministic warning got the same fix, and there it is a guarantee, no model in the loop. A capture on a square you can recapture on is a trade, and the copy now says so.

## What it doesn't fix

It is still a language model. The defender facts close the specific hole, the false claims about what guards what. They do not make the coach right about everything. And notice what a bigger model would have bought me here: nothing on the deterministic half, which was half the bug. The answer was not a smarter brain. It was giving the one I had the facts, and refusing to let it contradict them.
