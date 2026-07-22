import type { CoachFactList } from "./index";
import { checkDefenseClaims } from "./defenseClaims";

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
// Exported: server/coach/chat.ts's validateChat (F16) reuses this exact
// pattern rather than redefining an equivalent one that could drift out of
// sync with narrate()'s validation.
//
// Piece letters (leading and promotion) are matched case-INSENSITIVELY
// ([KQRBNkqrbn] / [QRBNqrbn]): the coach persona writes lowercase prose, so
// a fabricated move like "qxh7" would otherwise slip past the uppercase-only
// [KQRBN] class entirely -- never even extracted as a SAN-shaped token, let
// alone checked against allowedSans. Matching case-insensitively and then
// normalizing (see normalizeSan below) before the allowedSans membership
// check closes that hole in both this file's validateNarration and
// chat.ts's validateChat, since both consume this one pattern.
export const SAN_RE = /\b(?:O-O(?:-O)?|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNqrbn])?[+#]?)\b/g;

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,!?;:'"]+$/, "");
}

// Uppercases a leading piece letter (k/q/r/b/n) and/or a promotion piece
// letter (=q/=r/=b/=n), leaving everything else untouched. Deliberately
// does NOT touch a lone file letter: standard SAN pawn captures are
// file-led and lowercase already ("exd5", "bxc3"), and "b" is the one file
// letter that collides with a piece letter (Bishop) -- normalizeSan must
// never turn a legitimate pawn capture into a fabricated bishop move.
// Callers check the RAW token against allowedSans first and fall back to
// the normalized form (see isAllowedSanToken), so an ambiguous token like
// "bxc3" matches whichever of "bxc3" (pawn) / "Bxc3" (bishop) is actually
// in the fact list, and a genuinely fabricated token matches neither.
export function normalizeSan(token: string): string {
  let out = token;
  if (/^[kqrbn]/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  out = out.replace(/=([qrbn])$/, (_m, p: string) => `=${p.toUpperCase()}`);
  return out;
}

// Shared membership check for a SAN-shaped token: allowed as-is, or allowed
// once its piece-letter case is normalized. Exported so chat.ts's
// validateChat uses the exact same rule as validateNarration below --
// one place decides what counts as an allowed move, for both surfaces.
export function isAllowedSanToken(token: string, allowed: Set<string>): boolean {
  if (allowed.has(token)) return true;
  const normalized = normalizeSan(token);
  return normalized !== token && allowed.has(normalized);
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
    if (!isAllowedSanToken(san, allowedSans)) violations.push(san);
  }

  // Task 3 (2026-07-22, truthfulness leaks): the shared defender-claim
  // checker (server/coach/chat.ts's chat path already ran this) grounds a
  // "X isn't defended" / "Y guards Z" claim against the real position
  // instead of taking the model's word for it. Live gate example: "that
  // pawn on d5 isn't defended, so you'd just be handing it over for free"
  // when e4 demonstrably defends d5. chess.js-only, no engine call --
  // narrate() must never touch the evaluator queue.
  violations.push(...checkDefenseClaims(text, facts.currentFen));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}
