import assert from "node:assert/strict";
import test from "node:test";

import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeRootProjection,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import type { PreflightEnvelope } from "../../../src/preflight/index.js";
import {
  EmbeddedBeadsAdapter,
  type EmbeddedProcessPort,
  type EmbeddedRequest,
  type EmbeddedResponse,
  type EmbeddedState,
  parsePinnedBdState,
} from "../../../src/adapters/beads-embedded/index.js";
import { deriveIdempotencyKey, reduce } from "../../../src/protocol/reducer.js";
import { run as fixtureRun } from "../../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";

function preflight(sync: boolean): PreflightEnvelope {
  return {
    payload: {
      beads: {
        beadsDir: "/workspace/repo/.beads",
        contextSchemaVersion: 1,
        database: "sce",
        mode: "embedded",
        prefix: "sce",
        provenance: "embedded_config",
        storePath: "/workspace/repo/.beads/dolt",
        ...(sync
          ? { syncRef: "refs/dolt/data", syncRemote: "github.test/org/repo" }
          : {}),
        toolVersion: "1.1.0",
      },
      git: {
        commonDir: "/workspace/repo/.git",
        identity: "github.test/org/repo",
        objectFormat: "sha1",
        topLevel: "/workspace/repo",
      },
      status: "ready",
    },
    schema: "sce.preflight",
    version: 1,
  };
}

function slot(
  status: "available" | "acquired",
  slotHolder?: string,
): MergeSlotObservation {
  const value = {
    actor: holder,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: MERGE_SLOT_LABEL,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: MERGE_SLOT_TITLE,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

class ScriptedPort implements EmbeddedProcessPort {
  public readonly requests: EmbeddedRequest[] = [];
  public constructor(private readonly responses: readonly EmbeddedResponse[]) {}
  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    const next = this.responses[this.requests.length - 1];
    if (next === undefined) throw new Error("unexpected request");
    return next;
  }
}

function adapter(port: EmbeddedProcessPort, mode: "local-only" | "git-sync") {
  return new EmbeddedBeadsAdapter({
    holder,
    mode,
    prefix: "sce",
    preflight: preflight(mode === "git-sync"),
    process: port,
    scope,
  });
}

function journalBatch(): MutationBatch {
  const base = fixtureRun([]);
  const initial = {
    ...base,
    controller: { ...base.controller, state: "unacquired" as const },
    state: "initializing" as const,
  };
  const transition = reduce(initial, {
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
  assert.equal(transition.ok, true);
  if (!transition.ok) throw new Error("unreachable");
  const root = withBatchCheckpoint(
    makeRootProjection(transition.nextState),
    [],
  );
  return {
    changedRows: [],
    checkpoint: root.checkpoint,
    expectedAggregateCommitment:
      makeRootProjection(initial).aggregateCommitment,
    expectedAggregateRevision: makeRootProjection(initial).aggregateRevision,
    expectedChildren: [],
    expectedHolder: initial.controller.holder,
    holder: initial.controller.holder,
    next: { children: [], root },
    schema: "sce.fencing.batch",
    scope: root.scope,
    version: 1,
  };
}

test("local-only rejects a configured remote and git-sync requires one", async () => {
  const port = new ScriptedPort([]);
  const localWithRemote = new EmbeddedBeadsAdapter({
    holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(true),
    process: port,
    scope,
  });
  const syncWithoutRemote = new EmbeddedBeadsAdapter({
    holder,
    mode: "git-sync",
    prefix: "sce",
    preflight: preflight(false),
    process: port,
    scope,
  });
  assert.equal((await localWithRemote.acquire()).code, "quarantined");
  assert.equal((await syncWithoutRemote.acquire()).code, "quarantined");
  assert.deepEqual(port.requests, []);
});

test("acquisition uses only the built-in slot and binds actor, holder, and scope", async () => {
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "a".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "a".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "a".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
  ]);
  const acquired = await adapter(port, "local-only").acquire();
  assert.equal(acquired.code, "applied", JSON.stringify(port.requests));
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    ["state", "slot", "slot", "state", "state"],
  );
  for (const request of port.requests.filter(
    (request) => request.kind === "slot",
  ))
    assert.equal(request.kind === "slot" && request.actor, holder);
  // The request union has no create variant; the observed trace contains only
  // check/acquire and therefore cannot lazily initialize a slot.
});

function syncAcquirePort(finalState: EmbeddedState): ScriptedPort {
  const head = "b".repeat(40);
  return new ScriptedPort([
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    { kind: "pull", value: "applied" },
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    { kind: "push", value: "applied" },
    { kind: "state", value: finalState },
  ]);
}

test("git-sync acquisition relies on final remote-head state when no journal batch is pending", async () => {
  const head = "b".repeat(40);
  const port = syncAcquirePort({
    autoCommit: "on",
    head,
    reachable: true,
    remoteHead: head,
    workingSet: "clean",
  });
  assert.equal((await adapter(port, "git-sync").acquire()).code, "applied");
  assert.equal(port.requests.at(-1)?.kind, "state");
});

test("git-sync acquisition is ambiguous without a fetched remote head", async () => {
  const head = "b".repeat(40);
  assert.equal(
    (
      await adapter(
        syncAcquirePort({
          autoCommit: "on",
          head,
          reachable: true,
          workingSet: "clean",
        }),
        "git-sync",
      ).acquire()
    ).code,
    "ambiguous",
  );
});

test("git-sync acquisition is ambiguous when fetched remote head differs", async () => {
  const head = "b".repeat(40);
  assert.equal(
    (
      await adapter(
        syncAcquirePort({
          autoCommit: "on",
          head,
          reachable: true,
          remoteHead: "c".repeat(40),
          workingSet: "clean",
        }),
        "git-sync",
      ).acquire()
    ).code,
    "ambiguous",
  );
});

function postPushPort(
  afterPush: Extract<EmbeddedResponse, { readonly kind: "discover" }>["value"],
) {
  const head = "a".repeat(40);
  return new ScriptedPort([
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    { kind: "pull", value: "applied" },
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "mutation", value: "applied" },
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "pending" },
    },
    {
      kind: "discover",
      value: {
        childCommitments: [],
        head: "b".repeat(40),
        rootCommitment: journalBatch().next.root.aggregateCommitment,
        status: "observed",
      },
    },
    { kind: "commit", value: "applied" },
    {
      kind: "discover",
      value: {
        childCommitments: [],
        head: "b".repeat(40),
        rootCommitment: journalBatch().next.root.aggregateCommitment,
        status: "observed",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "b".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    {
      kind: "discover",
      value: {
        childCommitments: [],
        head: "b".repeat(40),
        rootCommitment: journalBatch().next.root.aggregateCommitment,
        status: "observed",
      },
    },
    { kind: "push", value: "applied" },
    { kind: "discover", value: afterPush },
  ]);
}

test("post-push remote-head mismatch remains ambiguous with the journal batch", async () => {
  const batch = journalBatch();
  const port = postPushPort({
    childCommitments: [],
    head: "b".repeat(40),
    remoteHead: "c".repeat(40),
    rootCommitment: batch.next.root.aggregateCommitment,
    status: "observed",
  });
  assert.equal(
    (await adapter(port, "git-sync").compareAndSet(batch)).status,
    "ambiguous",
  );
  const discoveries = port.requests.filter(
    (request) => request.kind === "discover",
  );
  assert.ok(discoveries.length >= 3);
  assert.ok(discoveries.every((request) => request.batch === batch));
});

test("post-push remote-row mismatch remains ambiguous with the journal batch", async () => {
  const batch = journalBatch();
  const port = postPushPort({ status: "ambiguous" });
  assert.equal(
    (await adapter(port, "git-sync").compareAndSet(batch)).status,
    "ambiguous",
  );
  const last = port.requests.at(-1);
  assert.equal(last?.kind, "discover");
  if (last?.kind !== "discover") throw new Error("unreachable");
  assert.equal(last.batch, batch);
});

test("worker tracker detection blocks qualification instead of repairing movement", async () => {
  const oldHead = "c".repeat(40);
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: oldHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "d".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  const runtime = adapter(port, "local-only");
  const baseline = await runtime.workerBaseline();
  assert.ok(baseline);
  assert.equal(
    (await runtime.verifyWorkerBaseline(baseline)).code,
    "worker_mutation",
  );
});

for (const autoCommit of ["off", "on", "batch"] as const)
  test(`pending ${autoCommit} working set blocks before any slot mutation`, async () => {
    const port = new ScriptedPort([
      {
        kind: "state",
        value: {
          autoCommit,
          head: "f".repeat(40),
          reachable: true,
          workingSet: "pending",
        },
      },
    ]);
    assert.equal((await adapter(port, "local-only").acquire()).code, "blocked");
    assert.deepEqual(
      port.requests.map((request) => request.kind),
      ["state"],
    );
  });

test("release requires exact current holder and positive available readback", async () => {
  const contender = "run-2/incarnation-1";
  const port = new ScriptedPort([
    { kind: "slot", value: slot("acquired", contender) },
  ]);
  assert.equal((await adapter(port, "local-only").release()).code, "blocked");
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    ["slot"],
  );

  const released = new ScriptedPort([
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "slot", value: slot("available") },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (await adapter(released, "local-only").release()).code,
    "applied",
  );
});

test("unavailable discovery around a commit is ambiguous and never pushes", async () => {
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "batch",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "batch",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "pending",
      },
    },
    { kind: "discover", value: { status: "absent" } },
    { kind: "commit", value: "unavailable" },
  ]);
  assert.equal((await adapter(port, "local-only").acquire()).code, "ambiguous");
  assert.equal(
    port.requests.some((request) => request.kind === "push"),
    false,
  );
});

test("engine-only bd status cannot fabricate full state or carry extra output", () => {
  assert.equal(
    parsePinnedBdState(
      JSON.stringify({
        data_dir: "/safe/repo/.beads/embeddeddolt",
        data_dir_exists: true,
        mode: "embedded",
        schema_version: 1,
        server_running: false,
      }),
    ),
    undefined,
  );
  assert.equal(
    parsePinnedBdState(
      JSON.stringify({
        data_dir: "/safe/repo/.beads/embeddeddolt",
        data_dir_exists: true,
        mode: "embedded",
        schema_version: 1,
        server_running: false,
        secret: "SECRET_CANARY",
      }),
    ),
    undefined,
  );
});
