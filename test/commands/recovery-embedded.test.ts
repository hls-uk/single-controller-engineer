import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeChildProjection,
  makeRootProjection,
  type FencingScope,
  type MergeSlotObservation,
} from "../../src/fencing/index.js";
import type { InitialControllerAcquire } from "../../src/commands/recovery.js";
import type { PreflightEnvelope } from "../../src/preflight/index.js";
import {
  EmbeddedBeadsAdapter,
  makeSlotTransitionIntent,
  PinnedBdEmbeddedProcess,
  type EmbeddedProcessIdentity,
  type EmbeddedProcessPort,
  type EmbeddedRequest,
  type EmbeddedResponse,
} from "../../src/adapters/beads-embedded/index.js";
import { deriveIdempotencyKey, reduce } from "../../src/protocol/reducer.js";
import { run, unit } from "../protocol/fixtures.js";

const holder = "run-1/incarnation-1";
const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};

function preflight(): PreflightEnvelope {
  return {
    payload: {
      beads: {
        beadsDir: "/repo/.beads",
        contextSchemaVersion: 1,
        database: "sce",
        mode: "embedded",
        prefix: "sce",
        projectId: "store-1",
        provenance: "embedded_config",
        storePath: "/repo/.beads/dolt",
        toolVersion: "1.1.0",
      },
      git: {
        commonDir: "/repo/.git",
        identity: "repo-1",
        objectFormat: "sha1",
        topLevel: "/repo",
      },
      status: "ready",
    },
    schema: "sce.preflight",
    version: 1,
  };
}

function identity(): EmbeddedProcessIdentity {
  return {
    database: "sce",
    databaseDirectory: "/repo/.beads/dolt/sce",
    prefix: "sce",
    storePath: "/repo/.beads/dolt",
  };
}

function slot(
  status: "available" | "acquired" = "available",
  slotHolder = holder,
): MergeSlotObservation {
  const value = {
    actor: status === "acquired" ? slotHolder : holder,
    ...(status === "acquired" ? { holder: slotHolder } : {}),
    label: "gt:slot" as const,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

function initialAcquire(unitCount = 0): InitialControllerAcquire {
  const base = run(
    Array.from({ length: unitCount }, (_, index) => unit(`unit-${index + 1}`)),
  );
  const initial = {
    ...base,
    controller: { ...base.controller, state: "unacquired" as const },
    state: "initializing" as const,
  };
  const transition = makeSlotTransitionIntent(
    "acquire",
    holder,
    scope,
    { head: "a".repeat(40), slot: slot() },
    slot("acquired"),
  );
  const reduced = reduce(initial, {
    eventId: "acquire",
    expectedRevision: initial.revision,
    idempotencyKey: deriveIdempotencyKey(
      initial,
      initial.revision,
      null,
      "controller_acquire",
    ),
    slotTransition: transition,
    type: "controller_acquire_intent",
  });
  assert.equal(reduced.ok, true);
  if (!reduced.ok) throw new Error("unreachable");
  return {
    expected: { children: "absent", holder, root: "absent", scope },
    next: (() => {
      const root = makeRootProjection(reduced.nextState);
      return {
        children: Object.keys(reduced.nextState.units)
          .sort()
          .map((unitId) => makeChildProjection(root, unitId)!),
        root,
      };
    })(),
    schema: "sce.recovery.initial-controller-acquire",
    version: 1,
  };
}

class BootstrapPort implements EmbeddedProcessPort {
  public readonly identity = identity();
  public readonly requests: EmbeddedRequest[] = [];
  private initialized = false;
  private committed = false;

  public constructor(
    private readonly beforeLoad: "absent" | "ambiguous" = "absent",
    private readonly currentSlot: MergeSlotObservation = slot(),
  ) {}

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    switch (request.kind) {
      case "load":
        return this.initialized
          ? {
              kind: "load",
              value: {
                status: "observed",
                value: {
                  children: (
                    this.requests.find(
                      (item) => item.kind === "initialize",
                    ) as Extract<EmbeddedRequest, { kind: "initialize" }>
                  ).input.children,
                  root: (
                    this.requests.find(
                      (item) => item.kind === "initialize",
                    ) as Extract<EmbeddedRequest, { kind: "initialize" }>
                  ).input.root,
                },
              },
            }
          : { kind: "load", value: { status: this.beforeLoad } };
      case "state":
        return {
          kind: "state",
          value: {
            autoCommit: "off",
            head: "a".repeat(40),
            reachable: true,
            workingSet:
              this.initialized && !this.committed ? "pending" : "clean",
          },
        };
      case "slot":
        return { kind: "slot", value: this.currentSlot };
      case "initialize":
        this.initialized = true;
        return { kind: "mutation", value: "applied" };
      case "discover":
        return {
          kind: "discover",
          value: {
            head: "b".repeat(40),
            status: "observed",
          },
        };
      case "initial_commit":
        this.committed = true;
        return { kind: "commit", value: "applied" };
      case "readback":
        return { kind: "readback", value: request.batch.next };
      default:
        throw new Error(`unexpected ${request.kind}`);
    }
  }
}

function adapter(port: EmbeddedProcessPort) {
  return new EmbeddedBeadsAdapter({
    holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(),
    process: port,
    scope,
  });
}

test("embedded absent bootstrap writes one intended projection before commit", async () => {
  const port = new BootstrapPort();
  const result =
    await adapter(port).createControllerAcquireIntent(initialAcquire());
  assert.equal(result.status, "applied");
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    [
      "load",
      "state",
      "slot",
      "state",
      "initialize",
      "state",
      "initial_commit",
      "state",
      "load",
    ],
  );
  assert.equal(
    port.requests.filter((request) => request.kind === "initialize").length,
    1,
  );
});

test("pinned initial checkpoint rejects unrelated pending and parent deltas", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-initial-proof-"));
  const bd = join(root, "bd");
  const dolt = join(root, "dolt");
  const mutation = join(root, "mutated");
  const localHead = "b".repeat(40);
  const remoteHead = "a".repeat(40);
  try {
    await writeFile(
      bd,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'bd version 1.1.0\\n'; exit 0; fi\ntouch '${mutation}'\nexit 1\n`,
      { mode: 0o700 },
    );
    await chmod(bd, 0o700);
    await writeFile(
      dolt,
      `#!/bin/sh\nif [ "$1" = "version" ]; then printf 'dolt version 2.2.1\\n'; exit 0; fi\nif [ "$1" = "remote" ]; then printf 'origin git+file://sync.test/repo\\n'; exit 0; fi\nif [ "$1" = "fetch" ]; then exit 0; fi\nif [ "$1" = "sql" ]; then\n  case "$5" in\n    *'DOLT_HASHOF("HEAD")'*) printf '{"rows":[{"head":"${localHead}"}]}' ;;\n    *"DOLT_HASHOF('origin/main')"*) printf '{"rows":[{"head":"${remoteHead}"}]}' ;;\n    *'SELECT * FROM dolt_status'*) printf '{}' ;;\n    *'dolt_commit_ancestors'*) printf '{"rows":[{"parent_hash":"${remoteHead}","parent_index":0}]}' ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\nif [ "$1" = "diff" ]; then printf '{"tables":[]}'; exit 0; fi\ntouch '${mutation}'\nexit 1\n`,
      { mode: 0o700 },
    );
    await chmod(dolt, 0o700);
    const process = new PinnedBdEmbeddedProcess({
      bdExecutable: bd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: dolt,
      prefix: "sce",
      remote: {
        name: "origin",
        ref: "refs/dolt/data",
        url: "git+file://sync.test/repo",
      },
      scope,
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        matchesBatchDelta() {
          return false;
        },
        matchesInitialDelta() {
          return false;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
    });
    const input = initialAcquire().next;
    assert.deepEqual(await process.execute({ kind: "initial_commit", input }), {
      kind: "commit",
      value: "ambiguous",
    });
    assert.deepEqual(await process.execute({ kind: "initial_push", input }), {
      kind: "push",
      value: "ambiguous",
    });
    await assert.rejects(access(mutation));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("embedded ambiguous load never falls through to bootstrap", async () => {
  const port = new BootstrapPort("ambiguous");
  const result =
    await adapter(port).createControllerAcquireIntent(initialAcquire());
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(
    port.requests.map((request) => request.kind),
    ["load"],
  );
});

test("multi-unit initial projection is one atomic intent and duplicate replay writes once", async () => {
  const port = new BootstrapPort();
  const runtime = adapter(port);
  const input = initialAcquire(3);
  const first = await runtime.createControllerAcquireIntent(input);
  const replay = await runtime.createControllerAcquireIntent(input);
  assert.equal(first.status, "applied");
  assert.equal(replay.status, "applied");
  assert.equal(
    port.requests.filter((request) => request.kind === "initialize").length,
    1,
  );
  const initialized = port.requests.find(
    (request) => request.kind === "initialize",
  ) as Extract<EmbeddedRequest, { kind: "initialize" }>;
  assert.equal(initialized.input.children.length, 3);
  assert.equal(
    port.requests.filter((request) => request.kind === "initial_commit").length,
    2,
  );
});

test("partial/corrupt rows and a foreign occupied slot have zero bootstrap mutation", async () => {
  const partial = new BootstrapPort("ambiguous");
  const partialResult = await adapter(partial).createControllerAcquireIntent(
    initialAcquire(2),
  );
  assert.equal(partialResult.status, "ambiguous");
  assert.equal(
    partial.requests.filter((request) => request.kind === "initialize").length,
    0,
  );

  const foreign = new BootstrapPort(
    "absent",
    slot("acquired", "run-2/incarnation-1"),
  );
  const foreignResult =
    await adapter(foreign).createControllerAcquireIntent(initialAcquire());
  assert.equal(foreignResult.status, "ambiguous");
  assert.equal(
    foreign.requests.filter((request) => request.kind === "initialize").length,
    0,
  );
});

function transition() {
  return makeSlotTransitionIntent(
    "acquire",
    holder,
    scope,
    { head: "a".repeat(40), slot: slot() },
    slot("acquired"),
  );
}

class TransitionPort implements EmbeddedProcessPort {
  public readonly identity = identity();
  public readonly requests: EmbeddedRequest[] = [];

  public constructor(private readonly observed: MergeSlotObservation) {}

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    switch (request.kind) {
      case "state":
        return {
          kind: "state",
          value: {
            autoCommit: "off",
            head: "a".repeat(40),
            reachable: true,
            workingSet: "clean",
          },
        };
      case "slot":
        return { kind: "slot", value: this.observed };
      case "slot_transition":
        return { kind: "slot_transition", value: "observed" };
      default:
        throw new Error(`unexpected mutation ${request.kind}`);
    }
  }
}

test("controller transition reconciliation is read-only before/after act and blocks foreign slots", async () => {
  const intent = transition();
  const absent = new TransitionPort(slot());
  assert.deepEqual(
    await adapter(absent).reconcileControllerTransition(intent),
    { status: "absent" },
  );
  assert.deepEqual(
    absent.requests.map((request) => request.kind),
    ["state", "slot"],
  );

  const observed = new TransitionPort(slot("acquired"));
  assert.deepEqual(
    await adapter(observed).reconcileControllerTransition(intent),
    { status: "observed" },
  );
  assert.deepEqual(
    observed.requests.map((request) => request.kind),
    ["state", "slot", "slot_transition"],
  );

  const foreign = new TransitionPort(slot("acquired", "run-2/incarnation-1"));
  assert.deepEqual(
    await adapter(foreign).reconcileControllerTransition(intent),
    { status: "blocked" },
  );
  assert.deepEqual(
    foreign.requests.map((request) => request.kind),
    ["state", "slot"],
  );
});
