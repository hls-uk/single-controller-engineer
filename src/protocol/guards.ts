import type { UnitState } from "./schemas.js";

const TERMINAL_INTENT_STATES: ReadonlySet<UnitState> = new Set([
  "planned",
  "resources_reserved",
  "branch_observed",
  "worktree_observed",
  "dispatched",
  "collected",
  "candidate_committed",
  "qualified",
  "reviewer_dispatched",
  "approved",
  "published",
  "repair_required",
]);

/**
 * A terminal intent may start only from a stable, observed lifecycle state.
 * Intent states already have one unresolved external effect and terminal states
 * must proceed through repair or reservation cleanup instead of stacking a
 * second terminal effect.
 */
export function canEnterTerminalIntent(state: UnitState): boolean {
  return TERMINAL_INTENT_STATES.has(state);
}
