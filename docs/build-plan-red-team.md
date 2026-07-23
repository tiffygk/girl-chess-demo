*Why this matters: I red-team my own plans before executing them. Condensed from the project ledger (`.superpowers/sdd/rounds/2026-07-21-build-plan-review/build-plan-review.md`): a three-agent adversarial panel reviewed the increment-4 build plan against the shipped codebase before any increment-4 code was written. The findings, including the one against my own north star metric, are unsoftened.*

---

# Girl Chess: build-plan adversarial review

Run 2026-07-21. Three-agent panel: two red-team critics (one for the entire project, one for increment 4 onward) and one champion who defends the plan and separates real problems from nitpicks. Grounded against shipped code at `main 9b227b9`. Full panelist findings: `panel-critic-project.md`, `panel-critic-inc4.md`, `panel-champion.md`.

## How to read this

The bar is a personal, local, single-user, $0, non-production project. Production-grade concerns (scale, multi-tenancy, security compliance, HA, observability) were killed at the door. Every finding carries a severity (ARCHITECTURE = changes a schema, seam, dependency, or build order; DETAIL = resolvable inside a feature), the champion's verdict (REAL / REAL-BUT-CHEAP / NITPICK), and the cheapest test or decision that settles it. Agreed nitpicks are collected in one section so you can skip them.

Both critics independently flagged the same top three (the north star is not measurable, the coach transport is load-bearing and slow, the F26 profile is an unfrozen keystone), and the champion conceded all three rather than defending them. When a critic and the champion agree, treat it as settled.

---

## Section 1: the entire project

### Load-bearing findings, ranked

**P1. The north star is currently unmeasurable, and inverted. [ARCHITECTURE · REAL · headline]**
The north star is "every session teaches me something *I* can name." Shipped reality: the only lesson artifact is `debriefLesson.ts`, which the *coach* authors. There is nowhere she names the lesson herself, so the learning mechanism the north star is built on (active recall, her words) is absent, and "something I can name" has quietly become "something the coach names for me." The metric "Notebook entries with real content ÷ sessions" is then either trivially ~1.0 (a coach tag always exists) or vacuously 0 (no her-authored content ever). The denominator is also half-open: `endSession()` is defined but never called, so there is no session-close rule. F24 (the Notebook) is marked shipped but its free-text half is effectively unbuilt.
- Fails if: no session exists where the metric reflects a lesson *she* articulated.
- Cheapest test: finish a game and try to write down what you learned in your own words. There is nowhere to do it.
- Why it is the headline: it is the north star, it is the F24 Notebook, and increment 4 ("it remembers") reads exactly this. Cheap to fix (one free-text line on the debrief where she names the lesson), but it should close before increment 4, not during it.

**P2. The coach's synchronous CLI-per-call transport is load-bearing and slow. [ARCHITECTURE · REAL]** *(Resolved 2026-07-22, see [technical-decisions.md](technical-decisions.md): a warm in-process backend replaced the per-call spawn, and a separate measurement pass found the deeper issue was missing facts, not transport speed alone.)*
Coach replies run 6-9 seconds through a headless `claude` call, against the PRD's own 2-second ship gate. The judge path is safe (code-computed verdict, never waits on the model, confirm never blocked), so this is quarantined to the narration path. But narration is where increment 4 lives: F26 profile narration, F28 opening explainers, F13 phrasing, F16 chat. Five surfaces would each inherit blank-screen-then-paragraph.
- Fails if: any coach-narrated feature makes her wait 6-9s (or fall to a template) often enough that she stops reading it.
- Cheapest test: already run. The 3.95 gate measured 6-9s live; the fix class is a faster path to the model (API, a warm persistent process, or precompute), not a bigger timeout.
- A decision, not a tuning knob: pick the transport before the coach-dependent increment-4 features, so you decide once instead of five times.

**P3. "Player is always white" is hardcoded into the honesty logic. [ARCHITECTURE-if-F46 · REAL, low urgency]**
The zero-fabrication proofs (especially `opportunity.ts` and the seed-ply logic) assume `pv[0]/pv[2]/…` are her moves. True today. But the advertised F46 import seam, or ever playing black, would silently invert every "you win the piece" claim into a confident lie. The `games.source` schema flag is seam-ready; the analysis pipeline is not.
- Fails if: an imported (or play-as-black) game runs through the coach and the honesty claims flip.
- Cheapest test: none needed; it is a code invariant. Document it and stop calling F46 "import-ready," because the pipeline is not.
- Champion's call (correct): document the invariant, do not pay to remove it now. It only becomes ARCHITECTURE the day someone builds the F46 importer.

**P4. The magic-moment two-game lesson loop (H1's showcase) is not deliverable as one clean v1 arc. [DETAIL · REAL]**
The PRD's aha is a two-game arc: coach recreates the taught mistake next game, unaided success is detected and rewarded. Pieces of the re-test (drills, biased situations) are increment-4, and the in-game re-test bias ships off in v1. The hypothesis that carries the north star is the hardest thing to actually stage.
- Fails if: you cannot produce the second-game "you beat it unaided" moment on demand.
- Cheapest test: script one manual two-game arc by hand and see whether the current build can even detect the unaided win.

**P5. Render-only honesty has no fact list for general-knowledge prose. [ARCHITECTURE · REAL]**
The honesty gate works because every claim derives from a chess.js replay of engine output. F28's "the coach explains the opening" is general chess *theory*, not a replay-derived fact. There is nothing to validate it against, so it is the one planned surface where the coach can fabricate inside the guardrails.
- Fails if: the opening explainer states an opening idea that is wrong or made up, and nothing catches it.
- Cheapest test: draft one opening explanation and ask what fact list would have validated it. There isn't one.
- Decision: give opening theory a curated fact source, or carve it out explicitly as "phrasing, not adjudicated truth" and label it in the UI.

### What is well-reasoned (PRESERVE, do not re-litigate)

- **The honesty gate / fact-to-template discipline.** What makes an LLM tutor safe for a beginner who cannot catch a hallucinated move. Repeatedly caught real inversions in review. Do not weaken it for convenience.
- **Judge-never-imports-coach.** This makes the sub-2s, confirm-never-blocked gate structurally true instead of hopeful, and is why P2 (latency) is contained to narration and not a playability problem. Enforced by the alias-proof source-scan gate.
- **Capture-first + render-only determinism.** F40 traces and F42 timers are already 100% complete, so the Lab is pure read/display with zero new capture risk, and every award and turning point is reproducible.
- **The $0 / Ollama-fallback resilience and the additive-migration discipline.** The game never depends on a subscription to run, and no schema change has ever touched her real db destructively.
- **The owner-ruled turning-point definition and the shipped-and-gated 3.95 fixes.** Settled; re-opening them is the "don't re-spend" trap.

### What could not be assessed read-only
Whether the two-ELO model actually separates playing from comprehension in practice (F26/F13 are unbuilt); live coach latency under real usage beyond the gate sample; whether the render-only gate has any current hole outside the F28 general-knowledge case.

---

## Section 2: increment 4 onward

### Load-bearing findings, ranked

**I1. F26 (player profile) is an unfrozen keystone, and the plan builds it in the wrong order. [ARCHITECTURE · REAL-BUT-CHEAP]**
F13, F28, F31, and all coach personalization read the profile. `assembleFactList` has no profile input today. Yet the master plan's increment-4 order is F27 drills first, and the profile shape is never frozen. If the shape is wrong, four features rebuild on top of it.
- Fails if: F28 or F13 starts, then the profile schema changes, and both get reworked.
- Cheapest test: write the F26 profile schema (both ELOs, per-motif miss rates, time-per-move) on one page and check that F13, F28, and F31 can each read what they need. If any can't, the shape is wrong before you write a line.
- Sequencing fix (below): freeze F26 first, or at least before any profile-reading feature.

**I2. The north-star capture gap gates "it remembers." [ARCHITECTURE · REAL]**
P1 seen from the future. Increment 4 is literally "it remembers," and what it remembers is the Notebook + profile. If the Notebook never captures a lesson she named, increment 4 is building memory on top of nothing. Close the capture gap before F26/drills read from it.

**I3. The coach transport is the same slow, sometimes-offline backend every coach-dependent inc-4 feature builds on. [ARCHITECTURE · REAL]** *(Resolved 2026-07-22, see P2.)*
P2 seen from the future. F28 explainers, F13 phrasing, and F26 narration all inherit it, and the offline path silently degrades them to templates. Decide it once, up front.

**I4. F13's "suggested moves reach a 10% Maia play-rate at the advice level" needs a policy distribution the current engine seam does not expose. [ARCHITECTURE · REAL-BUT-CHEAP, needs a spike]**
The engine seam returns a single best move (argmax), not a per-move probability distribution. F13's acceptance criterion assumes access to Maia's move play-rates. If lc0/Maia can emit a policy distribution on her Mac, this is a config flag; if not, F13's core rule is unbuildable as written.
- Fails if: you cannot get per-move probabilities out of the local Maia weights.
- Cheapest test: one spike. Ask lc0 for the policy head output on a position and see if the play-rates come back. Do it before committing to F13's spec.

**I5. The drill pass/fail rubric (F27) is undefined, and drills are the plan's first increment-4 build. [DETAIL · REAL-BUT-CHEAP]**
"A failed drill breaks the streak" needs a definition of pass and fail (first-move-correct? whole-line? within N seconds?). ts-fsrs scheduling keys off it. Write the rubric before F27, not during.
- Cheapest test: define "pass" in one sentence and confirm ts-fsrs's rating input maps to it.

**I6. The playing-ELO and comprehension-ELO update rules are not specified. [DETAIL · REAL-BUT-CHEAP]**
F26 says the profile "tracks" both ELOs; nothing says how they move after a game or drill. Write the update rule as a labeled starting value (like the +200 gap already is), then tune.

### What is already solved (DECISION-GRADE, do not spend time clarifying)

- **The Lab's capture layer.** F40 traces + F42 timers exist and are complete; the Lab is read/aggregate/display, not new capture. The one exception is I2 (the Notebook input), which is the north-star gap, not a Lab-plumbing gap.
- **The Metrics Dashboard Spec's thresholds and verdict combo-rules.** Precise enough to build from as written (north star ≥1.0, hint-escalation <30%, trace completeness 100%, thumbs-up ≥90%, latency p95 <2.0s, the five combo rules). The one real gap is the F19/F40 debrief-template tracing tension, already logged as an owner ruling.
- **The F46 seam (the flag), the additive-migration pattern, ts-fsrs as the chosen scheduler.** Settled; ts-fsrs needs a version-pin spike (I4-adjacent), not a re-decision.

### What could not be assessed read-only
Whether lc0/Maia emits a per-move policy distribution on her Mac (I4's linchpin); the exact ts-fsrs API surface vs F27's rules; whether the two-ELO separation holds empirically once built.

---

## The nitpick-kill list (do NOT spend time on these)

The champion's job was to stop the review from importing production expectations a personal $0 single-user app rejects. These were raised, examined, and killed:

- **The +200 comprehension gap and the +10%/month ELO.** The PRD already labels both as starting assumptions to playtest. Re-flagging them restates the plan's own footnotes.
- **Single-user local SQLite.** Correct for the design. There is no second user. Not a limitation, a decision.
- **Removing "player is always white."** Document the invariant (P3); do not pay engineering to remove it until an importer exists.
- **"No Figma-grade visual spec for the Dashboard, Lab, and Drills."** The sugar-glitch design laws plus the owner visual gate cover new surfaces. A formal spec is production ceremony this project does not need.
- **Engagement mechanics as dark patterns.** The Metrics Spec already excludes XP/streaks/trophies from health metrics on purpose (they fail the behavior-changing test). The vanity-check is built in.
- **Metrics operationalizability (broadly).** Sound as written; the only real corner is the F19/F40 debrief-tracing tension, already an open owner ruling.

---

## Tie-back: what this changes about the plan

The review converts to five pre-build decisions and one sequencing change. All are cheap; the point is to make them before code, not after a rebuild.

**Pre-build decisions (settle before increment 4 coding):**
1. **Close the north-star capture gap.** Add one free-text line to the debrief where *she* names the lesson (the F24 Notebook's missing half). This is the north-star numerator and what "it remembers" reads. Also wire `endSession()` so the denominator closes. (P1/I2)
2. **Decide the coach transport.** Pick the faster path (API + small fast model / warm process / precompute) before any coach-narrated inc-4 feature. One decision, not five. (P2/I3)
3. **Freeze the F26 profile schema.** One page: both ELOs, per-motif miss rates, time-per-move. Confirm F13, F28, F31 can each read what they need. (I1)
4. **Write the ELO-update rule and the drill pass/fail rubric as labeled starting values.** Same discipline the +200 gap already uses. (I5/I6)
5. **Spike F13's policy distribution and pin ts-fsrs.** Confirm lc0/Maia emits per-move play-rates on her Mac before committing to F13's "10% play-rate" spec; pin the ts-fsrs version. (I4)

**Sequencing change to the master plan's increment-4 order:**
- Parallel-safe now, no profile dependency: **F27 drills, F32 XP, F33 streaks** (once the drill rubric in #4 exists).
- Gated on the pre-build decisions: **F26 profile → then F28 starter pack, F13 advice dial, coach personalization, and the profile-driven parts of F41 the Lab.** F26 must be frozen before anything that reads it, which the current order does not guarantee.
- **F28's opening explainer needs the honesty carve-out from P5** (a fact source or an explicit "phrasing, not adjudicated truth" label) before it ships, or it is the one place the coach can fabricate.
- **F46 stays deferred, and stop calling the seam "import-ready"** until P3's player-white invariant is addressed in the honesty pipeline.

The net: increment 4's real risk is not the features, it is three foundations the plan under-specifies (the lesson-capture surface, the coach transport, the profile shape). Settle those three and the rest of increment 4 is execution.
