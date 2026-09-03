import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  deriveChangedRowsCommitment,
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
  type RunStoreResult,
} from "../../src/fencing/index.js";
import {
  createRecoveryRunner as createRunner,
  recoveryEventId,
  type AuthoritativeRunReadback,
  type InitialControllerAcquire,
  type RecoveryEffectAdapter,
  type RecoveryFaultPoint,
} from "../../src/commands/recovery.js";
import { makeSlotTransitionIntent } from "../../src/adapters/beads-embedded/index.js";
import {
  deriveIdempotencyKey,
  rehydrateEffect,
  reduce,
} from "../../src/protocol/reducer.js";
import type { ProtocolEffect } from "../../src/protocol/reducer.js";
import type { RepositoryRun } from "../../src/protocol/schemas.js";
import { event, HASH, run, transition } from "../protocol/fixtures.js";

const holder = "run-1/incarnation-1";
const scope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
} as const;

test("recovery and ambiguity event IDs stay distinct and bounded", () => {
  assert.equal(recoveryEventId("effect-1"), "recover-effect-1");
  assert.equal(
    recoveryEventId("ambiguous-effect-1"),
    "recover-ambiguous-effect-1",
  );
  const maximumEffectId = "x".repeat(192);
  const observed = recoveryEventId(maximumEffectId);
  const ambiguous = recoveryEventId(`ambiguous-${maximumEffectId}`);
  assert.equal(observed.length, 72);
  assert.equal(ambiguous.length, 72);
  assert.notEqual(observed, ambiguous);
});

function slot(status: "available" | "acquired", slotHolder?: string) {
  const value = {
    actor: status === "available" ? holder : (slotHolder ?? holder),
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: "gt:slot" as const,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

function initialRun(): RepositoryRun {
  const state = run([]);
  return {
    ...state,
    state: "initializing",
    controller: { ...state.controller, state: "unacquired" },
  };
}

function acquireEvent(state: RepositoryRun) {
  const transition = makeSlotTransitionIntent(
    "acquire",
    holder,
    scope,
    { head: "a".repeat(40), slot: slot("available") },
    slot("acquired", holder),
  );
  return {
    eventId: "acquire-1",
    expectedRevision: state.revision,
    idempotencyKey: deriveIdempotencyKey(
      state,
      state.revision,
      null,
      "controller_acquire",
    ),
    slotTransition: transition,
    type: "controller_acquire_intent" as const,
  };
}

function readback(runState: RepositoryRun): AuthoritativeRunReadback {
  const root = makeRootProjection(runState);
  return {
    children: Object.keys(runState.units)
      .sort()
      .map((id) => makeChildProjection(root, id)!),
    root,
  };
}

class MemoryStore {
  public current: AuthoritativeRunReadback | undefined;
  public lastBatch: MutationBatch | undefined;
  public malformedCreateResult = false;
  public createCalls = 0;
  public casCalls = 0;

  async load() {
    return this.current === undefined
      ? ({ status: "absent" } as const)
      : ({ status: "observed", value: this.current } as const);
  }

  async createControllerAcquireIntent(input: InitialControllerAcquire) {
    this.createCalls += 1;
    if (this.current !== undefined) return { status: "stale" } as const;
    this.current = { children: input.next.children, root: input.next.root };
    return this.malformedCreateResult
      ? {
          ...applied(this.current),
          checkpoint: {
            ...this.current.root.checkpoint,
            aggregateRevision:
              this.current.root.checkpoint.aggregateRevision + 1,
          },
        }
      : applied(this.current);
  }

  async persistControllerAcquireIntent(batch: MutationBatch) {
    return this.compareAndSet(batch);
  }

  async compareAndSet(batch: MutationBatch): Promise<RunStoreResult> {
    this.casCalls += 1;
    this.lastBatch = batch;
    if (
      this.current === undefined ||
      this.current.root.aggregateRevision !== batch.expectedAggregateRevision ||
      this.current.root.aggregateCommitment !==
        batch.expectedAggregateCommitment
    )
      return { status: "stale" };
    this.current = { children: batch.next.children, root: batch.next.root };
    return applied(this.current);
  }
}

function softwareReleaseIntentRun(): RepositoryRun {
  let state = run();
  const step = (
    type: import("../../src/protocol/schemas.js").ProtocolEvent["type"],
    fields: Record<string, unknown> = {},
  ) => {
    state = transition(state, event(state, type, fields), reduce);
  };
  const observe = (
    type: import("../../src/protocol/schemas.js").ProtocolEvent["type"],
    kind: string,
    fields: Record<string, unknown> = {},
  ) =>
    step(type, {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: kind,
      observationHash: HASH,
      ...fields,
    });
  const oidA = "a".repeat(40);
  const oidB = "b".repeat(40);
  const oidC = "c".repeat(40);
  step("reservation_intent", {
    reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
  });
  observe("reservation_observed", "reservation_acquire");
  step("branch_intent", { branchRef: "sce/unit-1" });
  observe("branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  step("worktree_intent", { worktreePath: "/tmp/sce-unit-1" });
  observe("worktree_observed", "worktree_create", {
    worktreePath: "/tmp/sce-unit-1",
  });
  step("dispatch_intent");
  observe("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  step("collect_intent");
  observe("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  step("candidate_intent");
  observe("candidate_observed", "candidate_collect", {
    headOid: oidB,
    treeOid: oidC,
  });
  step("verification_intent");
  observe("verification_observed", "verify", {
    baseOid: oidA,
    headOid: oidB,
    treeOid: oidC,
  });
  step("reviewer_dispatch_intent");
  observe("reviewer_observed", "review_dispatch", {
    promptHash: HASH,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    sessionId: "reviewer-1",
  });
  step("review_collect_intent");
  observe("review_collected", "review_collect", {
    judgment: {
      aggregateRevision: state.revision,
      baseOid: oidA,
      decision: "approve",
      findings: [],
      headOid: oidB,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-1",
      treeOid: oidC,
      unitId: "unit-1",
    },
  });
  step("publish_intent");
  observe("publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: oidB },
  });
  step("integrate_intent");
  observe("integrate_observed", "integrate", {
    baseOid: oidA,
    controllerFencingToken: "fence-1",
    headOid: oidB,
    integrationOid: oidC,
    treeOid: oidC,
  });
  step("reservation_release_intent");
  return state;
}

function applied(value: AuthoritativeRunReadback) {
  return {
    affectedRowCount: value.children.length + 1,
    checkpoint: value.root.checkpoint,
    children: [...value.children],
    root: value.root,
    status: "applied" as const,
  };
}

test("initial acquisition CAS persists full slot authority before its one recoverable act", async () => {
  const state = initialRun();
  const event = acquireEvent(state);
  const { slotTransition: plannedTransition, ...unplannedEvent } = event;
  assert.ok(plannedTransition);
  const reduction = reduce(state, event);
  assert.equal(
    reduction.ok,
    true,
    reduction.ok ? undefined : `${reduction.code}: ${reduction.reason}`,
  );
  if (!reduction.ok) throw new Error("unreachable");
  const journal = reduction.nextState.effectJournal[0]!;
  assert.deepEqual(journal.slotTransition, event.slotTransition);
  assert.ok(rehydrateEffect(reduction.nextState, journal));

  const root = await mkdtemp(join(tmpdir(), "sce-recovery-"));
  const commonDir = join(root, ".git");
  await mkdir(commonDir, { mode: 0o700 });
  await chmod(commonDir, 0o700);
  const store = new MemoryStore();
  let executeCalls = 0;
  let planningCalls = 0;
  const adapter: RecoveryEffectAdapter = {
    async reconcile() {
      return { status: "absent" };
    },
    async execute(effect: ProtocolEffect, current: RepositoryRun) {
      executeCalls += 1;
      assert.equal(effect.kind, "controller_acquire");
      return {
        status: "observed",
        observation: {
          controllerFencingToken: current.controllerFencingToken,
          effectId: effect.effectId,
          effectKind: effect.kind,
          eventId: "acquire-observed",
          expectedRevision: current.revision,
          holder,
          observationHash: HASH,
          type: "controller_acquired",
        },
      };
    },
  };
  try {
    const runner = createRunner({
      adapter,
      acquireOperationLock: async () => ({
        status: "acquired",
        lock: { release: async () => ({ status: "released" as const }) },
      }),
      initialRun: state,
      nonce: "nonce-1",
      preOwnership: store,
      prepareControllerTransition: async ({ kind }) => {
        planningCalls += 1;
        assert.equal(kind, "acquire");
        return { status: "planned", transition: plannedTransition };
      },
      proveTopology: async () => ({
        commonDir: await realpath(commonDir),
        holder,
        scope,
      }),
      store,
    });
    const result = await runner(unplannedEvent);
    assert.equal(result.status, "reconciled");
    assert.equal(planningCalls, 1);
    assert.equal(executeCalls, 1);
    assert.equal(store.createCalls, 1);
    assert.equal(store.casCalls, 1);
    assert.equal(store.current?.root.run.controller.state, "acquired");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bootstrap quarantines a typed but non-exact persistence echo", async () => {
  const state = initialRun();
  const input = acquireEvent(state);
  const root = await mkdtemp(join(tmpdir(), "sce-recovery-bad-echo-"));
  const commonDir = join(root, ".git");
  await mkdir(commonDir, { mode: 0o700 });
  const store = new MemoryStore();
  store.malformedCreateResult = true;
  try {
    const runner = createRunner({
      adapter: {
        async execute() {
          throw new Error("must not act after non-exact persistence");
        },
        async reconcile() {
          throw new Error("must not reconcile after non-exact persistence");
        },
      },
      acquireOperationLock: async () => ({
        status: "acquired",
        lock: { release: async () => ({ status: "released" as const }) },
      }),
      initialRun: state,
      nonce: "nonce-bad-echo",
      preOwnership: store,
      proveTopology: async () => ({ commonDir, holder, scope }),
      store,
    });
    assert.deepEqual(await runner(input), { status: "quarantined" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a harness effect is refused before intent persistence", async () => {
  let state = run();
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "test", resource: "one" }],
    }),
    reduce,
  );
  state = transition(
    state,
    event(state, "reservation_observed", {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "reservation_acquire",
      observationHash: HASH,
    }),
    reduce,
  );
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  state = transition(
    state,
    event(state, "branch_observed", {
      branchRef: "sce/unit-1",
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "branch_create",
      observationHash: HASH,
    }),
    reduce,
  );
  state = transition(
    state,
    event(state, "worktree_intent", { worktreePath: "/tmp/sce-unit-1" }),
    reduce,
  );
  state = transition(
    state,
    event(state, "worktree_observed", {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "worktree_create",
      observationHash: HASH,
      worktreePath: "/tmp/sce-unit-1",
    }),
    reduce,
  );
  const store = new MemoryStore();
  store.current = readback(state);
  const root = await mkdtemp(join(tmpdir(), "sce-recovery-"));
  const commonDir = join(root, ".git");
  await mkdir(commonDir, { mode: 0o700 });
  await chmod(commonDir, 0o700);
  try {
    let adapterCalls = 0;
    const runner = createRunner({
      adapter: {
        async execute() {
          adapterCalls += 1;
          throw new Error("must not execute");
        },
        async reconcile() {
          adapterCalls += 1;
          throw new Error("must not reconcile");
        },
      },
      acquireOperationLock: async () => ({
        status: "acquired",
        lock: { release: async () => ({ status: "released" as const }) },
      }),
      nonce: "nonce-2",
      preOwnership: store,
      proveTopology: async () => ({
        commonDir: await realpath(commonDir),
        holder,
        scope,
      }),
      store,
    });
    const result = await runner({
      eventId: "dispatch-1",
      expectedRevision: state.revision,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        "unit-1",
        "dispatch",
      ),
      packet: (
        event(state, "dispatch_intent") as Extract<
          import("../../src/protocol/schemas.js").ProtocolEvent,
          { type: "dispatch_intent" }
        >
      ).packet,
      promptHash: HASH,
      requestedModel: "workhorse",
      type: "dispatch_intent",
      unitId: "unit-1",
    });
    assert.equal(result.status, "blocked");
    assert.equal(store.casCalls, 0);
    assert.equal(store.current.root.run.revision, state.revision);

    const pending = transition(
      state,
      event(state, "dispatch_intent", {
        promptHash: HASH,
        requestedModel: "workhorse",
      }),
      reduce,
    );
    store.current = readback(pending);
    const resumed = await runner();
    assert.equal(resumed.status, "blocked");
    assert.equal(adapterCalls, 0);
    assert.equal(store.casCalls, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("every coordinator crash boundary resumes without a duplicate Git act", async () => {
  const points: readonly RecoveryFaultPoint[] = [
    "before_intent_persist",
    "during_intent_persist",
    "after_intent_persist",
    "before_act",
    "during_act",
    "after_act",
    "before_observation_persist",
    "during_observation_persist",
    "after_observation_persist",
  ];
  for (const point of points) {
    let state = run();
    state = transition(
      state,
      event(state, "reservation_intent", {
        reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
      }),
      reduce,
    );
    state = transition(
      state,
      event(state, "reservation_observed", {
        effectId: state.effectJournal.at(-1)!.effectId,
        effectKind: "reservation_acquire",
        observationHash: HASH,
      }),
      reduce,
    );
    const branch = event(state, "branch_intent", {
      branchRef: "sce/unit-1",
    });
    const store = new MemoryStore();
    store.current = readback(state);
    let externalBranch = false;
    let executeCalls = 0;
    const adapter: RecoveryEffectAdapter = {
      async reconcile(effect) {
        if (effect.kind !== "branch_create") return { status: "ambiguous" };
        return externalBranch
          ? {
              status: "observed",
              observation: {
                branchRef: effect.params.branchRef,
                effectId: effect.effectId,
                effectKind: effect.kind,
                eventId: `observed-${point}`,
                expectedRevision: store.current!.root.run.revision,
                observationHash: HASH,
                type: "branch_observed",
                unitId: effect.unitId,
              },
            }
          : { status: "absent" };
      },
      async execute(effect) {
        assert.equal(effect.kind, "branch_create");
        executeCalls += 1;
        externalBranch = true;
        return {
          status: "observed",
          observation: {
            branchRef: "sce/unit-1",
            effectId: effect.effectId,
            effectKind: effect.kind,
            eventId: `executed-${point}`,
            expectedRevision: store.current!.root.run.revision,
            observationHash: HASH,
            type: "branch_observed",
            unitId: effect.unitId,
          },
        };
      },
    };
    let injected = false;
    const runner = (fault?: RecoveryFaultPoint) =>
      createRunner({
        adapter,
        acquireOperationLock: async () => ({
          status: "acquired",
          lock: {
            async release() {
              return { status: "released" as const };
            },
          },
        }),
        ...(fault === undefined
          ? {}
          : {
              fault: (seen: RecoveryFaultPoint) => {
                if (!injected && seen === fault) {
                  injected = true;
                  throw new Error(`crash:${fault}`);
                }
              },
            }),
        nonce: `nonce-${point}`,
        preOwnership: store,
        proveTopology: async () => ({ commonDir: "/repo/.git", holder, scope }),
        store,
      });

    if (point === "during_act" || point === "after_act")
      assert.deepEqual(await runner(point)(branch), { status: "ambiguous" });
    else
      await assert.rejects(runner(point)(branch), new RegExp(`crash:${point}`));
    const beforeIntent =
      point === "before_intent_persist" || point === "during_intent_persist";
    const resumed = await runner()(beforeIntent ? branch : undefined);
    assert.ok("run" in resumed, `${point}: ${JSON.stringify(resumed)}`);
    if (!("run" in resumed)) throw new Error("unreachable");
    assert.equal(resumed.run.units["unit-1"]?.state, "branch_observed", point);
    assert.equal(executeCalls, 1, point);
  }
});

test("reservation release persists a root-only closure batch and drains the authoritative unit set", async () => {
  const state = softwareReleaseIntentRun();
  const store = new MemoryStore();
  store.current = readback(state);
  let reconcileCalls = 0;
  const runner = createRunner({
    adapter: {
      canReconcile(effect) {
        return effect.kind === "reservation_release";
      },
      async reconcile(effect, current) {
        reconcileCalls += 1;
        assert.equal(effect.kind, "reservation_release");
        return {
          status: "observed" as const,
          observation: {
            effectId: effect.effectId,
            effectKind: effect.kind,
            eventId: "release-observed",
            expectedRevision: current.revision,
            observationHash: HASH,
            type: "reservation_released" as const,
            unitId: "unit-1",
          },
        };
      },
      async execute() {
        throw new Error("terminal release is reconcile-only");
      },
    },
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: { release: async () => ({ status: "released" as const }) },
    }),
    nonce: "nonce-root-only-closure",
    preOwnership: store,
    proveTopology: async () => ({ commonDir: "/repo/.git", holder, scope }),
    store,
  });
  const result = await runner();
  assert.ok("run" in result, JSON.stringify(result));
  if (!("run" in result)) return;
  assert.equal(reconcileCalls, 1);
  assert.deepEqual(Object.keys(result.run.units), []);
  assert.deepEqual(result.run.wave.unitIds, []);
  const closureEvidence = JSON.parse(
    inflateRawSync(
      Buffer.from(result.run.closedUnitEvidence, "base64"),
    ).toString("utf8"),
  ) as { u?: Record<string, unknown> };
  assert.ok(closureEvidence.u?.["unit-1"]);
  assert.deepEqual(store.lastBatch?.changedRows, []);
  assert.deepEqual(store.lastBatch?.expectedChildren, []);
  assert.deepEqual(store.lastBatch?.next.children, []);
  assert.deepEqual(store.lastBatch?.next.root.childRows, []);
  assert.equal(
    store.lastBatch?.checkpoint.changedRowsCommitment,
    deriveChangedRowsCommitment([]),
  );
});

test("generic recovery rejects direct provenance carry intent and observation injection", async () => {
  const state = run([]);
  const store = new MemoryStore();
  store.current = readback(state);
  let adapterCalls = 0;
  const runner = createRunner({
    adapter: {
      async execute() {
        adapterCalls += 1;
        return { status: "ambiguous" as const };
      },
      async reconcile() {
        adapterCalls += 1;
        return { status: "ambiguous" as const };
      },
    },
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: { release: async () => ({ status: "released" as const }) },
    }),
    nonce: "nonce-carry-injection",
    preOwnership: store,
    prepareProvenanceCarryClaim: async () => {
      throw new Error("direct injection must not reach dedicated planning");
    },
    proveTopology: async () => ({ commonDir: "/repo/.git", holder, scope }),
    store,
  });
  const intent = {
    claimToken: "carry-key",
    eventId: "carry-intent",
    expectedRevision: state.revision,
    exportId: `sce:carry:${HASH}`,
    idempotencyKey: "carry-key",
    predecessorFinalRevision: 1,
    predecessorJournalCheckpointCommitment: HASH,
    predecessorRootAggregateCommitment: HASH,
    predecessorRootBeadId: "sce-predecessor",
    predecessorRunId: "run-predecessor",
    predecessorWaveId: "wave-predecessor",
    snapshotCommitment: HASH,
    type: "provenance_carry_claim_intent" as const,
  };
  assert.deepEqual(await runner(intent), { status: "blocked" });
  assert.deepEqual(
    await runner({
      effectId: "carry-effect",
      effectKind: "provenance_carry_claim",
      eventId: "carry-observed",
      expectedRevision: state.revision,
      observationHash: HASH,
      result: {
        evidenceDigest: HASH,
        predecessorRootBeadId: "sce-predecessor",
        reason: "not_found",
        status: "predecessor_refused",
      },
      type: "provenance_carry_claim_observed",
    }),
    { status: "blocked" },
  );
  assert.equal(adapterCalls, 0);
});
