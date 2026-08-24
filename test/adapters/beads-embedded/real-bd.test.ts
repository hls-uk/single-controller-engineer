import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  type EmbeddedProcessPort,
  type EmbeddedRequest,
  type EmbeddedResponse,
  PinnedBdEmbeddedProcess,
  PROJECTION_INITIALIZATION_AUTHORITY,
} from "../../../src/adapters/beads-embedded/index.js";
import {
  deriveScopeCommitment,
  makeRootProjection,
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import { deriveIdempotencyKey, reduce } from "../../../src/protocol/reducer.js";
import { run as fixtureRun } from "../../protocol/fixtures.js";

const execute = promisify(execFile);

async function run(cwd: string, command: string, args: readonly string[]) {
  return execute(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "/private/tmp",
      TZ: "UTC",
    },
    maxBuffer: 262_144,
    timeout: 15_000,
  });
}

async function json(cwd: string, args: readonly string[]) {
  const { stdout } = await run(cwd, "bd", args);
  return JSON.parse(stdout) as unknown;
}

class RecordingProcess implements EmbeddedProcessPort {
  public readonly requests: EmbeddedRequest[] = [];
  public readonly identity;

  public constructor(private readonly delegate: EmbeddedProcessPort) {
    this.identity = delegate.identity;
  }

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    return this.delegate.execute(request);
  }
}

test("pinned bd local embedded slot and Dolt working-set fixture", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-bd-");
  try {
    await run(root, "git", ["init", "-q"]);
    await run(root, "bd", [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      "",
    ]);
    const show = await json(root, ["dolt", "show", "--json"]);
    assert.deepEqual(show, {
      backend: "dolt",
      data_dir: join(root, ".beads", "embeddeddolt"),
      database: "sce",
      embedded: true,
      schema_version: 1,
    });
    await json(root, ["merge-slot", "create", "--json"]);
    await json(root, ["create", "--id", "sce-root", "root", "--json"]);
    const scope = {
      beadsStoreIdentity: "store-1",
      gitRepositoryIdentity: "repo-1",
      integrationBranch: "main",
    };
    await json(root, [
      "update",
      "sce-merge-slot",
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      "--design",
      JSON.stringify(scope),
      "--json",
    ]);
    const acquired = await json(root, [
      "--actor",
      "run-1/incarnation-1",
      "merge-slot",
      "acquire",
      "--json",
    ]);
    assert.deepEqual(acquired, {
      acquired: true,
      holder: "run-1/incarnation-1",
      id: "sce-merge-slot",
    });
    const held = await json(root, [
      "show",
      "sce-merge-slot",
      "--long",
      "--json",
    ]);
    const heldSlot = (held as readonly Record<string, unknown>[])[0];
    assert.equal(heldSlot?.design, JSON.stringify(scope));
    assert.equal(
      heldSlot?.external_ref,
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
    );
    assert.deepEqual(heldSlot?.metadata, { holder: "run-1/incarnation-1" });
    const second = await run(root, "bd", [
      "--actor",
      "run-2/incarnation-1",
      "merge-slot",
      "acquire",
      "--json",
    ]).catch(() => undefined);
    assert.equal(second, undefined);
    await json(root, [
      "--actor",
      "run-1/incarnation-1",
      "merge-slot",
      "release",
      "--json",
    ]);
    const database = join(root, ".beads", "embeddeddolt", "sce");
    const status = await run(database, "dolt", [
      "sql",
      "-r",
      "json",
      "-q",
      "SELECT * FROM dolt_status",
    ]);
    assert.deepEqual(JSON.parse(status.stdout), {});

    const base = fixtureRun([]);
    const initial = {
      ...base,
      controller: { ...base.controller, state: "unacquired" as const },
      state: "initializing" as const,
    };
    const transition = reduce(initial, {
      eventId: "controller-acquire",
      expectedRevision: 0,
      idempotencyKey: deriveIdempotencyKey(
        initial,
        initial.revision,
        null,
        "controller_acquire",
      ),
      type: "controller_acquire_intent",
    });
    assert.equal(transition.ok, true);
    if (!transition.ok) throw new Error("unreachable");
    const before = makeRootProjection(initial);
    const rootProjection = withBatchCheckpoint(
      makeRootProjection(transition.nextState),
      [],
    );
    const batch = {
      changedRows: [],
      checkpoint: rootProjection.checkpoint,
      expectedAggregateCommitment: before.aggregateCommitment,
      expectedAggregateRevision: before.aggregateRevision,
      expectedChildren: [],
      expectedHolder: initial.controller.holder,
      holder: initial.controller.holder,
      next: { children: [], root: rootProjection },
      schema: "sce.fencing.batch" as const,
      scope: rootProjection.scope,
      version: 1 as const,
    };
    const persistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: database,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    assert.equal(
      (await persistence.initialize(PROJECTION_INITIALIZATION_AUTHORITY, batch))
        .value,
      "applied",
    );
    assert.deepEqual(await persistence.readback(batch), {
      children: [],
      root: rootProjection,
    });
    const restarted = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: database,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    assert.equal(
      (
        await restarted.discover({
          batch,
          kind: "discover",
          point: "after_commit",
        })
      )?.status,
      "observed",
    );
    assert.equal((await persistence.mutate(batch)).value, "stale");

    await run(root, "bd", ["dolt", "commit", "--json"]);
    const embeddedProcess = new PinnedBdEmbeddedProcess({
      bdExecutable: "/opt/homebrew/bin/bd",
      cwd: root,
      databaseDirectory: database,
      doltExecutable: "/opt/homebrew/bin/dolt",
      prefix: "sce",
      projections: restarted,
      scope,
    });
    await json(root, [
      "update",
      "sce-merge-slot",
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      "--design",
      JSON.stringify(scope),
      "--json",
    ]);
    const processState = await embeddedProcess.execute({ kind: "state" });
    assert.equal(processState.kind, "state");
    assert.equal(processState.value.reachable, true);
    const adapter = new EmbeddedBeadsAdapter({
      holder: "run-1/incarnation-1",
      mode: "local-only",
      prefix: "sce",
      preflight: {
        payload: {
          beads: {
            beadsDir: join(root, ".beads"),
            contextSchemaVersion: 1,
            database: "sce",
            mode: "embedded",
            prefix: "sce",
            provenance: "embedded_config",
            storePath: join(root, ".beads", "embeddeddolt"),
            toolVersion: "1.1.0",
          },
          git: {
            commonDir: join(root, ".git"),
            identity: "repo-1",
            objectFormat: "sha1",
            topLevel: root,
          },
          status: "ready",
        },
        schema: "sce.preflight",
        version: 1,
      },
      process: embeddedProcess,
      scope,
    });
    assert.equal((await adapter.acquire()).code, "applied");
    assert.equal((await adapter.compareAndSet(batch)).status, "applied");
    assert.equal((await adapter.release()).code, "applied");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pinned process and adapter synchronize a batch across two embedded clones", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-sync-");
  const remote = join(root, "remote.git");
  const first = join(root, "first");
  const second = join(root, "second");
  try {
    await run(root, "git", ["init", "-q", "--bare", remote]);
    await run(root, "git", ["clone", "-q", remote, first]);
    await run(first, "git", ["config", "user.email", "test@example.invalid"]);
    await run(first, "git", ["config", "user.name", "test"]);
    await run(first, "git", ["commit", "--allow-empty", "-qm", "initial"]);
    await run(first, "git", ["push", "-q", "origin", "HEAD:main"]);
    await run(first, "bd", [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      `file://${remote}`,
    ]);
    await json(first, ["merge-slot", "create", "--json"]);
    await json(first, ["create", "--id", "sce-root", "root", "--json"]);
    const scope = {
      beadsStoreIdentity: "store-1",
      gitRepositoryIdentity: "repo-1",
      integrationBranch: "main",
    };
    await json(first, [
      "update",
      "sce-merge-slot",
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      "--design",
      JSON.stringify(scope),
      "--json",
    ]);
    const firstDatabase = join(first, ".beads", "embeddeddolt", "sce");
    const base = fixtureRun([]);
    const initial = {
      ...base,
      controller: { ...base.controller, state: "unacquired" as const },
      state: "initializing" as const,
    };
    const acquired = reduce(initial, {
      eventId: "controller-acquire",
      expectedRevision: initial.revision,
      idempotencyKey: deriveIdempotencyKey(
        initial,
        initial.revision,
        null,
        "controller_acquire",
      ),
      type: "controller_acquire_intent",
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) throw new Error("unreachable");
    const bootstrapRoot = withBatchCheckpoint(
      makeRootProjection(acquired.nextState),
      [],
    );
    const bootstrapBatch = {
      changedRows: [],
      checkpoint: bootstrapRoot.checkpoint,
      expectedAggregateCommitment:
        makeRootProjection(initial).aggregateCommitment,
      expectedAggregateRevision: makeRootProjection(initial).aggregateRevision,
      expectedChildren: [],
      expectedHolder: initial.controller.holder,
      holder: initial.controller.holder,
      next: { children: [], root: bootstrapRoot },
      schema: "sce.fencing.batch" as const,
      scope: bootstrapRoot.scope,
      version: 1 as const,
    };
    const firstPersistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: firstDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    assert.equal(
      (
        await firstPersistence.initialize(
          PROJECTION_INITIALIZATION_AUTHORITY,
          bootstrapBatch,
        )
      ).value,
      "applied",
    );
    await run(first, "bd", ["dolt", "commit", "--json"]);
    await run(first, "bd", ["dolt", "push", "--json"]);
    await run(root, "git", ["clone", "-q", remote, second]);
    await run(second, "bd", [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      `file://${remote}`,
    ]);
    await run(second, "bd", ["dolt", "pull", "--json"]);
    const secondDatabase = join(second, ".beads", "embeddeddolt", "sce");
    assert.equal(acquired.effects.length, 1);
    const settled = reduce(acquired.nextState, {
      eventId: "controller-acquired",
      expectedRevision: acquired.nextState.revision,
      effectId: acquired.effects[0]?.effectId ?? "",
      effectKind: "controller_acquire",
      holder: acquired.nextState.controller.holder,
      controllerFencingToken: acquired.nextState.controllerFencingToken,
      observationHash: "e".repeat(64),
      type: "controller_acquired",
    });
    assert.equal(settled.ok, true);
    if (!settled.ok) throw new Error("unreachable");
    const nextRoot = withBatchCheckpoint(
      makeRootProjection(settled.nextState),
      [],
    );
    const batch = {
      changedRows: [],
      checkpoint: nextRoot.checkpoint,
      expectedAggregateCommitment: bootstrapRoot.aggregateCommitment,
      expectedAggregateRevision: bootstrapRoot.aggregateRevision,
      expectedChildren: [],
      expectedHolder: acquired.nextState.controller.holder,
      holder: acquired.nextState.controller.holder,
      next: { children: [], root: nextRoot },
      schema: "sce.fencing.batch" as const,
      scope: nextRoot.scope,
      version: 1 as const,
    };
    const preflight = (cwd: string) => ({
      payload: {
        beads: {
          beadsDir: join(cwd, ".beads"),
          contextSchemaVersion: 1 as const,
          database: "sce",
          mode: "embedded" as const,
          prefix: "sce",
          provenance: "embedded_config" as const,
          storePath: join(cwd, ".beads", "embeddeddolt"),
          syncRef: "refs/dolt/data",
          syncRemote: `git+file://${remote}`,
          toolVersion: "1.1.0" as const,
        },
        git: {
          commonDir: join(cwd, ".git"),
          identity: "repo-1",
          objectFormat: "sha1" as const,
          topLevel: cwd,
        },
        status: "ready" as const,
      },
      schema: "sce.preflight" as const,
      version: 1 as const,
    });
    const processFor = (
      cwd: string,
      database: string,
      projections: DoltProjectionPersistence,
    ) =>
      new PinnedBdEmbeddedProcess({
        bdExecutable: "/opt/homebrew/bin/bd",
        cwd,
        databaseDirectory: database,
        doltExecutable: "/opt/homebrew/bin/dolt",
        prefix: "sce",
        projections,
        remote: {
          name: "origin",
          ref: "refs/dolt/data",
          url: `git+file://${remote}`,
        },
        scope,
      });
    const firstProcess = processFor(first, firstDatabase, firstPersistence);
    const firstState = await firstProcess.execute({ kind: "state" });
    assert.equal(firstState.kind, "state");
    assert.equal(firstState.value.workingSet, "clean");
    const firstAdapter = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: firstProcess,
      scope,
    });
    assert.equal((await firstAdapter.acquire()).code, "applied");
    const acquiredState = await firstProcess.execute({ kind: "state" });
    const acquiredSlot = await firstProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
    });
    assert.equal(acquiredState.kind, "state");
    assert.equal(acquiredState.value.remoteHead, acquiredState.value.head);
    assert.equal(acquiredSlot.kind, "slot");
    assert.equal(acquiredSlot.value.holder, initial.controller.holder);
    // Crash boundary: the exact batch is written and committed, but the
    // controller process dies before push. A fresh process may only use the
    // journal batch plus local/remote projection discovery to complete it.
    assert.equal((await firstPersistence.mutate(batch)).value, "applied");
    assert.equal(
      (await firstProcess.execute({ kind: "commit" })).value,
      "applied",
    );
    const beforePushPersistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: firstDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    const beforePushProcess = processFor(
      first,
      firstDatabase,
      beforePushPersistence,
    );
    const beforePushDiscovery = await beforePushProcess.execute({
      batch,
      kind: "discover",
      point: "before_push",
    });
    assert.equal(beforePushDiscovery.kind, "discover");
    assert.equal(beforePushDiscovery.value.status, "observed");
    assert.ok(beforePushDiscovery.value.head);
    const recoveredBeforePush = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: beforePushProcess,
      scope,
    });
    assert.equal(
      (await recoveredBeforePush.compareAndSet(batch)).status,
      "applied",
    );

    const restartedPersistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: firstDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    const restartedProcess = processFor(
      first,
      firstDatabase,
      restartedPersistence,
    );
    const discovery = await restartedProcess.execute({
      batch,
      kind: "discover",
      point: "after_push",
    });
    assert.equal(discovery.kind, "discover");
    assert.equal(discovery.value.status, "observed");
    assert.equal(discovery.value.head, discovery.value.remoteHead);

    const secondPersistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: secondDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    const secondProcess = processFor(second, secondDatabase, secondPersistence);
    assert.equal(
      (await secondProcess.execute({ kind: "pull" })).value,
      "applied",
    );
    const heldSlot = await secondProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
    });
    assert.equal(heldSlot.kind, "slot");
    assert.equal(heldSlot.value.holder, initial.controller.holder);
    const contenderCheck = await secondProcess.execute({
      actor: "run-2/incarnation-1",
      kind: "slot",
      action: "check",
    });
    assert.equal(contenderCheck.kind, "slot");
    assert.equal(contenderCheck.value.holder, initial.controller.holder);
    const beforeContenderState = await secondProcess.execute({ kind: "state" });
    const beforeContenderRemote = await secondProcess.execute({
      batch,
      kind: "discover",
      point: "after_push",
    });
    assert.equal(beforeContenderState.kind, "state");
    assert.equal(beforeContenderState.value.workingSet, "clean");
    assert.equal(beforeContenderRemote.kind, "discover");
    assert.equal(beforeContenderRemote.value.status, "observed");
    const contenderPort = new RecordingProcess(secondProcess);
    const competingAdapter = new EmbeddedBeadsAdapter({
      holder: "run-2/incarnation-2",
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(second),
      process: contenderPort,
      scope,
    });
    assert.equal((await competingAdapter.acquire()).code, "blocked");
    assert.equal(
      contenderPort.requests.some(
        (request) =>
          request.kind === "mutation" ||
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterContenderState = await secondProcess.execute({ kind: "state" });
    const afterContenderRemote = await secondProcess.execute({
      batch,
      kind: "discover",
      point: "after_push",
    });
    assert.deepEqual(afterContenderState, beforeContenderState);
    assert.deepEqual(afterContenderRemote, beforeContenderRemote);
    const secondDiscovery = await secondProcess.execute({
      batch,
      kind: "discover",
      point: "after_push",
    });
    assert.equal(secondDiscovery.kind, "discover");
    assert.equal(secondDiscovery.value.status, "observed");
    const wrongMapping = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: secondDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-other",
    });
    assert.equal(
      (
        await wrongMapping.discover({
          batch,
          kind: "discover",
          point: "after_push",
        })
      )?.status,
      undefined,
    );

    const restartAdapter = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: restartedProcess,
      scope,
    });
    assert.equal((await restartAdapter.release()).code, "applied");
    const releasedState = await restartedProcess.execute({ kind: "state" });
    const releasedSlot = await restartedProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
    });
    assert.equal(releasedState.kind, "state");
    assert.equal(releasedState.value.remoteHead, releasedState.value.head);
    assert.equal(releasedSlot.kind, "slot");
    assert.equal(releasedSlot.value.status, "available");
    const remoteWorkerBaseline = await restartAdapter.workerBaseline();
    assert.ok(remoteWorkerBaseline);
    assert.ok(remoteWorkerBaseline.remoteHead);
    assert.equal(
      (await secondProcess.execute({ kind: "pull" })).value,
      "applied",
    );
    const availableSlot = await secondProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
    });
    assert.equal(availableSlot.kind, "slot");
    assert.equal(availableSlot.value.status, "available");

    // A different clone advances only the remote. The first process fetches
    // during its state read and must refuse to bless a worker baseline whose
    // remote head moved while its local checkout stayed untouched.
    await run(second, "bd", [
      "create",
      "--id",
      "sce-worker-remote",
      "worker remote movement",
      "--json",
    ]);
    await run(second, "bd", ["dolt", "push", "--json"]);
    assert.equal(
      (await restartAdapter.verifyWorkerBaseline(remoteWorkerBaseline)).code,
      "worker_mutation",
    );
    assert.equal(
      (await restartedProcess.execute({ kind: "pull" })).value,
      "applied",
    );

    await run(second, "bd", ["create", "--id", "sce-race-b", "race", "--json"]);
    await run(first, "bd", ["create", "--id", "sce-race-a", "race", "--json"]);
    await run(first, "bd", ["dolt", "push", "--json"]);
    const stalePush = await secondProcess.execute({ kind: "push" });
    assert.equal(stalePush.kind, "push");
    assert.equal(stalePush.value, "conflict");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
