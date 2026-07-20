// Increment 3.91 (Task 2): pure SAN -> {from,to} derivation, by REPLAYING
// the move through chess.js rather than parsing the SAN string. A bare
// string parse can misidentify a disambiguated/castling move and render a
// false arrow on the board — the same rule the hint path already follows
// (server/annotator/hint.ts, classify.ts's deriveFacts): a derived claim
// must come from a legal chess.js move application, never from text
// pattern-matching. Used by manager.ts's getTurningLines to turn each
// turning point's already-stored SAN into board coordinates.
import { Chess } from "chess.js";

export function moveEndpoints(fenBefore: string, san: string): { from: string; to: string } | null {
  const probe = new Chess(fenBefore);
  try {
    const mv = probe.move(san);
    if (!mv) return null;
    return { from: mv.from, to: mv.to };
  } catch {
    return null;
  }
}
