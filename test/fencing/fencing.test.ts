import assert from "node:assert/strict";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

import fc from "fast-check";

import {
  type FencingScope,
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  type MergeSlotObservation,
  type MutationBatch,
  OperationLock,
  type OperationLockAcquire,
  type RootProjection,
  decideControllerSlot,
  decodeRootProjection,
  deriveChangedRowsCommitment,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  encodeRootProjection,
  makeChildProjection,
  makeRootProjection,
  persistReducerIntent,
  type RunStorePort,
  validateMergeSlotObservation,
  validateMutationBatch,
  validateSlotRelease,
  withBatchCheckpoint,
} from "../../src/fencing/index.js";
import { canonicalJson } from "../../src/protocol/canonical.js";
import { deriveIdempotencyKey, reduce } from "../../src/protocol/reducer.js";
import type { Reduction } from "../../src/protocol/reducer.js";
import { event, run } from "../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";

function intentReduction(): {
  readonly before: RootProjection;
  readonly reduction: Extract<Reduction, { ok: true }>;
} {
  const state = run();
  const result = reduce(
    state,
    event(state, "reservation_intent", {
      reservations: [
        { id: "reservation-1", namespace: "branch", resource: "main" },
      ],
    }),
  );
  assert.equal(result.ok, true);
  return { before: makeRootProjection(state), reduction: result };
}

function mutation(): {
  readonly batch: MutationBatch;
  readonly reduction: Extract<Reduction, { ok: true }>;
} {
  const { before, reduction } = intentReduction();
  const nextBase = makeRootProjection(reduction.nextState);
  const beforeChild = before.childRows.find((row) => row.unitId === "unit-1");
  const child = makeChildProjection(nextBase, "unit-1");
  assert.ok(beforeChild);
  assert.ok(child);
  const changedRows = [
    {
      expectedCommitment: beforeChild.commitment,
      expectedRevision: beforeChild.revision,
      nextCommitment: child.commitment,
      nextRevision: child.revision,
      unitId: child.unitId,
    },
  ];
  const next = withBatchCheckpoint(nextBase, changedRows);
  return {
    batch: {
      changedRows,
      checkpoint: {
        aggregateRevision: next.aggregateRevision,
        changedRowsCommitment: deriveChangedRowsCommitment(changedRows),
        rootCommitment: next.aggregateCommitment,
      },
      expectedAggregateCommitment: before.aggregateCommitment,
      expectedAggregateRevision: before.aggregateRevision,
      expectedHolder: holder,
      expectedChildren: [
        {
          expectedCommitment: beforeChild.commitment,
          expectedRevision: beforeChild.revision,
          unitId: beforeChild.unitId,
        },
      ],
      holder,
      next: { children: [child], root: next },
      schema: "sce.fencing.batch",
      scope,
      version: 1,
    },
    reduction,
  };
}

function rootOnlyMutation(): {
  readonly batch: MutationBatch;
  readonly reduction: Extract<Reduction, { ok: true }>;
} {
  const initial = run();
  const state = {
    ...initial,
    state: "initializing" as const,
    controller: { ...initial.controller, state: "unacquired" as const },
  };
  const result = reduce(state, {
    eventId: "controller-acquire-root-only",
    expectedRevision: state.revision,
    idempotencyKey: deriveIdempotencyKey(
      state,
      state.revision,
      null,
      "controller_acquire",
    ),
    type: "controller_acquire_intent",
  });
  assert.equal(result.ok, true);
  const before = makeRootProjection(state);
  const nextBase = makeRootProjection(result.nextState);
  const changedRows: MutationBatch["changedRows"] = [];
  const next = withBatchCheckpoint(nextBase, changedRows);
  return {
    batch: {
      changedRows,
      checkpoint: next.checkpoint,
      expectedAggregateCommitment: before.aggregateCommitment,
      expectedAggregateRevision: before.aggregateRevision,
      expectedHolder: holder,
      expectedChildren: [],
      holder,
      next: { children: [], root: next },
      schema: "sce.fencing.batch",
      scope,
      version: 1,
    },
    reduction: result,
  };
}

function slot(
  status: "available" | "acquired",
  slotHolder: string | undefined,
  actor: string,
): MergeSlotObservation {
  const withoutHash = {
    actor,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: MERGE_SLOT_LABEL,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: MERGE_SLOT_TITLE,
    version: 1 as const,
  };
  return { ...withoutHash, readbackHash: deriveSlotReadbackHash(withoutHash) };
}

async function temporaryCommonDir(): Promise<{
  readonly root: string;
  readonly commonDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "sce-fencing-"));
  const commonDir = join(root, ".git");
  await mkdir(commonDir, { mode: 0o700 });
  await chmod(commonDir, 0o700);
  return { root, commonDir: await realpath(commonDir) };
}

async function writeValidLockState(
  commonDir: string,
  nonce = "nonce-stale",
): Promise<string> {
  const directory = join(commonDir, ".sce-op");
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const state = join(directory, "s");
  await writeFile(
    state,
    canonicalJson({
      holder,
      nonce,
      scopeCommitment: deriveScopeCommitment(scope),
      version: 1,
    }),
    { mode: 0o600 },
  );
  await chmod(state, 0o600);
  return state;
}

function acquired(result: OperationLockAcquire) {
  assert.equal(result.status, "acquired");
  if (result.status !== "acquired") throw new Error("lock was not acquired");
  return result.lock;
}

async function waitForLine(
  child: ReturnType<typeof spawn>,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`holder exited ${code}`)));
  });
}

test("root and child projections are canonical, bounded, and agree with the reducer", () => {
  const { batch } = mutation();
  assert.equal(validateMutationBatch(batch).ok, true);
  const encoded = encodeRootProjection(batch.next.root);
  assert.equal(encoded.ok, true);
  assert.deepEqual(decodeRootProjection(encoded.value), {
    ok: true,
    value: batch.next.root,
  });
  assert.equal(decodeRootProjection(JSON.stringify(batch.next.root)).ok, false);
  assert.equal(
    validateMutationBatch({
      ...batch,
      next: { ...batch.next, children: [] },
    }).ok,
    false,
  );
  assert.equal(
    validateMutationBatch({
      ...batch,
      changedRows: [
        { ...batch.changedRows[0]!, nextCommitment: "0".repeat(64) },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateMutationBatch({
      ...batch,
      next: {
        ...batch.next,
        root: { ...batch.next.root, holder: "run-2/incarnation-1" },
      },
    }).ok,
    false,
  );
  assert.equal(
    validateMutationBatch({
      ...batch,
      expectedHolder: "run-2/incarnation-1",
    }).ok,
    false,
  );
});

test("root-only controller batch has zero child rows and an exact root checkpoint", () => {
  const { batch } = rootOnlyMutation();
  assert.equal(batch.changedRows.length, 0);
  assert.deepEqual(batch.next.children, []);
  assert.equal(validateMutationBatch(batch).ok, true);
  assert.equal(
    validateMutationBatch({
      ...batch,
      checkpoint: { ...batch.checkpoint, aggregateRevision: 99 },
    }).ok,
    false,
  );
});

test("continuation batch predicates the prior same-run holder", () => {
  const { batch } = mutation();
  const nextHolder = "run-1/incarnation-2";
  const continuedRootBase = makeRootProjection({
    ...batch.next.root.run,
    controller: {
      ...batch.next.root.run.controller,
      holder: nextHolder,
      incarnationId: "incarnation-2",
    },
  });
  const continuedChild = makeChildProjection(continuedRootBase, "unit-1");
  assert.ok(continuedChild);
  const changedRows = [
    {
      ...batch.changedRows[0]!,
      nextCommitment: continuedChild.commitment,
      nextRevision: continuedChild.revision,
    },
  ];
  const continuedRoot = withBatchCheckpoint(continuedRootBase, changedRows);
  const continuation = {
    nextHolder,
    observationHash: "a".repeat(64),
    previousHolder: holder,
    scopeCommitment: deriveScopeCommitment(scope),
  };
  const continued: MutationBatch = {
    ...batch,
    changedRows,
    checkpoint: continuedRoot.checkpoint,
    continuation,
    expectedHolder: holder,
    holder: nextHolder,
    next: { children: [continuedChild], root: continuedRoot },
  };
  assert.equal(validateMutationBatch(continued).ok, true);
  assert.equal(
    validateMutationBatch({
      ...continued,
      continuation: {
        ...continuation,
        previousHolder: "run-2/incarnation-1",
      },
      expectedHolder: "run-2/incarnation-1",
    }).ok,
    false,
  );
});

test("projection decoder quarantines partial, corrupt, and inconsistent persisted state", () => {
  const root = makeRootProjection(run());
  const encoded = encodeRootProjection(root);
  assert.equal(encoded.ok, true);
  for (const source of [
    "{",
    encoded.value.slice(0, -1),
    encoded.value.replace('"version":1', '"version":2'),
    encoded.value.replace(
      '"holder":"run-1/incarnation-1"',
      '"holder":"run-2/incarnation-1"',
    ),
  ])
    assert.equal(decodeRootProjection(source).ok, false);
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 64 }), (suffix) => {
      assert.equal(decodeRootProjection(`${encoded.value}${suffix}`).ok, false);
    }),
  );
});

test("run-store coordinator makes one CAS call and releases effects only after exact apply", async () => {
  const { batch, reduction } = mutation();
  const calls: MutationBatch[] = [];
  const applied: RunStorePort = {
    compareAndSet: async (input) => {
      calls.push(input);
      return {
        affectedRowCount: 1 + input.changedRows.length,
        checkpoint: input.checkpoint,
        children: input.next.children,
        root: input.next.root,
        status: "applied" as const,
      };
    },
  };
  const persisted = await persistReducerIntent(applied, batch, reduction);
  assert.equal(calls.length, 1);
  assert.equal(persisted.outcome, "applied");
  assert.deepEqual(persisted.effects, reduction.effects);
  for (const outcome of ["stale", "ambiguous", "holder_mismatch"] as const) {
    const result = await persistReducerIntent(
      { compareAndSet: async () => ({ status: outcome }) },
      batch,
      reduction,
    );
    assert.equal(result.outcome, outcome);
    assert.deepEqual(result.effects, []);
  }
  const bad = await persistReducerIntent(
    applied,
    { ...batch, expectedAggregateRevision: 99 },
    reduction,
  );
  assert.equal(bad.outcome, "quarantined");
  assert.equal(calls.length, 1);

  const rootOnly = rootOnlyMutation();
  const rootOnlyApplied = await persistReducerIntent(
    {
      compareAndSet: async (input) => ({
        affectedRowCount: 1,
        checkpoint: input.checkpoint,
        children: [],
        root: input.next.root,
        status: "applied" as const,
      }),
    },
    rootOnly.batch,
    rootOnly.reduction,
  );
  assert.equal(rootOnlyApplied.outcome, "applied");

  const lies: readonly RunStorePort[] = [
    {
      compareAndSet: async (input) => ({
        affectedRowCount: 1,
        checkpoint: input.checkpoint,
        children: input.next.children,
        root: input.next.root,
        status: "applied" as const,
      }),
    },
    {
      compareAndSet: async (input) => ({
        affectedRowCount: 1 + input.changedRows.length,
        checkpoint: input.checkpoint,
        children: input.next.children,
        root: makeRootProjection(run()),
        status: "applied" as const,
      }),
    },
    {
      compareAndSet: async (input) => ({
        affectedRowCount: 1 + input.changedRows.length,
        checkpoint: input.checkpoint,
        children: [],
        root: input.next.root,
        status: "applied" as const,
      }),
    },
    {
      compareAndSet: async (input) => ({
        affectedRowCount: 1 + input.changedRows.length,
        checkpoint: makeRootProjection(run()).checkpoint,
        children: input.next.children,
        root: input.next.root,
        status: "applied" as const,
      }),
    },
  ];
  for (const lyingAdapter of lies) {
    const result = await persistReducerIntent(lyingAdapter, batch, reduction);
    assert.equal(result.outcome, "quarantined");
    assert.deepEqual(result.effects, []);
  }
});

test("merge-slot decisions never create lazily and fence continuation, takeover, and release", () => {
  const available = slot("available", undefined, holder);
  assert.deepEqual(
    decideControllerSlot("sce", scope, holder, undefined, available),
    {
      kind: "acquire",
    },
  );
  // A controller projection which still names any holder cannot use a bare
  // available readback as a takeover authority. This is the generic guard
  // against an unpushed local acquire in another clone.
  for (const projected of [holder, "run-2/incarnation-1"]) {
    assert.deepEqual(
      decideControllerSlot("sce", scope, holder, projected, available),
      { kind: "blocked" },
    );
    assert.deepEqual(
      decideControllerSlot(
        "sce",
        scope,
        holder,
        projected,
        available,
        undefined,
        {
          holder: projected,
          readback: slot("available", undefined, projected),
        },
      ),
      { kind: "acquire" },
    );
  }
  assert.deepEqual(
    decideControllerSlot(
      "sce",
      scope,
      holder,
      holder,
      slot("acquired", holder, holder),
    ),
    { kind: "resume" },
  );
  const nextHolder = "run-1/incarnation-2";
  const continued = slot("acquired", nextHolder, nextHolder);
  assert.deepEqual(
    decideControllerSlot("sce", scope, nextHolder, holder, continued),
    {
      kind: "blocked",
    },
  );
  assert.deepEqual(
    decideControllerSlot("sce", scope, nextHolder, holder, continued, {
      nextHolder,
      previousHolder: holder,
      before: slot("acquired", holder, holder),
      after: continued,
    }),
    { kind: "continue" },
  );
  assert.deepEqual(
    decideControllerSlot(
      "sce",
      scope,
      holder,
      holder,
      slot("acquired", "run-2/incarnation-1", "run-2/incarnation-1"),
    ),
    { kind: "blocked" },
  );
  assert.deepEqual(
    decideControllerSlot("sce", scope, holder, undefined, {
      ...available,
      slotId: "gt:slot",
    }),
    { kind: "quarantined" },
  );
  assert.equal(
    validateMergeSlotObservation(
      { ...available, scopeCommitment: "0".repeat(64) },
      "sce",
      scope,
    ).ok,
    false,
  );
  assert.equal(
    validateSlotRelease("sce", scope, holder, {
      holder,
      readback: slot("available", undefined, holder),
    }).ok,
    true,
  );
  assert.equal(
    validateSlotRelease("sce", scope, holder, {
      holder,
      readback: slot("available", undefined, "run-2/incarnation-1"),
    }).ok,
    false,
  );
});

test("operation lock serializes linked worktrees and refuses unsafe paths", async () => {
  const { root, commonDir } = await temporaryCommonDir();
  try {
    const first = acquired(
      await OperationLock.acquire({
        commonDir,
        holder,
        nonce: "nonce-1",
        scope,
      }),
    );
    assert.deepEqual(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-2",
        scope,
      }),
      { status: "held" },
    );
    const directory = join(commonDir, ".sce-op");
    const state = await lstat(join(directory, "s"));
    assert.equal(state.mode & 0o777, 0o600);
    const parent = await lstat(directory);
    assert.equal(parent.mode & 0o777, 0o700);
    assert.deepEqual(await first.release(), { status: "released" });
    const second = acquired(
      await OperationLock.acquire({
        commonDir,
        holder,
        nonce: "nonce-3",
        scope,
      }),
    );
    assert.deepEqual(await second.release(), { status: "released" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  const unsafe = await temporaryCommonDir();
  try {
    await symlink(
      join(unsafe.root, "foreign"),
      join(unsafe.commonDir, ".sce-op"),
    );
    assert.deepEqual(
      await OperationLock.acquire({
        commonDir: unsafe.commonDir,
        holder,
        nonce: "nonce-unsafe",
        scope,
      }),
      { status: "quarantined" },
    );
  } finally {
    await rm(unsafe.root, { force: true, recursive: true });
  }
});

test("operation lock recovers a killed holder without a TTL or PID break", async () => {
  const { root, commonDir } = await temporaryCommonDir();
  const script = join(root, "holder.mjs");
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "src/fencing/operation-lock.ts"),
  ).href;
  try {
    await writeFile(
      script,
      [
        `import { OperationLock } from ${JSON.stringify(moduleUrl)};`,
        `const [commonDir, holder, nonce] = process.argv.slice(2);`,
        `const result = await OperationLock.acquire({ commonDir, holder, nonce, scope: ${JSON.stringify(scope)} });`,
        `if (result.status !== "acquired") process.exit(2);`,
        `process.stdout.write("held\\n");`,
        `setInterval(() => undefined, 1_000);`,
      ].join("\n"),
      "utf8",
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, commonDir, holder, "nonce-child"],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    await waitForLine(child, "held");
    assert.deepEqual(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-contender",
        scope,
      }),
      { status: "held" },
    );
    child.kill("SIGKILL");
    await once(child, "exit");
    const recovered = acquired(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-recovered",
        scope,
      }),
    );
    assert.deepEqual(await recovered.release(), { status: "released" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("operation lock recovers only proven crash boundaries and preserves replacement state", async () => {
  const { root, commonDir } = await temporaryCommonDir();
  const socket = join(commonDir, ".sce-op", "l");
  const state = join(commonDir, ".sce-op", "s");
  const bindScript = [
    'import { chmodSync } from "node:fs";',
    'import { createServer } from "node:net";',
    "const server = createServer();",
    "server.listen(process.argv[1], () => {",
    "  chmodSync(process.argv[1], 0o600);",
    '  process.stdout.write("bound\\n");',
    "});",
    "setInterval(() => undefined, 1000);",
  ].join("\n");
  try {
    // Death after bind/before state: only a refused, mode-checked socket is
    // recoverable; no state file is fabricated.
    await mkdir(join(commonDir, ".sce-op"), { mode: 0o700 });
    await chmod(join(commonDir, ".sce-op"), 0o700);
    const bound = spawn(
      process.execPath,
      ["--input-type=module", "-e", bindScript, socket],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await waitForLine(bound, "bound");
    bound.kill("SIGKILL");
    await once(bound, "exit");
    assert.equal((await lstat(socket)).isSocket(), true);
    const recoveredSocket = acquired(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-refused-socket",
        scope,
      }),
    );
    assert.deepEqual(await recoveredSocket.release(), { status: "released" });

    // Death after socket close but before state cleanup is likewise precise.
    await writeValidLockState(commonDir, "nonce-state-only");
    assert.equal((await lstat(state)).isFile(), true);
    const recoveredState = acquired(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-state-recovered",
        scope,
      }),
    );
    assert.deepEqual(await recoveredState.release(), { status: "released" });

    await writeFile(state, "{}", { mode: 0o600 });
    await chmod(state, 0o600);
    assert.deepEqual(
      await OperationLock.acquire({
        commonDir,
        holder,
        nonce: "nonce-corrupt",
        scope,
      }),
      { status: "quarantined" },
    );
    await rm(state, { force: true });

    // Replacing a holder's state inode must not be mistaken for its positive
    // release, nor can its release remove the replacement.
    const script = join(root, "replace-holder.mjs");
    const moduleUrl = pathToFileURL(
      join(process.cwd(), "src/fencing/operation-lock.ts"),
    ).href;
    await writeFile(
      script,
      [
        `import { OperationLock } from ${JSON.stringify(moduleUrl)};`,
        `const [commonDir, holder, nonce] = process.argv.slice(2);`,
        `const result = await OperationLock.acquire({ commonDir, holder, nonce, scope: ${JSON.stringify(scope)} });`,
        `if (result.status !== "acquired") process.exit(2);`,
        'process.stdout.write("held\\n");',
        'process.stdin.once("data", async () => {',
        '  process.stdout.write(JSON.stringify(await result.lock.release()) + "\\n");',
        "  process.exit(0);",
        "});",
      ].join("\n"),
      "utf8",
    );
    const holderChild = spawn(
      process.execPath,
      ["--import", "tsx", script, commonDir, holder, "nonce-original"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    await waitForLine(holderChild, "held");
    await rm(state, { force: true });
    await writeValidLockState(commonDir, "nonce-replacement");
    holderChild.stdin?.write("release\n");
    await waitForLine(holderChild, "holder_mismatch");
    await once(holderChild, "exit");
    assert.equal((await lstat(state)).isFile(), true);
    const finalRecovery = acquired(
      await OperationLock.acquire({
        commonDir,
        holder: "run-2/incarnation-1",
        nonce: "nonce-final-recovery",
        scope,
      }),
    );
    assert.deepEqual(await finalRecovery.release(), { status: "released" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
