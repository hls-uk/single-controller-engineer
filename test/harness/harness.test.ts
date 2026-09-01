import assert from "node:assert/strict";
import test from "node:test";

import {
  createHarnessRecoveryEffectAdapter,
  createPacket,
  harnessSupportCommitment,
  HarnessToolRequestSchema,
  HARNESS_VERSION,
  parseHarnessSupport,
  type HarnessCapabilities,
  type HarnessPort,
  type HarnessSession,
  type HarnessSupport,
  type HarnessToolRequest,
} from "../../src/harness/index.js";
import { createRecoveryRunner } from "../../src/commands/recovery.js";
import {
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
} from "../../src/fencing/index.js";
import { legalActions } from "../../src/protocol/actions.js";
import { createProductionRecoveryEffectAdapter } from "../../src/commands/production-recovery.js";
import {
  deriveCandidateDiffHash,
  reduce,
  runInvariantErrors,
  type ProtocolEffect,
} from "../../src/protocol/reducer.js";
import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";
import {
  ProtocolEventSchema,
  RepositoryRunSchema,
  validate,
} from "../../src/protocol/schemas.js";
import { HASH, event, run, transition, unit } from "../protocol/fixtures.js";

const support: HarnessSupport = {
  capabilities: {
    adapterVersion: HARNESS_VERSION,
    family: "codex",
    harnessVersion: HARNESS_VERSION,
    operations: {
      cancel: true,
      collect: true,
      controllerIdentity: true,
      inspect: true,
      launch: true,
      lookupByClientKey: true,
      poll: true,
      returnedModelIdentity: true,
    },
    schema: "sce.harness-capabilities",
    version: HARNESS_VERSION,
  },
  controller: {
    acceptedReturnedModels: ["frontier-1"],
    requestedModel: "frontier",
  },
  frontier: {
    acceptedReturnedModels: ["frontier-1"],
    requestedModel: "frontier",
  },
  schema: "sce.harness-support",
  version: HARNESS_VERSION,
  workhorse: {
    acceptedReturnedModels: ["workhorse-1"],
    requestedModel: "workhorse",
  },
};

function reduceState(
  state: RepositoryRun,
  input: ProtocolEvent,
): RepositoryRun {
  return transition(state, input, reduce);
}
function dispatchedIntent(): {
  before: RepositoryRun;
  effect: ProtocolEffect;
  state: RepositoryRun;
} {
  const committed = harnessSupportCommitment(support);
  assert.equal(committed.ok, true);
  let state: RepositoryRun = {
    ...run(),
    harness: {
      adapterVersion: 1,
      family: "codex",
      harnessVersion: 1,
      supportCommitment: committed.ok ? committed.value : HASH,
    },
  };
  state = reduceState(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "path", resource: "src/unit" }],
    }),
  );
  state = reduceState(
    state,
    event(state, "reservation_observed", {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "reservation_acquire",
      observationHash: HASH,
    }),
  );
  state = reduceState(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
  );
  state = reduceState(
    state,
    event(state, "branch_observed", {
      branchRef: "sce/unit-1",
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "branch_create",
      observationHash: HASH,
    }),
  );
  state = reduceState(
    state,
    event(state, "worktree_intent", { worktreePath: "/tmp/unit-1" }),
  );
  state = reduceState(
    state,
    event(state, "worktree_observed", {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "worktree_create",
      observationHash: HASH,
      worktreePath: "/tmp/unit-1",
    }),
  );
  const intent = reduce(state, event(state, "dispatch_intent"));
  assert.equal(intent.ok, true);
  if (!intent.ok) throw new Error("dispatch intent refused");
  return { before: state, effect: intent.effects[0]!, state: intent.nextState };
}
function session(effect: ProtocolEffect): HarnessSession {
  const params = effect.params as Extract<
    ProtocolEffect,
    { kind: "dispatch" }
  >["params"];
  return {
    clientKey: effect.idempotencyKey,
    fresh: true,
    harnessFamily: "codex",
    harnessVersion: HARNESS_VERSION,
    promptHash: params.promptHash,
    readOnly: false,
    requestedModel: params.requestedModel,
    returnedModel: "workhorse-1",
    role: "worker",
    sessionId: "worker-session-1",
    worktreePath: params.worktreePath,
  };
}
function packetBinding(input: unknown) {
  const created = createPacket(input);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("packet fixture is invalid");
  return {
    hash: created.hash,
    payload: created.payload,
    schema: created.schema,
    version: created.version,
  };
}
function port(overrides: Partial<HarnessPort> = {}): HarnessPort {
  return {
    capabilities: async () => support.capabilities,
    cancel: async () => ({}),
    collect: async () => ({}),
    controllerIdentity: async () => ({
      harnessFamily: "codex",
      harnessVersion: HARNESS_VERSION,
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      sessionId: "incarnation-1",
    }),
    inspect: async () => undefined,
    launch: async () => ({}),
    lookupByClientKey: async () => undefined,
    poll: async () => undefined,
    ...overrides,
  };
}

test("strict support rejects workhorse/frontier identity aliasing and packets are total", () => {
  assert.equal(parseHarnessSupport(support).ok, true);
  const aliases = [
    {
      name: "workhorse requested to frontier requested",
      support: {
        ...support,
        workhorse: { ...support.workhorse, requestedModel: "frontier" },
      },
    },
    {
      name: "workhorse requested to controller returned",
      support: {
        ...support,
        workhorse: { ...support.workhorse, requestedModel: "frontier-1" },
      },
    },
    {
      name: "workhorse returned to frontier requested",
      support: {
        ...support,
        workhorse: {
          ...support.workhorse,
          acceptedReturnedModels: ["frontier"],
        },
      },
    },
    {
      name: "workhorse returned to controller returned",
      support: {
        ...support,
        workhorse: {
          ...support.workhorse,
          acceptedReturnedModels: ["frontier-1"],
        },
      },
    },
  ] as const;
  for (const alias of aliases) {
    assert.equal(parseHarnessSupport(alias.support).ok, false, alias.name);
  }
  const packet = {
    acceptance: ["b", "a"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src/b", "src/a"],
    role: "worker" as const,
    unitId: "unit-1",
  };
  assert.deepEqual(
    createPacket(packet),
    createPacket({ ...packet, acceptance: ["a", "b"] }),
  );
  assert.deepEqual(createPacket({ role: "worker" }), {
    ok: false,
    reason: "invalid harness packet",
  });
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("hostile input");
      },
    },
  );
  assert.equal(parseHarnessSupport(hostile).ok, false);
  assert.deepEqual(createPacket(hostile), {
    ok: false,
    reason: "packet cannot be canonicalized",
  });
});

test("legacy v1 projections hydrate without a harness and configure once before session work", () => {
  const { harness: _legacyHarness, ...legacy } = run();
  assert.equal(validate(RepositoryRunSchema, legacy).ok, true);
  const committed = harnessSupportCommitment(support);
  assert.equal(committed.ok, true);
  const configured = reduce(legacy, {
    configuration: {
      adapterVersion: HARNESS_VERSION,
      family: "codex",
      harnessVersion: HARNESS_VERSION,
      supportCommitment: committed.ok ? committed.value : HASH,
    },
    eventId: "configure-harness-1",
    expectedRevision: legacy.revision,
    type: "harness_configured",
  });
  assert.equal(configured.ok, true);
  if (!configured.ok) return;
  assert.equal(configured.nextState.harness?.family, "codex");
  assert.equal(
    reduce(configured.nextState, {
      configuration: configured.nextState.harness!,
      eventId: "configure-harness-2",
      expectedRevision: configured.nextState.revision,
      type: "harness_configured",
    }).ok,
    false,
  );
  const { before } = dispatchedIntent();
  const { harness: _unconfigured, ...readyLegacy } = before;
  assert.equal(
    reduce(readyLegacy, event(readyLegacy, "dispatch_intent")).ok,
    false,
  );
  const enabled = reduce(readyLegacy, {
    configuration: before.harness!,
    eventId: "configure-ready-harness",
    expectedRevision: readyLegacy.revision,
    type: "harness_configured",
  });
  assert.equal(enabled.ok, true);
  if (!enabled.ok) return;
  assert.equal(
    reduce(enabled.nextState, event(enabled.nextState, "dispatch_intent")).ok,
    true,
  );
});

test("recovery refuses a hydrated packet missing committed task metadata before lookup", async () => {
  const { state } = dispatchedIntent();
  const invalidUnit = { ...state.units["unit-1"]! };
  delete invalidUnit.taskMetadata;
  const invalid = {
    ...state,
    units: { ...state.units, "unit-1": invalidUnit },
  };
  assert.equal(validate(RepositoryRunSchema, invalid).ok, true);
  assert.ok(
    runInvariantErrors(invalid).some((error) =>
      error.includes("worker packet unit-1 launch packet lacks committed"),
    ),
  );
  let root = makeRootProjection(invalid);
  let children = [makeChildProjection(root, "unit-1")!];
  let lookupCalls = 0;
  const store = {
    async compareAndSet(batch: MutationBatch) {
      root = batch.next.root;
      children = [...batch.next.children];
      return {
        affectedRowCount: batch.changedRows.length + 1,
        checkpoint: batch.checkpoint,
        children,
        root,
        status: "applied" as const,
      };
    },
    async load() {
      return { status: "observed" as const, value: { children, root } };
    },
    async persistControllerAcquireIntent(batch: MutationBatch) {
      return await this.compareAndSet(batch);
    },
  };
  const runner = createRecoveryRunner({
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: { release: async () => ({ status: "released" as const }) },
    }),
    adapter: {
      async execute() {
        lookupCalls += 1;
        return { status: "ambiguous" as const };
      },
      async reconcile() {
        lookupCalls += 1;
        return { status: "ambiguous" as const };
      },
    },
    nonce: "invalid-hydrated-packet",
    preOwnership: store,
    proveTopology: async () => ({
      commonDir: "/repo/.git",
      holder: invalid.controller.holder,
      scope: {
        beadsStoreIdentity: invalid.storeIdentity,
        gitRepositoryIdentity: invalid.repositoryIdentity,
        integrationBranch: invalid.integrationBranch,
      },
    }),
    store,
  });
  assert.deepEqual(await runner(), { status: "corrupt" });
  assert.equal(lookupCalls, 0);
});

test("launch uses only the persisted effect and binds trusted acknowledgement fields", async () => {
  const { effect, state } = dispatchedIntent();
  let seenClientKey: string | undefined;
  let seenPacket: string | undefined;
  const adapter = createHarnessRecoveryEffectAdapter(
    support,
    port({
      launch: async (request) => {
        seenClientKey = request.clientKey;
        seenPacket = request.packet.payload;
        return session(effect);
      },
      inspect: async () => session(effect),
    }),
  );
  const observed = await adapter.execute(effect, state);
  assert.equal(seenClientKey, effect.idempotencyKey);
  assert.equal(
    seenPacket,
    (effect.params as Extract<ProtocolEffect, { kind: "dispatch" }>["params"])
      .packet.payload,
  );
  assert.equal(observed.status, "observed");
  if (observed.status !== "observed") return;
  assert.equal(observed.observation.type, "dispatch_observed");
  const falseAck = await createHarnessRecoveryEffectAdapter(
    support,
    port({
      launch: async () => ({ ...session(effect), worktreePath: "/tmp/other" }),
    }),
  ).execute(effect, state);
  assert.deepEqual(falseAck, { status: "ambiguous" });
  let untrustedLaunches = 0;
  const untrusted = await createHarnessRecoveryEffectAdapter(
    support,
    port({
      controllerIdentity: async () => ({
        harnessFamily: "codex",
        harnessVersion: 1,
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        sessionId: "other-controller",
      }),
      launch: async () => {
        untrustedLaunches += 1;
        return session(effect);
      },
    }),
  ).execute(effect, state);
  assert.deepEqual(untrusted, { status: "ambiguous" });
  assert.equal(untrustedLaunches, 0);
  assert.deepEqual(
    await adapter.execute(effect, {
      ...state,
      harness: {
        ...state.harness!,
        family: "other",
      },
    }),
    { status: "ambiguous" },
  );
});

test("manual host packets are deterministic and only narrow acknowledgements advance", async () => {
  const { effect, state } = dispatchedIntent();
  const adapter = createHarnessRecoveryEffectAdapter(support);
  const first = await adapter.execute(effect, state);
  const second = await adapter.execute(effect, state);
  assert.equal(first.status, "tool_request");
  assert.deepEqual(first, second);
  if (first.status !== "tool_request") return;
  const packetRequest = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    first.toolRequest,
  );
  assert.equal(packetRequest.ok, true);
  if (!packetRequest.ok || packetRequest.value === undefined) return;
  assert.equal(packetRequest.value.operation, "launch");
  if (packetRequest.value.operation !== "launch") return;
  assert.equal(
    packetRequest.value.request.packet.hash,
    (effect.params as Extract<ProtocolEffect, { kind: "dispatch" }>["params"])
      .packet.hash,
  );
  const acknowledged = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch",
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.equal(acknowledged?.status, "tool_request");
  if (acknowledged?.status !== "tool_request") return;
  const recoveryRequest = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    acknowledged.toolRequest,
  );
  assert.equal(recoveryRequest.ok, true);
  if (!recoveryRequest.ok || recoveryRequest.value === undefined) return;
  assert.equal(recoveryRequest.value.operation, "lookup_inspect");
  if (recoveryRequest.value.operation !== "lookup_inspect") return;
  assert.equal(recoveryRequest.value.request.clientKey, effect.idempotencyKey);
  const inspected = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: session(effect).sessionId,
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.equal(inspected?.status, "observed");
  const invented = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: "invented-session",
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.deepEqual(invented, { status: "ambiguous" });
  const forgedSession = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: session(effect).sessionId,
      schema: "sce.harness-tool-acknowledgement",
      session: { ...session(effect), clientKey: "invented-client" },
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.deepEqual(forgedSession, { status: "ambiguous" });
  const forgedWrapper = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      effectKind: "dispatch",
      eventId: "forged-event",
      expectedRevision: state.revision,
      kind: "launch",
      observationHash: HASH,
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      type: "dispatch_observed",
      unitId: "unit-1",
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.deepEqual(forgedWrapper, { status: "ambiguous" });
  const unsupported = createHarnessRecoveryEffectAdapter({
    ...support,
    capabilities: {
      ...support.capabilities,
      operations: { ...support.capabilities.operations, poll: false },
    },
  });
  assert.equal(unsupported.canExecute?.(effect), false);
  assert.equal(unsupported.canReconcile?.(effect), false);
  for (const missing of ["collect", "cancel"] as const) {
    const partial = {
      ...support,
      capabilities: {
        ...support.capabilities,
        operations: { ...support.capabilities.operations, [missing]: false },
      },
    };
    assert.equal(parseHarnessSupport(partial).ok, false);
    const refused = createHarnessRecoveryEffectAdapter(partial);
    assert.equal(refused.canExecute?.(effect), false);
    assert.equal(refused.canReconcile?.(effect), false);
  }
  // A missing trust operation is classified instead: the profile is admitted,
  // the adapter owns its effects, and the seam that operation proves refuses.
  const withoutLookup = {
    ...support,
    capabilities: {
      ...support.capabilities,
      operations: {
        ...support.capabilities.operations,
        lookupByClientKey: false,
      },
    },
  };
  const parsedWithoutLookup = parseHarnessSupport(withoutLookup);
  assert.equal(parsedWithoutLookup.ok, true);
  assert.deepEqual(
    parsedWithoutLookup.ok ? parsedWithoutLookup.classification : undefined,
    { dispatchRecovery: "at-most-once-manual", tierEnforcement: "proven" },
  );
  const classified = createHarnessRecoveryEffectAdapter(withoutLookup);
  assert.equal(classified.canExecute?.(effect), true);
  assert.equal(classified.canReconcile?.(effect), true);
});

test("launch intent refuses a packet whose persisted hash does not bind its bytes", () => {
  const { before } = dispatchedIntent();
  const valid = event(before, "dispatch_intent") as Extract<
    ProtocolEvent,
    { type: "dispatch_intent" }
  >;
  const rejected = reduce(before, {
    ...valid,
    packet: { ...valid.packet, hash: HASH },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.ok ? "" : rejected.reason, /packet payload\/hash/);
});

test("launch intent refuses a valid packet when its prompt hash differs", () => {
  const { before } = dispatchedIntent();
  const valid = event(before, "dispatch_intent") as Extract<
    ProtocolEvent,
    { type: "dispatch_intent" }
  >;
  const rejected = reduce(before, { ...valid, promptHash: HASH });
  assert.equal(rejected.ok, false);
  assert.match(
    rejected.ok ? "" : rejected.reason,
    /prompt hash must equal packet hash/,
  );
});

test("committed wave metadata binds worker packets and verification commands", () => {
  const task = {
    acceptanceIds: ["required"],
    conflictDomains: ["source"],
    dependencies: [],
    independence: "proven" as const,
    mandatoryVerification: ["npm-test"],
    ownedPaths: ["src-expected"],
    priority: 0,
    reservations: ["port-3001"],
    risk: "high" as const,
    unitId: "unit-1",
  };
  const { before } = dispatchedIntent();
  const planned = {
    ...before,
    units: {
      ...before.units,
      "unit-1": { ...before.units["unit-1"]!, taskMetadata: task },
    },
  };
  const matching = packetBinding({
    acceptance: ["required"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm-test"],
    ownedPaths: ["src-expected"],
    role: "worker",
    unitId: "unit-1",
  });
  const dispatch = event(planned, "dispatch_intent") as Extract<
    ProtocolEvent,
    { type: "dispatch_intent" }
  >;
  assert.equal(
    reduce(planned, {
      ...dispatch,
      packet: matching,
      promptHash: matching.hash,
    }).ok,
    true,
  );
  const substituted = packetBinding({
    acceptance: ["different"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["true"],
    ownedPaths: ["totally-different"],
    role: "worker",
    unitId: "unit-1",
  });
  const rejected = reduce(planned, {
    ...dispatch,
    packet: substituted,
    promptHash: substituted.hash,
  });
  assert.equal(rejected.ok, false);
  assert.match(
    rejected.ok ? "" : rejected.reason,
    /committed wave task metadata/,
  );
  for (const taskMetadata of [undefined, { ...task, unitId: "other-unit" }]) {
    const { taskMetadata: _committed, ...withoutTaskMetadata } =
      planned.units["unit-1"]!;
    const unbound = reduce(
      {
        ...planned,
        units: {
          "unit-1":
            taskMetadata === undefined
              ? withoutTaskMetadata
              : { ...planned.units["unit-1"]!, taskMetadata },
        },
      },
      {
        ...dispatch,
        packet: matching,
        promptHash: matching.hash,
      },
    );
    assert.equal(unbound.ok, false);
    assert.match(unbound.ok ? "" : unbound.reason, /wave task metadata/);
  }

  const candidate = {
    ...planned,
    qualificationQueue: ["unit-1"],
    units: {
      "unit-1": {
        ...planned.units["unit-1"]!,
        candidateHead: "b".repeat(40),
        candidateTree: "c".repeat(40),
        candidateDiffHash: deriveCandidateDiffHash(
          "diff --git a/src-expected b/src-expected",
        ),
        state: "candidate_committed" as const,
      },
    },
  };
  const wrongVerification = reduce(
    candidate,
    event(candidate, "verification_intent", { commands: ["true"] }),
  );
  assert.equal(wrongVerification.ok, false);
  assert.match(
    wrongVerification.ok ? "" : wrongVerification.reason,
    /committed wave task metadata/,
  );
  const verification = reduce(
    candidate,
    event(candidate, "verification_intent", { commands: ["npm-test"] }),
  );
  assert.equal(verification.ok, true);
  if (!verification.ok) return;
  const qualified = reduce(
    verification.nextState,
    event(verification.nextState, "verification_observed", {
      baseOid: "a".repeat(40),
      effectId: verification.effects[0]!.effectId,
      effectKind: "verify",
      headOid: "b".repeat(40),
      observationHash: HASH,
      treeOid: "c".repeat(40),
    }),
  );
  assert.equal(qualified.ok, true);
  if (!qualified.ok) return;
  const matchingReview = packetBinding({
    acceptance: ["required"],
    baseOid: "a".repeat(40),
    diff: "diff --git a/src-expected b/src-expected",
    headOid: "b".repeat(40),
    mandatoryVerification: ["npm-test"],
    ownedPaths: ["src-expected"],
    role: "reviewer",
    unitId: "unit-1",
  });
  const reviewEvent = event(
    qualified.nextState,
    "reviewer_dispatch_intent",
  ) as Extract<ProtocolEvent, { type: "reviewer_dispatch_intent" }>;
  assert.equal(
    reduce(qualified.nextState, {
      ...reviewEvent,
      packet: matchingReview,
      promptHash: matchingReview.hash,
    }).ok,
    true,
  );
  const substitutedDiff = packetBinding({
    acceptance: ["required"],
    baseOid: "a".repeat(40),
    diff: "diff --git a/src-expected b/src-expected\n+forged",
    headOid: "b".repeat(40),
    mandatoryVerification: ["npm-test"],
    ownedPaths: ["src-expected"],
    role: "reviewer",
    unitId: "unit-1",
  });
  const diffRejected = reduce(qualified.nextState, {
    ...reviewEvent,
    packet: substitutedDiff,
    promptHash: substitutedDiff.hash,
  });
  assert.equal(diffRejected.ok, false);
  assert.match(
    diffRejected.ok ? "" : diffRejected.reason,
    /exact candidate diff/,
  );
  const substitutedReview = packetBinding({
    acceptance: ["different"],
    baseOid: "a".repeat(40),
    diff: "diff --git a/totally-different b/totally-different",
    headOid: "b".repeat(40),
    mandatoryVerification: ["true"],
    ownedPaths: ["totally-different"],
    role: "reviewer",
    unitId: "unit-1",
  });
  assert.equal(
    reduce(qualified.nextState, {
      ...reviewEvent,
      packet: substitutedReview,
      promptHash: substitutedReview.hash,
    }).ok,
    false,
  );
});

test("recovery persists a manual packet before a host acknowledgement advances dispatch", async () => {
  const { before, effect } = dispatchedIntent();
  let root = makeRootProjection(before);
  let children = [makeChildProjection(root, "unit-1")!];
  const store = {
    async compareAndSet(batch: MutationBatch) {
      root = batch.next.root;
      children = [...batch.next.children];
      return {
        affectedRowCount: batch.changedRows.length + 1,
        checkpoint: batch.checkpoint,
        children,
        root,
        status: "applied" as const,
      };
    },
    async load() {
      return { status: "observed" as const, value: { children, root } };
    },
    async persistControllerAcquireIntent(batch: MutationBatch) {
      return await this.compareAndSet(batch);
    },
  };
  const runner = createRecoveryRunner({
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: { release: async () => ({ status: "released" as const }) },
    }),
    adapter: createHarnessRecoveryEffectAdapter(support),
    nonce: "manual-host-1",
    preOwnership: store,
    proveTopology: async () => ({
      commonDir: "/repo/.git",
      holder: before.controller.holder,
      scope: {
        beadsStoreIdentity: before.storeIdentity,
        gitRepositoryIdentity: before.repositoryIdentity,
        integrationBranch: before.integrationBranch,
      },
    }),
    store,
  });
  const requested = await runner(event(before, "dispatch_intent"));
  assert.equal(requested.status, "tool_request");
  assert.equal(root.run.effectJournal.at(-1)?.status, "intended");
  const lostAcknowledgement = await runner();
  assert.equal(lostAcknowledgement.status, "tool_request");
  assert.equal(root.run.effectJournal.at(-1)?.status, "intended");
  const launched = await runner({
    harnessAcknowledgement: {
      effectId: effect.effectId,
      kind: "launch",
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
  });
  assert.equal(launched.status, "tool_request");
  assert.equal(root.run.effectJournal.at(-1)?.status, "intended");
  const settled = await runner({
    harnessAcknowledgement: {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: session(effect).sessionId,
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
  });
  assert.equal(settled.status, "applied");
  assert.equal(root.run.units["unit-1"]?.state, "dispatched");
});

test("production recovery composition routes persisted harness effects to the injected port", async () => {
  const { effect, state } = dispatchedIntent();
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository: {
        commonDir: "/repo/.git",
        cwd: "/repo",
        identity: "local:/repo/.git",
        objectFormat: "sha1",
        remoteUrls: [],
      },
      runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
    },
    harness: {
      port: port({
        inspect: async () => session(effect),
        launch: async () => session(effect),
      }),
      support,
    },
  });
  assert.equal((await adapter.execute(effect, state)).status, "observed");
});

test("lost launch is reconciled by lookup plus inspection; lookup absence is manual ambiguity", async () => {
  const { effect, state } = dispatchedIntent();
  const recovered = await createHarnessRecoveryEffectAdapter(
    support,
    port({
      inspect: async () => session(effect),
      lookupByClientKey: async (clientKey) =>
        clientKey === effect.idempotencyKey ? session(effect) : undefined,
    }),
  ).reconcile(effect, state);
  assert.equal(recovered.status, "observed");
  const missing = await createHarnessRecoveryEffectAdapter(
    support,
    port(),
  ).reconcile(effect, state);
  assert.deepEqual(missing, { status: "ambiguous" });
});

test("worker collection remains slot-bound until exact collect observation", async () => {
  const { effect, state: intended } = dispatchedIntent();
  const launched = await createHarnessRecoveryEffectAdapter(
    support,
    port({
      inspect: async () => session(effect),
      launch: async () => session(effect),
    }),
  ).execute(effect, intended);
  assert.equal(launched.status, "observed");
  if (launched.status !== "observed") return;
  let dispatched = reduceState(intended, launched.observation);
  const collectIntent = reduce(dispatched, event(dispatched, "collect_intent"));
  assert.equal(collectIntent.ok, true);
  if (!collectIntent.ok) return;
  const collecting = collectIntent.nextState;
  const collectEffect = collectIntent.effects[0]!;
  const ambiguous = reduce(
    collecting,
    event(collecting, "effect_ambiguous", {
      effectId: collectEffect.effectId,
      effectKind: "worker_collect",
    }),
  );
  assert.equal(ambiguous.ok, true);
  if (!ambiguous.ok) return;
  assert.deepEqual(ambiguous.nextState.activeModifyingUnitIds, ["unit-1"]);
  const collectAcknowledgement = {
    effectId: collectEffect.effectId,
    kind: "worker_collected" as const,
    schema: "sce.harness-tool-acknowledgement" as const,
    sessionId: "worker-session-1",
    version: HARNESS_VERSION,
    workerResult: {
      residualRisks: [],
      status: "completed" as const,
      suggestedFollowUps: [],
      summary: "done",
    },
  };
  assert.equal(validate(ProtocolEventSchema, collectAcknowledgement).ok, false);
  const manualPoll = await createHarnessRecoveryEffectAdapter(
    support,
  ).reconcile(collectEffect, collecting);
  assert.equal(manualPoll.status, "tool_request");
  if (manualPoll.status === "tool_request") {
    const pollRequest = validate<HarnessToolRequest>(
      HarnessToolRequestSchema,
      manualPoll.toolRequest,
    );
    assert.equal(pollRequest.ok, true);
    if (pollRequest.ok && pollRequest.value !== undefined) {
      assert.equal(pollRequest.value.operation, "poll");
      if (pollRequest.value.operation === "poll")
        assert.equal(pollRequest.value.session.sessionId, "worker-session-1");
    }
  }
  const collect = await createHarnessRecoveryEffectAdapter(
    support,
    port({
      collect: async () => collectAcknowledgement,
    }),
  ).execute(collectEffect, collecting);
  assert.equal(collect.status, "observed");
  if (collect.status !== "observed") return;
  const collected = reduceState(collecting, collect.observation);
  assert.deepEqual(collected.activeModifyingUnitIds, []);
  const polled = await createHarnessRecoveryEffectAdapter(
    support,
    port({ poll: async () => collectAcknowledgement }),
  ).reconcile(collectEffect, collecting);
  assert.equal(polled.status, "observed");
  if (polled.status !== "observed") return;
  assert.deepEqual(
    reduceState(collecting, polled.observation).activeModifyingUnitIds,
    [],
  );
});

test("wave planning is a reducer transition with graph, conflict, and singleton guards", () => {
  const units = ["a", "b", "c", "d"].map((id) => unit(id));
  const initial = { ...run(units), wave: { id: "drained", unitIds: [] } };
  const eventInput: ProtocolEvent = {
    eventId: "wave-plan-1",
    expectedRevision: initial.revision,
    tasks: [
      {
        acceptanceIds: ["a"],
        conflictDomains: [],
        dependencies: [],
        independence: "proven",
        mandatoryVerification: ["npm test"],
        ownedPaths: ["src"],
        priority: 0,
        reservations: [],
        risk: "high",
        unitId: "a",
      },
      {
        acceptanceIds: ["b"],
        conflictDomains: [],
        dependencies: [],
        independence: "proven",
        mandatoryVerification: ["npm test"],
        ownedPaths: ["src/b"],
        priority: 1,
        reservations: [],
        risk: "low",
        unitId: "b",
      },
      {
        acceptanceIds: ["c"],
        conflictDomains: [],
        dependencies: [],
        independence: "ambiguous",
        mandatoryVerification: ["npm test"],
        ownedPaths: ["src/c"],
        priority: 2,
        reservations: [],
        risk: "low",
        unitId: "c",
      },
      {
        acceptanceIds: ["d"],
        conflictDomains: [],
        dependencies: ["a"],
        independence: "proven",
        mandatoryVerification: ["npm test"],
        ownedPaths: ["src/d"],
        priority: 0,
        reservations: [],
        risk: "critical",
        unitId: "d",
      },
    ],
    type: "wave_planned",
    waveId: "wave-2",
  };
  const planned = reduce(initial, eventInput);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.nextState.wave.unitIds, ["a"]);
  assert.deepEqual(
    planned.nextState.units.a?.taskMetadata,
    eventInput.tasks[0],
  );
  assert.ok(
    legalActions(planned.nextState)
      .map((item) => item.type)
      .includes("reservation_intent"),
  );
  const missingVerification = validate(ProtocolEventSchema, {
    ...eventInput,
    tasks: eventInput.tasks.map(
      ({ mandatoryVerification: _ignored, ...task }) => task,
    ),
  });
  assert.equal(missingVerification.ok, false);
  const cycle = reduce(initial, {
    ...eventInput,
    tasks: eventInput.tasks.map((task) =>
      task.unitId === "a" ? { ...task, dependencies: ["d"] } : task,
    ),
  });
  assert.equal(cycle.ok, false);
  assert.match(cycle.ok ? "" : cycle.reason, /cycle/);
  const nonCanonicalPath = reduce(initial, {
    ...eventInput,
    eventId: "wave-plan-path",
    tasks: eventInput.tasks.map((task) =>
      task.unitId === "a" ? { ...task, ownedPaths: ["src//a"] } : task,
    ),
  });
  assert.equal(nonCanonicalPath.ok, false);
  const fanout = reduce(initial, {
    ...eventInput,
    eventId: "wave-plan-2",
    tasks: eventInput.tasks.map((task) =>
      task.unitId === "a"
        ? { ...task, reservations: ["db"] }
        : task.unitId === "b"
          ? { ...task, ownedPaths: ["lib/b"], reservations: ["db"] }
          : task.unitId === "c"
            ? {
                ...task,
                independence: "proven",
                ownedPaths: ["lib/c"],
              }
            : task,
    ),
  });
  assert.equal(fanout.ok, true);
  if (!fanout.ok) return;
  assert.deepEqual(fanout.nextState.wave.unitIds, ["a", "c"]);
  const premature = reduce(fanout.nextState, {
    ...eventInput,
    eventId: "wave-plan-3",
    expectedRevision: fanout.nextState.revision,
  });
  assert.equal(premature.ok, false);
  assert.match(premature.ok ? "" : premature.reason, /prior wave/);
});
