import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  __setDoltSqlTransactionTestHookForTests,
  BeadsServerAdapter,
  deriveServerIdentity,
  DoltBeadsServerDriver,
  DoltSqlTransport,
  PinnedBdServerProcess,
  type BeadsServerDriver,
  type DoltSqlTransactionTestPhase,
  type ServerCarryClaimDriverResponse,
  type ServerCarryReadback,
  type ServerDriverResponse,
  type ServerIdentity,
} from "../../../src/adapters/beads-server/index.js";
import {
  canonicalJson,
  type JsonValue,
} from "../../../src/protocol/canonical.js";
import {
  deriveGateEntryId,
  deriveClosedUnitEvidenceCommitment,
  deriveIntentCommitment,
  deriveParamsHash,
  deriveProvenanceWorktreePath,
  deriveTargetDefinitionCommitment,
  projectionInputIsValid,
  provenanceCarryLineageCommitment,
  unitClosureEvidenceCommitment,
  type ProtocolEffect,
} from "../../../src/protocol/reducer.js";
import { sha256 } from "../../../src/protocol/evidence.js";
import type {
  ClosureEvidence,
  ProvenanceInput,
  ProvenanceCarryClaimRecord,
  RepositoryRun,
} from "../../../src/protocol/schemas.js";
import {
  deriveScopeCommitment,
  makeRootProjection,
  type FencingScope,
  type MutationBatch,
  type RootProjection,
} from "../../../src/fencing/index.js";
import { run } from "../../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const currentRootBeadId = "sce-current-root";
const predecessorRootBeadId = "sce-predecessor-root";
const currentHolder = "run-2/incarnation-1";
const carriedUnitId = "unit-carried";
const integrationOid = "d".repeat(40);

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
    credentialReference: "writer-reference",
    schema: "sce",
    transportSecurity: "loopback_plaintext",
    workerCredentialReference: "worker-reference",
  });
  assert.ok(result);
  return result;
}

function currentRun(): RepositoryRun {
  const value = run([]);
  return {
    ...value,
    controller: {
      ...value.controller,
      holder: currentHolder,
      incarnationId: "incarnation-1",
      runId: "run-2",
    },
    wave: { id: "wave-current", unitIds: [] },
  };
}

function nonemptyProvenanceInput(): Readonly<{
  closure: ClosureEvidence;
  input: ProvenanceInput;
}> {
  const terminalIntent = {
    effectId: "unit-carried:integrate",
    idempotencyKey: "integrate-unit-carried",
    intentRevision: 1,
    kind: "integrate" as const,
    paramsHash: "8".repeat(64),
    schemaVersion: 1 as const,
    unitId: carriedUnitId,
  };
  const terminalEffect = {
    ...terminalIntent,
    intentCommitment: deriveIntentCommitment(terminalIntent),
    observationHash: "9".repeat(64),
    status: "observed" as const,
  };
  const closure = {
    baseOid: "a".repeat(40),
    candidate: {
      headOid: "b".repeat(40),
      treeOid: "c".repeat(40),
    },
    landedOid: integrationOid,
    outcome: "landed" as const,
    repairCount: 0,
    reservations: [],
    review: {
      baseOid: "a".repeat(40),
      headOid: "b".repeat(40),
      responseHash: "7".repeat(64),
      treeOid: "c".repeat(40),
    },
    terminalEffect,
    unitId: carriedUnitId,
    unitOrdinal: 0,
    verification: {
      baseOid: "a".repeat(40),
      commands: ["npm test"],
      evidenceHash: "6".repeat(64),
      headOid: "b".repeat(40),
      treeOid: "c".repeat(40),
    },
  } satisfies ClosureEvidence;
  const dense = {
    u: {
      [carriedUnitId]: [
        closure.outcome,
        closure.unitId,
        closure.unitOrdinal,
        closure.baseOid,
        closure.repairCount,
        null,
        null,
        null,
        null,
        [],
        [
          terminalEffect.effectId,
          terminalEffect.unitId,
          terminalEffect.idempotencyKey,
          terminalEffect.kind,
          terminalEffect.intentRevision,
          terminalEffect.intentCommitment,
          terminalEffect.paramsHash,
          terminalEffect.status,
          terminalEffect.observationHash,
          terminalEffect.schemaVersion,
        ],
        [
          closure.landedOid,
          [closure.candidate.headOid, closure.candidate.treeOid],
          [
            closure.verification.baseOid,
            closure.verification.headOid,
            closure.verification.treeOid,
            closure.verification.evidenceHash,
            closure.verification.commands,
          ],
          [
            closure.review.baseOid,
            closure.review.headOid,
            closure.review.treeOid,
            closure.review.responseHash,
          ],
        ],
      ],
    },
    v: 1,
  };
  const closedUnitEvidence = deflateRawSync(
    Buffer.from(canonicalJson(dense as unknown as JsonValue), "utf8"),
    { level: 9 },
  ).toString("base64");
  const input: ProvenanceInput = {
    closedUnitEvidence,
    closureEvidenceCommitment:
      deriveClosedUnitEvidenceCommitment(closedUnitEvidence),
    destinationProbeEvidence: [],
    targetEvidence: [],
    unitIds: [carriedUnitId],
  };
  assert.equal(projectionInputIsValid(input), true);
  return { closure, input };
}

function predecessorRun(): RepositoryRun {
  const value = run([]);
  const { closure, input: projectionInputSnapshot } = nonemptyProvenanceInput();
  return {
    ...value,
    closedUnitEvidence: projectionInputSnapshot.closedUnitEvidence,
    closedUnitEvidenceCommitment:
      projectionInputSnapshot.closureEvidenceCommitment,
    controller: { ...value.controller, state: "released" },
    gate: {
      aggregateVerifyPromise: {
        disposition: "deferral_cascade",
        followUpBeadId: "follow-up-1",
        status: "voided",
      },
      currentIntegrationOid: integrationOid,
      destinationProbes: [],
      lineageAncestorDigests: [],
      lineageCommitment: provenanceCarryLineageCommitment([]),
      originalUnitIds: [carriedUnitId],
      provenance: {
        attemptIdempotencyKey: `sce:${"e".repeat(64)}`,
        attemptedCommitOid: "b".repeat(40),
        attemptedTreeOid: "c".repeat(40),
        baseOid: integrationOid,
        disposition: "deferred_by_controller",
        followUpBeadId: "follow-up-1",
        gateEntryId: deriveGateEntryId(
          value.controller.runId,
          "wave-predecessor",
          "provenance",
          projectionInputSnapshot,
        ),
        lastRefusal: {
          code: "provenance_reproducibility_failed",
          detailHash: "d".repeat(64),
        },
        projectionInputSnapshot,
        status: "voided",
        worktreePath: deriveProvenanceWorktreePath(
          "/tmp/sce-provenance",
          `sce:${"e".repeat(64)}`,
        ),
      },
      provenanceUnitAccounting: [
        {
          closureEvidenceCommitment: unitClosureEvidenceCommitment(closure),
          status: "uncommitted",
          unitId: carriedUnitId,
        },
      ],
      targetPromises: [],
      targetDefinitionCommitment: deriveTargetDefinitionCommitment(
        "wave-predecessor",
        [carriedUnitId],
        [],
      ),
      targets: [],
      waveId: "wave-predecessor",
    },
    knowledgeContract: {
      aliases: [],
      audience: "knowledge-audience",
      combinedVerificationCommands: [["npm", "test"]],
      domainScope: "knowledge",
      gateTargets: [],
      humanDriver: "knowledge-owner",
      projectId: "knowledge-project",
      provenance: {
        eventsDirectory: "knowledge/events",
        generatedDirectory: "knowledge/generated",
        recordFormatVersion: 1,
        reproducibilityCommand: ["npm", "run", "reproduce"],
        rollupGeneratorCommand: ["npm", "run", "rollup"],
      },
      provenanceWorktreeRoot: "/tmp/sce-provenance",
    },
    state: "released",
    wave: { id: "wave-predecessor", unitIds: [] },
  };
}

function predecessorWithEmptyCarrySnapshot(): RepositoryRun {
  const value = predecessorRun();
  const gate = value.gate;
  const provenance = gate?.provenance;
  assert.ok(gate);
  assert.ok(provenance);
  const projectionInputSnapshot: ProvenanceInput = {
    closedUnitEvidence: "",
    closureEvidenceCommitment: "0".repeat(64),
    destinationProbeEvidence: [],
    targetEvidence: [],
    unitIds: [],
  };
  assert.equal(projectionInputIsValid(projectionInputSnapshot), true);
  const { currentIntegrationOid: _currentIntegrationOid, ...withoutHead } =
    gate;
  return {
    ...value,
    closedUnitEvidence: "",
    closedUnitEvidenceCommitment: "0".repeat(64),
    gate: {
      ...withoutHead,
      originalUnitIds: [],
      targetDefinitionCommitment: deriveTargetDefinitionCommitment(
        gate.waveId,
        [],
        [],
      ),
      provenance: {
        ...provenance,
        baseOid: "a".repeat(40),
        gateEntryId: deriveGateEntryId(
          value.controller.runId,
          gate.waveId,
          "provenance",
          projectionInputSnapshot,
        ),
        projectionInputSnapshot,
      },
      provenanceUnitAccounting: [],
    },
  };
}

function predecessorWithMalformedCarrySnapshot(): RepositoryRun {
  const value = predecessorRun();
  const gate = value.gate;
  const provenance = gate?.provenance;
  assert.ok(gate);
  assert.ok(provenance);
  const projectionInputSnapshot: ProvenanceInput = {
    ...provenance.projectionInputSnapshot,
    closureEvidenceCommitment: "0".repeat(64),
  };
  assert.equal(projectionInputIsValid(projectionInputSnapshot), false);
  return {
    ...value,
    gate: {
      ...gate,
      provenance: {
        ...provenance,
        gateEntryId: deriveGateEntryId(
          value.controller.runId,
          gate.waveId,
          "provenance",
          projectionInputSnapshot,
        ),
        projectionInputSnapshot,
      },
    },
  };
}

type CarryEffect = Extract<ProtocolEffect, { kind: "provenance_carry_claim" }>;

function effectFromPlan(
  plan: Awaited<ReturnType<BeadsServerAdapter["prepareProvenanceCarryClaim"]>>,
): CarryEffect {
  assert.equal(plan.status, "planned");
  if (plan.status !== "planned") throw new Error("carry plan unavailable");
  const claimToken = `carry-claim:${sha256(
    canonicalJson({
      currentRunId: "run-2",
      domain: "sce.provenance-carry-claim-key.v1",
      exportId: plan.plan.exportId,
      predecessorRootBeadId,
    }),
  )}`;
  const params = {
    claimToken,
    currentRunId: "run-2",
    exportId: plan.plan.exportId,
    integrationBranch: "main",
    predecessorFinalRevision: plan.plan.predecessorFinalRevision,
    predecessorJournalCheckpointCommitment:
      plan.plan.predecessorJournalCheckpointCommitment,
    predecessorRootBeadId,
    predecessorRootAggregateCommitment:
      plan.plan.predecessorRootAggregateCommitment,
    predecessorRunId: plan.plan.predecessorRunId,
    predecessorWaveId: plan.plan.predecessorWaveId,
    repositoryIdentity: "repo-1",
    snapshotCommitment: plan.plan.snapshotCommitment,
    storeIdentity: "store-1",
  };
  return {
    effectId: "claim-event:provenance_carry_claim",
    idempotencyKey: claimToken,
    kind: "provenance_carry_claim",
    params,
    paramsHash: deriveParamsHash("provenance_carry_claim", params),
    schemaVersion: 1,
    unitId: null,
  };
}

class CarryServer implements BeadsServerDriver {
  readonly serverIdentity = identity();
  predecessor: RootProjection = makeRootProjection(predecessorRun());
  claimsPresent = false;
  claimsText: string | undefined;
  sibling: JsonValue = { untouched: true };
  claimCalls = 0;
  readCalls = 0;
  readMode: "ok" | "not_found" | "ambiguous" | "unavailable" = "ok";
  claimMode:
    | "winner"
    | "loser"
    | "slot_loss"
    | "stale_predecessor"
    | "readback_ambiguous" = "winner";

  disarm(): void {}

  async probe() {
    return {
      status: "ok" as const,
      value: {
        autoCommitPolicy: "on" as const,
        credentialReference: this.serverIdentity.credentialReference,
        database: this.serverIdentity.database,
        endpoint: this.serverIdentity.endpoint,
        schema: this.serverIdentity.schema,
        workerGrant: {
          credentialReference: this.serverIdentity.workerCredentialReference,
          serverEnforced: true,
          writeDenied: true,
        },
      },
    };
  }

  async readProvenanceCarry(): Promise<
    ServerDriverResponse<ServerCarryReadback>
  > {
    this.readCalls += 1;
    if (this.readMode === "not_found")
      return {
        status: "ok",
        value: { currentRootBeadId, status: "not_found" },
      };
    if (this.readMode !== "ok") return { status: this.readMode };
    return {
      status: "ok",
      value: {
        claimsPresent: this.claimsPresent,
        ...(this.claimsText === undefined
          ? {}
          : { claimsText: this.claimsText }),
        currentRootBeadId,
        rootText: canonicalJson(this.predecessor as unknown as JsonValue),
        status: "observed",
      },
    };
  }

  async claimProvenanceCarry(input: {
    expectedRoot: RootProjection;
    exportDigest: string;
    holder: string;
    identity: ServerIdentity;
    predecessorRootBeadId: string;
    record: ProvenanceCarryClaimRecord;
    scope: FencingScope;
  }): Promise<ServerCarryClaimDriverResponse> {
    this.claimCalls += 1;
    if (this.claimMode === "slot_loss")
      return { status: "ok", value: { status: "stale" } };
    if (this.claimMode === "stale_predecessor") {
      const changed = {
        ...this.predecessor.run,
        revision: this.predecessor.run.revision + 1,
      };
      this.predecessor = makeRootProjection(changed);
      return { status: "ok", value: { status: "stale" } };
    }
    if (
      input.holder !== currentHolder ||
      input.predecessorRootBeadId !== predecessorRootBeadId ||
      input.expectedRoot.aggregateCommitment !==
        this.predecessor.aggregateCommitment ||
      canonicalJson(input.scope as JsonValue) !==
        canonicalJson(scope as JsonValue)
    )
      return { status: "ok", value: { status: "stale" } };
    const record =
      this.claimMode === "loser"
        ? {
            ...input.record,
            claimantRunId: "run-competitor",
            claimToken: `carry-claim:${sha256(
              canonicalJson({
                currentRunId: "run-competitor",
                domain: "sce.provenance-carry-claim-key.v1",
                exportId: input.record.exportId,
                predecessorRootBeadId,
              }),
            )}`,
          }
        : input.record;
    this.claimsPresent = true;
    this.claimsText = canonicalJson({
      [input.exportDigest]: record,
    } as unknown as JsonValue);
    if (this.claimMode === "readback_ambiguous") this.readMode = "ambiguous";
    return this.claimMode === "loser"
      ? { status: "ok", value: { status: "stale" } }
      : {
          status: "ok",
          value: {
            readback: {
              claimsPresent: true,
              claimsText: this.claimsText,
              currentRootBeadId,
              rootText: canonicalJson(this.predecessor as unknown as JsonValue),
              status: "observed",
            },
            status: "applied",
          },
        };
  }

  async mergeSlotAcquire() {
    return { status: "refused" as const };
  }
  async mergeSlotCheck() {
    return { status: "refused" as const };
  }
  async mergeSlotRelease() {
    return { status: "refused" as const };
  }
  async mutate(_input: { batch: MutationBatch; identity: ServerIdentity }) {
    return {
      phase: "before_transaction" as const,
      status: "refused" as const,
    };
  }
  async discover() {
    return { status: "refused" as const };
  }
}

async function fixture() {
  const driver = new CarryServer();
  const adapter = new BeadsServerAdapter({
    driver,
    identity: driver.serverIdentity,
    process: {
      start: async () => ({ status: "ok" as const, value: undefined }),
    },
    recoveryScope: scope,
  });
  assert.equal((await adapter.preflight()).status, "ready");
  const run = currentRun();
  const plan = await adapter.prepareProvenanceCarryClaim(
    predecessorRootBeadId,
    run,
  );
  return { adapter, driver, effect: effectFromPlan(plan), run };
}

test("server carry winner preserves projection and siblings and same token is idempotent", async () => {
  for (const initial of [undefined, canonicalJson({})]) {
    const { adapter, driver, effect, run } = await fixture();
    driver.claimsPresent = initial !== undefined;
    driver.claimsText = initial;
    const beforeRoot = canonicalJson(
      driver.predecessor as unknown as JsonValue,
    );
    const beforeSibling = canonicalJson(driver.sibling);
    const winner = await adapter.executeProvenanceCarryClaim(effect, run);
    assert.equal(winner.status, "observed");
    if (winner.status === "observed")
      assert.equal(winner.result.status, "imported");
    assert.equal(driver.claimCalls, 1);
    assert.equal(
      canonicalJson(driver.predecessor as unknown as JsonValue),
      beforeRoot,
    );
    assert.equal(canonicalJson(driver.sibling), beforeSibling);
    const sameToken = await adapter.executeProvenanceCarryClaim(effect, run);
    assert.equal(sameToken.status, "observed");
    if (sameToken.status === "observed")
      assert.equal(sameToken.result.status, "imported");
    assert.equal(driver.claimCalls, 1);
  }
});

test("server carry race loser returns the strict existing claimant", async () => {
  const { adapter, driver, effect, run } = await fixture();
  driver.claimMode = "loser";
  const result = await adapter.executeProvenanceCarryClaim(effect, run);
  assert.equal(result.status, "observed");
  if (result.status === "observed") {
    assert.equal(result.result.status, "already_claimed");
    if (result.result.status === "already_claimed")
      assert.equal(result.result.claimantRunId, "run-competitor");
  }
  assert.equal(driver.claimCalls, 1);
});

test("server carry invalid claim boundaries refuse before mutation", async () => {
  const cases = [
    "[]",
    canonicalJson({ a: {}, b: {} }),
    canonicalJson({
      ["b".repeat(64)]: {
        claimRevision: 1,
        claimantRunId: "other-run",
        claimToken: "other-token",
        exportId: `sce:carry:${"b".repeat(64)}`,
        predecessorRootBeadId,
        predecessorRunId: "run-1",
        predecessorWaveId: "wave-predecessor",
        schema: "sce.provenance-carry-claim",
        snapshotCommitment: "c".repeat(64),
        version: 1,
      },
    }),
    canonicalJson({
      ["b".repeat(64)]: {
        extra: true,
        schema: "sce.provenance-carry-claim",
      },
    }),
    canonicalJson({ oversized: "x".repeat(8_192) }),
    `{ ${JSON.stringify("b".repeat(64))}: {} }`,
  ];
  for (const claimsText of cases) {
    const { adapter, driver, effect, run } = await fixture();
    driver.claimsPresent = true;
    driver.claimsText = claimsText;
    const result = await adapter.reconcileProvenanceCarryClaim(effect, run);
    assert.equal(result.status, "observed");
    if (result.status === "observed") {
      assert.equal(result.result.status, "predecessor_refused");
      if (result.result.status === "predecessor_refused")
        assert.equal(result.result.reason, "projection_invalid");
    }
    assert.equal(driver.claimCalls, 0);
  }
});

test("server carry refuses empty or malformed provenance before claim driver", async () => {
  for (const candidate of [
    {
      predecessor: predecessorWithEmptyCarrySnapshot(),
      reason: "snapshot_invalid" as const,
    },
    {
      predecessor: predecessorWithMalformedCarrySnapshot(),
      reason: "projection_invalid" as const,
    },
  ]) {
    const value = await fixture();
    value.driver.predecessor = makeRootProjection(candidate.predecessor);
    const result = await value.adapter.executeProvenanceCarryClaim(
      value.effect,
      value.run,
    );
    assert.equal(result.status, "observed");
    if (result.status === "observed") {
      assert.equal(result.result.status, "predecessor_refused");
      if (result.result.status === "predecessor_refused")
        assert.equal(result.result.reason, candidate.reason);
    }
    assert.equal(value.driver.claimCalls, 0);
  }
});

test("server carry slot loss, stale predecessor, and readback uncertainty stay ambiguous", async () => {
  for (const mode of [
    "slot_loss",
    "stale_predecessor",
    "readback_ambiguous",
  ] as const) {
    const { adapter, driver, effect, run } = await fixture();
    driver.claimMode = mode;
    const result = await adapter.executeProvenanceCarryClaim(effect, run);
    assert.equal(result.status, "ambiguous", mode);
    assert.equal(driver.claimCalls, 1, mode);
  }
});

test("server carry missing predecessor is a durable refusal without a write", async () => {
  const { adapter, driver, effect, run } = await fixture();
  driver.readMode = "not_found";
  const result = await adapter.reconcileProvenanceCarryClaim(effect, run);
  assert.equal(result.status, "observed");
  if (result.status === "observed") {
    assert.equal(result.result.status, "predecessor_refused");
    if (result.result.status === "predecessor_refused")
      assert.equal(result.result.reason, "not_found");
  }
  assert.equal(driver.claimCalls, 0);
});

test("concrete direct-root carry boundaries reject malformed input before SQL", async () => {
  const serverIdentity = identity();
  let processCalls = 0;
  const writer = new DoltSqlTransport({
    identity: serverIdentity,
    process: async () => {
      processCalls += 1;
      throw new Error("SQL must remain unreachable");
    },
    user: "writer",
  });
  const driver = new DoltBeadsServerDriver({
    identity: serverIdentity,
    rows: { childBeadIds: {}, rootBeadId: currentRootBeadId },
    writer,
  });
  assert.deepEqual(await driver.readProvenanceCarry(null as never), {
    status: "refused",
  });
  assert.deepEqual(await driver.claimProvenanceCarry({} as never), {
    phase: "before_transaction",
    status: "refused",
  });
  assert.equal(processCalls, 0);
});

type ConcreteCarry = Awaited<ReturnType<typeof concreteCarryDriver>>;

async function concreteCarryDriver(
  transactionRows: 0 | 1,
  testContext: TestContext,
) {
  const directory = await mkdtemp("/private/tmp/sce-server-carry-");
  testContext.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const executable = join(directory, "dolt");
  const transcript = join(directory, "transcript.txt");
  const state = join(directory, "claim-state");
  const serverIdentity = identity();
  const predecessor = makeRootProjection(predecessorRun());
  const current = currentRun();
  const planned = planFor(predecessor, current);
  const effect = effectFromPlan({ status: "planned", plan: planned });
  const exportDigest = effect.params.exportId.slice("sce:carry:".length);
  const record: ProvenanceCarryClaimRecord = {
    claimRevision: 1,
    claimantRunId: effect.params.currentRunId,
    claimToken: effect.params.claimToken,
    exportId: effect.params.exportId,
    predecessorRootBeadId,
    predecessorRunId: effect.params.predecessorRunId,
    predecessorWaveId: effect.params.predecessorWaveId,
    schema: "sce.provenance-carry-claim",
    snapshotCommitment: effect.params.snapshotCommitment,
    version: 1,
  };
  const competitor: ProvenanceCarryClaimRecord = {
    ...record,
    claimantRunId: "run-competitor",
    claimToken: `carry-claim:${sha256(
      canonicalJson({
        currentRunId: "run-competitor",
        domain: "sce.provenance-carry-claim-key.v1",
        exportId: effect.params.exportId,
        predecessorRootBeadId,
      }),
    )}`,
  };
  const singletonText = canonicalJson({ [exportDigest]: record });
  const competitorText = canonicalJson({ [exportDigest]: competitor });
  const rootText = canonicalJson(predecessor as unknown as JsonValue);
  const readback = {
    claims_text: singletonText,
    claims_type: "OBJECT",
    predecessor_id: predecessorRootBeadId,
    root_text: rootText,
    slot_design: canonicalJson(scope as unknown as JsonValue),
    slot_external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
    slot_id: "sce-merge-slot",
    slot_metadata: canonicalJson({ holder: currentHolder }),
    slot_status: "in_progress",
    slot_title: "Merge Slot",
  };
  const issueColumns = [
    ["id", "varchar"],
    ["status", "varchar"],
    ["metadata", "json"],
    ["external_ref", "varchar"],
    ["title", "varchar"],
    ["design", "longtext"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const labelColumns = [
    ["issue_id", "varchar"],
    ["label", "varchar"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const scriptConfig = {
    competitorText,
    issueColumns,
    labelColumns,
    readback,
    rootText,
    state,
    transcript,
    transactionRows,
  };
  await writeFile(
    executable,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const readline = require("node:readline");',
      `const c = ${JSON.stringify(scriptConfig)};`,
      'const out = (rows) => process.stdout.write(JSON.stringify(rows) + "\\n");',
      'if (process.argv[2] === "version") { console.log("dolt version 2.2.1"); process.exit(0); }',
      "const at = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
      'const query = process.argv.includes("-q") ? at("-q") : undefined;',
      'const user = at("--user");',
      "if (query !== undefined) {",
      "  fs.appendFileSync(c.transcript, `Q ${query}\\n`);",
      '  if (query === "SELECT DATABASE() AS current_database") out([{current_database:"sce"}]);',
      '  else if (query === "SELECT DOLT_VERSION() AS dolt_version") out([{dolt_version:"2.2.1"}]);',
      '  else if (query.includes("information_schema.tables")) out([{table_name:query.includes("labels")?"labels":"issues"}]);',
      '  else if (query.includes("information_schema.columns")) out(query.includes("labels")?c.labelColumns:c.issueColumns);',
      '  else if (query === "SELECT @@autocommit AS auto_commit") out([{auto_commit:"1"}]);',
      '  else if (query.includes("dolt_transaction_commit AS dolt_transaction_commit")) out([{dolt_transaction_commit:"1"}]);',
      '  else if (query === "SELECT * FROM dolt_status") out([]);',
      '  else if (query === "SELECT DOLT_HASHOF(\'HEAD\') AS head") out([{head:"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]);',
      '  else if (query.includes("issues LIMIT 1")) out([]);',
      '  else if (query === "SELECT CURRENT_USER() AS current_principal") out([{current_principal:`${user}@%`}]);',
      '  else if (query === "SHOW GRANTS FOR \'worker\'@\'%\'") out([{"Grants for worker@%":"GRANT USAGE ON *.* TO `worker`@`%`"},{"Grants for worker@%":"GRANT SELECT ON `sce`.* TO `worker`@`%`"}]);',
      "  else if (query.includes(\"SET status = status WHERE 1 = 0\")) { console.error(`error on line 1 for query ${query}: Error 1105 (HY000): command denied to user 'worker'@'%'`); process.exit(1); }",
      '  else if (query.includes("sce_carry_claims")) out([{id:"sce-predecessor-root",root_text:c.rootText,...(fs.existsSync(c.state)?{claims_text:c.competitorText,claims_type:"OBJECT"}:{claims_type:null})}]);',
      "  else process.exit(1);",
      "  process.exit(0);",
      "}",
      "const lines = readline.createInterface({input:process.stdin, crlfDelay:Infinity});",
      'lines.on("line", (line) => {',
      "  fs.appendFileSync(c.transcript, `TX ${line}\\n`);",
      '  if (line.includes("START TRANSACTION")) { if (c.transactionRows === 0) fs.writeFileSync(c.state, "competitor"); out([{affected_rows:c.transactionRows}]); }',
      '  else if (line.includes("FOR UPDATE")) out([c.readback]);',
      '  else if (line.includes("DOLT_HASHOF")) { out([{committed_head:"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]); out([{working_set_rows:0}]); }',
      "});",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  const slotProcess = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    identity: serverIdentity,
    process: async (request) => {
      if (request.argv[0] === "version")
        return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
      if (request.argv.includes("context"))
        return {
          exitCode: 0,
          output: JSON.stringify({
            backend: "dolt",
            beads_dir: `${directory}/.beads`,
            database: "sce",
            dolt_mode: "server",
            server_host: "127.0.0.1",
            server_port: 3306,
          }),
          timedOut: false,
        };
      throw new Error("unexpected pinned bd request");
    },
    runtimeEnvironment: () => ({
      HOME: `${directory}/home`,
      XDG_CONFIG_HOME: `${directory}/config`,
    }),
    workspace: directory,
  });
  const writer = new DoltSqlTransport({
    executable,
    identity: serverIdentity,
    password: "writer-password",
    user: "writer",
  });
  const worker = new DoltSqlTransport({
    executable,
    identity: serverIdentity,
    password: "worker-password",
    user: "worker",
  });
  const driver = new DoltBeadsServerDriver({
    identity: serverIdentity,
    rows: { childBeadIds: {}, rootBeadId: currentRootBeadId },
    slotProcess,
    worker,
    writer,
  });
  assert.equal((await driver.probe(serverIdentity)).status, "ok");
  return {
    driver,
    effect,
    input: {
      expectedRoot: predecessor,
      exportDigest,
      holder: currentHolder,
      identity: serverIdentity,
      predecessorRootBeadId,
      record,
      scope,
    },
    transcript,
  };
}

function planFor(predecessor: RootProjection, current: RepositoryRun) {
  const snapshot = predecessor.run.gate?.provenance?.projectionInputSnapshot;
  assert.ok(snapshot);
  const snapshotCommitment = sha256(
    canonicalJson({
      domain: "sce.provenance-carry-snapshot.v1",
      projectionInputSnapshot: snapshot,
    }),
  );
  const exportId = `sce:carry:${sha256(
    canonicalJson({
      domain: "sce.provenance-carry-export.v1",
      integrationBranch: predecessor.run.integrationBranch,
      predecessorFinalRevision: predecessor.run.revision,
      predecessorRootAggregateCommitment: predecessor.aggregateCommitment,
      predecessorRunId: predecessor.run.controller.runId,
      predecessorWaveId: predecessor.run.gate!.waveId,
      repositoryIdentity: predecessor.run.repositoryIdentity,
      snapshotCommitment,
      storeIdentity: predecessor.run.storeIdentity,
    }),
  )}`;
  assert.equal(current.controller.runId, "run-2");
  return {
    exportId,
    predecessorFinalRevision: predecessor.run.revision,
    predecessorJournalCheckpointCommitment:
      predecessor.run.journalCheckpoint.commitment,
    predecessorRootAggregateCommitment: predecessor.aggregateCommitment,
    predecessorRunId: predecessor.run.controller.runId,
    predecessorWaveId: predecessor.run.gate!.waveId,
    snapshotCommitment,
  };
}

async function transcript(value: ConcreteCarry): Promise<string> {
  return await readFile(value.transcript, "utf8");
}

test("concrete server carry transaction binds slot, label, singleton, readback, and commit", async (t) => {
  const value = await concreteCarryDriver(1, t);
  const result = await value.driver.claimProvenanceCarry(value.input);
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.value.status, "applied");
  const trace = await transcript(value);
  assert.match(
    trace,
    /TX SET @@SESSION\.dolt_transaction_commit = 1; START TRANSACTION; UPDATE `sce`\.issues/u,
  );
  assert.match(
    trace,
    /ROW_COUNT\(\); SELECT @sce_affected_rows AS affected_rows/u,
  );
  assert.match(trace, /sce_carry_claims/u);
  assert.match(
    trace,
    /JSON_LENGTH\(JSON_EXTRACT\(metadata, '\$\.sce_carry_claims'\)\) = 0/u,
  );
  assert.match(trace, /COUNT\(\*\) FROM `sce`\.labels/u);
  assert.match(
    trace,
    /TX SELECT predecessor\.id AS predecessor_id.*FOR UPDATE;/u,
  );
  assert.match(trace, /TX COMMIT;/u);
  assert.match(trace, /TX SELECT DOLT_HASHOF\('HEAD'\) AS committed_head/u);
  assert.ok(trace.indexOf("START TRANSACTION") < trace.indexOf("FOR UPDATE"));
  assert.ok(trace.indexOf("FOR UPDATE") < trace.indexOf("TX COMMIT;"));
});

test("concrete server zero-row claim rolls back and the existing singleton is reread", async (t) => {
  const value = await concreteCarryDriver(0, t);
  const result = await value.driver.claimProvenanceCarry(value.input);
  assert.deepEqual(result, { status: "ok", value: { status: "stale" } });
  const traceAfterClaim = await transcript(value);
  assert.match(traceAfterClaim, /TX ROLLBACK;/u);
  assert.equal(traceAfterClaim.includes("TX COMMIT;"), false);
  const reread = await value.driver.readProvenanceCarry({
    identity: value.input.identity,
    predecessorRootBeadId,
  });
  assert.equal(reread.status, "ok");
  if (reread.status === "ok" && reread.value.status === "observed") {
    assert.equal(reread.value.claimsPresent, true);
    assert.match(reread.value.claimsText ?? "", /run-competitor/u);
  }
  assert.ok((await transcript(value)).includes("Q SELECT id"));
});

test("concrete server transaction faults never become applied", async (t) => {
  for (const phase of [
    "after_guarded_write_before_rowcount",
    "after_rowcount_before_commit",
    "after_commit_before_outcome",
    "after_commit_marker_before_close",
  ] as const satisfies readonly DoltSqlTransactionTestPhase[]) {
    const value = await concreteCarryDriver(1, t);
    let observed = 0;
    const clear = __setDoltSqlTransactionTestHookForTests((fault) => {
      if (fault.phase !== phase) return;
      observed += 1;
      fault.abort();
    });
    try {
      const result = await value.driver.claimProvenanceCarry(value.input);
      assert.notEqual(result.status, "ok", phase);
      assert.equal(observed, 1, phase);
    } finally {
      clear();
    }
  }
});
