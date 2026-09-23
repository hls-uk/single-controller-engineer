import assert from "node:assert/strict";
import test from "node:test";

import {
  EmbeddedBeadsAdapter,
  redactedStderrTail,
  type EmbeddedProcessIdentity,
  type EmbeddedProcessPort,
  type EmbeddedRequest,
  type EmbeddedResponse,
  type EmbeddedState,
} from "../../../src/adapters/beads-embedded/index.js";
import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeRootProjection,
  withBatchCheckpoint,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
} from "../../../src/fencing/index.js";
import type { PreflightEnvelope } from "../../../src/preflight/index.js";
import { deriveIdempotencyKey, reduce } from "../../../src/protocol/reducer.js";
import { run as fixtureRun } from "../../protocol/fixtures.js";

/**
 * The push half of the remote-failure tail is scripted in adapter.test.ts.
 * This file scripts the other remote child: the pull that `prepareSharedState`
 * runs before every git-sync write. A refused pull carries the same bounded,
 * redacted tail, and these fixtures pin what the adapter does with it: the
 * code is decided from the pull's own value, and the tail never escapes into
 * a store result, whose shape has no field to carry it.
 */

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";
const head = "c".repeat(40);
const synced: EmbeddedState = {
  autoCommit: "on",
  head,
  reachable: true,
  remoteHead: head,
  workingSet: "clean",
};

// Assembled, never written as a literal, so no scanner has to decide whether
// this file leaked a real credential.
const FAKE_PASSWORD = ["hunter", "2"].join("");

const preflight: Omit<PreflightEnvelope, "payload"> & {
  readonly payload: Extract<PreflightEnvelope["payload"], { status: "ready" }>;
} = {
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
      syncRef: "refs/dolt/data",
      syncRemote: "github.test/org/repo",
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

const identity: EmbeddedProcessIdentity = {
  database: "sce",
  databaseDirectory: "/workspace/repo/.beads/dolt/sce",
  prefix: "sce",
  remote: {
    name: "origin",
    ref: "refs/dolt/data",
    url: "github.test/org/repo",
  },
  storePath: "/workspace/repo/.beads/dolt",
};

function heldSlot(): MergeSlotObservation {
  const value = {
    actor: holder,
    holder,
    label: MERGE_SLOT_LABEL,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status: "acquired" as const,
    title: MERGE_SLOT_TITLE,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

class ScriptedPort implements EmbeddedProcessPort {
  public readonly requests: EmbeddedRequest[] = [];
  public readonly identity = identity;
  private responseIndex = 0;

  public constructor(private readonly responses: readonly EmbeddedResponse[]) {}

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    const next = this.responses[this.responseIndex++];
    if (next === undefined)
      throw new Error(`unscripted request: ${request.kind}`);
    return next;
  }
}

function adapter(port: ScriptedPort): EmbeddedBeadsAdapter {
  return new EmbeddedBeadsAdapter({
    holder,
    mode: "git-sync",
    prefix: "sce",
    preflight,
    process: port,
    scope,
  });
}

/** The one validated batch shape `compareAndSet` admits before it pulls. */
function journalBatch(): MutationBatch {
  const base = fixtureRun([]);
  const [runId, incarnationId] = holder.split("/");
  const initial = {
    ...base,
    controller: {
      ...base.controller,
      holder,
      incarnationId: incarnationId ?? "",
      runId: runId ?? "",
      state: "unacquired" as const,
    },
    integrationBranch: scope.integrationBranch,
    repositoryIdentity: scope.gitRepositoryIdentity,
    state: "initializing" as const,
    storeIdentity: scope.beadsStoreIdentity,
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

test("a refused git-sync pull is classified by its own value, not by its tail", async () => {
  const stderrTail = redactedStderrTail(
    [
      `pulling from ssh://sce:${FAKE_PASSWORD}@dolt.example.invalid/sce/beads`,
      "sce@dolt.example.invalid: Permission denied (publickey).",
      "fatal: Could not read from remote repository.",
    ].join("\n"),
    false,
  );
  assert.ok(stderrTail !== undefined);
  // The scripted fixture is already redacted, exactly as a real port's is.
  assert.equal(stderrTail.text.includes(FAKE_PASSWORD), false);
  assert.ok(stderrTail.text.includes("Permission denied (publickey)."));
  // One tail, three refusals: the status comes from the pull's value alone.
  for (const [value, status] of [
    ["conflict", "ambiguous"],
    ["unavailable", "unavailable"],
    ["ambiguous", "ambiguous"],
  ] as const) {
    const port = new ScriptedPort([
      { kind: "state", value: synced },
      { kind: "state", value: synced },
      { kind: "pull", stderrTail, value },
    ]);
    const outcome = await adapter(port).compareAndSet(journalBatch());
    assert.deepEqual(
      port.requests.map((request) => request.kind),
      ["state", "state", "pull"],
      JSON.stringify(port.requests),
    );
    assert.deepEqual(outcome, { status }, value);
    // A store result has no field for diagnostic text, so nothing the child
    // wrote - redacted or not - reaches the caller through this path.
    const published = JSON.stringify(outcome);
    assert.equal(published.includes("stderrTail"), false);
    assert.equal(published.includes("dolt.example.invalid"), false);
  }
});

test("an applied pull carries no tail and preparation continues past it", async () => {
  const port = new ScriptedPort([
    { kind: "state", value: synced },
    { kind: "state", value: synced },
    { kind: "pull", value: "applied" },
    { kind: "state", value: synced },
    { kind: "slot", value: heldSlot() },
    { kind: "mutation", value: "holder_mismatch" },
  ]);
  const outcome = await adapter(port).compareAndSet(journalBatch());
  // The control for the refusal fixture above: the same three opening
  // requests, and then the write the refusals never reach.
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    ["state", "state", "pull", "state", "slot", "mutation"],
    JSON.stringify(port.requests),
  );
  assert.deepEqual(outcome, { status: "holder_mismatch" });
});
