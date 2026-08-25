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
    const localPreflight = {
      payload: {
        beads: {
          beadsDir: join(root, ".beads"),
          contextSchemaVersion: 1 as const,
          database: "sce",
          mode: "embedded" as const,
          prefix: "sce",
          projectId: "store-1",
          provenance: "embedded_config" as const,
          storePath: join(root, ".beads", "embeddeddolt"),
          toolVersion: "1.1.0" as const,
        },
        git: {
          commonDir: join(root, ".git"),
          identity: "repo-1",
          objectFormat: "sha1" as const,
          topLevel: root,
        },
        status: "ready" as const,
      },
      schema: "sce.preflight" as const,
      version: 1 as const,
    };
    const adapter = new EmbeddedBeadsAdapter({
      holder: "run-1/incarnation-1",
      mode: "local-only",
      prefix: "sce",
      preflight: localPreflight,
      process: embeddedProcess,
      scope,
    });
    const acquireIntent = await adapter.prepareAcquireTransition();
    assert.ok("idempotencyKey" in acquireIntent);
    assert.equal(
      (await adapter.acquire({ transition: acquireIntent })).code,
      "applied",
    );
    // The old projection records the acquire intent. Once the independent
    // built-in slot transition commits, that batch is no longer the exact
    // checkpoint delta and cannot be replayed as an applied CAS.
    assert.equal((await adapter.compareAndSet(batch)).status, "ambiguous");
    const replayAcquirePort = new RecordingProcess(embeddedProcess);
    const replayAcquire = new EmbeddedBeadsAdapter({
      holder: "run-1/incarnation-1",
      mode: "local-only",
      prefix: "sce",
      preflight: localPreflight,
      process: replayAcquirePort,
      scope,
    });
    assert.equal(
      (await replayAcquire.acquire({ transition: acquireIntent })).code,
      "applied",
    );
    assert.equal(
      replayAcquirePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    assert.equal(transition.effects.length, 1);
    const settled = reduce(transition.nextState, {
      eventId: "controller-acquired",
      expectedRevision: transition.nextState.revision,
      effectId: transition.effects[0]?.effectId ?? "",
      effectKind: "controller_acquire",
      holder: transition.nextState.controller.holder,
      controllerFencingToken: transition.nextState.controllerFencingToken,
      observationHash: "e".repeat(64),
      type: "controller_acquired",
    });
    assert.equal(settled.ok, true);
    if (!settled.ok) throw new Error("unreachable");
    const settledRoot = withBatchCheckpoint(
      makeRootProjection(settled.nextState),
      [],
    );
    const settledBatch = {
      ...batch,
      checkpoint: settledRoot.checkpoint,
      expectedAggregateCommitment: rootProjection.aggregateCommitment,
      expectedAggregateRevision: rootProjection.aggregateRevision,
      expectedHolder: transition.nextState.controller.holder,
      holder: transition.nextState.controller.holder,
      next: { children: [], root: settledRoot },
    };
    assert.equal((await adapter.compareAndSet(settledBatch)).status, "applied");
    const immediateReplay = new EmbeddedBeadsAdapter({
      holder: "run-1/incarnation-1",
      mode: "local-only",
      prefix: "sce",
      preflight: localPreflight,
      process: embeddedProcess,
      scope,
    });
    assert.equal(
      (await immediateReplay.compareAndSet(settledBatch)).status,
      "applied",
    );
    const releaseIntent = await adapter.prepareReleaseTransition();
    assert.ok("idempotencyKey" in releaseIntent);
    assert.equal(
      (await adapter.release({ transition: releaseIntent })).code,
      "applied",
    );
    // bd 1.1.0 auto-commits the slot action. A replacement adapter replaying
    // the persisted release result must prove that exact committed delta and
    // publish applied without issuing another release/commit/push.
    const beforeLostRelease = await embeddedProcess.execute({ kind: "state" });
    assert.equal(beforeLostRelease.kind, "state");
    const replayBase = new PinnedBdEmbeddedProcess({
      bdExecutable: "/opt/homebrew/bin/bd",
      cwd: root,
      databaseDirectory: database,
      doltExecutable: "/opt/homebrew/bin/dolt",
      prefix: "sce",
      projections: new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: database,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
      scope,
    });
    const replayPort = new RecordingProcess(replayBase);
    const replayAdapter = new EmbeddedBeadsAdapter({
      holder: "run-1/incarnation-1",
      mode: "local-only",
      prefix: "sce",
      preflight: localPreflight,
      process: replayPort,
      scope,
    });
    assert.equal(
      (await replayAdapter.release({ transition: releaseIntent })).code,
      "applied",
    );
    assert.equal(
      replayPort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterLostRelease = await replayBase.execute({ kind: "state" });
    assert.equal(afterLostRelease.kind, "state");
    assert.equal(afterLostRelease.value.workingSet, "clean");
    assert.equal(afterLostRelease.value.head, beforeLostRelease.value.head);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pinned process and adapter synchronize a batch across two embedded clones", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-sync-");
  const remote = join(root, "remote.git");
  const first = join(root, "first");
  const second = join(root, "second");
  const third = join(root, "third");
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
    await run(root, "git", ["clone", "-q", remote, third]);
    await run(third, "bd", [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      `file://${remote}`,
    ]);
    await run(third, "bd", ["dolt", "pull", "--json"]);
    const thirdDatabase = join(third, ".beads", "embeddeddolt", "sce");
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
          projectId: "store-1",
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
    const firstAcquireIntent = await firstAdapter.prepareAcquireTransition();
    assert.ok("idempotencyKey" in firstAcquireIntent);
    // The intent is the controller-journal value. Simulate process death after
    // bd changes the built-in row but before this caller receives an outcome.
    // bd 1.1.0's active policy auto-commits this operation; assert that actual
    // boundary instead of claiming an unobservable pending state.
    const interruptedAcquire = await firstProcess.execute({
      action: "acquire",
      actor: initial.controller.holder,
      kind: "slot",
    });
    assert.equal(interruptedAcquire.kind, "slot");
    assert.equal(interruptedAcquire.value.holder, initial.controller.holder);
    const locallyCommittedAcquire = await firstProcess.execute({
      kind: "state",
    });
    assert.equal(locallyCommittedAcquire.kind, "state");
    assert.equal(locallyCommittedAcquire.value.workingSet, "clean");
    assert.notEqual(
      locallyCommittedAcquire.value.head,
      locallyCommittedAcquire.value.remoteHead,
    );
    const recoveredAcquireProcess = processFor(
      first,
      firstDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: firstDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    const recoveredAcquire = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: recoveredAcquireProcess,
      scope,
    });
    assert.equal(
      (
        await recoveredAcquire.acquire({
          knownHolder: initial.controller.holder,
          transition: firstAcquireIntent,
        })
      ).code,
      "applied",
    );
    // A crash after successful push but before result persistence is an exact
    // remote-held resume, never a second acquire or push.
    const afterPushAcquireBase = processFor(
      first,
      firstDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: firstDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    const afterPushAcquirePort = new RecordingProcess(afterPushAcquireBase);
    const afterPushAcquire = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: afterPushAcquirePort,
      scope,
    });
    assert.equal(
      (
        await afterPushAcquire.acquire({
          knownHolder: initial.controller.holder,
          transition: firstAcquireIntent,
        })
      ).code,
      "applied",
    );
    assert.equal(
      afterPushAcquirePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
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
    // A clean local commit unrelated to the controller batch must not become
    // an implicit push parent merely because the exact batch is now pending.
    // The replacement can prove the selected rows, but not its local A→batch
    // checkpoint against remote R, so it performs zero commit/push effects.
    const adversary = join(root, "adversary");
    await run(root, "git", ["clone", "-q", remote, adversary]);
    await run(adversary, "bd", [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      `file://${remote}`,
    ]);
    await run(adversary, "bd", ["dolt", "pull", "--json"]);
    const adversaryDatabase = join(adversary, ".beads", "embeddeddolt", "sce");
    await json(adversary, [
      "create",
      "--id",
      "sce-unrelated-a",
      "unrelated local parent",
      "--json",
    ]);
    await run(adversary, "bd", ["dolt", "commit", "--json"]);
    const adversaryPersistence = new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: adversaryDatabase,
      doltExecutable: "/opt/homebrew/bin/dolt",
      rootIssueId: "sce-root",
    });
    assert.equal((await adversaryPersistence.mutate(batch)).value, "applied");
    const adversaryProcess = processFor(
      adversary,
      adversaryDatabase,
      adversaryPersistence,
    );
    const adversaryBefore = await adversaryProcess.execute({ kind: "state" });
    assert.equal(adversaryBefore.kind, "state");
    assert.equal(adversaryBefore.value.workingSet, "pending");
    const adversaryPort = new RecordingProcess(adversaryProcess);
    const adversaryAdapter = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(adversary),
      process: adversaryPort,
      scope,
    });
    assert.equal(
      (await adversaryAdapter.compareAndSet(batch)).status,
      "ambiguous",
    );
    assert.equal(
      adversaryPort.requests.some(
        (request) => request.kind === "commit" || request.kind === "push",
      ),
      false,
    );
    assert.deepEqual(
      await adversaryProcess.execute({ kind: "state" }),
      adversaryBefore,
    );
    // A second clone imports the already-pushed acquire. Its local Dolt head
    // is a clone-metadata merge rather than A's effect commit, so this fresh
    // adapter must use the typed remote parent→effect proof and remain wholly
    // read-only while replaying the persisted A intent.
    const crossAcquireBase = processFor(
      second,
      secondDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: secondDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    assert.equal(
      (await crossAcquireBase.execute({ kind: "pull" })).value,
      "applied",
    );
    const beforeCrossAcquireState = await crossAcquireBase.execute({
      kind: "state",
    });
    const beforeCrossAcquireRemote = await crossAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(beforeCrossAcquireState.kind, "state");
    assert.equal(beforeCrossAcquireRemote.kind, "slot");
    const crossAcquirePort = new RecordingProcess(crossAcquireBase);
    const crossAcquire = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(second),
      process: crossAcquirePort,
      scope,
    });
    assert.equal(
      (
        await crossAcquire.acquire({
          knownHolder: initial.controller.holder,
          transition: firstAcquireIntent,
        })
      ).code,
      "applied",
    );
    assert.equal(
      crossAcquirePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterCrossAcquireState = await crossAcquireBase.execute({
      kind: "state",
    });
    const afterCrossAcquireRemote = await crossAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.deepEqual(afterCrossAcquireState, beforeCrossAcquireState);
    assert.deepEqual(afterCrossAcquireRemote, beforeCrossAcquireRemote);
    // A third independently initialized clone has a distinct metadata-merge
    // parent too. It must replay A's persisted acquire from remote authority
    // only, without reissuing a slot command, commit, or push.
    const thirdAcquireBase = processFor(
      third,
      thirdDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: thirdDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    assert.equal(
      (await thirdAcquireBase.execute({ kind: "pull" })).value,
      "applied",
    );
    const beforeThirdAcquireState = await thirdAcquireBase.execute({
      kind: "state",
    });
    const beforeThirdAcquireRemote = await thirdAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(beforeThirdAcquireState.kind, "state");
    assert.equal(beforeThirdAcquireRemote.kind, "slot");
    const thirdAcquirePort = new RecordingProcess(thirdAcquireBase);
    const thirdAcquire = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(third),
      process: thirdAcquirePort,
      scope,
    });
    assert.equal(
      (
        await thirdAcquire.acquire({
          knownHolder: initial.controller.holder,
          transition: firstAcquireIntent,
        })
      ).code,
      "applied",
    );
    assert.equal(
      thirdAcquirePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterThirdAcquireState = await thirdAcquireBase.execute({
      kind: "state",
    });
    const afterThirdAcquireRemote = await thirdAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.deepEqual(afterThirdAcquireState, beforeThirdAcquireState);
    assert.deepEqual(afterThirdAcquireRemote, beforeThirdAcquireRemote);
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
    assert.equal(
      (
        await competingAdapter.acquire({
          knownHolder: initial.controller.holder,
        })
      ).code,
      "blocked",
    );
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
    // This boundary asks for auto-commit off. bd 1.1.0 still atomically
    // commits its built-in merge-slot release, so this test records the real
    // post-commit / pre-push boundary rather than inventing a pending one.
    await run(first, "bd", ["config", "set", "dolt.auto-commit", "off"]);
    await run(first, "bd", ["dolt", "commit", "--json"]);
    await run(first, "bd", ["dolt", "push", "--json"]);
    // Bring clone C to the exact release intent's remote before-head. Its
    // subsequent pull of the release effect then has the required ancestry
    // relation, rather than an older cross-clone merge parent.
    assert.equal(
      (await thirdAcquireBase.execute({ kind: "pull" })).value,
      "applied",
    );
    const restartReleaseIntent =
      await restartAdapter.prepareReleaseTransition();
    assert.ok("idempotencyKey" in restartReleaseIntent);
    const interruptedRelease = await restartedProcess.execute({
      action: "release",
      actor: initial.controller.holder,
      kind: "slot",
    });
    assert.equal(interruptedRelease.kind, "slot");
    assert.equal(interruptedRelease.value.status, "available");
    const committedRelease = await restartedProcess.execute({ kind: "state" });
    assert.equal(committedRelease.kind, "state");
    assert.equal(committedRelease.value.workingSet, "clean");
    assert.notEqual(
      committedRelease.value.head,
      committedRelease.value.remoteHead,
    );
    const recoveredRelease = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: processFor(
        first,
        firstDatabase,
        new DoltProjectionPersistence({
          childIssueId: () => undefined,
          databaseDirectory: firstDatabase,
          doltExecutable: "/opt/homebrew/bin/dolt",
          rootIssueId: "sce-root",
        }),
      ),
      scope,
    });
    assert.equal(
      (await recoveredRelease.release({ transition: restartReleaseIntent }))
        .code,
      "applied",
    );
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
    const releasedRemoteSlot = await restartedProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(releasedRemoteSlot.kind, "slot");
    assert.equal(releasedRemoteSlot.value.status, "available");
    // Crash after a successful release push but before result persistence: a
    // fresh adapter must bind the exact persisted release transition to its
    // local audit delta and remote available row. It must not issue a second
    // mutating slot command, commit, or push.
    const replayReleaseBase = processFor(
      first,
      firstDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: firstDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    const replayReleasePort = new RecordingProcess(replayReleaseBase);
    const replayRelease = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(first),
      process: replayReleasePort,
      scope,
    });
    assert.equal(
      (await replayRelease.release({ transition: restartReleaseIntent })).code,
      "applied",
    );
    assert.equal(
      replayReleasePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterReplayReleaseState = await replayReleaseBase.execute({
      kind: "state",
    });
    const afterReplayReleaseRemote = await replayReleaseBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(afterReplayReleaseState.kind, "state");
    assert.equal(afterReplayReleaseRemote.kind, "slot");
    assert.equal(afterReplayReleaseState.value.workingSet, "clean");
    assert.equal(afterReplayReleaseState.value.head, releasedState.value.head);
    assert.equal(
      afterReplayReleaseState.value.remoteHead,
      releasedState.value.remoteHead,
    );
    assert.deepEqual(afterReplayReleaseRemote.value, releasedRemoteSlot.value);
    assert.equal(
      (await secondProcess.execute({ kind: "pull" })).value,
      "applied",
    );
    // Repeat the lost-result proof from clone B after A's release push. The
    // same-project clone has its own metadata merge head, but no slot or Dolt
    // mutation is allowed while it reconciles A's persisted release intent.
    const crossReleaseBase = processFor(
      second,
      secondDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: secondDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    const beforeCrossReleaseState = await crossReleaseBase.execute({
      kind: "state",
    });
    const beforeCrossReleaseRemote = await crossReleaseBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(beforeCrossReleaseState.kind, "state");
    assert.equal(beforeCrossReleaseRemote.kind, "slot");
    const crossReleasePort = new RecordingProcess(crossReleaseBase);
    const crossRelease = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(second),
      process: crossReleasePort,
      scope,
    });
    assert.equal(
      (await crossRelease.release({ transition: restartReleaseIntent })).code,
      "applied",
    );
    assert.equal(
      crossReleasePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterCrossReleaseState = await crossReleaseBase.execute({
      kind: "state",
    });
    const afterCrossReleaseRemote = await crossReleaseBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.deepEqual(afterCrossReleaseState, beforeCrossReleaseState);
    assert.deepEqual(afterCrossReleaseRemote, beforeCrossReleaseRemote);
    assert.equal(
      (await thirdAcquireBase.execute({ kind: "pull" })).value,
      "applied",
    );
    // The same independent third clone also proves A's later release from
    // the exact remote effect and its own metadata-only merge relation.
    const beforeThirdReleaseState = await thirdAcquireBase.execute({
      kind: "state",
    });
    const beforeThirdReleaseRemote = await thirdAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(beforeThirdReleaseState.kind, "state");
    assert.equal(beforeThirdReleaseRemote.kind, "slot");
    const thirdReleasePort = new RecordingProcess(thirdAcquireBase);
    const thirdRelease = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(third),
      process: thirdReleasePort,
      scope,
    });
    assert.equal(
      (await thirdRelease.release({ transition: restartReleaseIntent })).code,
      "applied",
    );
    assert.equal(
      thirdReleasePort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterThirdReleaseState = await thirdAcquireBase.execute({
      kind: "state",
    });
    const afterThirdReleaseRemote = await thirdAcquireBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.deepEqual(afterThirdReleaseState, beforeThirdReleaseState);
    assert.deepEqual(afterThirdReleaseRemote, beforeThirdReleaseRemote);
    const availableSlot = await secondProcess.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
    });
    assert.equal(availableSlot.kind, "slot");
    assert.equal(availableSlot.value.status, "available");
    const restartAcquireIntent =
      await restartAdapter.prepareAcquireTransition();
    assert.ok("idempotencyKey" in restartAcquireIntent);
    assert.equal(
      (await restartAdapter.acquire({ transition: restartAcquireIntent })).code,
      "applied",
    );
    // Build a real forged merge in clone C. Its local merge result is
    // deliberately reduced back to only the two allowed clone metadata rows,
    // while C's non-remote parent still contains an unrelated issue commit.
    // The lineage proof must inspect that parent relation and refuse replay.
    await json(third, [
      "create",
      "--id",
      "sce-forged-parent",
      "forged parent mutation",
      "--json",
    ]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", ["fetch", "origin"]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", [
      "merge",
      "--no-commit",
      "origin/main",
    ]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", [
      "sql",
      "-q",
      "DELETE FROM issues WHERE id = 'sce-forged-parent'",
    ]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", [
      "sql",
      "-q",
      "UPDATE metadata SET value = '1111111111111111' WHERE `key` = 'clone_id'",
    ]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", [
      "sql",
      "-q",
      "UPDATE metadata SET value = '2026-08-25T12:00:00Z' WHERE `key` = 'last_import_time'",
    ]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", ["add", "."]);
    await run(thirdDatabase, "/opt/homebrew/bin/dolt", [
      "commit",
      "-m",
      "forged-parent-merge",
    ]);
    const forgedBase = processFor(
      third,
      thirdDatabase,
      new DoltProjectionPersistence({
        childIssueId: () => undefined,
        databaseDirectory: thirdDatabase,
        doltExecutable: "/opt/homebrew/bin/dolt",
        rootIssueId: "sce-root",
      }),
    );
    const beforeForgedReplayState = await forgedBase.execute({ kind: "state" });
    const beforeForgedReplayRemote = await forgedBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.equal(beforeForgedReplayState.kind, "state");
    assert.equal(beforeForgedReplayRemote.kind, "slot");
    const forgedPort = new RecordingProcess(forgedBase);
    const forgedReplay = new EmbeddedBeadsAdapter({
      holder: initial.controller.holder,
      mode: "git-sync",
      prefix: "sce",
      preflight: preflight(third),
      process: forgedPort,
      scope,
    });
    assert.equal(
      (
        await forgedReplay.acquire({
          knownHolder: initial.controller.holder,
          transition: restartAcquireIntent,
        })
      ).code,
      "ambiguous",
    );
    assert.equal(
      forgedPort.requests.some(
        (request) =>
          request.kind === "commit" ||
          request.kind === "push" ||
          (request.kind === "slot" && request.action !== "check"),
      ),
      false,
    );
    const afterForgedReplayState = await forgedBase.execute({ kind: "state" });
    const afterForgedReplayRemote = await forgedBase.execute({
      actor: initial.controller.holder,
      kind: "slot",
      action: "check",
      source: "remote",
    });
    assert.deepEqual(afterForgedReplayState, beforeForgedReplayState);
    assert.deepEqual(afterForgedReplayRemote, beforeForgedReplayRemote);
    const remoteWorkerBaseline = await restartAdapter.workerBaseline();
    assert.ok(remoteWorkerBaseline);
    assert.ok(remoteWorkerBaseline.remoteHead);
    assert.equal(
      (await secondProcess.execute({ kind: "pull" })).value,
      "applied",
    );

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

    // Restore the ordinary policy before creating the deliberate stale-writer
    // race. The preceding release probe proved bd's slot action commits even
    // with off requested, but unrelated raw race writes should be observable.
    await run(first, "bd", ["config", "set", "dolt.auto-commit", "on"]);
    await run(first, "bd", ["dolt", "commit", "--json"]);
    await run(first, "bd", ["dolt", "push", "--json"]);
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
