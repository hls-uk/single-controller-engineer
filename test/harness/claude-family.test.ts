import assert from "node:assert/strict";
import test from "node:test";

import {
  createHarnessRecoveryEffectAdapter,
  harnessSupportCommitment,
  HarnessCapabilitiesSchema,
  HarnessSupportSchema,
  HarnessToolRequestSchema,
  HARNESS_VERSION,
  parseHarnessSupport,
  type HarnessPort,
  type HarnessSupport,
  type HarnessToolRequest,
} from "../../src/harness/index.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import { sha256 } from "../../src/protocol/evidence.js";
import { reduce, type ProtocolEffect } from "../../src/protocol/reducer.js";
import { validate } from "../../src/protocol/schemas.js";
import type {
  ProtocolEvent,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import { HASH, event, run, transition } from "../protocol/fixtures.js";

const FAMILY = "claude";
const FRONTIER_MODEL = "claude-fable-5";
const WORKHORSE_MODEL = "claude-opus-5";
const WORKTREE = "/tmp/claude-unit-1";
const SESSION_ID = "claude-worker-session-1";
const REFUSED_PROFILE = {
  ok: false,
  reason: "harness lacks a complete trusted lifecycle capability",
} as const;
/** Admission still requires every executable lifecycle operation. */
const LIFECYCLE_OPERATIONS = [
  "cancel",
  "collect",
  "inspect",
  "launch",
  "poll",
  "returnedModelIdentity",
] as const;

/**
 * The declared claude-family profile: it can launch, inspect, poll, collect
 * and cancel, and it returns model identity, but it can neither rediscover a
 * launch by client key nor prove the active controller tier. That is the
 * at-most-once/manual-reconciliation classification.
 */
const declared: HarnessSupport = {
  capabilities: {
    adapterVersion: HARNESS_VERSION,
    family: FAMILY,
    harnessVersion: HARNESS_VERSION,
    operations: {
      cancel: true,
      collect: true,
      controllerIdentity: false,
      inspect: true,
      launch: true,
      lookupByClientKey: false,
      poll: true,
      returnedModelIdentity: true,
    },
    schema: "sce.harness-capabilities",
    version: HARNESS_VERSION,
  },
  controller: {
    acceptedReturnedModels: [FRONTIER_MODEL],
    requestedModel: FRONTIER_MODEL,
  },
  frontier: {
    acceptedReturnedModels: [FRONTIER_MODEL],
    requestedModel: FRONTIER_MODEL,
  },
  schema: "sce.harness-support",
  version: HARNESS_VERSION,
  workhorse: {
    acceptedReturnedModels: [WORKHORSE_MODEL],
    requestedModel: WORKHORSE_MODEL,
  },
};

/** The same family and model routes with both trust operations present. */
const trusted: HarnessSupport = {
  ...declared,
  capabilities: {
    ...declared.capabilities,
    operations: {
      ...declared.capabilities.operations,
      controllerIdentity: true,
      lookupByClientKey: true,
    },
  },
};

/** A single-operation variation of the fully trusted claude matrix. */
function withOperations(
  overrides: Partial<HarnessSupport["capabilities"]["operations"]>,
): HarnessSupport {
  return {
    ...trusted,
    capabilities: {
      ...trusted.capabilities,
      operations: { ...trusted.capabilities.operations, ...overrides },
    },
  };
}

function classificationOf(support: HarnessSupport) {
  const parsed = parseHarnessSupport(support);
  assert.equal(parsed.ok, true);
  return parsed.ok ? parsed.classification : undefined;
}

function reduceState(
  state: RepositoryRun,
  input: ProtocolEvent,
): RepositoryRun {
  return transition(state, input, reduce);
}

/** A run whose controller identity and harness commitment are claude-bound. */
function claudeRun(support: HarnessSupport): RepositoryRun {
  const committed = harnessSupportCommitment(support);
  assert.equal(committed.ok, true);
  const base = run();
  return {
    ...base,
    controller: {
      ...base.controller,
      requestedModel: FRONTIER_MODEL,
      returnedModel: FRONTIER_MODEL,
    },
    harness: {
      adapterVersion: HARNESS_VERSION,
      family: FAMILY,
      harnessVersion: HARNESS_VERSION,
      supportCommitment: committed.ok ? committed.value : HASH,
    },
  };
}

function dispatchIntent(support: HarnessSupport): {
  before: RepositoryRun;
  effect: ProtocolEffect;
  state: RepositoryRun;
} {
  let state = claudeRun(support);
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
    event(state, "worktree_intent", { worktreePath: WORKTREE }),
  );
  state = reduceState(
    state,
    event(state, "worktree_observed", {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "worktree_create",
      observationHash: HASH,
      worktreePath: WORKTREE,
    }),
  );
  const dispatch = event(state, "dispatch_intent") as Extract<
    ProtocolEvent,
    { type: "dispatch_intent" }
  >;
  const intent = reduce(state, {
    ...dispatch,
    requestedModel: WORKHORSE_MODEL,
  });
  assert.equal(intent.ok, true);
  if (!intent.ok) throw new Error("claude dispatch intent refused");
  return { before: state, effect: intent.effects[0]!, state: intent.nextState };
}

function session(
  effect: ProtocolEffect,
  overrides: Record<string, unknown> = {},
): unknown {
  const params = effect.params as Extract<
    ProtocolEffect,
    { kind: "dispatch" }
  >["params"];
  return {
    clientKey: effect.idempotencyKey,
    fresh: true,
    harnessFamily: FAMILY,
    harnessVersion: HARNESS_VERSION,
    promptHash: params.promptHash,
    readOnly: false,
    requestedModel: params.requestedModel,
    returnedModel: WORKHORSE_MODEL,
    role: "worker",
    sessionId: SESSION_ID,
    worktreePath: params.worktreePath,
    ...overrides,
  };
}

function port(overrides: Partial<HarnessPort> = {}): HarnessPort {
  return {
    capabilities: async () => trusted.capabilities,
    cancel: async () => ({}),
    collect: async () => ({}),
    controllerIdentity: async () => ({
      harnessFamily: FAMILY,
      harnessVersion: HARNESS_VERSION,
      requestedModel: FRONTIER_MODEL,
      returnedModel: FRONTIER_MODEL,
      sessionId: "incarnation-1",
    }),
    inspect: async () => undefined,
    launch: async () => ({}),
    lookupByClientKey: async () => undefined,
    poll: async () => undefined,
    ...overrides,
  };
}

/** Advances a claude unit to a bound worker session through a real launch. */
async function dispatched(): Promise<{
  effect: ProtocolEffect;
  state: RepositoryRun;
}> {
  const { effect, state } = dispatchIntent(trusted);
  const observed = await createHarnessRecoveryEffectAdapter(
    trusted,
    port({
      inspect: async () => session(effect),
      launch: async () => session(effect),
    }),
  ).execute(effect, state);
  assert.equal(observed.status, "observed");
  if (observed.status !== "observed") throw new Error("claude launch refused");
  return { effect, state: reduceState(state, observed.observation) };
}

/**
 * The declared profile's only launch path: the model-tool seam, whose
 * observation is bound by hand because no tier proof and no client-key
 * lookup exist to bind it automatically.
 */
async function manuallyDispatched(): Promise<{
  effect: ProtocolEffect;
  state: RepositoryRun;
}> {
  const { effect, state } = dispatchIntent(declared);
  const adapter = createHarnessRecoveryEffectAdapter(declared);
  assert.equal((await adapter.execute(effect, state)).status, "tool_request");
  const observed = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: SESSION_ID,
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.equal(observed?.status, "observed");
  if (observed?.status !== "observed")
    throw new Error("claude manual launch refused");
  return { effect, state: reduceState(state, observed.observation) };
}

test("the claude support map is admitted as a lifecycle and classified on its trust operations", () => {
  // The declared matrix satisfies every structural bound: the schema layer
  // does not encode capability policy, so it must accept it.
  assert.equal(validate(HarnessSupportSchema, declared).ok, true);
  assert.equal(
    validate(HarnessCapabilitiesSchema, declared.capabilities).ok,
    true,
  );
  // Admission turns on the executable lifecycle alone. The two trust
  // operations become a classification the admitted profile carries.
  assert.deepEqual(classificationOf(declared), {
    dispatchRecovery: "at-most-once-manual",
    tierEnforcement: "unavailable",
  });
  assert.deepEqual(classificationOf(trusted), {
    dispatchRecovery: "crash-safe",
    tierEnforcement: "proven",
  });
  assert.deepEqual(
    classificationOf(withOperations({ controllerIdentity: false })),
    {
      dispatchRecovery: "crash-safe",
      tierEnforcement: "unavailable",
    },
  );
  assert.deepEqual(
    classificationOf(withOperations({ lookupByClientKey: false })),
    { dispatchRecovery: "at-most-once-manual", tierEnforcement: "proven" },
  );
  // Classification does not enter the commitment: it stays the canonical
  // digest of the whole declared matrix, so a run commits to what it declared.
  for (const support of [declared, trusted]) {
    const committed = harnessSupportCommitment(support);
    assert.equal(committed.ok, true);
    assert.equal(
      committed.ok ? committed.value : "",
      sha256(canonicalJson(support as unknown as JsonValue)),
    );
  }
  // Each individually missing lifecycle operation is still refused outright,
  // and an unadmitted profile still has no durable commitment at all.
  for (const operation of LIFECYCLE_OPERATIONS) {
    const incomplete = withOperations({ [operation]: false });
    assert.deepEqual(
      parseHarnessSupport(incomplete),
      REFUSED_PROFILE,
      operation,
    );
    assert.deepEqual(
      harnessSupportCommitment(incomplete),
      REFUSED_PROFILE,
      operation,
    );
  }
  // Structural refusals: unknown members, absent members, empty and duplicated
  // returned-model routes, and a wrong adapter version are all closed.
  const malformed = [
    { name: "unknown member", value: { ...trusted, extra: true } },
    {
      name: "unknown operation",
      value: {
        ...trusted,
        capabilities: {
          ...trusted.capabilities,
          operations: { ...trusted.capabilities.operations, replay: true },
        },
      },
    },
    {
      name: "absent operation",
      value: {
        ...trusted,
        capabilities: {
          ...trusted.capabilities,
          operations: (({ poll: _poll, ...rest }) => rest)(
            trusted.capabilities.operations,
          ),
        },
      },
    },
    {
      name: "empty returned-model route",
      value: {
        ...trusted,
        workhorse: { ...trusted.workhorse, acceptedReturnedModels: [] },
      },
    },
    {
      name: "duplicate returned models",
      value: {
        ...trusted,
        workhorse: {
          ...trusted.workhorse,
          acceptedReturnedModels: [WORKHORSE_MODEL, WORKHORSE_MODEL],
        },
      },
    },
    {
      name: "unsupported adapter version",
      value: {
        ...trusted,
        capabilities: { ...trusted.capabilities, adapterVersion: 2 },
      },
    },
    {
      name: "family identifier shape",
      value: {
        ...trusted,
        capabilities: { ...trusted.capabilities, family: "-claude" },
      },
    },
  ] as const;
  for (const candidate of malformed) {
    assert.equal(
      validate(HarnessSupportSchema, candidate.value).ok,
      false,
      candidate.name,
    );
    assert.deepEqual(
      parseHarnessSupport(candidate.value),
      { ok: false, reason: "invalid harness support matrix" },
      candidate.name,
    );
  }
  // Tier aliasing stays refused for claude identifiers exactly as it is for
  // any other family: a workhorse must never be reachable as a frontier.
  for (const aliased of [
    { ...trusted.workhorse, requestedModel: FRONTIER_MODEL },
    { ...trusted.workhorse, acceptedReturnedModels: [FRONTIER_MODEL] },
  ]) {
    assert.deepEqual(parseHarnessSupport({ ...trusted, workhorse: aliased }), {
      ok: false,
      reason: "model identities alias capability tiers",
    });
  }
  // Parsing is total for hostile input, not merely for malformed records.
  assert.equal(
    parseHarnessSupport(
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("hostile input");
          },
        },
      ),
    ).ok,
    false,
  );
});

test("the at-most-once claude profile proves no controller tier and never recovers by client key", async () => {
  const { effect, state } = dispatchIntent(declared);
  let launches = 0;
  let lookups = 0;
  // This host would happily launch, would rediscover the launch by client key,
  // and attests exactly the controller identity the run records. The declared
  // classification, not host willingness, decides which seams are open.
  const willing = port({
    capabilities: async () => declared.capabilities,
    inspect: async () => session(effect),
    launch: async () => {
      launches += 1;
      return session(effect);
    },
    lookupByClientKey: async () => {
      lookups += 1;
      return session(effect);
    },
  });
  const adapter = createHarnessRecoveryEffectAdapter(declared, willing);
  // The profile is admitted, so the adapter owns the effect on both seams.
  assert.equal(adapter.canExecute?.(effect), true);
  assert.equal(adapter.canReconcile?.(effect), true);
  // Tier enforcement is unavailable, so every port seam fails explicitly
  // rather than accept the controller's own account of the tier it runs at.
  assert.deepEqual(await adapter.execute(effect, state), {
    status: "ambiguous",
  });
  assert.deepEqual(await adapter.reconcile(effect, state), {
    status: "ambiguous",
  });
  assert.equal(launches, 0);
  assert.equal(lookups, 0);
  // Admission buys the manual model-tool launch seam and nothing more: its
  // recovery form is withheld, so an ambiguous launch blocks for a
  // human-bound observation instead of gaining a lookup it cannot perform.
  const manual = createHarnessRecoveryEffectAdapter(declared);
  assert.equal((await manual.execute(effect, state)).status, "tool_request");
  assert.deepEqual(await manual.reconcile(effect, state), {
    status: "ambiguous",
  });
  assert.deepEqual(
    await manual.acknowledge?.(
      {
        effectId: effect.effectId,
        kind: "launch",
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect),
        version: HARNESS_VERSION,
      },
      state,
    ),
    { status: "ambiguous" },
  );
  // Dropping the controller-identity proof alone from an otherwise trusted
  // matrix refuses the same way: tier enforcement is never an admitted no-op.
  const tierless = withOperations({ controllerIdentity: false });
  const tierlessDispatch = dispatchIntent(tierless);
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      tierless,
      port({
        capabilities: async () => tierless.capabilities,
        inspect: async () => session(tierlessDispatch.effect),
        launch: async () => {
          launches += 1;
          return session(tierlessDispatch.effect);
        },
      }),
    ).execute(tierlessDispatch.effect, tierlessDispatch.state),
    { status: "ambiguous" },
  );
  assert.equal(launches, 0);
  // Dropping lookup alone keeps launching trusted and closes reconciliation in
  // place, so lookup loss can never be silently downgraded into a recovery.
  const lookupless = withOperations({ lookupByClientKey: false });
  const looklessDispatch = dispatchIntent(lookupless);
  const withoutLookup = createHarnessRecoveryEffectAdapter(
    lookupless,
    port({
      capabilities: async () => lookupless.capabilities,
      inspect: async () => session(looklessDispatch.effect),
      launch: async () => session(looklessDispatch.effect),
      lookupByClientKey: async () => {
        lookups += 1;
        return session(looklessDispatch.effect);
      },
    }),
  );
  assert.equal(
    (
      await withoutLookup.execute(
        looklessDispatch.effect,
        looklessDispatch.state,
      )
    ).status,
    "observed",
  );
  assert.deepEqual(
    await withoutLookup.reconcile(
      looklessDispatch.effect,
      looklessDispatch.state,
    ),
    { status: "ambiguous" },
  );
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(lookupless).reconcile(
      looklessDispatch.effect,
      looklessDispatch.state,
    ),
    { status: "ambiguous" },
  );
  assert.equal(lookups, 0);
  // Under the trusted profile a lookup does happen, and a host that cannot
  // find the launch is manual ambiguity, never an invented recovery.
  const trustedDispatch = dispatchIntent(trusted);
  const found = await createHarnessRecoveryEffectAdapter(
    trusted,
    port({
      inspect: async () => session(trustedDispatch.effect),
      lookupByClientKey: async (clientKey) =>
        clientKey === trustedDispatch.effect.idempotencyKey
          ? session(trustedDispatch.effect)
          : undefined,
    }),
  ).reconcile(trustedDispatch.effect, trustedDispatch.state);
  assert.equal(found.status, "observed");
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(trusted, port()).reconcile(
      trustedDispatch.effect,
      trustedDispatch.state,
    ),
    { status: "ambiguous" },
  );
});

test("a claude launch is bound to the exact session identity it requested", async () => {
  const { effect, state } = dispatchIntent(trusted);
  let inspections = 0;
  const observed = await createHarnessRecoveryEffectAdapter(
    trusted,
    port({
      inspect: async () => {
        inspections += 1;
        return session(effect);
      },
      launch: async () => session(effect),
    }),
  ).execute(effect, state);
  assert.equal(observed.status, "observed");
  if (observed.status !== "observed") return;
  assert.equal(observed.observation.type, "dispatch_observed");
  assert.equal(inspections, 1);
  // Every field the session binds is load-bearing, including the returned
  // model: a frontier identity returned to a workhorse launch crosses tiers
  // and an unlisted identity is not the model the route accepts.
  const mismatches = [
    { name: "harness family", overrides: { harnessFamily: "codex" } },
    { name: "client key", overrides: { clientKey: "invented-client" } },
    { name: "prompt hash", overrides: { promptHash: HASH } },
    { name: "read-only boundary", overrides: { readOnly: true } },
    { name: "role", overrides: { role: "reviewer" } },
    { name: "worktree", overrides: { worktreePath: "/tmp/other" } },
    {
      name: "requested model",
      overrides: { requestedModel: FRONTIER_MODEL },
    },
    {
      name: "returned model crosses tiers",
      overrides: { returnedModel: FRONTIER_MODEL },
    },
    {
      name: "returned model is not accepted",
      overrides: { returnedModel: "claude-opus-4" },
    },
    { name: "session is not fresh", overrides: { fresh: false } },
    { name: "session identifier is empty", overrides: { sessionId: "" } },
    { name: "unknown session member", overrides: { transcript: "…" } },
  ] as const;
  for (const mismatch of mismatches) {
    inspections = 0;
    assert.deepEqual(
      await createHarnessRecoveryEffectAdapter(
        trusted,
        port({
          inspect: async () => {
            inspections += 1;
            return session(effect);
          },
          launch: async () => session(effect, mismatch.overrides),
        }),
      ).execute(effect, state),
      { status: "ambiguous" },
      mismatch.name,
    );
    assert.equal(inspections, 0, mismatch.name);
  }
  // A trusted launch acknowledgement is not authority over the inspection:
  // the inspected session is bound again before any observation is recorded.
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      trusted,
      port({
        inspect: async () => session(effect, { returnedModel: FRONTIER_MODEL }),
        launch: async () => session(effect),
      }),
    ).execute(effect, state),
    { status: "ambiguous" },
  );
  // The controller tier itself is proven per effect. An untrusted controller
  // identity blocks before the host is asked to launch anything.
  let untrustedLaunches = 0;
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      trusted,
      port({
        controllerIdentity: async () => ({
          harnessFamily: FAMILY,
          harnessVersion: HARNESS_VERSION,
          requestedModel: FRONTIER_MODEL,
          returnedModel: FRONTIER_MODEL,
          sessionId: "other-controller",
        }),
        launch: async () => {
          untrustedLaunches += 1;
          return session(effect);
        },
      }),
    ).execute(effect, state),
    { status: "ambiguous" },
  );
  assert.equal(untrustedLaunches, 0);
  // Live capabilities that disagree with the committed matrix block as well.
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      trusted,
      port({
        capabilities: async () => declared.capabilities,
        launch: async () => session(effect),
      }),
    ).execute(effect, state),
    { status: "ambiguous" },
  );
});

test("claude model-tool requests are deterministic and only exact acknowledgements advance", async () => {
  const { effect, state } = dispatchIntent(trusted);
  const adapter = createHarnessRecoveryEffectAdapter(trusted);
  const first = await adapter.execute(effect, state);
  assert.deepEqual(first, await adapter.execute(effect, state));
  assert.equal(first.status, "tool_request");
  if (first.status !== "tool_request") return;
  const request = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    first.toolRequest,
  );
  assert.equal(request.ok, true);
  if (!request.ok || request.value === undefined) return;
  assert.equal(request.value.operation, "launch");
  if (request.value.operation !== "launch") return;
  assert.equal(request.value.effectId, effect.effectId);
  assert.equal(request.value.idempotencyKey, effect.idempotencyKey);
  assert.equal(request.value.request.clientKey, effect.idempotencyKey);
  assert.equal(request.value.request.requestedModel, WORKHORSE_MODEL);
  assert.equal(request.value.request.role, "worker");
  assert.equal(request.value.request.readOnly, false);
  assert.equal(request.value.request.worktreePath, WORKTREE);
  assert.equal(
    request.value.request.promptHash,
    request.value.request.packet.hash,
  );
  // A launch acknowledgement only earns the read-only lookup request; it is
  // never itself authority to record the dispatch observation.
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
  const recovery = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    acknowledged.toolRequest,
  );
  assert.equal(recovery.ok, true);
  assert.equal(recovery.value?.operation, "lookup_inspect");
  const inspected = await adapter.acknowledge?.(
    {
      effectId: effect.effectId,
      kind: "launch_inspected",
      lookupSessionId: SESSION_ID,
      schema: "sce.harness-tool-acknowledgement",
      session: session(effect),
      version: HARNESS_VERSION,
    },
    state,
  );
  assert.equal(inspected?.status, "observed");
  // Neither a false answer nor any schema-invalid or forged acknowledgement
  // can advance the effect. Each one is refused as ambiguous.
  const refused: readonly { name: string; value: unknown }[] = [
    { name: "false", value: false },
    { name: "null", value: null },
    { name: "empty record", value: {} },
    {
      name: "unknown acknowledgement kind",
      value: {
        effectId: effect.effectId,
        kind: "launch_assumed",
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect),
        version: HARNESS_VERSION,
      },
    },
    {
      name: "wrong schema identifier",
      value: {
        effectId: effect.effectId,
        kind: "launch",
        schema: "sce.harness-tool-request",
        session: session(effect),
        version: HARNESS_VERSION,
      },
    },
    {
      name: "unknown member",
      value: {
        effectId: effect.effectId,
        kind: "launch",
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect),
        usage: { tokens: 1 },
        version: HARNESS_VERSION,
      },
    },
    {
      name: "unknown effect",
      value: {
        effectId: "invented-effect",
        kind: "launch",
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect),
        version: HARNESS_VERSION,
      },
    },
    {
      name: "invented lookup session",
      value: {
        effectId: effect.effectId,
        kind: "launch_inspected",
        lookupSessionId: "invented-session",
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect),
        version: HARNESS_VERSION,
      },
    },
    {
      name: "forged session identity",
      value: {
        effectId: effect.effectId,
        kind: "launch_inspected",
        lookupSessionId: SESSION_ID,
        schema: "sce.harness-tool-acknowledgement",
        session: session(effect, { clientKey: "invented-client" }),
        version: HARNESS_VERSION,
      },
    },
    {
      name: "smuggled protocol event",
      value: {
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
    },
  ];
  for (const candidate of refused) {
    assert.deepEqual(
      await adapter.acknowledge?.(candidate.value, state),
      { status: "ambiguous" },
      candidate.name,
    );
  }
});

test("claude cancellation is bound to the durable worker session on both seams", async () => {
  const { state: dispatchedState } = await dispatched();
  const intent = reduce(
    dispatchedState,
    event(dispatchedState, "cancel_intent"),
  );
  assert.equal(intent.ok, true);
  if (!intent.ok) return;
  const cancelling = intent.nextState;
  const cancel = intent.effects[0]!;
  assert.equal(cancel.kind, "cancel");
  // The manual seam names the durable session rather than re-deriving one,
  // and its recovery form is a read-only poll of that same session.
  const manual = createHarnessRecoveryEffectAdapter(trusted);
  const requested = await manual.execute(cancel, cancelling);
  assert.equal(requested.status, "tool_request");
  if (requested.status !== "tool_request") return;
  const request = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    requested.toolRequest,
  );
  assert.equal(request.ok, true);
  if (!request.ok || request.value === undefined) return;
  assert.equal(request.value.operation, "cancel");
  if (request.value.operation !== "cancel") return;
  assert.equal(request.value.session.sessionId, SESSION_ID);
  assert.equal(request.value.session.role, "worker");
  assert.equal(request.value.session.requestedModel, WORKHORSE_MODEL);
  assert.equal(request.value.session.returnedModel, WORKHORSE_MODEL);
  const polled = await manual.reconcile(cancel, cancelling);
  assert.equal(polled.status, "tool_request");
  if (polled.status === "tool_request") {
    const poll = validate<HarnessToolRequest>(
      HarnessToolRequestSchema,
      polled.toolRequest,
    );
    assert.equal(poll.value?.operation, "poll");
  }
  // Only a cancellation readback naming that exact session releases the unit.
  const acknowledgement = {
    effectId: cancel.effectId,
    kind: "cancelled" as const,
    schema: "sce.harness-tool-acknowledgement" as const,
    sessionId: SESSION_ID,
    version: HARNESS_VERSION,
  };
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      trusted,
      port({
        cancel: async () => ({ ...acknowledgement, sessionId: "other" }),
      }),
    ).execute(cancel, cancelling),
    { status: "ambiguous" },
  );
  const observed = await createHarnessRecoveryEffectAdapter(
    trusted,
    port({ cancel: async () => acknowledgement }),
  ).execute(cancel, cancelling);
  assert.equal(observed.status, "observed");
  if (observed.status !== "observed") return;
  assert.equal(observed.observation.type, "cancel_observed");
  const cancelled = reduceState(cancelling, observed.observation);
  assert.equal(cancelled.units["unit-1"]?.state, "cancelled");
  assert.deepEqual(cancelled.activeModifyingUnitIds, []);
  // The declared at-most-once profile cannot cancel through a port: it cannot
  // prove the controller tier, so a blocked unit stays blocked for a human
  // rather than being torn down on an unproven controller identity.
  const manualRun = await manuallyDispatched();
  const declaredIntent = reduce(
    manualRun.state,
    event(manualRun.state, "cancel_intent"),
  );
  assert.equal(declaredIntent.ok, true);
  if (!declaredIntent.ok) return;
  const declaredCancel = declaredIntent.effects[0]!;
  let cancels = 0;
  assert.deepEqual(
    await createHarnessRecoveryEffectAdapter(
      declared,
      port({
        cancel: async () => {
          cancels += 1;
          return { ...acknowledgement, effectId: declaredCancel.effectId };
        },
        capabilities: async () => declared.capabilities,
      }),
    ).execute(declaredCancel, declaredIntent.nextState),
    { status: "ambiguous" },
  );
  assert.equal(cancels, 0);
  // Its manual seam still names that exact durable session by hand.
  const manualCancel = await createHarnessRecoveryEffectAdapter(
    declared,
  ).execute(declaredCancel, declaredIntent.nextState);
  assert.equal(manualCancel.status, "tool_request");
  if (manualCancel.status !== "tool_request") return;
  const manualRequest = validate<HarnessToolRequest>(
    HarnessToolRequestSchema,
    manualCancel.toolRequest,
  );
  assert.equal(manualRequest.value?.operation, "cancel");
});
