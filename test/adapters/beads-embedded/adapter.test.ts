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
  type EmbeddedProcessIdentity,
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
type ReadyPreflight = Omit<PreflightEnvelope, "payload"> & {
  readonly payload: Extract<PreflightEnvelope["payload"], { status: "ready" }>;
};

function preflight(sync: boolean): ReadyPreflight {
  return {
    payload: {
      beads: {
        beadsDir: "/workspace/repo/.beads",
        contextSchemaVersion: 1,
        database: "sce",
        mode: "embedded",
        prefix: "sce",
        projectId: "store-1",
        provenance: "embedded_config",
        storePath: "/workspace/repo/.beads/dolt",
        ...(sync
          ? { syncRef: "refs/dolt/data", syncRemote: "github.test/org/repo" }
          : {}),
        toolVersion: "1.1.0",
      },
      git: {
        commonDir: "/workspace/repo/.git",
        identity: "repo-1",
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
    actor: slotHolder ?? holder,
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

function processIdentity(sync: boolean): EmbeddedProcessIdentity {
  return {
    database: "sce",
    databaseDirectory: "/workspace/repo/.beads/dolt/sce",
    prefix: "sce",
    ...(sync
      ? {
          remote: {
            name: "origin",
            ref: "refs/dolt/data",
            url: "github.test/org/repo",
          },
        }
      : {}),
    storePath: "/workspace/repo/.beads/dolt",
  };
}

class ScriptedPort implements EmbeddedProcessPort {
  public readonly requests: EmbeddedRequest[] = [];
  public identity: EmbeddedProcessIdentity;
  private responseIndex = 0;

  public constructor(
    private readonly responses: readonly EmbeddedResponse[],
    identity = processIdentity(false),
  ) {
    this.identity = identity;
  }
  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    // Most adapter tests exercise the controller's authority sequencing. The
    // production proof itself is covered by pinned real fixtures; defaulting
    // this semantic proof to observed keeps those traces concise while still
    // allowing a test to script a non-observed proof explicitly.
    if (
      request.kind === "slot_transition" &&
      this.responses[this.responseIndex]?.kind !== "slot_transition"
    )
      return { kind: "slot_transition", value: "observed" };
    const next = this.responses[this.responseIndex++];
    if (next === undefined) throw new Error("unexpected request");
    return next;
  }
}

function adapter(
  port: EmbeddedProcessPort,
  mode: "local-only" | "git-sync",
  actor = holder,
) {
  if (port instanceof ScriptedPort)
    port.identity = processIdentity(mode === "git-sync");
  return new EmbeddedBeadsAdapter({
    holder: actor,
    mode,
    prefix: "sce",
    preflight: preflight(mode === "git-sync"),
    process: port,
    scope,
  });
}

function journalBatch(
  options: {
    holder?: string;
    scope?: FencingScope;
  } = {},
): MutationBatch {
  const base = fixtureRun([]);
  const expectedScope = options.scope ?? scope;
  const expectedHolder = options.holder ?? holder;
  const [runId, incarnationId] = expectedHolder.split("/");
  const initial = {
    ...base,
    controller: {
      ...base.controller,
      incarnationId: incarnationId ?? "",
      holder: expectedHolder,
      runId: runId ?? "",
      state: "unacquired" as const,
    },
    integrationBranch: expectedScope.integrationBranch,
    repositoryIdentity: expectedScope.gitRepositoryIdentity,
    storeIdentity: expectedScope.beadsStoreIdentity,
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
  const clean = {
    kind: "state" as const,
    value: {
      autoCommit: "on" as const,
      head: "a".repeat(40),
      reachable: true,
      workingSet: "clean" as const,
    },
  };
  const port = new ScriptedPort([
    clean,
    { kind: "slot", value: slot("available") },
    clean,
    clean,
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("acquired", holder) },
    clean,
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  const runtime = adapter(port, "local-only");
  const intent = await runtime.prepareAcquireTransition();
  assert.ok("idempotencyKey" in intent);
  const acquired = await runtime.acquire({ transition: intent });
  assert.equal(acquired.code, "applied", JSON.stringify(port.requests));
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    [
      "state",
      "slot",
      "state",
      "state",
      "slot",
      "slot",
      "slot_transition",
      "state",
      "slot",
    ],
  );
  for (const request of port.requests.filter(
    (request) => request.kind === "slot",
  ))
    assert.equal(request.kind === "slot" && request.actor, holder);
  // The request union has no create variant; the observed trace contains only
  // check/acquire and therefore cannot lazily initialize a slot.
});

function syncAcquirePort(
  finalState: EmbeddedState,
  afterRemoteReadState = finalState,
): ScriptedPort {
  const beforeHead = "b".repeat(40);
  const afterHead = "c".repeat(40);
  const before = {
    autoCommit: "on" as const,
    head: beforeHead,
    reachable: true,
    remoteHead: beforeHead,
    workingSet: "clean" as const,
  };
  return new ScriptedPort([
    { kind: "state", value: before },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("available") },
    { kind: "state", value: before },
    { kind: "state", value: before },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "slot", value: slot("available") },
    { kind: "push", value: "applied" },
    { kind: "state", value: finalState },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "state", value: afterRemoteReadState },
  ]);
}

test("git-sync acquisition relies on final remote-head state when no journal batch is pending", async () => {
  const head = "c".repeat(40);
  const port = syncAcquirePort({
    autoCommit: "on",
    head,
    reachable: true,
    remoteHead: head,
    workingSet: "clean",
  });
  const runtime = adapter(port, "git-sync");
  const intent = await runtime.prepareAcquireTransition();
  assert.ok("idempotencyKey" in intent);
  assert.equal(
    (await runtime.acquire({ transition: intent })).code,
    "applied",
    JSON.stringify(port.requests),
  );
  assert.equal(port.requests.at(-1)?.kind, "state");
  assert.ok(
    port.requests.some(
      (request) => request.kind === "state" && request !== port.requests[0],
    ),
  );
});

test("slot transition is ambiguous when its last remote slot fetch advances head", async () => {
  const pushed = "c".repeat(40);
  const port = syncAcquirePort(
    {
      autoCommit: "on",
      head: pushed,
      reachable: true,
      remoteHead: pushed,
      workingSet: "clean",
    },
    {
      autoCommit: "on",
      head: pushed,
      reachable: true,
      remoteHead: "d".repeat(40),
      workingSet: "clean",
    },
  );
  const runtime = adapter(port, "git-sync");
  const intent = await runtime.prepareAcquireTransition();
  assert.ok("idempotencyKey" in intent);
  assert.equal(
    (await runtime.acquire({ transition: intent })).code,
    "ambiguous",
  );
  assert.equal(port.requests.at(-1)?.kind, "state");
});

test("lost-result slot resume is ambiguous when final remote fetch advances head", async () => {
  const head = "c".repeat(40);
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: head,
        workingSet: "clean",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: head,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: head,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: "d".repeat(40),
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (await adapter(port, "git-sync").acquire({ knownHolder: holder })).code,
    "ambiguous",
  );
  assert.equal(port.requests.at(-1)?.kind, "state");
});

test("git-sync acquisition is ambiguous without a fetched remote head", async () => {
  const head = "b".repeat(40);
  const missing = await adapter(
    new ScriptedPort([
      {
        kind: "state",
        value: {
          autoCommit: "on",
          head,
          reachable: true,
          workingSet: "clean",
        },
      },
    ]),
    "git-sync",
  ).prepareAcquireTransition();
  assert.ok("code" in missing);
  assert.equal(missing.code, "ambiguous");
});

test("git-sync acquisition is ambiguous when fetched remote head differs", async () => {
  const head = "b".repeat(40);
  const moved = await adapter(
    new ScriptedPort([
      {
        kind: "state",
        value: {
          autoCommit: "on",
          head,
          reachable: true,
          remoteHead: "c".repeat(40),
          workingSet: "clean",
        },
      },
    ]),
    "git-sync",
  ).prepareAcquireTransition();
  assert.ok("code" in moved);
  assert.equal(moved.code, "ambiguous");
});

function postPushPort(
  afterPush: Extract<EmbeddedResponse, { readonly kind: "discover" }>["value"],
  finalState?: EmbeddedState,
) {
  const head = "a".repeat(40);
  return new ScriptedPort([
    {
      kind: "state",
      value: { autoCommit: "on", head, reachable: true, workingSet: "clean" },
    },
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
    ...(finalState === undefined
      ? []
      : [{ kind: "state" as const, value: finalState }]),
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

test("later remote movement after matching batch discovery remains ambiguous", async () => {
  const batch = journalBatch();
  const head = "b".repeat(40);
  const port = postPushPort(
    {
      childCommitments: [],
      head,
      remoteHead: head,
      rootCommitment: batch.next.root.aggregateCommitment,
      status: "observed",
    },
    {
      autoCommit: "on",
      head,
      reachable: true,
      remoteHead: "c".repeat(40),
      workingSet: "clean",
    },
  );
  assert.equal(
    (await adapter(port, "git-sync").compareAndSet(batch)).status,
    "ambiguous",
  );
  assert.equal(port.requests.at(-1)?.kind, "state");
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

test("compare-and-set refuses an otherwise-valid foreign batch before any command", async () => {
  const foreignScope: FencingScope = {
    beadsStoreIdentity: "store-2",
    gitRepositoryIdentity: "repo-2",
    integrationBranch: "release",
  };
  for (const foreign of [
    journalBatch({ holder: "run-2/incarnation-1" }),
    journalBatch({ scope: foreignScope }),
  ]) {
    for (const workingSet of ["clean", "pending"] as const) {
      const port = new ScriptedPort([
        {
          kind: "state",
          value: {
            autoCommit: "batch",
            head: "e".repeat(40),
            reachable: true,
            workingSet,
          },
        },
      ]);
      assert.equal(
        (await adapter(port, "local-only").compareAndSet(foreign)).status,
        "quarantined",
      );
      assert.deepEqual(port.requests, []);
    }
  }
});

test("acquisition accepts only explicit projected resume or continuation authority", async () => {
  const sameHolder = new ScriptedPort([
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
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  assert.equal(
    (await adapter(sameHolder, "local-only").acquire({ knownHolder: holder }))
      .code,
    "applied",
  );

  const previousHolder = holder;
  const nextHolder = "run-1/incarnation-2";
  const after = slot("acquired", nextHolder);
  const continuation = {
    after,
    before: slot("acquired", previousHolder),
    nextHolder,
    previousHolder,
  };
  const continued = new ScriptedPort([
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
    { kind: "slot", value: after },
  ]);
  assert.equal(
    (
      await adapter(continued, "local-only", nextHolder).acquire({
        continuation,
        knownHolder: previousHolder,
      })
    ).code,
    "applied",
  );

  const unproved = new ScriptedPort([]);
  assert.equal(
    (await adapter(unproved, "local-only", nextHolder).acquire()).code,
    "quarantined",
  );
  assert.equal(
    unproved.requests.some(
      (request) => request.kind === "slot" && request.action === "acquire",
    ),
    false,
  );
  assert.deepEqual(unproved.requests, []);

  for (const malformed of [
    {},
    { knownHolder: holder, unexpected: true },
    { continuation: {}, knownHolder: holder },
  ]) {
    const port = new ScriptedPort([]);
    assert.equal(
      (
        await adapter(port, "local-only").acquire(
          malformed as unknown as { readonly knownHolder: string },
        )
      ).code,
      "quarantined",
    );
    assert.deepEqual(port.requests, []);
  }
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

test("worker baseline detects remote-only movement in git-sync mode", async () => {
  const head = "c".repeat(40);
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: head,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head,
        reachable: true,
        remoteHead: "d".repeat(40),
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  const runtime = adapter(port, "git-sync");
  const baseline = await runtime.workerBaseline();
  assert.ok(baseline);
  assert.equal(
    (await runtime.verifyWorkerBaseline(baseline)).code,
    "worker_mutation",
  );
});

test("git-sync worker baseline refuses a missing or moved authoritative remote head", async () => {
  const head = "c".repeat(40);
  for (const state of [
    {
      autoCommit: "on" as const,
      head,
      reachable: true,
      workingSet: "clean" as const,
    },
    {
      autoCommit: "on" as const,
      head,
      reachable: true,
      remoteHead: "d".repeat(40),
      workingSet: "clean" as const,
    },
  ]) {
    const port = new ScriptedPort([{ kind: "state", value: state }]);
    assert.equal(await adapter(port, "git-sync").workerBaseline(), undefined);
    assert.deepEqual(
      port.requests.map((request) => request.kind),
      ["state"],
    );
  }
});

test("pending exact-batch recovery rechecks the durable controller holder before commit", async () => {
  const batch = journalBatch();
  for (const slotReadback of [
    slot("acquired", "run-2/incarnation-1"),
    slot("available"),
  ]) {
    const port = new ScriptedPort([
      {
        kind: "state",
        value: {
          autoCommit: "batch",
          head: "e".repeat(40),
          reachable: true,
          workingSet: "pending",
        },
      },
      { kind: "discover", value: { status: "observed" } },
      { kind: "slot", value: slotReadback },
    ]);
    assert.equal(
      (await adapter(port, "local-only").compareAndSet(batch)).status,
      "holder_mismatch",
    );
    assert.deepEqual(
      port.requests.map((request) => request.kind),
      ["state", "discover", "slot"],
    );
  }
});

test("adapter binds preflight identity to the concrete process before any command", async () => {
  const local = preflight(false);
  const sync = preflight(true);
  const wrongStore: PreflightEnvelope = {
    ...local,
    payload: {
      ...local.payload,
      beads: {
        ...local.payload.beads,
        storePath: "/workspace/other/.beads/dolt",
      },
    },
  };
  const wrongDatabase: PreflightEnvelope = {
    ...local,
    payload: {
      ...local.payload,
      beads: { ...local.payload.beads, database: "other" },
    },
  };
  const wrongPrefix: PreflightEnvelope = {
    ...local,
    payload: {
      ...local.payload,
      beads: { ...local.payload.beads, prefix: "other" },
    },
  };
  const wrongRemote: PreflightEnvelope = {
    ...sync,
    payload: {
      ...sync.payload,
      beads: { ...sync.payload.beads, syncRemote: "github.test/other/repo" },
    },
  };
  const wrongRef: PreflightEnvelope = {
    ...sync,
    payload: {
      ...sync.payload,
      beads: { ...sync.payload.beads, syncRef: "refs/dolt/other" },
    },
  };
  for (const [candidate, mode, identity] of [
    [wrongStore, "local-only", processIdentity(false)],
    [wrongDatabase, "local-only", processIdentity(false)],
    [wrongPrefix, "local-only", processIdentity(false)],
    [wrongRemote, "git-sync", processIdentity(true)],
    [wrongRef, "git-sync", processIdentity(true)],
  ] as const) {
    const port = new ScriptedPort([], identity);
    const runtime = new EmbeddedBeadsAdapter({
      holder,
      mode,
      prefix: "sce",
      preflight: candidate,
      process: port,
      scope,
    });
    assert.equal((await runtime.acquire()).code, "quarantined");
    assert.equal(await runtime.workerBaseline(), undefined);
    assert.equal(
      (
        await runtime.verifyWorkerBaseline({
          slot: slot("acquired", holder),
          workingSet: "clean",
        })
      ).code,
      "quarantined",
    );
    assert.deepEqual(port.requests, []);
  }
});

test("adapter refuses malformed preflight envelopes and scope identity mismatches before commands", async () => {
  const local = preflight(false);
  const malformed: readonly unknown[] = [
    { ...local, schema: "sce.other" },
    { ...local, version: 2 },
    {
      ...local,
      payload: {
        ...local.payload,
        beads: { ...local.payload.beads, toolVersion: "1.1.1" },
      },
    },
    {
      ...local,
      payload: {
        ...local.payload,
        beads: {
          ...local.payload.beads,
          provenance: "shared_server_flag",
        },
      },
    },
    { ...local, extra: true },
  ];
  for (const candidate of malformed) {
    const port = new ScriptedPort([]);
    const runtime = new EmbeddedBeadsAdapter({
      holder,
      mode: "local-only",
      prefix: "sce",
      preflight: candidate as PreflightEnvelope,
      process: port,
      scope,
    });
    assert.equal((await runtime.acquire()).code, "quarantined");
    assert.equal(await runtime.workerBaseline(), undefined);
    assert.deepEqual(port.requests, []);
  }

  for (const foreignScope of [
    { ...scope, beadsStoreIdentity: "store-2" },
    { ...scope, gitRepositoryIdentity: "repo-2" },
    { ...scope, integrationBranch: "release", extra: true },
  ]) {
    const port = new ScriptedPort([]);
    const runtime = new EmbeddedBeadsAdapter({
      holder,
      mode: "local-only",
      prefix: "sce",
      preflight: local,
      process: port,
      scope: foreignScope as FencingScope,
    });
    assert.equal((await runtime.acquire()).code, "quarantined");
    assert.equal(await runtime.workerBaseline(), undefined);
    assert.deepEqual(port.requests, []);
  }
});

test("worker baseline requires the exact currently acquired controller slot", async () => {
  for (const observation of [
    slot("available"),
    slot("acquired", "run-2/incarnation-1"),
  ]) {
    const port = new ScriptedPort([
      {
        kind: "state",
        value: {
          autoCommit: "on",
          head: "f".repeat(40),
          reachable: true,
          workingSet: "clean",
        },
      },
      { kind: "slot", value: observation },
    ]);
    assert.equal(await adapter(port, "local-only").workerBaseline(), undefined);
    assert.deepEqual(
      port.requests.map((request) => request.kind),
      ["state", "slot"],
    );
  }
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
    assert.equal(
      (await adapter(port, "local-only").acquire()).code,
      "quarantined",
    );
    assert.deepEqual(port.requests, []);
  });

test("release requires exact current holder and positive available readback", async () => {
  const contender = "run-2/incarnation-1";
  const port = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", contender) },
  ]);
  const blocked = await adapter(port, "local-only").prepareReleaseTransition();
  assert.ok("code" in blocked);
  assert.equal(blocked.code, "blocked");
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    ["state", "slot"],
  );

  const released = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: "f".repeat(40),
        reachable: true,
        workingSet: "clean",
      },
    },
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
    { kind: "slot", value: slot("available") },
  ]);
  const intent = await adapter(
    released,
    "local-only",
  ).prepareReleaseTransition();
  assert.ok("idempotencyKey" in intent);
  assert.equal(
    (
      await adapter(released, "local-only").release({
        transition: intent,
      })
    ).code,
    "applied",
  );
});

test("acquire without a persisted transition is quarantined before any command", async () => {
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
  assert.equal(
    (await adapter(port, "local-only").acquire()).code,
    "quarantined",
  );
  assert.deepEqual(port.requests, []);
});

test("release refuses missing or forged transition authority before any command", async () => {
  for (const authority of [
    undefined,
    { transition: {} },
    {
      transition: {
        holder,
        idempotencyKey: "0".repeat(64),
        kind: "release",
        schema: "sce.beads-embedded.slot-transition",
        scope,
        version: 1,
      },
    },
  ]) {
    const port = new ScriptedPort([]);
    assert.equal(
      (
        await adapter(port, "local-only").release(
          authority as Parameters<EmbeddedBeadsAdapter["release"]>[0],
        )
      ).code,
      "quarantined",
    );
    assert.deepEqual(port.requests, []);
  }
});

test("fresh adapter resumes only the persisted exact pre-push acquire intent", async () => {
  const beforeHead = "b".repeat(40);
  const localHead = "c".repeat(40);
  const planning = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: beforeHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("available") },
  ]);
  const planner = adapter(planning, "git-sync");
  const intent = await planner.prepareAcquireTransition();
  assert.ok("idempotencyKey" in intent);

  // New process: bd already committed the held slot locally, but the remote
  // still has the exact planned available row. A missing journal intent must
  // never report this as applied.
  const withoutIntent = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
  ]);
  assert.equal(
    (
      await adapter(withoutIntent, "git-sync").acquire({
        knownHolder: holder,
      })
    ).code,
    "blocked",
  );
  assert.deepEqual(
    withoutIntent.requests.map((request) => request.kind),
    ["state", "slot"],
  );

  const recovered = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "slot", value: slot("available") },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "slot", value: slot("available") },
    { kind: "push", value: "applied" },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: localHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: localHead,
        reachable: true,
        remoteHead: localHead,
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (
      await adapter(recovered, "git-sync").acquire({
        knownHolder: holder,
        transition: intent,
      })
    ).code,
    "applied",
  );
  assert.equal(
    recovered.requests.filter((request) => request.kind === "push").length,
    1,
  );
});

test("lost-result slot replays prove the exact persisted transition without mutation", async () => {
  const beforeHead = "a".repeat(40);
  const afterHead = "b".repeat(40);
  const forbidden = (port: ScriptedPort) =>
    port.requests.some(
      (request) =>
        request.kind === "commit" ||
        request.kind === "push" ||
        (request.kind === "slot" && request.action !== "check"),
    );

  const releasePlanner = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: beforeHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  const releaseIntent = await adapter(
    releasePlanner,
    "local-only",
  ).prepareReleaseTransition();
  assert.ok("idempotencyKey" in releaseIntent);
  const replayedRelease = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (
      await adapter(replayedRelease, "local-only").release({
        transition: releaseIntent,
      })
    ).code,
    "applied",
  );
  assert.equal(forbidden(replayedRelease), false);
  assert.deepEqual(
    replayedRelease.requests.map((request) => request.kind),
    ["state", "slot", "slot_transition", "state"],
  );

  const rejectedProof = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot_transition", value: "ambiguous" },
  ]);
  assert.equal(
    (
      await adapter(rejectedProof, "local-only").release({
        transition: releaseIntent,
      })
    ).code,
    "ambiguous",
  );
  assert.equal(forbidden(rejectedProof), false);

  const syncReleasePlanner = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: beforeHead,
        reachable: true,
        remoteHead: beforeHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    { kind: "slot", value: slot("acquired", holder) },
  ]);
  const syncReleaseIntent = await adapter(
    syncReleasePlanner,
    "git-sync",
  ).prepareReleaseTransition();
  assert.ok("idempotencyKey" in syncReleaseIntent);
  // The remote row can remain exactly available while an unrelated remote
  // commit lands during its fetch. The final fetched state must refuse that
  // lost-result replay instead of inferring it is the planned release.
  const remoteRace = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        remoteHead: afterHead,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
    { kind: "slot", value: slot("available") },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        remoteHead: "c".repeat(40),
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (
      await adapter(remoteRace, "git-sync").release({
        transition: syncReleaseIntent,
      })
    ).code,
    "ambiguous",
  );
  assert.equal(forbidden(remoteRace), false);

  const acquirePlanner = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: beforeHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("available") },
  ]);
  const acquireIntent = await adapter(
    acquirePlanner,
    "local-only",
  ).prepareAcquireTransition();
  assert.ok("idempotencyKey" in acquireIntent);
  const replayedAcquire = new ScriptedPort([
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
    { kind: "slot", value: slot("acquired", holder) },
    {
      kind: "state",
      value: {
        autoCommit: "on",
        head: afterHead,
        reachable: true,
        workingSet: "clean",
      },
    },
  ]);
  assert.equal(
    (
      await adapter(replayedAcquire, "local-only").acquire({
        transition: acquireIntent,
      })
    ).code,
    "applied",
  );
  assert.equal(forbidden(replayedAcquire), false);
  assert.deepEqual(
    replayedAcquire.requests.map((request) => request.kind),
    ["state", "state", "slot", "slot_transition", "state"],
  );
});

test("available slot with an unresolved projected holder does not mutate", async () => {
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
  ]);
  assert.equal(
    (
      await adapter(port, "local-only").acquire({
        knownHolder: "run-2/incarnation-1",
      })
    ).code,
    "blocked",
  );
  assert.equal(
    port.requests.some(
      (request) =>
        (request.kind === "slot" && request.action !== "check") ||
        request.kind === "commit" ||
        request.kind === "push",
    ),
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
