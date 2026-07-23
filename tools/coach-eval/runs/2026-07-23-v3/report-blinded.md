# coach eval v3 -- blinded side-by-side (rep 1)

full answers, never truncated (see README's f1 guard). latency is
intentionally omitted from this file -- see metrics-blinded.md; a fast
column here would fingerprint sonnet and quietly unblind the read.

mechanical scorecards judge voice/format/pipeline-health only. they
cannot judge chess correctness or usefulness -- that is what the owner
preference/consequence columns below are for.

## open-01 -- C3 (probe)

**question:** why is that the best move?

**answer A:**

our chess brain's pick here is your knight on f3 stepping back to e1. her bishop on g4 came out to lean on that knight; once it slides away, the bishop is aiming at nothing and you keep your extra pawn without fussing over the pin.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-02 -- C2 (probe)

**question:** why should i not put this piece here?

**answer A:**

i can't see which piece you set down, so tell me the square and i'll check it. right now the live thing on the board is her bishop on b4 and your bishop on d2 eyeing each other, so if that's the trade you're asking about, say the word.

**answer B:**

not sure which piece you're moving there, since i don't see a move set down yet. put it on the board and ask again, and i'll tell you what it walks into.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (49 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (32 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-03 -- C1

**question:** am i in this spot because of the opening i chose?

**answer A:**

no, your c-pawn opening kept things even. the moment that slipped was your bishop to d2 on move 3, where pushing your c-pawn to c5 was stronger: it goes past her pawns and takes space instead of tucking a bishop behind them. and right now our chess brain reads the position as even again, so nothing's lost.

**answer B:**

not really, it's back to even now. the one dip was move 5, bishop to d2: our chess brain wanted pawn to c5 there, and that's the only ply where the read tipped to her being a bit better.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (57 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (39 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-04 -- C1

**question:** what did i do right so far?

**answer A:**

your opening pawns to c4 and d3 kept things level, and after her pawn to e6 the position is even again, so nothing has slipped. the one moment worth a look: instead of your bishop to d2, our chess brain liked pushing your c-pawn to c5, grabbing space and keeping her from freeing that pawn with c5 herself. that push is still on the board right now.

**answer B:**

your pawn moves to c4 and d3 both kept the game even, even though our chess brain had other picks in mind. you don't need the top move every time to stay level, just one that doesn't hand ground away.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (67 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (40 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-05 -- C1

**question:** what did i do wrong in the opening?

**answer A:**

nothing went wrong, really: the reads stayed even. the one moment to look at is your bishop to d2 on move 3, where pushing your pawn to c5 was stronger, taking space instead of just developing.

and c5 is still on the board for you right now.

**answer B:**

move five, playing your bishop to d2, is where things shifted: from even to her being a bit better. our chess brain wanted your pawn to c5 there instead, grabbing more space and keeping pressure on her advanced pawn on d4 rather than just developing.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (47 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (45 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-06 -- C2

**question:** what is my plan from here?

**answer A:**

our chess brain hasn't worked this moment out yet, so here's what's plainly true: both your knights are still home on b1 and g1, and your king is still in the middle. your bishop on d2 and her bishop on b4 are staring at each other, and hers is defended twice, so trading there just helps her finish developing. getting a knight out and your king tucked away is the thing this position is asking for.

**answer B:**

your bishop takes the bishop on b4 first, that's the move on the table. once it's gone, mallow's knight on c6 loses a defender of the center pawn on d4, and your pawn on d3 or a knight to f3 can start leaning on it.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (76 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (45 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-07 -- C5

**question:** was trading queens a good idea?

**answer A:**

yes. she took your queen and you took back with your rook on e2, and our chess brain still reads you as much better after it. queens off is good news when you're ahead: her queen was the piece giving checks, and without it she has no quick way to stir up trouble around your king.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (56 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-08 -- C5 (probe)

**question:** why is my position worse now than five moves ago?

**answer A:**

it isn't. our chess brain still reads you as much better, the same as it did five moves ago.

what changed is the feel: her rook swung to f6 and now eyes your pawn on f3, but that pawn is guarded twice, by your knight on d2 and your pawn on g2. pressure you've already covered isn't a problem.

**answer B:**

it isn't: our chess brain has called every one of your last ten moves "you're much better," same read now as five moves ago. what changed is her knight on c6 now presses both your pawn on a5 and your knight on b4 at once, and your rook on a4 is doing the job of defending both.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (59 words, 4 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (57 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-09 -- C1

**question:** is my king safe, and why?

**answer A:**

your king's safe right now: every piece she has is still home on the back rank, and nothing touches e1. it's still parked in the middle though, which gets risky once lines open. your knight to f3 clears the last square between your king and castling.

**answer B:**

for now, yes. your king's still on e1 but mallow has no piece near it yet, only a pawn on d4 and one on e6 out. worth castling soon so it's not the only piece standing still while pieces come out around it.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (43 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-10 -- C2

**question:** what is the idea behind my opponent's setup?

**answer A:**

her whole setup leans on that pawn wedged on d4: her knight on c6 and queen on e7 back up the bishop on b4, which is glaring at your bishop on d2, and her knight on f6 leans on your e4 pawn. it's a clamp, she wants your center pawns stuck while she finishes developing. count the defenders of b4 before you consider trading there: two of hers to one of yours.

**answer B:**

mallow's bishop on b4 pins your knight-less setup to nothing dangerous yet, but it's eyeing your bishop on d2, and her pawn on d4 cramps your center by taking away the e3 and c3 squares from your own pieces. the real point of her last few moves, like knight to c6 and bishop to b4, is to keep pressure on your center pawns while getting pieces out fast, since your chess brain kept wanting you to answer with pawn to a5 to challenge her space on the queenside.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (72 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (88 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-11 -- C3

**question:** did i miss a better move a few moves ago?

**answer A:**

your last move, taking back on e4 with the pawn, kept you well ahead. our chess brain liked pushing your a-pawn to a6 there instead: it jabs at her b7 pawn while her king is still stuck in the middle. the recapture didn't cost you anything, so this is a "could have pressed harder" moment, not a slip.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (58 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-12 -- C4

**question:** what is the most important thing about this position?

**answer A:**

your bishop on f5 is attacked by her bishop on c8 and nothing of yours defends it, so it's hanging: free to be taken. our chess brain's line is to take on c8 first; her queen recaptures and you've traded evenly instead of losing a piece.

**answer B:**

your bishop on f5 is hanging, mallow's bishop on c8 attacks it and nothing guards it. taking on c8 first with your bishop trades it off safely and wins the exchange of bishops before she can grab yours for free.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (40 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-13 -- C3

**question:** why did the engine not like my last move?

**answer A:**

good news: it liked it. taking back on e4 with your pawn was our chess brain's own pick there, and it has you clearly better after it.

right now her bishop is leaning on your knight on f3, so that's the thing to look at next.

**answer B:**

that capture was fine, still "you're much better" both before and after. the stronger pick was pushing your pawn to a6: it keeps shoving your passed pawn toward promotion, a bigger threat than trading pawns back on e4.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (38 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-14 -- C3

**question:** what should i have played instead of my last move?

**answer A:**

pushing your a-pawn to a6 was our chess brain's pick over taking on e4. it jabs at her b7 pawn, so she has to spend a move dealing with it while you keep the extra material you'd already won. taking on e4 kept you much better anyway, so nothing was lost.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (51 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-15 -- C4

**question:** is my pawn structure a problem?

**answer A:**

no, your pawns are fine, our chess brain reads the position as even the whole way here. the live thing is your bishop on f5: her bishop on c8 attacks it and nothing of yours defends it. your bishop takes on c8 solves it, and when her queen takes back you've traded a piece that had no safe square left.

**answer B:**

your pawns are fine: no doubling, no isolation, and your c4 and b3 pawns back each other up while d3-e3 form a solid chain. nothing there to worry about right now.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (60 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (31 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-16 -- C5

**question:** what is my worst-placed piece?

**answer A:**

your knight on d2. every square it wants, b3, c4, e4, f3, is sitting under one of your own pawns, so it only has b1 and f1 to crawl back to.

when a piece has nowhere to go but backward, that's the one to fix next.

**answer B:**

your knight on d2 is the worst placed. right now it only has two squares to go to, f1 or b1, both backward and out of the action while your other knight and rooks fight for the board.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (38 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-17 -- C1

**question:** why is the center important here?

**answer A:**

because her pawn on d4 is parked in the middle and takes squares away from your knights before they even come out. your pawn on c4 is the one piece that argues with it: our chess brain wanted that pawn pushed to c5 last move, grabbing space on the side where her pawn can't easily push back. the center matters because whoever owns those squares gets the shorter path to every part of the board.

**answer B:**

your pawns on c4 and d3 next to mallow's on d4 and e6 are jamming into each other, so whoever gets a freer pawn move or opens a line first gets more room for pieces. right now c5 is your strongest push: it hits her pawn on d4 and starts prying the center open in your favor.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (75 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (57 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## open-18 -- C4

**question:** what would a stronger player do here?

**answer A:**

take her bishop on c8 with your bishop, since yours on f5 is attacked and nothing defends it. she takes back with her queen, and you've traded evenly instead of losing the piece for free.

**answer B:**

take the bishop on c8: our chess brain's line is bishop takes on c8, queen takes back. it clears the trade before mallow's knight from f8 can jump in and defend it, netting you the bishop pair for free.

**scorecard A:** completeness pass (ends cleanly) | length pass (35 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (39 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-01 -- C2

**question:** can you explain that hint more?

**answer A:**

push your a-pawn from a4 to a5. our chess brain has been asking for that same push for several turns now, so it isn't a one-off. it takes queenside space while her pieces are busy on the other side; grab it before she has the chance to plant something in front of it.

**answer B:**

pushing your pawn to a5 is the move: it locks down her queenside, since the b5 square is now weak and she can't easily break with a pawn there. that keeps her bishop on b4 stuck for now, without you rushing to trade it off yet.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (53 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-02 -- C2

**question:** why does that move help?

**answer A:**

pushing your pawn to a5 grabs the b6 square, so her bishop on b4 loses a retreat and her queenside pawns stay stuck at home. if she ever plays her b-pawn to b6, you take it and your rook on a1 gets an open file straight down the edge.

**answer B:**

keep it on the board. ask me about a move from this game and i'll break it down.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (49 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (template) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-03 -- C3

**question:** what happens after i play the move you suggested?

**answer A:**

your knight steps back from f3 to e1, out of the way of her bishop on g4. our chess brain says she pulls that bishop back to d7, and your knight comes to d3, where you can then push your f-pawn to f4 and hit her pawn on e5. the retreat isn't backwards, it's a route.

**answer B:**

moving your knight from f3 to e1 is the point, so it can swing to d3 next. from there it backs up a push to f4, cracking the center open while you're already much better, and the point of the line runs all the way to your queen landing on g5, deep in her position.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (56 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (55 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-04 -- C2

**question:** you said to develop, but which piece and why?

**answer A:**

not a piece here: our chess brain wants your pawn to a5. it's been the pick for several turns now, and it clamps the b6 square so her queenside pawns can't come out to meet your bishop's diagonal.

if she leaves it, your pawn sits there cramping her side of the board for free.

**answer B:**

your bishop on d2 can take on b4, trading off mallow's bishop that's pinning nothing but sitting active on your position. after that trade your knight on b1 gets a clean path to c3, backing your center pawns.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (54 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (38 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-05 -- C3 (probe)

**question:** what does that threat actually do to me?

**answer A:**

right now nothing falls: her bishop leans on your knight at f3, but that knight is held three times over, by your other knight, your bishop, and your g-pawn. the cost is that the knight is stuck there doing defense work. move it back to e1 instead: her bishop has nothing left to hit and drops back to d7, and your knight swings to d3 where it presses her pawn on e5.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (72 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-06 -- C3

**question:** if i play your move, how does she respond?

**answer A:**

your knight steps back to e1 and her bishop drops back to d7, since it has nothing left to bite on. then your knight comes to d3, where it eyes her e5 pawn and supports pushing your f-pawn up at her center.

**answer B:**

she drops her bishop back to d7, since it's no longer pinning anything after your knight steps to e1. that clears the way for your knight to swing to d3 next, eyeing her pawn on e5.

**scorecard A:** completeness pass (ends cleanly) | length pass (42 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (36 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-07 -- C4 (probe)

**question:** why is that better than what i was going to play?

**answer A:**

your bishop on f5 is the one piece of yours she's attacking, and nothing of yours guards it. take her bishop on c8 first: she takes back with her queen, and you've traded off your loose piece instead of spending a move running it to safety.

**answer B:**

your bishop takes on c8, trading itself for mallow's bishop that's boxed in behind its own pawns. after mallow retakes with the queen, you've swapped off her worse piece for your good one and kept your position clean.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (38 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-08 -- C4

**question:** what does that move set up for later?

**answer A:**

take her bishop on c8 with yours. your bishop on f5 has no defender and her bishop is eyeing it, so trading it off now settles that on your terms instead of retreating; she takes back with her queen, and your bishop on c3 and knight on f3 still both press her pawn on e5.

**answer B:**

bishop takes on c8 trades off mallow's only good minor piece before it gets active, and after queen takes back on c8, your knight on f3 and bishop on c3 both aim clean at e5 and beyond with no dark-squared bishop left to challenge them.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (55 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (45 words, 1 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-09 -- C3

**question:** break down why my move loses ground.

**answer A:**

you haven't set a move down yet, so there's nothing for me to weigh. what our chess brain likes here is your knight from f3 to e1: it steps out from under her bishop on g4 and heads for d3, where it backs a pawn push to f4 that hits her pawn on e5.

**answer B:**

that one took me longer than i had. ask me again and i'll get you an answer.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (54 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (timeout) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-10 -- C2

**question:** what is the follow-up plan after that move?

**answer A:**

push your pawn from a4 to a5: it grabs queenside space and takes b6 away from her pieces. our chess brain's line stops right there, so the moves after it aren't worked out yet. what stays true either way: your bishop on d2 keeps eyeing her bishop on b4, which her queen and knight both guard, so that trade is on your terms, not hers.

**answer B:**

playing your pawn to a5 takes the square our chess brain flagged as her best move again and again this whole game. grabbing it first shuts down her queenside break before she can use it, leaving you with more room to develop while her pawns stay stuck.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (65 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (47 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-11 -- C2

**question:** which of my pieces does that move activate?

**answer A:**

pushing your a-pawn to a5 isn't a developing move, so it doesn't free a piece directly; what it does is claim space on the queenside and clear a4 for your rook on a1 to step up and swing along that rank. our chess brain still likes it best here. if you want a move that wakes a piece instead, your knight to f3 is the one that gets a new piece into the game.

**answer B:**

pushing your pawn to a5 doesn't activate a piece directly, it locks in space on the queenside so your bishop on d2 and knight on b1 have a calmer position to develop into next. right now that bishop on b4 you're facing is the annoying piece, pinning nothing but eyeing your own bishop on d2. a5 just stops mallow's pawn from ever hitting b5 and cramping your queenside for good.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (74 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (70 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-12 -- C4 (probe)

**question:** how much better is your move than mine?

**answer A:**

not a big jump: our chess brain still reads the position as even either way. the reason it likes your bishop taking on c8 is that your bishop sits there attacked by hers and with nothing guarding it, so you trade it off on your terms; her queen takes back and you've spent nothing.

**answer B:**

our chess brain doesn't hand out a number for that, only which move it favors. here it favors taking on c8 because right now your bishop on f5 is hanging, attacked by her bishop on c8 with nothing guarding it back. trading there clears that attacker instead of leaving your bishop free to be picked off.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (54 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (56 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-13 -- C3

**question:** what am i missing that the hint is pointing at?

**answer A:**

your knight on f3 is the only thing her bishop is aiming at, so step it back to e1. from there it heads to d3 and your f-pawn is free to push to f4, hitting her pawn on e5 while her bishop has nothing to bite on.

**answer B:**

moving your knight to e1 is the point: it clears the way to swing that knight to d3 next, a strong central post supporting your c4 and e4 pawns and opening the door for a later f4 push.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (47 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (38 words, 1 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-14 -- C5

**question:** explain the tactic behind that suggestion.

**answer A:**

your knight to d5 hits two things at once: her rook on f6 and her c7 pawn. she saves the rook, and your knight eats c7 for free. that's a fork, one piece attacking two targets so she can't cover both.

**answer B:**

the knight jumping to d5 hits two things at once, a fork: from d5 it attacks your rook... wait, her rook on f6, and her pawn on c7 in the same move. she can only save one, so you come away up material either way.

**scorecard A:** completeness pass (ends cleanly) | length pass (41 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (45 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-15 -- C5

**question:** what square is the real problem here?

**answer A:**

c7 is the sore spot: her pawn there is undefended, and your knight can reach it. Send your knight to d5, where it hits both her rook on f6 and that c7 pawn at once; that's a fork, one piece hitting two. If her rook steps to d6, your knight takes the pawn on c7 for free.

**answer B:**

c7. your knight to d5 hits it and rook takes on d6, then knight takes on c7 forks the king's rook on f8 and the rook you just dragged to d7.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (57 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing FAIL (casing:uppercase)

**scorecard B:** completeness pass (ends cleanly) | length pass (31 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## narr-16 -- C4

**question:** why does that trade favor me?

**answer A:**

your bishop on f5 is attacked by her bishop on c8 and nothing defends it, so taking on c8 first means you choose the trade instead of having to run. her queen takes back, and your bishop leaves the board having traded itself off rather than retreating a tempo down.

**answer B:**

taking the bishop trades off mallow's only good minor piece pointed at your king's side, while you're left with knight and bishop pair still working. after your bishop takes on c8 and the queen takes back, mallow's rook and queen are stuck a little passive on the back rank while you keep pieces active.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (50 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (54 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-01 -- C2

**question:** what should i play next?

**answer A:**

our chess brain hasn't worked this exact moment out yet. one move earlier it wanted your a-pawn to a5, and that push is still available. worth a look too: her bishop on b4 sits under your bishop on d2, but her queen and knight both guard it, so trading there just swaps bishops.

**answer B:**

keep it on the board. ask me about a move from this game and i'll break it down.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (53 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** pipeline failure (template) -- excluded from every voice/length/pending axis

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-02 -- C3

**question:** what's now unsafe?

**answer A:**

nothing's hanging right now, meaning nothing sits there free to be taken. her bishop on g4 hits your knight on f3, but that knight has three defenders. her knight eyes your pawn on a5, and your rook on a1 covers it, so taking there costs her a knight for a pawn.

**answer B:**

your knight on f3 is getting eyed by mallow's bishop on g4, but it's covered three times over so no worry there. the real thing to watch is your knight to e1, the move our chess brain likes here: it steps out of the pin and keeps your center pawns rolling.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (51 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (51 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-03 -- C2

**question:** which piece should i move?

**answer A:**

our chess brain hasn't worked this moment out yet, so go by what's sitting still: both your knights are still on their starting squares while all her minor pieces are out. bringing your knight to f3 gets one into the game and adds a second defender to your pawn on e4, which her knight on f6 is eyeing.

**answer B:**

your bishop takes on b4 is the move: your bishop on d2 is already attacking mallow's bishop there, and it's only guarded by a knight and queen, both pieces she'd rather keep doing other jobs. it clears the tension and trades off her active bishop for yours.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (58 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (47 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-04 -- C2

**question:** should i castle now?

**answer A:**

you can't yet: your knight still sits on g1, blocking the king's path. move that knight to f3 and the road is clear next turn, plus it guards your center. our chess brain hasn't worked this moment out yet, so that's a path note, not a verdict.

**answer B:**

can't castle yet either side: your knight on g1 blocks kingside, and your queen on d1 with knight on b1 block queenside. move your knight out, say to f3, and kingside castling opens up next turn.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (47 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (36 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-05 -- C4

**question:** is there a capture i should make?

**answer A:**

yes: your bishop takes her bishop on c8, which our chess brain likes here. she'll take back with her queen, and your bishop on f5 was the one piece she could trade off, so you get the swap on your terms instead of hers.

**answer B:**

taking on c8 is the one: your bishop takes the bishop on c8, and after mallow's rook or queen retakes, you've traded off her good bishop for nothing lost.

it's the move our chess brain likes here too, best move at this point in the game.

**scorecard A:** completeness pass (ends cleanly) | length pass (44 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-06 -- C2

**question:** what's the best square for my knight?

**answer A:**

our chess brain hasn't worked this moment out yet, so no verdict on a square. what i can tell you from the board: your queenside knight on b1 can go to c3, where it stands next to your pawns, and your kingside knight can come to f3 where it eyes the center. one thing to weigh first: her bishop on b4 is attacked by your bishop on d2 but guarded twice, by her queen and her knight.

**answer B:**

your knight on b1 has c3 or a3 to choose from, but c3 is the one that does work: it also lets you take the bishop on b4 next since the knight adds a defender your bishop on d2 doesn't need, freeing that bishop to grab the bishop on b4 without losing the trade.

right now that bishop is only attacked once and defended twice, so taking it yet does nothing for you. play knight to c3 first, then look at taking on b4.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (77 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (84 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-07 -- C5

**question:** do i have any threats right now?

**answer A:**

your knight on b4 hits her knight on c6, but it's guarded twice, by her b7 pawn and her rook on f6, so taking there is just a trade, not a win. her knight hits back at your a5 pawn and that same knight, and your rook on a4 covers both. as for which move is strongest here, our chess brain hasn't worked this moment out yet.

**answer B:**

yes, knight to d5 forks two things at once: it hits your opponent's rook on f6 and the pawn on c7, both undefended by anything else. she can only save one.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (67 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (31 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-08 -- C4

**question:** should i trade or keep pieces on?

**answer A:**

trade: your bishop takes hers on c8, and she takes back with her queen. that's what our chess brain likes here, and it solves a real problem, your bishop on f5 is attacked by her bishop and nothing of yours is defending it.

**answer B:**

trade - take the bishop on c8 with your bishop. our chess brain calls that the top move here: it clears the piece attacking your bishop on f5 and simplifies without giving up any ground.

**scorecard A:** completeness pass (ends cleanly) | length pass (43 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (35 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-09 -- C3

**question:** what is my opponent threatening?

**answer A:**

keep it on the board. ask me about a move from this game and i'll break it down.

**answer B:**

mallow's bishop on g4 is lined up on your knight at f3, three of your pieces guard it so it's not hanging, but if she trades there you're forced into a recapture that loosens your king's cover on the g-file. our chess brain's fix here is knight to e1, sidestepping the trade so your position stays clean.

**scorecard A:** pipeline failure (template) -- excluded from every voice/length/pending axis

**scorecard B:** completeness pass (ends cleanly) | length FAIL (57 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-10 -- C3

**question:** where should my rooks go?

**answer A:**

our chess brain hasn't worked rook placement out yet here, so go by what's on the board: your rook on a1 is the only thing defending your a5 pawn, and her knight on c6 is eyeing it. so the rook with freedom is the one on f1, and e1 puts it on the same file as her queen on e7, with only pawns between them.

**answer B:**

our chess brain isn't pointing at a rook move right now, it likes your knight on d2 dropping back to e1. that gets it unstuck and ready to reroute, and it expects mallow to answer with her bishop back to d7. no rook facts to give yet, so hold off on those for now.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (65 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (54 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-11 -- C5 (probe)

**question:** is it safe to push this pawn?

**answer A:**

which pawn do you mean? you've got a few pushes available, and our chess brain hasn't worked this moment out yet, so tell me the square and i'll look at it with you.

**answer B:**

pushing your pawn from f3 to f4 isn't safe: nothing guards f4, so mallow's pawn on e5 just captures it for free. leave that pawn on f3 for now, where your knight and g-pawn back it up.

**scorecard A:** completeness pass (ends cleanly) | length pass (33 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (37 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-12 -- C1

**question:** what's the fastest way to develop?

**answer A:**

our chess brain hasn't worked this exact moment out yet, so here's the plain version: your knight to f3 is the quickest step, since it clears the way for your light bishop and then castling. your dark bishop is already out on d2, so it's the kingside pieces that are holding you up.

**answer B:**

knight from g1 to f3 is your quickest developing move here: it gets a piece out and clears the path to castle short next, tucking your king away fast.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (53 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (29 words, 1 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-13 -- C4

**question:** should i attack the king or play on the queenside?

**answer A:**

neither yet, your bishop on f5 is being attacked by her bishop on c8 and nothing of yours defends it. take on c8 first: she recaptures with her queen, and you've traded the bishop off instead of losing it for free. wing plans can wait until your pieces are safe.

**answer B:**

taking on c8 first is the move our chess brain likes here: your bishop takes mallow's bishop, and after queen retakes on c8 you've traded off her only developed minor piece while yours are all still in play.

that's not a kingside or queenside plan, it's just a free trade in your favor. worry about which wing after that.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (50 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (59 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-14 -- C5

**question:** which side of the board should i play on?

**answer A:**

queenside: your rook on a4, pawn on a5 and knight on b4 are all stacked over there, and her king isn't. right now our chess brain likes your knight to d5, which hits her rook on f6 and her c7 pawn at the same time; she moves the rook, and your knight keeps eyeing c7.

**answer B:**

the queenside, where your rook and knight already sit. your knight on b4 hits her knight on c6, and your pawn on c4 can push to c5 to crack her position open further.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (55 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (33 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-15 -- C4

**question:** is now a good time to open the position?

**answer A:**

not yet: your bishop on f5 is attacked by her bishop on c8 and nothing of yours guards it, so that's the piece asking for attention first. our chess brain's line is your bishop takes on c8; she takes back with her queen and you've traded off a loose piece instead of leaving it hanging. pawn breaks come easier once nothing of yours is sitting undefended.

**answer B:**

not yet, your bishop on f5 is hanging: her bishop on c8 attacks it and nothing defends it. our chess brain's top move here is bishop takes on c8, trading that off so you're not down material before anything else happens.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (66 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (41 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## dir-16 -- C5

**question:** what move keeps my advantage?

**answer A:**

our chess brain hasn't worked this moment out yet, so no named best move from me here. what the board does say: your knight on b4 and her knight on c6 attack each other, and yours is defended by your rook on a4 while hers is defended by her pawn on b7 and her rook on f6. her rook on f6 also eyes your pawn on f3, which your knight on d2 already covers, so count defenders before you decide whether to trade knights on c6.

**answer B:**

your knight to d5 keeps it. it hits the rook on f6 and can't be taken cleanly, so mallow has to give up the exchange or pull back and let you keep pressing.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (86 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length pass (33 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD1 -- C2

**question:** why should i not put this piece here

**answer A:**

that's fine. your knight to f3 develops and nothing on f3 can be taken by her, so there's no reason to avoid it.

**answer B:**

knight to f3 is fine. it develops a piece and adds another defender toward the center, nothing hanging.

**scorecard A:** completeness pass (ends cleanly) | length pass (23 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (18 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD2 -- C3

**question:** is this ok

**answer A:**

that's fine. your knight steps off f3, so her bishop on g4 isn't eyeing it anymore.

**answer B:**

that's fine. it steps your knight away from the bishop's attack while keeping it ready to hop back into the game.

**scorecard A:** completeness pass (ends cleanly) | length pass (16 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (21 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD3 -- C5

**question:** what if i go here

**answer A:**

that's fine. your knight going from b4 to d5 steps it out of the way of her knight on c6, which was hitting it there. next move, keep an eye on that knight of hers, it's the one piece poking at your side of the board.

**answer B:**

that's fine. your knight jumps to d5, hitting the rook on f6 and staying out of reach of anything mallow's got right now.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (23 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD4 -- C4

**question:** what if i put it here

**answer A:**

that's fine. her bishop on c8 is the only piece hitting your bishop, so you trade it off instead of moving away, and she has to spend her queen or rook coming to c8 to take back.

**answer B:**

that's fine. your bishop takes the bishop on c8, trading down and staying even with no risk.

**scorecard A:** completeness pass (ends cleanly) | length pass (37 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (17 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD5 -- C3

**question:** why should i not put this here

**answer A:**

taking on e5 loses your knight: her queen on e7 and her knight on c6 both guard that pawn, so you'd win a pawn and she'd win a knight. our chess brain likes your knight to e1 instead: it steps off the square her bishop on g4 is aiming at, so the bishop has nothing to hit and you keep everything.

**answer B:**

skip that one: your knight takes the pawn on e5, but that pawn is guarded twice, by the queen on e7 and the knight on c6, while only your knight is attacking it. she just recaptures with her knight, and you've traded your knight for a single pawn.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (61 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (48 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD6 -- C4

**question:** is this ok

**answer A:**

careful here: her d6 pawn just takes your bishop back, and a pawn isn't worth a bishop.

if you want a trade instead, your light-square bishop takes on c8 and her queen recaptures, swapping bishops evenly and pulling her queen off d8.

**answer B:**

taking on e5 opens the door for her knight on f6 to recapture toward the center, but here it also lines you up for her bishop on c8 to grab your bishop on f5 right back, since your own bishop on f5 has no defender. you'd trade a pawn for a pawn, but your bishop on f5 stays hanging after.

**scorecard A:** completeness pass (ends cleanly) | length pass (42 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (60 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD7 -- C5

**question:** what happens if i do this

**answer A:**

you trade your knight for hers, and her b7 pawn takes back on c6 straight away. our chess brain flags that as risky: her rook on f6 keeps leaning on your f3 pawn while your side of the board gets one less defender. our chess brain hasn't named a better move here yet, so look for one that keeps your knight guarding.

**answer B:**

taking on c6 just trades knights: her pawn on b7 recaptures and the position stays level there. moving your knight to d5 instead was stronger, it forks her rook on f6 and her pawn on c7, hitting two things at once.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (62 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (41 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD8 -- C4

**question:** is this a good idea

**answer A:**

your bishop on f5 is being attacked by her bishop on c8, and nothing of yours defends it, so the pawn push leaves it hanging. take on c8 with that bishop instead: she recaptures with her queen and you've traded evenly instead of handing it over.

**answer B:**

pushing to h3 is a nudge, not a problem, but it skips the free trade sitting right there: your bishop on f5 can take the bishop on c8, and if the queen recaptures, you've traded off her good bishop for a pawn move's worth of time. taking on c8 is stronger since it settles the tension immediately instead of leaving your bishop on f5 to be dealt with later.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (46 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (69 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD9 -- C5

**question:** why not here

**answer A:**

our chess brain hasn't looked at that push yet, so here's what's on the board: her b-pawn can take on a6, and if your rook takes back there, it stops covering your knight on b4, which her knight on c6 is already eyeing. that knight would be hanging, free to be taken. check what your rook is guarding before you move it up the file.

**answer B:**

our chess brain hasn't worked that moment out yet, so no verdict on pushing to a6. what i can tell you: right now your knight on b4 is hit by her knight on c6, and your rook on a4 is the only thing guarding both it and your pawn on a5 — a6 doesn't add any defense there.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (65 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (58 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## PD10 -- C2

**question:** wait should i do this instead

**answer A:**

our chess brain hasn't looked at that one yet, so here's what the board says: her bishop on b4 is guarded twice, by her queen and her knight, so your bishop takes and she just takes back. that's an even trade, not a free piece, so pick it only if you actually want her bishop off the board.

**answer B:**

our chess brain hasn't judged this exact bishop trade yet, so i can't grade it as a verdict. what i can say: taking on b4 trades off mallow's bishop and opens the file for your rook later. still your move to decide, but no red flags jump out from the position itself.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (58 words, 2 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (52 words, 3 sentences (limit 45w/3s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## AF1 -- C3

**question:** is this fine

**answer A:**

that's fine. your knight steps out of her bishop's attack and keeps your pawn on e4 guarded.

**answer B:**

that's fine. it pulls your knight out of the pin and off the fork on d4, keeping your pieces working together.

**scorecard A:** completeness pass (ends cleanly) | length pass (17 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (21 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## AF2 -- C5

**question:** this looks safe to me, right

**answer A:**

that's fine. your knight to d5 steps out of the reach of her knight on c6 and lands on her rook on f6, so she has to move it or defend it. that buys you a free move while she sorts it out.

**answer B:**

that's fine. your knight to d5 hits the rook on f6, and if it moves your knight can hop into c7 forking king and rook.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (43 words, 3 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (25 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## AF3 -- C4

**question:** i think this is right

**answer A:**

that's fine. your bishop on f5 was undefended and her bishop on c8 was eyeing it, so taking it first trades on your terms; she takes back with her queen or rook and you've saved yourself a retreat.

**answer B:**

that's fine. your bishop takes the bishop on c8, trading off a piece that had no better squares left after the retreat to f8.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (38 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (24 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## AF4 -- C5

**question:** am i doing ok so far

**answer A:**

yes, our chess brain has you much better. right now your knight to d5 hits her rook on f6, so she has to spend a move shuffling it back while your knight sits in the middle for free.

**answer B:**

you're doing more than ok, you're much better here. the position flipped your way back at move 22, when taking on e4 with your knight let you recapture with the pawn and rip her position open. since then our chess brain has had you clearly ahead every move.

**scorecard A:** completeness pass (ends cleanly) | length FAIL (38 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**scorecard B:** completeness pass (ends cleanly) | length FAIL (48 words, 3 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---

## AF5 -- C2

**question:** quick check, this ok

**answer A:**

that's fine. your knight comes out and leans on her pawn on d4.

**answer B:**

that's fine. it develops your knight and adds a defender to your pawn on e4.

**scorecard A:** completeness pass (ends cleanly) | length pass (13 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**scorecard B:** completeness pass (ends cleanly) | length pass (15 words, 2 sentences (limit 20w/2s)) | jargon pass (clean) | ai-ism/casing pass (clean) | pending-awareness pass (mentions the pending move)

**owner: preference (A/B/tie):** 

**owner: explains the consequence (y/n):** 

---
