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
  legacy: MutationBatch;
  retiredChild: NonNullable<ReturnType<typeof makeChildProjection>>;
}> {
  const beforeRoot = makeRootProjection(before);
  const retiredChild = makeChildProjection(beforeRoot, "unit-1");
  assert.ok(retiredChild);
  const root = withBatchCheckpoint(makeRootProjection(next), []);
  // The exact bytes a run persisted before retired rows were predicated.
  const legacy: MutationBatch = {
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
  const batch: MutationBatch = {
    ...legacy,
    retiredChildren: [
      {
        expectedCommitment: retiredChild.commitment,
        expectedRevision: retiredChild.revision,
        unitId: retiredChild.unitId,
      },
    ],
  };
  for (const candidate of [legacy, batch]) {
    const validated = validateMutationBatch(candidate);
    assert.equal(
      validated.ok,
      true,
      validated.ok ? undefined : validated.reason,
    );
  }
  return { batch, legacy, retiredChild };
}

/**
 * The embedded CAS is one conditional statement: its count subquery must match
 * every predicated row, root and retired alike, or the update affects no rows.
 */
function casSucceeds(
  query: string,
  rows: ReadonlyMap<string, ReturnType<typeof envelope>>,
): boolean {
  const root = rows.get(rootIssueId);
  const child = rows.get(childIssueId);
  if (root === undefined || !query.includes(hex(root.commitment))) return false;
  if (!query.includes(hex(childIssueId))) return true;
  return (
    child !== undefined &&
    "revision" in child.projection &&
    query.includes(hex(child.commitment)) &&
    query.includes(hex(String(child.projection.revision)))
  );
}

function installProjectionSql(
  persistence: DoltProjectionPersistence,
  rows: Map<string, ReturnType<typeof envelope>>,
  queries: string[],
  applied: ReturnType<typeof makeRootProjection>,
): void {
  Object.defineProperty(persistence, "sql", {
    value: async (query: string): Promise<string> => {
      queries.push(query);
      if (query.startsWith("UPDATE issues")) {
        const affected = casSucceeds(query, rows) ? 1 : 0;
        if (affected === 1) rows.set(rootIssueId, envelope(applied));
        return JSON.stringify({ rows: [{ affected }] });
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
}

/** Splits the one CAS statement into the rows it writes and the rows it reads. */
function casParts(query: string): Readonly<{ written: string; read: string }> {
  const start = query.indexOf("WHERE id IN (");
  const end = query.indexOf(") AND (SELECT COUNT(*)");
  assert.ok(start >= 0 && end > start);
  return {
    read: query.slice(end),
    written: query.slice(start, end),
  };
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
    private readonly rootCommitment: () => string | undefined,
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
      case "discover": {
        // Authoritative discovery, not a remembered write: a refused CAS must
        // report the root the store still holds.
        const current = this.rootCommitment();
        return current === this.batch.next.root.aggregateCommitment
          ? {
              kind: "discover",
              value: {
                baseHead: firstHead,
                childCommitments: [],
                head: this.head,
                rootCommitment: current,
                status: "observed",
              },
            }
          : {
              kind: "discover",
              value: {
                baseHead: firstHead,
                head: this.head,
                status: "absent",
              },
            };
      }
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
  installProjectionSql(persistence, rows, sqlQueries, batch.next.root);
  const scope = scopeFor(before);
  const process = new ClosureProcess(
    persistence,
    batch,
    acquiredSlot(scope, before.controller.holder),
    () => rows.get(rootIssueId)?.commitment,
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

  // One statement: the retired bead is read as a predicate and is absent from
  // the rows the update writes, so its history is never rewritten.
  const update = sqlQueries.find((query) => query.startsWith("UPDATE issues"));
  assert.ok(update);
  const parts = casParts(update);
  assert.ok(parts.written.includes(hex(rootIssueId)));
  assert.equal(parts.written.includes(hex(childIssueId)), false);
  assert.ok(parts.read.includes(hex(childIssueId)));
  assert.ok(parts.read.includes(hex(retiredChild.commitment)));
  assert.ok(parts.read.includes(hex(String(retiredChild.revision))));
  // The count term covers the root and the one predicated retired row.
  assert.equal(parts.read.split(";", 1)[0]?.endsWith("=2"), true);

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

// The exact bd 1.1.0 issue row as Dolt 2.2.1 `-r json` prints it: NULL columns
// (external_ref, started_at, closed_at) are omitted rather than rendered null.
const NUMERIC_COLUMNS = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns",
];
const TEXT_COLUMNS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type",
];

function issueRow(
  id: string,
  sce: ReturnType<typeof envelope>,
  updatedAt: string,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(NUMERIC_COLUMNS.map((key) => [key, 0])),
    ...Object.fromEntries(TEXT_COLUMNS.map((key) => [key, ""])),
    created_at: "2026-09-22 10:00:00",
    id,
    issue_type: "task",
    metadata: { sce },
    status: "open",
    title: "unit",
    updated_at: updatedAt,
  };
}

function issuesDelta(
  changes: readonly Readonly<{ from_row: unknown; to_row: unknown }>[],
): string {
  return JSON.stringify({ tables: [{ data_diff: changes, name: "issues" }] });
}

function movedRetiredChild(before: RepositoryRun) {
  const unit = before.units["unit-1"];
  assert.ok(unit);
  const moved = makeChildProjection(
    makeRootProjection({
      ...before,
      units: { "unit-1": { ...unit, revision: unit.revision + 1 } },
    }),
    "unit-1",
  );
  assert.ok(moved);
  return moved;
}

test("an out-of-band retired row move refuses the closure CAS", async () => {
  const { before, next } = closingStates();
  const { batch, legacy, retiredChild } = rootOnlyClosureBatch(before, next);
  const moved = movedRetiredChild(before);
  assert.notEqual(moved.commitment, retiredChild.commitment);
  const beforeRoot = makeRootProjection(before);
  const scope = scopeFor(before);

  const attempt = async (candidate: MutationBatch) => {
    const rows = new Map<string, ReturnType<typeof envelope>>([
      [rootIssueId, envelope(beforeRoot)],
      [childIssueId, envelope(moved)],
    ]);
    const persistence = new DoltProjectionPersistence({
      childIssueId: (unitId) =>
        unitId === "unit-1" ? childIssueId : undefined,
      databaseDirectory: "/private/tmp",
      doltExecutable: "/usr/bin/true",
      rootIssueId,
    });
    installProjectionSql(persistence, rows, [], candidate.next.root);
    const adapter = new EmbeddedBeadsAdapter({
      holder: before.controller.holder,
      mode: "local-only",
      prefix: "sce",
      preflight: preflight(),
      process: new ClosureProcess(
        persistence,
        candidate,
        acquiredSlot(scope, before.controller.holder),
        () => rows.get(rootIssueId)?.commitment,
      ),
      scope,
    });
    const result = await adapter.compareAndSet(candidate);
    return {
      child: rows.get(childIssueId),
      result,
      root: rows.get(rootIssueId),
    };
  };

  const predicated = await attempt(batch);
  assert.deepEqual(predicated.result, { status: "stale" });
  assert.deepEqual(predicated.root, envelope(beforeRoot));
  assert.deepEqual(predicated.child, envelope(moved));

  // The same pre-change bytes still behave exactly as they always did: without
  // the predicate the child-only move is simply invisible to the root CAS.
  const unpredicated = await attempt(legacy);
  assert.deepEqual(unpredicated.result, {
    affectedRowCount: 1,
    checkpoint: legacy.checkpoint,
    children: [],
    root: legacy.next.root,
    status: "applied",
  });
  assert.deepEqual(unpredicated.root, envelope(legacy.next.root));
  assert.deepEqual(unpredicated.child, envelope(moved));
});

test("a predicated closure still proves a root-only Dolt delta", () => {
  const { before, next } = closingStates();
  const { batch, retiredChild } = rootOnlyClosureBatch(before, next);
  const persistence = new DoltProjectionPersistence({
    childIssueId: (unitId) => (unitId === "unit-1" ? childIssueId : undefined),
    databaseDirectory: "/private/tmp",
    doltExecutable: "/usr/bin/true",
    rootIssueId,
  });
  const rootChange = {
    from_row: issueRow(
      rootIssueId,
      envelope(makeRootProjection(before)),
      "2026-09-22 10:00:01",
    ),
    to_row: issueRow(
      rootIssueId,
      envelope(batch.next.root),
      "2026-09-22 10:00:02",
    ),
  };
  // A predicated retired row is read, never written, so a closure checkpoint
  // stays the exact root-only diff it was before this contract existed.
  assert.equal(
    persistence.matchesBatchDelta(batch, issuesDelta([rootChange])),
    true,
  );
  assert.equal(
    persistence.matchesBatchDelta(
      batch,
      issuesDelta([
        rootChange,
        {
          from_row: issueRow(
            childIssueId,
            envelope(retiredChild),
            "2026-09-22 10:00:01",
          ),
          to_row: issueRow(
            childIssueId,
            envelope(movedRetiredChild(before)),
            "2026-09-22 10:00:02",
          ),
        },
      ]),
    ),
    false,
  );
});
