import type { EffectKind, RepositoryRun, Unit } from "./schemas.js";

export interface ActionDescriptor {
  readonly type: string;
  readonly mode: "emit" | "record";
  readonly unitId?: string;
  readonly effectKind?: EffectKind;
}

/** Pure next-action view. Reducer transition guards use the same lifecycle gates. */
export function legalActions(
  state: RepositoryRun,
): readonly ActionDescriptor[] {
  if (state.state === "released" || state.state === "blocked") return [];
  if (state.controller.state === "unacquired")
    return [
      {
        type: "controller_acquire_intent",
        mode: "emit",
        effectKind: "controller_acquire",
      },
    ];
  if (state.controller.state === "acquire_intent")
    return hasPendingControllerIntent(state, "controller_acquire")
      ? [
          {
            type: "controller_acquired",
            mode: "record",
            effectKind: "controller_acquire",
          },
        ]
      : [];
  if (state.controller.state === "release_intent")
    return hasPendingControllerIntent(state, "controller_release")
      ? [
          {
            type: "controller_released",
            mode: "record",
            effectKind: "controller_release",
          },
        ]
      : [];
  if (state.controller.state !== "acquired") return [];
  return Object.values(state.units)
    .flatMap((unit) => actionForUnit(state, unit))
    .filter(
      (action) =>
        (action.effectKind === undefined ||
          effectAllowed(state, action.effectKind)) &&
        (action.mode === "emit" ||
          hasPendingIntent(state, action.unitId, action.type)),
    );
}

function effectAllowed(state: RepositoryRun, kind: EffectKind): boolean {
  if (kind === "publish")
    return ["push-branch", "open-pr", "integrate"].includes(
      state.authorityProfile,
    );
  if (kind !== "integrate") return true;
  return (
    (state.authorityProfile === "integrate" ||
      (state.authorityProfile === "local-change-only" &&
        state.integrationProfile === "local-ff")) &&
    state.integrationProfile !== "none"
  );
}

function actionForUnit(
  state: RepositoryRun,
  unit: Unit,
): readonly ActionDescriptor[] {
  const one = (
    type: string,
    effectKind?: EffectKind,
  ): readonly ActionDescriptor[] => [
    {
      type,
      mode: type.endsWith("_intent") ? "emit" : "record",
      unitId: unit.id,
      ...(effectKind === undefined ? {} : { effectKind }),
    },
  ];
  switch (unit.state) {
    case "planned":
      return one("reservation_intent", "reservation_acquire");
    case "reservation_intent":
      return one("reservation_observed");
    case "resources_reserved":
      return one("branch_intent", "branch_create");
    case "branch_intent":
      return one("branch_observed");
    case "branch_observed":
      return one("worktree_intent", "worktree_create");
    case "worktree_intent":
      return one("worktree_observed");
    case "worktree_observed":
      return state.activeModifyingUnitIds.length < 3
        ? one("dispatch_intent", "dispatch")
        : [];
    case "dispatch_intent":
      return one("dispatch_observed");
    case "dispatched":
      return one("collect_intent", "worker_collect");
    case "collect_intent":
      return one("worker_collected");
    case "collected":
      return one("candidate_intent", "candidate_collect");
    case "candidate_intent":
      return one("candidate_observed");
    case "candidate_committed":
      return state.qualificationOwnerUnitId === undefined &&
        state.qualificationQueue[0] === unit.id
        ? one("verification_intent", "verify")
        : [];
    case "verification_intent":
      return one("verification_observed");
    case "qualified":
      return state.currentReviewerUnitId === undefined
        ? one("reviewer_dispatch_intent", "review_dispatch")
        : [];
    case "reviewer_dispatch_intent":
      return one("reviewer_observed");
    case "reviewer_dispatched":
      return one("review_collect_intent", "review_collect");
    case "review_collect_intent":
      return one("review_collected");
    case "approved":
      return one("publish_intent", "publish");
    case "publish_intent":
      return one("publish_observed");
    case "published":
      return state.integrationQueue[0] === unit.id
        ? one("integrate_intent", "integrate")
        : [];
    case "integrate_intent":
      return one("integrate_observed");
    case "failed":
    case "timed_out":
      return unit.repairContext !== undefined &&
        unit.repairCount < 16 &&
        state.activeModifyingUnitIds.length < 3
        ? one("repair_intent", "repair")
        : one("reservation_release_intent", "reservation_release");
    case "landed":
    case "cancelled":
    case "parked":
      return one("reservation_release_intent", "reservation_release");
    case "reservation_release_intent":
      return one("reservation_released");
    case "repair_required":
      return unit.repairCount < 16 && state.activeModifyingUnitIds.length < 3
        ? one("repair_intent", "repair")
        : [];
    case "repair_intent":
      return one("repair_observed");
    default:
      return [];
  }
}

function hasPendingIntent(
  state: RepositoryRun,
  unitId: string | undefined,
  observation: string,
): boolean {
  if (unitId === undefined) return false;
  const kinds: Record<string, EffectKind> = {
    reservation_observed: "reservation_acquire",
    branch_observed: "branch_create",
    worktree_observed: "worktree_create",
    dispatch_observed: "dispatch",
    worker_collected: "worker_collect",
    candidate_observed: "candidate_collect",
    verification_observed: "verify",
    reviewer_observed: "review_dispatch",
    review_collected: "review_collect",
    publish_observed: "publish",
    integrate_observed: "integrate",
    reservation_released: "reservation_release",
    repair_observed: "repair",
    failure_observed: "failure",
    timeout_observed: "timeout",
    park_observed: "park",
    cancel_observed: "cancel",
  };
  const kind = kinds[observation];
  return (
    kind !== undefined &&
    state.effectJournal.some(
      (effect) =>
        effect.unitId === unitId &&
        effect.kind === kind &&
        effect.status === "intended",
    )
  );
}

function hasPendingControllerIntent(
  state: RepositoryRun,
  kind: Extract<EffectKind, "controller_acquire" | "controller_release">,
): boolean {
  return state.effectJournal.some(
    (effect) =>
      effect.unitId === null &&
      effect.kind === kind &&
      effect.status === "intended",
  );
}
