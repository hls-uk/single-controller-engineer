import {
  type EffectJournalEntry,
  type ProtocolEvent,
  type RepositoryRun,
  validate,
  ProtocolEventSchema,
  RepositoryRunSchema,
  type Unit,
  type UnitState,
} from "./schemas.js";

export type ProtocolEffect =
  | {
      readonly kind: "dispatch";
      readonly effectId: string;
      readonly unitId: string;
      readonly idempotencyKey: string;
      readonly paramsHash: string;
    }
  | {
      readonly kind: "verify";
      readonly effectId: string;
      readonly unitId: string;
      readonly idempotencyKey: string;
      readonly paramsHash: string;
    }
  | {
      readonly kind: "review_dispatch";
      readonly effectId: string;
      readonly unitId: string;
      readonly idempotencyKey: string;
      readonly paramsHash: string;
    }
  | {
      readonly kind: "publish";
      readonly effectId: string;
      readonly unitId: string;
      readonly idempotencyKey: string;
      readonly paramsHash: string;
    }
  | {
      readonly kind: "integrate";
      readonly effectId: string;
      readonly unitId: string;
      readonly idempotencyKey: string;
      readonly paramsHash: string;
    };

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

/** Pure CAS reducer. Adapters persist `nextState` before executing returned effects. */
export function reduce(
  stateInput: RepositoryRun,
  eventInput: ProtocolEvent,
): Reduction {
  const stateCheck = validate<RepositoryRun>(RepositoryRunSchema, stateInput);
  if (!stateCheck.ok || stateCheck.value === undefined)
    return reject("invalid_state", stateCheck.errors.join("; "));
  const eventCheck = validate<ProtocolEvent>(ProtocolEventSchema, eventInput);
  if (!eventCheck.ok || eventCheck.value === undefined)
    return reject("invalid_event", eventCheck.errors.join("; "));
  const state = stateCheck.value;
  const event = eventCheck.value;
  const invariantErrors = runInvariantErrors(state);
  if (invariantErrors.length > 0)
    return reject("invariant", invariantErrors.join("; "));
  if (event.expectedRevision !== state.revision)
    return reject(
      "stale_revision",
      "expected aggregate revision does not match",
    );
  if (state.processedEventIds.includes(event.eventId))
    return reject("duplicate_event", "event id has already been applied");
  if (state.state === "blocked" || state.state === "released")
    return reject("illegal_transition", `aggregate is ${state.state}`);
  const unit = state.units[event.unitId];
  if (unit === undefined) return reject("illegal_transition", "unknown unit");

  let result:
    { state: RepositoryRun; effects: readonly ProtocolEffect[] } | undefined;
  switch (event.type) {
    case "dispatch_intent":
      if (unit.state !== "planned") return illegal(unit, event.type);
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      if (state.effectJournal.length >= 256)
        return reject("invariant", "effect journal is full");
      result = intent(state, unit, "dispatch_intent", event, "dispatch", {
        activeModifyingUnitIds: [...state.activeModifyingUnitIds, unit.id],
      });
      break;
    case "dispatch_observed":
      if (unit.state !== "dispatch_intent") return illegal(unit, event.type);
      if (!hasIntendedEffect(state, event.effectId, unit.id))
        return reject(
          "illegal_transition",
          "dispatch effect is not intended for this unit",
        );
      result = observed(state, unit, "dispatched", event, {
        workerSessionId: event.sessionId,
      });
      break;
    case "candidate_observed":
      if (unit.state !== "dispatched") return illegal(unit, event.type);
      result = plain(state, unit, "candidate_committed", {
        candidateHead: event.headOid,
      });
      break;
    case "verification_intent":
      if (unit.state !== "candidate_committed")
        return illegal(unit, event.type);
      if (state.effectJournal.length >= 256)
        return reject("invariant", "effect journal is full");
      result = intent(state, unit, "verification_intent", event, "verify");
      break;
    case "verification_observed":
      if (
        unit.state !== "verification_intent" ||
        unit.candidateHead === undefined
      )
        return illegal(unit, event.type);
      if (
        state.qualificationOwnerUnitId !== undefined &&
        state.qualificationOwnerUnitId !== unit.id
      )
        return reject(
          "invariant",
          "final qualification is owned by another unit",
        );
      if (!hasIntendedEffect(state, event.effectId, unit.id))
        return reject(
          "illegal_transition",
          "verification effect is not intended",
        );
      result = observed(
        state,
        unit,
        "qualified",
        event,
        { baseOid: event.baseOid },
        { qualificationOwnerUnitId: unit.id },
      );
      break;
    case "reviewer_dispatch_intent":
      if (
        unit.state !== "qualified" ||
        state.qualificationOwnerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (state.effectJournal.length >= 256)
        return reject("invariant", "effect journal is full");
      result = intent(
        state,
        unit,
        "reviewer_dispatch_intent",
        event,
        "review_dispatch",
      );
      break;
    case "reviewer_observed":
      if (unit.state !== "reviewer_dispatch_intent")
        return illegal(unit, event.type);
      if (!hasIntendedEffect(state, event.effectId, unit.id))
        return reject(
          "illegal_transition",
          "review dispatch effect is not intended",
        );
      result = observed(state, unit, "reviewer_dispatched", event, {
        reviewerSessionId: event.sessionId,
      });
      break;
    case "review_collect_intent":
      if (unit.state !== "reviewer_dispatched")
        return illegal(unit, event.type);
      result = plain(state, unit, "review_collect_intent");
      break;
    case "review_approved":
      if (
        unit.state !== "review_collect_intent" ||
        unit.candidateHead !== event.headOid ||
        unit.baseOid !== event.baseOid
      )
        return illegal(unit, event.type);
      result = plain(state, unit, "approved", {
        reviewBaseOid: event.baseOid,
        reviewHeadOid: event.headOid,
        approvalHash: event.judgmentHash,
      });
      break;
    case "publish_intent":
      if (
        !isCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (state.effectJournal.length >= 256)
        return reject("invariant", "effect journal is full");
      result = intent(state, unit, "publish_intent", event, "publish");
      break;
    case "publish_observed":
      if (
        unit.state !== "publish_intent" ||
        unit.candidateHead !== event.remoteHeadOid
      )
        return illegal(unit, event.type);
      if (!hasIntendedEffect(state, event.effectId, unit.id))
        return reject(
          "illegal_transition",
          "publish effect is not intended for this unit",
        );
      result = observed(state, unit, "published", event);
      break;
    case "integrate_intent":
      if (
        unit.state !== "published" ||
        !isCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (
        state.integrationOwnerUnitId !== undefined &&
        state.integrationOwnerUnitId !== unit.id
      )
        return reject("invariant", "integration is owned by another unit");
      if (state.effectJournal.length >= 256)
        return reject("invariant", "effect journal is full");
      result = intent(state, unit, "integrate_intent", event, "integrate", {
        integrationOwnerUnitId: unit.id,
      });
      break;
    case "integrate_observed":
      if (
        unit.state !== "integrate_intent" ||
        state.integrationOwnerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (!hasIntendedEffect(state, event.effectId, unit.id))
        return reject(
          "illegal_transition",
          "integration effect is not intended",
        );
      result = observed(
        state,
        unit,
        "landed",
        event,
        {},
        {
          activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
            (id) => id !== unit.id,
          ),
          qualificationOwnerUnitId: null,
          integrationOwnerUnitId: null,
        },
      );
      break;
    case "effect_ambiguous": {
      const journal = state.effectJournal.map((entry) => {
        if (entry.effectId !== event.effectId) return entry;
        return event.observationHash === undefined
          ? { ...entry, status: "ambiguous" as const }
          : {
              ...entry,
              status: "ambiguous" as const,
              observationHash: event.observationHash,
            };
      });
      if (!journal.some((entry) => entry.effectId === event.effectId))
        return reject("illegal_transition", "unknown effect");
      result = {
        state: {
          ...state,
          state: "blocked",
          effectJournal: journal,
          units: withUnit(state, {
            ...unit,
            state: "blocked",
            revision: unit.revision + 1,
          }),
        },
        effects: [],
      };
      break;
    }
    case "block":
      result = {
        state: {
          ...state,
          state: "blocked",
          units: withUnit(state, {
            ...unit,
            state: "blocked",
            revision: unit.revision + 1,
          }),
        },
        effects: [],
      };
      break;
    default:
      return exhaustive(event);
  }
  if (result === undefined)
    return reject("illegal_transition", "event was not handled");
  return commit(result.state, event, result.effects);
}

function intent(
  state: RepositoryRun,
  unit: Unit,
  nextUnitState: UnitState,
  event: Extract<ProtocolEvent, { idempotencyKey: string; paramsHash: string }>,
  kind: ProtocolEffect["kind"],
  changes: Partial<RepositoryRun> = {},
): { state: RepositoryRun; effects: readonly ProtocolEffect[] } {
  const effectId = `${event.eventId}:${kind}`;
  const entry: EffectJournalEntry = {
    effectId,
    unitId: unit.id,
    idempotencyKey: event.idempotencyKey,
    kind,
    paramsHash: event.paramsHash,
    status: "intended",
    schemaVersion: 1,
  };
  return {
    state: {
      ...state,
      ...changes,
      units: withUnit(state, {
        ...unit,
        state: nextUnitState,
        revision: unit.revision + 1,
      }),
      effectJournal: [...state.effectJournal, entry],
    },
    effects: [
      {
        kind,
        effectId,
        unitId: unit.id,
        idempotencyKey: event.idempotencyKey,
        paramsHash: event.paramsHash,
      },
    ],
  };
}

function observed(
  state: RepositoryRun,
  unit: Unit,
  nextUnitState: UnitState,
  event: { effectId: string; observationHash: string },
  unitChanges: Partial<Unit> = {},
  aggregateChanges: Omit<
    Partial<RepositoryRun>,
    "qualificationOwnerUnitId" | "integrationOwnerUnitId"
  > & {
    qualificationOwnerUnitId?: string | null;
    integrationOwnerUnitId?: string | null;
  } = {},
): { state: RepositoryRun; effects: readonly ProtocolEffect[] } {
  const journal = state.effectJournal.map((entry) =>
    entry.effectId === event.effectId
      ? {
          ...entry,
          status: "observed" as const,
          observationHash: event.observationHash,
        }
      : entry,
  );
  const { qualificationOwnerUnitId, integrationOwnerUnitId, ...rest } =
    aggregateChanges;
  const next: RepositoryRun = {
    ...state,
    ...rest,
    effectJournal: journal,
    units: withUnit(state, {
      ...unit,
      ...unitChanges,
      state: nextUnitState,
      revision: unit.revision + 1,
    }),
  };
  if (qualificationOwnerUnitId === null) delete next.qualificationOwnerUnitId;
  else if (qualificationOwnerUnitId !== undefined)
    next.qualificationOwnerUnitId = qualificationOwnerUnitId;
  if (integrationOwnerUnitId === null) delete next.integrationOwnerUnitId;
  else if (integrationOwnerUnitId !== undefined)
    next.integrationOwnerUnitId = integrationOwnerUnitId;
  return { state: next, effects: [] };
}

function plain(
  state: RepositoryRun,
  unit: Unit,
  nextUnitState: UnitState,
  changes: Partial<Unit> = {},
): { state: RepositoryRun; effects: readonly ProtocolEffect[] } {
  return {
    state: {
      ...state,
      units: withUnit(state, {
        ...unit,
        ...changes,
        state: nextUnitState,
        revision: unit.revision + 1,
      }),
    },
    effects: [],
  };
}

function withUnit(state: RepositoryRun, unit: Unit): RepositoryRun["units"] {
  return { ...state.units, [unit.id]: unit };
}

function isCurrentApproval(unit: Unit): boolean {
  return (
    unit.state === "approved" &&
    unit.reviewBaseOid === unit.baseOid &&
    unit.reviewHeadOid === unit.candidateHead &&
    unit.approvalHash !== undefined
  );
}

function commit(
  state: RepositoryRun,
  event: ProtocolEvent,
  effects: readonly ProtocolEffect[],
): Reduction {
  const nextState: RepositoryRun = {
    ...state,
    revision: state.revision + 1,
    processedEventIds: [...state.processedEventIds, event.eventId],
  };
  const schemaCheck = validate<RepositoryRun>(RepositoryRunSchema, nextState);
  if (!schemaCheck.ok)
    return reject("invariant", schemaCheck.errors.join("; "));
  const invariantErrors = runInvariantErrors(nextState);
  if (invariantErrors.length > 0)
    return reject("invariant", invariantErrors.join("; "));
  return { ok: true, nextState, effects };
}

export function runInvariantErrors(state: RepositoryRun): readonly string[] {
  const errors: string[] = [];
  const seenEffects = new Set<string>();
  for (const [id, unit] of Object.entries(state.units)) {
    if (id !== unit.id)
      errors.push(`unit map key ${id} does not match unit id ${unit.id}`);
  }
  for (const effect of state.effectJournal) {
    if (seenEffects.has(effect.effectId))
      errors.push(`duplicate effect id ${effect.effectId}`);
    seenEffects.add(effect.effectId);
  }
  for (const id of state.activeModifyingUnitIds) {
    if (state.units[id] === undefined)
      errors.push(`active modifying unit ${id} is unknown`);
  }
  if (
    state.qualificationOwnerUnitId !== undefined &&
    state.units[state.qualificationOwnerUnitId] === undefined
  )
    errors.push("qualification owner is unknown");
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.units[state.integrationOwnerUnitId]?.state !== "integrate_intent"
  )
    errors.push("integration owner is not integrating");
  return errors;
}

function hasIntendedEffect(
  state: RepositoryRun,
  effectId: string,
  unitId: string,
): boolean {
  return state.effectJournal.some(
    (entry) =>
      entry.effectId === effectId &&
      entry.unitId === unitId &&
      entry.status === "intended",
  );
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
