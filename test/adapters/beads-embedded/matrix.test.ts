import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  PinnedBdEmbeddedProcess,
  PROJECTION_INITIALIZATION_AUTHORITY,
} from "../../../src/adapters/beads-embedded/index.js";
import {
  deriveScopeCommitment,
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
  validateMutationBatch,
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import { reduce } from "../../../src/protocol/reducer.js";
import type { RepositoryRun } from "../../../src/protocol/schemas.js";
import { HASH, event, run as fixtureRun } from "../../protocol/fixtures.js";

const execute = promisify(execFile);
const BD = "/opt/homebrew/bin/bd";
const DOLT = "/opt/homebrew/bin/dolt";
const holder = "run-1/incarnation-1";
const scope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};

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
    timeout: 20_000,
  });
}

async function json(cwd: string, args: readonly string[]) {
  const { stdout } = await run(cwd, BD, args);
  return JSON.parse(stdout) as unknown;
}

function reduced(
  state: RepositoryRun,
  type: Parameters<typeof event>[1],
  fields: Record<string, unknown>,
): RepositoryRun {
  const result = reduce(state, event(state, type, fields));
  assert.equal(result.ok, true, `expected ${type} to reduce`);
  if (!result.ok) throw new Error("unreachable");
  return result.nextState;
}

/** Construct the exact root/one-child batch the controller journal retains. */
function batch(
  beforeState: RepositoryRun,
  nextState: RepositoryRun,
): MutationBatch {
  const before = makeRootProjection(beforeState);
  const nextBase = makeRootProjection(nextState);
  const beforeChild = before.childRows.find(
    (child) => child.unitId === "unit-1",
  );
  const nextChild = makeChildProjection(nextBase, "unit-1");
  assert.ok(beforeChild);
  assert.ok(nextChild);
  const changedRows = [
    {
      expectedCommitment: beforeChild.commitment,
      expectedRevision: beforeChild.revision,
      nextCommitment: nextChild.commitment,
      nextRevision: nextChild.revision,
      unitId: nextChild.unitId,
    },
  ];
  const root = withBatchCheckpoint(nextBase, changedRows);
  const value: MutationBatch = {
    changedRows,
    checkpoint: root.checkpoint,
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: [
      {
        expectedCommitment: beforeChild.commitment,
        expectedRevision: beforeChild.revision,
        unitId: beforeChild.unitId,
      },
    ],
    expectedHolder: holder,
    holder,
    next: { children: [nextChild], root },
    schema: "sce.fencing.batch",
    scope,
    version: 1,
  };
  assert.equal(validateMutationBatch(value).ok, true);
  return value;
}

function preflight(cwd: string) {
  return {
    payload: {
      beads: {
        beadsDir: join(cwd, ".beads"),
        contextSchemaVersion: 1 as const,
        database: "sce",
        mode: "embedded" as const,
        prefix: "sce",
        provenance: "embedded_config" as const,
        storePath: join(cwd, ".beads", "embeddeddolt"),
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
  };
}

function localProcess(
  cwd: string,
  database: string,
  projections: DoltProjectionPersistence,
) {
  return new PinnedBdEmbeddedProcess({
    bdExecutable: BD,
    cwd,
    databaseDirectory: database,
    doltExecutable: DOLT,
    prefix: "sce",
    projections,
    scope,
  });
}

function localAdapter(cwd: string, process: PinnedBdEmbeddedProcess) {
  return new EmbeddedBeadsAdapter({
    holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(cwd),
    process,
    scope,
  });
}

async function executable(
  path: string,
  body: readonly string[],
): Promise<void> {
  await writeFile(path, body.join("\n"), { mode: 0o700 });
  await chmod(path, 0o700);
}

test("concrete embedded matrix atomically persists root and child, recovers crashes, and blocks unrelated pending work", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-matrix-");
  try {
    await run(root, "git", ["init", "-q"]);
    await run(root, BD, [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      "",
    ]);
    await json(root, ["merge-slot", "create", "--json"]);
    await json(root, ["create", "--id", "sce-root", "root", "--json"]);
    await json(root, ["create", "--id", "sce-child", "child", "--json"]);
    await json(root, [
      "update",
      "sce-merge-slot",
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      "--design",
      JSON.stringify(scope),
      "--json",
    ]);
    const database = join(root, ".beads", "embeddeddolt", "sce");
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        { id: "reservation-1", namespace: "branch", resource: "main" },
      ],
    });
    const bootstrap = batch(state0, state1);
    const persistence = new DoltProjectionPersistence({
      childIssueId: (unitId) => (unitId === "unit-1" ? "sce-child" : undefined),
      databaseDirectory: database,
      doltExecutable: DOLT,
      rootIssueId: "sce-root",
    });
    assert.equal(
      (
        await persistence.initialize(
          PROJECTION_INITIALIZATION_AUTHORITY,
          bootstrap,
        )
      ).value,
      "applied",
    );
    assert.deepEqual(await persistence.readback(bootstrap), bootstrap.next);
    await run(root, BD, ["dolt", "commit", "--json"]);

    const state2 = reduced(state1, "reservation_observed", {
      effectId: "event-1:reservation_acquire",
      effectKind: "reservation_acquire",
      observationHash: HASH,
    });
    const state3 = reduced(state2, "branch_intent", {
      branchRef: "sce/unit-1",
    });
    const state4 = reduced(state3, "branch_observed", {
      branchRef: "sce/unit-1",
      effectId: "event-3:branch_create",
      effectKind: "branch_create",
      observationHash: HASH,
    });
    const process = localProcess(root, database, persistence);
    const adapter = localAdapter(root, process);
    assert.equal((await adapter.acquire()).code, "applied");
    const policyBatches = [
      ["off", batch(state1, state2)],
      ["on", batch(state2, state3)],
      ["batch", batch(state3, state4)],
    ] as const;
    for (const [policy, controllerBatch] of policyBatches) {
      await run(root, BD, ["config", "set", "dolt.auto-commit", policy]);
      await run(root, BD, ["dolt", "commit", "--json"]);
      const before = await process.execute({ kind: "state" });
      assert.equal(before.kind, "state");
      assert.equal(before.value.autoCommit, policy);
      assert.equal(before.value.workingSet, "clean");
      const applied = await adapter.compareAndSet(controllerBatch);
      assert.equal(applied.status, "applied");
      assert.deepEqual(applied.children, controllerBatch.next.children);
      assert.deepEqual(applied.root, controllerBatch.next.root);
      const after = await process.execute({ kind: "state" });
      assert.equal(after.kind, "state");
      assert.equal(after.value.autoCommit, policy);
      assert.equal(after.value.workingSet, "clean");
    }
    const atomic = policyBatches[2][1];

    const stableBefore = await persistence.discover({
      batch: atomic,
      kind: "discover",
      point: "after_commit",
    });
    const staleRoot: MutationBatch = {
      ...atomic,
      expectedAggregateCommitment: "0".repeat(64),
    };
    const staleChildRows = atomic.changedRows.map((row) => ({
      ...row,
      expectedCommitment: "f".repeat(64),
    }));
    const staleChildRoot = withBatchCheckpoint(
      atomic.next.root,
      staleChildRows,
    );
    const staleChild: MutationBatch = {
      ...atomic,
      changedRows: staleChildRows,
      checkpoint: staleChildRoot.checkpoint,
      expectedChildren: atomic.expectedChildren.map((child) => ({
        ...child,
        expectedCommitment: "f".repeat(64),
      })),
      next: { ...atomic.next, root: staleChildRoot },
    };
    assert.equal(validateMutationBatch(staleRoot).ok, true);
    const staleChildValidation = validateMutationBatch(staleChild);
    assert.equal(
      staleChildValidation.ok,
      true,
      staleChildValidation.ok ? "" : staleChildValidation.reason,
    );
    assert.equal((await persistence.mutate(staleRoot)).value, "stale");
    assert.equal((await persistence.mutate(staleChild)).value, "stale");
    assert.deepEqual(
      await persistence.discover({
        batch: atomic,
        kind: "discover",
        point: "after_commit",
      }),
      stableBefore,
    );

    // Simulate termination after the atomic write but before commit. A fresh
    // process has only the controller batch as authority and must resume once.
    const state5 = reduced(state4, "worktree_intent", {
      worktreePath: "/private/tmp/sce-unit-1",
    });
    const beforeCommit = batch(state4, state5);
    assert.equal((await persistence.mutate(beforeCommit)).value, "applied");
    const restartedBeforeCommit = localAdapter(
      root,
      localProcess(
        root,
        database,
        new DoltProjectionPersistence({
          childIssueId: (unitId) =>
            unitId === "unit-1" ? "sce-child" : undefined,
          databaseDirectory: database,
          doltExecutable: DOLT,
          rootIssueId: "sce-root",
        }),
      ),
    );
    assert.equal(
      (await restartedBeforeCommit.compareAndSet(beforeCommit)).status,
      "applied",
    );
    assert.equal(
      (
        await persistence.discover({
          batch: beforeCommit,
          kind: "discover",
          point: "after_commit",
        })
      )?.status,
      "observed",
    );

    // Simulate a crash after commit. The replacement process finds the exact
    // batch rather than reissuing a write, and still returns its durable row.
    const state6 = reduced(state5, "worktree_observed", {
      effectId: "event-5:worktree_create",
      effectKind: "worktree_create",
      observationHash: HASH,
      worktreePath: "/private/tmp/sce-unit-1",
    });
    const afterCommit = batch(state5, state6);
    assert.equal((await persistence.mutate(afterCommit)).value, "applied");
    assert.equal((await process.execute({ kind: "commit" })).value, "applied");
    const restartedAfterCommit = localAdapter(
      root,
      localProcess(root, database, persistence),
    );
    assert.equal(
      (await restartedAfterCommit.compareAndSet(afterCommit)).status,
      "applied",
    );

    const baseline = await restartedAfterCommit.workerBaseline();
    assert.ok(baseline);
    const state7 = reduced(state6, "dispatch_intent", {});
    const unrelated = batch(state6, state7);
    await json(root, [
      "create",
      "--id",
      "sce-unrelated",
      "unrelated",
      "--json",
    ]);
    assert.equal(
      (await restartedAfterCommit.verifyWorkerBaseline(baseline)).code,
      "worker_mutation",
    );
    // An unrelated pending row is not treated as proof of a controller batch;
    // recovery does not commit, pull, or rewrite it.
    const pendingBefore = await process.execute({ kind: "state" });
    assert.equal(pendingBefore.kind, "state");
    assert.equal(pendingBefore.value.workingSet, "pending");
    assert.equal(
      (await restartedAfterCommit.compareAndSet(unrelated)).status,
      "ambiguous",
    );
    const pendingAfter = await process.execute({ kind: "state" });
    assert.deepEqual(pendingAfter, pendingBefore);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pinned process refuses schema skew without surfacing subprocess secrets", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-schema-");
  const fakeBd = join(root, "bd");
  try {
    await writeFile(
      fakeBd,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo \'bd version 1.1.0\'; exit 0; fi',
        'if [ "$1" = "dolt" ] && [ "$2" = "show" ]; then',
        '  echo \'{"backend":"dolt","embedded":true,"schema_version":2,"data_dir":"/secret/never-returned","database":"sce"}\'',
        "  echo 'token=never-returned' >&2",
        "  exit 0",
        "fi",
        "echo '{}'",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(fakeBd, 0o700);
    const process = new PinnedBdEmbeddedProcess({
      bdExecutable: fakeBd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: DOLT,
      prefix: "sce",
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
      scope,
    });
    const observed = await process.execute({ kind: "state" });
    assert.deepEqual(observed, {
      kind: "state",
      value: { autoCommit: "off", reachable: false, workingSet: "unknown" },
    });
    const adapter = new EmbeddedBeadsAdapter({
      holder,
      mode: "local-only",
      prefix: "sce",
      preflight: preflight(root),
      process,
      scope,
    });
    const result = await adapter.acquire();
    assert.equal(result.code, "quarantined");
    assert.equal(JSON.stringify(result).includes("never-returned"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projection executor bounds malformed, oversized, timed-out, replaced, and secret subprocess output", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-exec-");
  const fakeDolt = join(root, "dolt");
  const marker = join(root, "sql-ran");
  try {
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        { id: "reservation-boundary", namespace: "branch", resource: "main" },
      ],
    });
    const controllerBatch = batch(state0, state1);
    const persistence = new DoltProjectionPersistence({
      childIssueId: (unitId) => (unitId === "unit-1" ? "sce-child" : undefined),
      databaseDirectory: root,
      doltExecutable: fakeDolt,
      rootIssueId: "sce-root",
    });

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "printf 'not-json'",
      "printf 'credential=never-leaves-subprocess' >&2",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);

    // A realpath/stat replacement must invalidate the former version proof.
    // The SQL side effect would expose stale cached authorization.
    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 9.9.9\\n"; exit 0; fi',
      'touch "$PWD/sql-ran"',
      "printf '{\"rows\":[]}'",
      "# different fingerprint",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);
    await assert.rejects(access(marker));

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "yes x | head -c 262145",
      "# oversized output",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "sleep 16",
      "# timeout",
    ]);
    const started = Date.now();
    assert.equal(await persistence.readback(controllerBatch), undefined);
    assert.ok(Date.now() - started >= 14_000);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
