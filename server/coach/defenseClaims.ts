import { Chess } from "chess.js";

// Extracted from server/coach/chat.ts (Task 3, 2026-07-22 truthfulness
// leaks round) -- was chat-path-only, now shared with narrate()'s
// validateNarration too (server/coach/validate.ts). Behavior unchanged from
// the original chat.ts version; this file is a pure move, not a rewrite.
//
// The coach once told a player "the pawn on e4 doesn't guard f5" when e4
// demonstrably guards f5 (Bxf5 exf5), and separately, from coach's-corner
// narration, "that pawn on d5 isn't defended, so you'd just be handing it
// over for free" when e4 defends d5. ChatFactList.contested gives the chat
// model the truth for occupied+attacked squares as a FACT, but nothing
// previously checked the model's OWN prose against that truth on either
// surface -- a hallucinated claim could still slip past validation as long
// as it named no illegal move. This adds exactly two claim shapes to check,
// chosen to match the reported bugs and their obvious siblings, chess.js-only
// (no engine call, a few ms): a GUARD relation between two squares ("A
// (guards|defends|protects) B" / negated), and a single-square SAFETY
// predicate ("B is (undefended|hanging|...)" / "B is (defended|safe|...)").
// Deliberately narrow and precision-first: anything that doesn't cleanly
// parse (an empty square, an ambiguous phrasing) is left unflagged rather
// than risk a false-positive regen. Violations are pushed into the SAME
// violations array the caller already returns, so the existing
// one-regen-then-template fallback picks them up unchanged on both surfaces.
export const SQ = "[a-h][1-8]";
export const GUARD_VERBS = "guards?|guarding|defends?|defending|protects?|protecting";
// 2026-08-25: "nothing defends it" parsed as an AFFIRMATIVE guard claim,
// because the list below only had verbal negations ("does not", "can't").
// Precision-first, same as the rest of this file: an enumerated list, not a
// general matcher.
//
// 2026-08-26 review fix: the line above used to add "a bare negator subject
// negates the relation just as hard," as if that were now covered -- it
// isn't, in general. The added alternatives are only tested against
// guardClaimRe's own `between` capture, the span from sqA up to the verb
// (e.g. "e4 -- nothing defends f5", where "nothing" sits between "e4" and
// "defends"). A negator that comes BEFORE sqA as the sentence's own
// subject, e.g. "no piece on b7 defends f2", is outside that capture
// entirely and is still invisible to this check.
export const GUARD_NEGATION_RE =
  /\b(does not|doesn't|do not|don't|cannot|can't|never|nothing|nobody|no piece|no pieces|none)\b/i;
export const SAFETY_UNDEFENDED_WORDS = ["undefended", "unprotected", "unguarded", "hanging", "hangs", "not defended", "not protected", "not guarded"];
export const SAFETY_DEFENDED_WORDS = ["defended", "protected", "guarded", "safe", "covered"];
// Controller follow-up (issue B, 2026-07-22 review): the safety-claim shape
// requires a copula ("is"/"are") between the square and the predicate to
// confirm the "<sq> is/are <predicate>" claim shape -- but the live bug's
// exact wording ("that pawn on d5 isn't defended") uses a contraction with
// no word boundary between the "is" and "n't", so it never matched. Same
// idiom as GUARD_NEGATION_RE above (a fixed negation-word list, not a new
// predicate phrase): SAFETY_COPULA_RE widens the shape check to also accept
// the contracted forms, and SAFETY_NEGATION_RE flags when the matched
// copula was one of them, so the predicate's base polarity (from the two
// word lists above, unchanged) gets flipped. The spelled-out "is not
// defended" / "are not defended" phrasing needs neither: "not" there is
// already part of the predicate capture itself (a literal entry in
// SAFETY_UNDEFENDED_WORDS), so this never double-negates it.
export const SAFETY_COPULA_RE = /\b(?:is|isn't|are|aren't)\b/i;
export const SAFETY_NEGATION_RE = /\b(isn't|aren't)\b/i;

// 2026-08-25, the other half of trace 278: the filler windows below cap at 40
// characters but say nothing about sentence terminators, so a match happily
// paired "b7" in one sentence with "f2" in the next and asserted a relation
// between two squares the coach never connected. Both claim shapes are
// within-sentence claims by construction, so the cheapest correct fix is to
// never let a match see two sentences at once.
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

export function guardClaimRe(): RegExp {
  // group 1: sqA, group 2: text between sqA and the verb (checked for
  // negation), group 3: the verb, group 4: sqB. The negative lookahead in
  // each filler keeps a match from crossing a THIRD square, so a match
  // never straddles two unrelated relations.
  return new RegExp(
    `\\b(${SQ})\\b((?:(?!\\b${SQ}\\b).){0,40}?)\\b(?:${GUARD_VERBS})\\b(?:(?!\\b${SQ}\\b).){0,40}?\\b(${SQ})\\b`,
    "gi"
  );
}

export function safetyClaimRe(): RegExp {
  const words = [...SAFETY_UNDEFENDED_WORDS, ...SAFETY_DEFENDED_WORDS].map((w) => w.replace(/ /g, "\\s+")).join("|");
  // group 1: sqB, group 2: text between sqB and the predicate (checked for
  // "is"), group 3: the predicate word/phrase itself.
  return new RegExp(`\\b(${SQ})\\b((?:(?!\\b${SQ}\\b).){0,40}?)\\b(${words})\\b`, "gi");
}

// Game-151 round (rca A3): a pending-move claim is a counterfactual about a
// position that does not yet exist; judging it against the pre-move board
// is a category error (an enemy pawn on e5 trivially "doesn't guard" d3).
// One chess.js move() call, no engine, no network. Returns null for an
// illegal/malformed move -- callers skip the extra position, never guess.
export function postMoveFen(fen: string, from: string, to: string): string | null {
  try {
    const chess = new Chess(fen);
    const mv = chess.move({ from: from as any, to: to as any, promotion: "q" });
    return mv ? chess.fen() : null;
  } catch {
    return null;
  }
}

// Detects the two claim shapes above in reply text and checks each against
// the position (fen) via chess.js. Returns one "defense-claim: ..." string
// per contradiction, [] if no claim was made or a claim couldn't be
// confidently adjudicated (an unoccupied square).
export function checkDefenseClaims(
  text: string,
  fen: string,
  // Round 3 (Q4, trace-180): squares where a legal recapture exists
  // geometrically (capturedSquareDefended) but the engine's own line shows
  // it does NOT actually hold (ThreatFacts.recaptureHolds === false) --
  // motifs.ts's own new producer, threaded through by the caller (never
  // re-derived here). The geometric truth this checker computes stays
  // exactly as it was; this only stops "g4 is defended, but you can't
  // safely take back there" / "g4 isn't safe to recapture on" -- an
  // HONEST, more precise claim than the geometric checker alone can see --
  // from being flagged as a contradiction of "g4 is defended". Additive:
  // omitted (every pre-round-3 caller) means every square is adjudicated
  // exactly as before.
  unsafeRecaptureSquares: Iterable<string> = []
): string[] {
  const chess = new Chess(fen);
  const sq = (s: string) => s.toLowerCase() as Parameters<typeof chess.get>[0];
  const colorAt = (s: string) => chess.get(sq(s))?.color ?? null;
  const unsafeRecapture = new Set([...unsafeRecaptureSquares].map((s) => s.toLowerCase()));
  const violations: string[] = [];

  // Trace 278 (game 189 ply 28): run both claim shapes per sentence rather
  // than over the whole reply, so a filler window can never pair a square
  // from one sentence with a square from the next. Every rule, threshold,
  // and violation string below is unchanged; only the unit of text they
  // scan is.
  for (const sentence of splitSentences(text)) {
    for (const m of sentence.matchAll(guardClaimRe())) {
      const [, sqA, between, sqB] = m;
      const a = sqA.toLowerCase();
      const b = sqB.toLowerCase();
      if (a === b) continue;
      const colorA = colorAt(a);
      const colorB = colorAt(b);
      if (!colorA || !colorB) continue; // an empty square -- can't adjudicate
      const claimsDefends = !GUARD_NEGATION_RE.test(between);
      const truth = colorA === colorB && chess.attackers(sq(b), colorA).includes(sq(a));
      if (claimsDefends !== truth) {
        violations.push(`defense-claim: ${a} ${truth ? "does guard" : "does not guard"} ${b}`);
      }
    }

    for (const m of sentence.matchAll(safetyClaimRe())) {
      const [, sqB, between, rawPredicate] = m;
      if (!SAFETY_COPULA_RE.test(between)) continue; // not the "<sq> is/are <predicate>" shape
      const b = sqB.toLowerCase();
      const colorB = colorAt(b);
      if (!colorB) continue; // an empty square -- can't adjudicate
      const predicate = rawPredicate.toLowerCase().replace(/\s+/g, " ");
      let claimsDefended: boolean | null = null;
      if (SAFETY_UNDEFENDED_WORDS.includes(predicate)) claimsDefended = false;
      else if (SAFETY_DEFENDED_WORDS.includes(predicate)) claimsDefended = true;
      if (claimsDefended === null) continue;
      // A contracted-negative copula ("isn't"/"aren't") flips the predicate's
      // base polarity -- "isn't defended" (predicate "defended", base true)
      // becomes a claim of "undefended" (false). The spelled-out "is not
      // defended" case never reaches here with `between` containing a
      // negation word at all (see SAFETY_NEGATION_RE's comment above), so
      // this can't double-negate it.
      if (SAFETY_NEGATION_RE.test(between)) claimsDefended = !claimsDefended;
      const truth = chess.attackers(sq(b), colorB).length > 0;
      // Round 3 (Q4, trace-180): a claim that b is NOT safe/defended, on a
      // square the recapture-viability fact says legitimately doesn't hold up
      // even though it's geometrically defended, is a MORE PRECISE truth, not
      // a contradiction -- skip it rather than flag an honest claim.
      if (claimsDefended === false && truth === true && unsafeRecapture.has(b)) continue;
      if (claimsDefended !== truth) {
        violations.push(`defense-claim: ${b} is ${truth ? "defended" : "undefended"}`);
      }
    }
  }

  return violations;
}
