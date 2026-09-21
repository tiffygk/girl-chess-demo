# Technical decisions

Three decisions from building this chess coach. In each one the obvious fix was the wrong one. I measured before I believed it. All three shipped on 2026-07-22.

## The coach gave wrong answers, and a bigger model was not the fix

The coach answers questions about your game while you play. It used to work out where your pieces were by reading back through the move list, and it got that wrong often enough to matter. Now it reads the position the app has already computed. A check catches any claim that contradicts the board before the answer reaches you.

For the player: wrong statements about where pieces stand went from 7.5% to 0. The wait on an explanation question went from 13 to 15 seconds down to about 4 seconds.

### The evidence

Before the change, 1 in 13 piece-placement statements were false, and nothing checked them. The same questions were also the slowest on the whole product, because the model was working out the position live instead of reading an answer the app already held.

Both numbers held for Sonnet and Opus. The two models were tied on these two measures. A bigger model does not fill a gap in the facts. It reasons more fluently from the same missing information.

Getting an honest measurement took two attempts. The first one leaned on a language model as the judge. Its "wrong" pile and its "accurate" pile disagreed with ground truth at almost the same rate, 13% versus 5%. No discriminating power, so I retired it. One of the mechanical checks was flattering itself too. It asked whether the coach knew about the move being considered, and its raw pass rate read about 70%, because it counted a square as known whenever a piece happened to be there already. A hand audit put the genuine rate near 4 in 14, and that is the number I reported.

The rebuilt measurement, baseline v2, runs the same fixed questions against both models: completeness 100% for both, length within budget 25% for Sonnet and 3% for Opus, jargon-free 53% and 15%, latency medians about 9.7 seconds for both.

### What it cost

The coach gave up room to reason. Every placement claim now has to survive a check against the board, and a claim that fails never reaches you, interesting or not.

![Placement errors fell to zero and explanation answers got faster](images/diagrams/placement-errors-before-after.svg)

Where this lives: question routing in `server/coach/intent.ts`, the facts and the validator in `server/coach/chat.ts`, the harness in `tools/coach-eval/`, and the full results in [the eval dashboard](coach-eval-v3-dashboard.html).

## The coach was too slow, and I did not pay to fix it

The coach talks to you during the game, not only when you ask it something. Those live comments run on a fifteen second budget. They missed it so often that most of what I saw was a canned template rather than a real answer. Keeping one assistant process warm instead of starting a new one per message fixed it without adding a bill.

For the player: live narration now lands in about 3.6 seconds and chat in about 7.

### The evidence

Every coach reply writes a row saying which path served it, whether it was a real answer or a fallback template, and how long it took. I read the rows rather than guessing.

Chat was acceptable, about 9 seconds a reply. The live comments were not. 13 of 14 nudges and 16 of 23 warnings had blown the budget and dropped to a template. From the outside, a template looks like a real answer. Most of those 9 seconds was the process starting up, not the model thinking.

That gave three options. A metered interface would answer in about 1 to 2 seconds for about $10 to $15 a month, billed outside my personal plan. Starting one assistant once and keeping it warm would answer in 2 to 4 seconds at $0, still on the plan. Leaving it alone kept the 9 seconds and the templates.

### What it cost

I turned down the fastest option. Only I use this tool. A recurring bill to save a second or two on it buys nothing. The metered interface stays documented as the route for a hosted version, where a personal account could not be the login anyway.

The other half of the fix cost me a layout. The chat used to open as a window over the board, so even a quick reply made me stop and wait for it. It now sits in the coach's corner, beside the board on a wide screen and under it on a laptop. I can keep playing while a reply arrives. The warm process fixes how long a reply takes. The corner fixes how long it feels. Both were needed.

![The three options weighed, and what the chosen one did to reply time](images/diagrams/coach-latency-options.svg)

Where this lives: the warm path drops in as a third coach backend behind a swap seam designed three increments earlier, and every reply it serves writes a trace row.

## The coach could not tell which pieces were protected

Mid game I asked whether my pawn on e4 protected my bishop on f5. The coach said no, and called the bishop undefended. It was defended. A separate warning told me I was about to lose that same bishop, and I was not. Two surfaces, one blind spot.

For the player: the app works out which pieces protect which directly from the board. That map goes to the coach as a fact, and any claim that contradicts it never sends. The warning calls a capture you can take back a trade rather than a loss.

### The evidence

The game settled it a few moves later. mallow, the computer opponent, took my bishop on f5 with hers, and my e4 pawn took back: the recapture the coach had said was not there. The warning had made the same mistake from the other direction, so the model was not the only thing getting it wrong.

### What I did not do

The tempting fix was to run every answer past the chess engine first. I rejected it. The engine returns a move and a score. It never says that one square protects another, because that is geometry rather than a search. It would also have cost an engine call on every chat message, on the one surface I had just made fast. It breaks a rule I set early on: the chat never touches the engine's queue.

What I built instead closes one specific hole, false claims about what protects what. It does not make the coach right about everything else, and it should not be read that way.

![A claim is checked against the board instead of the engine](images/diagrams/defender-check-flow.svg)

Where this lives: the defender map is read off the board by the chess library the app already carries, and the claim check runs in the coach's validator before an answer sends.
