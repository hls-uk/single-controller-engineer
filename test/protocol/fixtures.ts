import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";

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
    controllerFencingToken: "fence-1",
    controller: { holder: "run-1", state: "acquired" },
    units: Object.fromEntries(units.map((item) => [item.id, item])),
    reservations: {},
    activeModifyingUnitIds: [],
    effectJournal: [],
    processedEventIds: [],
  };
}
export function event(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
  unitId = "unit-1",
): ProtocolEvent {
  return {
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    type,
    ...fields,
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
