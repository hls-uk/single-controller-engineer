import {
  SCHEMA_VERSION,
  type EffectJournalEntry,
  type EffectKind,
  type ProtocolEvent,
  ProtocolEventSchema,
  type RepositoryRun,
  RepositoryRunSchema,
  type RuntimeEffect,
  type Unit,
  type UnitState,
  validate,
} from "./schemas.js";

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
    event.type === "controller_acquire_intent" ||
    event.type === "controller_acquired" ||
    event.type === "controller_release_intent" ||
    event.type === "controller_released"
  )
    return reduceController(state, event);
  if (state.state === "blocked" || state.state === "released")
    return reject("illegal_transition", `aggregate is ${state.state}`);
  if (state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired",
    );
  const unit = state.units[event.unitId];
  if (unit === undefined) return reject("illegal_transition", "unknown unit");

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
      if (
        unit.state !== "worktree_observed" &&
        unit.state !== "repair_required"
      )
        return illegal(unit, event.type);
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(
        state,
        unit,
        "dispatch_intent",
        event,
        "dispatch",
      );
      break;
    case "dispatch_observed":
      if (unit.state !== "dispatch_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "dispatch"))
        return badObservation();
      result = observe(state, unit, "dispatched", event, workerSession(event));
      break;
    case "collect_intent":
      if (unit.state !== "dispatched") return illegal(unit, event.type);
      result = intent(state, unit, "collect_intent", event, "worker_collect");
      break;
    case "worker_collected":
      if (unit.state !== "collect_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worker_collect"))
        return badObservation();
      if (event.workerResult.status === "failed")
        return reject(
          "illegal_transition",
          "worker failure must use the failure intent/observation pair",
        );
      result = observe(
        state,
        unit,
        "collected",
        event,
        {},
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
      result = observe(state, unit, "candidate_committed", event, {
        candidateHead: event.headOid,
        candidateTree: event.treeOid,
      });
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
      result = intent(state, unit, "verification_intent", event, "verify", {
        qualificationOwnerUnitId: unit.id,
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
        { currentReviewerUnitId: unit.id },
      );
      break;
    case "reviewer_observed":
      if (
        unit.state !== "reviewer_dispatch_intent" ||
        state.currentReviewerUnitId !== unit.id
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
        result = observe(
          state,
          unit,
          "repair_required",
          event,
          {},
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
          { currentReviewerUnitId: null },
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
        unit.candidateHead !== event.remoteHeadOid
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "publish"))
        return badObservation();
      result = observe(state, unit, "published", event);
      break;
    case "integrate_intent":
      if (
        unit.state !== "published" ||
        !hasCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id ||
        (state.integrationOwnerUnitId !== undefined &&
          state.integrationOwnerUnitId !== unit.id)
      )
        return illegal(unit, event.type);
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
        { qualificationOwnerUnitId: null, integrationOwnerUnitId: null },
      );
      break;
    case "reservation_release_intent":
      if (
        !["landed", "cancelled", "parked", "failed", "timed_out"].includes(
          unit.state,
        )
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
      if (
        event.judgment !== undefined &&
        !validRepairJudgment(unit, event.judgment, state.revision)
      )
        return reject(
          "illegal_transition",
          "repair judgment is not bound to this unit and revision",
        );
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(state, unit, "repair_intent", event, "repair");
      break;
    case "repair_observed":
      if (unit.state !== "repair_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "repair"))
        return badObservation();
      result = observe(state, unit, "dispatched", event, {
        ...workerSession(event),
        repairCount: unit.repairCount + 1,
      });
      break;
    case "failure_intent":
      if (
        ["closed", "reservation_release_intent", "landed"].includes(unit.state)
      )
        return illegal(unit, event.type);
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
        {},
        clearUnitOwners(state, unit.id),
      );
      break;
    case "timeout_intent":
      if (
        ["closed", "reservation_release_intent", "landed"].includes(unit.state)
      )
        return illegal(unit, event.type);
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
        {},
        clearUnitOwners(state, unit.id),
      );
      break;
    case "park_intent":
      if (
        ["closed", "reservation_release_intent", "landed"].includes(unit.state)
      )
        return illegal(unit, event.type);
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
      if (
        ["closed", "reservation_release_intent", "landed"].includes(unit.state)
      )
        return illegal(unit, event.type);
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
type IntentEvent = Extract<
  ProtocolEvent,
  { idempotencyKey: string; paramsHash: string }
>;
type ObservedEvent = Extract<
  ProtocolEvent,
  { effectId: string; effectKind: EffectKind; observationHash: string }
>;

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
        "unacquired",
      );
      break;
    case "controller_acquired":
      if (
        state.state !== "initializing" ||
        state.controller.state !== "unacquired" ||
        !matchesIntended(state, event, null, "controller_acquire")
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
        state.state !== "release_intent" ||
        state.controller.state !== "release_intent" ||
        !matchesIntended(state, event, null, "controller_release")
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
): Step {
  return intent(state, unit, next, event, kind, {
    activeModifyingUnitIds: [...state.activeModifyingUnitIds, unit.id],
  });
}
function terminalIntent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">,
): Step {
  const owners = clearUnitOwners(state, unit.id);
  return intent(state, unit, next, event, kind, {
    ...owners,
    // A modifying worker holds its slot through the terminal observation.
    activeModifyingUnitIds: state.activeModifyingUnitIds,
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
  const effectId = `${event.eventId}:${kind}`;
  const entry: EffectJournalEntry = {
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    kind,
    paramsHash: event.paramsHash,
    status: "intended",
    schemaVersion: SCHEMA_VERSION,
  };
  const effect: ProtocolEffect = {
    kind,
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    paramsHash: event.paramsHash,
    schemaVersion: SCHEMA_VERSION,
  } as ProtocolEffect;
  return {
    state: { ...state, effectJournal: [...state.effectJournal, entry] },
    effects: [effect],
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
  unit: Unit,
  judgment: NonNullable<
    Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"]
  >,
  revision: number,
): boolean {
  return (
    judgment.role !== "reviewer" &&
    judgment.unitId === unit.id &&
    judgment.aggregateRevision === revision &&
    judgment.factOid === unit.candidateHead &&
    (judgment.decision === "repair" ||
      judgment.decision === "park" ||
      judgment.decision === "cancel")
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
  const nextState = {
    ...state,
    revision: state.revision + 1,
    processedEventIds: [...state.processedEventIds, event.eventId],
  };
  const schema = validate<RepositoryRun>(RepositoryRunSchema, nextState);
  if (!schema.ok) return reject("invariant", schema.errors.join("; "));
  const errors = runInvariantErrors(nextState);
  return errors.length
    ? reject("invariant", errors.join("; "))
    : { ok: true, nextState, effects };
}

export function runInvariantErrors(state: RepositoryRun): readonly string[] {
  const errors: string[] = [],
    effectIds = new Set<string>(),
    idempotency = new Set<string>();
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
  ]);
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
    const isActive = state.activeModifyingUnitIds.includes(id);
    const allowedActive =
      optionallyActiveStates.has(unit.state) ||
      (unit.state === "blocked" &&
        state.effectJournal.some(
          (effect) =>
            effect.unitId === id &&
            effect.status === "ambiguous" &&
            ["dispatch", "repair", "worker_collect"].includes(effect.kind),
        ));
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
    if (
      reservation.state === "reserved" &&
      reservation.acquireEffectId === undefined
    )
      errors.push(`reserved ${id} has no acquisition readback`);
    if (
      reservation.state === "released" &&
      reservation.releaseEffectId === undefined
    )
      errors.push(`released ${id} has no release readback`);
  }
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
    if (
      (effect.status === "observed" || effect.status === "ambiguous") &&
      effect.observationHash === undefined
    )
      errors.push(
        `${effect.status} effect ${effect.effectId} has no observation`,
      );
  }
  const qualificationStates = new Set<UnitState>([
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
  if (
    state.qualificationOwnerUnitId !== undefined &&
    !qualificationStates.has(
      state.units[state.qualificationOwnerUnitId]?.state ?? "planned",
    )
  )
    errors.push("qualification owner is not qualifying");
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.units[state.integrationOwnerUnitId]?.state !== "integrate_intent"
  )
    errors.push("integration owner is not integrating");
  const reviewerStates = new Set<UnitState>([
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
  ]);
  if (
    state.currentReviewerUnitId !== undefined &&
    !reviewerStates.has(
      state.units[state.currentReviewerUnitId]?.state ?? "planned",
    )
  )
    errors.push("current reviewer is not active");
  if (
    state.currentReviewerUnitId !== undefined &&
    state.qualificationOwnerUnitId !== state.currentReviewerUnitId
  )
    errors.push("reviewer is not owned by qualification");
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
