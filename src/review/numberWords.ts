// Union review fix (C1, 2026-07-31): the spelled-number helper, pulled out
// of debriefBullets.ts into its own tiny module so debriefLesson.ts,
// highlightedMoves.ts, and debriefInvariants.ts can each read tp.mateIn's
// real value without either (a) hand-typing a second/third/fourth copy of
// the same word list (the thing this module exists to prevent -- three of
// C1's four false "checkmate in one" producers needed this and a fourth
// copy would have been one too many) or (b) reaching into debriefBullets.ts
// and creating a cross-module coupling that didn't exist before this fix.
//
// turningPointNote.ts keeps its OWN local copy on purpose -- its header
// states a deliberate "never imports from debriefBullets.ts" contract for
// that file specifically. This module does not change that; it is not
// itself debriefBullets.ts, but turningPointNote.ts is left exactly as it
// was rather than silently switching it over (see fix-phaseA-union.md for
// why).
//
// Owner preview convention: spelled words for mate distances ("mate in
// twelve", "mate in one"); counts stay digits ("this happened 5 times").
export const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
];

export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// Visual gate, phase A (2026-07-30, game-160 rca round): the gate drove the
// real app against the owner's real games and caught "it took 1 moves" on
// game 145 -- a count of exactly one, the one arity every counted-noun
// clause in this round's templates forgot to special-case. Every "N
// move(s)"/"N time(s)" clause in debriefBullets.ts routes through this
// instead of hand-writing its own ternary, so a count-of-1 fixture can only
// pass by handling the singular for real (see debriefBullets.test.ts's
// "counted-noun agreement" describe block).
export function pluralizeWord(n: number, singular: string, plural: string = `${singular}s`): string {
  return n === 1 ? singular : plural;
}
