import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import fc from "fast-check";
import { legalActions } from "../../src/protocol/actions.js";
import {
  makeChildProjection,
  makeRootProjection,
} from "../../src/fencing/index.js";
import {
  deriveClosedUnitEvidenceCommitment,
  deriveGateEntryId,
  deriveIdempotencyKey,
  deriveIntentCommitment,
  deriveJournalCommitment,
  deriveParamsHash,
  deriveProvenanceCarryClaimKey,
  deriveProvenanceCarryExportId,
  deriveRepairJudgmentPromptHash,
  deriveRepairJudgmentResponseHash,
  deriveSessionFingerprint,
  deriveSessionLineageRoot,
  hasUsedSession,
  maximumMaterialisationSidecarBytes,
  compareProtocolText,
  provenanceCarryAncestorDigest,
  provenanceCarryLineageCommitment,
  provenanceCarrySnapshotCommitment,
  reduce,
  runInvariantErrors,
  sessionLineageCount,
} from "../../src/protocol/reducer.js";
import { canEnterTerminalIntent } from "../../src/protocol/guards.js";
import type {
  EffectJournalEntry,
  ProtocolEvent,
  RepositoryRun,
  UnitState,
  KnowledgeContract,
  ProvenanceInput,
} from "../../src/protocol/schemas.js";
import {
  LIMITS,
  ProtocolEventSchema,
  RepositoryRunSchema,
  RepositoryRunEnvelopeSchema,
  validate,
} from "../../src/protocol/schemas.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import { sha256 } from "../../src/protocol/evidence.js";
import {
  HASH,
  OID_A,
  OID_B,
  OID_C,
  event,
  repairEvidence,
  run,
  transition,
  unit,
} from "./fixtures.js";

function step(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(state, event(state, type, fields), reduce);
}

function gateIntent(
  state: RepositoryRun,
  type:
    | "destination_probe_intent"
    | "materialisation_resolve_intent"
    | "materialise_intent"
    | "provenance_commit_intent"
    | "verification_intent",
  kind:
    | "destination_probe"
    | "materialisation_resolve"
    | "materialise"
    | "provenance_commit"
    | "verify",
  gateEntryId: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(
    state,
    {
      eventId: `${kind}-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        kind,
        gateEntryId,
      ),
      ...fields,
      type,
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
}

function gateObservation(
  state: RepositoryRun,
  type:
    | "destination_probe_observed"
    | "materialisation_sources_observed"
    | "materialise_observed"
    | "provenance_commit_observed"
    | "verification_observed"
    | "verification_failed",
  gateEntryId: string,
  fields: Record<string, unknown>,
): RepositoryRun {
  const entry = [...state.effectJournal]
    .reverse()
    .find(
      (candidate) =>
        candidate.gateEntryId === gateEntryId &&
        candidate.status === "intended",
    );
  assert.ok(entry);
  return transition(
    state,
    {
      effectId: entry.effectId,
      effectKind: entry.kind,
      eventId: `${type}-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId,
      observationHash: HASH,
      ...fields,
      type,
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
}

function knowledgeContract(humanDriver = "knowledge-owner"): KnowledgeContract {
  return {
    aliases: [
      {
        alias: "drive",
        canonicalRoot: "/mnt/knowledge-drive",
        markerFile: ".sce-drive",
        mountPolicy: "required",
        namespaceControl: "exclusive",
      },
    ],
    audience: "knowledge-audience",
    combinedVerificationCommands: [["npm", "test"]],
    domainScope: "knowledge",
    gateTargets: [],
    humanDriver,
    projectId: "knowledge-project",
    provenance: {
      eventsDirectory: "knowledge/events",
      generatedDirectory: "knowledge/generated",
      recordFormatVersion: 1,
      reproducibilityCommand: ["npm", "run", "reproduce"],
      rollupGeneratorCommand: ["npm", "run", "rollup"],
    },
    provenanceWorktreeRoot: "/tmp/sce-provenance",
  };
}

function carryProjection(unitIds: readonly string[]): ProvenanceInput {
  const denseUnits: Record<string, unknown> = {};
  for (const [ordinal, unitId] of unitIds.entries()) {
    const intent = {
      effectId: `${unitId}:integrate`,
      idempotencyKey: `integrate-${unitId}`,
      intentRevision: ordinal + 1,
      kind: "integrate" as const,
      paramsHash: "8".repeat(64),
      schemaVersion: 1 as const,
      unitId,
    };
    const terminal = {
      ...intent,
      intentCommitment: deriveIntentCommitment(intent),
      observationHash: "9".repeat(64),
      status: "observed" as const,
    };
    denseUnits[unitId] = [
      "landed",
      unitId,
      ordinal,
      OID_A,
      0,
      null,
      null,
      null,
      null,
      [],
      [
        terminal.effectId,
        terminal.unitId,
        terminal.idempotencyKey,
        terminal.kind,
        terminal.intentRevision,
        terminal.intentCommitment,
        terminal.paramsHash,
        terminal.status,
        terminal.observationHash,
        terminal.schemaVersion,
      ],
      [
        OID_C,
        [OID_B, OID_C],
        [OID_A, OID_B, OID_C, HASH, ["npm test"]],
        [OID_A, OID_B, OID_C, HASH],
      ],
    ];
  }
  const closedUnitEvidence = deflateRawSync(
    Buffer.from(
      canonicalJson({
        u: denseUnits,
        v: 1,
      } as unknown as import("../../src/protocol/canonical.js").JsonValue),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  return {
    closedUnitEvidence,
    closureEvidenceCommitment:
      deriveClosedUnitEvidenceCommitment(closedUnitEvidence),
    destinationProbeEvidence: [],
    targetEvidence: [],
    unitIds: [...unitIds],
  };
}

function carryClaimEvents(
  state: RepositoryRun,
  projectionInputSnapshot: ProvenanceInput,
  lineageAncestorDigests: readonly string[],
  suffix: string,
) {
  const predecessorRootBeadId = `root-${suffix}`;
  const predecessorRunId = `run-${suffix}`;
  const predecessorWaveId = `wave-${suffix}`;
  const predecessorFinalRevision = 7;
  const predecessorJournalCheckpointCommitment = "3".repeat(64);
  const predecessorRootAggregateCommitment = "4".repeat(64);
  const snapshotCommitment = provenanceCarrySnapshotCommitment(
    projectionInputSnapshot,
  );
  const exportId = deriveProvenanceCarryExportId({
    finalRevision: predecessorFinalRevision,
    integrationBranch: state.integrationBranch,
    predecessorRootAggregateCommitment,
    predecessorRunId,
    predecessorWaveId,
    repositoryIdentity: state.repositoryIdentity,
    snapshotCommitment,
    storeIdentity: state.storeIdentity,
  });
  const claimToken = deriveProvenanceCarryClaimKey(
    state.controller.runId,
    exportId,
    predecessorRootBeadId,
  );
  const claimRecord = {
    claimRevision: 1,
    claimantRunId: state.controller.runId,
    claimToken,
    exportId,
    predecessorRootBeadId,
    predecessorRunId,
    predecessorWaveId,
    schema: "sce.provenance-carry-claim",
    snapshotCommitment,
    version: 1,
  } as const;
  const lineage = [
    ...lineageAncestorDigests,
    provenanceCarryAncestorDigest(predecessorRootBeadId, predecessorRunId),
  ];
  const eventId = `carry-${suffix}`;
  return {
    intent: {
      claimToken,
      eventId,
      expectedRevision: state.revision,
      exportId,
      idempotencyKey: claimToken,
      predecessorFinalRevision,
      predecessorJournalCheckpointCommitment,
      predecessorRootAggregateCommitment,
      predecessorRootBeadId,
      predecessorRunId,
      predecessorWaveId,
      snapshotCommitment,
      type: "provenance_carry_claim_intent" as const,
    },
    observation: {
      effectId: `${eventId}:provenance_carry_claim`,
      effectKind: "provenance_carry_claim" as const,
      eventId: `${eventId}-observed`,
      expectedRevision: state.revision + 1,
      observationHash: HASH,
      result: {
        carry: {
          claimRecordDigest: sha256(
            canonicalJson({
              claimRecord,
              domain: "sce.provenance-carry-claim-record.v1",
            }),
          ),
          claimRevision: 1 as const,
          exportId,
          integrationOid: OID_C,
          lineageAncestorDigests: lineage,
          lineageCommitment: provenanceCarryLineageCommitment(lineage),
          predecessorFinalRevision,
          predecessorJournalCheckpointCommitment,
          predecessorRootAggregateCommitment,
          predecessorRootBeadId,
          predecessorRunId,
          predecessorWaveId,
          projectionInputSnapshot,
          snapshotCommitment,
        },
        status: "imported" as const,
      },
      type: "provenance_carry_claim_observed" as const,
    },
  };
}

test("knowledge admission rejects an escape-heavy sidecar before promises", () => {
  const initial = { ...run(), wave: { id: "wave-0", unitIds: [] } };
  const contract = knowledgeContract('"'.repeat(4_096));
  assert.ok(
    maximumMaterialisationSidecarBytes(contract, initial.harness!) >
      LIMITS.materialisationSidecarBytes,
  );
  const planned = reduce(initial, {
    eventId: "knowledge-wave",
    expectedRevision: initial.revision,
    knowledgeContract: contract,
    tasks: [initial.units["unit-1"]!.taskMetadata!],
    type: "wave_planned",
    waveId: "wave-knowledge",
  });
  assert.equal(planned.ok, false);
  assert.equal(initial.gate, undefined);
});

test("knowledge admission requires an exact harness while software stays gate-free and pending gates block", () => {
  const base = { ...run(), wave: { id: "wave-0", unitIds: [] } };
  const task = base.units["unit-1"]!.taskMetadata!;
  const { harness: _harness, ...withoutHarness } = base;
  assert.equal(
    reduce(withoutHarness, {
      eventId: "missing-harness-knowledge",
      expectedRevision: withoutHarness.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [task],
      type: "wave_planned",
      waveId: "missing-harness",
    }).ok,
    false,
  );
  const software = reduce(withoutHarness, {
    eventId: "software-without-harness",
    expectedRevision: withoutHarness.revision,
    tasks: [task],
    type: "wave_planned",
    waveId: "software-wave",
  });
  assert.equal(software.ok, true);
  if (software.ok) assert.equal(software.nextState.gate, undefined);

  const planned = transition(
    base,
    {
      eventId: "exact-harness-knowledge",
      expectedRevision: base.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [task],
      type: "wave_planned",
      waveId: "exact-harness",
    },
    reduce,
  );
  assert.ok(planned.gate);
  assert.equal(
    reduce(planned, {
      eventId: "blocked-next-wave",
      expectedRevision: planned.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [task],
      type: "wave_planned",
      waveId: "too-early",
    }).ok,
    false,
  );
  assert.equal(
    reduce(planned, {
      eventId: "blocked-release",
      expectedRevision: planned.revision,
      idempotencyKey: deriveIdempotencyKey(
        planned,
        planned.revision,
        null,
        "controller_release",
      ),
      type: "controller_release_intent",
    }).ok,
    false,
  );

  const carryBase = run([]);
  const carryEvents = carryClaimEvents(
    carryBase,
    carryProjection(["unit-carried"]),
    [],
    "missing-harness-carry",
  );
  let carry = transition(carryBase, carryEvents.intent, reduce);
  carry = transition(carry, carryEvents.observation, reduce);
  const { harness: _carryHarness, ...carryWithoutHarness } = carry;
  assert.equal(
    reduce(carryWithoutHarness, {
      carryOnly: true,
      eventId: "missing-harness-carry-wave",
      expectedRevision: carryWithoutHarness.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [],
      type: "wave_planned",
      waveId: "missing-harness-carry",
    }).ok,
    false,
  );
});

test("protocol ordering is locale-independent for non-ASCII text", () => {
  assert.deepEqual(["é", "z", "ä", "a"].sort(compareProtocolText), [
    "a",
    "z",
    "ä",
    "é",
  ]);
});

test("dedicated carry claims use their stable domain key and settle exactly once", () => {
  const initial = { ...run(), wave: { id: "wave-0", unitIds: [] } };
  const predecessor = {
    finalRevision: 7,
    predecessorRootAggregateCommitment: "1".repeat(64),
    predecessorRunId: "run-predecessor",
    predecessorWaveId: "wave-predecessor",
    snapshotCommitment: "2".repeat(64),
  };
  const exportId = deriveProvenanceCarryExportId({
    ...predecessor,
    integrationBranch: initial.integrationBranch,
    repositoryIdentity: initial.repositoryIdentity,
    storeIdentity: initial.storeIdentity,
  });
  const idempotencyKey = deriveProvenanceCarryClaimKey(
    initial.controller.runId,
    exportId,
    "root-predecessor",
  );
  const intent = {
    claimToken: idempotencyKey,
    eventId: "carry-claim-event",
    expectedRevision: initial.revision,
    exportId,
    idempotencyKey,
    predecessorFinalRevision: predecessor.finalRevision,
    predecessorJournalCheckpointCommitment: "3".repeat(64),
    predecessorRootAggregateCommitment:
      predecessor.predecessorRootAggregateCommitment,
    predecessorRootBeadId: "root-predecessor",
    predecessorRunId: predecessor.predecessorRunId,
    predecessorWaveId: predecessor.predecessorWaveId,
    snapshotCommitment: predecessor.snapshotCommitment,
    type: "provenance_carry_claim_intent" as const,
  };
  const bad = reduce(initial, {
    ...intent,
    idempotencyKey: `carry-claim:${"0".repeat(64)}`,
  });
  assert.equal(bad.ok, false);
  const ambiguousIntent = transition(initial, intent, reduce);
  assert.equal(
    legalActions(ambiguousIntent).some(
      (action) =>
        action.type === "provenance_carry_claim_observed" &&
        action.effectId === "carry-claim-event:provenance_carry_claim" &&
        action.mode === "record",
    ),
    true,
  );
  assert.equal(
    legalActions(ambiguousIntent).some(
      (action) => action.type === "controller_release_intent",
    ),
    false,
  );
  const ambiguous = reduce(ambiguousIntent, {
    effectId: "carry-claim-event:provenance_carry_claim",
    effectKind: "provenance_carry_claim",
    eventId: "carry-claim-ambiguous",
    expectedRevision: ambiguousIntent.revision,
    observationHash: HASH,
    type: "effect_ambiguous",
    unitId: null,
  });
  assert.equal(ambiguous.ok, true);
  if (ambiguous.ok) {
    assert.equal(ambiguous.nextState.state, "blocked");
    assert.equal(ambiguous.nextState.effectJournal.at(-1)?.status, "ambiguous");
    assert.equal(
      ambiguous.nextState.provenanceCarryClaim?.currentEffectId,
      "carry-claim-event:provenance_carry_claim",
    );
  }
  let state = transition(initial, intent, reduce);
  assert.equal(state.provenanceCarryClaim?.claimToken, idempotencyKey);
  assert.equal(state.effectJournal.at(-1)?.idempotencyKey, idempotencyKey);
  state = transition(
    state,
    {
      effectId: "carry-claim-event:provenance_carry_claim",
      effectKind: "provenance_carry_claim",
      eventId: "carry-claim-refused",
      expectedRevision: state.revision,
      observationHash: HASH,
      result: {
        claimRecordDigest: "4".repeat(64),
        claimRevision: 1,
        claimantRunId: "another-run",
        exportId,
        status: "already_claimed",
      },
      type: "provenance_carry_claim_observed",
    },
    reduce,
  );
  assert.equal(state.provenanceCarryClaim, undefined);
  assert.equal(state.lastProvenanceCarryRefusal?.status, "already_claimed");
  assert.equal(runInvariantErrors(state).length, 0);
});

test("carry lineage admits one, two, and 128 hops and refuses duplicates or 129", () => {
  const input = carryProjection(["unit-carried"]);
  for (const ancestors of [
    [],
    [sha256("ancestor-one")],
    Array.from({ length: 127 }, (_, index) => sha256(`ancestor-${index}`)),
  ]) {
    const initial = run([]);
    const events = carryClaimEvents(
      initial,
      input,
      ancestors,
      `depth-${ancestors.length}`,
    );
    const intended = transition(initial, events.intent, reduce);
    const observed = transition(intended, events.observation, reduce);
    assert.equal(
      observed.pendingProvenanceCarry?.lineageAncestorDigests.length,
      ancestors.length + 1,
    );
    assert.deepEqual(runInvariantErrors(observed), []);
  }

  const duplicateInitial = run([]);
  const duplicateRoot = "root-duplicate";
  const duplicateRun = "run-duplicate";
  const duplicate = carryClaimEvents(
    duplicateInitial,
    input,
    [provenanceCarryAncestorDigest(duplicateRoot, duplicateRun)],
    "duplicate",
  );
  const duplicateIntended = transition(
    duplicateInitial,
    duplicate.intent,
    reduce,
  );
  assert.equal(reduce(duplicateIntended, duplicate.observation).ok, false);

  const overflowInitial = run([]);
  const overflow = carryClaimEvents(
    overflowInitial,
    input,
    Array.from({ length: 128 }, (_, index) => sha256(`overflow-${index}`)),
    "overflow",
  );
  const overflowIntended = transition(overflowInitial, overflow.intent, reduce);
  assert.equal(reduce(overflowIntended, overflow.observation).ok, false);
});

test("a full 64-unit carry-only wave reaches an observed provenance commit", () => {
  const unitIds = Array.from(
    { length: LIMITS.units },
    (_, index) => `unit-${index.toString().padStart(2, "0")}`,
  );
  const initial = run([]);
  const events = carryClaimEvents(
    initial,
    carryProjection(unitIds),
    [],
    "full",
  );
  let state = transition(initial, events.intent, reduce);
  state = transition(state, events.observation, reduce);
  state = transition(
    state,
    {
      carryOnly: true,
      eventId: "carry-only-wave",
      expectedRevision: state.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [],
      type: "wave_planned",
      waveId: "wave-carry-only",
    },
    reduce,
  );
  assert.equal(
    state.gate?.provenance?.projectionInputSnapshot.unitIds.length,
    64,
  );
  assert.equal(state.gate?.provenanceUnitAccounting.length, 64);
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: "carry-only-clock",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:00Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  const intentRevision = state.revision;
  state = transition(
    state,
    {
      eventId: "carry-only-provenance",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "provenance_commit",
        provenance.gateEntryId,
      ),
      type: "provenance_commit_intent",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      effectId: "carry-only-provenance:provenance_commit",
      effectKind: "provenance_commit",
      eventId: "carry-only-provenance-observed",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      observationHash: HASH,
      result: {
        attemptedBaseOid: OID_C,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
      type: "provenance_commit_observed",
      unitId: null,
    },
    reduce,
  );
  assert.equal(state.revision, intentRevision + 2);
  assert.equal(state.gate?.provenance?.status, "observed");
  assert.equal(
    state.gate?.provenanceUnitAccounting.filter(
      (item) =>
        item.status === "committed" && item.provenanceCommitOid === OID_B,
    ).length,
    64,
  );
  assert.deepEqual(runInvariantErrors(state), []);
});

test("knowledge target commitments reject dropped obligations and forged void origins", () => {
  const initial = { ...run(), wave: { id: "wave-0", unitIds: [] } };
  const task = {
    ...initial.units["unit-1"]!.taskMetadata!,
    materialisationTargets: [
      {
        destinationAlias: "drive",
        destinationSubpath: "published",
        namingPolicy: "source-basename" as const,
        sidecarRequired: true as const,
        sourcePattern: "docs/file*.md",
      },
    ],
  };
  const state = transition(
    initial,
    {
      eventId: "knowledge-obligations",
      expectedRevision: initial.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [task],
      type: "wave_planned",
      waveId: "wave-obligations",
    },
    reduce,
  );
  assert.ok(state.gate);
  assert.notDeepEqual(
    runInvariantErrors({
      ...state,
      gate: { ...state.gate, targetPromises: [] },
    }),
    [],
  );
  assert.notDeepEqual(
    runInvariantErrors({ ...state, wave: { ...state.wave, unitIds: [] } }),
    [],
  );
  for (const disposition of [
    "unit_not_landed",
    "no_landed_units",
    "deferral_cascade",
  ] as const) {
    const promise = state.gate.targetPromises[0]!;
    assert.notDeepEqual(
      runInvariantErrors({
        ...state,
        gate: {
          ...state.gate,
          targetPromises: [
            {
              ...promise,
              disposition,
              ...(disposition === "deferral_cascade"
                ? { followUpBeadId: "follow-up" }
                : {}),
              status: "voided",
            },
          ],
        },
      }),
      [],
    );
  }
  assert.notDeepEqual(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate,
        provenancePromise: {
          disposition: "no_landed_units",
          status: "voided",
        },
      },
    }),
    [],
  );
  assert.notDeepEqual(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate,
        aggregateVerifyPromise: {
          disposition: "deferral_cascade",
          followUpBeadId: "follow-up",
          status: "voided",
        },
      },
    }),
    [],
  );
});

test("optional probe refusal voids only expanded dependents and retains evidence", () => {
  const initial = run();
  const task = {
    ...initial.units["unit-1"]!.taskMetadata!,
    materialisationTargets: [
      {
        destinationAlias: "drive",
        destinationSubpath: "published",
        namingPolicy: "source-basename" as const,
        sidecarRequired: true as const,
        sourcePattern: "docs/file*.md",
      },
    ],
  };
  const contract = knowledgeContract();
  contract.aliases[0] = { ...contract.aliases[0]!, mountPolicy: "optional" };
  contract.gateTargets = [
    {
      destinationAlias: "drive",
      destinationSubpath: "gate-published",
      namingPolicy: "source-basename",
      sidecarRequired: true,
      sourcePattern: "rollup/file*.md",
    },
  ];
  const drained = { ...initial, wave: { id: "wave-0", unitIds: [] } };
  let state = transition(
    drained,
    {
      eventId: "knowledge-wave-planned",
      expectedRevision: drained.revision,
      knowledgeContract: contract,
      tasks: [task],
      type: "wave_planned",
      waveId: "knowledge-wave",
    },
    reduce,
  );
  state = approvedCandidate(
    "integrate",
    "remote-ff",
    "remote-integration",
    state,
  );
  state = step(state, "publish_intent");
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent");
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  state = step(state, "reservation_release_intent");
  state = observe(state, "reservation_released", "reservation_release");
  assert.equal(state.gate?.targetPromises.length, 1);
  const resolution = state.gate?.targets[0]?.resolution;
  assert.ok(resolution !== undefined);
  state = transition(
    state,
    {
      eventId: `resolve-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: resolution.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "materialisation_resolve",
        resolution.gateEntryId,
      ),
      type: "materialisation_resolve_intent",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      effectId: `resolve-${state.revision - 1}:materialisation_resolve`,
      effectKind: "materialisation_resolve",
      eventId: `resolved-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: resolution.gateEntryId,
      observationHash: HASH,
      result: {
        sources: [
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/file.md",
            sha256: HASH,
          },
        ],
        status: "observed",
      },
      type: "materialisation_sources_observed",
      unitId: null,
    },
    reduce,
  );
  const probe = state.gate?.destinationProbes[0];
  assert.ok(probe !== undefined);
  assert.notDeepEqual(
    runInvariantErrors({
      ...state,
      gate: { ...state.gate!, destinationProbes: [] },
    }),
    [],
  );
  const alias = state.knowledgeContract!.aliases[0]!;
  const orphanSubpath = "orphan";
  const orphanProbe = {
    destinationAlias: alias.alias,
    destinationSubpath: orphanSubpath,
    gateEntryId: deriveGateEntryId(
      state.controller.runId,
      state.gate!.waveId,
      "unit-destination-probe",
      { destination: alias, destinationSubpath: orphanSubpath },
    ),
    stage: "unit" as const,
    status: "pending" as const,
  };
  assert.notDeepEqual(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        destinationProbes: [...state.gate!.destinationProbes, orphanProbe],
      },
    }),
    [],
  );
  const target = state.gate!.targets[0]!;
  const wrongSourceOid = OID_A;
  const wrongResolutionId = deriveGateEntryId(
    state.controller.runId,
    state.gate!.waveId,
    "unit-resolve",
    { sourceOid: wrongSourceOid, targetId: target.definition.targetId },
  );
  const wrongMaterialisations = target.materialisations.map((item) => ({
    ...item,
    gateEntryId: deriveGateEntryId(
      state.controller.runId,
      state.gate!.waveId,
      "unit-materialise",
      {
        blobOid: item.source.blobOid,
        destinationProbeGateEntryId: item.destinationProbeGateEntryId,
        path: item.source.path,
        sourceOid: wrongSourceOid,
        targetId: item.targetId,
      },
    ),
    sourceOid: wrongSourceOid,
  }));
  assert.ok(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        targets: [
          {
            ...target,
            materialisations: wrongMaterialisations,
            resolution: {
              ...target.resolution!,
              gateEntryId: wrongResolutionId,
              sourceOid: wrongSourceOid,
            },
          },
        ],
      },
    }).some((error) => error.includes("lacks authoritative source")),
  );
  assert.ok(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        targets: [
          {
            ...target,
            resolution: {
              ...target.resolution!,
              sources: target.resolution!.sources!.map((source) => ({
                ...source,
                path: "outside/not-matched.txt",
              })),
            },
          },
        ],
      },
    }).some((error) => error.includes("observed resolution")),
  );
  assert.ok(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        targets: [
          {
            ...target,
            resolution: {
              ...target.resolution!,
              capacities: {
                ...target.resolution!.capacities!,
                remainingItemCapacity: 0,
              },
            },
          },
        ],
      },
    }).some((error) => error.includes("observed resolution")),
  );
  state = transition(
    state,
    {
      eventId: `probe-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: probe.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "destination_probe",
        probe.gateEntryId,
      ),
      type: "destination_probe_intent",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      effectId: `probe-${state.revision - 1}:destination_probe`,
      effectKind: "destination_probe",
      eventId: `probed-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: probe.gateEntryId,
      observationHash: HASH,
      result: {
        refusal: { code: "optional_alias_unmounted", detailHash: HASH },
        status: "refused",
      },
      type: "destination_probe_observed",
      unitId: null,
    },
    reduce,
  );
  assert.equal(state.gate?.targetPromises.length, 1);
  assert.equal(state.gate?.targets[0]?.status, "voided");
  assert.equal(state.gate?.targets[0]?.resolution?.status, "observed");
  assert.equal(state.gate?.targets[0]?.materialisations[0]?.status, "voided");
  assert.equal(state.gate?.destinationProbes[0]?.status, "voided");
  assert.equal(
    state.gate?.destinationProbes[0]?.lastRefusal?.code,
    "optional_alias_unmounted",
  );
  assert.deepEqual(runInvariantErrors(state), []);
  assert.ok(
    runInvariantErrors({
      ...state,
      knowledgeContract: {
        ...state.knowledgeContract!,
        aliases: state.knowledgeContract!.aliases.map((item) => ({
          ...item,
          mountPolicy: "required" as const,
        })),
      },
    }).some((error) => error.includes("contradicts mount policy")),
  );
  const provenanceTarget =
    state.gate?.provenance?.projectionInputSnapshot.targetEvidence[0];
  assert.ok(provenanceTarget);
  assert.ok(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        provenance: {
          ...state.gate!.provenance!,
          projectionInputSnapshot: {
            ...state.gate!.provenance!.projectionInputSnapshot,
            targetEvidence: [
              {
                ...provenanceTarget,
                materialisations: provenanceTarget.materialisations.map(
                  (item) => ({
                    ...item,
                    source: { ...item.source, blobOid: "e".repeat(64) },
                  }),
                ),
              },
            ],
          },
        },
      },
    }).some((error) => error.includes("OID incompatible")),
  );
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: `provenance-clock-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:00Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  const provenanceIntentRevision = state.revision;
  const provenanceIntentEventId = `provenance-intent-${state.revision}`;
  state = transition(
    state,
    {
      eventId: provenanceIntentEventId,
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "provenance_commit",
        provenance.gateEntryId,
      ),
      type: "provenance_commit_intent",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      effectId: `${provenanceIntentEventId}:provenance_commit`,
      effectKind: "provenance_commit",
      eventId: `provenance-observed-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      observationHash: HASH,
      result: {
        attemptedBaseOid: OID_C,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
      type: "provenance_commit_observed",
      unitId: null,
    },
    reduce,
  );
  assert.equal(state.revision, provenanceIntentRevision + 2);
  const aggregateVerify = state.gate!.aggregateVerify!;
  const verifyEventId = `aggregate-verify-${state.revision}`;
  state = transition(
    state,
    {
      commands: contract.combinedVerificationCommands,
      eventId: verifyEventId,
      expectedRevision: state.revision,
      gateEntryId: aggregateVerify.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "verify",
        aggregateVerify.gateEntryId,
      ),
      type: "verification_intent",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      baseOid: OID_C,
      effectId: `${verifyEventId}:verify`,
      effectKind: "verify",
      eventId: `aggregate-verified-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: aggregateVerify.gateEntryId,
      headOid: OID_B,
      observationHash: HASH,
      treeOid: OID_C,
      type: "verification_observed",
      unitId: null,
    },
    reduce,
  );
  const gateTarget = state.gate!.targets.find(
    (target) => target.definition.scope === "gate",
  );
  assert.ok(gateTarget?.resolution);
  const forgedGateSource = {
    ...gateTarget,
    resolution: {
      ...gateTarget.resolution,
      gateEntryId: deriveGateEntryId(
        state.controller.runId,
        state.gate!.waveId,
        "gate-resolve",
        { sourceOid: OID_A, targetId: gateTarget.definition.targetId },
      ),
      sourceOid: OID_A,
    },
  };
  assert.ok(
    runInvariantErrors({
      ...state,
      gate: {
        ...state.gate!,
        targets: state.gate!.targets.map((target) =>
          target.definition.targetId === gateTarget.definition.targetId
            ? forgedGateSource
            : target,
        ),
      },
    }).some((error) => error.includes("lacks authoritative source")),
  );
});

test("required shared-probe and evidence-budget deferrals preserve exact upstream evidence", () => {
  const targetA = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/a*.md",
  };
  const targetB = { ...targetA, sourcePattern: "docs/b*.md" };
  const contract = knowledgeContract();
  let state = landedKnowledgeRun(contract, [targetA, targetB]);
  for (const target of state.gate!.targets) {
    const resolution = target.resolution!;
    state = gateIntent(
      state,
      "materialisation_resolve_intent",
      "materialisation_resolve",
      resolution.gateEntryId,
    );
    state = gateObservation(
      state,
      "materialisation_sources_observed",
      resolution.gateEntryId,
      {
        result: {
          sources: [
            {
              blobOid: OID_B,
              byteCount: 4,
              path:
                target.definition.target.sourcePattern === "docs/a*.md"
                  ? "docs/a.md"
                  : "docs/b.md",
              sha256: HASH,
            },
          ],
          status: "observed",
        },
      },
    );
  }
  assert.equal(state.gate!.destinationProbes.length, 1);
  const probe = state.gate!.destinationProbes[0]!;
  state = gateIntent(
    state,
    "destination_probe_intent",
    "destination_probe",
    probe.gateEntryId,
  );
  state = gateObservation(
    state,
    "destination_probe_observed",
    probe.gateEntryId,
    {
      result: {
        refusal: { code: "required_alias_unmounted", detailHash: HASH },
        status: "refused",
      },
    },
  );
  const refusedProbe = state;
  let retriedProbe = gateIntent(
    refusedProbe,
    "destination_probe_intent",
    "destination_probe",
    probe.gateEntryId,
  );
  retriedProbe = gateObservation(
    retriedProbe,
    "destination_probe_observed",
    probe.gateEntryId,
    {
      result: {
        identity: {
          canonicalPath: "/mnt/knowledge-drive/published",
          device: "1",
          inode: "2",
        },
        status: "observed",
      },
    },
  );
  assert.equal(retriedProbe.gate!.destinationProbes[0]!.status, "observed");
  assert.equal(retriedProbe.gate!.destinationProbes[0]!.lastRefusal, undefined);
  assert.deepEqual(runInvariantErrors(retriedProbe), []);
  state = transition(
    state,
    {
      eventId: "defer-required-shared-probe",
      expectedRevision: state.revision,
      followUpBeadId: "follow-up-shared-probe",
      gateEntryId: probe.gateEntryId,
      type: "gate_entry_deferred",
      unitId: null,
    },
    reduce,
  );
  assert.equal(state.gate!.destinationProbes[0]!.status, "voided");
  assert.equal(
    state.gate!.destinationProbes[0]!.disposition,
    "deferred_by_controller",
  );
  assert.equal(
    state.gate!.targets.every(
      (target) =>
        target.status === "voided" &&
        target.resolution?.status === "observed" &&
        target.materialisations.every(
          (item) =>
            item.status === "voided" && item.disposition === "deferral_cascade",
        ),
    ),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);

  let budget = landedKnowledgeRun(contract, targetA);
  const resolution = budget.gate!.targets[0]!.resolution!;
  budget = gateIntent(
    budget,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  budget = gateObservation(
    budget,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        refusal: { code: "evidence_budget_exceeded", detailHash: HASH },
        status: "refused",
      },
    },
  );
  const refusedResolution = budget;
  let retriedResolution = gateIntent(
    refusedResolution,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  retriedResolution = gateObservation(
    retriedResolution,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        sources: [
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/a.md",
            sha256: HASH,
          },
        ],
        status: "observed",
      },
    },
  );
  assert.equal(
    retriedResolution.gate!.targets[0]!.resolution!.lastRefusal,
    undefined,
  );
  assert.deepEqual(runInvariantErrors(retriedResolution), []);
  budget = transition(
    budget,
    {
      eventId: "defer-budget-refusal",
      expectedRevision: budget.revision,
      followUpBeadId: "follow-up-budget",
      gateEntryId: resolution.gateEntryId,
      type: "gate_entry_deferred",
      unitId: null,
    },
    reduce,
  );
  assert.equal(budget.gate!.targets[0]!.resolution!.status, "voided");
  assert.equal(
    budget.gate!.targets[0]!.resolution!.disposition,
    "deferred_by_controller",
  );
  assert.deepEqual(runInvariantErrors(budget), []);
});

test("final-name collisions carry exact witnesses and permit deterministic retry or deferral", () => {
  const target = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/a*/r*.md",
  };
  let state = landedKnowledgeRun(knowledgeContract(), target);
  const resolution = state.gate!.targets[0]!.resolution!;
  state = gateIntent(
    state,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  state = gateObservation(
    state,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        sources: [
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/a/report.md",
            sha256: HASH,
          },
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/ab/report.md",
            sha256: HASH,
          },
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/ac/record.md",
            sha256: HASH,
          },
        ],
        status: "observed",
      },
    },
  );
  const probe = state.gate!.destinationProbes[0]!;
  state = gateIntent(
    state,
    "destination_probe_intent",
    "destination_probe",
    probe.gateEntryId,
  );
  state = gateObservation(
    state,
    "destination_probe_observed",
    probe.gateEntryId,
    {
      result: {
        identity: {
          canonicalPath: "/mnt/knowledge-drive/published",
          device: "1",
          inode: "2",
        },
        status: "observed",
      },
    },
  );
  const ids = state
    .gate!.targets[0]!.materialisations.map((item) => item.gateEntryId)
    .sort(compareProtocolText);
  for (const gateEntryId of ids)
    state = transition(
      state,
      {
        eventId: `collision-clock-${state.revision}`,
        expectedRevision: state.revision,
        gateEntryId,
        timestamp: "2026-09-03T12:00:00Z",
        type: "gate_clock_observed",
        unitId: null,
      },
      reduce,
    );
  const collided = state;
  const collidedItems = collided.gate!.targets[0]!.materialisations.filter(
    (item) => item.source.path.endsWith("/report.md"),
  );
  const collisionIds = collidedItems
    .map((item) => item.gateEntryId)
    .sort(compareProtocolText);
  const uniqueItem = collided.gate!.targets[0]!.materialisations.find((item) =>
    item.source.path.endsWith("/record.md"),
  );
  assert.ok(uniqueItem);
  assert.equal(uniqueItem.lastRefusal, undefined);
  for (const item of collidedItems) {
    assert.equal(item.lastRefusal?.code, "output_name_collision");
    if (item.lastRefusal?.code === "output_name_collision")
      assert.equal(
        item.lastRefusal.conflictingGateEntryId,
        collisionIds.find((id) => id !== item.gateEntryId),
      );
  }
  assert.equal(
    reduce(collided, {
      eventId: "blocked-unique-materialise",
      expectedRevision: collided.revision,
      gateEntryId: uniqueItem.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        collided,
        collided.revision,
        null,
        "materialise",
        uniqueItem.gateEntryId,
      ),
      type: "materialise_intent",
      unitId: null,
    }).ok,
    false,
  );
  assert.deepEqual(runInvariantErrors(collided), []);

  let retried = collided;
  const retryOrder = [
    collisionIds[0]!,
    ...ids.filter((gateEntryId) => gateEntryId !== collisionIds[0]),
  ];
  for (const [index, gateEntryId] of retryOrder.entries())
    retried = transition(
      retried,
      {
        eventId: `retry-clock-${retried.revision}`,
        expectedRevision: retried.revision,
        gateEntryId,
        timestamp: `2026-09-03T12:00:0${index + 1}Z`,
        type: "gate_clock_observed",
        unitId: null,
      },
      reduce,
    );
  const retryItems = retried.gate!.targets[0]!.materialisations;
  assert.equal(
    retryItems.every((item) => item.lastRefusal === undefined),
    true,
  );
  assert.equal(new Set(retryItems.map((item) => item.artifactName)).size, 3);
  assert.deepEqual(runInvariantErrors(retried), []);

  const deferred = transition(
    collided,
    {
      eventId: "defer-collision",
      expectedRevision: collided.revision,
      followUpBeadId: "follow-up-collision",
      gateEntryId: collisionIds[0]!,
      type: "gate_entry_deferred",
      unitId: null,
    },
    reduce,
  );
  assert.equal(
    deferred.gate!.targets[0]!.materialisations.find(
      (item) => item.gateEntryId === collisionIds[0],
    )!.status,
    "voided",
  );
  assert.equal(
    deferred.gate!.targets[0]!.materialisations.find(
      (item) => item.gateEntryId === collisionIds[1],
    )!.status,
    "pending",
  );
  assert.deepEqual(runInvariantErrors(deferred), []);
});

test("a later unit wave refuses an exact final-name collision with carried output evidence", () => {
  const target = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/report.md",
  };
  const contract = knowledgeContract();
  const prior = completeKnowledgeTarget(
    landedKnowledgeRun(contract, target),
    "docs/report.md",
    "2026-09-03T12:00:00Z",
  );
  const snapshot = prior.gate!.provenance!.projectionInputSnapshot;
  const carriedMaterialisation =
    snapshot.targetEvidence[0]!.materialisations[0]!;

  const fresh = run([unit("unit-2")]);
  const initial = { ...fresh, wave: { id: "wave-0", unitIds: [] } };
  const claim = carryClaimEvents(initial, snapshot, [], "cross-wave-name");
  let state = transition(initial, claim.intent, reduce);
  state = transition(state, claim.observation, reduce);
  const task = {
    ...state.units["unit-2"]!.taskMetadata!,
    materialisationTargets: [target],
  };
  state = transition(
    state,
    {
      eventId: "cross-wave-plan",
      expectedRevision: state.revision,
      knowledgeContract: contract,
      tasks: [task],
      type: "wave_planned",
      waveId: "cross-wave-current",
    },
    reduce,
  );
  state = approvedCandidate(
    "integrate",
    "remote-ff",
    "remote-integration",
    state,
  );
  state = stepUnit(state, "unit-2", "publish_intent");
  state = observeUnit(state, "unit-2", "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = stepUnit(state, "unit-2", "integrate_intent");
  state = observeUnit(state, "unit-2", "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  state = stepUnit(state, "unit-2", "reservation_release_intent");
  state = observeUnit(
    state,
    "unit-2",
    "reservation_released",
    "reservation_release",
  );

  const resolution = state.gate!.targets[0]!.resolution!;
  state = gateIntent(
    state,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  state = gateObservation(
    state,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        sources: [
          {
            blobOid: OID_B,
            byteCount: 4,
            path: "docs/report.md",
            sha256: HASH,
          },
        ],
        status: "observed",
      },
    },
  );
  const probe = state.gate!.destinationProbes[0]!;
  state = gateIntent(
    state,
    "destination_probe_intent",
    "destination_probe",
    probe.gateEntryId,
  );
  state = gateObservation(
    state,
    "destination_probe_observed",
    probe.gateEntryId,
    {
      result: {
        identity: {
          canonicalPath: "/mnt/knowledge-drive/published",
          device: "1",
          inode: "2",
        },
        status: "observed",
      },
    },
  );
  const current = state.gate!.targets[0]!.materialisations[0]!;
  state = transition(
    state,
    {
      eventId: "cross-wave-clock",
      expectedRevision: state.revision,
      gateEntryId: current.gateEntryId,
      timestamp: "2026-09-03T12:00:00Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  const refused = state.gate!.targets[0]!.materialisations[0]!;
  assert.deepEqual(refused.lastRefusal, {
    code: "output_name_collision",
    conflictingGateEntryId: carriedMaterialisation.gateEntryId,
  });
  assert.deepEqual(runInvariantErrors(state), []);
});

test("all naming policies produce exact canonical final-name and sidecar vectors", () => {
  const timestamp = "2026-09-03T12:34:56Z";
  const expectedNames = {
    "content-hash-suffix":
      "my-report--dddddddddddd--bbbbbbbbbbbb--20260903T123456Z.md",
    "iso-date-prefix":
      "2026-09-03--my-report--bbbbbbbbbbbb--20260903T123456Z.md",
    "source-basename": "my-report--bbbbbbbbbbbb--20260903T123456Z.md",
  } as const;
  const vectors: { name: string; policy: string; sidecarDigest: string }[] = [];
  for (const policy of [
    "source-basename",
    "iso-date-prefix",
    "content-hash-suffix",
  ] as const) {
    const target = {
      destinationAlias: "drive",
      destinationSubpath: "published",
      namingPolicy: policy,
      sidecarRequired: true as const,
      sourcePattern: "docs/My_report.MD",
    };
    const state = clockKnowledgeTarget(
      landedKnowledgeRun(knowledgeContract(), target),
      "docs/My_report.MD",
      timestamp,
    );
    const item = state.gate!.targets[0]!.materialisations[0]!;
    assert.equal(item.artifactName, expectedNames[policy]);
    assert.equal(
      item.sidecarName,
      `${expectedNames[policy]}.sce-provenance.json`,
    );
    const intent = reduce(state, {
      eventId: `naming-${policy}`,
      expectedRevision: state.revision,
      gateEntryId: item.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "materialise",
        item.gateEntryId,
      ),
      type: "materialise_intent",
      unitId: null,
    });
    assert.equal(intent.ok, true);
    if (!intent.ok) continue;
    const effect = intent.effects[0]!;
    assert.equal(effect.kind, "materialise");
    if (effect.kind !== "materialise") continue;
    const parsed = JSON.parse(effect.params.sidecarBytes) as JsonValue;
    assert.equal(effect.params.sidecarBytes, `${canonicalJson(parsed)}\n`);
    assert.equal(
      effect.params.sidecarSha256,
      sha256(effect.params.sidecarBytes),
    );
    vectors.push({
      name: effect.params.artifactName,
      policy,
      sidecarDigest: effect.params.sidecarSha256,
    });
  }
  assert.deepEqual(vectors, [
    {
      name: expectedNames["source-basename"],
      policy: "source-basename",
      sidecarDigest:
        "57e38286a59edaad3f6fb7442ef177ba2598a055ac0492283897b6198d7fb854",
    },
    {
      name: expectedNames["iso-date-prefix"],
      policy: "iso-date-prefix",
      sidecarDigest:
        "2bf8230a35bba75889ceff468db9e0d39f3dd6354e29edf2d7030f3be550d71a",
    },
    {
      name: expectedNames["content-hash-suffix"],
      policy: "content-hash-suffix",
      sidecarDigest:
        "3ffa95f34ac0556752c5c7c1ba247fda68da8dd492adf95255c99ad4367e0866",
    },
  ]);
});

test("handoff gates defer unit-target voiding to closure, preserve empty placeholders, and reject carry claims", () => {
  const target = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/report.md",
  };
  const base = run();
  const initial = {
    ...base,
    authorityProfile: "push-branch" as const,
    completionBoundary: "branch-handoff" as const,
    integrationProfile: "none" as const,
    wave: { id: "wave-0", unitIds: [] },
  };
  const task = {
    ...initial.units["unit-1"]!.taskMetadata!,
    materialisationTargets: [target],
  };
  let state = transition(
    initial,
    {
      eventId: "handoff-knowledge-wave",
      expectedRevision: initial.revision,
      knowledgeContract: knowledgeContract(),
      tasks: [task],
      type: "wave_planned",
      waveId: "handoff-knowledge",
    },
    reduce,
  );
  assert.equal(state.gate!.targetPromises[0]!.status, "pending");
  assert.equal(state.gate!.provenancePromise?.disposition, "handoff_boundary");
  state = approvedCandidate("push-branch", "none", "branch-handoff", state);
  state = step(state, "publish_intent");
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  assert.equal(state.gate!.targetPromises[0]!.status, "voided");
  assert.equal(state.gate!.targetPromises[0]!.disposition, "handoff_boundary");
  state = step(state, "reservation_release_intent");
  state = observe(state, "reservation_released", "reservation_release");
  assert.equal(state.gate!.provenance, undefined);
  assert.equal(state.gate!.provenancePromise?.disposition, "handoff_boundary");
  assert.equal(
    state.gate!.aggregateVerifyPromise?.disposition,
    "handoff_boundary",
  );
  assert.deepEqual(runInvariantErrors(state), []);

  const carryInitial = {
    ...run([]),
    authorityProfile: "push-branch" as const,
    completionBoundary: "branch-handoff" as const,
    integrationProfile: "none" as const,
  };
  const carryEvents = carryClaimEvents(
    carryInitial,
    carryProjection(["unit-carried"]),
    [],
    "handoff-carry",
  );
  assert.equal(reduce(carryInitial, carryEvents.intent).ok, false);
});

test("provenance refusals defer while only base advancement permits a rebound intent", () => {
  const ready = landedKnowledgeRun(knowledgeContract(), []);
  const provenance = ready.gate!.provenance!;
  const clocked = transition(
    ready,
    {
      eventId: "provenance-union-clock",
      expectedRevision: ready.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:00Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  const intended = gateIntent(
    clocked,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  const cases = [
    {
      attemptedCommitOid: OID_B,
      attemptedTreeOid: OID_C,
      reasonDigest: HASH,
      status: "reproducibility_failed" as const,
    },
    {
      condition: "unexpected_head" as const,
      expectedBaseOid: OID_C,
      observedHeadOid: null,
      reasonDigest: HASH,
      status: "worktree_refused" as const,
    },
    {
      attemptedCommitOid: OID_B,
      attemptedTreeOid: OID_C,
      reasonDigest: HASH,
      status: "integration_refused" as const,
    },
  ];
  for (const [index, result] of cases.entries()) {
    const refused = gateObservation(
      intended,
      "provenance_commit_observed",
      provenance.gateEntryId,
      { result },
    );
    const deferred = transition(
      refused,
      {
        eventId: `defer-provenance-${index}`,
        expectedRevision: refused.revision,
        followUpBeadId: `follow-up-provenance-${index}`,
        gateEntryId: provenance.gateEntryId,
        type: "gate_entry_deferred",
        unitId: null,
      },
      reduce,
    );
    assert.equal(deferred.gate!.provenance!.status, "voided");
    assert.equal(
      deferred.gate!.aggregateVerifyPromise?.disposition,
      "deferral_cascade",
    );
    assert.deepEqual(runInvariantErrors(deferred), []);
  }

  const advanced = gateObservation(
    intended,
    "provenance_commit_observed",
    provenance.gateEntryId,
    {
      result: {
        advancedBaseOid: OID_A,
        attemptedCommitOid: OID_B,
        attemptedTreeOid: OID_C,
        status: "base_advanced",
      },
    },
  );
  const rebound = gateIntent(
    advanced,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  assert.equal(rebound.gate!.provenance!.baseOid, OID_A);
  assert.equal(rebound.gate!.provenance!.lastRefusal, undefined);
  assert.equal(rebound.effectJournal.at(-1)!.kind, "provenance_commit");
  assert.deepEqual(runInvariantErrors(rebound), []);
});

test("keyed provenance and aggregate recovery converge before verify deferral cascades to gate targets", () => {
  const contract = knowledgeContract();
  contract.gateTargets = [
    {
      destinationAlias: "drive",
      destinationSubpath: "rollup",
      namingPolicy: "source-basename",
      sidecarRequired: true,
      sourcePattern: "knowledge/rollup.md",
    },
  ];
  let state = landedKnowledgeRun(contract, []);
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: "recovery-provenance-clock",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:05:00Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  state = gateIntent(
    state,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  const provenanceEffect = state.effectJournal.at(-1)!;
  state = transition(
    state,
    {
      effectId: provenanceEffect.effectId,
      effectKind: provenanceEffect.kind,
      eventId: "recovery-provenance-ambiguous",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      observationHash: HASH,
      type: "effect_ambiguous",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      effectId: provenanceEffect.effectId,
      effectKind: provenanceEffect.kind,
      eventId: "recovery-provenance-exact",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      observationHash: HASH,
      result: {
        attemptedBaseOid: provenance.baseOid!,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
      type: "provenance_commit_observed",
      unitId: null,
    },
    reduce,
  );
  const aggregate = state.gate!.aggregateVerify!;
  assert.equal(
    state.gate!.targetPromises.some(
      (target) => target.definition.scope === "gate",
    ),
    true,
  );
  state = gateIntent(
    state,
    "verification_intent",
    "verify",
    aggregate.gateEntryId,
    { commands: contract.combinedVerificationCommands },
  );
  const verifyEffect = state.effectJournal.at(-1)!;
  state = transition(
    state,
    {
      effectId: verifyEffect.effectId,
      effectKind: verifyEffect.kind,
      eventId: "recovery-verify-ambiguous",
      expectedRevision: state.revision,
      gateEntryId: aggregate.gateEntryId,
      observationHash: HASH,
      type: "effect_ambiguous",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      baseOid: provenance.baseOid!,
      effectId: verifyEffect.effectId,
      effectKind: verifyEffect.kind,
      eventId: "recovery-verify-failed",
      expectedRevision: state.revision,
      gateEntryId: aggregate.gateEntryId,
      headOid: OID_B,
      observationHash: HASH,
      treeOid: OID_C,
      type: "verification_failed",
      unitId: null,
    },
    reduce,
  );
  state = transition(
    state,
    {
      eventId: "defer-aggregate-verify",
      expectedRevision: state.revision,
      followUpBeadId: "follow-up-aggregate",
      gateEntryId: aggregate.gateEntryId,
      type: "gate_entry_deferred",
      unitId: null,
    },
    reduce,
  );
  assert.equal(state.gate!.aggregateVerify!.status, "voided");
  assert.equal(
    state.gate!.targetPromises.find(
      (target) => target.definition.scope === "gate",
    )!.disposition,
    "deferral_cascade",
  );
  assert.deepEqual(runInvariantErrors(state), []);
});

test("two knowledge waves retain exact uncommitted and committed membership without replaying the first wave", () => {
  const first = unit("unit-1");
  const secondBase = unit("unit-2");
  const second = {
    ...secondBase,
    taskMetadata: {
      ...secondBase.taskMetadata!,
      dependencies: ["unit-1"],
    },
  };
  const contract = knowledgeContract();
  const base = run([first, second]);
  let state = transition(
    { ...base, wave: { id: "wave-0", unitIds: [] } },
    {
      eventId: "accounting-wave-one",
      expectedRevision: base.revision,
      knowledgeContract: contract,
      tasks: [first.taskMetadata!, second.taskMetadata!],
      type: "wave_planned",
      waveId: "accounting-one",
    },
    reduce,
  );
  assert.deepEqual(state.gate!.originalUnitIds, ["unit-1"]);
  state = approvedCandidate(
    "integrate",
    "remote-ff",
    "remote-integration",
    state,
  );
  state = stepUnit(state, "unit-1", "publish_intent");
  state = observeUnit(state, "unit-1", "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = stepUnit(state, "unit-1", "integrate_intent");
  state = observeUnit(state, "unit-1", "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  state = stepUnit(state, "unit-1", "reservation_release_intent");
  state = observeUnit(
    state,
    "unit-1",
    "reservation_released",
    "reservation_release",
  );
  assert.deepEqual(
    state.gate!.provenanceUnitAccounting.map((item) => [
      item.unitId,
      item.status,
    ]),
    [["unit-1", "uncommitted"]],
  );
  state = completeKnowledgeProvenance(state, "2026-09-03T12:10:00Z");
  assert.equal(state.gate!.provenanceUnitAccounting[0]!.status, "committed");
  assert.equal(
    state.gate!.provenanceUnitAccounting[0]!.provenanceCommitOid,
    OID_B,
  );

  state = transition(
    state,
    {
      eventId: "accounting-wave-two",
      expectedRevision: state.revision,
      knowledgeContract: contract,
      tasks: [state.units["unit-2"]!.taskMetadata!],
      type: "wave_planned",
      waveId: "accounting-two",
    },
    reduce,
  );
  assert.deepEqual(state.gate!.originalUnitIds, ["unit-2"]);
  assert.equal(state.gate!.provenanceUnitAccounting.length, 0);
  state = approvedCandidate(
    "integrate",
    "remote-ff",
    "remote-integration",
    state,
  );
  state = stepUnit(state, "unit-2", "publish_intent");
  state = observeUnit(state, "unit-2", "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = stepUnit(state, "unit-2", "integrate_intent");
  state = observeUnit(state, "unit-2", "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  state = stepUnit(state, "unit-2", "reservation_release_intent");
  state = observeUnit(
    state,
    "unit-2",
    "reservation_released",
    "reservation_release",
  );
  assert.deepEqual(
    state.gate!.provenanceUnitAccounting.map((item) => [
      item.unitId,
      item.status,
    ]),
    [["unit-2", "uncommitted"]],
  );
  state = completeKnowledgeProvenance(state, "2026-09-03T12:11:00Z");
  assert.deepEqual(
    state.gate!.provenanceUnitAccounting.map((item) => [
      item.unitId,
      item.status,
      item.status === "committed" ? item.provenanceCommitOid : undefined,
    ]),
    [["unit-2", "committed", OID_B]],
  );
  assert.deepEqual(runInvariantErrors(state), []);
});

test("knowledge gates run resolve, probe, publish, provenance, verify, and gate targets in order", () => {
  const target = (subpath: string, pattern: string) => ({
    destinationAlias: "drive",
    destinationSubpath: subpath,
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: pattern,
  });
  const contract = knowledgeContract();
  contract.combinedVerificationCommands = [
    ["npm", "run", "test:fast"],
    ["npm", "run", "test:integration"],
  ];
  contract.gateTargets = [target("gate-published", "rollup/file*.md")];
  let state = landedKnowledgeRun(
    contract,
    target("unit-published", "docs/file*.md"),
  );

  const completeTarget = (
    current: RepositoryRun,
    targetId: string,
    path: string,
    timestamp: string,
  ): RepositoryRun => {
    let next = current;
    const resolution = next.gate!.targets.find(
      (item) => item.definition.targetId === targetId,
    )!.resolution!;
    next = gateIntent(
      next,
      "materialisation_resolve_intent",
      "materialisation_resolve",
      resolution.gateEntryId,
    );
    const pending = next.effectJournal.at(-1)!;
    assert.equal(
      reduce(next, {
        effectId: pending.effectId,
        effectKind: pending.kind,
        eventId: `ambiguous-omitted-${next.revision}`,
        expectedRevision: next.revision,
        observationHash: HASH,
        type: "effect_ambiguous",
        unitId: null,
      }).ok,
      false,
    );
    assert.equal(
      reduce(next, {
        effectId: pending.effectId,
        effectKind: pending.kind,
        eventId: `ambiguous-wrong-${next.revision}`,
        expectedRevision: next.revision,
        gateEntryId: "wrong-gate-entry",
        observationHash: HASH,
        type: "effect_ambiguous",
        unitId: null,
      }).ok,
      false,
    );
    assert.equal(
      reduce(next, {
        effectId: pending.effectId,
        effectKind: pending.kind,
        eventId: `ambiguous-exact-${next.revision}`,
        expectedRevision: next.revision,
        gateEntryId: resolution.gateEntryId,
        observationHash: HASH,
        type: "effect_ambiguous",
        unitId: null,
      }).ok,
      true,
    );
    next = gateObservation(
      next,
      "materialisation_sources_observed",
      resolution.gateEntryId,
      {
        result: {
          sources: [{ blobOid: OID_B, byteCount: 4, path, sha256: HASH }],
          status: "observed",
        },
      },
    );
    const sourceTarget = next.gate!.targets.find(
      (item) => item.definition.targetId === targetId,
    )!;
    const probe = next.gate!.destinationProbes.find(
      (item) =>
        item.gateEntryId ===
        sourceTarget.materialisations[0]!.destinationProbeGateEntryId,
    )!;
    assert.equal(
      reduce(next, {
        eventId: `pre-probe-clock-${next.revision}`,
        expectedRevision: next.revision,
        gateEntryId: sourceTarget.materialisations[0]!.gateEntryId,
        timestamp,
        type: "gate_clock_observed",
        unitId: null,
      }).ok,
      false,
    );
    next = gateIntent(
      next,
      "destination_probe_intent",
      "destination_probe",
      probe.gateEntryId,
    );
    next = gateObservation(
      next,
      "destination_probe_observed",
      probe.gateEntryId,
      {
        result: {
          identity: {
            canonicalPath: `/mnt/knowledge-drive/${sourceTarget.definition.target.destinationSubpath}`,
            device: "1",
            inode: sourceTarget.definition.scope === "unit" ? "2" : "3",
          },
          status: "observed",
        },
      },
    );
    const materialisation = next.gate!.targets.find(
      (item) => item.definition.targetId === targetId,
    )!.materialisations[0]!;
    next = transition(
      next,
      {
        eventId: `clock-${next.revision}`,
        expectedRevision: next.revision,
        gateEntryId: materialisation.gateEntryId,
        timestamp,
        type: "gate_clock_observed",
        unitId: null,
      },
      reduce,
    );
    const named = next.gate!.targets.find(
      (item) => item.definition.targetId === targetId,
    )!.materialisations[0]!;
    next = gateIntent(
      next,
      "materialise_intent",
      "materialise",
      named.gateEntryId,
    );
    next = gateObservation(next, "materialise_observed", named.gateEntryId, {
      result: {
        refusal: { code: "source_absent", detailHash: HASH },
        status: "refused",
      },
    });
    next = gateIntent(
      next,
      "materialise_intent",
      "materialise",
      named.gateEntryId,
    );
    next = gateObservation(next, "materialise_observed", named.gateEntryId, {
      result: {
        observation: {
          artifactByteCount: named.source.byteCount,
          artifactSha256: named.source.sha256,
          artifactStatus: "published",
          sidecarByteCount: named.sidecarByteCount,
          sidecarSha256: named.sidecarSha256,
          sidecarStatus: "published",
        },
        status: "observed",
      },
    });
    return next;
  };

  const unitTargetId = state.gate!.targets.find(
    (item) => item.definition.scope === "unit",
  )!.definition.targetId;
  state = completeTarget(
    state,
    unitTargetId,
    "docs/file.md",
    "2026-09-03T12:00:00Z",
  );
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: "success-provenance-clock",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:01Z",
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  state = gateIntent(
    state,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  state = gateObservation(
    state,
    "provenance_commit_observed",
    provenance.gateEntryId,
    {
      result: {
        attemptedBaseOid: OID_C,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
    },
  );
  const aggregate = state.gate!.aggregateVerify!;
  assert.equal(
    state.gate!.targetPromises.some((item) => item.definition.scope === "gate"),
    true,
  );
  assert.equal(
    reduce(state, {
      commands: [...contract.combinedVerificationCommands].reverse(),
      eventId: "aggregate-command-reordered",
      expectedRevision: state.revision,
      gateEntryId: aggregate.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "verify",
        aggregate.gateEntryId,
      ),
      type: "verification_intent",
      unitId: null,
    }).ok,
    false,
  );
  state = gateIntent(
    state,
    "verification_intent",
    "verify",
    aggregate.gateEntryId,
    { commands: contract.combinedVerificationCommands },
  );
  state = gateObservation(
    state,
    "verification_observed",
    aggregate.gateEntryId,
    { baseOid: OID_C, headOid: OID_B, treeOid: OID_C },
  );
  const gateTargetId = state.gate!.targets.find(
    (item) => item.definition.scope === "gate",
  )!.definition.targetId;
  state = completeTarget(
    state,
    gateTargetId,
    "rollup/file.md",
    "2026-09-03T12:00:02Z",
  );
  assert.equal(
    state.gate!.targets.every((item) => item.status === "observed"),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    legalActions(state).some(
      (action) =>
        action.mode === "emit" && action.type === "controller_release_intent",
    ),
    true,
  );
});
function effectId(state: RepositoryRun, kind: string): string {
  return `event-${state.revision}:${kind}`;
}
function observe(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  kind: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return step(state, type, {
    effectId: effectId(state, kind),
    effectKind: kind,
    observationHash: HASH,
    ...fields,
  });
}
function stepUnit(
  state: RepositoryRun,
  unitId: string,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(state, event(state, type, fields, unitId), reduce);
}
function observeUnit(
  state: RepositoryRun,
  unitId: string,
  type: ProtocolEvent["type"],
  kind: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return stepUnit(state, unitId, type, {
    effectId: effectId(state, kind),
    effectKind: kind,
    observationHash: HASH,
    ...fields,
  });
}
function completeCandidate(
  initial: RepositoryRun = run(),
  unitId = "unit-1",
): RepositoryRun {
  let state = initial;
  const defaultUnit = unitId === "unit-1";
  const reservationId = defaultUnit ? "res-1" : `res-${unitId}`;
  const branchRef = `sce/${unitId}`;
  const worktreePath = `/tmp/${unitId}`;
  state = stepUnit(state, unitId, "reservation_intent", {
    idempotencyKey: defaultUnit ? "reserve-1" : `reserve-${unitId}`,
    reservations: [{ id: reservationId, namespace: "port", resource: "3001" }],
  });
  state = observeUnit(
    state,
    unitId,
    "reservation_observed",
    "reservation_acquire",
  );
  state = stepUnit(state, unitId, "branch_intent", {
    idempotencyKey: defaultUnit ? "branch-1" : `branch-${unitId}`,
    branchRef,
  });
  state = observeUnit(state, unitId, "branch_observed", "branch_create", {
    branchRef,
  });
  state = stepUnit(state, unitId, "worktree_intent", {
    idempotencyKey: defaultUnit ? "worktree-1" : `worktree-${unitId}`,
    worktreePath,
  });
  state = observeUnit(state, unitId, "worktree_observed", "worktree_create", {
    worktreePath,
  });
  state = stepUnit(state, unitId, "dispatch_intent", {
    idempotencyKey: defaultUnit ? "dispatch-1" : `dispatch-${unitId}`,
  });
  state = observeUnit(state, unitId, "dispatch_observed", "dispatch", {
    sessionId: defaultUnit ? "worker-1" : `worker-${unitId}`,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  state = stepUnit(state, unitId, "collect_intent", {
    idempotencyKey: defaultUnit ? "collect-1" : `collect-${unitId}`,
  });
  state = observeUnit(state, unitId, "worker_collected", "worker_collect", {
    workerResult: { status: "completed", summary: "done", residualRisks: [] },
  });
  state = stepUnit(state, unitId, "candidate_intent", {
    idempotencyKey: defaultUnit ? "candidate-1" : `candidate-${unitId}`,
  });
  state = observeUnit(
    state,
    unitId,
    "candidate_observed",
    "candidate_collect",
    {
      headOid: OID_B,
      treeOid: OID_C,
    },
  );
  return state;
}

test("a refused and deferred unit target admits the provenance intent after journal compaction", () => {
  const contract = knowledgeContract();
  let state = landedKnowledgeRun(contract, {
    destinationAlias: "drive",
    destinationSubpath: "unit-published",
    namingPolicy: "source-basename",
    sidecarRequired: true,
    sourcePattern: "docs/file*.md",
  });
  const resolution = state.gate!.targets[0]!.resolution!;
  state = gateIntent(
    state,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  state = gateObservation(
    state,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        refusal: { code: "zero_matches", detailHash: HASH },
        status: "refused",
      },
    },
  );
  state = transition(
    state,
    {
      eventId: "resolve-deferred",
      expectedRevision: state.revision,
      followUpBeadId: "sce-follow-up",
      gateEntryId: resolution.gateEntryId,
      type: "gate_entry_deferred",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  const provenance = state.gate!.provenance!;
  assert.equal(provenance.status, "pending");
  state = transition(
    state,
    {
      eventId: "provenance-clock",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:01Z",
      type: "gate_clock_observed",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  // The provenance intent compacts every observed journal entry, including
  // the refused resolution attempt; the settled resolution must stay valid.
  state = gateIntent(
    state,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  assert.equal(
    state.effectJournal.some(
      (entry) => entry.gateEntryId === resolution.gateEntryId,
    ),
    false,
  );
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(state.gate!.provenance!.currentEffectId !== undefined, true);
  const tampered = {
    ...state,
    gate: {
      ...state.gate!,
      targets: state.gate!.targets.map((target) => ({
        ...target,
        resolution: { ...target.resolution!, currentEffectId: "event-9:x" },
      })),
    },
  } as RepositoryRun;
  assert.ok(
    runInvariantErrors(tampered).some((error) =>
      error.includes("has invalid capacities"),
    ),
  );
});

test("software verification state and legacy command wire remain byte-identical", () => {
  const candidate = completeCandidate();
  const verification = reduce(
    candidate,
    event(candidate, "verification_intent"),
  );
  assert.equal(verification.ok, true);
  if (!verification.ok) return;
  assert.equal(verification.effects.length, 1);
  const effect = verification.effects[0]!;
  assert.equal(effect.kind, "verify");
  if (effect.kind !== "verify") return;
  assert.deepEqual(effect.params.commands, ["npm test"]);
  assert.equal(
    sha256(canonicalJson(effect)),
    "10c057c7aadc4b1d5c270148e1c509f88dc651731f0e6a891f9a14e5c065c0c8",
  );
  assert.equal(
    sha256(
      canonicalJson({
        effects: verification.effects,
        nextState: verification.nextState,
      } as unknown as JsonValue),
    ),
    "448e0ce34d4fe1886b454998afff6c7afbd607b12689cef0f35c1d20969764d4",
  );
});

test("software integrate and release trace preserves projection and recovery bytes", () => {
  let state = run();
  const trace: JsonValue[] = [];
  const applySoftware = (input: ProtocolEvent) => {
    const result = reduce(state, input);
    if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
    trace.push({
      effects: result.effects,
      event: input,
      nextState: result.nextState,
    } as unknown as JsonValue);
    state = result.nextState;
  };
  const softwareStep = (
    type: ProtocolEvent["type"],
    fields: Record<string, unknown> = {},
  ) => applySoftware(event(state, type, fields));
  const softwareObserve = (
    type: ProtocolEvent["type"],
    kind: string,
    fields: Record<string, unknown> = {},
  ) =>
    softwareStep(type, {
      effectId: `event-${state.revision}:${kind}`,
      effectKind: kind,
      observationHash: HASH,
      ...fields,
    });

  softwareStep("reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  softwareObserve("reservation_observed", "reservation_acquire");
  softwareStep("branch_intent", { branchRef: "sce/unit-1" });
  softwareObserve("branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  softwareStep("worktree_intent", { worktreePath: "/tmp/unit-1" });
  softwareObserve("worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  softwareStep("dispatch_intent");
  softwareObserve("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  softwareStep("collect_intent");
  softwareObserve("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  softwareStep("candidate_intent");
  softwareObserve("candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  softwareStep("verification_intent");
  softwareObserve("verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  softwareStep("reviewer_dispatch_intent");
  softwareObserve("reviewer_observed", "review_dispatch", {
    promptHash: HASH,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    sessionId: "reviewer-approved",
  });
  softwareStep("review_collect_intent");
  softwareObserve("review_collected", "review_collect", {
    judgment: {
      aggregateRevision: state.revision,
      baseOid: OID_A,
      decision: "approve",
      findings: [],
      headOid: OID_B,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved exact pair",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-approved",
      treeOid: OID_C,
      unitId: "unit-1",
    },
  });
  softwareStep("publish_intent");
  softwareObserve("publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  softwareStep("integrate_intent");
  softwareObserve("integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  softwareStep("reservation_release_intent");
  softwareObserve("reservation_released", "reservation_release");
  applySoftware({
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    idempotencyKey: deriveIdempotencyKey(
      state,
      state.revision,
      null,
      "controller_release",
    ),
    type: "controller_release_intent",
  });
  applySoftware({
    effectId: `event-${state.revision}:controller_release`,
    effectKind: "controller_release",
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    observationHash: HASH,
    type: "controller_released",
  });

  const root = makeRootProjection(state);
  const children = Object.keys(state.units).flatMap((unitId) => {
    const child = makeChildProjection(root, unitId);
    return child === undefined ? [] : [child];
  });
  assert.equal(state.knowledgeContract, undefined);
  assert.equal(state.gate, undefined);
  assert.equal(
    sha256(canonicalJson(trace)),
    "30b735cc99c78413fb3493bfdbb5012414b13b54a821139076fde4075e586643",
  );
  assert.equal(
    sha256(canonicalJson(state as unknown as JsonValue)),
    "ffce4ae3f112b3ef337fcfafcd1838cea77c926746bd3d725e091c1d6c2b3cdf",
  );
  assert.equal(
    root.aggregateCommitment,
    "4c1aa89cb6df0f4a6d9bd0d08723abf4f5c0bea7c0f06238540a6317776d5b80",
  );
  assert.equal(
    sha256(canonicalJson({ children, root } as unknown as JsonValue)),
    "1be33fae4fad80f5ecbc27b6cd018d846a08c28cf876231d4dd79d8b52095bde",
  );
});

test("hydration binds persisted packets, verification, and reviewer diff metadata", () => {
  const legacy = run();
  const legacyUnit = { ...legacy.units["unit-1"]! };
  delete legacyUnit.taskMetadata;
  const legacyPlanned = {
    ...legacy,
    units: { ...legacy.units, "unit-1": legacyUnit },
  };
  assert.equal(validate(RepositoryRunSchema, legacyPlanned).ok, true);
  assert.deepEqual(runInvariantErrors(legacyPlanned), []);

  const candidate = completeCandidate();
  assert.deepEqual(runInvariantErrors(candidate), []);
  const missingMetadataUnit = { ...candidate.units["unit-1"]! };
  delete missingMetadataUnit.taskMetadata;
  const missingMetadata = {
    ...candidate,
    units: { ...candidate.units, "unit-1": missingMetadataUnit },
  };
  assert.equal(validate(RepositoryRunSchema, missingMetadata).ok, true);
  assert.ok(
    runInvariantErrors(missingMetadata).some((error) =>
      error.includes(
        "worker packet unit-1 launch packet lacks committed wave task metadata",
      ),
    ),
  );
  const mismatchedPacketMetadata = {
    ...candidate,
    units: {
      ...candidate.units,
      "unit-1": {
        ...candidate.units["unit-1"]!,
        taskMetadata: {
          ...candidate.units["unit-1"]!.taskMetadata!,
          ownedPaths: ["totally-different"],
        },
      },
    },
  };
  assert.ok(
    runInvariantErrors(mismatchedPacketMetadata).some((error) =>
      error.includes(
        "worker packet unit-1 launch packet does not bind committed",
      ),
    ),
  );

  const verification = step(candidate, "verification_intent");
  const mismatchedVerification = {
    ...verification,
    units: {
      ...verification.units,
      "unit-1": {
        ...verification.units["unit-1"]!,
        verificationCommands: ["true"],
      },
    },
  };
  assert.ok(
    runInvariantErrors(mismatchedVerification).some((error) =>
      error.includes(
        "verification commands unit-1 verification commands do not match",
      ),
    ),
  );
  const qualified = observe(verification, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  const reviewIntent = step(qualified, "reviewer_dispatch_intent");
  assert.deepEqual(runInvariantErrors(reviewIntent), []);
  const legacyReviewerValue = {
    acceptance: ["acceptance-1"],
    baseOid: OID_A,
    diff: "diff",
    headOid: OID_B,
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src"],
    role: "reviewer",
    schema: "sce.harness-packet",
    unitId: "unit-1",
    version: 1,
  };
  const legacyReviewerPayload = canonicalJson(legacyReviewerValue);
  const legacyReviewerPacket = {
    hash: sha256(`sce.harness-packet/v1\n${legacyReviewerPayload}`),
    payload: legacyReviewerPayload,
    schema: "sce.harness-packet" as const,
    version: 1 as const,
  };
  const hydratedLegacyReviewer = {
    ...reviewIntent,
    units: {
      ...reviewIntent.units,
      "unit-1": {
        ...reviewIntent.units["unit-1"]!,
        reviewerPacket: legacyReviewerPacket,
      },
    },
  };
  assert.equal(validate(RepositoryRunSchema, hydratedLegacyReviewer).ok, true);
  assert.ok(
    runInvariantErrors(hydratedLegacyReviewer).some((error) =>
      error.includes(
        "legacy reviewer packet version 1 embeds diff bytes; regenerate version 2",
      ),
    ),
  );
  const substitutedDiff = {
    ...reviewIntent,
    units: {
      ...reviewIntent.units,
      "unit-1": {
        ...reviewIntent.units["unit-1"]!,
        candidateDiffHash: HASH,
      },
    },
  };
  assert.ok(
    runInvariantErrors(substitutedDiff).some((error) =>
      error.includes(
        "review packet unit-1 review packet is not bound to the exact candidate diff",
      ),
    ),
  );
});

function approvedCandidate(
  authorityProfile: RepositoryRun["authorityProfile"] = "integrate",
  integrationProfile: RepositoryRun["integrationProfile"] = "remote-ff",
  completionBoundary: RepositoryRun["completionBoundary"] = integrationProfile ===
  "local-ff"
    ? "local-integration"
    : integrationProfile === "none"
      ? authorityProfile === "open-pr"
        ? "pr-handoff"
        : "branch-handoff"
      : "remote-integration",
  initial: RepositoryRun = run(),
): RepositoryRun {
  const unitId = initial.wave.unitIds[0] ?? "unit-1";
  let state = {
    ...completeCandidate(initial, unitId),
    authorityProfile,
    completionBoundary,
    integrationProfile,
  };
  state = stepUnit(state, unitId, "verification_intent", {});
  state = observeUnit(state, unitId, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = stepUnit(state, unitId, "reviewer_dispatch_intent", {});
  state = observeUnit(state, unitId, "reviewer_observed", "review_dispatch", {
    sessionId: unitId === "unit-1" ? "reviewer-approved" : `reviewer-${unitId}`,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = stepUnit(state, unitId, "review_collect_intent", {});
  return observeUnit(state, unitId, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId,
      sessionId:
        unitId === "unit-1" ? "reviewer-approved" : `reviewer-${unitId}`,
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "approved exact pair",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
}

type KnowledgeMaterialisationTarget = NonNullable<
  NonNullable<
    RepositoryRun["units"][string]["taskMetadata"]
  >["materialisationTargets"]
>[number];

function landedKnowledgeRun(
  contract: KnowledgeContract,
  unitTarget:
    KnowledgeMaterialisationTarget | readonly KnowledgeMaterialisationTarget[],
): RepositoryRun {
  const initial = run();
  const task = {
    ...initial.units["unit-1"]!.taskMetadata!,
    materialisationTargets: Array.isArray(unitTarget)
      ? [...unitTarget]
      : [unitTarget],
  };
  const drained = { ...initial, wave: { id: "wave-0", unitIds: [] } };
  let state = transition(
    drained,
    {
      eventId: "knowledge-success-wave",
      expectedRevision: drained.revision,
      knowledgeContract: contract,
      tasks: [task],
      type: "wave_planned",
      waveId: "knowledge-success",
    },
    reduce,
  );
  state = approvedCandidate(
    "integrate",
    "remote-ff",
    "remote-integration",
    state,
  );
  state = step(state, "publish_intent");
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent");
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  state = step(state, "reservation_release_intent");
  return observe(state, "reservation_released", "reservation_release");
}

function completeKnowledgeTarget(
  initial: RepositoryRun,
  path: string,
  timestamp: string,
): RepositoryRun {
  let state = clockKnowledgeTarget(initial, path, timestamp);
  const named = state.gate!.targets.find(
    (candidate) => candidate.definition.scope === "unit",
  )!.materialisations[0]!;
  state = gateIntent(
    state,
    "materialise_intent",
    "materialise",
    named.gateEntryId,
  );
  return gateObservation(state, "materialise_observed", named.gateEntryId, {
    result: {
      observation: {
        artifactByteCount: named.source.byteCount,
        artifactSha256: named.source.sha256,
        artifactStatus: "published",
        sidecarByteCount: named.sidecarByteCount,
        sidecarSha256: named.sidecarSha256,
        sidecarStatus: "published",
      },
      status: "observed",
    },
  });
}

function clockKnowledgeTarget(
  initial: RepositoryRun,
  path: string,
  timestamp: string,
): RepositoryRun {
  let state = initial;
  const target = state.gate!.targets.find(
    (candidate) => candidate.definition.scope === "unit",
  )!;
  const resolution = target.resolution!;
  state = gateIntent(
    state,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  state = gateObservation(
    state,
    "materialisation_sources_observed",
    resolution.gateEntryId,
    {
      result: {
        sources: [{ blobOid: OID_B, byteCount: 4, path, sha256: HASH }],
        status: "observed",
      },
    },
  );
  const probe = state.gate!.destinationProbes[0]!;
  state = gateIntent(
    state,
    "destination_probe_intent",
    "destination_probe",
    probe.gateEntryId,
  );
  state = gateObservation(
    state,
    "destination_probe_observed",
    probe.gateEntryId,
    {
      result: {
        identity: {
          canonicalPath: `/mnt/knowledge-drive/${target.definition.target.destinationSubpath}`,
          device: "1",
          inode: "2",
        },
        status: "observed",
      },
    },
  );
  const item = state.gate!.targets[0]!.materialisations[0]!;
  return transition(
    state,
    {
      eventId: `complete-target-clock-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: item.gateEntryId,
      timestamp,
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
}

function completeKnowledgeProvenance(
  initial: RepositoryRun,
  timestamp: string,
): RepositoryRun {
  let state = initial;
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: `complete-provenance-clock-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp,
      type: "gate_clock_observed",
      unitId: null,
    },
    reduce,
  );
  state = gateIntent(
    state,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  state = gateObservation(
    state,
    "provenance_commit_observed",
    provenance.gateEntryId,
    {
      result: {
        attemptedBaseOid: provenance.baseOid,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
    },
  );
  const aggregate = state.gate!.aggregateVerify!;
  state = gateIntent(
    state,
    "verification_intent",
    "verify",
    aggregate.gateEntryId,
    { commands: state.knowledgeContract!.combinedVerificationCommands },
  );
  return gateObservation(
    state,
    "verification_observed",
    aggregate.gateEntryId,
    { baseOid: provenance.baseOid, headOid: OID_B, treeOid: OID_C },
  );
}

function sessionLedger(...sessionIds: readonly string[]): string {
  if (sessionIds.length === 0) return "";
  const bitmapBytes = Math.ceil(sessionIds.length / 8);
  const raw = Buffer.alloc(bitmapBytes + sessionIds.length * 32);
  for (const [index, sessionId] of sessionIds.entries()) {
    raw[Math.floor(index / 8)]! |= 1 << (index % 8);
    Buffer.from(deriveSessionFingerprint(sessionId), "hex").copy(
      raw,
      bitmapBytes + index * 32,
    );
  }
  return raw.toString("base64");
}

function journalEntry(
  entry: Omit<EffectJournalEntry, "intentRevision" | "intentCommitment">,
  intentRevision = 0,
): EffectJournalEntry {
  const withRevision = {
    ...entry,
    intentRevision,
    intentCommitment: "0".repeat(64),
  };
  return {
    ...withRevision,
    intentCommitment: deriveIntentCommitment(withRevision),
  };
}

function withJournalCommitment(
  state: RepositoryRun,
  effectJournal: readonly EffectJournalEntry[],
): RepositoryRun {
  return {
    ...state,
    effectJournal: [...effectJournal],
    journalCommitment: deriveJournalCommitment(
      state.journalCheckpoint.commitment,
      effectJournal,
    ),
  };
}

function mutateDenseClosedEvidence(
  state: RepositoryRun,
  mutate: (dense: { u: Record<string, unknown[]> }) => void,
): RepositoryRun {
  const dense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  mutate(dense);
  const closedUnitEvidence = deflateRawSync(
    Buffer.from(
      canonicalJson(
        dense as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  return {
    ...state,
    closedUnitEvidence,
    closedUnitEvidenceCommitment:
      deriveClosedUnitEvidenceCommitment(closedUnitEvidence),
  };
}

test("crash-safe happy path journals each effect before observing exact facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
  });
  state = observe(state, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "approved exact pair",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  state = step(state, "publish_intent", {
    idempotencyKey: "publish-1",
  });
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent", {
    idempotencyKey: "integrate-1",
  });
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  state = step(state, "reservation_release_intent", {
    idempotencyKey: "release-reservation-1",
  });
  state = observe(state, "reservation_released", "reservation_release");
  assert.equal(state.units["unit-1"], undefined);
  assert.equal(
    state.effectJournal.every((entry) => entry.status === "observed"),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);
  state = transition(
    state,
    {
      eventId: "controller-release",
      expectedRevision: state.revision,
      type: "controller_release_intent",
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "controller_release",
      ),
    },
    reduce,
  );
  state = transition(
    state,
    {
      eventId: "controller-released",
      expectedRevision: state.revision,
      type: "controller_released",
      effectId: "controller-release:controller_release",
      effectKind: "controller_release",
      observationHash: HASH,
    },
    reduce,
  );
  assert.equal(state.state, "released");
});

test("reducer derives executable parameter hashes and rejects forged intent hashes", () => {
  const state = run();
  const input = event(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  assert.equal(
    validate(ProtocolEventSchema, { ...input, paramsHash: HASH }).ok,
    false,
  );
  const result = reduce(state, input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const effect = result.effects[0];
  assert.ok(effect !== undefined);
  assert.equal(effect.paramsHash, deriveParamsHash(effect.kind, effect.params));
  assert.equal(
    result.nextState.effectJournal.at(-1)?.paramsHash,
    effect.paramsHash,
  );
  const tampered = {
    ...result.nextState,
    effectJournal: result.nextState.effectJournal.map((entry) =>
      entry.effectId === effect.effectId
        ? { ...entry, paramsHash: HASH }
        : entry,
    ),
  };
  assert.ok(
    runInvariantErrors(tampered).some((error) =>
      error.includes("invalid params hash"),
    ),
  );
});

test("observations reject wrong kind, stale revision, duplicate IDs, and moved pairs", () => {
  const initial = run();
  const intent = event(initial, "reservation_intent", {
    idempotencyKey: "reserve-1",
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const after = transition(initial, intent, reduce);
  assert.equal(after.effectJournal[0]?.status, "intended");
  const firstReduction = reduce(initial, intent);
  assert.equal(firstReduction.ok, true);
  if (firstReduction.ok) assert.equal(firstReduction.effects.length, 1);
  assert.equal(
    reduce(after, {
      ...intent,
      expectedRevision: initial.revision,
      eventId: "stale",
    }).ok,
    false,
  );
  assert.equal(
    reduce(after, { ...intent, expectedRevision: after.revision }).ok,
    false,
  );
  assert.equal(
    reduce(
      after,
      event(after, "reservation_observed", {
        effectId: "event-1:reservation_acquire",
        effectKind: "branch_create",
        observationHash: HASH,
      }),
    ).ok,
    false,
  );

  const candidate = completeCandidate();
  const moved = {
    ...candidate,
    units: {
      "unit-1": { ...candidate.units["unit-1"]!, candidateHead: OID_C },
    },
  };
  assert.equal(
    reduce(
      moved,
      event(moved, "verification_intent", {
        idempotencyKey: "verify-1",
      }),
    ).ok,
    true,
  );
});

test("verification observations preserve the original base binding", () => {
  let state = completeCandidate();
  const originalBaseOid = state.units["unit-1"]?.baseOid;
  state = step(state, "verification_intent", {});
  const verificationEffect = state.effectJournal.at(-1);
  assert.deepEqual(verificationEffect?.kind, "verify");
  assert.deepEqual(
    reduce(
      state,
      event(state, "verification_observed", {
        effectId: effectId(state, "verify"),
        effectKind: "verify",
        observationHash: HASH,
        baseOid: OID_C,
        headOid: OID_B,
        treeOid: OID_C,
      }),
    ).ok,
    false,
  );
  assert.equal(state.units["unit-1"]?.baseOid, originalBaseOid);

  const exact = reduce(
    state,
    event(state, "verification_observed", {
      effectId: effectId(state, "verify"),
      effectKind: "verify",
      observationHash: HASH,
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
    }),
  );
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.nextState.units["unit-1"]?.baseOid, originalBaseOid);
  assert.equal(
    exact.nextState.units["unit-1"]?.verificationBaseOid,
    originalBaseOid,
  );
});

test("a failed exact verification retains repair evidence and releases qualification", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {});
  const failed = reduce(
    state,
    event(state, "verification_failed", {
      baseOid: OID_A,
      effectId: effectId(state, "verify"),
      effectKind: "verify",
      headOid: OID_B,
      observationHash: HASH,
      treeOid: OID_C,
    }),
  );
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  const unit = failed.nextState.units["unit-1"];
  assert.equal(unit?.state, "repair_required");
  assert.deepEqual(unit?.repairContext, {
    baseOid: OID_A,
    findings: [
      {
        detail: "manual verification failed",
        id: "manual-verification-failed",
        severity: "blocking",
      },
    ],
    headOid: OID_B,
    rationale: "manual verification failed",
    responseHash: HASH,
    treeOid: OID_C,
  });
  assert.equal(failed.nextState.qualificationOwnerUnitId, undefined);
  assert.deepEqual(failed.nextState.qualificationQueue, []);
});

test("review approval binds role, session, exact model, revision, prompt, and Git facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
  });
  const invalid = event(state, "review_collected", {
    effectId: effectId(state, "review_collect"),
    effectKind: "review_collect",
    observationHash: HASH,
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-1",
      requestedModel: "frontier",
      returnedModel: "wrong-model",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "wrong identity",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  assert.equal(reduce(state, invalid).ok, false);
  const movedPair = event(state, "review_collected", {
    effectId: effectId(state, "review_collect"),
    effectKind: "review_collect",
    observationHash: HASH,
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "wrong-session",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "moved pair",
      baseOid: OID_A,
      headOid: OID_C,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  assert.equal(reduce(state, movedPair).ok, false);
  const reviewEvent = invalid as Extract<
    ProtocolEvent,
    { type: "review_collected" }
  >;
  const wrongRole = {
    ...reviewEvent,
    judgment: { ...reviewEvent.judgment, role: "controller" },
  } as unknown as ProtocolEvent;
  assert.equal(reduce(state, wrongRole).ok, false);
});

test("session capacity and persisted aggregate invariants cannot lie", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 7 }), (count) => {
      const units = Array.from({ length: count }, (_, index) => ({
        ...unit(`unit-${index + 1}`, "worktree_observed"),
        branchRef: `sce/unit-${index + 1}`,
        worktreePath: `/tmp/unit-${index + 1}`,
        reservationIds: [`res-${index + 1}`],
      }));
      let state: RepositoryRun = {
        ...run(units),
        reservations: Object.fromEntries(
          units.map((item, index) => [
            `res-${index + 1}`,
            {
              id: `res-${index + 1}`,
              unitId: item.id,
              namespace: "port",
              resource: `${3000 + index}`,
              state: "reserved" as const,
              acquireEffectId: `reserve-${index + 1}`,
            },
          ]),
        ),
        effectJournal: units.map((item, index) =>
          journalEntry({
            effectId: `reserve-${index + 1}`,
            unitId: item.id,
            idempotencyKey: `reserve-key-${index + 1}`,
            kind: "reservation_acquire" as const,
            paramsHash: HASH,
            status: "observed" as const,
            observationHash: HASH,
            schemaVersion: 1 as const,
          }),
        ),
      };
      state = withJournalCommitment(state, state.effectJournal);
      for (const current of units) {
        const result = reduce(
          state,
          event(
            state,
            "dispatch_intent",
            { idempotencyKey: `dispatch-${current.id}` },
            current.id,
          ),
        );
        if (state.activeModifyingUnitIds.length < 3) {
          assert.equal(result.ok, true);
          if (result.ok) state = result.nextState;
        } else assert.equal(result.ok, false);
      }
      assert.ok(state.activeModifyingUnitIds.length <= 3);
      assert.deepEqual(runInvariantErrors(state), []);
    }),
  );
  const lying = { ...run(), activeModifyingUnitIds: ["unit-1"] };
  assert.ok(
    runInvariantErrors(lying).some((error) => error.includes("active-session")),
  );
  assert.ok(
    runInvariantErrors({
      ...run(),
      activeModifyingUnitIds: ["missing-unit"],
    }).some((error) => error.includes("unknown")),
  );
});

test("ambiguous effect blocks instead of retrying and controller release needs legal cleanup", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    idempotencyKey: "reserve-1",
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = step(state, "effect_ambiguous", {
    effectId: "event-1:reservation_acquire",
    effectKind: "reservation_acquire",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(
    reduce(run(), {
      eventId: "release",
      expectedRevision: 0,
      type: "controller_release_intent",
      idempotencyKey: deriveIdempotencyKey(
        run(),
        0,
        null,
        "controller_release",
      ),
    }).ok,
    false,
  );
});

test("hydrated multi-unit ambiguity converges through exact observations", () => {
  const unitIds = ["unit-1", "unit-2", "unit-3"] as const;
  let state = run(unitIds.map((id) => unit(id)));
  const effectIds = new Map<string, string>();
  for (const [index, unitId] of unitIds.entries()) {
    state = stepUnit(state, unitId, "reservation_intent", {
      reservations: [
        {
          id: `res-${index + 1}`,
          namespace: "port",
          resource: `${3001 + index}`,
        },
      ],
    });
    effectIds.set(
      unitId,
      state.effectJournal.at(-1)?.effectId ?? "missing-effect-id",
    );
  }
  const hydratedJournal = state.effectJournal.map((entry) =>
    entry.unitId === "unit-1" || entry.unitId === "unit-2"
      ? { ...entry, status: "ambiguous" as const, observationHash: HASH }
      : entry,
  );
  state = withJournalCommitment(
    {
      ...state,
      state: "blocked",
      units: {
        ...state.units,
        "unit-1": { ...state.units["unit-1"]!, state: "blocked" },
        "unit-2": { ...state.units["unit-2"]!, state: "blocked" },
      },
    },
    hydratedJournal,
  );
  assert.deepEqual(runInvariantErrors(state), []);

  const observeReservation = (unitId: (typeof unitIds)[number]) => {
    state = stepUnit(state, unitId, "reservation_observed", {
      effectId: effectIds.get(unitId),
      effectKind: "reservation_acquire",
      observationHash: HASH,
    });
  };
  // An already-intended sibling may report before either ambiguous effect,
  // then each recovery is applied independently without hiding the other.
  observeReservation("unit-3");
  assert.equal(state.state, "blocked");
  observeReservation("unit-2");
  assert.equal(state.state, "blocked");
  observeReservation("unit-1");
  assert.equal(state.state, "active");
  assert.equal(
    state.effectJournal.every((entry) => entry.status === "observed"),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);
});

test("an ambiguous active terminal effect blocks durably and only its exact observation reconciles", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {});
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-ambiguous",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  const terminal = reduce(state, event(state, "failure_intent", {}));
  assert.equal(terminal.ok, true);
  if (!terminal.ok) return;
  assert.deepEqual(terminal.effects[0]?.params, {
    role: "worker",
    sessionId: "worker-ambiguous",
  });
  state = terminal.nextState;
  assert.deepEqual(state.activeModifyingUnitIds, ["unit-1"]);
  const failureEffectId = effectId(state, "failure");
  state = step(state, "effect_ambiguous", {
    effectId: failureEffectId,
    effectKind: "failure",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(state.units["unit-1"]?.state, "blocked");
  assert.deepEqual(state.activeModifyingUnitIds, ["unit-1"]);
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    reduce(
      state,
      event(state, "failure_observed", {
        effectId: effectId(state, "timeout"),
        effectKind: "timeout",
        observationHash: HASH,
      }),
    ).ok,
    false,
  );
  state = step(state, "failure_observed", {
    effectId: failureEffectId,
    effectKind: "failure",
    observationHash: HASH,
  });
  assert.equal(state.state, "active");
  assert.equal(state.units["unit-1"]?.state, "failed");
  assert.deepEqual(state.activeModifyingUnitIds, []);
});

test("an ambiguous reservation release retains closure lineage and converges on its exact observation", () => {
  let state = approvedCandidate("integrate", "remote-ff", "remote-integration");
  state = step(state, "publish_intent", {});
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent", {});
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  state = step(state, "reservation_release_intent", {});
  const releaseEffectId = effectId(state, "reservation_release");
  state = step(state, "effect_ambiguous", {
    effectId: releaseEffectId,
    effectKind: "reservation_release",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(state.units["unit-1"]?.state, "blocked");
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    legalActions(state).some((action) => action.mode === "emit"),
    false,
  );
  const dense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  const release = ((
    dense.u["unit-1"]?.[9] as unknown[][] | undefined
  )?.[0]?.[4] ?? null) as unknown[] | null;
  assert.equal(release?.[7], "ambiguous");

  state = step(state, "reservation_released", {
    effectId: releaseEffectId,
    effectKind: "reservation_release",
    observationHash: HASH,
  });
  assert.equal(state.state, "active");
  assert.equal(state.units["unit-1"], undefined);
  assert.equal(state.reservations["res-1"], undefined);
  assert.deepEqual(runInvariantErrors(state), []);
});

test("reviewer terminal intents retain ownership until their exact result", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {});
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {});
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-terminal",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  const terminal = reduce(state, event(state, "timeout_intent", {}));
  assert.equal(terminal.ok, true);
  if (!terminal.ok) return;
  assert.deepEqual(terminal.effects[0]?.params, {
    role: "reviewer",
    sessionId: "reviewer-terminal",
  });
  state = terminal.nextState;
  assert.equal(state.currentReviewerUnitId, "unit-1");
  assert.equal(state.qualificationOwnerUnitId, "unit-1");
  state = observe(state, "timeout_observed", "timeout");
  assert.equal(state.currentReviewerUnitId, undefined);
  assert.equal(state.qualificationOwnerUnitId, undefined);
});

test("authority profiles finish honestly at local integration or published handoff", () => {
  let local = approvedCandidate("local-change-only", "local-ff");
  assert.deepEqual(
    local.effectJournal.filter((entry) => entry.kind === "publish"),
    [],
  );
  local = step(local, "integrate_intent", {});
  assert.equal(local.effectJournal.at(-1)?.kind, "integrate");
  local = observe(local, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  assert.equal(local.units["unit-1"]?.state, "landed");

  let openPrIntent = approvedCandidate("open-pr", "none");
  openPrIntent = step(openPrIntent, "publish_intent", {});
  assert.equal(
    reduce(
      openPrIntent,
      event(openPrIntent, "publish_observed", {
        effectId: effectId(openPrIntent, "publish"),
        effectKind: "publish",
        observationHash: HASH,
        publication: { kind: "push_branch", remoteHeadOid: OID_B },
      }),
    ).ok,
    false,
  );

  for (const profile of ["push-branch", "open-pr"] as const) {
    let handoff = approvedCandidate(profile, "none");
    handoff = step(handoff, "publish_intent", {});
    handoff = observe(handoff, "publish_observed", "publish", {
      publication:
        profile === "open-pr"
          ? {
              kind: "open_pr",
              pullRequest: {
                providerPrId: "pr-1",
                state: "open",
                baseRef: "main",
                baseOid: OID_A,
                remoteHeadOid: OID_B,
              },
            }
          : { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(handoff.units["unit-1"]?.state, "handoff");
    if (profile === "open-pr")
      assert.deepEqual(handoff.units["unit-1"]?.openPullRequest, {
        providerPrId: "pr-1",
        state: "open",
        baseRef: "main",
        baseOid: OID_A,
        remoteHeadOid: OID_B,
      });
    assert.equal(handoff.units["unit-1"]?.landedOid, undefined);
    assert.equal(handoff.integrationQueue.length, 0);
    assert.equal(
      reduce(handoff, event(handoff, "integrate_intent", {})).ok,
      false,
    );
    handoff = step(handoff, "reservation_release_intent", {});
    handoff = observe(handoff, "reservation_released", "reservation_release");
    assert.equal(handoff.units["unit-1"], undefined);
  }
});

test("completion boundaries are monotone under broader authority grants", () => {
  const localProfiles: readonly RepositoryRun["authorityProfile"][] = [
    "local-change-only",
    "push-branch",
    "open-pr",
    "integrate",
  ];
  for (const authorityProfile of localProfiles) {
    const state = approvedCandidate(
      authorityProfile,
      "local-ff",
      "local-integration",
    );
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      true,
    );
  }

  const branchProfiles: readonly RepositoryRun["authorityProfile"][] = [
    "push-branch",
    "open-pr",
    "integrate",
  ];
  for (const authorityProfile of branchProfiles) {
    let state = approvedCandidate(authorityProfile, "none", "branch-handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(state.units["unit-1"]?.state, "handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      false,
    );
  }

  for (const authorityProfile of ["open-pr", "integrate"] as const) {
    let state = approvedCandidate(authorityProfile, "none", "pr-handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: {
        kind: "open_pr",
        pullRequest: {
          providerPrId: "pr-1",
          state: "open",
          baseRef: "main",
          baseOid: OID_A,
          remoteHeadOid: OID_B,
        },
      },
    });
    assert.equal(state.units["unit-1"]?.state, "handoff");
  }

  for (const integrationProfile of ["remote-ff"] as const) {
    let state = approvedCandidate(
      "integrate",
      integrationProfile,
      "remote-integration",
    );
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      true,
    );
  }

  for (const invalid of [
    {
      authorityProfile: "local-change-only",
      completionBoundary: "branch-handoff",
      integrationProfile: "none",
    },
    {
      authorityProfile: "push-branch",
      completionBoundary: "pr-handoff",
      integrationProfile: "none",
    },
    {
      authorityProfile: "integrate",
      completionBoundary: "remote-integration",
      integrationProfile: "none",
    },
    {
      authorityProfile: "open-pr",
      completionBoundary: "remote-integration",
      integrationProfile: "remote-ff",
    },
  ] as const) {
    const state = { ...run(), ...invalid };
    assert.ok(runInvariantErrors(state).length > 0);
    assert.deepEqual(legalActions(state), []);
  }
});

test("real old-to-repair-current lineage rejects same-count substitution and old replay", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {});
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-repair-result",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  state = step(state, "collect_intent", {});
  const collecting = state;
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: {
      status: "needs_repair",
      summary: "test failure needs repair",
      residualRisks: ["fixture remains stale"],
      suggestedFollowUps: ["split fixture cleanup into a separate Bead"],
    },
  });
  assert.equal(state.units["unit-1"]?.state, "repair_required");
  assert.deepEqual(state.units["unit-1"]?.workerResult?.suggestedFollowUps, [
    "split fixture cleanup into a separate Bead",
  ]);
  assert.equal(state.qualificationQueue.length, 0);
  const failed = observe(collecting, "worker_collected", "worker_collect", {
    workerResult: {
      status: "failed",
      summary: "worker process exited without a candidate",
      residualRisks: ["candidate state is unknown"],
      suggestedFollowUps: ["inspect the preserved worktree"],
    },
  });
  assert.equal(failed.units["unit-1"]?.state, "failed");
  assert.equal(failed.units["unit-1"]?.workerResult?.status, "failed");
  assert.equal(
    failed.units["unit-1"]?.repairContext?.rationale,
    "worker process exited without a candidate",
  );
  assert.deepEqual(failed.activeModifyingUnitIds, []);
  assert.deepEqual(runInvariantErrors(failed), []);
  state = step(state, "repair_intent", {
    judgment: {
      schemaVersion: 1,
      role: "controller",
      kind: "repair_disposition",
      unitId: "unit-1",
      sessionId: "incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "repair the returned failure",
      factOid: OID_A,
      decision: "repair",
      ...repairEvidence(state),
    },
  });
  assert.equal(hasUsedSession(state, "worker-repair-result"), true);
  assert.equal(hasUsedSession(state, "never-dispatched-session"), false);
  assert.equal(
    reduce(
      state,
      event(state, "repair_observed", {
        effectId: effectId(state, "repair"),
        effectKind: "repair",
        observationHash: HASH,
        sessionId: "worker-repair-result",
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );

  // This is the real overwrite path: the old worker session leaves the live
  // unit when a repair worker takes over, but must remain retained exactly.
  state = observe(state, "repair_observed", "repair", {
    sessionId: "worker-repair-current",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  assert.equal(state.units["unit-1"]?.workerSessionId, "worker-repair-current");
  assert.equal(state.usedSessionCount, 2);
  const sameCountSubstitution = {
    ...state,
    // Same count, but old history is substituted for an unrelated digest
    // while the independently anchored lineage root remains untouched.
    sessionLineage: sessionLedger(
      "worker-repair-current",
      "unrelated-substitution",
    ),
  };
  assert.equal(sameCountSubstitution.usedSessionCount, 2);
  assert.equal(
    sameCountSubstitution.sessionLineageRoot,
    state.sessionLineageRoot,
  );
  assert.ok(
    runInvariantErrors(sameCountSubstitution).some((error) =>
      error.includes("session lineage root"),
    ),
  );

  state = step(state, "collect_intent", {});
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: {
      status: "completed",
      summary: "repaired",
      residualRisks: [],
    },
  });
  state = step(state, "candidate_intent", {});
  state = observe(state, "candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "verification_intent", {});
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {});
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-after-repair",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {});
  state = observe(state, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-after-repair",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "one more repair",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "request_changes",
      findings: [{ id: "finding-1", severity: "blocking", detail: "fix" }],
    },
  });
  state = step(state, "repair_intent", {
    judgment: {
      schemaVersion: 1,
      role: "controller",
      kind: "repair_disposition",
      unitId: "unit-1",
      sessionId: "incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "repair again",
      factOid: OID_B,
      decision: "repair",
      ...repairEvidence(state),
    },
  });
  assert.equal(state.units["unit-1"]?.workerSessionId, "worker-repair-current");
  assert.equal(state.usedSessionCount, 3);
  assert.equal(
    reduce(
      state,
      event(state, "repair_observed", {
        effectId: effectId(state, "repair"),
        effectKind: "repair",
        observationHash: HASH,
        sessionId: "worker-repair-result",
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );
});

test("repair is disposition-bound and bounded before any sixteenth retry emits", () => {
  const limited = run([
    {
      ...unit("unit-1", "repair_required"),
      branchRef: "sce/unit-1",
      worktreePath: "/tmp/unit-1",
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairCount: 16,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "blocking review",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const result = reduce(
    limited,
    event(limited, "repair_intent", {
      idempotencyKey: "repair-17",
      requestedModel: "workhorse",
      promptHash: HASH,
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "incarnation-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 0,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "repair",
        factOid: OID_B,
        decision: "repair",
        ...repairEvidence(limited),
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("repair disposition binds the controller incarnation, model, and current evidence", () => {
  const repairable = run([
    {
      ...unit("unit-1", "repair_required"),
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "blocking review",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const result = reduce(
    repairable,
    event(repairable, "repair_intent", {
      idempotencyKey: "repair-1",
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "wrong-incarnation",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 0,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "repair",
        factOid: OID_B,
        decision: "repair",
        ...repairEvidence(repairable),
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("repair disposition binds current context without reusing the initial prompt", () => {
  const repairable = run([
    {
      ...unit("unit-1", "repair_required"),
      branchRef: "sce/unit-1",
      worktreePath: "/tmp/unit-1",
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "fresh review evidence",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const judgment = {
    schemaVersion: 1,
    role: "controller" as const,
    kind: "repair_disposition" as const,
    unitId: "unit-1",
    sessionId: "incarnation-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    aggregateRevision: repairable.revision,
    // A repair packet has its own prompt; it is deliberately not compared to
    // the immutable controller-acquisition prompt.
    promptHash: "e".repeat(64),
    responseHash: HASH,
    rationale: "repair current evidence",
    factOid: OID_B,
    decision: "repair" as const,
    ...repairEvidence(repairable),
  };
  assert.equal(
    reduce(repairable, event(repairable, "repair_intent", { judgment })).ok,
    true,
  );
  const validEvent = event(repairable, "repair_intent", { judgment });
  if (validEvent.type !== "repair_intent") throw new Error("missing repair");
  assert.equal(
    validEvent.judgment.promptHash,
    deriveRepairJudgmentPromptHash(
      repairable,
      repairable.units["unit-1"]!,
      validEvent.judgment,
    ),
  );
  assert.equal(
    validEvent.judgment.responseHash,
    deriveRepairJudgmentResponseHash(validEvent.judgment),
  );
  for (const output of [
    { ...validEvent.judgment, rationale: "different controller rationale" },
    { ...validEvent.judgment, decision: "cancel" },
  ] as const) {
    const outputJudgment = output as Extract<
      ProtocolEvent,
      { type: "repair_intent" }
    >["judgment"];
    assert.equal(
      deriveRepairJudgmentPromptHash(
        repairable,
        repairable.units["unit-1"]!,
        outputJudgment,
      ),
      validEvent.judgment.promptHash,
    );
    assert.notEqual(
      deriveRepairJudgmentResponseHash(outputJudgment),
      validEvent.judgment.responseHash,
    );
  }
  for (const input of [
    { ...validEvent.judgment, factOid: OID_A },
    { ...validEvent.judgment, currentEvidenceHash: "f".repeat(64) },
    { ...validEvent.judgment, findingsContextHash: "f".repeat(64) },
  ])
    assert.notEqual(
      deriveRepairJudgmentPromptHash(
        repairable,
        repairable.units["unit-1"]!,
        input,
      ),
      validEvent.judgment.promptHash,
    );
  assert.notEqual(validEvent.promptHash, validEvent.judgment.promptHash);
  assert.notEqual(
    deriveRepairJudgmentPromptHash(
      { ...repairable, integrationBranch: "different-branch" },
      repairable.units["unit-1"]!,
      validEvent.judgment,
    ),
    validEvent.judgment.promptHash,
  );
  assert.equal(
    reduce({ ...repairable, integrationBranch: "different-branch" }, validEvent)
      .ok,
    false,
  );
  assert.equal(
    reduce(repairable, {
      ...validEvent,
      promptHash: "c".repeat(64),
    }).ok,
    false,
  );
  for (const field of ["promptHash", "responseHash"] as const)
    assert.equal(
      reduce(repairable, {
        ...validEvent,
        judgment: { ...validEvent.judgment, [field]: "f".repeat(64) },
      }).ok,
      false,
    );
  assert.equal(
    reduce(
      repairable,
      event(repairable, "repair_intent", {
        judgment: { ...judgment, currentEvidenceHash: "f".repeat(64) },
      }),
    ).ok,
    false,
  );
  assert.equal(
    reduce(
      repairable,
      event(repairable, "repair_intent", {
        judgment: { ...judgment, findingsContextHash: "f".repeat(64) },
      }),
    ).ok,
    false,
  );
});

test("journal checkpoint compacts completed entries while retained idempotency evidence rejects replay", () => {
  const completed = Array.from({ length: 256 }, (_, index) =>
    journalEntry({
      effectId: `effect-${index}`,
      unitId: "unit-1",
      idempotencyKey: `key-${index}`,
      kind: "candidate_collect" as const,
      paramsHash: HASH,
      status: "observed" as const,
      observationHash: HASH,
      schemaVersion: 1 as const,
    }),
  );
  const initial = withJournalCommitment(
    {
      ...run(),
      processedIdempotencyKeys: completed.map((entry) => entry.idempotencyKey),
    },
    completed,
  );
  const next = reduce(
    initial,
    event(initial, "reservation_intent", {
      idempotencyKey: "reserve-after-checkpoint",
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    }),
  );
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.nextState.journalCheckpoint.compactedEffects, 256);
  assert.equal(
    reduce(
      next.nextState,
      event(next.nextState, "reservation_intent", {
        idempotencyKey: "key-1",
        reservations: [{ id: "res-2", namespace: "port", resource: "3002" }],
      }),
    ).ok,
    false,
  );
});

test("journal commitment rejects exact observed-field mutation before and after checkpointing", () => {
  const state = completeCandidate();
  const observedIndex = state.effectJournal.findIndex(
    (entry) => entry.status === "observed",
  );
  assert.notEqual(observedIndex, -1);
  const mutations: ReadonlyArray<
    (entry: EffectJournalEntry) => EffectJournalEntry
  > = [
    (entry) => ({ ...entry, paramsHash: "1".repeat(64) }),
    (entry) => ({ ...entry, idempotencyKey: "mutated-idempotency" }),
    (entry) => ({ ...entry, kind: "verify" }),
    ({ observationHash: _observationHash, ...entry }) => ({
      ...entry,
      status: "intended",
    }),
    (entry) => ({ ...entry, observationHash: "2".repeat(64) }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const effectJournal = [...state.effectJournal];
    const entry = effectJournal[observedIndex];
    if (entry === undefined) throw new Error("missing observed journal entry");
    effectJournal[observedIndex] = mutate(entry);
    const errors = runInvariantErrors({ ...state, effectJournal });
    assert.ok(
      errors.some(
        (error) =>
          error.includes("journal commitment") ||
          error.includes("invalid intent commitment"),
      ),
      `mutation ${index}: ${errors.join("; ")}`,
    );
  }

  const checkpointed = step(state, "verification_intent", {});
  assert.ok(checkpointed.journalCheckpoint.compactedEffects > 0);
  assert.ok(
    runInvariantErrors({
      ...checkpointed,
      journalCheckpoint: {
        ...checkpointed.journalCheckpoint,
        commitment: "3".repeat(64),
      },
    }).some((error) => error.includes("journal commitment")),
  );
});

test("event and idempotency history checkpoints stay bounded past 512 events while old replay is stale", () => {
  const history = Array.from(
    { length: 256 },
    (_, index) => `old-event-${index}`,
  );
  const keys = Array.from({ length: 256 }, (_, index) => `old-key-${index}`);
  const checkpointed = {
    ...run(),
    revision: 512,
    processedEventIds: history,
    processedIdempotencyKeys: keys,
  };
  const next = reduce(
    checkpointed,
    event(checkpointed, "reservation_intent", {
      idempotencyKey: "new-key",
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    }),
  );
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.nextState.processedEventIds.length, 256);
  assert.equal(next.nextState.processedIdempotencyKeys.length, 256);
  assert.equal(next.nextState.journalCheckpoint.compactedEvents, 1);
  assert.equal(next.nextState.journalCheckpoint.compactedIdempotencyKeys, 1);
  assert.equal(
    reduce(next.nextState, {
      eventId: "old-event-0",
      expectedRevision: 512,
      unitId: "unit-1",
      type: "reservation_intent",
      idempotencyKey: "old-key-0",
      reservations: [{ id: "res-2", namespace: "port", resource: "3002" }],
    }).ok,
    false,
  );
});

test("an evicted effect key cannot be replayed for another unit at the current revision", () => {
  const replay = {
    ...run([
      {
        ...unit("unit-1", "repair_required"),
        candidateHead: OID_B,
        candidateTree: OID_C,
        repairCount: 1,
        repairContext: {
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
          responseHash: HASH,
          rationale: "prior repair",
          findings: [
            { id: "finding-1", severity: "blocking", detail: "repair" },
          ],
        },
      },
    ]),
    revision: 600,
    processedEventIds: Array.from(
      { length: 256 },
      (_, index) => `event-${index + 344}`,
    ),
    processedIdempotencyKeys: Array.from(
      { length: 256 },
      (_, index) => `key-${index + 344}`,
    ),
    journalCheckpoint: {
      revision: 600,
      compactedEffects: 256,
      compactedEvents: 344,
      compactedIdempotencyKeys: 344,
      commitment: "0".repeat(64),
    },
    journalCommitment: "0".repeat(64),
  };
  assert.equal(
    reduce(replay, {
      eventId: "event-new-unit",
      expectedRevision: 600,
      unitId: "unit-1",
      type: "repair_intent",
      // This key was emitted at revision 344, then checkpointed. It cannot
      // be used by any current-revision effect, even on a different unit.
      idempotencyKey: deriveIdempotencyKey(replay, 344, "unit-2", "repair"),
      packet: (
        event(replay, "repair_intent") as Extract<
          ProtocolEvent,
          { type: "repair_intent" }
        >
      ).packet,
      requestedModel: "workhorse",
      promptHash: HASH,
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "incarnation-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 600,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "replay",
        factOid: OID_B,
        decision: "repair",
        ...repairEvidence(replay),
      },
    }).ok,
    false,
  );
});

test("intent idempotency digest rejects domain, revision, unit, and kind substitutions", () => {
  const state = run();
  const substitutions = [
    deriveIdempotencyKey(
      { controller: { ...state.controller, runId: "other-run" } },
      0,
      "unit-1",
      "reservation_acquire",
    ),
    deriveIdempotencyKey(state, 1, "unit-1", "reservation_acquire"),
    deriveIdempotencyKey(state, 0, "unit-2", "reservation_acquire"),
    deriveIdempotencyKey(state, 0, "unit-1", "branch_create"),
  ];
  for (const [index, idempotencyKey] of substitutions.entries()) {
    const result = reduce(state, {
      eventId: `substitution-${index}`,
      expectedRevision: 0,
      unitId: "unit-1",
      type: "reservation_intent",
      idempotencyKey,
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_event");
  }
});

test("64 retained units complete 16 repairs in waves of at most three within the envelope", () => {
  let state = run(
    Array.from({ length: LIMITS.units }, (_, index) => ({
      ...unit(`unit-${index + 1}`, "repair_required"),
      branchRef: `sce/unit-${index + 1}`,
      worktreePath: `/tmp/unit-${index + 1}`,
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "initial blocking finding",
        findings: [
          { id: "finding-1", severity: "blocking" as const, detail: "fix" },
        ],
      },
    })),
  );

  const unitIds = Object.keys(state.units).sort();
  for (let waveStart = 0; waveStart < unitIds.length; waveStart += 3) {
    const currentWave = unitIds.slice(waveStart, waveStart + 3);
    if (waveStart > 0) {
      assert.equal(
        unitIds
          .slice(waveStart - 3, waveStart)
          .every((unitId) => state.units[unitId] === undefined),
        true,
      );
      // Phase 1 deliberately has no wave-planning command. This is the
      // controller-authored snapshot that Phase 3 will persist through its
      // planning act, after the prior wave has drained and closed.
      state = {
        ...state,
        wave: { id: `wave-${waveStart / 3 + 1}`, unitIds: currentWave },
      };
      assert.deepEqual(runInvariantErrors(state), []);
    }
    for (const unitId of currentWave) {
      for (let attempt = 1; attempt <= 16; attempt += 1) {
        state = stepUnit(state, unitId, "repair_intent", {
          judgment: {
            schemaVersion: 1,
            role: "controller",
            kind: "repair_disposition",
            unitId,
            sessionId: "incarnation-1",
            requestedModel: "frontier",
            returnedModel: "frontier-1",
            aggregateRevision: state.revision,
            promptHash: HASH,
            responseHash: HASH,
            rationale: `repair ${attempt}`,
            factOid: OID_B,
            decision: "repair",
            ...repairEvidence(state, unitId),
          },
        });
        state = observeUnit(state, unitId, "repair_observed", "repair", {
          sessionId: `worker-${unitId}-${attempt}`,
          requestedModel: "workhorse",
          returnedModel: "workhorse-1",
          promptHash: HASH,
        });
        state = stepUnit(state, unitId, "collect_intent", {});
        state = observeUnit(
          state,
          unitId,
          "worker_collected",
          "worker_collect",
          {
            workerResult: {
              status: "completed",
              summary: "done",
              residualRisks: [],
            },
          },
        );
        state = stepUnit(state, unitId, "candidate_intent", {});
        state = observeUnit(
          state,
          unitId,
          "candidate_observed",
          "candidate_collect",
          {
            headOid: OID_B,
            treeOid: OID_C,
          },
        );
        state = stepUnit(state, unitId, "verification_intent", {});
        state = observeUnit(state, unitId, "verification_observed", "verify", {
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
        });
        state = stepUnit(state, unitId, "reviewer_dispatch_intent", {});
        state = observeUnit(
          state,
          unitId,
          "reviewer_observed",
          "review_dispatch",
          {
            sessionId: `reviewer-${unitId}-${attempt}`,
            requestedModel: "frontier",
            returnedModel: "frontier-1",
            promptHash: HASH,
          },
        );
        state = stepUnit(state, unitId, "review_collect_intent", {});
        state = observeUnit(
          state,
          unitId,
          "review_collected",
          "review_collect",
          {
            judgment: {
              schemaVersion: 1,
              role: "reviewer",
              kind: "review_verdict",
              unitId,
              sessionId: `reviewer-${unitId}-${attempt}`,
              requestedModel: "frontier",
              returnedModel: "frontier-1",
              aggregateRevision: state.revision,
              promptHash: HASH,
              responseHash: HASH,
              rationale: `changes ${attempt}`,
              baseOid: OID_A,
              headOid: OID_B,
              treeOid: OID_C,
              decision: "request_changes",
              findings: [
                { id: "finding-1", severity: "blocking", detail: "fix" },
              ],
            },
          },
        );
      }
      assert.equal(state.units[unitId]?.repairCount, 16);
      assert.equal(
        reduce(
          state,
          event(
            state,
            "repair_intent",
            {
              judgment: {
                schemaVersion: 1,
                role: "controller",
                kind: "repair_disposition",
                unitId,
                sessionId: "incarnation-1",
                requestedModel: "frontier",
                returnedModel: "frontier-1",
                aggregateRevision: state.revision,
                promptHash: HASH,
                responseHash: HASH,
                rationale: "seventeenth repair",
                factOid: OID_B,
                decision: "repair",
                ...repairEvidence(state, unitId),
              },
            },
            unitId,
          ),
        ).ok,
        false,
      );
      state = stepUnit(state, unitId, "park_intent", {});
      state = observeUnit(state, unitId, "park_observed", "park");
      state = stepUnit(state, unitId, "reservation_release_intent", {});
      state = observeUnit(
        state,
        unitId,
        "reservation_released",
        "reservation_release",
      );
    }
  }

  const envelope = {
    schema: "sce.repository-run" as const,
    version: 1 as const,
    payload: state,
  };
  assert.equal(validate(RepositoryRunEnvelopeSchema, envelope).ok, true);
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(Object.keys(state.units).length === 0, true);
  assert.ok(state.journalCheckpoint.compactedEffects > 0);
  assert.ok(state.journalCheckpoint.compactedEvents > 0);
  assert.ok(state.journalCheckpoint.compactedIdempotencyKeys > 0);
  assert.equal(
    sessionLineageCount(state.sessionLineage),
    LIMITS.units * 16 * 2,
  );
  assert.equal(state.usedSessionCount, LIMITS.units * 16 * 2);
  assert.equal(Buffer.from(state.sessionLineage, "base64").length, 69_872);
  for (const unitId of unitIds)
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      assert.equal(hasUsedSession(state, `worker-${unitId}-${attempt}`), true);
      assert.equal(
        hasUsedSession(state, `reviewer-${unitId}-${attempt}`),
        true,
      );
    }
  assert.equal(hasUsedSession(state, "fresh-after-bounded-trace"), false);
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  assert.ok(
    envelopeBytes <= LIMITS.envelopeBytes,
    `envelope is ${envelopeBytes} bytes; limit is ${LIMITS.envelopeBytes}`,
  );
});

test("hydration rejects fabricated reservation lineage and active parking remains slot-consistent", () => {
  const fabricated = {
    ...run([
      { ...unit("unit-1", "resources_reserved"), reservationIds: ["res-1"] },
    ]),
    reservations: {
      "res-1": {
        id: "res-1",
        unitId: "unit-1",
        namespace: "port",
        resource: "3001",
        state: "reserved" as const,
        acquireEffectId: "invented",
      },
    },
  };
  assert.ok(
    runInvariantErrors(fabricated).some((error) =>
      error.includes("exact acquisition"),
    ),
  );
  const parked = {
    ...run([{ ...unit("unit-1", "park_intent"), reservationIds: [] }]),
    activeModifyingUnitIds: ["unit-1"],
  };
  assert.ok(
    runInvariantErrors(parked).some((error) =>
      error.includes("one exact unresolved effect"),
    ),
  );
  const corruptSessionLineage = {
    ...run(),
    sessionLineage: "AA==",
  };
  assert.ok(
    runInvariantErrors(corruptSessionLineage).some((error) =>
      error.includes("session lineage ledger"),
    ),
  );
  const nonCanonicalSessionLineage = {
    ...run(),
    sessionLineage: "AAAA",
  };
  assert.ok(
    runInvariantErrors(nonCanonicalSessionLineage).some((error) =>
      error.includes("session lineage ledger"),
    ),
  );
});

test("session fingerprint ledgers retain exact history and reject forged Bloom-era state", () => {
  const sessions = ["worker-old", "worker-new", "reviewer-old"] as const;
  const state = {
    ...run(),
    usedSessionCount: sessions.length,
    sessionLineage: sessionLedger(...sessions),
    sessionLineageRoot: deriveSessionLineageRoot(
      sessionLedger(...sessions),
      sessions.length,
    ),
  };
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(sessionLineageCount(state.sessionLineage), sessions.length);
  for (const sessionId of sessions)
    assert.equal(hasUsedSession(state, sessionId), true);
  assert.equal(hasUsedSession(state, "fresh-session"), false);

  const duplicated = Buffer.concat([
    Buffer.from(deriveSessionFingerprint("worker-old"), "hex"),
    Buffer.from(deriveSessionFingerprint("worker-old"), "hex"),
  ]).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...run(),
      usedSessionCount: 2,
      sessionLineage: duplicated,
    }).some((error) => error.includes("session lineage ledger")),
  );
  assert.ok(
    runInvariantErrors({
      ...run(),
      usedSessionCount: sessions.length,
      sessionLineage: sessionLedger(...sessions)
        .split("")
        .reverse()
        .join(""),
    }).some((error) => error.includes("session lineage ledger")),
  );

  // The former independently forgeable count/filter/hash triplet is not part
  // of the schema, so this exact historical-reuse counterexample now fails
  // before a reducer can treat its nonzero count as meaningful history.
  const bloomEraForgery = {
    ...run(),
    usedSessionFilter: Buffer.alloc(8_192, 1).toString("base64"),
    usedSessionFilterHash: HASH,
  };
  assert.equal(validate(RepositoryRunSchema, bloomEraForgery).ok, false);
});

test("closed evidence is canonical, bounded, and retains released reservation lineage", () => {
  let state = approvedCandidate("integrate", "remote-ff", "remote-integration");
  state = step(state, "publish_intent", {});
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent", {});
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  assert.ok(state.closedUnitEvidence.length > 0);
  assert.ok(
    runInvariantErrors(
      mutateDenseClosedEvidence(state, (dense) => {
        // Slot 4 is deliberately absent until the live unit has released.
        dense.u["unit-1"]![4] = 0;
      }),
    ).some((error) => error.includes("duplicates authoritative repair count")),
  );
  state = step(state, "reservation_release_intent", {});
  const releaseIntentDense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  assert.equal(releaseIntentDense.u["unit-1"]?.[4], null);
  state = observe(state, "reservation_released", "reservation_release");
  assert.deepEqual(runInvariantErrors(state), []);
  assert.notEqual(state.closedUnitEvidence, "");

  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: state.closedUnitEvidence.slice(0, -1),
    }).some((error) => error.includes("closed unit evidence ledger")),
  );

  const decoded = inflateRawSync(
    Buffer.from(state.closedUnitEvidence, "base64"),
  ).toString("utf8");
  const missingReleasedReservation = JSON.parse(decoded) as {
    u: Record<string, unknown[]>;
  };
  const denseReservations = missingReleasedReservation.u["unit-1"]?.[9] as
    unknown[][] | undefined;
  if (denseReservations?.[0] === undefined)
    throw new Error("missing dense reservation");
  assert.ok(
    runInvariantErrors(
      mutateDenseClosedEvidence(state, (dense) => {
        // Fixed-width compact reservation tuple: acquire is slot 3.
        (dense.u["unit-1"]![9] as unknown[][])[0]![3] = null;
      }),
    ).some((error) => error.includes("closed unit evidence ledger")),
  );
  // Fixed-width compact reservation tuple: release is slot 4.
  denseReservations[0][4] = null;
  const missingReleasedReservationLedger = deflateRawSync(
    Buffer.from(
      canonicalJson(
        missingReleasedReservation as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: missingReleasedReservationLedger,
    }).some((error) => error.includes("reservation")),
  );
  const alternateCompression = deflateRawSync(Buffer.from(decoded, "utf8"), {
    level: 0,
  }).toString("base64");
  assert.notEqual(alternateCompression, state.closedUnitEvidence);
  assert.equal(
    deriveClosedUnitEvidenceCommitment(alternateCompression),
    state.closedUnitEvidenceCommitment,
  );
  assert.deepEqual(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: alternateCompression,
      closedUnitEvidenceCommitment:
        deriveClosedUnitEvidenceCommitment(alternateCompression),
    }),
    [],
  );

  // zlib level 0 golden vector for canonical `{"u":{},"v":1}`. This is
  // semantically the same empty ledger as the canonical empty-string form.
  const alternateEmptyGolden = "AQ4A8f97InUiOnt9LCJ2IjoxfQ==";
  assert.deepEqual(
    runInvariantErrors({
      ...run(),
      closedUnitEvidence: alternateEmptyGolden,
      closedUnitEvidenceCommitment:
        deriveClosedUnitEvidenceCommitment(alternateEmptyGolden),
    }),
    [],
  );
  const trailingCompressedInput = Buffer.concat([
    Buffer.from(state.closedUnitEvidence, "base64"),
    Buffer.from([0]),
  ]).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: trailingCompressedInput,
    }).some((error) => error.includes("closed unit evidence ledger")),
  );

  const oversized = deflateRawSync(
    Buffer.alloc(LIMITS.envelopeBytes + 1, 0),
  ).toString("base64");
  assert.ok(
    runInvariantErrors({ ...state, closedUnitEvidence: oversized }).some(
      (error) => error.includes("closed unit evidence ledger"),
    ),
  );
  const unknownFacts = JSON.parse(decoded) as {
    u: Record<string, unknown[]>;
  };
  unknownFacts.u["unit-1"]?.push("secret-shaped-accidental-payload");
  const unknownFactLedger = deflateRawSync(
    Buffer.from(
      canonicalJson(
        unknownFacts as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: unknownFactLedger,
    }).some((error) => error.includes("closed unit evidence ledger")),
  );
});

test("every closure outcome has exact discriminated facts and one final repair count", () => {
  const release = (state: RepositoryRun) =>
    observe(
      step(state, "reservation_release_intent", {}),
      "reservation_released",
      "reservation_release",
    );
  const successful = (boundary: "landed" | "branch_handoff" | "pr_handoff") => {
    if (boundary === "landed") {
      let state = approvedCandidate(
        "integrate",
        "remote-ff",
        "remote-integration",
      );
      state = step(state, "publish_intent", {});
      state = observe(state, "publish_observed", "publish", {
        publication: { kind: "push_branch", remoteHeadOid: OID_B },
      });
      state = step(state, "integrate_intent", {});
      state = observe(state, "integrate_observed", "integrate", {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        integrationOid: OID_C,
        controllerFencingToken: "fence-1",
      });
      return release(state);
    }
    let state = approvedCandidate(
      boundary === "pr_handoff" ? "open-pr" : "push-branch",
      "none",
      boundary === "pr_handoff" ? "pr-handoff" : "branch-handoff",
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication:
        boundary === "pr_handoff"
          ? {
              kind: "open_pr",
              pullRequest: {
                providerPrId: "pr-closure",
                state: "open",
                baseRef: "main",
                baseOid: OID_A,
                remoteHeadOid: OID_B,
              },
            }
          : { kind: "push_branch", remoteHeadOid: OID_B },
    });
    return release(state);
  };
  const negative = (
    outcome: "failed" | "timed_out" | "parked" | "cancelled",
  ) => {
    const intent = {
      failed: "failure_intent",
      timed_out: "timeout_intent",
      parked: "park_intent",
      cancelled: "cancel_intent",
    } as const;
    const observed = {
      failed: "failure_observed",
      timed_out: "timeout_observed",
      parked: "park_observed",
      cancelled: "cancel_observed",
    } as const;
    const kind = {
      failed: "failure",
      timed_out: "timeout",
      parked: "park",
      cancelled: "cancel",
    } as const;
    let state = completeCandidate();
    state = step(state, intent[outcome], {});
    state = observe(state, observed[outcome], kind[outcome]);
    return release(state);
  };
  const cases: ReadonlyArray<{
    readonly outcome: string;
    readonly state: RepositoryRun;
  }> = [
    ...(["landed", "branch_handoff", "pr_handoff"] as const).map((outcome) => ({
      outcome,
      state: successful(outcome),
    })),
    ...(["failed", "timed_out", "parked", "cancelled"] as const).map(
      (outcome) => ({ outcome, state: negative(outcome) }),
    ),
  ];
  for (const { outcome, state } of cases) {
    assert.deepEqual(runInvariantErrors(state), []);
    const dense = JSON.parse(
      inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
        "utf8",
      ),
    ) as { u: Record<string, unknown[]> };
    const record = dense.u["unit-1"];
    if (record === undefined) throw new Error(`missing ${outcome} closure`);
    assert.equal(record[0], outcome);
    assert.equal(record[4], 0);

    // The terminal effect is mandatory for all variants.
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![10] = null;
        }),
      ).some((error) => error.includes("closed unit evidence ledger")),
    );
    // Cross-variant payloads cannot be reinterpreted by changing a tag.
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![0] = outcome === "failed" ? "landed" : "failed";
        }),
      ).some(
        (error) =>
          error.includes("closed unit evidence ledger") ||
          error.includes("terminal effect lineage"),
      ),
    );
    // Successful variants have an outcome-specific required landing/handoff fact.
    if (
      outcome === "landed" ||
      outcome === "branch_handoff" ||
      outcome === "pr_handoff"
    )
      assert.ok(
        runInvariantErrors(
          mutateDenseClosedEvidence(state, (mutated) => {
            const payload = mutated.u["unit-1"]![11] as unknown[];
            payload[0] = null;
          }),
        ).some((error) => error.includes("closed unit evidence ledger")),
      );
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![4] = null;
        }),
      ).some((error) => error.includes("authoritative repair count")),
    );
  }
});

test("hydration preserves owner converses and only keeps unresolved effects in the wave", () => {
  let reviewer = completeCandidate();
  reviewer = step(reviewer, "verification_intent", {});
  reviewer = observe(reviewer, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  reviewer = step(reviewer, "reviewer_dispatch_intent", {});
  const missingReviewer = { ...reviewer };
  delete missingReviewer.currentReviewerUnitId;
  assert.ok(
    runInvariantErrors(missingReviewer).some((error) =>
      error.includes("current reviewer converse"),
    ),
  );

  const integrating = step(
    approvedCandidate("local-change-only", "local-ff"),
    "integrate_intent",
    {},
  );
  const missingIntegrationOwner = { ...integrating };
  delete missingIntegrationOwner.integrationOwnerUnitId;
  assert.ok(
    runInvariantErrors(missingIntegrationOwner).some((error) =>
      error.includes("integration owner converse"),
    ),
  );

  const intended = step(run(), "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const unresolvedOutsideWave = {
    ...intended,
    wave: { ...intended.wave, unitIds: [] },
  };
  assert.ok(
    runInvariantErrors(unresolvedOutsideWave).some((error) =>
      error.includes("outside the current wave"),
    ),
  );
});

test("worker and reviewer sessions cannot alias controller or another role", () => {
  let worker = run();
  worker = step(worker, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  worker = observe(worker, "reservation_observed", "reservation_acquire");
  worker = step(worker, "branch_intent", { branchRef: "sce/unit-1" });
  worker = observe(worker, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  worker = step(worker, "worktree_intent", { worktreePath: "/tmp/unit-1" });
  worker = observe(worker, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  worker = step(worker, "dispatch_intent", {});
  assert.equal(
    reduce(
      worker,
      event(worker, "dispatch_observed", {
        effectId: effectId(worker, "dispatch"),
        effectKind: "dispatch",
        observationHash: HASH,
        sessionId: "incarnation-1",
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );

  let reviewer = completeCandidate();
  reviewer = step(reviewer, "verification_intent", {});
  reviewer = observe(reviewer, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  reviewer = step(reviewer, "reviewer_dispatch_intent", {});
  assert.equal(
    reduce(
      reviewer,
      event(reviewer, "reviewer_observed", {
        effectId: effectId(reviewer, "review_dispatch"),
        effectKind: "review_dispatch",
        observationHash: HASH,
        sessionId: "worker-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );
});

test("terminal intents start only from stable observed lifecycle states", () => {
  const allowed: readonly UnitState[] = [
    "planned",
    "resources_reserved",
    "branch_observed",
    "worktree_observed",
    "dispatched",
    "collected",
    "candidate_committed",
    "qualified",
    "reviewer_dispatched",
    "approved",
    "published",
    "repair_required",
  ];
  const forbidden: readonly UnitState[] = [
    "reservation_intent",
    "branch_intent",
    "worktree_intent",
    "dispatch_intent",
    "collect_intent",
    "candidate_intent",
    "verification_intent",
    "reviewer_dispatch_intent",
    "review_collect_intent",
    "publish_intent",
    "integrate_intent",
    "landed",
    "reservation_release_intent",
    "repair_intent",
    "failure_intent",
    "failed",
    "timeout_intent",
    "timed_out",
    "park_intent",
    "parked",
    "cancel_intent",
    "cancelled",
    "blocked",
    "closed",
  ];

  assert.equal(new Set([...allowed, ...forbidden]).size, 36);
  for (const state of allowed)
    assert.equal(canEnterTerminalIntent(state), true);
  for (const state of forbidden)
    assert.equal(canEnterTerminalIntent(state), false);

  const reserving = step(run(), "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const stackedCancellation = reduce(
    reserving,
    event(reserving, "cancel_intent", {}),
  );
  assert.equal(stackedCancellation.ok, false);
  if (!stackedCancellation.ok)
    assert.equal(stackedCancellation.code, "illegal_transition");

  const failing = step(run(), "failure_intent", {});
  const stackedTimeout = reduce(failing, event(failing, "timeout_intent", {}));
  assert.equal(stackedTimeout.ok, false);
  if (!stackedTimeout.ok)
    assert.equal(stackedTimeout.code, "illegal_transition");
});
