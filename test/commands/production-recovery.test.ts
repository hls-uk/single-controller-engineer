import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionRecoveryEffectAdapter,
  createProductionRecoveryRunner,
  planProvenanceCarryFromProjection,
  type ControllerTransitionRecoveryPort,
  type ProvenanceCarryClaimPlan,
  type ProvenanceCarryClaimRecoveryPort,
} from "../../src/commands/production-recovery.js";
import { createProductionRecoveryCommandRunner } from "../../src/commands/index.js";
import type { GitRepository, GitRunner } from "../../src/adapters/git/index.js";
import { makeSlotTransitionIntent } from "../../src/adapters/beads-embedded/index.js";
import {
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
} from "../../src/fencing/index.js";
import {
  deriveProvenanceCarryClaimKey,
  deriveCandidateDiffHash,
  deriveIdempotencyKey,
  deriveMaterialisationTargetId,
  deriveProvenanceCarryExportId,
  projectionInputIsValid,
  provenanceCarryAncestorDigest,
  provenanceCarryLineageCommitment,
  provenanceCarrySnapshotCommitment,
  rehydrateEffect,
  reduce,
  runInvariantErrors,
  type ProtocolEffect,
} from "../../src/protocol/reducer.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import {
  compactProvenanceInput,
  frozenTargetEvidence,
} from "../../src/protocol/projection.js";
import { sha256 } from "../../src/protocol/evidence.js";
import type {
  GateDestinationProbe,
  GateTargetState,
  HydratedProvenanceInput,
  KnowledgeContract,
  ProtocolEvent,
  ProvenanceCarry,
  ProvenanceInput,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import { ProtocolEventSchema, validate } from "../../src/protocol/schemas.js";
import { runCli } from "../../src/cli.js";
import {
  event,
  HASH,
  OID_A,
  OID_B,
  OID_C,
  run,
  transition,
} from "../protocol/fixtures.js";

const repository: GitRepository = {
  commonDir: "/repo/.git",
  cwd: "/repo",
  identity: "local:/repo/.git",
  objectFormat: "sha1",
  remoteUrls: [],
};
const remoteRepositoryIdentity = "provider:fixture";
const predecessorRootBeadId = "sce-predecessor-root";
const carryRemoteRepository: GitRepository = {
  ...repository,
  identity: remoteRepositoryIdentity,
  remoteUrls: ["https://example.invalid/repo.git"],
};

test("provenance carry export id has a stable cross-module golden vector", () => {
  assert.equal(
    deriveProvenanceCarryExportId({
      finalRevision: 17,
      integrationBranch: "main",
      predecessorRootAggregateCommitment: "a".repeat(64),
      predecessorRunId: "run-prev",
      predecessorWaveId: "wave-9",
      repositoryIdentity: "repo:example",
      snapshotCommitment: "b".repeat(64),
      storeIdentity: "store:example",
    }),
    "sce:carry:5b6113eaeb90b2f1e0186391c22968eb6a94282f3e1a4c4d7157d43236288f7a",
  );
});

function localRun(): RepositoryRun {
  return { ...run(), repositoryIdentity: repository.identity };
}

function branchEffect(): ProtocolEffect {
  return {
    effectId: "effect-1",
    idempotencyKey: "key-1",
    kind: "branch_create",
    params: { baseOid: OID_A, branchRef: "sce/unit-1" },
    paramsHash: HASH,
    schemaVersion: 1 as const,
    unitId: "unit-1",
  } as ProtocolEffect;
}

function localIntegrationEffect(): ProtocolEffect {
  return {
    effectId: "effect-integrate",
    idempotencyKey: "key-integrate",
    kind: "integrate",
    params: {
      candidate: { baseOid: OID_A, headOid: OID_B, treeOid: OID_A },
      completionBoundary: "local-integration",
      controllerFencingToken: "fence-1",
      integrationBranch: "main",
      integrationProfile: "local-ff",
    },
    paramsHash: HASH,
    schemaVersion: 1,
    unitId: "unit-1",
  } as ProtocolEffect;
}

function remoteIntegrationEffect(): ProtocolEffect {
  return {
    ...localIntegrationEffect(),
    params: {
      ...localIntegrationEffect().params,
      completionBoundary: "remote-integration",
      integrationProfile: "remote-ff",
    },
  } as ProtocolEffect;
}

function integrationIntentRun(
  integrationProfile: "local-ff" | "remote-ff",
  stopAt: "approved" | "integrate" = "integrate",
): RepositoryRun {
  let state: RepositoryRun = {
    ...localRun(),
    completionBoundary:
      integrationProfile === "local-ff"
        ? "local-integration"
        : "remote-integration",
    integrationProfile,
    ...(integrationProfile === "remote-ff"
      ? { repositoryIdentity: remoteRepositoryIdentity }
      : {}),
  };
  const observe = (
    type: Parameters<typeof event>[1],
    kind: string,
    fields: Record<string, unknown> = {},
  ) => {
    state = transition(
      state,
      event(state, type, {
        effectId: state.effectJournal.at(-1)!.effectId,
        effectKind: kind,
        observationHash: HASH,
        ...fields,
      }),
      reduce,
    );
  };
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
    }),
    reduce,
  );
  observe("reservation_observed", "reservation_acquire");
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  observe("branch_observed", "branch_create", { branchRef: "sce/unit-1" });
  state = transition(
    state,
    event(state, "worktree_intent", { worktreePath: "/tmp/unit-1" }),
    reduce,
  );
  observe("worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = transition(state, event(state, "dispatch_intent"), reduce);
  observe("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  state = transition(state, event(state, "collect_intent"), reduce);
  observe("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  state = transition(state, event(state, "candidate_intent"), reduce);
  observe("candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_A,
  });
  state = transition(state, event(state, "verification_intent"), reduce);
  observe("verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_A,
  });
  state = transition(state, event(state, "reviewer_dispatch_intent"), reduce);
  observe("reviewer_observed", "review_dispatch", {
    promptHash: HASH,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    sessionId: "reviewer-1",
  });
  state = transition(state, event(state, "review_collect_intent"), reduce);
  observe("review_collected", "review_collect", {
    judgment: {
      aggregateRevision: state.revision,
      baseOid: OID_A,
      decision: "approve",
      findings: [],
      headOid: OID_B,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved exact pair",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-1",
      treeOid: OID_A,
      unitId: "unit-1",
      requestedModel: "frontier",
    },
  });
  if (stopAt === "approved") return state;
  if (integrationProfile === "remote-ff") {
    state = transition(state, event(state, "publish_intent"), reduce);
    observe("publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
  }
  return transition(state, event(state, "integrate_intent"), reduce);
}

function legacyPublishBlocked(): RepositoryRun {
  let state = integrationIntentRun("remote-ff", "approved");
  state = {
    ...state,
    units: {
      ...state.units,
      "unit-1": {
        ...state.units["unit-1"]!,
        branchRef: "refs/heads/codex/unit-1",
      },
    },
  };
  state = transition(state, event(state, "publish_intent"), reduce);
  const publish = state.effectJournal.at(-1)!;
  return transition(
    state,
    event(state, "effect_ambiguous", {
      effectId: publish.effectId,
      effectKind: "publish",
      observationHash: HASH,
    }),
    reduce,
  );
}

function publicationAcknowledgement(state: RepositoryRun) {
  const entry = state.effectJournal.at(-1)!;
  const unit = state.units["unit-1"]!;
  return {
    aggregateRevision: state.revision,
    attestation: "operator_confirmed_exact_provider_rejection" as const,
    baseOid: unit.baseOid,
    controllerFencingToken: state.controllerFencingToken,
    effectId: entry.effectId,
    headOid: unit.candidateHead!,
    holder: state.controller.holder,
    incarnationId: state.controller.incarnationId,
    kind: "operator_attested_provider_rejection" as const,
    legacyBranchRef: unit.branchRef!,
    paramsHash: entry.paramsHash,
    replacementBranch: "codex/unit-1",
    runId: state.controller.runId,
    schema: "sce.publication-recovery-acknowledgement" as const,
    treeOid: unit.candidateTree!,
    unitId: unit.id,
    version: 1 as const,
  };
}

function carryRun(
  profile: "local-ff" | "remote-ff" = "local-ff",
): RepositoryRun {
  return {
    ...run([]),
    completionBoundary:
      profile === "local-ff" ? "local-integration" : "remote-integration",
    integrationProfile: profile,
    repositoryIdentity:
      profile === "local-ff" ? repository.identity : remoteRepositoryIdentity,
  };
}

function carryProjectionInput(): ProvenanceInput {
  let state = integrationIntentRun("local-ff");
  const integrate = state.effectJournal.at(-1)!;
  state = transition(
    state,
    event(state, "integrate_observed", {
      baseOid: OID_A,
      controllerFencingToken: "fence-1",
      effectId: integrate.effectId,
      effectKind: "integrate",
      headOid: OID_B,
      integrationOid: OID_B,
      observationHash: HASH,
      treeOid: OID_A,
    }),
    reduce,
  );
  state = transition(state, event(state, "reservation_release_intent"), reduce);
  const release = state.effectJournal.at(-1)!;
  state = transition(
    state,
    event(state, "reservation_released", {
      effectId: release.effectId,
      effectKind: "reservation_release",
      observationHash: HASH,
    }),
    reduce,
  );
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(state.units["unit-1"], undefined);
  const input: ProvenanceInput = {
    closedUnitEvidence: state.closedUnitEvidence,
    closureEvidenceCommitment: state.closedUnitEvidenceCommitment,
    destinationProbeEvidence: [],
    targetEvidence: [],
    unitIds: ["unit-1"],
  };
  assert.equal(projectionInputIsValid(input), true);
  return input;
}

function carryPlan(run: RepositoryRun): Readonly<{
  plan: ProvenanceCarryClaimPlan;
  projectionInputSnapshot: ProvenanceInput;
}> {
  const projectionInputSnapshot = carryProjectionInput();
  const snapshotCommitment = provenanceCarrySnapshotCommitment(
    projectionInputSnapshot,
  );
  const predecessorRootAggregateCommitment = "2".repeat(64);
  const predecessorRunId = "run-predecessor";
  const predecessorWaveId = "wave-predecessor";
  return {
    plan: {
      exportId: deriveProvenanceCarryExportId({
        finalRevision: 17,
        integrationBranch: run.integrationBranch,
        predecessorRootAggregateCommitment,
        predecessorRunId,
        predecessorWaveId,
        repositoryIdentity: run.repositoryIdentity,
        snapshotCommitment,
        storeIdentity: run.storeIdentity,
      }),
      predecessorFinalRevision: 17,
      predecessorJournalCheckpointCommitment: "3".repeat(64),
      predecessorRootAggregateCommitment,
      predecessorRunId,
      predecessorWaveId,
      snapshotCommitment,
    },
    projectionInputSnapshot,
  };
}

function importedCarry(
  run: RepositoryRun,
  plan: ProvenanceCarryClaimPlan,
  projectionInputSnapshot: ProvenanceInput,
): ProvenanceCarry {
  const claimToken = deriveProvenanceCarryClaimKey(
    run.controller.runId,
    plan.exportId,
    predecessorRootBeadId,
  );
  const claimRecord = {
    claimRevision: 1,
    claimantRunId: run.controller.runId,
    claimToken,
    exportId: plan.exportId,
    predecessorRootBeadId,
    predecessorRunId: plan.predecessorRunId,
    predecessorWaveId: plan.predecessorWaveId,
    schema: "sce.provenance-carry-claim",
    snapshotCommitment: plan.snapshotCommitment,
    version: 1,
  } as const;
  const predecessorAncestor = provenanceCarryAncestorDigest(
    predecessorRootBeadId,
    plan.predecessorRunId,
  );
  return {
    claimRecordDigest: sha256(
      canonicalJson({
        claimRecord,
        domain: "sce.provenance-carry-claim-record.v1",
      }),
    ),
    claimRevision: 1,
    exportId: plan.exportId,
    integrationOid: OID_A,
    lineageAncestorDigests: [predecessorAncestor],
    lineageCommitment: provenanceCarryLineageCommitment([predecessorAncestor]),
    predecessorFinalRevision: plan.predecessorFinalRevision,
    predecessorJournalCheckpointCommitment:
      plan.predecessorJournalCheckpointCommitment,
    predecessorRootAggregateCommitment: plan.predecessorRootAggregateCommitment,
    predecessorRootBeadId,
    predecessorRunId: plan.predecessorRunId,
    predecessorWaveId: plan.predecessorWaveId,
    projectionInputSnapshot,
    snapshotCommitment: plan.snapshotCommitment,
  };
}

function carryStore(initial: RepositoryRun, order: string[] = []) {
  let root = makeRootProjection(initial);
  let children = Object.keys(initial.units).map((unitId) =>
    makeChildProjection(root, unitId)!,
  );
  let writes = 0;
  const compareAndSet = async (batch: MutationBatch) => {
    writes += 1;
    order.push(
      `persist:${batch.next.root.run.effectJournal.at(-1)?.status ?? "none"}`,
    );
    const affectedChildren = [...batch.next.children];
    root = batch.next.root;
    children = root.childRows.map((row) => {
      const affected = affectedChildren.find(
        (child) => child.unitId === row.unitId,
      );
      const retained = children.find((child) => child.unitId === row.unitId);
      assert.ok(affected ?? retained);
      return (affected ?? retained)!;
    });
    return {
      affectedRowCount: batch.changedRows.length + 1,
      checkpoint: batch.checkpoint,
      children: affectedChildren,
      root,
      status: "applied" as const,
    };
  };
  return {
    get root() {
      return root;
    },
    get writes() {
      return writes;
    },
    port: {
      compareAndSet,
      async load() {
        order.push("load");
        return { status: "observed" as const, value: { children, root } };
      },
      persistControllerAcquireIntent: compareAndSet,
    },
  };
}

test("attested publication-ref recovery probes both remote targets without a push", async () => {
  type RemoteCase =
    "old-present" | "replacement-foreign" | "unreadable" | "absent";
  const recover = (initial: RepositoryRun, remoteCase: RemoteCase) => {
    const store = carryStore(initial);
    const calls: string[] = [];
    const gitRunner: GitRunner = async ({ argv }) => {
      calls.push(argv.join(" "));
      if (argv[0] === "rev-parse")
        return {
          exitCode: 0,
          signal: null,
          stdout: argv[1] === "--git-common-dir" ? ".git\n" : "sha1\n",
        };
      if (argv[0] === "config")
        return {
          exitCode: 0,
          signal: null,
          stdout: "remote.origin.url\nhttps://example.invalid/repo.git\u0000",
        };
      if (argv[0] === "remote")
        return {
          exitCode: 0,
          signal: null,
          stdout: "https://example.invalid/repo.git\n",
        };
      if (argv[0] !== "ls-remote")
        return { exitCode: 1, signal: null, stdout: "" };
      const ref = argv.at(-1);
      if (remoteCase === "unreadable")
        return { exitCode: 1, signal: null, stdout: "" };
      if (
        remoteCase === "old-present" &&
        ref === "refs/heads/refs/heads/codex/unit-1"
      )
        return {
          exitCode: 0,
          signal: null,
          stdout: `${OID_B}\t${ref}\n`,
        };
      if (
        remoteCase === "replacement-foreign" &&
        ref === "refs/heads/codex/unit-1"
      )
        return {
          exitCode: 0,
          signal: null,
          stdout: `${OID_C}\t${ref}\n`,
        };
      return { exitCode: 2, signal: null, stdout: "" };
    };
    const runner = createProductionRecoveryRunner({
      acquireOperationLock: async () => acquiredLock(),
      git: {
        remote: "origin",
        repository: carryRemoteRepository,
        runner: gitRunner,
      },
      nonce: `publication-${remoteCase}`,
      preOwnership: store.port,
      proveTopology: async () => ({
        commonDir: carryRemoteRepository.commonDir,
        holder: initial.controller.holder,
        scope: {
          beadsStoreIdentity: initial.storeIdentity,
          gitRepositoryIdentity: carryRemoteRepository.identity,
          integrationBranch: initial.integrationBranch,
        },
      }),
      store: store.port,
    });
    return { calls, runner, store };
  };

  const initial = legacyPublishBlocked();
  const acknowledgement = publicationAcknowledgement(initial);
  const original = initial.effectJournal.at(-1)!;
  const success = recover(initial, "absent");
  const outcome = await success.runner({
    publicationRecovery: acknowledgement,
  });
  assert.equal(outcome.status, "applied", success.calls.join("\n"));
  assert.equal(
    success.calls.some((call) => call.startsWith("push ")),
    false,
  );
  assert.equal(
    success.calls.includes(
      "ls-remote --refs --exit-code origin refs/heads/refs/heads/codex/unit-1",
    ),
    true,
  );
  assert.equal(
    success.calls.includes(
      "ls-remote --refs --exit-code origin refs/heads/codex/unit-1",
    ),
    true,
  );
  assert.equal(success.store.writes, 1);
  const recovered = success.store.root.run;
  const repairedUnit = recovered.units["unit-1"]!;
  assert.equal(recovered.state, "active");
  assert.equal(repairedUnit.state, "approved");
  assert.equal(repairedUnit.branchRef, acknowledgement.legacyBranchRef);
  assert.equal(
    repairedUnit.worktreePath,
    initial.units["unit-1"]?.worktreePath,
  );
  assert.equal(
    repairedUnit.publicationBranchRef,
    acknowledgement.replacementBranch,
  );
  assert.equal(
    repairedUnit.candidateHead,
    initial.units["unit-1"]?.candidateHead,
  );
  assert.equal(
    repairedUnit.reviewHeadOid,
    initial.units["unit-1"]?.reviewHeadOid,
  );
  assert.equal(recovered.effectJournal.at(-1)?.paramsHash, original.paramsHash);
  assert.equal(
    recovered.effectJournal.at(-1)?.intentCommitment,
    original.intentCommitment,
  );
  assert.equal(
    rehydrateEffect(recovered, recovered.effectJournal.at(-1)!),
    undefined,
  );
  const restarted = await success.runner();
  assert.equal(restarted.status, "idle");
  const next = transition(
    recovered,
    event(recovered, "publish_intent"),
    reduce,
  );
  const nextEffect = rehydrateEffect(next, next.effectJournal.at(-1)!);
  assert.equal(nextEffect?.kind, "publish");
  if (nextEffect?.kind === "publish")
    assert.equal(
      nextEffect.params.branchRef,
      acknowledgement.replacementBranch,
    );

  for (const remoteCase of [
    "old-present",
    "replacement-foreign",
    "unreadable",
  ] as const) {
    const refusedState = legacyPublishBlocked();
    const refused = recover(refusedState, remoteCase);
    assert.equal(
      (
        await refused.runner({
          publicationRecovery: publicationAcknowledgement(refusedState),
        })
      ).status,
      "blocked",
    );
    assert.equal(refused.store.writes, 0);
    assert.equal(
      refused.calls.some((call) => call.startsWith("push ")),
      false,
    );
  }

  const staleState = legacyPublishBlocked();
  const stale = recover(staleState, "absent");
  assert.equal(
    (
      await stale.runner({
        publicationRecovery: {
          ...publicationAcknowledgement(staleState),
          aggregateRevision: staleState.revision - 1,
        },
      })
    ).status,
    "blocked",
  );
  assert.equal(stale.store.writes, 0);

  const rawState = legacyPublishBlocked();
  const raw = recover(rawState, "absent");
  const rawAcknowledgement = publicationAcknowledgement(rawState);
  assert.equal(
    (
      await raw.runner({
        attestation: rawAcknowledgement,
        effectId: rawAcknowledgement.effectId,
        effectKind: "publish",
        eventId: "forged-publish-refusal",
        expectedRevision: rawState.revision,
        observationHash: HASH,
        type: "publish_refused",
        unitId: "unit-1",
      })
    ).status,
    "blocked",
  );
  assert.equal(raw.store.writes, 0);
  assert.equal(
    raw.calls.some((call) => call.startsWith("ls-remote ")),
    false,
  );
});

function carryGitRunner(
  profile: "local-ff" | "remote-ff",
  head: string,
  calls: string[],
  remoteRef = "main",
): GitRunner {
  return async ({ argv }) => {
    const call = argv.join(" ");
    calls.push(call);
    if (call === "rev-parse --git-common-dir")
      return { exitCode: 0, signal: null, stdout: ".git\n" };
    if (call === "rev-parse --show-object-format")
      return { exitCode: 0, signal: null, stdout: "sha1\n" };
    if (argv[0] === "config")
      return profile === "local-ff"
        ? { exitCode: 1, signal: null, stdout: "" }
        : {
            exitCode: 0,
            signal: null,
            stdout: "remote.origin.url\nhttps://example.invalid/repo.git\u0000",
          };
    if (argv[0] === "for-each-ref")
      return { exitCode: 0, signal: null, stdout: `${head}\n` };
    if (argv[0] === "ls-remote")
      return {
        exitCode: 0,
        signal: null,
        stdout: `${head}\trefs/heads/${remoteRef}\n`,
      };
    return { exitCode: 1, signal: null, stdout: "" };
  };
}

function acquiredLock() {
  return {
    status: "acquired" as const,
    lock: { release: async () => ({ status: "released" as const }) },
  };
}

function controllerSlotTransition(
  state: RepositoryRun,
  kind: "acquire" | "release",
) {
  const scope = {
    beadsStoreIdentity: state.storeIdentity,
    gitRepositoryIdentity: state.repositoryIdentity,
    integrationBranch: state.integrationBranch,
  };
  const slot = (status: "acquired" | "available") => {
    const value = {
      actor: state.controller.holder,
      ...(status === "acquired" ? { holder: state.controller.holder } : {}),
      label: "gt:slot" as const,
      scope,
      scopeCommitment: deriveScopeCommitment(scope),
      slotId: "sce-merge-slot",
      status,
      title: "Merge Slot" as const,
      version: 1 as const,
    };
    return { ...value, readbackHash: deriveSlotReadbackHash(value) };
  };
  return makeSlotTransitionIntent(
    kind,
    state.controller.holder,
    scope,
    {
      head: OID_A,
      slot: slot(kind === "acquire" ? "available" : "acquired"),
    },
    slot(kind === "acquire" ? "acquired" : "available"),
  );
}

function configuredKnowledgeContract(
  humanDriver = "knowledge-owner",
): KnowledgeContract {
  return {
    aliases: [],
    audience: "knowledge-audience",
    combinedVerificationCommands: [["npm", "test"]],
    domainScope: "knowledge",
    gateTargets: [],
    humanDriver,
    projectId: "knowledge-project",
    provenance: {
      eventsDirectory: "knowledge/events",
      generatedDirectory: "knowledge/generated",
      recordFormatVersion: 1,
      reproducibilityCommand: ["npm", "run", "reproduce"],
      rollupGeneratorCommand: ["npm", "run", "rollup"],
    },
    provenanceWorktreeRoot: "/tmp/sce-provenance",
  };
}

async function configuredCarryRefusalStore(
  state: RepositoryRun,
  knowledgeContract: KnowledgeContract,
  nonce: string,
) {
  const planned = carryPlan(state);
  const store = carryStore(state);
  const refused = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: {
      async prepareProvenanceCarryClaim() {
        return { plan: planned.plan, status: "planned" };
      },
      async executeProvenanceCarryClaim() {
        return {
          result: {
            evidenceDigest: HASH,
            predecessorRootBeadId,
            reason: "not_released",
            status: "predecessor_refused",
          },
          status: "observed",
        };
      },
      async reconcileProvenanceCarryClaim() {
        return { status: "absent" };
      },
    },
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    knowledgeContract,
    nonce,
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  });
  assert.equal(
    (
      await refused({
        provenanceCarryClaim: { predecessorRootBeadId },
      })
    ).status,
    "applied",
  );
  return store;
}

function carryPredecessorProjection(
  lineageAncestorDigests: readonly string[],
  projectionInputSnapshot: ProvenanceInput = carryProjectionInput(),
  targets: readonly GateTargetState[] = [],
  destinationProbes: readonly GateDestinationProbe[] = [],
) {
  const base = carryRun("local-ff");
  const predecessor: RepositoryRun = {
    ...base,
    closedUnitEvidence: projectionInputSnapshot.closedUnitEvidence,
    closedUnitEvidenceCommitment:
      projectionInputSnapshot.closureEvidenceCommitment,
    controller: {
      ...base.controller,
      holder: "run-predecessor/incarnation-1",
      runId: "run-predecessor",
      state: "released",
    },
    gate: {
      aggregateVerifyPromise: {
        disposition: "deferral_cascade",
        followUpBeadId: "follow-up-1",
        status: "voided",
      },
      currentIntegrationOid: OID_A,
      destinationProbes: [...destinationProbes],
      lineageAncestorDigests: [...lineageAncestorDigests],
      lineageCommitment: provenanceCarryLineageCommitment(
        lineageAncestorDigests,
      ),
      originalUnitIds: ["unit-1"],
      provenance: {
        attemptIdempotencyKey: `sce:${"e".repeat(64)}`,
        attemptedCommitOid: OID_B,
        attemptedTreeOid: OID_A,
        baseOid: OID_A,
        disposition: "deferred_by_controller",
        followUpBeadId: "follow-up-1",
        gateEntryId: "predecessor-provenance",
        lastRefusal: {
          code: "provenance_reproducibility_failed",
          detailHash: HASH,
        },
        projectionInputSnapshot,
        status: "voided",
        worktreePath: "/tmp/sce-provenance/predecessor",
      },
      provenanceUnitAccounting: [],
      targetDefinitionCommitment: HASH,
      targetPromises: [],
      targets: [...targets],
      waveId: "wave-predecessor",
    },
    knowledgeContract: configuredKnowledgeContract(),
    state: "released",
    wave: { id: "wave-predecessor", unitIds: [] },
  };
  return makeRootProjection(predecessor);
}

/** One settled unit target and its probe, as a carried projection holds them. */
function carriedUnitEvidence(): Readonly<{
  probe: GateDestinationProbe;
  target: GateTargetState;
}> {
  const destination = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/file*.md",
  };
  const targetId = deriveMaterialisationTargetId(
    "unit",
    "unit-1",
    0,
    destination,
  );
  const source = {
    blobOid: OID_A,
    byteCount: 1,
    path: "docs/a.md",
    sha256: HASH,
  };
  const probeId = `sce:gate:${"d".repeat(64)}`;
  return {
    probe: {
      destinationAlias: destination.destinationAlias,
      destinationSubpath: destination.destinationSubpath,
      gateEntryId: probeId,
      identity: {
        canonicalPath: "/repo/published",
        device: "1",
        inode: "2",
      },
      stage: "unit",
      status: "observed",
    },
    target: {
      definition: {
        originUnitId: "unit-1",
        scope: "unit",
        target: destination,
        targetId,
        targetOrdinal: 0,
      },
      materialisations: [
        {
          artifactName: "a.md",
          destinationProbeGateEntryId: probeId,
          gateEntryId: `sce:gate:${"b".repeat(64)}`,
          observation: {
            artifactByteCount: source.byteCount,
            artifactSha256: source.sha256,
            artifactStatus: "already_present",
            sidecarByteCount: 1,
            sidecarSha256: HASH,
            sidecarStatus: "already_present",
          },
          originUnitId: "unit-1",
          sidecarByteCount: 1,
          sidecarName: "a.md.sidecar",
          sidecarSha256: HASH,
          source,
          sourceOid: OID_A,
          status: "observed",
          target: destination,
          targetId,
          timestamp: "2026-09-03T12:00:00Z",
        },
      ],
      resolution: {
        capacities: {
          remainingAggregateEnvelopeByteCapacity: 1_024,
          remainingItemCapacity: 8,
          remainingProjectionSnapshotByteCapacity: 2_048,
          remainingSourceByteCapacity: 4_096,
        },
        gateEntryId: `sce:gate:${"c".repeat(64)}`,
        sourceOid: OID_A,
        sources: [source],
        status: "observed",
        targetId,
      },
      status: "observed",
    },
  };
}

test("direct carry planner carries a version-3 predecessor snapshot verbatim", () => {
  const current = carryRun("local-ff");
  const { probe, target } = carriedUnitEvidence();
  const base = carryProjectionInput();
  // The predecessor's view before version 3, and the same evidence as a
  // version-3 run freezes it.
  const priorView: HydratedProvenanceInput = {
    ...base,
    destinationProbeEvidence: [probe],
    targetEvidence: [target],
  };
  const retiredView: HydratedProvenanceInput = {
    ...priorView,
    targetEvidence: [frozenTargetEvidence(target)],
  };
  const retired = compactProvenanceInput(retiredView)!;
  assert.equal((retired.targetEvidence[0] as { version: number }).version, 3);
  for (const snapshot of [priorView, retired])
    assert.equal(projectionInputIsValid(snapshot), true);

  const plan = (snapshot: ProvenanceInput) =>
    planProvenanceCarryFromProjection(
      predecessorRootBeadId,
      "sce-current-root",
      current,
      carryPredecessorProjection([], snapshot, [target], [probe]),
    );
  const carried = plan(retired);
  assert.equal(
    carried.status,
    "planned",
    carried.status === "refused" ? carried.reason : undefined,
  );
  assert.ok(carried.status === "planned");
  // The snapshot crosses verbatim: no sibling record travels beside it and
  // nothing is re-attached, because the budget was retired at freeze time.
  assert.equal(
    canonicalJson(
      carried.value.carry.projectionInputSnapshot as unknown as JsonValue,
    ),
    canonicalJson(retired as unknown as JsonValue),
  );
  assert.equal(
    carried.value.plan.snapshotCommitment,
    provenanceCarrySnapshotCommitment(retired),
  );

  // A predecessor frozen before version 3 keeps its own view, commitment, and
  // export id; neither snapshot is migrated into the other.
  const prior = plan(priorView);
  assert.ok(prior.status === "planned");
  assert.equal(
    prior.value.plan.snapshotCommitment,
    provenanceCarrySnapshotCommitment(priorView),
  );
  assert.notEqual(
    prior.value.plan.snapshotCommitment,
    carried.value.plan.snapshotCommitment,
  );
  assert.notEqual(prior.value.plan.exportId, carried.value.plan.exportId);
});

test("direct carry planner refuses cyclic, duplicate, and over-limit lineage", () => {
  const current = carryRun("local-ff");
  const currentRootIssueId = "sce-current-root";
  const validPredecessor = carryPredecessorProjection([]);
  const valid = planProvenanceCarryFromProjection(
    predecessorRootBeadId,
    currentRootIssueId,
    current,
    validPredecessor,
  );
  assert.equal(
    valid.status,
    "planned",
    valid.status === "refused" ? valid.reason : undefined,
  );

  const cycle = planProvenanceCarryFromProjection(
    predecessorRootBeadId,
    currentRootIssueId,
    current,
    carryPredecessorProjection([
      provenanceCarryAncestorDigest(
        currentRootIssueId,
        current.controller.runId,
      ),
    ]),
  );
  assert.equal(cycle.status, "refused");
  assert.equal(
    cycle.status === "refused" ? cycle.reason : undefined,
    "lineage_invalid",
  );

  const duplicateAncestor = sha256("duplicate-ancestor");
  const duplicate = planProvenanceCarryFromProjection(
    predecessorRootBeadId,
    currentRootIssueId,
    current,
    carryPredecessorProjection([duplicateAncestor, duplicateAncestor]),
  );
  assert.equal(duplicate.status, "refused");
  assert.equal(
    duplicate.status === "refused" ? duplicate.reason : undefined,
    "lineage_invalid",
  );

  const overLimit = planProvenanceCarryFromProjection(
    predecessorRootBeadId,
    currentRootIssueId,
    current,
    carryPredecessorProjection(
      Array.from({ length: 128 }, (_, index) => sha256(`ancestor-${index}`)),
    ),
  );
  assert.equal(overLimit.status, "refused");
  assert.equal(
    overLimit.status === "refused" ? overLimit.reason : undefined,
    "lineage_limit_exceeded",
  );
});

test("direct carry planner prefers an advanced provenance base over the attempted base and current integration", () => {
  const current = carryRun("local-ff");
  const source = carryPredecessorProjection([]);
  const sourceGate = source.run.gate!;
  const sourceProvenance = sourceGate.provenance!;
  const predecessorRun: RepositoryRun = {
    ...source.run,
    gate: {
      ...sourceGate,
      currentIntegrationOid: OID_A,
      provenance: {
        ...sourceProvenance,
        advancedBaseOid: OID_C,
        baseOid: OID_B,
        lastRefusal: {
          code: "provenance_base_advanced",
          detailHash: sha256(
            canonicalJson({
              advancedBaseOid: OID_C,
              attemptedCommitOid: sourceProvenance.attemptedCommitOid!,
              attemptedTreeOid: sourceProvenance.attemptedTreeOid!,
              domain: "sce.provenance-base-advanced.v1",
            }),
          ),
        },
      },
    },
  };
  const result = planProvenanceCarryFromProjection(
    predecessorRootBeadId,
    "sce-current-root",
    current,
    makeRootProjection(predecessorRun),
  );
  assert.equal(
    result.status,
    "planned",
    result.status === "refused" ? result.reason : undefined,
  );
  if (result.status === "planned")
    assert.equal(result.value.carry.integrationOid, OID_C);
});

test("dedicated embedded carry persists one stable intent before CAS and binds the local head", async () => {
  const state = carryRun("local-ff");
  const planned = carryPlan(state);
  const claimKey = deriveProvenanceCarryClaimKey(
    state.controller.runId,
    planned.plan.exportId,
    predecessorRootBeadId,
  );
  const independentlyDerivedKey = `carry-claim:${sha256(
    canonicalJson({
      currentRunId: state.controller.runId,
      domain: "sce.provenance-carry-claim-key.v1",
      exportId: planned.plan.exportId,
      predecessorRootBeadId,
    }),
  )}`;
  assert.equal(claimKey, independentlyDerivedKey);
  const order: string[] = [];
  const gitCalls: string[] = [];
  const store = carryStore(state, order);
  let reconciles = 0;
  const carry: ProvenanceCarryClaimRecoveryPort = {
    async prepareProvenanceCarryClaim(predecessor, current) {
      order.push("embedded:prepare");
      assert.equal(predecessor, predecessorRootBeadId);
      assert.equal(current.revision, state.revision);
      return { plan: planned.plan, status: "planned" };
    },
    async executeProvenanceCarryClaim(effect, current) {
      order.push("embedded:execute");
      assert.equal(effect.idempotencyKey, claimKey);
      assert.equal(effect.params.claimToken, claimKey);
      assert.equal(effect.paramsHash, current.effectJournal[0]?.paramsHash);
      assert.equal(current.effectJournal[0]?.status, "intended");
      const carry = importedCarry(
        current,
        planned.plan,
        planned.projectionInputSnapshot,
      );
      return {
        result: {
          carry,
          status: "imported",
        },
        status: "observed",
      };
    },
    async reconcileProvenanceCarryClaim() {
      reconciles += 1;
      return { status: "absent" };
    },
  };
  const baseGitRunner = carryGitRunner("local-ff", OID_B, gitCalls);
  const recovery = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry,
    git: {
      repository,
      runner: async (request) => {
        order.push(`git:${request.argv[0]}`);
        return await baseGitRunner(request);
      },
    },
    nonce: "carry-local",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  });

  const result = await recovery({
    provenanceCarryClaim: { predecessorRootBeadId },
  });
  assert.equal(result.status, "applied");
  assert.equal(store.root.run.pendingProvenanceCarry?.integrationOid, OID_B);
  assert.equal(store.root.run.effectJournal[0]?.idempotencyKey, claimKey);
  assert.equal(
    store.root.run.effectJournal[0]?.effectId,
    `carry-claim-${claimKey.slice("carry-claim:".length)}:provenance_carry_claim`,
  );
  assert.equal(store.root.run.effectJournal[0]?.status, "observed");
  assert.equal(reconciles, 0);
  assert.deepEqual(gitCalls, [
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
    "for-each-ref --format=%(objectname) refs/heads/main",
  ]);
  assert.ok(
    order.indexOf("persist:intended") < order.indexOf("embedded:execute"),
  );
  assert.ok(
    order.indexOf("embedded:execute") < order.indexOf("git:for-each-ref"),
  );
  assert.ok(
    order.indexOf("git:for-each-ref") < order.indexOf("persist:observed"),
  );
});

test("dedicated server carry resumes a persisted intent by reconciliation and binds the remote head", async () => {
  const state = carryRun("remote-ff");
  const planned = carryPlan(state);
  const order: string[] = [];
  const store = carryStore(state, order);
  let executes = 0;
  const crashGitCalls: string[] = [];
  const firstCarry: ProvenanceCarryClaimRecoveryPort = {
    async prepareProvenanceCarryClaim() {
      order.push("server:prepare");
      return { plan: planned.plan, status: "planned" };
    },
    async executeProvenanceCarryClaim() {
      executes += 1;
      return { status: "ambiguous" };
    },
    async reconcileProvenanceCarryClaim() {
      return { status: "absent" };
    },
  };
  const common = {
    acquireOperationLock: async () => acquiredLock(),
    git: {
      remote: "origin",
      repository: carryRemoteRepository,
      runner: carryGitRunner("remote-ff", OID_B, crashGitCalls),
    },
    nonce: "carry-server-crash",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: carryRemoteRepository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: carryRemoteRepository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  };
  const crashed = createProductionRecoveryRunner({
    ...common,
    carry: firstCarry,
    fault: (point) => {
      if (point === "after_intent_persist")
        throw new Error("simulated post-intent crash");
    },
  });
  await assert.rejects(
    crashed({ provenanceCarryClaim: { predecessorRootBeadId } }),
    /simulated post-intent crash/u,
  );
  assert.equal(executes, 0);
  assert.equal(store.root.run.effectJournal[0]?.status, "intended");
  assert.deepEqual(crashGitCalls, [
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
  ]);

  let reconciles = 0;
  const gitCalls: string[] = [];
  const serverCarry: ProvenanceCarryClaimRecoveryPort = {
    async prepareProvenanceCarryClaim() {
      throw new Error("resume must not create a second plan");
    },
    async executeProvenanceCarryClaim() {
      executes += 1;
      return { status: "ambiguous" };
    },
    async reconcileProvenanceCarryClaim(effect, current) {
      reconciles += 1;
      assert.equal(
        effect.idempotencyKey,
        current.effectJournal[0]?.idempotencyKey,
      );
      return {
        result: {
          carry: importedCarry(
            current,
            planned.plan,
            planned.projectionInputSnapshot,
          ),
          status: "imported",
        },
        status: "observed",
      };
    },
  };
  const resumed = createProductionRecoveryRunner({
    ...common,
    carry: serverCarry,
    git: {
      remote: "origin",
      repository: carryRemoteRepository,
      runner: carryGitRunner("remote-ff", OID_B, gitCalls),
    },
  });
  const result = await resumed();
  assert.equal(result.status, "idle");
  assert.equal(reconciles, 1);
  assert.equal(executes, 0);
  assert.equal(store.root.run.pendingProvenanceCarry?.integrationOid, OID_B);
  assert.equal(store.root.run.effectJournal[0]?.status, "observed");
  assert.deepEqual(gitCalls, [
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
    "ls-remote --refs --exit-code origin refs/heads/main",
  ]);
});

test("dedicated carry keeps ref mismatch and ambiguous CAS unresolved", async () => {
  const remoteState = carryRun("remote-ff");
  const remotePlan = carryPlan(remoteState);
  const remoteStore = carryStore(remoteState);
  let remoteExecutes = 0;
  const remoteCarry: ProvenanceCarryClaimRecoveryPort = {
    async prepareProvenanceCarryClaim() {
      return { plan: remotePlan.plan, status: "planned" };
    },
    async executeProvenanceCarryClaim(_effect, current) {
      remoteExecutes += 1;
      return {
        result: {
          carry: importedCarry(
            current,
            remotePlan.plan,
            remotePlan.projectionInputSnapshot,
          ),
          status: "imported",
        },
        status: "observed",
      };
    },
    async reconcileProvenanceCarryClaim() {
      return { status: "absent" };
    },
  };
  const remoteGitCalls: string[] = [];
  const refMismatch = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: remoteCarry,
    git: {
      remote: "origin",
      repository: carryRemoteRepository,
      runner: carryGitRunner("remote-ff", OID_B, remoteGitCalls, "release"),
    },
    nonce: "carry-ref-mismatch",
    preOwnership: remoteStore.port,
    proveTopology: async () => ({
      commonDir: carryRemoteRepository.commonDir,
      holder: remoteState.controller.holder,
      scope: {
        beadsStoreIdentity: remoteState.storeIdentity,
        gitRepositoryIdentity: carryRemoteRepository.identity,
        integrationBranch: remoteState.integrationBranch,
      },
    }),
    store: remoteStore.port,
  });
  assert.deepEqual(
    await refMismatch({
      provenanceCarryClaim: { predecessorRootBeadId },
    }),
    { status: "unavailable" },
  );
  assert.equal(remoteExecutes, 1);
  assert.equal(remoteStore.writes, 1);
  assert.equal(remoteStore.root.run.effectJournal[0]?.status, "intended");
  assert.equal(remoteStore.root.run.pendingProvenanceCarry, undefined);
  assert.equal(
    remoteGitCalls.at(-1),
    "ls-remote --refs --exit-code origin refs/heads/main",
  );

  const localState = carryRun("local-ff");
  const localPlan = carryPlan(localState);
  const localStore = carryStore(localState);
  const localGitCalls: string[] = [];
  let ambiguityReduction: ReturnType<typeof reduce> | undefined;
  const ambiguous = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: {
      async prepareProvenanceCarryClaim() {
        return { plan: localPlan.plan, status: "planned" };
      },
      async executeProvenanceCarryClaim(effect, current) {
        ambiguityReduction = reduce(current, {
          effectId: effect.effectId,
          effectKind: effect.kind,
          eventId: `recover-${effect.effectId}`,
          expectedRevision: current.revision,
          type: "effect_ambiguous",
          unitId: null,
        });
        return { status: "ambiguous" };
      },
      async reconcileProvenanceCarryClaim() {
        return { status: "absent" };
      },
    },
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, localGitCalls),
    },
    nonce: "carry-ambiguous",
    preOwnership: localStore.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: localState.controller.holder,
      scope: {
        beadsStoreIdentity: localState.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: localState.integrationBranch,
      },
    }),
    store: localStore.port,
  });
  const ambiguousResult = await ambiguous({
    provenanceCarryClaim: { predecessorRootBeadId },
  });
  assert.equal(
    ambiguityReduction?.ok,
    true,
    ambiguityReduction === undefined || ambiguityReduction.ok
      ? undefined
      : `${ambiguityReduction.code}: ${ambiguityReduction.reason}`,
  );
  assert.deepEqual(ambiguousResult, { status: "ambiguous" });
  assert.equal(localStore.writes, 2);
  assert.equal(localStore.root.run.effectJournal[0]?.status, "ambiguous");
  assert.equal(localStore.root.run.pendingProvenanceCarry, undefined);
  assert.deepEqual(localGitCalls, [
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
  ]);
});

test("generic recovery input cannot inject carry intent or observation", async () => {
  const state = carryRun("local-ff");
  const planned = carryPlan(state);
  const claimKey = deriveProvenanceCarryClaimKey(
    state.controller.runId,
    planned.plan.exportId,
    predecessorRootBeadId,
  );
  const store = carryStore(state);
  let carryCalls = 0;
  const gitCalls: string[] = [];
  const recovery = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: {
      async prepareProvenanceCarryClaim() {
        carryCalls += 1;
        return { plan: planned.plan, status: "planned" };
      },
      async executeProvenanceCarryClaim() {
        carryCalls += 1;
        return { status: "ambiguous" };
      },
      async reconcileProvenanceCarryClaim() {
        carryCalls += 1;
        return { status: "absent" };
      },
    },
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, gitCalls),
    },
    nonce: "carry-no-injection",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  });
  const directIntent = {
    claimToken: claimKey,
    eventId: "direct-carry-intent",
    expectedRevision: state.revision,
    exportId: planned.plan.exportId,
    idempotencyKey: claimKey,
    predecessorFinalRevision: planned.plan.predecessorFinalRevision,
    predecessorJournalCheckpointCommitment:
      planned.plan.predecessorJournalCheckpointCommitment,
    predecessorRootAggregateCommitment:
      planned.plan.predecessorRootAggregateCommitment,
    predecessorRootBeadId,
    predecessorRunId: planned.plan.predecessorRunId,
    predecessorWaveId: planned.plan.predecessorWaveId,
    snapshotCommitment: planned.plan.snapshotCommitment,
    type: "provenance_carry_claim_intent",
  } satisfies ProtocolEvent;
  assert.deepEqual(await recovery(directIntent), { status: "blocked" });
  const directObservation = {
    effectId: "direct:provenance_carry_claim",
    effectKind: "provenance_carry_claim",
    eventId: "direct-carry-observation",
    expectedRevision: state.revision,
    observationHash: HASH,
    result: {
      claimantRunId: "other-run",
      claimRecordDigest: "4".repeat(64),
      claimRevision: 1,
      exportId: planned.plan.exportId,
      status: "already_claimed",
    },
    type: "provenance_carry_claim_observed",
  } satisfies ProtocolEvent;
  assert.deepEqual(await recovery(directObservation), { status: "blocked" });
  assert.equal(store.writes, 0);
  assert.equal(carryCalls, 0);
  assert.deepEqual(gitCalls, [
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
    "rev-parse --git-common-dir",
    "rev-parse --show-object-format",
    "config --null --get-regexp ^remote\\..*\\.url$",
  ]);
});

test("configured recovery admits the first exact knowledge wave then blocks configuration drift", async () => {
  const base = localRun();
  const state = { ...base, wave: { id: "wave-0", unitIds: [] } };
  assert.deepEqual(runInvariantErrors(state), []);
  const knowledgeContract = configuredKnowledgeContract();
  const store = carryStore(state);
  const gitCalls: string[] = [];
  const options = {
    acquireOperationLock: async () => acquiredLock(),
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, gitCalls),
    },
    nonce: "configured-knowledge-wave",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  };
  const configured = createProductionRecoveryRunner({
    ...options,
    knowledgeContract,
  });
  const wavePlanned = {
    eventId: "knowledge-wave-planned",
    expectedRevision: state.revision,
    knowledgeContract,
    tasks: [state.units["unit-1"]!.taskMetadata!],
    type: "wave_planned",
    waveId: "knowledge-wave",
  } satisfies ProtocolEvent;
  const planned = await configured(wavePlanned);
  assert.equal(planned.status, "applied");
  assert.deepEqual(store.root.run.knowledgeContract, knowledgeContract);
  assert.equal(store.root.run.wave.id, "knowledge-wave");
  assert.equal(store.writes, 1);

  const mismatched = createProductionRecoveryRunner({
    ...options,
    knowledgeContract: configuredKnowledgeContract("different-owner"),
  });
  assert.deepEqual(await mismatched(), { status: "unavailable" });
  assert.equal(store.writes, 1);
});

test("configured carry reload reconciles ambiguous and post-intent-crash claims before the first wave", async () => {
  const knowledgeContract = configuredKnowledgeContract();
  for (const mode of ["ambiguous", "post-intent-crash"] as const) {
    const state = carryRun("local-ff");
    const planned = carryPlan(state);
    const store = carryStore(state);
    let executes = 0;
    const first = createProductionRecoveryRunner({
      acquireOperationLock: async () => acquiredLock(),
      carry: {
        async prepareProvenanceCarryClaim() {
          return { plan: planned.plan, status: "planned" };
        },
        async executeProvenanceCarryClaim() {
          executes += 1;
          return { status: "ambiguous" };
        },
        async reconcileProvenanceCarryClaim() {
          return { status: "absent" };
        },
      },
      ...(mode === "post-intent-crash"
        ? {
            fault: (point) => {
              if (point === "after_intent_persist")
                throw new Error("configured carry post-intent crash");
            },
          }
        : {}),
      git: {
        repository,
        runner: carryGitRunner("local-ff", OID_B, []),
      },
      knowledgeContract,
      nonce: `configured-carry-${mode}`,
      preOwnership: store.port,
      proveTopology: async () => ({
        commonDir: repository.commonDir,
        holder: state.controller.holder,
        scope: {
          beadsStoreIdentity: state.storeIdentity,
          gitRepositoryIdentity: repository.identity,
          integrationBranch: state.integrationBranch,
        },
      }),
      store: store.port,
    });
    if (mode === "post-intent-crash") {
      await assert.rejects(
        first({ provenanceCarryClaim: { predecessorRootBeadId } }),
        /configured carry post-intent crash/u,
      );
    } else {
      assert.deepEqual(
        await first({ provenanceCarryClaim: { predecessorRootBeadId } }),
        { status: "ambiguous" },
      );
    }
    assert.equal(executes, mode === "ambiguous" ? 1 : 0);
    assert.equal(
      store.root.run.effectJournal.at(-1)?.status,
      mode === "ambiguous" ? "ambiguous" : "intended",
    );
    assert.equal(store.root.run.knowledgeContract, undefined);

    let reconciles = 0;
    const resumed = createProductionRecoveryRunner({
      acquireOperationLock: async () => acquiredLock(),
      carry: {
        async prepareProvenanceCarryClaim() {
          throw new Error("reload must use the durable carry intent");
        },
        async executeProvenanceCarryClaim() {
          throw new Error("observed reconciliation must not replay the CAS");
        },
        async reconcileProvenanceCarryClaim(effect, current) {
          reconciles += 1;
          const carry = importedCarry(
            current,
            planned.plan,
            planned.projectionInputSnapshot,
          );
          return {
            result: {
              carry,
              status: "imported",
            },
            status: "observed",
          };
        },
      },
      git: {
        repository,
        runner: carryGitRunner("local-ff", OID_B, []),
      },
      knowledgeContract,
      nonce: `configured-carry-${mode}-reload`,
      preOwnership: store.port,
      proveTopology: async () => ({
        commonDir: repository.commonDir,
        holder: state.controller.holder,
        scope: {
          beadsStoreIdentity: state.storeIdentity,
          gitRepositoryIdentity: repository.identity,
          integrationBranch: state.integrationBranch,
        },
      }),
      store: store.port,
    });
    const resumedResult = await resumed();
    assert.equal(resumedResult.status, "idle", mode);
    assert.equal(reconciles, 1, mode);
    assert.equal(store.root.run.effectJournal.at(-1)?.status, "observed");
    assert.equal(store.root.run.pendingProvenanceCarry?.integrationOid, OID_B);
    assert.equal(store.root.run.knowledgeContract, undefined);
  }
});

test("configured pending carry reload accepts an exact carry-only first wave and freezes the contract", async () => {
  const state = carryRun("local-ff");
  const planned = carryPlan(state);
  const store = carryStore(state);
  const imported = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: {
      async prepareProvenanceCarryClaim() {
        return { plan: planned.plan, status: "planned" };
      },
      async executeProvenanceCarryClaim(_effect, current) {
        return {
          result: {
            carry: importedCarry(
              current,
              planned.plan,
              planned.projectionInputSnapshot,
            ),
            status: "imported",
          },
          status: "observed",
        };
      },
      async reconcileProvenanceCarryClaim() {
        return { status: "absent" };
      },
    },
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    nonce: "pending-carry-fixture",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  });
  assert.equal(
    (
      await imported({
        provenanceCarryClaim: { predecessorRootBeadId },
      })
    ).status,
    "applied",
  );
  const pending = store.root.run;
  assert.ok(pending.pendingProvenanceCarry);
  assert.equal(pending.knowledgeContract, undefined);

  const knowledgeContract = configuredKnowledgeContract();
  const configured = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    knowledgeContract,
    nonce: "pending-carry-first-wave",
    preOwnership: store.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: store.port,
  });
  const carryOnlyWave = {
    carryOnly: true,
    eventId: "configured-carry-only-wave",
    expectedRevision: pending.revision,
    knowledgeContract,
    tasks: [],
    type: "wave_planned",
    waveId: "carry-only-wave",
  } satisfies ProtocolEvent;
  assert.equal((await configured(carryOnlyWave)).status, "applied");
  assert.deepEqual(store.root.run.knowledgeContract, knowledgeContract);
  assert.equal(store.root.run.pendingProvenanceCarry, undefined);
  assert.equal(store.root.run.gate?.waveId, "carry-only-wave");
  assert.deepEqual(store.root.run.wave.unitIds, []);
});

test("configured durable carry refusal reload permits a new carry intent or an ordinary first wave", async () => {
  const base = localRun();
  const state = { ...base, wave: { id: "wave-0", unitIds: [] } };
  assert.deepEqual(runInvariantErrors(state), []);
  const knowledgeContract = configuredKnowledgeContract();
  const refusalStore = await configuredCarryRefusalStore(
    state,
    knowledgeContract,
    "configured-carry-refusal",
  );
  const refusedRun = refusalStore.root.run;
  assert.equal(refusedRun.provenanceCarryClaim, undefined);
  assert.equal(
    refusedRun.lastProvenanceCarryRefusal?.status,
    "predecessor_refused",
  );
  if (refusedRun.lastProvenanceCarryRefusal?.status === "predecessor_refused")
    assert.equal(refusedRun.lastProvenanceCarryRefusal.reason, "not_released");
  assert.equal(refusedRun.knowledgeContract, undefined);

  const retryStore = carryStore(refusedRun);
  const retryRootBeadId = "sce-predecessor-retry";
  const retryPlan = carryPlan(refusedRun);
  const retry = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    carry: {
      async prepareProvenanceCarryClaim(predecessor) {
        assert.equal(predecessor, retryRootBeadId);
        return { plan: retryPlan.plan, status: "planned" };
      },
      async executeProvenanceCarryClaim() {
        return { status: "ambiguous" };
      },
      async reconcileProvenanceCarryClaim() {
        return { status: "absent" };
      },
    },
    fault: (point) => {
      if (point === "after_intent_persist")
        throw new Error("configured carry retry intent persisted");
    },
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    knowledgeContract,
    nonce: "configured-carry-retry",
    preOwnership: retryStore.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: retryStore.port,
  });
  await assert.rejects(
    retry({ provenanceCarryClaim: { predecessorRootBeadId: retryRootBeadId } }),
    /configured carry retry intent persisted/u,
  );
  assert.equal(
    retryStore.root.run.provenanceCarryClaim?.predecessorRootBeadId,
    retryRootBeadId,
  );
  assert.equal(retryStore.root.run.lastProvenanceCarryRefusal, undefined);
  assert.equal(retryStore.root.run.effectJournal.at(-1)?.status, "intended");

  const releaseBase = carryRun("local-ff");
  const releaseRefusalStore = await configuredCarryRefusalStore(
    releaseBase,
    knowledgeContract,
    "configured-carry-release-refusal",
  );
  const releaseRefusedRun = releaseRefusalStore.root.run;
  assert.equal(releaseRefusedRun.provenanceCarryClaim, undefined);
  assert.equal(
    releaseRefusedRun.lastProvenanceCarryRefusal?.status,
    "predecessor_refused",
  );
  assert.deepEqual(runInvariantErrors(releaseRefusedRun), []);
  const releaseStore = carryStore(releaseRefusedRun);
  const slotTransition = controllerSlotTransition(releaseRefusedRun, "release");
  let releasePlans = 0;
  let releaseExecutions = 0;
  const release = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    knowledgeContract,
    nonce: "configured-release-after-refusal",
    preOwnership: releaseStore.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: releaseRefusedRun.controller.holder,
      scope: {
        beadsStoreIdentity: releaseRefusedRun.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: releaseRefusedRun.integrationBranch,
      },
    }),
    store: releaseStore.port,
    topology: {
      async executeControllerTransition(transition) {
        releaseExecutions += 1;
        assert.deepEqual(transition, slotTransition);
        return { status: "observed" };
      },
      async prepareControllerTransition({ kind }) {
        releasePlans += 1;
        assert.equal(kind, "release");
        return { status: "planned", transition: slotTransition };
      },
      async reconcileControllerTransition() {
        return { status: "absent" };
      },
    },
  });
  const releaseIntent = {
    eventId: "release-after-carry-refusal",
    expectedRevision: releaseRefusedRun.revision,
    idempotencyKey: deriveIdempotencyKey(
      releaseRefusedRun,
      releaseRefusedRun.revision,
      null,
      "controller_release",
    ),
    type: "controller_release_intent",
  } satisfies ProtocolEvent;
  const preparedRelease = reduce(releaseRefusedRun, {
    ...releaseIntent,
    slotTransition,
  });
  assert.equal(
    preparedRelease.ok,
    true,
    preparedRelease.ok
      ? undefined
      : `${preparedRelease.code}: ${preparedRelease.reason}`,
  );
  assert.equal((await release(releaseIntent)).status, "applied");
  assert.equal(releasePlans, 1);
  assert.equal(releaseExecutions, 1);
  assert.equal(releaseStore.root.run.controller.state, "released");
  assert.deepEqual(
    releaseStore.root.run.lastProvenanceCarryRefusal,
    releaseRefusedRun.lastProvenanceCarryRefusal,
  );
  assert.equal(releaseStore.root.run.knowledgeContract, undefined);

  const waveStore = carryStore(refusedRun);
  const ordinary = createProductionRecoveryRunner({
    acquireOperationLock: async () => acquiredLock(),
    git: {
      repository,
      runner: carryGitRunner("local-ff", OID_B, []),
    },
    knowledgeContract,
    nonce: "configured-first-wave-after-refusal",
    preOwnership: waveStore.port,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store: waveStore.port,
  });
  const ordinaryWave = {
    eventId: "knowledge-wave-after-carry-refusal",
    expectedRevision: refusedRun.revision,
    knowledgeContract,
    tasks: [refusedRun.units["unit-1"]!.taskMetadata!],
    type: "wave_planned",
    waveId: "knowledge-wave-after-refusal",
  } satisfies ProtocolEvent;
  assert.equal((await ordinary(ordinaryWave)).status, "applied");
  assert.deepEqual(waveStore.root.run.knowledgeContract, knowledgeContract);
  assert.deepEqual(
    waveStore.root.run.lastProvenanceCarryRefusal,
    refusedRun.lastProvenanceCarryRefusal,
  );
  assert.equal(waveStore.root.run.wave.id, "knowledge-wave-after-refusal");
});

function runner(
  answers: Readonly<Record<string, string | undefined>>,
  calls: string[],
): GitRunner {
  return async ({ argv }) => {
    calls.push(argv.join(" "));
    const key = argv.join(" ");
    const stdout = answers[key];
    return {
      exitCode: stdout === undefined ? 1 : 0,
      signal: null,
      stdout: stdout ?? "",
    };
  };
}

function verified(answers: Record<string, string | undefined>) {
  answers["rev-parse --git-common-dir"] = ".git\n";
  answers["rev-parse --show-object-format"] = "sha1\n";
  answers["config --null --get-regexp ^remote\\..*\\.url$"] = undefined;
}

test("branch reconciliation is read-only and classifies positive absence", async () => {
  const answers: Record<string, string | undefined> = {};
  verified(answers);
  answers[`for-each-ref --format=%(objectname) refs/heads/sce/unit-1`] = "";
  const calls: string[] = [];
  const adapter = createProductionRecoveryEffectAdapter({
    git: { repository, runner: runner(answers, calls) },
  });

  assert.deepEqual(await adapter.reconcile(branchEffect(), localRun()), {
    status: "absent",
  });
  assert.equal(
    calls.some((call) => call.startsWith("branch ")),
    false,
  );
  assert.equal(
    calls.some((call) => call.startsWith("worktree add")),
    false,
  );
  assert.equal(
    calls.some((call) => call.startsWith("push ")),
    false,
  );
});

/** One unit driven to `candidate_intent`: the collect act is emitted, unobserved. */
function candidateIntentRun(): RepositoryRun {
  let state = localRun();
  const observe = (
    type: Parameters<typeof event>[1],
    kind: string,
    fields: Record<string, unknown> = {},
  ) => {
    state = transition(
      state,
      event(state, type, {
        effectId: state.effectJournal.at(-1)!.effectId,
        effectKind: kind,
        observationHash: HASH,
        ...fields,
      }),
      reduce,
    );
  };
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
    }),
    reduce,
  );
  observe("reservation_observed", "reservation_acquire");
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  observe("branch_observed", "branch_create", { branchRef: "sce/unit-1" });
  state = transition(
    state,
    event(state, "worktree_intent", { worktreePath: "/task" }),
    reduce,
  );
  observe("worktree_observed", "worktree_create", { worktreePath: "/task" });
  state = transition(state, event(state, "dispatch_intent"), reduce);
  observe("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  state = transition(state, event(state, "collect_intent"), reduce);
  observe("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  return transition(state, event(state, "candidate_intent"), reduce);
}

/** Answers a whole candidate collection on a clean `/task`, with a given diff. */
function candidateRunner(diff: string): GitRunner {
  return async ({ argv, cwd }) => {
    const answer = (stdout: string) => ({ exitCode: 0, signal: null, stdout });
    if (argv[0] === "worktree")
      return answer(
        `worktree /task\nHEAD ${OID_B}\nbranch refs/heads/sce/unit-1\n\n`,
      );
    if (argv[0] === "status") return answer("");
    if (argv[0] === "ls-files") return answer("H src/file.ts\u0000");
    if (argv[0] === "symbolic-ref") return answer("refs/heads/sce/unit-1\n");
    if (argv[0] === "merge-base") return answer("");
    if (argv[0] === "-c" && argv[4] === "diff")
      return answer(argv.includes("--name-only") ? "src/file.ts\u0000" : diff);
    if (argv[0] === "rev-parse")
      return answer(
        argv[1] === "--git-common-dir"
          ? cwd === "/task"
            ? "/repo/.git\n"
            : ".git\n"
          : argv[1] === "--show-object-format"
            ? "sha1\n"
            : argv[2] === "HEAD^{commit}"
              ? `${OID_B}\n`
              : `${OID_A}\n`,
      );
    return { exitCode: 1, signal: null, stdout: "" };
  };
}

// sce-dcx.21: the collect reconcile used to see only an unreadable diff here
// and leave the effect ambiguous, which blocked the unit with no stated cause.
test("a candidate diff past the packet bound reconciles to a typed refusal", async () => {
  let state = candidateIntentRun();
  const candidateEffect = state.effectJournal.at(-1)!;
  const collectEffect = {
    effectId: candidateEffect.effectId,
    idempotencyKey: candidateEffect.idempotencyKey,
    kind: "candidate_collect" as const,
    params: { branchRef: "sce/unit-1", worktreePath: "/task" },
    paramsHash: candidateEffect.paramsHash,
    schemaVersion: 1 as const,
    unitId: "unit-1",
  };
  const adapter = createProductionRecoveryEffectAdapter({
    git: { repository, runner: candidateRunner("d".repeat(65_537)) },
  });
  const refused = await adapter.reconcile(collectEffect, state);
  assert.equal(refused.status, "observed");
  if (refused.status !== "observed") return;
  assert.equal(validate(ProtocolEventSchema, refused.observation).ok, true);
  assert.deepEqual(
    {
      ...(refused.observation as unknown as Record<string, unknown>),
      eventId: undefined,
      expectedRevision: undefined,
      observationHash: undefined,
    },
    {
      effectId: candidateEffect.effectId,
      effectKind: "candidate_collect",
      eventId: undefined,
      expectedRevision: undefined,
      headOid: OID_B,
      maximumByteCount: 65_536,
      measuredByteCount: 65_537,
      observationHash: undefined,
      reason: "diff_oversize",
      treeOid: OID_A,
      type: "candidate_refused",
      unitId: "unit-1",
    },
  );

  state = transition(state, refused.observation, reduce);
  const repaired = state.units["unit-1"]!;
  assert.equal(repaired.state, "repair_required");
  assert.equal(
    repaired.repairContext?.rationale.includes("at least 65537 bytes"),
    true,
  );
  assert.equal(repaired.repairContext?.rationale.includes("65536-byte"), true);
  assert.deepEqual(runInvariantErrors(state), []);

  // One byte under the bound is an ordinary candidate, not a refusal.
  const fitting = await createProductionRecoveryEffectAdapter({
    git: { repository, runner: candidateRunner("d".repeat(65_536)) },
  }).reconcile(collectEffect, candidateIntentRun());
  assert.equal(fitting.status, "observed");
  if (fitting.status !== "observed") return;
  assert.equal(
    (fitting.observation as { type: string }).type,
    "candidate_observed",
  );
});

/** One unit prepared to `refresh_intent` before any dispatch (sce-296.18). */
function preparedRefreshRun(): RepositoryRun {
  let state = localRun();
  const observe = (
    type: Parameters<typeof event>[1],
    kind: string,
    fields: Record<string, unknown> = {},
  ) => {
    state = transition(
      state,
      event(state, type, {
        effectId: state.effectJournal.at(-1)!.effectId,
        effectKind: kind,
        observationHash: HASH,
        ...fields,
      }),
      reduce,
    );
  };
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
    }),
    reduce,
  );
  observe("reservation_observed", "reservation_acquire");
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  observe("branch_observed", "branch_create", { branchRef: "sce/unit-1" });
  state = transition(
    state,
    event(state, "worktree_intent", { worktreePath: "/task" }),
    reduce,
  );
  observe("worktree_observed", "worktree_create", { worktreePath: "/task" });
  return transition(
    state,
    event(state, "refresh_intent", { baseOid: OID_C }),
    reduce,
  );
}

/**
 * A clean unit worktree on `sce/unit-1`. `world.head` is the exact commit the
 * branch rests on and doubles as its tree, `merge --ff-only` advances it only
 * when `world.fastForward` allows, and every call is recorded so the test can
 * prove no rebase was attempted.
 */
function preparedWorktreeRunner(
  world: { head: string; clean: boolean; fastForward: boolean },
  calls: string[],
): GitRunner {
  return async ({ argv, cwd }) => {
    calls.push(argv.join(" "));
    const answer = (stdout: string) => ({ exitCode: 0, signal: null, stdout });
    // Exit 1 with no output is git's "no configured remotes", which is what a
    // local fixture repository with no remote URLs must report.
    if (argv[0] === "config") return { exitCode: 1, signal: null, stdout: "" };
    if (argv[0] === "worktree")
      return answer(
        `worktree /task\nHEAD ${world.head}\nbranch refs/heads/sce/unit-1\n\n`,
      );
    if (argv[0] === "status")
      return answer(world.clean ? "" : " M src/file.ts\u0000");
    if (argv[0] === "ls-files") return answer("H src/file.ts\u0000");
    if (argv[0] === "symbolic-ref") return answer("refs/heads/sce/unit-1\n");
    if (argv[0] === "merge") {
      if (!world.fastForward) return { exitCode: 1, signal: null, stdout: "" };
      world.head = argv[2]!;
      return answer("");
    }
    if (argv[0] === "rev-parse") {
      if (argv[1] === "--git-common-dir")
        return answer(cwd === "/task" ? "/repo/.git\n" : ".git\n");
      if (argv[1] === "--show-object-format") return answer("sha1\n");
      const target = argv[2] ?? "";
      return answer(
        `${target.startsWith("HEAD") ? world.head : target.slice(0, 40)}\n`,
      );
    }
    return { exitCode: 1, signal: null, stdout: "" };
  };
}

function preparedRefreshEffect(state: RepositoryRun): ProtocolEffect {
  const entry = state.effectJournal.at(-1)!;
  return {
    effectId: entry.effectId,
    idempotencyKey: entry.idempotencyKey,
    kind: "candidate_refresh" as const,
    params: {
      baseOid: OID_C,
      branchRef: "sce/unit-1",
      previousBaseOid: OID_A,
      worktreePath: "/task",
    },
    paramsHash: entry.paramsHash,
    schemaVersion: 1 as const,
    unitId: "unit-1",
  } as ProtocolEffect;
}

// sce-296.18: a unit dispatched hours after it was composed starts on stale
// code. Refreshing it before its first dispatch is a pure fast-forward of an
// empty branch; it must never reach for `git rebase`.
test("a pre-dispatch refresh fast-forwards the prepared branch and refuses a diverged one", async () => {
  const state = preparedRefreshRun();
  assert.equal(state.units["unit-1"]?.state, "refresh_intent");
  const effect = preparedRefreshEffect(state);

  const calls: string[] = [];
  const world = { clean: true, fastForward: true, head: OID_A };
  const adapter = createProductionRecoveryEffectAdapter({
    git: { repository, runner: preparedWorktreeRunner(world, calls) },
  });

  // The read-only probe sees the branch still on its old base and reports the
  // act as absent, having touched nothing.
  assert.equal((await adapter.reconcile(effect, state)).status, "absent");
  assert.equal(world.head, OID_A);
  assert.equal(
    calls.some(
      (call) => call.startsWith("merge ") || call.startsWith("rebase"),
    ),
    false,
  );

  const executed = await adapter.execute(effect, state);
  assert.equal(executed.status, "observed");
  if (executed.status !== "observed") return;
  assert.equal(validate(ProtocolEventSchema, executed.observation).ok, true);
  assert.deepEqual(
    {
      ...(executed.observation as unknown as Record<string, unknown>),
      eventId: undefined,
      expectedRevision: undefined,
      observationHash: undefined,
    },
    {
      baseOid: OID_C,
      effectId: effect.effectId,
      effectKind: "candidate_refresh",
      eventId: undefined,
      expectedRevision: undefined,
      headOid: OID_C,
      observationHash: undefined,
      treeOid: OID_C,
      type: "refresh_observed",
      unitId: "unit-1",
    },
  );
  assert.equal(calls.includes(`merge --ff-only ${OID_C}`), true);
  assert.equal(
    calls.some((call) => call.startsWith("rebase")),
    false,
  );

  const refreshed = transition(state, executed.observation, reduce);
  assert.equal(refreshed.units["unit-1"]?.state, "worktree_observed");
  assert.equal(refreshed.units["unit-1"]?.baseOid, OID_C);
  assert.deepEqual(runInvariantErrors(refreshed), []);

  // The same act is idempotent on a worktree already resting on the new base.
  assert.equal((await adapter.reconcile(effect, state)).status, "observed");

  // A branch that already carries commits is refused with the exact pair it
  // rests on, never rebased onto the new base.
  const divergedCalls: string[] = [];
  const diverged = await createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: preparedWorktreeRunner(
        { clean: true, fastForward: true, head: OID_B },
        divergedCalls,
      ),
    },
  }).execute(effect, state);
  assert.equal(diverged.status, "observed");
  if (diverged.status !== "observed") return;
  assert.deepEqual(
    {
      ...(diverged.observation as unknown as Record<string, unknown>),
      eventId: undefined,
      expectedRevision: undefined,
      observationHash: undefined,
    },
    {
      baseOid: OID_A,
      effectId: effect.effectId,
      effectKind: "candidate_refresh",
      eventId: undefined,
      expectedRevision: undefined,
      headOid: OID_B,
      observationHash: undefined,
      treeOid: OID_B,
      type: "refresh_failed",
      unitId: "unit-1",
    },
  );
  assert.equal(
    divergedCalls.some(
      (call) => call.startsWith("merge ") || call.startsWith("rebase"),
    ),
    false,
  );
  const blocked = transition(state, diverged.observation, reduce);
  assert.equal(blocked.units["unit-1"]?.state, "repair_required");
  assert.deepEqual(runInvariantErrors(blocked), []);

  // A dirty worktree refuses the same way: the unit keeps its base.
  const dirty = await createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: preparedWorktreeRunner(
        { clean: false, fastForward: true, head: OID_A },
        [],
      ),
    },
  }).execute(effect, state);
  assert.equal(dirty.status, "observed");
  if (dirty.status !== "observed") return;
  const refusal = dirty.observation as unknown as Record<string, unknown>;
  assert.equal(refusal["type"], "refresh_failed");
  assert.equal(refusal["baseOid"], OID_A);
  assert.equal(refusal["headOid"], OID_A);
});

test("production candidate collection and manual verification bind exact durable facts", async () => {
  let state = localRun();
  let liveHead = OID_B;
  const observe = (
    type: Parameters<typeof event>[1],
    kind: string,
    fields: Record<string, unknown> = {},
  ) => {
    state = transition(
      state,
      event(state, type, {
        effectId: state.effectJournal.at(-1)!.effectId,
        effectKind: kind,
        observationHash: HASH,
        ...fields,
      }),
      reduce,
    );
  };
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "path", resource: "src" }],
    }),
    reduce,
  );
  observe("reservation_observed", "reservation_acquire");
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  observe("branch_observed", "branch_create", { branchRef: "sce/unit-1" });
  state = transition(
    state,
    event(state, "worktree_intent", { worktreePath: "/task" }),
    reduce,
  );
  observe("worktree_observed", "worktree_create", { worktreePath: "/task" });
  state = transition(state, event(state, "dispatch_intent"), reduce);
  observe("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  state = transition(state, event(state, "collect_intent"), reduce);
  observe("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  state = transition(state, event(state, "candidate_intent"), reduce);
  const candidateEffect = state.effectJournal.at(-1)!;
  const calls: string[] = [];
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async ({ argv, cwd }) => {
        calls.push(argv.join(" "));
        if (argv[0] === "config")
          return { exitCode: 1, signal: null, stdout: "" };
        if (argv[0] === "worktree")
          return {
            exitCode: 0,
            signal: null,
            stdout: `worktree /task\nHEAD ${liveHead}\nbranch refs/heads/sce/unit-1\n\n`,
          };
        if (argv[0] === "status")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "ls-files")
          return { exitCode: 0, signal: null, stdout: "H src/file.ts\u0000" };
        if (argv[0] === "symbolic-ref")
          return {
            exitCode: 0,
            signal: null,
            stdout: "refs/heads/sce/unit-1\n",
          };
        if (argv[0] === "merge-base")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "diff" || (argv[0] === "-c" && argv[4] === "diff"))
          return {
            exitCode: 0,
            signal: null,
            stdout: argv.includes("--name-only")
              ? "src/file.ts\u0000"
              : "diff --git a/src/file.ts b/src/file.ts\n",
          };
        if (argv[0] === "rev-parse")
          return {
            exitCode: 0,
            signal: null,
            stdout:
              argv[1] === "--git-common-dir"
                ? cwd === "/task"
                  ? "/repo/.git\n"
                  : ".git\n"
                : argv[1] === "--show-object-format"
                  ? "sha1\n"
                  : argv[2] === "HEAD^{commit}"
                    ? `${liveHead}\n`
                    : `${OID_A}\n`,
          };
        return { exitCode: 1, signal: null, stdout: "" };
      },
    },
  });
  const collected = await adapter.reconcile(
    {
      effectId: candidateEffect.effectId,
      idempotencyKey: candidateEffect.idempotencyKey,
      kind: "candidate_collect",
      params: { branchRef: "sce/unit-1", worktreePath: "/task" },
      paramsHash: candidateEffect.paramsHash,
      schemaVersion: 1,
      unitId: "unit-1",
    },
    state,
  );
  assert.equal(collected.status, "observed", calls.join("\n"));
  if (collected.status !== "observed") return;
  assert.equal(
    (collected.observation as { candidateDiffHash: string }).candidateDiffHash,
    deriveCandidateDiffHash("diff --git a/src/file.ts b/src/file.ts\n"),
  );
  assert.equal(
    calls.some((call) => call.startsWith("branch ")),
    false,
  );
  assert.equal(
    calls.some((call) => call.startsWith("worktree add")),
    false,
  );

  state = transition(state, collected.observation, reduce);
  state = transition(
    state,
    event(state, "verification_intent", { commands: ["npm test"] }),
    reduce,
  );
  const verify = state.effectJournal.at(-1)!;
  const verifyEffect = {
    effectId: verify.effectId,
    idempotencyKey: verify.idempotencyKey,
    kind: "verify" as const,
    params: {
      candidate: { baseOid: OID_A, headOid: OID_B, treeOid: OID_A },
      commands: ["npm test"],
      worktreePath: "/task",
    },
    paramsHash: verify.paramsHash,
    schemaVersion: 1 as const,
    unitId: "unit-1",
  };
  const requested = await adapter.reconcile(verifyEffect, state);
  assert.equal(requested.status, "tool_request");
  if (requested.status !== "tool_request") return;
  assert.deepEqual((requested.toolRequest as { commands: string[] }).commands, [
    "npm test",
  ]);
  assert.equal(
    (
      await adapter.acknowledge!(
        {
          baseOid: OID_A,
          commands: ["npm test"],
          effectId: verify.effectId,
          evidenceDigest: HASH,
          headOid: OID_B,
          kind: "verified",
          passed: true,
          schema: "sce.harness-tool-acknowledgement",
          treeOid: OID_A,
          version: 1,
          worktreePath: "/task",
        },
        state,
      )
    ).status,
    "ambiguous",
  );
  const ambiguousVerify = transition(
    state,
    event(state, "effect_ambiguous", {
      effectId: verify.effectId,
      effectKind: "verify",
    }),
    reduce,
  );
  assert.equal(ambiguousVerify.state, "blocked");
  assert.equal(
    (
      await adapter.acknowledge!(
        {
          baseOid: OID_A,
          commands: ["npm run substituted"],
          effectId: verify.effectId,
          evidenceDigest: HASH,
          headOid: OID_B,
          kind: "verified",
          passed: true,
          schema: "sce.harness-tool-acknowledgement",
          treeOid: OID_A,
          version: 1,
          worktreePath: "/foreign",
        },
        ambiguousVerify,
      )
    ).status,
    "ambiguous",
  );
  assert.equal(
    (
      await adapter.acknowledge!(
        {
          baseOid: OID_A,
          commands: ["npm test"],
          effectId: verify.effectId,
          evidenceDigest: HASH,
          headOid: OID_B,
          kind: "verified",
          passed: true,
          schema: "sce.harness-tool-acknowledgement",
          treeOid: OID_A,
          version: 1,
          worktreePath: "/foreign",
        },
        ambiguousVerify,
      )
    ).status,
    "ambiguous",
  );
  const acknowledged = await adapter.acknowledge!(
    {
      baseOid: OID_A,
      commands: ["npm test"],
      effectId: verify.effectId,
      evidenceDigest: HASH,
      headOid: OID_B,
      kind: "verified",
      passed: true,
      schema: "sce.harness-tool-acknowledgement",
      treeOid: OID_A,
      version: 1,
      worktreePath: "/task",
    },
    ambiguousVerify,
  );
  assert.equal(acknowledged.status, "observed");
  if (acknowledged.status === "observed") {
    const qualified = reduce(ambiguousVerify, acknowledged.observation);
    assert.equal(qualified.ok, true);
    if (qualified.ok)
      assert.equal(qualified.nextState.units["unit-1"]?.state, "qualified");
  }
  const failed = await adapter.acknowledge!(
    {
      baseOid: OID_A,
      commands: ["npm test"],
      effectId: verify.effectId,
      evidenceDigest: HASH,
      headOid: OID_B,
      kind: "verified",
      passed: false,
      schema: "sce.harness-tool-acknowledgement",
      treeOid: OID_A,
      version: 1,
      worktreePath: "/task",
    },
    ambiguousVerify,
  );
  assert.equal(failed.status, "observed");
  if (failed.status === "observed") {
    const repaired = reduce(ambiguousVerify, failed.observation);
    assert.equal(repaired.ok, true);
    if (repaired.ok)
      assert.equal(
        repaired.nextState.units["unit-1"]?.state,
        "repair_required",
      );
  }
  liveHead = OID_A;
  assert.equal(
    (
      await adapter.acknowledge!(
        {
          baseOid: OID_A,
          commands: ["npm test"],
          effectId: verify.effectId,
          evidenceDigest: HASH,
          headOid: OID_B,
          kind: "verified",
          passed: true,
          schema: "sce.harness-tool-acknowledgement",
          treeOid: OID_A,
          version: 1,
          worktreePath: "/task",
        },
        ambiguousVerify,
      )
    ).status,
    "ambiguous",
  );
  liveHead = OID_B;
  assert.equal(
    calls.some((call) => call.startsWith("merge ")),
    false,
  );

  let root = makeRootProjection(state);
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
  const recovery = createProductionRecoveryRunner({
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: { release: async () => ({ status: "released" as const }) },
    }),
    git: {
      repository,
      runner: async ({ argv, cwd }) => {
        if (argv[0] === "config")
          return { exitCode: 1, signal: null, stdout: "" };
        if (argv[0] === "worktree")
          return {
            exitCode: 0,
            signal: null,
            stdout: `worktree /task\nHEAD ${OID_B}\nbranch refs/heads/sce/unit-1\n\n`,
          };
        if (argv[0] === "status")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "ls-files")
          return { exitCode: 0, signal: null, stdout: "H src/file.ts\u0000" };
        if (argv[0] === "symbolic-ref")
          return {
            exitCode: 0,
            signal: null,
            stdout: "refs/heads/sce/unit-1\n",
          };
        return {
          exitCode: 0,
          signal: null,
          stdout:
            argv[1] === "--git-common-dir"
              ? cwd === "/task"
                ? "/repo/.git\n"
                : ".git\n"
              : argv[1] === "--show-object-format"
                ? "sha1\n"
                : argv[2] === "HEAD^{commit}"
                  ? `${OID_B}\n`
                  : `${OID_A}\n`,
        };
      },
    },
    nonce: "verify-manual-resume",
    preOwnership: store,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store,
  });
  const firstRequest = await recovery();
  assert.equal(firstRequest.status, "tool_request");
  assert.equal(root.run.effectJournal.at(-1)?.status, "ambiguous");
  assert.equal(root.run.units["unit-1"]?.state, "blocked");
  assert.equal((await recovery()).status, "ambiguous");
  assert.equal(
    (
      await recovery({
        harnessAcknowledgement: {
          baseOid: OID_A,
          commands: ["npm test"],
          effectId: verify.effectId,
          evidenceDigest: HASH,
          headOid: OID_B,
          kind: "verified",
          passed: true,
          schema: "sce.harness-tool-acknowledgement",
          treeOid: OID_A,
          version: 1,
          worktreePath: "/task",
        },
      })
    ).status,
    "applied",
  );
  assert.equal(root.run.units["unit-1"]?.state, "qualified");
  assert.equal((await recovery()).status, "idle");
});

test("foreign and unreadable branch discoveries are privacy-safe ambiguity", async () => {
  const foreign: Record<string, string | undefined> = {};
  verified(foreign);
  foreign[`for-each-ref --format=%(objectname) refs/heads/sce/unit-1`] =
    `${OID_B}\n`;
  const foreignResult = await createProductionRecoveryEffectAdapter({
    git: { repository, runner: runner(foreign, []) },
  }).reconcile(branchEffect(), localRun());
  assert.deepEqual(foreignResult, { status: "ambiguous" });

  const unreadable: Record<string, string | undefined> = {};
  verified(unreadable);
  const result = await createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async () => {
        throw new Error("token=not-for-output");
      },
    },
  }).reconcile(branchEffect(), localRun());
  assert.deepEqual(result, { status: "ambiguous" });
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("branch execution uses the exact persisted base and reads it back", async () => {
  const answers: Record<string, string | undefined> = {};
  verified(answers);
  const calls: string[] = [];
  let created = false;
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async ({ argv }) => {
        calls.push(argv.join(" "));
        if (argv[0] === "branch") {
          created = true;
          return { exitCode: 0, signal: null, stdout: "" };
        }
        if (argv[0] === "for-each-ref")
          return {
            exitCode: 0,
            signal: null,
            stdout: created ? `${OID_A}\n` : "",
          };
        const stdout = answers[argv.join(" ")];
        return {
          exitCode: stdout === undefined ? 1 : 0,
          signal: null,
          stdout: stdout ?? "",
        };
      },
    },
  });

  const result = await adapter.execute(branchEffect(), localRun());
  assert.equal(result.status, "observed");
  assert.deepEqual(
    calls.filter((call) => call.startsWith("branch ")),
    [`branch sce/unit-1 ${OID_A}`],
  );
});

test("controller topology is exactly bound and reconcile never executes its mutator", async () => {
  let executions = 0;
  const topology: ControllerTransitionRecoveryPort = {
    async executeControllerTransition() {
      executions += 1;
      return { status: "observed" };
    },
    async reconcileControllerTransition() {
      return { status: "absent" };
    },
  };
  const effect = {
    effectId: "effect-controller",
    idempotencyKey: "key-controller",
    kind: "controller_acquire",
    params: {
      controllerFencingToken: "fence-1",
      holder: "run-1/incarnation-1",
      promptHash: HASH,
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      slotTransition: {
        holder: "run-1/incarnation-1",
        scope: {
          beadsStoreIdentity: "store-1",
          gitRepositoryIdentity: repository.identity,
          integrationBranch: "main",
        },
      },
    },
    paramsHash: HASH,
    schemaVersion: 1,
    unitId: null,
  } as unknown as ProtocolEffect;
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
    },
    topology,
  });

  assert.deepEqual(await adapter.reconcile(effect, localRun()), {
    status: "absent",
  });
  assert.equal(executions, 0);
  assert.equal((await adapter.execute(effect, localRun())).status, "observed");
  assert.equal(executions, 1);

  const mismatched = {
    ...effect,
    params: {
      ...effect.params,
      slotTransition: {
        holder: "run-1/incarnation-1",
        scope: {
          gitRepositoryIdentity: "local:/foreign/.git",
          beadsStoreIdentity: "store-1",
          integrationBranch: "main",
        },
      },
    },
  } as unknown as ProtocolEffect;
  assert.deepEqual(await adapter.reconcile(mismatched, localRun()), {
    status: "ambiguous",
  });
  assert.equal(
    (await adapter.execute(mismatched, localRun())).status,
    "ambiguous",
  );
  assert.equal(executions, 1);
});

test("controller topology methods are called on their instance, not as detached functions", async () => {
  // The production embedded adapter is a class whose methods read `this`.
  // A detached call throws before any slot command and used to surface as
  // an ambiguous act that blocked every fresh acquire (sce-59r).
  class InstanceTopology implements ControllerTransitionRecoveryPort {
    public executions = 0;
    private readonly usable = true;

    public async executeControllerTransition(): Promise<
      Readonly<{ status: "observed" | "ambiguous" }>
    > {
      if (!this.usable) return { status: "ambiguous" };
      this.executions += 1;
      return { status: "observed" };
    }

    public async reconcileControllerTransition(): Promise<
      Readonly<{ status: "absent" | "ambiguous" }>
    > {
      return this.usable ? { status: "absent" } : { status: "ambiguous" };
    }
  }
  const topology = new InstanceTopology();
  const effect = {
    effectId: "effect-controller",
    idempotencyKey: "key-controller",
    kind: "controller_acquire",
    params: {
      controllerFencingToken: "fence-1",
      holder: "run-1/incarnation-1",
      promptHash: HASH,
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      slotTransition: {
        holder: "run-1/incarnation-1",
        scope: {
          beadsStoreIdentity: "store-1",
          gitRepositoryIdentity: repository.identity,
          integrationBranch: "main",
        },
      },
    },
    paramsHash: HASH,
    schemaVersion: 1,
    unitId: null,
  } as unknown as ProtocolEffect;
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
    },
    topology,
  });
  assert.deepEqual(await adapter.reconcile(effect, localRun()), {
    status: "absent",
  });
  assert.equal((await adapter.execute(effect, localRun())).status, "observed");
  assert.equal(topology.executions, 1);
});

test("controller acquire and release execute and reconcile emit strict unitless observations", async () => {
  const state = localRun();
  for (const kind of ["acquire", "release"] as const) {
    const transition = controllerSlotTransition(state, kind);
    let executions = 0;
    let reconciliations = 0;
    const topology: ControllerTransitionRecoveryPort = {
      async executeControllerTransition(actual) {
        executions += 1;
        assert.deepEqual(actual, transition);
        return { status: "observed" };
      },
      async reconcileControllerTransition(actual) {
        reconciliations += 1;
        assert.deepEqual(actual, transition);
        return { status: "observed" };
      },
    };
    const effect = {
      effectId: `effect-controller-${kind}`,
      idempotencyKey: `key-controller-${kind}`,
      kind: `controller_${kind}`,
      params: {
        controllerFencingToken: state.controllerFencingToken,
        holder: state.controller.holder,
        ...(kind === "acquire"
          ? {
              promptHash: state.controller.promptHash,
              requestedModel: state.controller.requestedModel,
              returnedModel: state.controller.returnedModel,
            }
          : {}),
        slotTransition: transition,
      },
      paramsHash: HASH,
      schemaVersion: 1,
      unitId: null,
    } as ProtocolEffect;
    const adapter = createProductionRecoveryEffectAdapter({
      git: {
        repository,
        runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
      },
      topology,
    });

    for (const operation of ["execute", "reconcile"] as const) {
      const result = await adapter[operation](effect, state);
      assert.equal(result.status, "observed", `${kind} ${operation}`);
      if (result.status !== "observed") continue;
      const observation = result.observation;
      assert.equal("unitId" in observation, false);
      assert.equal("effectId" in observation, true);
      assert.equal("effectKind" in observation, true);
      if (!("effectId" in observation && "effectKind" in observation)) continue;
      assert.equal(observation.effectId, effect.effectId);
      assert.equal(observation.effectKind, effect.kind);
      assert.equal(
        observation.type,
        kind === "acquire" ? "controller_acquired" : "controller_released",
      );
      const parsed = validate(ProtocolEventSchema, observation);
      assert.equal(
        parsed.ok,
        true,
        parsed.ok ? undefined : parsed.errors.join("; "),
      );
    }
    assert.equal(executions, 1);
    assert.equal(reconciliations, 1);
  }
});

test("local integration recovery verifies repository identity and uses the canonical branch ref", async () => {
  const answers: Record<string, string | undefined> = {};
  verified(answers);
  answers["for-each-ref --format=%(objectname) refs/heads/main"] = `${OID_B}\n`;
  const calls: string[] = [];
  const adapter = createProductionRecoveryEffectAdapter({
    git: { repository, runner: runner(answers, calls) },
  });
  assert.equal(
    (await adapter.reconcile(localIntegrationEffect(), localRun())).status,
    "observed",
  );
  assert.ok(
    calls.includes("for-each-ref --format=%(objectname) refs/heads/main"),
  );

  const mismatch: Record<string, string | undefined> = {};
  verified(mismatch);
  mismatch["rev-parse --git-common-dir"] = "/foreign/.git\n";
  mismatch["for-each-ref --format=%(objectname) refs/heads/main"] =
    `${OID_B}\n`;
  assert.deepEqual(
    await createProductionRecoveryEffectAdapter({
      git: { repository, runner: runner(mismatch, []) },
    }).reconcile(localIntegrationEffect(), localRun()),
    { status: "ambiguous" },
  );
});

test("local integration treats only the durable base as positive pre-act absence", async () => {
  let head = OID_A;
  const calls: string[] = [];
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async ({ argv }) => {
        const call = argv.join(" ");
        calls.push(call);
        if (call === "rev-parse --git-common-dir")
          return { exitCode: 0, signal: null, stdout: ".git\n" };
        if (call === "rev-parse --show-object-format")
          return { exitCode: 0, signal: null, stdout: "sha1\n" };
        if (argv[0] === "config")
          return { exitCode: 1, signal: null, stdout: "" };
        if (argv[0] === "for-each-ref")
          return { exitCode: 0, signal: null, stdout: `${head}\n` };
        if (argv[0] === "symbolic-ref")
          return { exitCode: 0, signal: null, stdout: "refs/heads/main\n" };
        if (argv[0] === "status")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "merge-base")
          return { exitCode: 1, signal: null, stdout: "" };
        if (argv[0] === "merge") {
          head = OID_B;
          return { exitCode: 0, signal: null, stdout: "" };
        }
        return { exitCode: 1, signal: null, stdout: "" };
      },
    },
  });
  assert.deepEqual(
    await adapter.reconcile(localIntegrationEffect(), localRun()),
    {
      status: "absent",
    },
  );
  assert.equal(
    (await adapter.execute(localIntegrationEffect(), localRun())).status,
    "observed",
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith("merge ")),
    [`merge --ff-only ${OID_B}`],
  );

  assert.equal(
    (await adapter.reconcile(localIntegrationEffect(), localRun())).status,
    "observed",
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith("merge ")),
    [`merge --ff-only ${OID_B}`],
  );

  // A readable ref that moved past the base, with the candidate provably not
  // beneath it, is an exact refusal bound to that head; an unreadable ref is
  // still ambiguous. Neither runs a merge.
  head = OID_A.replace(/^a/u, "c");
  const refused = await adapter.reconcile(localIntegrationEffect(), localRun());
  assert.equal(refused.status, "observed");
  if (refused.status === "observed") {
    assert.equal(refused.observation.type, "integrate_refused");
    assert.equal(
      "integrationOid" in refused.observation &&
        refused.observation.integrationOid,
      head,
    );
  }
  head = "";
  assert.equal(
    (await adapter.reconcile(localIntegrationEffect(), localRun())).status,
    "ambiguous",
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith("merge ")),
    [`merge --ff-only ${OID_B}`],
  );
});

test("production recovery resumes a persisted local integration intent once after pre-act crash", async () => {
  let state = integrationIntentRun("local-ff");
  assert.deepEqual(runInvariantErrors(state), []);
  let root = makeRootProjection(state);
  let children = [makeChildProjection(root, "unit-1")!];
  let head = OID_A;
  let merges = 0;
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
      return this.compareAndSet(batch);
    },
  };
  const gitRunner: GitRunner = async ({ argv }) => {
    const call = argv.join(" ");
    if (call === "rev-parse --git-common-dir")
      return { exitCode: 0, signal: null, stdout: ".git\n" };
    if (call === "rev-parse --show-object-format")
      return { exitCode: 0, signal: null, stdout: "sha1\n" };
    if (argv[0] === "config") return { exitCode: 1, signal: null, stdout: "" };
    if (argv[0] === "for-each-ref")
      return { exitCode: 0, signal: null, stdout: `${head}\n` };
    if (argv[0] === "symbolic-ref")
      return { exitCode: 0, signal: null, stdout: "refs/heads/main\n" };
    if (argv[0] === "status") return { exitCode: 0, signal: null, stdout: "" };
    if (argv[0] === "merge") {
      merges += 1;
      head = OID_B;
      return { exitCode: 0, signal: null, stdout: "" };
    }
    return { exitCode: 1, signal: null, stdout: "" };
  };
  const options = {
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: {
        async release() {
          return { status: "released" as const };
        },
      },
    }),
    git: { repository, runner: gitRunner },
    nonce: "nonce-integrate-crash",
    preOwnership: store,
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store,
  };
  // `root` is the durable integrate intent left by a process that died after
  // persistence and before it could invoke Git. The replacement controller
  // must use the exact base as its sole retry authority.
  const resumed = createProductionRecoveryRunner(options);
  assert.equal((await resumed()).status, "idle");
  assert.equal(merges, 1);
  assert.equal(root.run.effectJournal.at(-1)?.status, "observed");
});

for (const checkout of ["dirty", "foreign"] as const)
  test(`${checkout} integration checkout refuses the integrate intent and the next clean pass lands`, async () => {
    const state = integrationIntentRun("local-ff");
    assert.deepEqual(runInvariantErrors(state), []);
    let root = makeRootProjection(state);
    let children = [makeChildProjection(root, "unit-1")!];
    let head = OID_A;
    let merges = 0;
    // Both conditions are read before the local fast-forward can run.
    let porcelain = checkout === "dirty" ? " M src/index.ts\u0000" : "";
    let checkoutRef =
      checkout === "foreign" ? "refs/heads/foreign" : "refs/heads/main";
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
        return this.compareAndSet(batch);
      },
    };
    const gitRunner: GitRunner = async ({ argv }) => {
      const call = argv.join(" ");
      if (call === "rev-parse --git-common-dir")
        return { exitCode: 0, signal: null, stdout: ".git\n" };
      if (call === "rev-parse --show-object-format")
        return { exitCode: 0, signal: null, stdout: "sha1\n" };
      if (argv[0] === "config")
        return { exitCode: 1, signal: null, stdout: "" };
      if (argv[0] === "for-each-ref")
        return { exitCode: 0, signal: null, stdout: `${head}\n` };
      if (argv[0] === "symbolic-ref")
        return { exitCode: 0, signal: null, stdout: `${checkoutRef}\n` };
      if (argv[0] === "status")
        return { exitCode: 0, signal: null, stdout: porcelain };
      if (argv[0] === "merge") {
        merges += 1;
        head = OID_B;
        return { exitCode: 0, signal: null, stdout: "" };
      }
      return { exitCode: 1, signal: null, stdout: "" };
    };
    const runner = createProductionRecoveryRunner({
      acquireOperationLock: async () => ({
        status: "acquired" as const,
        lock: {
          async release() {
            return { status: "released" as const };
          },
        },
      }),
      git: { repository, runner: gitRunner },
      nonce: `nonce-integrate-${checkout}`,
      preOwnership: store,
      proveTopology: async () => ({
        commonDir: repository.commonDir,
        holder: state.controller.holder,
        scope: {
          beadsStoreIdentity: state.storeIdentity,
          gitRepositoryIdentity: repository.identity,
          integrationBranch: state.integrationBranch,
        },
      }),
      store,
    });

    // The checkout is a named refusal, not an unresolved act: the intent
    // settles, no merge runs, and the unit is approved again rather than
    // blocked behind an ambiguity that the next pass would call corrupt.
    assert.equal((await runner()).status, "idle");
    assert.equal(merges, 0);
    assert.equal(head, OID_A);
    const refusal = root.run.effectJournal.at(-1)!;
    assert.equal(refusal.kind, "integrate");
    assert.equal(refusal.status, "observed");
    assert.equal(root.run.units["unit-1"]?.state, "approved");
    assert.equal(root.run.integrationOwnerUnitId, undefined);
    assert.equal(root.run.units["unit-1"]?.landedOid, undefined);
    assert.deepEqual(runInvariantErrors(root.run), []);
    const adapter = createProductionRecoveryEffectAdapter({
      git: { repository, runner: gitRunner },
    });
    // Reconciliation sees the durable base; execution then classifies the
    // checkout precondition without attempting a merge.
    assert.equal(
      (await adapter.reconcile(localIntegrationEffect(), state)).status,
      "absent",
    );
    const direct = await adapter.execute(localIntegrationEffect(), state);
    assert.equal(direct.status, "observed");
    if (direct.status === "observed") {
      assert.equal(direct.observation.type, "integrate_refused");
      const refusedObservation = direct.observation;
      if (refusedObservation.type !== "integrate_refused") return;
      assert.equal(
        refusedObservation.reason,
        checkout === "dirty"
          ? "integration_checkout_dirty"
          : "integration_checkout_foreign",
      );
      assert.equal(validate(ProtocolEventSchema, refusedObservation).ok, true);
    }
    // A repeat pass finds nothing unsettled and never retries the merge blindly.
    assert.equal((await runner()).status, "idle");
    assert.equal(merges, 0);

    // The controller cleans the checkout; a bd passive export may still churn.
    porcelain = " M .beads/interactions.jsonl\u0000";
    checkoutRef = "refs/heads/main";
    const applied = await runner(event(root.run, "integrate_intent"));
    assert.equal(applied.status, "applied", JSON.stringify(applied));
    assert.equal(merges, 1);
    assert.equal(head, OID_B);
    assert.equal(root.run.units["unit-1"]?.state, "landed");
    assert.equal(root.run.units["unit-1"]?.landedOid, OID_B);
    assert.equal(root.run.effectJournal.at(-1)?.status, "observed");
    assert.deepEqual(runInvariantErrors(root.run), []);
  });

test("production recovery resumes a persisted remote integration intent with one guarded push", async () => {
  let state = integrationIntentRun("remote-ff");
  assert.deepEqual(runInvariantErrors(state), []);
  let root = makeRootProjection(state);
  let children = [makeChildProjection(root, "unit-1")!];
  let remoteHead = OID_A;
  let pushes = 0;
  const calls: string[] = [];
  const remoteRepository: GitRepository = {
    ...repository,
    identity: remoteRepositoryIdentity,
    remoteUrls: ["https://example.invalid/repo.git"],
  };
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
      return this.compareAndSet(batch);
    },
  };
  const gitRunner: GitRunner = async ({ argv }) => {
    calls.push(argv.join(" "));
    if (argv[0] === "rev-parse")
      return argv[1] === "--git-common-dir"
        ? { exitCode: 0, signal: null, stdout: ".git\n" }
        : { exitCode: 0, signal: null, stdout: "sha1\n" };
    if (argv[0] === "config")
      return {
        exitCode: 0,
        signal: null,
        stdout: "remote.origin.url\nhttps://example.invalid/repo.git\u0000",
      };
    if (argv[0] === "remote")
      return {
        exitCode: 0,
        signal: null,
        stdout: "https://example.invalid/repo.git\n",
      };
    if (argv[0] === "ls-remote")
      return {
        exitCode: 0,
        signal: null,
        stdout: `${remoteHead}\trefs/heads/main\n`,
      };
    if (argv[0] === "-c") {
      pushes += 1;
      remoteHead = OID_B;
      return { exitCode: 0, signal: null, stdout: "" };
    }
    return { exitCode: 1, signal: null, stdout: "" };
  };
  const recovery = createProductionRecoveryRunner({
    acquireOperationLock: async () => ({
      status: "acquired" as const,
      lock: {
        async release() {
          return { status: "released" as const };
        },
      },
    }),
    git: { remote: "origin", repository: remoteRepository, runner: gitRunner },
    nonce: "nonce-remote-integrate-crash",
    preOwnership: store,
    proveTopology: async () => ({
      commonDir: remoteRepository.commonDir,
      holder: state.controller.holder,
      scope: {
        beadsStoreIdentity: state.storeIdentity,
        gitRepositoryIdentity: remoteRepository.identity,
        integrationBranch: state.integrationBranch,
      },
    }),
    store,
  });
  assert.equal((await recovery()).status, "idle", calls.join("\n"));
  assert.equal(pushes, 1);
  assert.equal(root.run.effectJournal.at(-1)?.status, "observed");
  assert.equal((await recovery()).status, "idle");
  assert.equal(pushes, 1);
});

test("composition rejects an exact common-dir/scope/run mismatch before lock or store access", async () => {
  let locks = 0;
  let loads = 0;
  let gitCalls = 0;
  const runner = createProductionRecoveryRunner({
    acquireOperationLock: async () => {
      locks += 1;
      return { status: "unavailable" as const };
    },
    git: {
      repository,
      runner: async () => {
        gitCalls += 1;
        return { exitCode: 1, signal: null, stdout: "" };
      },
    },
    initialRun: localRun(),
    nonce: "nonce-proof-mismatch",
    preOwnership: {
      async load() {
        loads += 1;
        return { status: "unavailable" as const };
      },
    } as never,
    proveTopology: async () => ({
      commonDir: "/foreign/.git",
      holder: localRun().controller.holder,
      scope: {
        beadsStoreIdentity: localRun().storeIdentity,
        gitRepositoryIdentity: "local:/foreign/.git",
        integrationBranch: localRun().integrationBranch,
      },
    }),
    store: {
      async load() {
        loads += 1;
        return { status: "unavailable" as const };
      },
    } as never,
  });

  assert.deepEqual(await runner(), { status: "unavailable" });
  assert.equal(locks, 0);
  assert.equal(loads, 0);
  assert.equal(gitCalls, 0);
});

test("loaded SHA-256 run is refused before recovery persistence or Git action", async () => {
  const initial = localRun();
  const loadedRun = {
    ...initial,
    gitObjectFormat: "sha256" as const,
    units: {
      "unit-1": {
        ...initial.units["unit-1"]!,
        baseOid: "a".repeat(64),
      },
    },
  };
  const root = makeRootProjection(loadedRun);
  const children = [makeChildProjection(root, "unit-1")!];
  let mutations = 0;
  const calls: string[] = [];
  const runner = createProductionRecoveryRunner({
    acquireOperationLock: async () => ({
      status: "acquired",
      lock: {
        async release() {
          return { status: "released" as const };
        },
      },
    }),
    git: {
      repository,
      runner: async ({ argv }) => {
        calls.push(argv.join(" "));
        if (argv.join(" ") === "rev-parse --git-common-dir")
          return { exitCode: 0, signal: null, stdout: ".git\n" };
        if (argv.join(" ") === "rev-parse --show-object-format")
          return { exitCode: 0, signal: null, stdout: "sha1\n" };
        return { exitCode: 1, signal: null, stdout: "" };
      },
    },
    nonce: "nonce-loaded-format",
    preOwnership: {
      async persistControllerAcquireIntent() {
        mutations += 1;
        return { status: "unavailable" as const };
      },
    },
    proveTopology: async () => ({
      commonDir: repository.commonDir,
      holder: loadedRun.controller.holder,
      scope: {
        beadsStoreIdentity: loadedRun.storeIdentity,
        gitRepositoryIdentity: repository.identity,
        integrationBranch: loadedRun.integrationBranch,
      },
    }),
    store: {
      async compareAndSet() {
        mutations += 1;
        return { status: "unavailable" as const };
      },
      async load() {
        return { status: "observed" as const, value: { children, root } };
      },
    } as never,
  });

  assert.deepEqual(await runner(), { status: "unavailable" });
  assert.equal(mutations, 0);
  assert.equal(
    calls.some((call) => /^(?:branch|worktree|push|merge)\b/u.test(call)),
    false,
  );
});

test("loaded repository, scope, and holder mismatches fail before persistence", async () => {
  const initial = localRun();
  const mismatches: readonly RepositoryRun[] = [
    { ...initial, repositoryIdentity: "local:/foreign/.git" },
    { ...initial, storeIdentity: "foreign-store" },
    { ...initial, integrationBranch: "foreign-main" },
    {
      ...initial,
      controller: {
        ...initial.controller,
        holder: "other-run/other-incarnation",
        incarnationId: "other-incarnation",
        runId: "other-run",
      },
    },
  ];
  for (const loadedRun of mismatches) {
    const root = makeRootProjection(loadedRun);
    const children = [makeChildProjection(root, "unit-1")!];
    let mutations = 0;
    const recovery = createProductionRecoveryRunner({
      acquireOperationLock: async () => ({
        status: "acquired",
        lock: {
          async release() {
            return { status: "released" as const };
          },
        },
      }),
      git: {
        repository,
        runner: async ({ argv }) => {
          if (argv.join(" ") === "rev-parse --git-common-dir")
            return { exitCode: 0, signal: null, stdout: ".git\n" };
          if (argv.join(" ") === "rev-parse --show-object-format")
            return { exitCode: 0, signal: null, stdout: "sha1\n" };
          return { exitCode: 1, signal: null, stdout: "" };
        },
      },
      nonce: "nonce-loaded-binding",
      preOwnership: {
        async persistControllerAcquireIntent() {
          mutations += 1;
          return { status: "unavailable" as const };
        },
      },
      proveTopology: async () => ({
        commonDir: repository.commonDir,
        holder: initial.controller.holder,
        scope: {
          beadsStoreIdentity: initial.storeIdentity,
          gitRepositoryIdentity: repository.identity,
          integrationBranch: initial.integrationBranch,
        },
      }),
      store: {
        async compareAndSet() {
          mutations += 1;
          return { status: "unavailable" as const };
        },
        async load() {
          return { status: "observed" as const, value: { children, root } };
        },
      } as never,
    });
    assert.deepEqual(
      await recovery(),
      { status: "unavailable" },
      JSON.stringify({
        holder: loadedRun.controller.holder,
        repositoryIdentity: loadedRun.repositoryIdentity,
        storeIdentity: loadedRun.storeIdentity,
        integrationBranch: loadedRun.integrationBranch,
      }),
    );
    assert.equal(mutations, 0);
  }
});

test("production command composition resumes an authoritative branch intent through the CLI", async () => {
  let state = localRun();
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
  state = transition(
    state,
    event(state, "branch_intent", { branchRef: "sce/unit-1" }),
    reduce,
  );
  let root = makeRootProjection(state);
  let children = [makeChildProjection(root, "unit-1")!];
  const store = {
    async load() {
      return { status: "observed" as const, value: { children, root } };
    },
    async persistControllerAcquireIntent(batch: MutationBatch) {
      return this.compareAndSet(batch);
    },
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
  };
  let created = false;
  const calls: string[] = [];
  const gitRunner: GitRunner = async ({ argv }) => {
    calls.push(argv.join(" "));
    if (argv[0] === "rev-parse" && argv[1] === "--git-common-dir")
      return { exitCode: 0, signal: null, stdout: ".git\n" };
    if (argv[0] === "rev-parse" && argv[1] === "--show-object-format")
      return { exitCode: 0, signal: null, stdout: "sha1\n" };
    if (argv[0] === "config") return { exitCode: 1, signal: null, stdout: "" };
    if (argv[0] === "for-each-ref")
      return {
        exitCode: 0,
        signal: null,
        stdout: created ? `${OID_A}\n` : "",
      };
    if (argv[0] === "branch") {
      created = true;
      return { exitCode: 0, signal: null, stdout: "" };
    }
    return { exitCode: 1, signal: null, stdout: "" };
  };
  const cli = await runCli(["status", "--json"], {
    runner: createProductionRecoveryCommandRunner({
      acquireOperationLock: async () => ({
        status: "acquired",
        lock: {
          async release() {
            return { status: "released" as const };
          },
        },
      }),
      git: { repository, runner: gitRunner },
      nonce: "nonce-cli-1",
      preOwnership: store,
      proveTopology: async () => ({
        commonDir: "/repo/.git",
        holder: "run-1/incarnation-1",
        scope: {
          beadsStoreIdentity: "store-1",
          gitRepositoryIdentity: repository.identity,
          integrationBranch: "main",
        },
      }),
      store,
    }),
  });
  assert.equal(cli.exitCode, 0);
  assert.equal(root.run.units["unit-1"]?.state, "branch_observed");
  assert.deepEqual(
    calls.filter((call) => call.startsWith("branch ")),
    [`branch sce/unit-1 ${OID_A}`],
  );
});

test("reservations are journal-only effects: execute observes them and resume finds them absent", async () => {
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
    },
  });
  const state = localRun();
  for (const kind of ["reservation_acquire", "reservation_release"] as const) {
    const effect = {
      effectId: `effect-${kind}`,
      idempotencyKey: `key-${kind}`,
      kind,
      params: {},
      paramsHash: HASH,
      schemaVersion: 1,
      unitId: "unit-1",
    } as unknown as ProtocolEffect;
    assert.equal(adapter.canExecute?.(effect), true);
    assert.equal(adapter.canReconcile?.(effect), true);
    assert.deepEqual(await adapter.reconcile(effect, state), {
      status: "absent",
    });
    const executed = await adapter.execute(effect, state);
    assert.equal(executed.status, "observed");
    if (executed.status !== "observed") return;
    assert.equal(
      executed.observation.type,
      kind === "reservation_acquire"
        ? "reservation_observed"
        : "reservation_released",
    );
    assert.equal(executed.observation.unitId, "unit-1");
    assert.equal(
      "effectId" in executed.observation && executed.observation.effectId,
      effect.effectId,
    );
  }
});

test("a maximum-length effect ID recovers under a bounded, distinct event ID", async () => {
  const answers: Record<string, string | undefined> = {};
  verified(answers);
  let created = false;
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async ({ argv }) => {
        if (argv[0] === "branch") {
          created = true;
          return { exitCode: 0, signal: null, stdout: "" };
        }
        if (argv[0] === "for-each-ref")
          return {
            exitCode: 0,
            signal: null,
            stdout: created ? `${OID_A}\n` : "",
          };
        const stdout = answers[argv.join(" ")];
        return {
          exitCode: stdout === undefined ? 1 : 0,
          signal: null,
          stdout: stdout ?? "",
        };
      },
    },
  });
  const effectId = "x".repeat(192);
  const effect = { ...branchEffect(), effectId } as ProtocolEffect;
  const state = localRun();

  const executed = await adapter.execute(effect, state);
  assert.equal(executed.status, "observed");
  if (executed.status !== "observed") return;
  const reconciled = await adapter.reconcile(effect, state);
  assert.equal(reconciled.status, "observed");
  if (reconciled.status !== "observed") return;

  // A durable effect ID may be 192 characters, so the legacy `recover-${id}`
  // event ID would be 200: past the 160-character identifier bound. The
  // production path emits the domain-separated digest instead, and the
  // emitted observation must still validate as a protocol event.
  const eventId = `recover-${sha256(
    canonicalJson({ domain: "sce.recovery-event.v1", effectId }),
  )}`;
  assert.equal(eventId.length, 72);
  for (const observation of [executed.observation, reconciled.observation]) {
    assert.equal(observation.eventId, eventId);
    assert.equal("effectId" in observation && observation.effectId, effectId);
    assert.deepEqual(
      validate<ProtocolEvent>(ProtocolEventSchema, observation).errors,
      [],
    );
  }

  // Maximal IDs that differ only in their last character stay distinct.
  const sibling = {
    ...effect,
    effectId: `${effectId.slice(0, 191)}y`,
  } as ProtocolEffect;
  const siblingExecuted = await adapter.execute(sibling, state);
  assert.equal(siblingExecuted.status, "observed");
  if (siblingExecuted.status !== "observed") return;
  assert.notEqual(siblingExecuted.observation.eventId, eventId);
  assert.equal(siblingExecuted.observation.eventId.length, 72);
});
