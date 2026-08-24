import {
  LIMITS,
  SCHEMA_VERSION,
  type EffectJournalEntry,
  type EffectKind,
  type ProtocolEvent,
  ProtocolEventSchema,
  type RepositoryRun,
  RepositoryRunSchema,
  type RuntimeEffect,
  RuntimeEffectSchema,
  type Unit,
  type UnitState,
  validate,
} from "./schemas.js";
import { canonicalJson } from "./canonical.js";
import { sha256 } from "./evidence.js";
import { canEnterTerminalIntent } from "./guards.js";

export type ProtocolEffect = RuntimeEffect;
export type Reduction =
  | {
      readonly ok: true;
      readonly nextState: RepositoryRun;
      readonly effects: readonly ProtocolEffect[];
    }
  | {
      readonly ok: false;
      readonly code:
        | "invalid_state"
        | "invalid_event"
        | "stale_revision"
        | "duplicate_event"
        | "illegal_transition"
        | "invariant";
      readonly reason: string;
    };

/**
 * Pure CAS reducer. Persistence of nextState (including every intended journal
 * entry) precedes execution of the returned runtime effects.
 */
export function reduce(
  stateInput: RepositoryRun,
  eventInput: ProtocolEvent,
): Reduction {
  const parsedState = validate<RepositoryRun>(RepositoryRunSchema, stateInput);
  if (!parsedState.ok || parsedState.value === undefined)
    return reject("invalid_state", parsedState.errors.join("; "));
  const parsedEvent = validate<ProtocolEvent>(ProtocolEventSchema, eventInput);
  if (!parsedEvent.ok || parsedEvent.value === undefined)
    return reject("invalid_event", parsedEvent.errors.join("; "));
  const state = parsedState.value;
  const event = parsedEvent.value;
  const errors = runInvariantErrors(state);
  if (errors.length) return reject("invariant", errors.join("; "));
  if (event.expectedRevision !== state.revision)
    return reject(
      "stale_revision",
      "expected aggregate revision does not match",
    );
  if (state.processedEventIds.includes(event.eventId))
    return reject("duplicate_event", "event id has already been applied");
  if (
    "idempotencyKey" in event &&
    state.processedIdempotencyKeys.includes(event.idempotencyKey)
  )
    return reject(
      "duplicate_event",
      "idempotency key has already been applied",
    );
  const declaredIntentKind = effectKindForIntent(event.type);
  if (
    declaredIntentKind !== undefined &&
    "idempotencyKey" in event &&
    event.idempotencyKey !==
      deriveIdempotencyKey(
        state,
        event.expectedRevision,
        "unitId" in event ? event.unitId : null,
        declaredIntentKind,
      )
  )
    return reject(
      "invalid_event",
      "idempotency key is not deterministic for this run, revision, unit, and effect",
    );

  if (
    event.type === "controller_acquire_intent" ||
    event.type === "controller_acquired" ||
    event.type === "controller_release_intent" ||
    event.type === "controller_released"
  )
    return reduceController(state, event);
  if (state.state === "released")
    return reject("illegal_transition", `aggregate is ${state.state}`);
  if (state.state === "blocked") {
    const recovered = recoverAmbiguousUnitObservation(state, event);
    if (recovered === undefined)
      return reject("illegal_transition", "aggregate is blocked");
    return reduce(recovered, event);
  }
  if (event.type === "effect_ambiguous" && event.unitId === null) {
    const entry = state.effectJournal.find(
      (item) => item.effectId === event.effectId,
    );
    if (
      entry === undefined ||
      entry.unitId !== null ||
      entry.kind !== event.effectKind ||
      entry.status !== "intended"
    )
      return badObservation();
    return commit(
      {
        ...state,
        state: "blocked",
        effectJournal: state.effectJournal.map((item) =>
          item.effectId === entry.effectId
            ? {
                ...item,
                status: "ambiguous" as const,
                ...(event.observationHash === undefined
                  ? {}
                  : { observationHash: event.observationHash }),
              }
            : item,
        ),
      },
      event,
      [],
    );
  }
  if (state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired",
    );
  if (event.unitId === null)
    return reject("illegal_transition", "unit event requires a unit id");
  const unit = state.units[event.unitId];
  if (unit === undefined) return reject("illegal_transition", "unknown unit");
  if (!state.wave.unitIds.includes(unit.id))
    return reject("illegal_transition", "unit is not in the current wave");
  const emittedKind = effectKindForIntent(event.type);
  if (emittedKind !== undefined && hasUnresolvedUnitEffect(state, unit.id))
    return reject(
      "illegal_transition",
      "unit already has an unresolved intended or ambiguous effect",
    );
  if (emittedKind !== undefined && !effectAllowed(state, emittedKind))
    return reject(
      "illegal_transition",
      `authority profile forbids ${emittedKind}`,
    );

  let result: Step | undefined;
  switch (event.type) {
    case "reservation_intent":
      if (unit.state !== "planned") return illegal(unit, event.type);
      if (
        event.reservations.some((r) => state.reservations[r.id] !== undefined)
      )
        return reject("invariant", "reservation id is already owned");
      if (
        new Set(event.reservations.map((r) => `${r.namespace}/${r.resource}`))
          .size !== event.reservations.length
      )
        return reject("invariant", "reservation request collides with itself");
      if (
        Object.values(state.reservations).some(
          (r) =>
            r.state !== "released" &&
            event.reservations.some(
              (next) =>
                next.namespace === r.namespace && next.resource === r.resource,
            ),
        )
      )
        return reject("invariant", "reservation resource is already occupied");
      result = intent(
        state,
        unit,
        "reservation_intent",
        event,
        "reservation_acquire",
        {
          reservations: {
            ...state.reservations,
            ...Object.fromEntries(
              event.reservations.map((r) => [
                r.id,
                { ...r, unitId: unit.id, state: "intended" as const },
              ]),
            ),
          },
          units: replaceUnit(state, {
            ...unit,
            reservationIds: event.reservations.map((r) => r.id),
          }),
        },
      );
      break;
    case "reservation_observed":
      if (unit.state !== "reservation_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_acquire"))
        return badObservation();
      result = observe(
        state,
        unit,
        "resources_reserved",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "reserved",
            event.effectId,
          ),
        },
      );
      break;
    case "branch_intent":
      if (unit.state !== "resources_reserved") return illegal(unit, event.type);
      result = intent(state, unit, "branch_intent", event, "branch_create", {
        units: replaceUnit(state, { ...unit, branchRef: event.branchRef }),
      });
      break;
    case "branch_observed":
      if (unit.state !== "branch_intent" || unit.branchRef !== event.branchRef)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "branch_create"))
        return badObservation();
      result = observe(state, unit, "branch_observed", event);
      break;
    case "worktree_intent":
      if (unit.state !== "branch_observed") return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "worktree_intent",
        event,
        "worktree_create",
        {
          units: replaceUnit(state, {
            ...unit,
            worktreePath: event.worktreePath,
          }),
        },
      );
      break;
    case "worktree_observed":
      if (
        unit.state !== "worktree_intent" ||
        unit.worktreePath !== event.worktreePath
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worktree_create"))
        return badObservation();
      result = observe(state, unit, "worktree_observed", event);
      break;
    case "dispatch_intent":
      if (unit.state !== "worktree_observed") return illegal(unit, event.type);
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(
        state,
        unit,
        "dispatch_intent",
        event,
        "dispatch",
        {
          workerRequestedModel: event.requestedModel,
          workerPromptHash: event.promptHash,
        },
      );
      break;
    case "dispatch_observed":
      if (
        unit.state !== "dispatch_intent" ||
        event.requestedModel !== unit.workerRequestedModel ||
        event.promptHash !== unit.workerPromptHash ||
        !sessionIsFresh(state, event.sessionId)
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "dispatch"))
        return badObservation();
      result = observe(
        state,
        unit,
        "dispatched",
        event,
        workerSession(event),
        recordSession(state, event.sessionId),
      );
      break;
    case "collect_intent":
      if (unit.state !== "dispatched") return illegal(unit, event.type);
      result = intent(state, unit, "collect_intent", event, "worker_collect");
      break;
    case "worker_collected":
      if (unit.state !== "collect_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worker_collect"))
        return badObservation();
      result =
        event.workerResult.status === "failed"
          ? observe(
              state,
              unit,
              "failed",
              event,
              {
                workerResult: event.workerResult,
                repairContext: {
                  baseOid: unit.baseOid,
                  responseHash: event.observationHash,
                  rationale: event.workerResult.summary,
                  findings: [
                    {
                      id: "worker-failed",
                      severity: "blocking",
                      detail: event.workerResult.summary,
                    },
                  ],
                },
              },
              clearUnitOwners(state, unit.id),
            )
          : event.workerResult.status === "needs_repair"
            ? observe(
                state,
                unit,
                "repair_required",
                event,
                {
                  workerResult: event.workerResult,
                  repairContext: {
                    baseOid: unit.baseOid,
                    responseHash: event.observationHash,
                    rationale: event.workerResult.summary,
                    findings: [
                      {
                        id: "worker-needs-repair",
                        severity: "blocking",
                        detail: event.workerResult.summary,
                      },
                    ],
                  },
                },
                clearUnitOwners(state, unit.id),
              )
            : observe(
                state,
                unit,
                "collected",
                event,
                { workerResult: event.workerResult },
                {
                  activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
                    (id) => id !== unit.id,
                  ),
                },
              );
      break;
    case "candidate_intent":
      if (unit.state !== "collected") return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "candidate_intent",
        event,
        "candidate_collect",
      );
      break;
    case "candidate_observed":
      if (unit.state !== "candidate_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "candidate_collect"))
        return badObservation();
      result = observe(
        state,
        unit,
        "candidate_committed",
        event,
        {
          candidateHead: event.headOid,
          candidateTree: event.treeOid,
        },
        { qualificationQueue: insertSorted(state.qualificationQueue, unit.id) },
      );
      break;
    case "verification_intent":
      if (unit.state !== "candidate_committed")
        return illegal(unit, event.type);
      if (
        state.qualificationOwnerUnitId !== undefined &&
        state.qualificationOwnerUnitId !== unit.id
      )
        return reject(
          "invariant",
          "final qualification is owned by another unit",
        );
      if (state.qualificationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic qualification queue",
        );
      result = intent(state, unit, "verification_intent", event, "verify", {
        qualificationOwnerUnitId: unit.id,
        units: replaceUnit(state, {
          ...unit,
          verificationCommands: [...event.commands],
        }),
      });
      break;
    case "verification_observed":
      if (
        unit.state !== "verification_intent" ||
        state.qualificationOwnerUnitId !== unit.id ||
        unit.candidateHead !== event.headOid ||
        unit.candidateTree !== event.treeOid
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "verify"))
        return badObservation();
      result = observe(state, unit, "qualified", event, {
        baseOid: event.baseOid,
        verificationBaseOid: event.baseOid,
        verificationHeadOid: event.headOid,
        verificationTree: event.treeOid,
        verificationEvidenceHash: event.observationHash,
      });
      break;
    case "reviewer_dispatch_intent":
      if (
        unit.state !== "qualified" ||
        state.qualificationOwnerUnitId !== unit.id ||
        state.currentReviewerUnitId !== undefined
      )
        return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "reviewer_dispatch_intent",
        event,
        "review_dispatch",
        {
          currentReviewerUnitId: unit.id,
          units: replaceUnit(state, {
            ...unit,
            reviewerRequestedModel: event.requestedModel,
            reviewPromptHash: event.promptHash,
          }),
        },
      );
      break;
    case "reviewer_observed":
      if (
        unit.state !== "reviewer_dispatch_intent" ||
        state.currentReviewerUnitId !== unit.id ||
        event.requestedModel !== unit.reviewerRequestedModel ||
        event.promptHash !== unit.reviewPromptHash ||
        !sessionIsFresh(state, event.sessionId)
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_dispatch"))
        return badObservation();
      result = observe(
        state,
        unit,
        "reviewer_dispatched",
        event,
        reviewerSession(event),
        recordSession(state, event.sessionId),
      );
      break;
    case "review_collect_intent":
      if (
        unit.state !== "reviewer_dispatched" ||
        state.currentReviewerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "review_collect_intent",
        event,
        "review_collect",
      );
      break;
    case "review_collected": {
      if (
        unit.state !== "review_collect_intent" ||
        state.currentReviewerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_collect"))
        return badObservation();
      const judgmentError = reviewJudgmentError(
        unit,
        event.judgment,
        state.revision,
      );
      if (judgmentError !== undefined)
        return reject("illegal_transition", judgmentError);
      if (event.judgment.decision === "request_changes") {
        if (
          !event.judgment.findings.some(
            (finding) => finding.severity === "blocking",
          )
        )
          return reject(
            "illegal_transition",
            "request_changes requires a blocking finding",
          );
        result = observe(
          state,
          unit,
          "repair_required",
          event,
          {
            repairContext: {
              baseOid: event.judgment.baseOid,
              headOid: event.judgment.headOid,
              treeOid: event.judgment.treeOid,
              responseHash: event.judgment.responseHash,
              rationale: event.judgment.rationale,
              findings: event.judgment.findings,
            },
          },
          clearUnitOwners(state, unit.id),
        );
      } else {
        result = observe(
          state,
          unit,
          "approved",
          event,
          {
            reviewBaseOid: event.judgment.baseOid,
            reviewHeadOid: event.judgment.headOid,
            reviewTree: event.judgment.treeOid,
            approvalResponseHash: event.judgment.responseHash,
          },
          {
            currentReviewerUnitId: null,
            integrationQueue: insertSorted(state.integrationQueue, unit.id),
          },
        );
      }
      break;
    }
    case "publish_intent":
      if (
        !isCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      result = intent(state, unit, "publish_intent", event, "publish");
      break;
    case "publish_observed":
      if (
        unit.state !== "publish_intent" ||
        (event.publication.kind === "push_branch"
          ? unit.candidateHead !== event.publication.remoteHeadOid
          : unit.candidateHead !== event.publication.pullRequest.remoteHeadOid)
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "publish"))
        return badObservation();
      if (state.authorityProfile === "open-pr") {
        if (
          event.publication.kind !== "open_pr" ||
          event.publication.pullRequest.baseRef !== state.integrationBranch ||
          event.publication.pullRequest.baseOid !== unit.reviewBaseOid
        )
          return reject(
            "illegal_transition",
            "open-pr publication lacks the reviewed open pull-request identity and base",
          );
      } else if (event.publication.kind !== "push_branch")
        return reject(
          "illegal_transition",
          "non-open-pr publication must record a push-branch readback",
        );
      const publishedHeadOid =
        event.publication.kind === "open_pr"
          ? event.publication.pullRequest.remoteHeadOid
          : event.publication.remoteHeadOid;
      result = observe(
        state,
        unit,
        isPublicationHandoff(state) ? "handoff" : "published",
        event,
        {
          publishedHeadOid,
          ...(event.publication.kind === "open_pr"
            ? { openPullRequest: event.publication.pullRequest }
            : {}),
        },
        isPublicationHandoff(state) ? clearUnitOwners(state, unit.id) : {},
      );
      break;
    case "integrate_intent":
      if (
        !canIntegrateFrom(state, unit) ||
        !hasCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id ||
        (state.integrationOwnerUnitId !== undefined &&
          state.integrationOwnerUnitId !== unit.id)
      )
        return illegal(unit, event.type);
      if (state.integrationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic integration queue",
        );
      result = intent(state, unit, "integrate_intent", event, "integrate", {
        integrationOwnerUnitId: unit.id,
      });
      break;
    case "integrate_observed":
      if (
        unit.state !== "integrate_intent" ||
        state.integrationOwnerUnitId !== unit.id ||
        event.controllerFencingToken !== state.controllerFencingToken ||
        event.baseOid !== unit.reviewBaseOid ||
        event.headOid !== unit.reviewHeadOid ||
        event.treeOid !== unit.reviewTree
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "integrate"))
        return badObservation();
      result = observe(
        state,
        unit,
        "landed",
        event,
        { landedOid: event.integrationOid },
        {
          qualificationOwnerUnitId: null,
          integrationOwnerUnitId: null,
          qualificationQueue: state.qualificationQueue.filter(
            (id) => id !== unit.id,
          ),
          integrationQueue: state.integrationQueue.filter(
            (id) => id !== unit.id,
          ),
        },
      );
      break;
    case "reservation_release_intent":
      if (
        ![
          "landed",
          "handoff",
          "cancelled",
          "parked",
          "failed",
          "timed_out",
        ].includes(unit.state)
      )
        return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "reservation_release_intent",
        event,
        "reservation_release",
        { reservations: updateReservations(state, unit.id, "release_intent") },
      );
      break;
    case "reservation_released":
      if (unit.state !== "reservation_release_intent")
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_release"))
        return badObservation();
      result = observe(
        state,
        unit,
        "closed",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "released",
            event.effectId,
          ),
        },
      );
      break;
    case "repair_intent":
      if (
        unit.state !== "repair_required" &&
        unit.state !== "failed" &&
        unit.state !== "timed_out"
      )
        return illegal(unit, event.type);
      if (!validRepairJudgment(state, unit, event.judgment, state.revision))
        return reject(
          "illegal_transition",
          "repair judgment is not bound to this unit and revision",
        );
      if (unit.branchRef === undefined || unit.worktreePath === undefined)
        return reject(
          "illegal_transition",
          "repair requires the retained branch and worktree bindings",
        );
      if (unit.repairCount >= 16 || state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(state, unit, "repair_intent", event, "repair", {
        workerRequestedModel: event.requestedModel,
        workerPromptHash: event.promptHash,
      });
      break;
    case "repair_observed":
      if (
        unit.state !== "repair_intent" ||
        event.requestedModel !== unit.workerRequestedModel ||
        event.promptHash !== unit.workerPromptHash ||
        !sessionIsFresh(state, event.sessionId)
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "repair"))
        return badObservation();
      result = observe(
        state,
        unit,
        "dispatched",
        event,
        {
          ...workerSession(event),
          repairCount: unit.repairCount + 1,
        },
        recordSession(state, event.sessionId),
      );
      break;
    case "failure_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "failure_intent", event, "failure");
      break;
    case "failure_observed":
      if (
        unit.state !== "failure_intent" ||
        !matchesIntended(state, event, unit.id, "failure")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "failed",
        event,
        failureRepairContext(unit, event.observationHash, "failure observed"),
        clearUnitOwners(state, unit.id),
      );
      break;
    case "timeout_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "timeout_intent", event, "timeout");
      break;
    case "timeout_observed":
      if (
        unit.state !== "timeout_intent" ||
        !matchesIntended(state, event, unit.id, "timeout")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "timed_out",
        event,
        failureRepairContext(unit, event.observationHash, "timeout observed"),
        clearUnitOwners(state, unit.id),
      );
      break;
    case "park_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "park_intent", event, "park");
      break;
    case "park_observed":
      if (
        unit.state !== "park_intent" ||
        !matchesIntended(state, event, unit.id, "park")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "parked",
        event,
        {},
        clearUnitOwners(state, unit.id),
      );
      break;
    case "cancel_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "cancel_intent", event, "cancel");
      break;
    case "cancel_observed":
      if (
        unit.state !== "cancel_intent" ||
        !matchesIntended(state, event, unit.id, "cancel")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "cancelled",
        event,
        {},
        clearUnitOwners(state, unit.id),
      );
      break;
    case "effect_ambiguous": {
      const entry = state.effectJournal.find(
        (candidate) => candidate.effectId === event.effectId,
      );
      if (
        entry === undefined ||
        entry.unitId !== unit.id ||
        entry.kind !== event.effectKind ||
        entry.status !== "intended"
      )
        return badObservation();
      result = {
        state: {
          ...state,
          state: "blocked",
          effectJournal: state.effectJournal.map((candidate) =>
            candidate.effectId === entry.effectId
              ? {
                  ...candidate,
                  status: "ambiguous" as const,
                  ...(event.observationHash === undefined
                    ? {}
                    : { observationHash: event.observationHash }),
                }
              : candidate,
          ),
          units: replaceUnit(state, { ...unit, state: "blocked" }),
        },
        effects: [],
      };
      break;
    }
    default:
      return exhaustive(event);
  }
  return result === undefined
    ? reject("illegal_transition", "event was not handled")
    : commit(result.state, event, result.effects);
}

type Step = {
  readonly state: RepositoryRun;
  readonly effects: readonly ProtocolEffect[];
};
type IntentEvent = Extract<ProtocolEvent, { idempotencyKey: string }>;
type ObservedEvent = Extract<
  ProtocolEvent,
  { effectId: string; effectKind: EffectKind; observationHash: string }
>;
function effectKindForIntent(
  type: ProtocolEvent["type"],
): EffectKind | undefined {
  const kinds: Partial<Record<ProtocolEvent["type"], EffectKind>> = {
    controller_acquire_intent: "controller_acquire",
    controller_release_intent: "controller_release",
    reservation_intent: "reservation_acquire",
    branch_intent: "branch_create",
    worktree_intent: "worktree_create",
    dispatch_intent: "dispatch",
    collect_intent: "worker_collect",
    candidate_intent: "candidate_collect",
    verification_intent: "verify",
    reviewer_dispatch_intent: "review_dispatch",
    review_collect_intent: "review_collect",
    publish_intent: "publish",
    integrate_intent: "integrate",
    reservation_release_intent: "reservation_release",
    repair_intent: "repair",
    failure_intent: "failure",
    timeout_intent: "timeout",
    park_intent: "park",
    cancel_intent: "cancel",
  };
  return kinds[type];
}
export function deriveIdempotencyKey(
  state: Pick<RepositoryRun, "controller">,
  expectedRevision: number,
  unitId: string | null,
  kind: EffectKind,
): string {
  // The provider only sees a domain-separated digest: no repository identity,
  // prompt, or other raw aggregate payload is exposed. Canonical JSON binds
  // every identity component exactly, including null controller scope.
  return `sce:${sha256(
    canonicalJson({
      domain: "sce.protocol.idempotency.v1",
      effectKind: kind,
      expectedRevision,
      incarnationId: state.controller.incarnationId,
      runId: state.controller.runId,
      unitId,
    }),
  )}`;
}

/**
 * Audit-bind an executable effect's exact typed parameters. Intent callers do
 * not supply this value: it is derived only after the reducer has produced the
 * effect that an adapter may execute.
 */
export function deriveParamsHash(
  kind: EffectKind,
  params: RuntimeEffect["params"],
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.effect-params.v1",
      effectKind: kind,
      params,
      schemaVersion: SCHEMA_VERSION,
    }),
  );
}

export function deriveRepairContextHash(
  context: NonNullable<Unit["repairContext"]>,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-context.v1",
      baseOid: context.baseOid,
      ...(context.headOid === undefined ? {} : { headOid: context.headOid }),
      ...(context.treeOid === undefined ? {} : { treeOid: context.treeOid }),
      responseHash: context.responseHash,
      rationale: context.rationale,
      findings: context.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        detail: finding.detail,
      })),
    }),
  );
}
function effectAllowed(state: RepositoryRun, kind: EffectKind): boolean {
  if (kind === "publish")
    return (
      state.authorityProfile === "push-branch" ||
      state.authorityProfile === "open-pr" ||
      state.authorityProfile === "integrate"
    );
  if (kind !== "integrate") return true;
  return (
    (state.authorityProfile === "integrate" ||
      (state.authorityProfile === "local-change-only" &&
        state.integrationProfile === "local-ff")) &&
    state.integrationProfile !== "none"
  );
}

function isPublicationHandoff(state: RepositoryRun): boolean {
  return (
    state.authorityProfile === "push-branch" ||
    state.authorityProfile === "open-pr"
  );
}
function canIntegrateFrom(state: RepositoryRun, unit: Unit): boolean {
  return (
    unit.state === "published" ||
    (unit.state === "approved" &&
      state.authorityProfile === "local-change-only" &&
      state.integrationProfile === "local-ff")
  );
}
function sessionIsFresh(state: RepositoryRun, sessionId: string): boolean {
  return (
    state.usedSessionCount < LIMITS.sessionHistory &&
    !hasUsedSession(state, sessionId) &&
    !controllerIdentityMatches(state, sessionId) &&
    !Object.values(state.units).some(
      (unit) =>
        unit.workerSessionId === sessionId ||
        unit.reviewerSessionId === sessionId,
    )
  );
}
function recordSession(
  state: RepositoryRun,
  sessionId: string,
): Pick<
  RepositoryRun,
  "usedSessionCount" | "usedSessionFilter" | "usedSessionFilterHash"
> {
  const filter = sessionFilter(state.usedSessionFilter);
  for (const index of sessionFilterIndexes(sessionId))
    filter[index >>> 3] = (filter[index >>> 3] ?? 0) | (1 << (index & 7));
  const usedSessionCount = state.usedSessionCount + 1;
  const usedSessionFilter = filter.toString("base64");
  return {
    usedSessionCount,
    usedSessionFilter,
    usedSessionFilterHash: deriveSessionFilterHash(
      usedSessionFilter,
      usedSessionCount,
    ),
  };
}

export function deriveSessionFilterHash(
  usedSessionFilter: string,
  usedSessionCount: number,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.session-filter.v1",
      usedSessionCount,
      usedSessionFilter,
    }),
  );
}

function controllerIdentityMatches(
  state: Pick<RepositoryRun, "controller">,
  sessionId: string,
): boolean {
  return [
    state.controller.runId,
    state.controller.incarnationId,
    state.controller.holder,
  ].includes(sessionId);
}

export function hasUsedSession(
  state: Pick<RepositoryRun, "usedSessionFilter">,
  sessionId: string,
): boolean {
  if (state.usedSessionFilter.length === 0) return false;
  const filter = sessionFilter(state.usedSessionFilter);
  return sessionFilterIndexes(sessionId).every(
    (index) => ((filter[index >>> 3] ?? 0) & (1 << (index & 7))) !== 0,
  );
}

function sessionFilter(encoded: string): Buffer {
  return encoded.length === 0
    ? Buffer.alloc(LIMITS.sessionFilterBytes)
    : Buffer.from(encoded, "base64");
}

function sessionFilterIndexes(sessionId: string): readonly number[] {
  const digest = sha256(
    canonicalJson({ domain: "sce.protocol.session.v1", sessionId }),
  );
  const first = Number.parseInt(digest.slice(0, 8), 16);
  const step = (Number.parseInt(digest.slice(8, 16), 16) | 1) >>> 0;
  const bitCount = LIMITS.sessionFilterBytes * 8;
  return Array.from(
    { length: LIMITS.sessionFilterHashes },
    (_, index) => (first + index * step) % bitCount,
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
function intentStateForEffect(kind: EffectKind): UnitState | undefined {
  const states: Partial<Record<EffectKind, UnitState>> = {
    reservation_acquire: "reservation_intent",
    branch_create: "branch_intent",
    worktree_create: "worktree_intent",
    dispatch: "dispatch_intent",
    worker_collect: "collect_intent",
    candidate_collect: "candidate_intent",
    verify: "verification_intent",
    review_dispatch: "reviewer_dispatch_intent",
    review_collect: "review_collect_intent",
    publish: "publish_intent",
    integrate: "integrate_intent",
    reservation_release: "reservation_release_intent",
    repair: "repair_intent",
    failure: "failure_intent",
    timeout: "timeout_intent",
    park: "park_intent",
    cancel: "cancel_intent",
  };
  return states[kind];
}
function effectMatchesObservation(
  type: ProtocolEvent["type"],
  kind: EffectKind,
): boolean {
  const observations: Partial<Record<EffectKind, ProtocolEvent["type"]>> = {
    reservation_acquire: "reservation_observed",
    branch_create: "branch_observed",
    worktree_create: "worktree_observed",
    dispatch: "dispatch_observed",
    worker_collect: "worker_collected",
    candidate_collect: "candidate_observed",
    verify: "verification_observed",
    review_dispatch: "reviewer_observed",
    review_collect: "review_collected",
    publish: "publish_observed",
    integrate: "integrate_observed",
    reservation_release: "reservation_released",
    repair: "repair_observed",
    failure: "failure_observed",
    timeout: "timeout_observed",
    park: "park_observed",
    cancel: "cancel_observed",
  };
  return observations[kind] === type;
}
function recoverAmbiguousUnitObservation(
  state: RepositoryRun,
  event: ProtocolEvent,
): RepositoryRun | undefined {
  if (
    !("unitId" in event) ||
    event.unitId === null ||
    event.type === "effect_ambiguous" ||
    !("effectId" in event) ||
    !("effectKind" in event)
  )
    return undefined;
  const unit = state.units[event.unitId];
  const entry = state.effectJournal.find(
    (effect) =>
      effect.effectId === event.effectId &&
      effect.unitId === event.unitId &&
      effect.kind === event.effectKind &&
      effect.status === "ambiguous",
  );
  const recoveredState = intentStateForEffect(event.effectKind);
  if (
    unit === undefined ||
    unit.state !== "blocked" ||
    entry === undefined ||
    recoveredState === undefined ||
    !effectMatchesObservation(event.type, event.effectKind)
  )
    return undefined;
  return {
    ...state,
    state: "active",
    units: replaceUnit(state, { ...unit, state: recoveredState }),
    effectJournal: state.effectJournal.map((effect) =>
      effect.effectId === entry.effectId ? restoreIntended(effect) : effect,
    ),
  };
}

function restoreIntended(entry: EffectJournalEntry): EffectJournalEntry {
  const { observationHash: _ambiguousObservation, ...intended } = entry;
  return { ...intended, status: "intended" };
}

function reduceController(
  state: RepositoryRun,
  event: Extract<ProtocolEvent, { type: `controller_${string}` }>,
): Reduction {
  let result: Step | undefined;
  switch (event.type) {
    case "controller_acquire_intent":
      if (
        state.state !== "initializing" ||
        state.controller.state !== "unacquired"
      )
        return reject(
          "illegal_transition",
          "controller acquisition is not legal",
        );
      result = controllerIntent(
        state,
        event,
        "controller_acquire",
        "initializing",
        "acquire_intent",
      );
      break;
    case "controller_acquired":
      if (
        (state.state !== "initializing" && state.state !== "blocked") ||
        state.controller.state !== "acquire_intent" ||
        event.holder !== state.controller.holder ||
        event.controllerFencingToken !== state.controllerFencingToken ||
        !matchesRecoverableEffect(state, event, null, "controller_acquire")
      )
        return badObservation();
      result = {
        state: markObserved(state, event.effectId, event.observationHash, {
          state: "active",
          controller: { ...state.controller, state: "acquired" },
        }),
        effects: [],
      };
      break;
    case "controller_release_intent":
      if (!canReleaseController(state))
        return reject(
          "illegal_transition",
          "controller release requires closed units and released reservations",
        );
      result = controllerIntent(
        state,
        event,
        "controller_release",
        "release_intent",
        "release_intent",
      );
      break;
    case "controller_released":
      if (
        (state.state !== "release_intent" && state.state !== "blocked") ||
        state.controller.state !== "release_intent" ||
        !matchesRecoverableEffect(state, event, null, "controller_release")
      )
        return badObservation();
      result = {
        state: markObserved(state, event.effectId, event.observationHash, {
          state: "released",
          controller: { ...state.controller, state: "released" },
        }),
        effects: [],
      };
      break;
    default:
      return exhaustive(event);
  }
  return commit(result.state, event, result.effects);
}

function controllerIntent(
  state: RepositoryRun,
  event: IntentEvent,
  kind: Extract<EffectKind, "controller_acquire" | "controller_release">,
  aggregateState: RepositoryRun["state"],
  controllerState: RepositoryRun["controller"]["state"],
): Step {
  return appendIntent(
    {
      ...state,
      state: aggregateState,
      controller: { ...state.controller, state: controllerState },
    },
    null,
    event,
    kind,
  );
}
function modifyingIntent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: Extract<EffectKind, "dispatch" | "repair">,
  unitChanges: Partial<Unit> = {},
): Step {
  return intent(state, unit, next, event, kind, {
    activeModifyingUnitIds: [...state.activeModifyingUnitIds, unit.id],
    ...(Object.keys(unitChanges).length === 0
      ? {}
      : { units: replaceUnit(state, { ...unit, ...unitChanges }) }),
  });
}
function terminalIntent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">,
): Step {
  const retainsQualification =
    state.qualificationOwnerUnitId === unit.id ||
    state.currentReviewerUnitId === unit.id;
  return intent(state, unit, next, event, kind, {
    // An active worker or reviewer remains owned until the exact terminal
    // observation confirms that its role/session target was handled.
    activeModifyingUnitIds: state.activeModifyingUnitIds,
    qualificationQueue: retainsQualification
      ? state.qualificationQueue
      : state.qualificationQueue.filter((id) => id !== unit.id),
    integrationQueue: state.integrationQueue.filter((id) => id !== unit.id),
  });
}
function intent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: EffectKind,
  changes: AggregateChanges = {},
): Step {
  const changedUnit = changes.units?.[unit.id] ?? unit;
  const base = {
    ...state,
    ...changes,
    units: {
      ...(changes.units ?? state.units),
      [unit.id]: { ...changedUnit, state: next, revision: unit.revision + 1 },
    },
  };
  return appendIntent(
    normalizeOwners(base as RepositoryRun, changes),
    unit.id,
    event,
    kind,
  );
}
function appendIntent(
  state: RepositoryRun,
  unitId: string | null,
  event: IntentEvent,
  kind: EffectKind,
): Step {
  const compacted = compactJournal(state);
  const effectId = `${event.eventId}:${kind}`;
  const params = runtimeEffectParams(
    compacted,
    unitId,
    kind,
  ) as RuntimeEffect["params"];
  const paramsHash = deriveParamsHash(kind, params);
  const effect: ProtocolEffect = {
    kind,
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    paramsHash,
    schemaVersion: SCHEMA_VERSION,
    params,
  } as ProtocolEffect;
  const entry: EffectJournalEntry = {
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    kind,
    paramsHash,
    status: "intended",
    schemaVersion: SCHEMA_VERSION,
  };
  const validEffect = validate<RuntimeEffect>(RuntimeEffectSchema, effect);
  if (!validEffect.ok)
    throw new Error(
      `runtime effect construction failed: ${validEffect.errors.join("; ")}`,
    );
  return {
    state: { ...compacted, effectJournal: [...compacted.effectJournal, entry] },
    effects: [effect],
  };
}
function runtimeEffectParams(
  state: RepositoryRun,
  unitId: string | null,
  kind: EffectKind,
): unknown {
  if (kind === "controller_acquire")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
      requestedModel: state.controller.requestedModel,
      returnedModel: state.controller.returnedModel,
      promptHash: state.controller.promptHash,
    };
  if (kind === "controller_release")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
    };
  if (unitId === null) throw new Error(`${kind} requires a unit`);
  const unit = state.units[unitId];
  if (unit === undefined) throw new Error(`${kind} has an unknown unit`);
  const worker = () => ({
    branchRef: required(unit.branchRef, "branch ref", kind),
    worktreePath: required(unit.worktreePath, "worktree path", kind),
    requestedModel: required(unit.workerRequestedModel, "worker model", kind),
    promptHash: required(unit.workerPromptHash, "worker prompt", kind),
  });
  const candidate = () => ({
    baseOid: required(
      unit.verificationBaseOid ?? unit.baseOid,
      "candidate base",
      kind,
    ),
    headOid: required(unit.candidateHead, "candidate head", kind),
    treeOid: required(unit.candidateTree, "candidate tree", kind),
  });
  switch (kind) {
    case "reservation_acquire":
      return {
        reservations: unit.reservationIds.map((id) => {
          const reservation = state.reservations[id];
          if (reservation === undefined)
            throw new Error(
              `reservation acquire has unknown reservation ${id}`,
            );
          return {
            id: reservation.id,
            namespace: reservation.namespace,
            resource: reservation.resource,
          };
        }),
      };
    case "branch_create":
      return {
        baseOid: unit.baseOid,
        branchRef: required(unit.branchRef, "branch ref", kind),
      };
    case "worktree_create":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind),
      };
    case "dispatch":
      return worker();
    case "worker_collect":
      return {
        sessionId: required(unit.workerSessionId, "worker session", kind),
      };
    case "candidate_collect":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind),
      };
    case "verify":
      return {
        candidate: {
          baseOid: unit.baseOid,
          headOid: required(unit.candidateHead, "candidate head", kind),
          treeOid: required(unit.candidateTree, "candidate tree", kind),
        },
        commands: required(
          unit.verificationCommands,
          "verification commands",
          kind,
        ),
      };
    case "review_dispatch":
      return {
        candidate: candidate(),
        requestedModel: required(
          unit.reviewerRequestedModel,
          "reviewer model",
          kind,
        ),
        promptHash: required(unit.reviewPromptHash, "reviewer prompt", kind),
      };
    case "review_collect":
      return {
        sessionId: required(unit.reviewerSessionId, "reviewer session", kind),
        candidate: candidate(),
      };
    case "publish":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        candidate: candidate(),
        authorityProfile: state.authorityProfile,
      };
    case "integrate":
      return {
        integrationBranch: state.integrationBranch,
        integrationProfile: state.integrationProfile,
        controllerFencingToken: state.controllerFencingToken,
        candidate: candidate(),
      };
    case "reservation_release":
      return { reservationIds: [...unit.reservationIds] };
    case "repair": {
      const context = required(unit.repairContext, "repair context", kind);
      return {
        ...worker(),
        repairBaseOid: context.baseOid,
        ...(context.headOid === undefined
          ? {}
          : { repairHeadOid: context.headOid }),
        ...(context.treeOid === undefined
          ? {}
          : { repairTreeOid: context.treeOid }),
      };
    }
    case "failure":
    case "timeout":
    case "park":
    case "cancel":
      return terminalEffectParams(state, unit, kind);
    default:
      return exhaustive(kind);
  }
}

function terminalEffectParams(
  state: RepositoryRun,
  unit: Unit,
  kind: Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">,
): RuntimeEffect["params"] {
  if (state.currentReviewerUnitId === unit.id)
    return {
      role: "reviewer",
      sessionId: required(unit.reviewerSessionId, "reviewer session", kind),
    };
  if (state.activeModifyingUnitIds.includes(unit.id))
    return {
      role: "worker",
      sessionId: required(unit.workerSessionId, "worker session", kind),
    };
  return { role: "none" };
}
function required<T>(value: T | undefined, name: string, kind: EffectKind): T {
  if (value === undefined) throw new Error(`${kind} lacks ${name}`);
  return value;
}
function compactJournal(state: RepositoryRun): RepositoryRun {
  const anchored = new Set(
    Object.values(state.reservations)
      .flatMap((reservation) => [
        reservation.state === "released"
          ? undefined
          : reservation.acquireEffectId,
        reservation.state === "released"
          ? reservation.releaseEffectId
          : undefined,
      ])
      .filter((effectId): effectId is string => effectId !== undefined),
  );
  const retained = state.effectJournal.filter(
    (entry) => entry.status !== "observed" || anchored.has(entry.effectId),
  );
  const compacted = state.effectJournal.length - retained.length;
  return compacted === 0
    ? state
    : {
        ...state,
        effectJournal: retained,
        journalCheckpoint: {
          revision: state.revision,
          compactedEffects:
            state.journalCheckpoint.compactedEffects + compacted,
          compactedEvents: state.journalCheckpoint.compactedEvents,
          compactedIdempotencyKeys:
            state.journalCheckpoint.compactedIdempotencyKeys,
        },
      };
}
type AggregateChanges = Omit<
  Partial<RepositoryRun>,
  | "qualificationOwnerUnitId"
  | "integrationOwnerUnitId"
  | "currentReviewerUnitId"
> & {
  qualificationOwnerUnitId?: string | null;
  integrationOwnerUnitId?: string | null;
  currentReviewerUnitId?: string | null;
};
function observe(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: ObservedEvent,
  unitChanges: Partial<Unit> = {},
  aggregateChanges: AggregateChanges = {},
): Step {
  const nextUnit = {
    ...unit,
    ...unitChanges,
    state: next,
    revision: unit.revision + 1,
  };
  const nextState = markObserved(
    {
      ...state,
      ...(aggregateChanges as Partial<RepositoryRun>),
      units: replaceUnit(state, nextUnit),
    },
    event.effectId,
    event.observationHash,
  );
  return { state: normalizeOwners(nextState, aggregateChanges), effects: [] };
}
function markObserved(
  state: RepositoryRun,
  effectId: string,
  observationHash: string,
  changes: Partial<RepositoryRun> = {},
): RepositoryRun {
  return {
    ...state,
    ...changes,
    effectJournal: state.effectJournal.map((entry) =>
      entry.effectId === effectId
        ? { ...entry, status: "observed" as const, observationHash }
        : entry,
    ),
  };
}
function normalizeOwners(
  state: RepositoryRun,
  changes: AggregateChanges,
): RepositoryRun {
  const next = { ...state };
  if (changes.qualificationOwnerUnitId === null)
    delete next.qualificationOwnerUnitId;
  if (changes.integrationOwnerUnitId === null)
    delete next.integrationOwnerUnitId;
  if (changes.currentReviewerUnitId === null) delete next.currentReviewerUnitId;
  return next;
}
function replaceUnit(state: RepositoryRun, unit: Unit): RepositoryRun["units"] {
  return { ...state.units, [unit.id]: unit };
}
function matchesIntended(
  state: RepositoryRun,
  event: ObservedEvent,
  unitId: string | null,
  kind: EffectKind,
): boolean {
  return state.effectJournal.some(
    (entry) =>
      entry.effectId === event.effectId &&
      entry.unitId === unitId &&
      entry.kind === kind &&
      entry.kind === event.effectKind &&
      entry.status === "intended",
  );
}
function matchesRecoverableEffect(
  state: RepositoryRun,
  event: ObservedEvent,
  unitId: string | null,
  kind: EffectKind,
): boolean {
  return state.effectJournal.some(
    (entry) =>
      entry.effectId === event.effectId &&
      entry.unitId === unitId &&
      entry.kind === kind &&
      entry.kind === event.effectKind &&
      (entry.status === "intended" || entry.status === "ambiguous"),
  );
}
function badObservation(): Reduction {
  return reject(
    "illegal_transition",
    "observation does not match an intended effect id, unit, kind, and status",
  );
}
function workerSession(
  event: Extract<
    ProtocolEvent,
    { type: "dispatch_observed" | "repair_observed" }
  >,
): Partial<Unit> {
  return {
    workerSessionId: event.sessionId,
    workerRequestedModel: event.requestedModel,
    workerReturnedModel: event.returnedModel,
    workerPromptHash: event.promptHash,
  };
}
function reviewerSession(
  event: Extract<ProtocolEvent, { type: "reviewer_observed" }>,
): Partial<Unit> {
  return {
    reviewerSessionId: event.sessionId,
    reviewerRequestedModel: event.requestedModel,
    reviewerReturnedModel: event.returnedModel,
    reviewPromptHash: event.promptHash,
  };
}
function reviewJudgmentError(
  unit: Unit,
  judgment: Extract<ProtocolEvent, { type: "review_collected" }>["judgment"],
  revision: number,
): string | undefined {
  if (
    judgment.role !== "reviewer" ||
    judgment.kind !== "review_verdict" ||
    judgment.unitId !== unit.id
  )
    return "review judgment has wrong role, kind, or unit";
  if (
    judgment.aggregateRevision !== revision ||
    judgment.sessionId !== unit.reviewerSessionId ||
    judgment.requestedModel !== unit.reviewerRequestedModel ||
    judgment.returnedModel !== unit.reviewerReturnedModel ||
    judgment.promptHash !== unit.reviewPromptHash
  )
    return "review judgment is not bound to the dispatched reviewer session, model, prompt, and revision";
  if (
    judgment.baseOid !== unit.verificationBaseOid ||
    judgment.headOid !== unit.candidateHead ||
    judgment.treeOid !== unit.candidateTree
  )
    return "review judgment is not bound to the verified base, head, and tree";
  if (
    judgment.decision === "approve" &&
    judgment.findings.some((finding) => finding.severity === "blocking")
  )
    return "approval cannot contain blocking findings";
  return undefined;
}
function validRepairJudgment(
  state: RepositoryRun,
  unit: Unit,
  judgment: NonNullable<
    Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"]
  >,
  revision: number,
): boolean {
  const context = unit.repairContext;
  return (
    context !== undefined &&
    judgment.role === "controller" &&
    judgment.kind === "repair_disposition" &&
    judgment.unitId === unit.id &&
    judgment.aggregateRevision === revision &&
    judgment.sessionId === state.controller.incarnationId &&
    judgment.requestedModel === state.controller.requestedModel &&
    judgment.returnedModel === state.controller.returnedModel &&
    judgment.factOid === (context.headOid ?? context.baseOid) &&
    judgment.currentEvidenceHash === context.responseHash &&
    judgment.findingsContextHash === deriveRepairContextHash(context) &&
    (context.headOid === undefined || context.headOid === unit.candidateHead) &&
    judgment.decision === "repair"
  );
}
function failureRepairContext(
  unit: Unit,
  responseHash: string,
  rationale: string,
): Partial<Unit> {
  if (unit.candidateHead === undefined || unit.candidateTree === undefined)
    return {};
  return {
    repairContext: {
      baseOid: unit.verificationBaseOid ?? unit.baseOid,
      headOid: unit.candidateHead,
      treeOid: unit.candidateTree,
      responseHash,
      rationale,
      findings: [
        { id: "runtime-failure", severity: "blocking", detail: rationale },
      ],
    },
  };
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
function insertSorted(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value].sort();
}
function updateReservations(
  state: RepositoryRun,
  unitId: string,
  next: "reserved" | "release_intent" | "released",
  effectId?: string,
): RepositoryRun["reservations"] {
  return Object.fromEntries(
    Object.entries(state.reservations).map(([id, reservation]) => [
      id,
      reservation.unitId !== unitId
        ? reservation
        : {
            ...reservation,
            state: next,
            ...(next === "reserved" && effectId !== undefined
              ? { acquireEffectId: effectId }
              : {}),
            ...(next === "released" && effectId !== undefined
              ? { releaseEffectId: effectId }
              : {}),
          },
    ]),
  );
}
function clearUnitOwners(
  state: RepositoryRun,
  unitId: string,
): AggregateChanges {
  return {
    activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
      (id) => id !== unitId,
    ),
    qualificationQueue: state.qualificationQueue.filter((id) => id !== unitId),
    integrationQueue: state.integrationQueue.filter((id) => id !== unitId),
    ...(state.qualificationOwnerUnitId === unitId
      ? { qualificationOwnerUnitId: null }
      : {}),
    ...(state.integrationOwnerUnitId === unitId
      ? { integrationOwnerUnitId: null }
      : {}),
    ...(state.currentReviewerUnitId === unitId
      ? { currentReviewerUnitId: null }
      : {}),
  };
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

function commit(
  state: RepositoryRun,
  event: ProtocolEvent,
  effects: readonly ProtocolEffect[],
): Reduction {
  const eventIds = [...state.processedEventIds, event.eventId];
  const idempotencyKeys =
    "idempotencyKey" in event
      ? [...state.processedIdempotencyKeys, event.idempotencyKey]
      : state.processedIdempotencyKeys;
  const compactedEvents = Math.max(0, eventIds.length - 256);
  const compactedIdempotencyKeys = Math.max(0, idempotencyKeys.length - 256);
  const nextState = {
    ...state,
    revision: state.revision + 1,
    processedEventIds: eventIds.slice(-256),
    processedIdempotencyKeys: idempotencyKeys.slice(-256),
    journalCheckpoint: {
      ...state.journalCheckpoint,
      revision:
        compactedEvents > 0 || compactedIdempotencyKeys > 0
          ? state.revision + 1
          : state.journalCheckpoint.revision,
      compactedEvents:
        state.journalCheckpoint.compactedEvents + compactedEvents,
      compactedIdempotencyKeys:
        state.journalCheckpoint.compactedIdempotencyKeys +
        compactedIdempotencyKeys,
    },
  };
  const schema = validate<RepositoryRun>(RepositoryRunSchema, nextState);
  if (!schema.ok) return reject("invariant", schema.errors.join("; "));
  const errors = runInvariantErrors(nextState);
  return errors.length
    ? reject("invariant", errors.join("; "))
    : { ok: true, nextState, effects };
}

export function runInvariantErrors(state: RepositoryRun): readonly string[] {
  const errors: string[] = [];
  const effectIds = new Set<string>();
  const idempotency = new Set<string>();
  const waveIds = new Set(state.wave.unitIds);
  const unresolvedByUnit = new Map<string, EffectJournalEntry[]>();
  const addUnresolved = (entry: EffectJournalEntry) => {
    if (entry.unitId === null) return;
    const entries = unresolvedByUnit.get(entry.unitId) ?? [];
    entries.push(entry);
    unresolvedByUnit.set(entry.unitId, entries);
  };
  if (
    new TextEncoder().encode(
      JSON.stringify({
        schema: "sce.repository-run",
        version: SCHEMA_VERSION,
        payload: state,
      }),
    ).byteLength > LIMITS.envelopeBytes
  )
    errors.push("repository run envelope exceeds byte limit");
  if (
    state.controller.holder !==
    `${state.controller.runId}/${state.controller.incarnationId}`
  )
    errors.push("controller holder does not bind immutable run incarnation");
  if (
    state.authorityProfile !== "integrate" &&
    ["remote-ff", "github-merge-group"].includes(state.integrationProfile)
  )
    errors.push(
      "non-integrating authority cannot claim a remote integration profile",
    );
  if (state.wave.unitIds.length > 3)
    errors.push("wave exceeds the three-unit implementation cap");
  for (const queue of [
    state.wave.unitIds,
    state.qualificationQueue,
    state.integrationQueue,
    state.activeModifyingUnitIds,
  ])
    if (
      new Set(queue).size !== queue.length ||
      queue.some((id) => state.units[id] === undefined)
    )
      errors.push("queue contains duplicate or unknown unit");
  for (const queue of [state.qualificationQueue, state.integrationQueue]) {
    if (queue.join("\u0000") !== [...queue].sort().join("\u0000"))
      errors.push("queue order is not deterministic");
    if (queue.some((id) => !waveIds.has(id)))
      errors.push("queue contains a unit outside the current wave");
  }
  const oidLength = state.gitObjectFormat === "sha1" ? 40 : 64;
  const checkOid = (unit: Unit, value: string | undefined) => {
    if (value !== undefined && value.length !== oidLength)
      errors.push(
        `unit ${unit.id} has an OID incompatible with repository object format`,
      );
  };
  for (const unit of Object.values(state.units)) {
    for (const value of [
      unit.baseOid,
      unit.candidateHead,
      unit.candidateTree,
      unit.publishedHeadOid,
      unit.verificationBaseOid,
      unit.verificationHeadOid,
      unit.verificationTree,
      unit.reviewBaseOid,
      unit.reviewHeadOid,
      unit.reviewTree,
      unit.landedOid,
      unit.openPullRequest?.baseOid,
      unit.openPullRequest?.remoteHeadOid,
      unit.repairContext?.baseOid,
      unit.repairContext?.headOid,
      unit.repairContext?.treeOid,
    ])
      checkOid(unit, value);
    if (
      unit.repairContext?.headOid === undefined &&
      unit.repairContext?.treeOid !== undefined
    )
      errors.push(`repair context ${unit.id} has a tree without a head`);
  }
  const packedSessions = Buffer.from(state.usedSessionFilter, "base64");
  if (
    (state.usedSessionCount === 0 && state.usedSessionFilter !== "") ||
    (state.usedSessionCount > 0 &&
      (packedSessions.length !== LIMITS.sessionFilterBytes ||
        packedSessions.toString("base64") !== state.usedSessionFilter))
  )
    errors.push("used session identity history is invalid");
  if (
    state.usedSessionFilterHash !==
    deriveSessionFilterHash(state.usedSessionFilter, state.usedSessionCount)
  )
    errors.push("used session identity history integrity hash is invalid");
  if (
    state.usedSessionCount > 0 &&
    packedSessions.length === LIMITS.sessionFilterBytes &&
    packedSessions.every((value) => value === 0)
  )
    errors.push("used session identity history has no set bits for its count");
  for (const effect of state.effectJournal) {
    if (effectIds.has(effect.effectId))
      errors.push(`duplicate effect id ${effect.effectId}`);
    effectIds.add(effect.effectId);
    if (idempotency.has(effect.idempotencyKey))
      errors.push(`duplicate idempotency key ${effect.idempotencyKey}`);
    idempotency.add(effect.idempotencyKey);
    if (effect.unitId !== null && state.units[effect.unitId] === undefined)
      errors.push(`effect ${effect.effectId} has unknown unit`);
    if (effect.status === "intended" && effect.observationHash !== undefined)
      errors.push(`intended effect ${effect.effectId} has an observation`);
    if (effect.status === "observed" && effect.observationHash === undefined)
      errors.push(`observed effect ${effect.effectId} has no observation`);
    if (effect.status === "intended" || effect.status === "ambiguous")
      addUnresolved(effect);
    if (
      effect.unitId !== null &&
      (effect.status === "intended" || effect.status === "ambiguous") &&
      !waveIds.has(effect.unitId)
    )
      errors.push(
        `unresolved effect ${effect.effectId} is outside the current wave`,
      );
    if (effect.status === "intended" || effect.status === "ambiguous") {
      try {
        const expectedParams = runtimeEffectParams(
          state,
          effect.unitId,
          effect.kind,
        ) as RuntimeEffect["params"];
        if (effect.paramsHash !== deriveParamsHash(effect.kind, expectedParams))
          errors.push(`effect ${effect.effectId} has an invalid params hash`);
      } catch {
        errors.push(
          `effect ${effect.effectId} lacks reconstructable parameters`,
        );
      }
    }
  }
  // The map is filled explicitly because a unit's durable phase determines
  // exactly one unresolved external act; this rejects both orphaned and
  // stacked intents on hydration.
  const intentByState: Partial<Record<UnitState, EffectKind>> = {
    reservation_intent: "reservation_acquire",
    branch_intent: "branch_create",
    worktree_intent: "worktree_create",
    dispatch_intent: "dispatch",
    collect_intent: "worker_collect",
    candidate_intent: "candidate_collect",
    verification_intent: "verify",
    reviewer_dispatch_intent: "review_dispatch",
    review_collect_intent: "review_collect",
    publish_intent: "publish",
    integrate_intent: "integrate",
    reservation_release_intent: "reservation_release",
    repair_intent: "repair",
    failure_intent: "failure",
    timeout_intent: "timeout",
    park_intent: "park",
    cancel_intent: "cancel",
  };
  const requiredActiveStates = new Set<UnitState>([
    "dispatch_intent",
    "dispatched",
    "collect_intent",
    "repair_intent",
  ]);
  const optionallyActiveStates = new Set<UnitState>([
    ...requiredActiveStates,
    "failure_intent",
    "timeout_intent",
    "cancel_intent",
    "park_intent",
  ]);
  for (const id of state.activeModifyingUnitIds) {
    if (state.units[id] === undefined)
      errors.push(`active modifying unit ${id} is unknown`);
    else if (!waveIds.has(id))
      errors.push(`active modifying unit ${id} is outside the current wave`);
  }
  const assignedSessions = new Map<string, string>();
  for (const [id, unit] of Object.entries(state.units)) {
    if (id !== unit.id)
      errors.push(`unit map key ${id} does not match unit id ${unit.id}`);
    if (
      unit.reservationIds.some(
        (reservationId) =>
          state.reservations[reservationId]?.unitId !== unit.id,
      )
    )
      errors.push(`unit ${id} claims an invalid reservation`);
    const unresolved = unresolvedByUnit.get(id) ?? [];
    if (unresolved.length > 0 && !waveIds.has(id))
      errors.push(
        `unit ${id} has unresolved evidence outside the current wave`,
      );
    const expectedKind = intentByState[unit.state];
    if (unit.state === "blocked") {
      if (
        unresolved.length !== 1 ||
        unresolved[0]?.status !== "ambiguous" ||
        intentStateForEffect(unresolved[0]?.kind ?? "dispatch") === undefined
      )
        errors.push(`blocked unit ${id} lacks one exact ambiguous effect`);
    } else if (expectedKind !== undefined) {
      if (
        unresolved.length !== 1 ||
        unresolved[0]?.kind !== expectedKind ||
        unresolved[0]?.status !== "intended"
      )
        errors.push(`intent state ${id} lacks one exact unresolved effect`);
    } else if (unresolved.length !== 0)
      errors.push(`stable unit ${id} has an orphan unresolved effect`);
    if (
      unit.reservationIds.length > 0 &&
      unit.state !== "reservation_intent" &&
      unit.state !== "reservation_release_intent" &&
      unit.state !== "blocked" &&
      unit.state !== "closed" &&
      !unit.reservationIds.every(
        (reservationId) =>
          state.reservations[reservationId]?.state === "reserved",
      )
    )
      errors.push(`reserved lifecycle ${id} lacks acquired reservations`);
    if (
      unit.state === "reservation_release_intent" &&
      !unit.reservationIds.every(
        (reservationId) =>
          state.reservations[reservationId]?.state === "release_intent",
      )
    )
      errors.push(`reservation cleanup ${id} lacks release intent`);
    if (
      unit.state === "closed" &&
      !unit.reservationIds.every(
        (reservationId) =>
          state.reservations[reservationId]?.state === "released",
      )
    )
      errors.push(`closed unit ${id} retains a non-released reservation`);
    if (
      [
        "branch_intent",
        "branch_observed",
        "worktree_intent",
        "worktree_observed",
      ].includes(unit.state) &&
      unit.branchRef === undefined
    )
      errors.push(`branch lifecycle ${id} lacks branch ref`);
    if (
      ["worktree_intent", "worktree_observed"].includes(unit.state) &&
      unit.worktreePath === undefined
    )
      errors.push(`worktree lifecycle ${id} lacks worktree path`);
    if (
      [
        "dispatched",
        "collect_intent",
        "collected",
        "candidate_intent",
      ].includes(unit.state) &&
      (unit.workerSessionId === undefined ||
        unit.workerPromptHash === undefined ||
        unit.workerRequestedModel === undefined ||
        unit.workerReturnedModel === undefined)
    )
      errors.push(`worker lifecycle ${id} lacks bound session`);
    if (
      [
        "candidate_committed",
        "verification_intent",
        "qualified",
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.candidateHead === undefined || unit.candidateTree === undefined)
    )
      errors.push(`candidate lifecycle ${id} lacks exact objects`);
    if (
      [
        "qualified",
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.verificationBaseOid === undefined ||
        unit.verificationHeadOid === undefined ||
        unit.verificationTree === undefined ||
        unit.verificationEvidenceHash === undefined)
    )
      errors.push(`qualification lifecycle ${id} lacks verification evidence`);
    if (
      unit.state === "verification_intent" &&
      (unit.verificationCommands === undefined ||
        unit.verificationCommands.length === 0)
    )
      errors.push(`verification intent ${id} lacks commands`);
    if (
      ["reviewer_dispatched", "review_collect_intent"].includes(unit.state) &&
      (unit.reviewerSessionId === undefined ||
        unit.reviewPromptHash === undefined ||
        unit.reviewerRequestedModel === undefined ||
        unit.reviewerReturnedModel === undefined)
    )
      errors.push(`review lifecycle ${id} lacks bound session`);
    if (
      [
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.reviewBaseOid === undefined ||
        unit.reviewHeadOid === undefined ||
        unit.reviewTree === undefined ||
        unit.approvalResponseHash === undefined)
    )
      errors.push(`approval lifecycle ${id} lacks exact verdict`);
    if (
      ["published", "handoff"].includes(unit.state) &&
      unit.publishedHeadOid === undefined
    )
      errors.push(`published unit ${id} lacks remote-head readback`);
    if (
      state.authorityProfile === "open-pr" &&
      unit.state === "handoff" &&
      (unit.openPullRequest === undefined ||
        unit.openPullRequest.baseRef !== state.integrationBranch ||
        unit.openPullRequest.baseOid !== unit.reviewBaseOid ||
        unit.openPullRequest.remoteHeadOid !== unit.publishedHeadOid ||
        unit.openPullRequest.remoteHeadOid !== unit.candidateHead)
    )
      errors.push(
        `open-pr handoff ${id} lacks exact open pull-request evidence`,
      );
    if (
      unit.openPullRequest !== undefined &&
      state.authorityProfile !== "open-pr"
    )
      errors.push(
        `unit ${id} retains pull-request evidence outside open-pr authority`,
      );
    if (unit.state === "landed" && unit.landedOid === undefined)
      errors.push(`landed ${id} lacks integration readback`);
    if (unit.state === "repair_required" && unit.repairContext === undefined)
      errors.push(`repair-required ${id} lacks retained repair context`);
    if (
      unit.workerSessionId !== undefined &&
      unit.workerSessionId === unit.reviewerSessionId
    )
      errors.push(`unit ${id} reuses one session for worker and reviewer`);
    for (const [role, session] of [
      ["worker", unit.workerSessionId],
      ["reviewer", unit.reviewerSessionId],
    ] as const) {
      if (session === undefined) continue;
      if (!hasUsedSession(state, session))
        errors.push(`session ${session} is not retained in durable history`);
      if (controllerIdentityMatches(state, session))
        errors.push(`session ${session} aliases controller identity`);
      const prior = assignedSessions.get(session);
      if (prior !== undefined)
        errors.push(
          `session ${session} is shared by ${prior} and ${id}/${role}`,
        );
      else assignedSessions.set(session, `${id}/${role}`);
    }
    const isActive = state.activeModifyingUnitIds.includes(id);
    const ambiguousKind =
      unresolved[0]?.status === "ambiguous" ? unresolved[0].kind : undefined;
    const allowedActive =
      optionallyActiveStates.has(unit.state) ||
      (unit.state === "blocked" &&
        ambiguousKind !== undefined &&
        [
          "dispatch",
          "repair",
          "worker_collect",
          "failure",
          "timeout",
          "park",
          "cancel",
        ].includes(ambiguousKind));
    if (
      (requiredActiveStates.has(unit.state) && !isActive) ||
      (isActive && !allowedActive)
    )
      errors.push(`active-session set disagrees with ${id}`);
  }
  for (const [id, reservation] of Object.entries(state.reservations)) {
    if (id !== reservation.id)
      errors.push(`reservation map key ${id} does not match reservation id`);
    if (state.units[reservation.unitId] === undefined)
      errors.push(`reservation ${id} has unknown owner`);
    const effectId =
      reservation.state === "released"
        ? reservation.releaseEffectId
        : reservation.acquireEffectId;
    const kind =
      reservation.state === "released"
        ? "reservation_release"
        : "reservation_acquire";
    if (
      ["reserved", "released"].includes(reservation.state) &&
      (effectId === undefined ||
        !state.effectJournal.some(
          (effect) =>
            effect.effectId === effectId &&
            effect.unitId === reservation.unitId &&
            effect.kind === kind &&
            effect.status === "observed",
        ))
    )
      errors.push(`reserved ${id} has no exact acquisition journal lineage`);
  }
  const controllerUnresolved = state.effectJournal.filter(
    (effect) =>
      effect.unitId === null &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
  const expectedControllerKind =
    state.controller.state === "acquire_intent"
      ? "controller_acquire"
      : state.controller.state === "release_intent"
        ? "controller_release"
        : undefined;
  if (
    (expectedControllerKind === undefined &&
      controllerUnresolved.length !== 0) ||
    (expectedControllerKind !== undefined &&
      (controllerUnresolved.length !== 1 ||
        controllerUnresolved[0]?.kind !== expectedControllerKind))
  )
    errors.push("controller has an orphan or multiple unresolved effects");
  const qualificationQueueStates = new Set<UnitState>([
    "candidate_committed",
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const integrationQueueStates = new Set<UnitState>([
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const expectedQualificationQueue = Object.values(state.units)
    .filter(
      (unit) =>
        qualificationQueueStates.has(unit.state) ||
        (state.qualificationOwnerUnitId === unit.id &&
          [
            "failure_intent",
            "timeout_intent",
            "park_intent",
            "cancel_intent",
          ].includes(unit.state)),
    )
    .map((unit) => unit.id)
    .sort();
  const expectedIntegrationQueue = Object.values(state.units)
    .filter((unit) => integrationQueueStates.has(unit.state))
    .map((unit) => unit.id)
    .sort();
  if (
    state.qualificationQueue.join("\u0000") !==
    expectedQualificationQueue.join("\u0000")
  )
    errors.push("qualification queue disagrees with unit state");
  if (
    state.integrationQueue.join("\u0000") !==
    expectedIntegrationQueue.join("\u0000")
  )
    errors.push("integration queue disagrees with unit state");
  const qualificationOwnerStates = new Set<UnitState>([
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const qualificationOwnerAllowedStates = new Set<UnitState>([
    ...qualificationOwnerStates,
    // A terminal act begun while qualification/review owns the unit retains
    // that owner until its exact observation is recorded.
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent",
  ]);
  if (
    state.qualificationOwnerUnitId !== undefined &&
    !qualificationOwnerAllowedStates.has(
      state.units[state.qualificationOwnerUnitId]?.state ?? "planned",
    )
  )
    errors.push("qualification owner is not qualifying");
  for (const unit of Object.values(state.units))
    if (
      qualificationOwnerStates.has(unit.state) &&
      state.qualificationOwnerUnitId !== unit.id
    )
      errors.push(`qualifying unit ${unit.id} lacks owner converse`);
  if (
    state.qualificationOwnerUnitId !== undefined &&
    state.qualificationQueue[0] !== state.qualificationOwnerUnitId
  )
    errors.push("qualification owner is not queue head");
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.units[state.integrationOwnerUnitId]?.state !== "integrate_intent"
  )
    errors.push("integration owner is not integrating");
  for (const unit of Object.values(state.units))
    if (
      unit.state === "integrate_intent" &&
      state.integrationOwnerUnitId !== unit.id
    )
      errors.push(
        `integrating unit ${unit.id} lacks integration owner converse`,
      );
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.integrationQueue[0] !== state.integrationOwnerUnitId
  )
    errors.push("integration owner is not queue head");
  const reviewerStates = new Set<UnitState>([
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
  ]);
  const reviewerOwnerStates = new Set<UnitState>([
    ...reviewerStates,
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent",
  ]);
  if (
    state.currentReviewerUnitId !== undefined &&
    !reviewerOwnerStates.has(
      state.units[state.currentReviewerUnitId]?.state ?? "planned",
    )
  )
    errors.push("current reviewer is not active");
  for (const unit of Object.values(state.units))
    if (
      reviewerStates.has(unit.state) &&
      state.currentReviewerUnitId !== unit.id
    )
      errors.push(`reviewer unit ${unit.id} lacks current reviewer converse`);
  if (
    state.currentReviewerUnitId !== undefined &&
    state.qualificationOwnerUnitId !== state.currentReviewerUnitId
  )
    errors.push("reviewer is not owned by qualification");
  if (
    state.state === "blocked" &&
    controllerUnresolved.every((entry) => entry.status !== "ambiguous") &&
    !Object.values(state.units).some((unit) => unit.state === "blocked")
  )
    errors.push("blocked aggregate lacks ambiguous durable evidence");
  if (state.state === "active" && state.controller.state !== "acquired")
    errors.push("active aggregate lacks controller ownership");
  if (state.state === "released" && state.controller.state !== "released")
    errors.push("released aggregate lacks controller release readback");
  if (state.controller.state === "released" && state.state !== "released")
    errors.push("released controller has non-released aggregate");
  return errors;
}
function illegal(unit: Unit, eventType: ProtocolEvent["type"]): Reduction {
  return reject(
    "illegal_transition",
    `${eventType} is not legal while ${unit.id} is ${unit.state}`,
  );
}
function reject(
  code: Extract<Reduction, { ok: false }>["code"],
  reason: string,
): Reduction {
  return { ok: false, code, reason };
}
function exhaustive(value: never): never {
  throw new Error(`Unhandled protocol event: ${JSON.stringify(value)}`);
}
