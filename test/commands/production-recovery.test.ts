import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionRecoveryEffectAdapter,
  createProductionRecoveryRunner,
  type ControllerTransitionRecoveryPort,
} from "../../src/commands/production-recovery.js";
import { createProductionRecoveryCommandRunner } from "../../src/commands/index.js";
import type { GitRepository, GitRunner } from "../../src/adapters/git/index.js";
import {
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
} from "../../src/fencing/index.js";
import {
  deriveCandidateDiffHash,
  reduce,
  runInvariantErrors,
  type ProtocolEffect,
} from "../../src/protocol/reducer.js";
import type { RepositoryRun } from "../../src/protocol/schemas.js";
import { runCli } from "../../src/cli.js";
import {
  event,
  HASH,
  OID_A,
  OID_B,
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
  if (integrationProfile === "remote-ff") {
    state = transition(state, event(state, "publish_intent"), reduce);
    observe("publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
  }
  return transition(state, event(state, "integrate_intent"), reduce);
}

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

test("production candidate collection and manual verification bind exact durable facts", async () => {
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
            stdout: `worktree /task\nHEAD ${OID_B}\nbranch refs/heads/sce/unit-1\n\n`,
          };
        if (argv[0] === "status")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "symbolic-ref")
          return {
            exitCode: 0,
            signal: null,
            stdout: "refs/heads/sce/unit-1\n",
          };
        if (argv[0] === "merge-base")
          return { exitCode: 0, signal: null, stdout: "" };
        if (argv[0] === "diff")
          return {
            exitCode: 0,
            signal: null,
            stdout:
              argv[1] === "--name-only"
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
                    ? `${OID_B}\n`
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
  assert.equal(collected.status, "observed");
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
        state,
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
        state,
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
    state,
  );
  assert.equal(acknowledged.status, "observed");
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
      runner: async ({ argv }) => {
        if (argv[0] === "config")
          return { exitCode: 1, signal: null, stdout: "" };
        return {
          exitCode: 0,
          signal: null,
          stdout: argv[1] === "--git-common-dir" ? ".git\n" : "sha1\n",
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
  assert.equal((await recovery()).status, "tool_request");
  assert.equal((await recovery()).status, "tool_request");
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

  for (const invalid of [OID_A.replace(/^a/u, "c"), ""] as const) {
    head = invalid;
    assert.equal(
      (await adapter.reconcile(localIntegrationEffect(), localRun())).status,
      "ambiguous",
    );
  }
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
