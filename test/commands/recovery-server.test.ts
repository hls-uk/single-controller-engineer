import assert from "node:assert/strict";
import test from "node:test";

import {
  BeadsServerAdapter,
  deriveServerIdentity,
  makeServerSlotTransitionIntent,
  slotScopeReference,
  type BeadsServerDriver,
  type ServerIdentity,
  type ServerSlotReadback,
} from "../../src/adapters/beads-server/index.js";
import {
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  type FencingScope,
  type MergeSlotObservation,
} from "../../src/fencing/index.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";

function identity(): ServerIdentity {
  const result = deriveServerIdentity({
    autoCommitPolicy: "on",
    beads: {
      beadsDir: "/repo/.beads",
      contextSchemaVersion: 1,
      database: "sce",
      mode: "managed_local_shared_server",
      prefix: "sce",
      provenance: "shared_server_flag",
      server: "127.0.0.1:3306",
      toolVersion: "1.1.0",
    },
    credentialProvenance: "managed_local_runtime",
    credentialReference: "managed-writer-v1",
    schema: "beads",
    transportSecurity: "loopback_plaintext",
    workerCredentialReference: "managed-worker-ro-v1",
  });
  assert.ok(result);
  return result;
}

function slot(
  status: "available" | "acquired",
  slotHolder?: string,
): MergeSlotObservation {
  const withoutHash = {
    actor: slotHolder ?? holder,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: "gt:slot" as const,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...withoutHash, readbackHash: deriveSlotReadbackHash(withoutHash) };
}

function readback(observation: MergeSlotObservation): ServerSlotReadback {
  return { observation, scopeReference: slotScopeReference(scope) };
}

function fakeDriver(initial: MergeSlotObservation) {
  let current = initial;
  const calls = { acquire: 0, check: 0, release: 0 };
  const expectedIdentity = identity();
  const driver: BeadsServerDriver = {
    disarm() {},
    async discover() {
      return { status: "refused" };
    },
    async mergeSlotAcquire() {
      calls.acquire += 1;
      current = slot("acquired", holder);
      return { status: "ok", value: readback(current) };
    },
    async mergeSlotCheck() {
      calls.check += 1;
      return { status: "ok", value: readback(current) };
    },
    async mergeSlotRelease() {
      calls.release += 1;
      current = slot("available");
      return { status: "ok", value: readback(current) };
    },
    async mutate() {
      return { phase: "before_transaction", status: "refused" };
    },
    async probe() {
      return {
        status: "ok",
        value: {
          autoCommitPolicy: expectedIdentity.autoCommitPolicy,
          credentialReference: expectedIdentity.credentialReference,
          database: expectedIdentity.database,
          endpoint: expectedIdentity.endpoint,
          schema: expectedIdentity.schema,
          workerGrant: {
            credentialReference: expectedIdentity.workerCredentialReference,
            serverEnforced: true,
            writeDenied: true,
          },
        },
      };
    },
  };
  return {
    calls,
    driver,
    setCurrent(value: MergeSlotObservation) {
      current = value;
    },
  };
}

async function readyAdapter(driver: BeadsServerDriver) {
  const adapter = new BeadsServerAdapter({
    driver,
    identity: identity(),
    process: {
      async start() {
        return { status: "ok", value: undefined };
      },
    },
    recoveryScope: scope,
  });
  assert.equal((await adapter.preflight()).status, "ready");
  return adapter;
}

test("shared-server recovery reconciles read-only and executes each exact transition once", async () => {
  const beforeAcquire = slot("available");
  const afterAcquire = slot("acquired", holder);
  const fake = fakeDriver(beforeAcquire);
  const adapter = await readyAdapter(fake.driver);
  const plannedAcquire = await adapter.prepareControllerTransition({
    holder,
    kind: "acquire",
    scope,
  });
  assert.equal(plannedAcquire.status, "planned");
  if (plannedAcquire.status !== "planned") throw new Error("unreachable");
  const acquire = plannedAcquire.transition;

  assert.deepEqual(await adapter.reconcileControllerTransition(acquire), {
    status: "absent",
  });
  assert.deepEqual(fake.calls, { acquire: 0, check: 2, release: 0 });
  assert.deepEqual(await adapter.executeControllerTransition(acquire), {
    status: "observed",
  });
  assert.deepEqual(fake.calls, { acquire: 1, check: 2, release: 0 });
  assert.deepEqual(await adapter.reconcileControllerTransition(acquire), {
    status: "observed",
  });
  assert.deepEqual(fake.calls, { acquire: 1, check: 3, release: 0 });

  const afterRelease = slot("available");
  const plannedRelease = await adapter.prepareControllerTransition({
    holder,
    kind: "release",
    scope,
  });
  assert.equal(plannedRelease.status, "planned");
  if (plannedRelease.status !== "planned") throw new Error("unreachable");
  const release = plannedRelease.transition;
  assert.deepEqual(release.before, afterAcquire);
  assert.deepEqual(release.after, afterRelease);
  assert.deepEqual(await adapter.reconcileControllerTransition(release), {
    status: "absent",
  });
  assert.deepEqual(await adapter.executeControllerTransition(release), {
    status: "observed",
  });
  assert.deepEqual(fake.calls, { acquire: 1, check: 5, release: 1 });
});

test("shared-server recovery rejects changed or forged transition authority without mutation", async () => {
  const before = slot("available");
  const after = slot("acquired", holder);
  const transition = makeServerSlotTransitionIntent({
    after,
    before,
    holder,
    kind: "acquire",
    scope,
  });
  assert.ok(transition);
  const fake = fakeDriver(slot("acquired", "foreign-run/incarnation-2"));
  const adapter = await readyAdapter(fake.driver);

  assert.deepEqual(await adapter.reconcileControllerTransition(transition), {
    status: "blocked",
  });
  assert.deepEqual(fake.calls, { acquire: 0, check: 1, release: 0 });

  const forged = { ...transition, idempotencyKey: "0".repeat(64) };
  assert.deepEqual(await adapter.executeControllerTransition(forged), {
    status: "ambiguous",
  });
  assert.deepEqual(fake.calls, { acquire: 0, check: 1, release: 0 });
});
