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

// C4 (override logging): an override is confirming a move the judge marked
// "warning" — the Lab's 20-80% override band reads warnings only, so a
// "nudge" confirm is deliberately NOT an override. Pulled out as its own
// pure function (rather than inlined in the confirm handler) so this
// decision is unit-testable without touching React state, the DOM, or a
// network call.
//
// judge-post mode (coach on, confirm off) never calls this at all — it has
// no confirm step, so no overrides are possible there; see
// handleMoveWithPostJudge in GamePage.tsx, which calls handleMove directly
// with no override argument.
export function isOverrideConfirm(tier: "silent" | "nudge" | "warning" | null | undefined): boolean {
  return tier === "warning";
}
