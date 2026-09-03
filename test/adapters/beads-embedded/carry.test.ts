import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  type CarryCheckpointIntent,
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
  type FencingScope,
  type MergeSlotObservation,
  type RootProjection,
} from "../../../src/fencing/index.js";
import type { PreflightEnvelope } from "../../../src/preflight/index.js";
import {
  canonicalJson,
  type JsonValue,
} from "../../../src/protocol/canonical.js";
import { sha256 } from "../../../src/protocol/evidence.js";
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
import type {
  ClosureEvidence,
  ProvenanceInput,
  ProvenanceCarryClaimRecord,
  RepositoryRun,
} from "../../../src/protocol/schemas.js";
import { run } from "../../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-2/incarnation-1";
const currentRootBeadId = "sce-current-root";
const predecessorRootBeadId = "sce-predecessor-root";
const baseHead = "a".repeat(32);
const committedHead = "b".repeat(32);
const carriedUnitId = "unit-carried";
const integrationOid = "d".repeat(40);

type ReadyPreflight = Omit<PreflightEnvelope, "payload"> & {
  readonly payload: Extract<PreflightEnvelope["payload"], { status: "ready" }>;
};
type CarryEffect = Extract<ProtocolEffect, { kind: "provenance_carry_claim" }>;

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
          ? {
              syncRef: "refs/dolt/data",
              syncRemote: "github.test/org/repo",
            }
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

function acquiredSlot(): MergeSlotObservation {
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

function currentRun(): RepositoryRun {
  const value = run([]);
  return {
    ...value,
    controller: {
      ...value.controller,
      holder,
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

function claimToken(exportId: string, claimantRunId: string): string {
  return `carry-claim:${sha256(
    canonicalJson({
      currentRunId: claimantRunId,
      domain: "sce.provenance-carry-claim-key.v1",
      exportId,
      predecessorRootBeadId,
    }),
  )}`;
}

function effectFromPlan(
  plan: Awaited<
    ReturnType<EmbeddedBeadsAdapter["prepareProvenanceCarryClaim"]>
  >,
): CarryEffect {
  assert.equal(plan.status, "planned", JSON.stringify(plan));
  if (plan.status !== "planned") throw new Error("carry plan unavailable");
  const token = claimToken(plan.plan.exportId, "run-2");
  const params = {
    claimToken: token,
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
    effectId: "carry-event:provenance_carry_claim",
    idempotencyKey: token,
    kind: "provenance_carry_claim",
    params,
    paramsHash: deriveParamsHash("provenance_carry_claim", params),
    schemaVersion: 1,
    unitId: null,
  };
}

function recordFor(
  effect: CarryEffect,
  claimantRunId = effect.params.currentRunId,
): ProvenanceCarryClaimRecord {
  return {
    claimRevision: 1,
    claimantRunId,
    claimToken: claimToken(effect.params.exportId, claimantRunId),
    exportId: effect.params.exportId,
    predecessorRootBeadId,
    predecessorRunId: effect.params.predecessorRunId,
    predecessorWaveId: effect.params.predecessorWaveId,
    schema: "sce.provenance-carry-claim",
    snapshotCommitment: effect.params.snapshotCommitment,
    version: 1,
  };
}

function effectWithParams(
  effect: CarryEffect,
  fields: Partial<CarryEffect["params"]>,
): CarryEffect {
  const initial = { ...effect.params, ...fields };
  const currentRunId = initial.currentRunId;
  const token =
    fields.currentRunId === undefined
      ? initial.claimToken
      : claimToken(initial.exportId, currentRunId);
  const params = { ...initial, claimToken: token };
  return {
    ...effect,
    idempotencyKey: token,
    params,
    paramsHash: deriveParamsHash("provenance_carry_claim", params),
  };
}

class CarryPort implements EmbeddedProcessPort {
  readonly requests: EmbeddedRequest[] = [];
  readonly identity: EmbeddedProcessIdentity;
  claims: unknown = {};
  predecessor: RootProjection = makeRootProjection(predecessorRun());
  claimResult: "applied" | "stale" | "unavailable" = "applied";
  staleClaims: unknown;
  commitResult: "applied" | "ambiguous" | "unavailable" = "applied";
  pushResult: "applied" | "conflict" | "ambiguous" | "unavailable" = "applied";
  ambiguousDiscoveryPoint:
    "before_commit" | "after_commit" | "before_push" | "after_push" | undefined;
  #head = baseHead;
  #remoteHead: string | undefined;
  #workingSet: EmbeddedState["workingSet"] = "clean";

  constructor(readonly sync = false) {
    this.identity = processIdentity(sync);
    this.#remoteHead = sync ? baseHead : undefined;
  }

  setCheckpoint(
    workingSet: EmbeddedState["workingSet"],
    head: string,
    remoteHead?: string,
  ): void {
    this.#workingSet = workingSet;
    this.#head = head;
    this.#remoteHead = remoteHead;
  }

  async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    this.requests.push(request);
    switch (request.kind) {
      case "carry_read":
        return {
          kind: "carry_read",
          value: {
            claims: this.claims,
            root: this.predecessor,
            status: "observed",
          },
        };
      case "state":
        return {
          kind: "state",
          value: {
            autoCommit: "off",
            head: this.#head,
            reachable: true,
            ...(this.#remoteHead === undefined
              ? {}
              : { remoteHead: this.#remoteHead }),
            workingSet: this.#workingSet,
          },
        };
      case "slot":
        return { kind: "slot", value: acquiredSlot() };
      case "carry_claim":
        if (this.claimResult !== "applied") {
          if (this.claimResult === "stale" && this.staleClaims !== undefined) {
            this.claims = this.staleClaims;
            this.#head = committedHead;
            this.#workingSet = "clean";
            if (this.sync) this.#remoteHead = committedHead;
          }
          return {
            kind: "carry_claim",
            value: { status: this.claimResult },
          };
        }
        this.claims = { [request.exportDigest]: request.record };
        this.#workingSet = "pending";
        return { kind: "carry_claim", value: { status: "applied" } };
      case "carry_discover":
        if (this.ambiguousDiscoveryPoint === request.point)
          return {
            kind: "carry_discover",
            value: { status: "ambiguous" },
          };
        return {
          kind: "carry_discover",
          value: {
            baseHead,
            head: this.#head,
            ...(this.#remoteHead === undefined
              ? {}
              : { remoteHead: this.#remoteHead }),
            rootCommitment: this.predecessor.aggregateCommitment,
            status: "observed",
          },
        };
      case "commit":
        if (this.commitResult === "applied") {
          this.#head = committedHead;
          this.#workingSet = "clean";
        }
        return { kind: "commit", value: this.commitResult };
      case "push":
        if (this.pushResult === "applied") this.#remoteHead = this.#head;
        return { kind: "push", value: this.pushResult };
      default:
        throw new Error(`unexpected embedded carry request ${request.kind}`);
    }
  }
}

async function fixture(sync = false) {
  const port = new CarryPort(sync);
  const adapter = new EmbeddedBeadsAdapter({
    holder,
    mode: sync ? "git-sync" : "local-only",
    prefix: "sce",
    preflight: preflight(sync),
    process: port,
    rootIssueId: currentRootBeadId,
    scope,
  });
  const current = currentRun();
  const plan = await adapter.prepareProvenanceCarryClaim(
    predecessorRootBeadId,
    current,
  );
  return { adapter, current, effect: effectFromPlan(plan), port };
}

test("embedded carry claims the normalized absent-or-empty boundary once and reuses the exact token", async () => {
  const { adapter, current, effect, port } = await fixture();
  const before = canonicalJson(port.predecessor);
  const winner = await adapter.executeProvenanceCarryClaim(effect, current);
  assert.equal(winner.status, "observed");
  if (winner.status === "observed") {
    assert.equal(winner.result.status, "imported");
    if (winner.result.status === "imported") {
      assert.equal(winner.result.carry.exportId, effect.params.exportId);
      assert.equal(winner.result.carry.claimRevision, 1);
    }
  }
  assert.equal(canonicalJson(port.predecessor), before);
  assert.equal(
    port.requests.filter((request) => request.kind === "carry_claim").length,
    1,
  );
  const sameToken = await adapter.executeProvenanceCarryClaim(effect, current);
  assert.equal(sameToken.status, "observed");
  if (sameToken.status === "observed")
    assert.equal(sameToken.result.status, "imported");
  assert.equal(
    port.requests.filter((request) => request.kind === "carry_claim").length,
    1,
  );
  const claim = port.requests.find(
    (request): request is Extract<EmbeddedRequest, { kind: "carry_claim" }> =>
      request.kind === "carry_claim",
  );
  assert.ok(claim);
  assert.deepEqual(claim.slot, acquiredSlot());
  assert.deepEqual(port.claims, {
    [effect.params.exportId.slice("sce:carry:".length)]: recordFor(effect),
  });
});

test("embedded carry returns only a valid competing claimant and rejects tamper", async () => {
  const loser = await fixture();
  const digest = loser.effect.params.exportId.slice("sce:carry:".length);
  loser.port.claims = {
    [digest]: recordFor(loser.effect, "run-competitor"),
  };
  loser.port.setCheckpoint("clean", committedHead);
  const result = await loser.adapter.reconcileProvenanceCarryClaim(
    loser.effect,
    loser.current,
  );
  assert.equal(result.status, "observed");
  if (result.status === "observed") {
    assert.equal(result.result.status, "already_claimed");
    if (result.result.status === "already_claimed")
      assert.equal(result.result.claimantRunId, "run-competitor");
  }

  for (const claims of [
    [],
    { a: {}, b: {} },
    { oversized: "x".repeat(8_192) },
    {
      [digest]: {
        ...recordFor(loser.effect, "run-competitor"),
        extra: true,
      },
    },
    {
      [digest]: {
        ...recordFor(loser.effect, "run-competitor"),
        claimToken: loser.effect.params.claimToken,
      },
    },
    {
      ["b".repeat(64)]: {
        ...recordFor(loser.effect),
        exportId: `sce:carry:${"b".repeat(64)}`,
      },
    },
  ]) {
    const candidate = await fixture();
    candidate.port.claims = claims;
    const refused = await candidate.adapter.reconcileProvenanceCarryClaim(
      candidate.effect,
      candidate.current,
    );
    assert.equal(refused.status, "observed");
    if (refused.status === "observed") {
      assert.equal(refused.result.status, "predecessor_refused");
      if (refused.result.status === "predecessor_refused")
        assert.equal(refused.result.reason, "projection_invalid");
    }
    assert.equal(
      candidate.port.requests.some((request) => request.kind === "carry_claim"),
      false,
    );
  }
});

test("embedded carry recovery proves own and competing singleton durability", async () => {
  const ownCases = [
    { sync: false, workingSet: "pending" as const, head: baseHead },
    { sync: false, workingSet: "clean" as const, head: committedHead },
    {
      sync: true,
      workingSet: "clean" as const,
      head: committedHead,
      remoteHead: baseHead,
    },
    {
      sync: true,
      workingSet: "clean" as const,
      head: committedHead,
      remoteHead: committedHead,
    },
  ];
  for (const scenario of ownCases) {
    const candidate = await fixture(scenario.sync);
    const digest = candidate.effect.params.exportId.slice("sce:carry:".length);
    candidate.port.claims = {
      [digest]: recordFor(candidate.effect),
    };
    candidate.port.setCheckpoint(
      scenario.workingSet,
      scenario.head,
      scenario.remoteHead,
    );
    const result = await candidate.adapter.reconcileProvenanceCarryClaim(
      candidate.effect,
      candidate.current,
    );
    assert.equal(result.status, "observed");
    if (result.status === "observed")
      assert.equal(result.result.status, "imported");
  }

  for (const scenario of [
    { sync: false, workingSet: "pending" as const, head: baseHead },
    {
      sync: true,
      workingSet: "clean" as const,
      head: committedHead,
      remoteHead: baseHead,
    },
    {
      sync: true,
      workingSet: "clean" as const,
      head: committedHead,
      remoteHead: committedHead,
    },
  ]) {
    const candidate = await fixture(scenario.sync);
    const digest = candidate.effect.params.exportId.slice("sce:carry:".length);
    candidate.port.claims = {
      [digest]: recordFor(candidate.effect, "run-competitor"),
    };
    candidate.port.setCheckpoint(
      scenario.workingSet,
      scenario.head,
      scenario.remoteHead,
    );
    const result = await candidate.adapter.reconcileProvenanceCarryClaim(
      candidate.effect,
      candidate.current,
    );
    assert.equal(
      result.status,
      scenario.remoteHead === committedHead ? "observed" : "ambiguous",
    );
    assert.equal(
      candidate.port.requests.some((request) => request.kind === "commit"),
      false,
    );
    assert.equal(
      candidate.port.requests.some((request) => request.kind === "push"),
      false,
    );
  }

  const preexisting = await fixture();
  const preexistingDigest = preexisting.effect.params.exportId.slice(
    "sce:carry:".length,
  );
  preexisting.port.claims = {
    [preexistingDigest]: recordFor(preexisting.effect, "run-competitor"),
  };
  preexisting.port.setCheckpoint("clean", committedHead);
  const executeReadback = await preexisting.adapter.executeProvenanceCarryClaim(
    preexisting.effect,
    preexisting.current,
  );
  assert.equal(executeReadback.status, "observed");

  const raced = await fixture(true);
  const racedDigest = raced.effect.params.exportId.slice("sce:carry:".length);
  raced.port.claimResult = "stale";
  raced.port.staleClaims = {
    [racedDigest]: recordFor(raced.effect, "run-competitor"),
  };
  const staleReadback = await raced.adapter.executeProvenanceCarryClaim(
    raced.effect,
    raced.current,
  );
  assert.equal(staleReadback.status, "observed");
  if (staleReadback.status === "observed")
    assert.equal(staleReadback.result.status, "already_claimed");
});

test("embedded carry refuses empty or malformed provenance before claim CAS", async () => {
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
    value.port.predecessor = makeRootProjection(candidate.predecessor);
    const result = await value.adapter.executeProvenanceCarryClaim(
      value.effect,
      value.current,
    );
    assert.equal(result.status, "observed");
    if (result.status === "observed") {
      assert.equal(result.result.status, "predecessor_refused");
      if (result.result.status === "predecessor_refused")
        assert.equal(result.result.reason, candidate.reason);
    }
    assert.equal(
      value.port.requests.some((request) => request.kind === "carry_claim"),
      false,
    );
  }
});

test("embedded carry refuses invalid scope and terminal provenance without mutation", async () => {
  const scopeMismatch = await fixture();
  const mismatched = predecessorRun();
  scopeMismatch.port.predecessor = makeRootProjection({
    ...mismatched,
    repositoryIdentity: "repo-other",
  });
  const mismatchedResult =
    await scopeMismatch.adapter.reconcileProvenanceCarryClaim(
      scopeMismatch.effect,
      scopeMismatch.current,
    );
  assert.equal(mismatchedResult.status, "observed");
  if (
    mismatchedResult.status === "observed" &&
    mismatchedResult.result.status === "predecessor_refused"
  )
    assert.equal(mismatchedResult.result.reason, "scope_mismatch");

  const notReleased = await fixture();
  notReleased.port.predecessor = makeRootProjection(run([]));
  const activeResult = await notReleased.adapter.reconcileProvenanceCarryClaim(
    notReleased.effect,
    notReleased.current,
  );
  assert.equal(activeResult.status, "observed");
  if (
    activeResult.status === "observed" &&
    activeResult.result.status === "predecessor_refused"
  )
    assert.equal(activeResult.result.reason, "not_released");

  const notDeferred = await fixture();
  const terminal = run([]);
  notDeferred.port.predecessor = makeRootProjection({
    ...terminal,
    controller: { ...terminal.controller, state: "released" },
    state: "released",
  });
  const terminalResult =
    await notDeferred.adapter.reconcileProvenanceCarryClaim(
      notDeferred.effect,
      notDeferred.current,
    );
  assert.equal(terminalResult.status, "observed");
  if (
    terminalResult.status === "observed" &&
    terminalResult.result.status === "predecessor_refused"
  )
    assert.equal(terminalResult.result.reason, "provenance_not_deferred");
  assert.equal(
    [
      ...scopeMismatch.port.requests,
      ...notReleased.port.requests,
      ...notDeferred.port.requests,
    ].some((request) => request.kind === "carry_claim"),
    false,
  );
});

test("embedded execute and reconcile reject current-run and scope drift before claim", async () => {
  const cases: readonly Readonly<{
    effect?: (effect: CarryEffect) => CarryEffect;
    label: string;
    run?: (current: RepositoryRun) => RepositoryRun;
  }>[] = [
    {
      effect: (effect) =>
        effectWithParams(effect, { storeIdentity: "store-2" }),
      label: "store identity",
    },
    {
      effect: (effect) =>
        effectWithParams(effect, { repositoryIdentity: "repo-2" }),
      label: "repository identity",
    },
    {
      effect: (effect) =>
        effectWithParams(effect, { integrationBranch: "release" }),
      label: "integration branch",
    },
    {
      effect: (effect) =>
        effectWithParams(effect, { currentRunId: "run-competitor" }),
      label: "effect current run",
    },
    {
      label: "current run holder",
      run: (current) => ({
        ...current,
        controller: {
          ...current.controller,
          holder: "run-2/incarnation-other",
        },
      }),
    },
    {
      label: "run-id holder delimiter",
      run: (current) => ({
        ...current,
        controller: {
          ...current.controller,
          runId: "run-2/nested",
        },
      }),
    },
  ];
  for (const candidate of cases) {
    const value = await fixture();
    const effect = candidate.effect?.(value.effect) ?? value.effect;
    const current = candidate.run?.(value.current) ?? value.current;
    assert.deepEqual(
      await value.adapter.reconcileProvenanceCarryClaim(effect, current),
      { status: "ambiguous" },
      `${candidate.label} reconcile`,
    );
    assert.deepEqual(
      await value.adapter.executeProvenanceCarryClaim(effect, current),
      { status: "ambiguous" },
      `${candidate.label} execute`,
    );
    assert.equal(
      value.port.requests.some((request) => request.kind === "carry_claim"),
      false,
      candidate.label,
    );
  }
});

test("embedded carry fault phases stay ambiguous and never retry the claim", async () => {
  const cases = [
    { claimResult: "stale" as const },
    { ambiguousDiscoveryPoint: "before_commit" as const },
    { commitResult: "unavailable" as const },
    { ambiguousDiscoveryPoint: "after_commit" as const },
  ];
  for (const fault of cases) {
    const candidate = await fixture();
    Object.assign(candidate.port, fault);
    const result = await candidate.adapter.executeProvenanceCarryClaim(
      candidate.effect,
      candidate.current,
    );
    assert.equal(result.status, "ambiguous", JSON.stringify(fault));
    assert.equal(
      candidate.port.requests.filter(
        (request) => request.kind === "carry_claim",
      ).length,
      1,
    );
  }
});

test("embedded git-sync carry proves the old base and the new pushed head", async () => {
  const { adapter, current, effect, port } = await fixture(true);
  const result = await adapter.executeProvenanceCarryClaim(effect, current);
  assert.equal(result.status, "observed");
  if (result.status === "observed")
    assert.equal(result.result.status, "imported");
  assert.deepEqual(
    port.requests
      .filter(
        (
          request,
        ): request is Extract<EmbeddedRequest, { kind: "carry_discover" }> =>
          request.kind === "carry_discover",
      )
      .map((request) => request.point),
    ["before_commit", "after_commit", "before_push", "after_push"],
  );
});

function issueRow(
  root: RootProjection,
  claims: unknown,
  updatedAt: string,
): Record<string, unknown> {
  return {
    acceptance_criteria: "",
    actor: "",
    agent_state: "",
    await_id: "",
    await_type: "",
    close_reason: "",
    closed_by_session: "",
    compaction_level: 0,
    content_hash: "a".repeat(64),
    created_at: "2026-09-03 10:00:00",
    created_by: "",
    description: "predecessor",
    design: "",
    ephemeral: 0,
    event_kind: "",
    external_ref: "",
    hook_bead: "",
    id: predecessorRootBeadId,
    is_blocked: 0,
    is_template: 0,
    issue_type: "epic",
    metadata: {
      preserved: { owner: "fixture" },
      sce: { commitment: root.aggregateCommitment, projection: root },
      ...(claims === undefined ? {} : { sce_carry_claims: claims }),
    },
    mol_type: "",
    no_history: 0,
    notes: "",
    owner: "",
    payload: "",
    pinned: 0,
    priority: 0,
    rig: "",
    role_bead: "",
    role_type: "",
    sender: "",
    source_repo: "",
    source_system: "",
    spec_id: "",
    status: "closed",
    target: "",
    timeout_ns: 0,
    title: "Predecessor",
    updated_at: updatedAt,
    waiters: "",
    wisp_type: "",
    work_type: "",
  };
}

test("embedded checkpoint proof admits only the sibling carry singleton delta", async (t) => {
  const directory = await mkdtemp("/private/tmp/sce-carry-delta-");
  t.after(async () => await rm(directory, { force: true, recursive: true }));
  const fixtureValue = await fixture();
  const record = recordFor(fixtureValue.effect);
  const exportDigest = fixtureValue.effect.params.exportId.slice(
    "sce:carry:".length,
  );
  const intent: CarryCheckpointIntent = {
    expectedAggregateCommitment:
      fixtureValue.port.predecessor.aggregateCommitment,
    exportDigest,
    predecessorRootIssueId: predecessorRootBeadId,
    record,
  };
  const persistence = new DoltProjectionPersistence({
    childIssueId: () => undefined,
    databaseDirectory: directory,
    doltExecutable: join(directory, "unused-dolt"),
    rootIssueId: currentRootBeadId,
  });
  for (const beforeClaims of [undefined, {}]) {
    const before = issueRow(
      fixtureValue.port.predecessor,
      beforeClaims,
      "2026-09-03 10:00:00",
    );
    const after = issueRow(
      fixtureValue.port.predecessor,
      { [exportDigest]: record },
      "2026-09-03 10:00:01",
    );
    const delta = {
      tables: [
        {
          data_diff: [{ from_row: before, to_row: after }],
          name: "issues",
        },
      ],
    };
    assert.equal(
      persistence.matchesCarryDelta(intent, JSON.stringify(delta)),
      true,
    );
    assert.equal(
      persistence.matchesCarryDelta(
        intent,
        JSON.stringify({
          tables: [
            {
              data_diff: [
                {
                  from_row: before,
                  to_row: {
                    ...after,
                    metadata: {
                      ...(after.metadata as Record<string, unknown>),
                      unrelated: true,
                    },
                  },
                },
              ],
              name: "issues",
            },
          ],
        }),
      ),
      false,
    );
    assert.equal(
      persistence.matchesCarryDelta(
        intent,
        JSON.stringify({
          tables: [...delta.tables, { data_diff: [], name: "labels" }],
        }),
      ),
      false,
    );
  }
});

test("embedded concrete claim keeps slot predicate and singleton readback in one transaction", async (t) => {
  const directory = await mkdtemp("/private/tmp/sce-carry-sql-");
  t.after(async () => await rm(directory, { force: true, recursive: true }));
  const candidate = await fixture();
  const record = recordFor(candidate.effect);
  const exportDigest = candidate.effect.params.exportId.slice(
    "sce:carry:".length,
  );
  const transcript = join(directory, "transcript.txt");
  const executable = join(directory, "dolt");
  const singleton = { [exportDigest]: record };
  const row = {
    affected: 1,
    claims: singleton,
    label_count: 1,
    matching_label_count: 1,
    root_id: predecessorRootBeadId,
    root_sce: {
      commitment: candidate.port.predecessor.aggregateCommitment,
      projection: candidate.port.predecessor,
    },
    slot_design: canonicalJson(scope),
    slot_external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
    slot_id: "sce-merge-slot",
    slot_metadata: { holder },
    slot_status: "in_progress",
    slot_title: MERGE_SLOT_TITLE,
  };
  await writeFile(
    executable,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'if (process.argv[2] === "version") { console.log("dolt version 2.2.1"); process.exit(0); }',
      `fs.appendFileSync(${JSON.stringify(transcript)}, process.argv.at(-1) + "\\n");`,
      `console.log(${JSON.stringify(JSON.stringify({ rows: [row] }))});`,
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  const persistence = new DoltProjectionPersistence({
    childIssueId: () => undefined,
    databaseDirectory: directory,
    doltExecutable: executable,
    rootIssueId: currentRootBeadId,
  });
  const response = await persistence.claimCarry({
    exportDigest,
    expectedAggregateCommitment: candidate.port.predecessor.aggregateCommitment,
    kind: "carry_claim",
    predecessorRootIssueId: predecessorRootBeadId,
    record,
    slot: acquiredSlot(),
  });
  assert.equal(response.kind, "carry_claim");
  if (response.kind === "carry_claim")
    assert.equal(response.value.status, "observed");
  const query = await readFile(transcript, "utf8");
  assert.match(query, /^START TRANSACTION; UPDATE issues SET metadata=/u);
  assert.match(query, /SET @sce_affected=ROW_COUNT\(\)/u);
  assert.match(query, /FOR UPDATE; COMMIT; SELECT @sce_affected AS affected/u);
  assert.match(
    query,
    /JSON_LENGTH\(JSON_EXTRACT\(metadata,'\$\.sce_carry_claims'\)\)=0/u,
  );
  assert.match(query, /COUNT\(\*\) FROM labels WHERE issue_id=/u);
  assert.match(query, /matching_label_count/u);
  assert.equal(query.split("START TRANSACTION").length - 1, 1);
  assert.equal(query.split("COMMIT").length - 1, 1);
});

async function persistenceReturning(
  t: import("node:test").TestContext,
  row: Record<string, unknown>,
) {
  const directory = await mkdtemp("/private/tmp/sce-carry-read-");
  t.after(async () => await rm(directory, { force: true, recursive: true }));
  const executable = join(directory, "dolt");
  await writeFile(
    executable,
    [
      `#!${process.execPath}`,
      'if (process.argv[2] === "version") { console.log("dolt version 2.2.1"); process.exit(0); }',
      `console.log(${JSON.stringify(JSON.stringify({ rows: [row] }))});`,
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  return new DoltProjectionPersistence({
    childIssueId: () => undefined,
    databaseDirectory: directory,
    doltExecutable: executable,
    rootIssueId: currentRootBeadId,
  });
}

test("embedded concrete carry read distinguishes SQL absence from explicit null", async (t) => {
  const candidate = await fixture();
  const envelope = {
    commitment: candidate.port.predecessor.aggregateCommitment,
    projection: candidate.port.predecessor,
  };
  const absentPersistence = await persistenceReturning(t, {
    claims: null,
    claims_present: 0,
    claims_type: null,
    id: predecessorRootBeadId,
    sce: envelope,
  });
  const absent = await absentPersistence.readCarry(predecessorRootBeadId);
  assert.deepEqual(absent, {
    kind: "carry_read",
    value: {
      claims: {},
      root: candidate.port.predecessor,
      status: "observed",
    },
  });

  const nullPersistence = await persistenceReturning(t, {
    claims: null,
    claims_present: 1,
    claims_type: "NULL",
    id: predecessorRootBeadId,
    sce: envelope,
  });
  const port: EmbeddedProcessPort = {
    identity: processIdentity(false),
    execute: async (request) => {
      if (request.kind !== "carry_read")
        throw new Error("unexpected explicit-null request");
      return await nullPersistence.readCarry(request.predecessorRootIssueId);
    },
  };
  const adapter = new EmbeddedBeadsAdapter({
    holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(false),
    process: port,
    rootIssueId: currentRootBeadId,
    scope,
  });
  const refused = await adapter.reconcileProvenanceCarryClaim(
    candidate.effect,
    candidate.current,
  );
  assert.equal(refused.status, "observed");
  if (refused.status === "observed") {
    assert.equal(refused.result.status, "predecessor_refused");
    if (refused.result.status === "predecessor_refused")
      assert.equal(refused.result.reason, "projection_invalid");
  }
});

test("embedded concrete carry read rejects non-exact or drifted root envelopes", async (t) => {
  const candidate = await fixture();
  const envelopes = [
    { projection: candidate.port.predecessor },
    {
      commitment: candidate.port.predecessor.aggregateCommitment,
      extra: true,
      projection: candidate.port.predecessor,
    },
    {
      commitment: "0".repeat(64),
      projection: candidate.port.predecessor,
    },
    { commitment: candidate.port.predecessor.aggregateCommitment },
  ];
  for (const envelope of envelopes) {
    const persistence = await persistenceReturning(t, {
      claims: null,
      claims_present: 0,
      claims_type: null,
      id: predecessorRootBeadId,
      sce: envelope,
    });
    const port: EmbeddedProcessPort = {
      identity: processIdentity(false),
      execute: async (request) => {
        if (request.kind !== "carry_read")
          throw new Error("unexpected root-envelope request");
        return await persistence.readCarry(request.predecessorRootIssueId);
      },
    };
    const adapter = new EmbeddedBeadsAdapter({
      holder,
      mode: "local-only",
      prefix: "sce",
      preflight: preflight(false),
      process: port,
      rootIssueId: currentRootBeadId,
      scope,
    });
    const refused = await adapter.reconcileProvenanceCarryClaim(
      candidate.effect,
      candidate.current,
    );
    assert.equal(refused.status, "observed");
    if (
      refused.status === "observed" &&
      refused.result.status === "predecessor_refused"
    )
      assert.equal(refused.result.reason, "projection_invalid");
  }
});
