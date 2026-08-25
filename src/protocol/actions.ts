import {
  RepositoryRunSchema,
  type EffectKind,
  type RepositoryRun,
  type Unit,
  validate,
} from "./schemas.js";
import { runInvariantErrors } from "./reducer.js";
import { canEnterTerminalIntent } from "./guards.js";

export interface ActionDescriptor {
  readonly type: string;
  readonly mode: "emit" | "record";
  readonly unitId?: string;
  readonly effectKind?: EffectKind;
  readonly effectId?: string;
}

/**
 * Pure, deterministic view of reducer-eligible event kinds.
 *
 * Descriptors do not fabricate event payloads: callers still bind an intent
 * to its required parameters, revision, and idempotency key, or bind an
 * observation to the matching durable effect id.
 */
export function legalActions(
  stateInput: RepositoryRun,
): readonly ActionDescriptor[] {
  const parsed = validate<RepositoryRun>(RepositoryRunSchema, stateInput);
  if (!parsed.ok || parsed.value === undefined) return [];
  const state = parsed.value;
  if (runInvariantErrors(state).length > 0) return [];

  if (state.state === "released") return [];
  // A blocked aggregate may only record exact facts for effects that were
  // already durable. This includes still-intended sibling effects as well as
  // explicitly ambiguous ones, and never offers a new emit action.
  if (state.state === "blocked") return ambiguityRecoveryActions(state);
  const controllerActions = actionsForController(state);
  if (controllerActions !== undefined) return sortActions(controllerActions);
  if (state.controller.state !== "acquired") return [];
  if (
    state.wave.unitIds.length === 0 &&
    Object.keys(state.units).length > 0 &&
    Object.values(state.units).every((unit) => unit.state === "planned")
  )
    return [{ mode: "emit", type: "wave_planned" }];
  if (
    state.harness === undefined &&
    Object.values(state.units).some(
      (unit) => unit.state === "worktree_observed",
    )
  )
    return [{ mode: "emit", type: "harness_configured" }];

  return sortActions(
    Object.values(state.units)
      .filter((unit) => state.wave.unitIds.includes(unit.id))
      .flatMap((unit) => actionsForUnit(state, unit))
      .filter(
        (action) =>
          (action.mode !== "emit" ||
            action.effectKind === undefined ||
            (effectAllowed(state, action.effectKind) &&
              (action.unitId === undefined ||
                !hasUnresolvedUnitEffect(state, action.unitId)))) &&
          (action.mode !== "record" || pendingUnitEffect(state, action)),
      ),
  );
}

const observationsForEffect: Readonly<Record<EffectKind, readonly string[]>> = {
  controller_acquire: ["controller_acquired"],
  reservation_acquire: ["reservation_observed"],
  branch_create: ["branch_observed"],
  worktree_create: ["worktree_observed"],
  dispatch: ["dispatch_observed"],
  worker_collect: ["worker_collected"],
  candidate_collect: ["candidate_observed"],
  verify: ["verification_observed", "verification_failed"],
  review_dispatch: ["reviewer_observed"],
  review_collect: ["review_collected"],
  publish: ["publish_observed"],
  integrate: ["integrate_observed"],
  reservation_release: ["reservation_released"],
  repair: ["repair_observed"],
  failure: ["failure_observed"],
  timeout: ["timeout_observed"],
  park: ["park_observed"],
  cancel: ["cancel_observed"],
  controller_release: ["controller_released"],
};

export function ambiguityRecoveryActions(
  state: RepositoryRun,
): readonly ActionDescriptor[] {
  return sortActions(
    state.effectJournal
      .filter(
        (effect) =>
          effect.status === "intended" || effect.status === "ambiguous",
      )
      .flatMap((effect) =>
        observationsForEffect[effect.kind].map((type) => ({
          effectId: effect.effectId,
          effectKind: effect.kind,
          mode: "record" as const,
          type,
          ...(effect.unitId === null ? {} : { unitId: effect.unitId }),
        })),
      ),
  );
}

function actionsForController(
  state: RepositoryRun,
): readonly ActionDescriptor[] | undefined {
  if (state.controller.state === "unacquired") {
    return state.state === "initializing"
      ? [
          controllerAction(
            "controller_acquire_intent",
            "emit",
            "controller_acquire",
          ),
        ]
      : [];
  }
  if (state.controller.state === "acquire_intent") {
    return (state.state === "initializing" || state.state === "blocked") &&
      pendingControllerEffect(state, "controller_acquire")
      ? [
          controllerAction(
            "controller_acquired",
            "record",
            "controller_acquire",
          ),
        ]
      : [];
  }
  if (state.controller.state === "release_intent") {
    return (state.state === "release_intent" || state.state === "blocked") &&
      pendingControllerEffect(state, "controller_release")
      ? [
          controllerAction(
            "controller_released",
            "record",
            "controller_release",
          ),
        ]
      : [];
  }
  if (state.controller.state === "released") return [];
  if (canReleaseController(state))
    return [
      controllerAction(
        "controller_release_intent",
        "emit",
        "controller_release",
      ),
    ];
  return undefined;
}

function controllerAction(
  type: string,
  mode: ActionDescriptor["mode"],
  effectKind: Extract<EffectKind, "controller_acquire" | "controller_release">,
): ActionDescriptor {
  return { type, mode, effectKind };
}

function actionsForUnit(
  state: RepositoryRun,
  unit: Unit,
): readonly ActionDescriptor[] {
  return [...lifecycleActions(state, unit), ...terminalIntents(unit)];
}

function lifecycleActions(
  state: RepositoryRun,
  unit: Unit,
): readonly ActionDescriptor[] {
  switch (unit.state) {
    case "planned":
      return [
        unitAction(unit, "reservation_intent", "emit", "reservation_acquire"),
      ];
    case "reservation_intent":
      return [
        unitAction(
          unit,
          "reservation_observed",
          "record",
          "reservation_acquire",
        ),
      ];
    case "resources_reserved":
      return [unitAction(unit, "branch_intent", "emit", "branch_create")];
    case "branch_intent":
      return [unitAction(unit, "branch_observed", "record", "branch_create")];
    case "branch_observed":
      return [unitAction(unit, "worktree_intent", "emit", "worktree_create")];
    case "worktree_intent":
      return [
        unitAction(unit, "worktree_observed", "record", "worktree_create"),
      ];
    case "worktree_observed":
      return state.activeModifyingUnitIds.length < 3
        ? [unitAction(unit, "dispatch_intent", "emit", "dispatch")]
        : [];
    case "dispatch_intent":
      return [unitAction(unit, "dispatch_observed", "record", "dispatch")];
    case "dispatched":
      return [unitAction(unit, "collect_intent", "emit", "worker_collect")];
    case "collect_intent":
      return [unitAction(unit, "worker_collected", "record", "worker_collect")];
    case "collected":
      return [
        unitAction(unit, "candidate_intent", "emit", "candidate_collect"),
      ];
    case "candidate_intent":
      return [
        unitAction(unit, "candidate_observed", "record", "candidate_collect"),
      ];
    case "candidate_committed":
      return state.qualificationOwnerUnitId === undefined &&
        state.qualificationQueue[0] === unit.id
        ? [unitAction(unit, "verification_intent", "emit", "verify")]
        : [];
    case "verification_intent":
      return state.qualificationOwnerUnitId === unit.id
        ? [
            unitAction(unit, "verification_observed", "record", "verify"),
            unitAction(unit, "verification_failed", "record", "verify"),
          ]
        : [];
    case "qualified":
      return state.qualificationOwnerUnitId === unit.id &&
        state.currentReviewerUnitId === undefined
        ? [
            unitAction(
              unit,
              "reviewer_dispatch_intent",
              "emit",
              "review_dispatch",
            ),
          ]
        : [];
    case "reviewer_dispatch_intent":
      return state.currentReviewerUnitId === unit.id
        ? [unitAction(unit, "reviewer_observed", "record", "review_dispatch")]
        : [];
    case "reviewer_dispatched":
      return state.currentReviewerUnitId === unit.id
        ? [unitAction(unit, "review_collect_intent", "emit", "review_collect")]
        : [];
    case "review_collect_intent":
      return state.currentReviewerUnitId === unit.id
        ? [unitAction(unit, "review_collected", "record", "review_collect")]
        : [];
    case "approved":
      return isCurrentApproval(unit) &&
        state.qualificationOwnerUnitId === unit.id
        ? state.completionBoundary === "local-integration"
          ? [unitAction(unit, "integrate_intent", "emit", "integrate")]
          : [unitAction(unit, "publish_intent", "emit", "publish")]
        : [];
    case "publish_intent":
      return [unitAction(unit, "publish_observed", "record", "publish")];
    case "published":
      return hasCurrentApproval(unit) &&
        state.completionBoundary === "remote-integration" &&
        state.qualificationOwnerUnitId === unit.id &&
        (state.integrationOwnerUnitId === undefined ||
          state.integrationOwnerUnitId === unit.id) &&
        state.integrationQueue[0] === unit.id
        ? [unitAction(unit, "integrate_intent", "emit", "integrate")]
        : [];
    case "integrate_intent":
      return state.integrationOwnerUnitId === unit.id
        ? [unitAction(unit, "integrate_observed", "record", "integrate")]
        : [];
    case "landed":
    case "handoff":
    case "cancelled":
    case "parked":
    case "failed":
    case "timed_out":
      return [
        ...(repairIsEligible(state, unit)
          ? [unitAction(unit, "repair_intent", "emit", "repair")]
          : []),
        unitAction(
          unit,
          "reservation_release_intent",
          "emit",
          "reservation_release",
        ),
      ];
    case "reservation_release_intent":
      return [
        unitAction(
          unit,
          "reservation_released",
          "record",
          "reservation_release",
        ),
      ];
    case "repair_required":
      return repairIsEligible(state, unit)
        ? [unitAction(unit, "repair_intent", "emit", "repair")]
        : [];
    case "repair_intent":
      return [unitAction(unit, "repair_observed", "record", "repair")];
    case "failure_intent":
      return [unitAction(unit, "failure_observed", "record", "failure")];
    case "timeout_intent":
      return [unitAction(unit, "timeout_observed", "record", "timeout")];
    case "park_intent":
      return [unitAction(unit, "park_observed", "record", "park")];
    case "cancel_intent":
      return [unitAction(unit, "cancel_observed", "record", "cancel")];
    case "blocked":
    case "closed":
      return [];
  }
}

function terminalIntents(unit: Unit): readonly ActionDescriptor[] {
  if (!canEnterTerminalIntent(unit.state)) return [];
  return [
    unitAction(unit, "failure_intent", "emit", "failure"),
    unitAction(unit, "timeout_intent", "emit", "timeout"),
    unitAction(unit, "park_intent", "emit", "park"),
    unitAction(unit, "cancel_intent", "emit", "cancel"),
  ];
}

function unitAction(
  unit: Unit,
  type: string,
  mode: ActionDescriptor["mode"],
  effectKind: EffectKind,
): ActionDescriptor {
  return { type, mode, unitId: unit.id, effectKind };
}

function repairIsEligible(state: RepositoryRun, unit: Unit): boolean {
  return (
    unit.repairContext !== undefined &&
    unit.branchRef !== undefined &&
    unit.worktreePath !== undefined &&
    (unit.repairContext.headOid === undefined ||
      unit.repairContext.headOid === unit.candidateHead) &&
    unit.repairCount < 16 &&
    state.activeModifyingUnitIds.length < 3
  );
}

function isCurrentApproval(unit: Unit): boolean {
  return (
    unit.state === "approved" &&
    unit.reviewBaseOid === unit.baseOid &&
    unit.reviewHeadOid === unit.candidateHead &&
    unit.reviewTree === unit.candidateTree &&
    unit.approvalResponseHash !== undefined
  );
}

function hasCurrentApproval(unit: Unit): boolean {
  return (
    unit.reviewBaseOid === unit.baseOid &&
    unit.reviewHeadOid === unit.candidateHead &&
    unit.reviewTree === unit.candidateTree &&
    unit.approvalResponseHash !== undefined
  );
}

function canReleaseController(state: RepositoryRun): boolean {
  return (
    state.controller.state === "acquired" &&
    state.activeModifyingUnitIds.length === 0 &&
    state.qualificationOwnerUnitId === undefined &&
    state.integrationOwnerUnitId === undefined &&
    state.currentReviewerUnitId === undefined &&
    Object.values(state.units).every((unit) => unit.state === "closed") &&
    Object.values(state.reservations).every(
      (reservation) => reservation.state === "released",
    )
  );
}

function effectAllowed(state: RepositoryRun, kind: EffectKind): boolean {
  if (kind === "publish")
    return (
      (state.completionBoundary === "branch-handoff" &&
        state.authorityProfile !== "local-change-only") ||
      (state.completionBoundary === "pr-handoff" &&
        ["open-pr", "integrate"].includes(state.authorityProfile)) ||
      (state.completionBoundary === "remote-integration" &&
        state.authorityProfile === "integrate")
    );
  if (kind !== "integrate") return true;
  return (
    state.completionBoundary === "local-integration" ||
    (state.completionBoundary === "remote-integration" &&
      state.authorityProfile === "integrate")
  );
}

function pendingUnitEffect(
  state: RepositoryRun,
  action: ActionDescriptor,
): boolean {
  return (
    action.unitId !== undefined &&
    action.effectKind !== undefined &&
    state.effectJournal.some(
      (effect) =>
        effect.unitId === action.unitId &&
        effect.kind === action.effectKind &&
        (effect.status === "intended" || effect.status === "ambiguous"),
    )
  );
}

function hasUnresolvedUnitEffect(
  state: RepositoryRun,
  unitId: string,
): boolean {
  return state.effectJournal.some(
    (effect) =>
      effect.unitId === unitId &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
}

function pendingControllerEffect(
  state: RepositoryRun,
  kind: Extract<EffectKind, "controller_acquire" | "controller_release">,
): boolean {
  return state.effectJournal.some(
    (effect) =>
      effect.unitId === null &&
      effect.kind === kind &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
}

function sortActions(
  actions: readonly ActionDescriptor[],
): readonly ActionDescriptor[] {
  return [...actions].sort((left, right) => {
    const leftKey = [
      left.type,
      left.unitId ?? "",
      left.mode,
      left.effectKind ?? "",
      left.effectId ?? "",
    ].join("\u0000");
    const rightKey = [
      right.type,
      right.unitId ?? "",
      right.mode,
      right.effectKind ?? "",
      right.effectId ?? "",
    ].join("\u0000");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
