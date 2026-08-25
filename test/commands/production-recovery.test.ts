import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionRecoveryEffectAdapter,
  type ControllerTransitionRecoveryPort,
} from "../../src/commands/production-recovery.js";
import { createProductionRecoveryCommandRunner } from "../../src/commands/index.js";
import type { GitRepository, GitRunner } from "../../src/adapters/git/index.js";
import {
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
} from "../../src/fencing/index.js";
import { reduce, type ProtocolEffect } from "../../src/protocol/reducer.js";
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

function branchEffect(): ProtocolEffect {
  return {
    effectId: "effect-1",
    idempotencyKey: "key-1",
    kind: "branch_create",
    params: { baseOid: OID_A, branchRef: "sce/unit-1" },
    paramsHash: HASH,
    schemaVersion: 1,
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

  assert.deepEqual(await adapter.reconcile(branchEffect(), run()), {
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

test("foreign and unreadable branch discoveries are privacy-safe ambiguity", async () => {
  const foreign: Record<string, string | undefined> = {};
  verified(foreign);
  foreign[`for-each-ref --format=%(objectname) refs/heads/sce/unit-1`] =
    `${OID_B}\n`;
  const foreignResult = await createProductionRecoveryEffectAdapter({
    git: { repository, runner: runner(foreign, []) },
  }).reconcile(branchEffect(), run());
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
  }).reconcile(branchEffect(), run());
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

  const result = await adapter.execute(branchEffect(), run());
  assert.equal(result.status, "observed");
  assert.deepEqual(
    calls.filter((call) => call.startsWith("branch ")),
    [`branch sce/unit-1 ${OID_A}`],
  );
});

test("controller topology is explicit and reconcile never executes its mutator", async () => {
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
      slotTransition: { bad: "not-used-by-port" },
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

  assert.deepEqual(await adapter.reconcile(effect, run()), {
    status: "absent",
  });
  assert.equal(executions, 0);
  assert.equal((await adapter.execute(effect, run())).status, "observed");
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
    (await adapter.reconcile(localIntegrationEffect(), run())).status,
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
    }).reconcile(localIntegrationEffect(), run()),
    { status: "ambiguous" },
  );
});

test("production command composition resumes an authoritative branch intent through the CLI", async () => {
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
          gitRepositoryIdentity: "repo-1",
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
