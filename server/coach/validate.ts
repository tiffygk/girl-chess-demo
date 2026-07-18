import type { CoachFactList } from "./index";

// F18 render-only rule: any square or move the model's narration names must
// already exist in the code-assembled fact list. This is a pure text scan
// against CoachFactList.allowedSquares/allowedSans — it never re-derives
// anything from the position itself, so it can't accidentally validate a
// move that's merely legal-but-unmentioned as if it were sanctioned.
//
// The two regexes are deliberately loose (SAN_RE's move-shape group also
// matches a bare square, since every prefix is optional) so this stays
// conservative: a false-positive violation only costs a harmless
// regeneration or template fallback, never lets an unsanctioned square/move
// slip through silently.
const SQUARE_RE = /\b[a-h][1-8]\b/g;
const SAN_RE = /\b(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,!?;:'"]+$/, "");
}

export function validateNarration(
  text: string,
  facts: CoachFactList
): { ok: true } | { ok: false; violations: string[] } {
  const allowedSquares = new Set(facts.allowedSquares);
  const allowedSans = new Set(facts.allowedSans);
  const violations: string[] = [];

  for (const raw of text.match(SQUARE_RE) ?? []) {
    const square = stripTrailingPunctuation(raw);
    if (!allowedSquares.has(square)) violations.push(square);
  }

  for (const raw of text.match(SAN_RE) ?? []) {
    const san = stripTrailingPunctuation(raw);
    if (!allowedSans.has(san)) violations.push(san);
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}
