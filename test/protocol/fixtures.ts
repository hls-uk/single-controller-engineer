import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";
import { deriveIdempotencyKey } from "../../src/protocol/reducer.js";

export const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const OID_C = "cccccccccccccccccccccccccccccccccccccccc";
export const HASH = "d".repeat(64);

export function unit(id: string, state: Unit["state"] = "planned"): Unit {
  return {
    id,
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
    integrationProfile: "local-ff",
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
    units: Object.fromEntries(units.map((item) => [item.id, item])),
    reservations: {},
    activeModifyingUnitIds: [],
    wave: { id: "wave-1", unitIds: units.map((item) => item.id).sort() },
    qualificationQueue: [],
    integrationQueue: [],
    effectJournal: [],
    processedEventIds: [],
    processedIdempotencyKeys: [],
    journalCheckpoint: {
      revision: 0,
      compactedEffects: 0,
      compactedEvents: 0,
      compactedIdempotencyKeys: 0,
    },
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
  return {
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    type,
    ...fields,
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
  return result.nextState;
}
