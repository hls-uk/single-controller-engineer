import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";

export const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const HASH = "c".repeat(64);

export function unit(id: string, state: Unit["state"] = "planned"): Unit {
  return { id, revision: 0, state, baseOid: OID_A };
}

export function run(units: readonly Unit[] = [unit("unit-1")]): RepositoryRun {
  return {
    revision: 0,
    state: "active",
    storeIdentity: "store-1",
    repositoryIdentity: "repo-1",
    integrationBranch: "main",
    controllerFencingToken: "fence-1",
    units: Object.fromEntries(units.map((item) => [item.id, item])),
    activeModifyingUnitIds: [],
    effectJournal: [],
    processedEventIds: [],
  };
}

export function event<T extends ProtocolEvent["type"]>(
  state: RepositoryRun,
  type: T,
  fields: Omit<
    Extract<ProtocolEvent, { type: T }>,
    "eventId" | "expectedRevision" | "unitId" | "type"
  > = {} as never,
): Extract<ProtocolEvent, { type: T }> {
  return {
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId: "unit-1",
    type,
    ...fields,
  } as Extract<ProtocolEvent, { type: T }>;
}

export function transition(
  state: RepositoryRun,
  input: ProtocolEvent,
  reduce: (
    current: RepositoryRun,
    next: ProtocolEvent,
  ) => ReturnType<typeof import("../../src/protocol/reducer.js").reduce>,
): RepositoryRun {
  const result = reduce(state, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  return result.nextState;
}
