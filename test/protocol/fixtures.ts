import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";
import {
  deriveIdempotencyKey,
  deriveParamsHash,
  deriveRepairContextHash,
} from "../../src/protocol/reducer.js";

export const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const OID_C = "cccccccccccccccccccccccccccccccccccccccc";
export const HASH = "d".repeat(64);

export function unit(id: string, state: Unit["state"] = "planned"): Unit {
  return {
    id,
    ordinal: 0,
    revision: 0,
    state,
    baseOid: OID_A,
    reservationIds: [],
    repairCount: 0,
  };
}
export function run(units: readonly Unit[] = [unit("unit-1")]): RepositoryRun {
  return {
    revision: 0,
    state: "active",
    storeIdentity: "store-1",
    repositoryIdentity: "repo-1",
    integrationBranch: "main",
    authorityProfile: "integrate",
    completionBoundary: "remote-integration",
    integrationProfile: "remote-ff",
    gitObjectFormat: "sha1",
    controllerFencingToken: "fence-1",
    controller: {
      runId: "run-1",
      incarnationId: "incarnation-1",
      holder: "run-1/incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      promptHash: HASH,
      state: "acquired",
    },
    units: Object.fromEntries(
      units.map((item, ordinal) => [item.id, { ...item, ordinal }]),
    ),
    reservations: {},
    activeModifyingUnitIds: [],
    wave: {
      id: "wave-1",
      unitIds: units
        .map((item) => item.id)
        .sort()
        .slice(0, 3),
    },
    qualificationQueue: [],
    integrationQueue: [],
    effectJournal: [],
    processedEventIds: [],
    processedIdempotencyKeys: [],
    usedSessionCount: 0,
    sessionLineage: "",
    sessionLineageRoot: "0".repeat(64),
    closedUnitEvidence: "",
    closedUnitEvidenceCommitment: "0".repeat(64),
    journalCheckpoint: {
      revision: 0,
      compactedEffects: 0,
      compactedEvents: 0,
      compactedIdempotencyKeys: 0,
      commitment: "0".repeat(64),
    },
    journalCommitment: "0".repeat(64),
  };
}
export function event(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
  unitId = "unit-1",
): ProtocolEvent {
  const kinds: Partial<
    Record<ProtocolEvent["type"], Parameters<typeof deriveIdempotencyKey>[3]>
  > = {
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
  const kind = kinds[type];
  const effectUnitId = type.startsWith("controller_") ? null : unitId;
  const normalizedFields =
    type === "worker_collected" &&
    typeof fields.workerResult === "object" &&
    fields.workerResult !== null
      ? {
          ...fields,
          workerResult: {
            ...(fields.workerResult as Record<string, unknown>),
            suggestedFollowUps:
              (fields.workerResult as Record<string, unknown>)
                .suggestedFollowUps ?? [],
          },
        }
      : fields;
  return {
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    type,
    ...(type === "dispatch_intent"
      ? { requestedModel: "workhorse", promptHash: HASH }
      : {}),
    ...(type === "verification_intent" ? { commands: ["npm test"] } : {}),
    ...(type === "reviewer_dispatch_intent"
      ? { requestedModel: "frontier", promptHash: HASH }
      : {}),
    ...(type === "repair_intent"
      ? { requestedModel: "workhorse", promptHash: HASH }
      : {}),
    ...normalizedFields,
    ...(kind === undefined
      ? {}
      : {
          idempotencyKey: deriveIdempotencyKey(
            state,
            state.revision,
            effectUnitId,
            kind,
          ),
        }),
  } as ProtocolEvent;
}
export function transition(
  state: RepositoryRun,
  input: ProtocolEvent,
  reduce: (
    current: RepositoryRun,
    next: ProtocolEvent,
  ) => import("../../src/protocol/reducer.js").Reduction,
): RepositoryRun {
  const result = reduce(state, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  for (const effect of result.effects) {
    if (effect.paramsHash !== deriveParamsHash(effect.kind, effect.params))
      throw new Error(`effect ${effect.effectId} has an unbound params hash`);
    if (
      result.nextState.effectJournal.find(
        (entry) => entry.effectId === effect.effectId,
      )?.paramsHash !== effect.paramsHash
    )
      throw new Error(
        `journal ${effect.effectId} disagrees with effect params`,
      );
  }
  return result.nextState;
}

export function repairEvidence(
  state: RepositoryRun,
  unitId = "unit-1",
): Pick<
  Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"],
  "currentEvidenceHash" | "findingsContextHash"
> {
  const context = state.units[unitId]?.repairContext;
  if (context === undefined)
    throw new Error(`missing repair context for ${unitId}`);
  return {
    currentEvidenceHash: context.responseHash,
    findingsContextHash: deriveRepairContextHash(context),
  };
}
