import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeChildProjection,
  makeRootProjection,
  validateMutationBatch,
  withBatchCheckpoint,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
} from "../../../src/fencing/index.js";
import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  type EmbeddedProcessIdentity,
  type EmbeddedProcessPort,
  type EmbeddedRequest,
  type EmbeddedResponse,
} from "../../../src/adapters/beads-embedded/index.js";
import { reduce, runInvariantErrors } from "../../../src/protocol/reducer.js";
import type {
  ProtocolEvent,
  RepositoryRun,
} from "../../../src/protocol/schemas.js";
import { event, HASH, run as fixtureRun } from "../../protocol/fixtures.js";

const rootIssueId = "sce-root";
const childIssueId = "sce-child";
const firstHead = "a".repeat(40);
const committedHead = "b".repeat(40);

function apply(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
): RepositoryRun {
  const result = reduce(state, event(state, type, fields));
  assert.equal(
    result.ok,
    true,
    result.ok ? undefined : `${result.code}: ${result.reason}`,
  );
  if (!result.ok) throw new Error("unreachable");
  return result.nextState;
}

function closingStates(): Readonly<{
  before: RepositoryRun;
  next: RepositoryRun;
}> {
  let state = fixtureRun();
  state = apply(state, "cancel_intent");
  let entry = state.effectJournal.at(-1)!;
  state = apply(state, "cancel_observed", {
    effectId: entry.effectId,
    effectKind: entry.kind,
    observationHash: HASH,
  });
  state = apply(state, "reservation_release_intent");
  const before = state;
  entry = state.effectJournal.at(-1)!;
  const next = apply(state, "reservation_released", {
    effectId: entry.effectId,
    effectKind: entry.kind,
    observationHash: HASH,
  });
  assert.deepEqual(runInvariantErrors(before), []);
  assert.deepEqual(runInvariantErrors(next), []);
  assert.deepEqual(Object.keys(before.units), ["unit-1"]);
  assert.deepEqual(Object.keys(next.units), []);
  assert.notEqual(next.closedUnitEvidence, before.closedUnitEvidence);
  assert.notEqual(
    next.closedUnitEvidenceCommitment,
    before.closedUnitEvidenceCommitment,
  );
  return { before, next };
}

function rootOnlyClosureBatch(
  before: RepositoryRun,
  next: RepositoryRun,
): Readonly<{
  batch: MutationBatch;
  retiredChild: NonNullable<ReturnType<typeof makeChildProjection>>;
}> {
  const beforeRoot = makeRootProjection(before);
  const retiredChild = makeChildProjection(beforeRoot, "unit-1");
  assert.ok(retiredChild);
  const root = withBatchCheckpoint(makeRootProjection(next), []);
  const batch: MutationBatch = {
    changedRows: [],
    checkpoint: root.checkpoint,
    expectedAggregateCommitment: beforeRoot.aggregateCommitment,
    expectedAggregateRevision: beforeRoot.aggregateRevision,
    expectedChildren: [],
    expectedHolder: beforeRoot.holder,
    holder: root.holder,
    next: { children: [], root },
    schema: "sce.fencing.batch",
    scope: root.scope,
    version: 1,
  };
  const validated = validateMutationBatch(batch);
  assert.equal(validated.ok, true, validated.ok ? undefined : validated.reason);
  return { batch, retiredChild };
}

function envelope(
  projection:
    | ReturnType<typeof makeRootProjection>
    | NonNullable<ReturnType<typeof makeChildProjection>>,
) {
  return {
    commitment:
      "aggregateCommitment" in projection
        ? projection.aggregateCommitment
        : projection.commitment,
    projection,
  };
}

function hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function scopeFor(run: RepositoryRun): FencingScope {
  return {
    beadsStoreIdentity: run.storeIdentity,
    gitRepositoryIdentity: run.repositoryIdentity,
    integrationBranch: run.integrationBranch,
  };
}

function acquiredSlot(
  scope: FencingScope,
  holder: string,
): MergeSlotObservation {
  const value = {
    actor: holder,
    holder,
    label: "gt:slot" as const,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status: "acquired" as const,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

function processIdentity(): EmbeddedProcessIdentity {
  return {
    database: "sce",
    databaseDirectory: "/workspace/repo/.beads/dolt/sce",
    prefix: "sce",
    storePath: "/workspace/repo/.beads/dolt",
  };
}

function preflight() {
  return {
    payload: {
      beads: {
        beadsDir: "/workspace/repo/.beads",
        contextSchemaVersion: 1 as const,
        database: "sce",
        mode: "embedded" as const,
        prefix: "sce",
        projectId: "store-1",
        provenance: "embedded_config" as const,
        storePath: "/workspace/repo/.beads/dolt",
        toolVersion: "1.1.0" as const,
      },
      git: {
        commonDir: "/workspace/repo/.git",
        identity: "repo-1",
        objectFormat: "sha1" as const,
        topLevel: "/workspace/repo",
      },
      status: "ready" as const,
    },
    schema: "sce.preflight" as const,
    version: 1 as const,
  };
}

class ClosureProcess implements EmbeddedProcessPort {
  public readonly identity = processIdentity();
  public readonly requests: EmbeddedRequest[] = [];
  private head = firstHead;
  private workingSet: "clean" | "pending" = "clean";

  public constructor(
    private readonly persistence: DoltProjectionPersistence,
    private readonly batch: MutationBatch,
    private readonly slot: MergeSlotObservation,
  ) {}

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    switch (request.kind) {
      case "state":
        return {
          kind: "state",
          value: {
            autoCommit: "on",
            head: this.head,
            reachable: true,
            workingSet: this.workingSet,
          },
        };
      case "slot":
        return { kind: "slot", value: this.slot };
      case "mutation": {
        const result = await this.persistence.mutate(request.batch);
        if (result.value === "applied") this.workingSet = "pending";
        return result;
      }
      case "discover":
        return {
          kind: "discover",
          value: {
            baseHead: firstHead,
            childCommitments: [],
            head: this.head,
            rootCommitment: this.batch.next.root.aggregateCommitment,
            status: "observed",
          },
        };
      case "commit":
        this.head = committedHead;
        this.workingSet = "clean";
        return { kind: "commit", value: "applied" };
      case "readback": {
        const value = await this.persistence.readback(request.batch);
        if (value === undefined) throw new Error("missing closure readback");
        return { kind: "readback", value };
      }
      case "load":
        return { kind: "load", value: await this.persistence.load() };
      default:
        throw new Error(`unexpected embedded request ${request.kind}`);
    }
  }
}

test("root-only closure retires the sole child while preserving inert child history", async () => {
  const { before, next } = closingStates();
  const { batch, retiredChild } = rootOnlyClosureBatch(before, next);
  const rows = new Map<string, ReturnType<typeof envelope>>([
    [rootIssueId, envelope(makeRootProjection(before))],
    [childIssueId, envelope(retiredChild)],
  ]);
  const retiredEnvelope = structuredClone(rows.get(childIssueId)!);
  const sqlQueries: string[] = [];
  const persistence = new DoltProjectionPersistence({
    childIssueId: (unitId) => (unitId === "unit-1" ? childIssueId : undefined),
    databaseDirectory: "/private/tmp",
    doltExecutable: "/usr/bin/true",
    rootIssueId,
  });
  Object.defineProperty(persistence, "sql", {
    value: async (query: string): Promise<string> => {
      sqlQueries.push(query);
      if (query.startsWith("UPDATE issues")) {
        assert.ok(query.includes(hex(rootIssueId)));
        assert.equal(query.includes(hex(childIssueId)), false);
        rows.set(rootIssueId, envelope(batch.next.root));
        return JSON.stringify({ rows: [{ affected: 1 }] });
      }
      if (query.startsWith("SELECT id")) {
        const selected = [...rows.entries()]
          .filter(([id]) => query.includes(hex(id)))
          .map(([id, sce]) => ({ id, sce }));
        return JSON.stringify({ rows: selected });
      }
      throw new Error("unexpected projection SQL");
    },
  });
  const scope = scopeFor(before);
  const process = new ClosureProcess(
    persistence,
    batch,
    acquiredSlot(scope, before.controller.holder),
  );
  const adapter = new EmbeddedBeadsAdapter({
    holder: before.controller.holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(),
    process,
    scope,
  });

  const applied = await adapter.compareAndSet(batch);
  assert.deepEqual(applied, {
    affectedRowCount: 1,
    checkpoint: batch.checkpoint,
    children: [],
    root: batch.next.root,
    status: "applied",
  });
  assert.deepEqual(rows.get(childIssueId), retiredEnvelope);
  assert.equal(rows.size, 2);

  const beforeLoadQueries = sqlQueries.length;
  assert.deepEqual(await adapter.load(), {
    status: "observed",
    value: { children: [], root: batch.next.root },
  });
  const loadQueries = sqlQueries.slice(beforeLoadQueries);
  assert.equal(loadQueries.length, 1);
  assert.ok(loadQueries[0]!.includes(hex(rootIssueId)));
  assert.equal(loadQueries[0]!.includes(hex(childIssueId)), false);
  assert.deepEqual(rows.get(childIssueId), retiredEnvelope);

  const requestsBeforeTamper = process.requests.length;
  const tamperedRoot: MutationBatch = {
    ...batch,
    next: {
      ...batch.next,
      root: {
        ...batch.next.root,
        aggregateCommitment: "f".repeat(64),
      },
    },
  };
  const tamperedCheckpoint: MutationBatch = {
    ...batch,
    checkpoint: {
      ...batch.checkpoint,
      changedRowsCommitment: "f".repeat(64),
    },
  };
  assert.deepEqual(await adapter.compareAndSet(tamperedRoot), {
    status: "quarantined",
  });
  assert.deepEqual(await adapter.compareAndSet(tamperedCheckpoint), {
    status: "quarantined",
  });
  assert.equal(process.requests.length, requestsBeforeTamper);
  assert.deepEqual(rows.get(childIssueId), retiredEnvelope);
});
