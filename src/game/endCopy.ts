// Game-151 round (owner rulings 2026-07-29): the end-game copy family.
// Pure module so the exact strings are testable (GameEndPanel.tsx has no
// unit harness). "you cracked. mallow wins." is her line, read as two
// sentences to match the family -- flagged as an assumption she can
// correct (plan Open Question 2).
export const RESULT_COPY: Record<string, string> = {
  "1-0": "you win. mallow melts.",
  "0-1": "you cracked. mallow wins.",
  "1/2-1/2": "dead even. you both freeze over.",
};

export function resultText(result: string): string {
  return RESULT_COPY[result] ?? "draw.";
}
