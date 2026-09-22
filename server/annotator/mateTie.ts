// A played move "keeps the mate schedule" when the mover had mate in N
// before it and, after it, the opponent is mated in N-1 (0 = mate delivered).
// That is true of EVERY mate-in-N move, not only the engine's stored one, so
// a second mating move is never a deviation from best. Signs follow the
// moves table: eval_mate is signed for the side to move at that position.
export function keepsMateSchedule(
  before: { evalMate: number | null },
  after: { evalMate: number | null }
): boolean {
  const n = before.evalMate;
  if (n === null || n <= 0) return false;
  const a = after.evalMate;
  if (a === null) return false;
  if (a === 0) return n === 1;
  return -a === n - 1;
}
