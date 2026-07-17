// C3 (Silent Partner toggle + confirm decoupling): pure decision table for
// GamePage's destination-click dispatch. Two independent switches — "coach
// judges my moves" and "confirm before playing" — cross to 4 move flows.
// Pinning this as its own pure function (rather than inlining the branch
// in GamePage) gives a reviewer a one-glance spec for the whole matrix and
// keeps it unit-testable without touching React state or the network.
export type MoveFlow = "judge-confirm" | "judge-post" | "confirm-only" | "one-tap";

/**
 * coachOn  = "coach judges my moves" (the pill / gc-coach-mode)
 * confirmOn = "confirm before playing" (gc-confirm-step)
 *
 *              confirm ON                 confirm OFF
 * coach ON   judge-confirm (C1/C2)       judge-post (badge after play)
 * coach OFF  confirm-only (plain 2-step) one-tap (pre-C1, zero judge calls)
 */
export function resolveMoveFlow(coachOn: boolean, confirmOn: boolean): MoveFlow {
  if (coachOn && confirmOn) return "judge-confirm";
  if (coachOn && !confirmOn) return "judge-post";
  if (!coachOn && confirmOn) return "confirm-only";
  return "one-tap";
}
