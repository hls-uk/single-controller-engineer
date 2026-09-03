import {
  Type,
  type Static,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

export const SCHEMA_VERSION = 1 as const;
export const LIMITS = {
  envelopeBytes: 131_072,
  effectJournal: 256,
  eventHistory: 256,
  // 64 units can each retain an initial worker/reviewer pair plus all 16
  // bounded repair pairs without permitting historical session reuse.
  sessionHistory: 2_176,
  sessionFingerprintBytes: 32,
  units: 64,
  reservations: 128,
  text: 8_192,
  findings: 64,
  materialisationBlobBytes: 16 * 1024 * 1024,
  materialisationMatches: 64,
  materialisationOutputs: 128,
  materialisationPathBytes: 192,
  materialisationSidecarBytes: 8_192,
  materialisationWaveBytes: 64 * 1024 * 1024,
} as const;
/** Four concurrent bounded packets stay well within the run envelope. */
export const HARNESS_PACKET_BYTES = 8_192;
const utf8 = new TextEncoder();
const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
/** Canonical POSIX-relative ownership path, not a platform alias. */
const ownedPath = () =>
  Type.String({
    minLength: 1,
    maxLength: 192,
    pattern:
      "^(?![A-Za-z]:)(?!.*//)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*\\/$)[A-Za-z0-9][A-Za-z0-9._/-]*$",
  });
const effectIdentifier = () =>
  Type.String({
    minLength: 1,
    // An emitted effect id is `${eventId}:${effectKind}`. Event IDs retain
    // the shared 160-character identifier vocabulary.
    maxLength: 192,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
const controllerHolder = () =>
  Type.String({
    minLength: 3,
    // Immutable holder is the exact `${runId}/${incarnationId}` pair.
    maxLength: 321,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
// Keys bind immutable run identity, aggregate revision, unit scope, and
// effect kind, so their bounded wire representation is wider than an ID.
const idempotencyKey = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
const revision = () =>
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const oid = () =>
  Type.String({
    minLength: 40,
    maxLength: 64,
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
  });
const hash = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
const text = (minLength = 1) =>
  Type.String({
    minLength,
    maxLength: LIMITS.text,
    maxUtf8Bytes: LIMITS.text,
  });
const nullableIdentifier = () => Type.Union([identifier(), Type.Null()]);
export function strictObject<T extends TProperties>(
  properties: T,
): ReturnType<typeof Type.Object<T>> {
  return Type.Object(properties, { additionalProperties: false });
}

export const EffectStatusSchema = Type.Union([
  Type.Literal("intended"),
  Type.Literal("observed"),
  Type.Literal("ambiguous"),
]);
export type EffectStatus = Static<typeof EffectStatusSchema>;
export const EffectKindSchema = Type.Union([
  Type.Literal("controller_acquire"),
  Type.Literal("reservation_acquire"),
  Type.Literal("branch_create"),
  Type.Literal("worktree_create"),
  Type.Literal("dispatch"),
  Type.Literal("worker_collect"),
  Type.Literal("candidate_collect"),
  Type.Literal("verify"),
  Type.Literal("review_dispatch"),
  Type.Literal("review_collect"),
  Type.Literal("publish"),
  Type.Literal("integrate"),
  Type.Literal("reservation_release"),
  Type.Literal("repair"),
  Type.Literal("failure"),
  Type.Literal("timeout"),
  Type.Literal("park"),
  Type.Literal("cancel"),
  Type.Literal("controller_release"),
  Type.Literal("provenance_carry_claim"),
  Type.Literal("materialisation_resolve"),
  Type.Literal("destination_probe"),
  Type.Literal("materialise"),
  Type.Literal("provenance_commit"),
]);
export type EffectKind = Static<typeof EffectKindSchema>;
// This is deliberately duplicated here instead of importing fencing schemas:
// fencing projections already depend on the protocol aggregate.  It is the
// closed wire shape of the embedded adapter's SlotTransitionIntent, retained
// with controller intent so a replacement process has the exact authority it
// needs to reconcile rather than inventing a new slot mutation.
const SlotScopeSchema = strictObject({
  beadsStoreIdentity: identifier(),
  gitRepositoryIdentity: identifier(),
  integrationBranch: identifier(),
});
const SlotObservationSchema = strictObject({
  actor: controllerHolder(),
  holder: Type.Optional(controllerHolder()),
  label: Type.Literal("gt:slot"),
  readbackHash: hash(),
  scope: SlotScopeSchema,
  scopeCommitment: hash(),
  slotId: identifier(),
  status: Type.Union([Type.Literal("available"), Type.Literal("acquired")]),
  title: Type.Literal("Merge Slot"),
  version: Type.Literal(1),
});
export const EmbeddedSlotTransitionIntentSchema = strictObject({
  after: SlotObservationSchema,
  before: strictObject({
    head: Type.String({ minLength: 20, maxLength: 64, pattern: "^[0-9a-z]+$" }),
    remoteHead: Type.Optional(
      Type.String({ minLength: 20, maxLength: 64, pattern: "^[0-9a-z]+$" }),
    ),
    slot: SlotObservationSchema,
  }),
  holder: controllerHolder(),
  idempotencyKey: hash(),
  kind: Type.Union([Type.Literal("acquire"), Type.Literal("release")]),
  schema: Type.Literal("sce.beads-embedded.slot-transition"),
  scope: SlotScopeSchema,
  version: Type.Literal(1),
});
export type EmbeddedSlotTransitionIntent = Static<
  typeof EmbeddedSlotTransitionIntentSchema
>;

/**
 * Shared-server controller authority. Unlike the embedded record, a server
 * transition is bound to exact before/after slot readbacks rather than Git
 * heads. The semantic adapter validation also binds the precondition kind to
 * acquire/release and recomputes this record's idempotency key.
 */
export const ServerSlotTransitionIntentSchema = strictObject({
  after: SlotObservationSchema,
  before: SlotObservationSchema,
  holder: controllerHolder(),
  idempotencyKey: hash(),
  kind: Type.Union([Type.Literal("acquire"), Type.Literal("release")]),
  precondition: strictObject({
    kind: Type.Union([Type.Literal("available"), Type.Literal("held")]),
    observationHash: hash(),
  }),
  schema: Type.Literal("sce.beads-server.slot-transition"),
  scope: SlotScopeSchema,
  topology: Type.Literal("shared-server"),
  version: Type.Literal(1),
});
export type ServerSlotTransitionIntent = Static<
  typeof ServerSlotTransitionIntentSchema
>;

export const SlotTransitionIntentSchema = Type.Union([
  EmbeddedSlotTransitionIntentSchema,
  ServerSlotTransitionIntentSchema,
]);
export type SlotTransitionIntent = Static<typeof SlotTransitionIntentSchema>;
export const EffectJournalEntrySchema = strictObject({
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  kind: EffectKindSchema,
  /** Stable logical identity for aggregate gate effects only. */
  gateEntryId: Type.Optional(identifier()),
  intentRevision: revision(),
  intentCommitment: hash(),
  paramsHash: hash(),
  // Present only for controller slot acts.  This binds all before/after slot
  // facts and heads durably before the adapter is invoked.
  slotTransition: Type.Optional(SlotTransitionIntentSchema),
  status: EffectStatusSchema,
  observationHash: Type.Optional(hash()),
  schemaVersion: Type.Literal(SCHEMA_VERSION),
});
export type EffectJournalEntry = Static<typeof EffectJournalEntrySchema>;

export const ReservationStateSchema = Type.Union([
  Type.Literal("intended"),
  Type.Literal("reserved"),
  Type.Literal("release_intent"),
  Type.Literal("released"),
]);
export type ReservationState = Static<typeof ReservationStateSchema>;
export const ReservationSchema = strictObject({
  id: identifier(),
  unitId: identifier(),
  namespace: identifier(),
  resource: identifier(),
  state: ReservationStateSchema,
  acquireEffectId: Type.Optional(effectIdentifier()),
  releaseEffectId: Type.Optional(effectIdentifier()),
});
export type Reservation = Static<typeof ReservationSchema>;

export const UnitStateSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("reservation_intent"),
  Type.Literal("resources_reserved"),
  Type.Literal("branch_intent"),
  Type.Literal("branch_observed"),
  Type.Literal("worktree_intent"),
  Type.Literal("worktree_observed"),
  Type.Literal("dispatch_intent"),
  Type.Literal("dispatched"),
  Type.Literal("collect_intent"),
  Type.Literal("collected"),
  Type.Literal("candidate_intent"),
  Type.Literal("candidate_committed"),
  Type.Literal("verification_intent"),
  Type.Literal("qualified"),
  Type.Literal("reviewer_dispatch_intent"),
  Type.Literal("reviewer_dispatched"),
  Type.Literal("review_collect_intent"),
  Type.Literal("approved"),
  Type.Literal("publish_intent"),
  Type.Literal("published"),
  Type.Literal("integrate_intent"),
  Type.Literal("landed"),
  Type.Literal("handoff"),
  Type.Literal("reservation_release_intent"),
  Type.Literal("repair_required"),
  Type.Literal("repair_intent"),
  Type.Literal("failure_intent"),
  Type.Literal("failed"),
  Type.Literal("timeout_intent"),
  Type.Literal("timed_out"),
  Type.Literal("park_intent"),
  Type.Literal("parked"),
  Type.Literal("cancel_intent"),
  Type.Literal("cancelled"),
  Type.Literal("blocked"),
  Type.Literal("closed"),
]);
export type UnitState = Static<typeof UnitStateSchema>;
const RepairContextSchema = strictObject({
  baseOid: oid(),
  // A worker can request a repair before a clean candidate exists. Review and
  // runtime contexts carry the exact candidate pair; all present OIDs are
  // checked again against the repository object format during hydration.
  headOid: Type.Optional(oid()),
  treeOid: Type.Optional(oid()),
  responseHash: hash(),
  rationale: text(),
  findings: Type.Array(
    strictObject({
      id: identifier(),
      severity: Type.Union([
        Type.Literal("blocking"),
        Type.Literal("non_blocking"),
      ]),
      detail: text(),
    }),
    { minItems: 1, maxItems: LIMITS.findings },
  ),
});
const PullRequestObservationSchema = strictObject({
  providerPrId: identifier(),
  // Provider URLs are retained only when the consuming policy permits them.
  url: Type.Optional(text()),
  state: Type.Literal("open"),
  baseRef: identifier(),
  baseOid: oid(),
  remoteHeadOid: oid(),
});
const packetStrings = (minItems: number, maxItems: number) =>
  Type.Array(text(), { minItems, maxItems, uniqueItems: true });
const HarnessPacketInputCommon = {
  acceptance: packetStrings(1, 64),
  baseOid: oid(),
  mandatoryVerification: packetStrings(1, 32),
  ownedPaths: Type.Array(ownedPath(), {
    minItems: 1,
    maxItems: 128,
    uniqueItems: true,
  }),
  unitId: identifier(),
};
const candidateDiffStat = () =>
  strictObject({
    deletions: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    fileCount: Type.Integer({ minimum: 1, maximum: 128 }),
    insertions: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  });
const packetWorktreePath = () =>
  Type.String({
    minLength: 2,
    maxLength: LIMITS.text,
    maxUtf8Bytes: LIMITS.text,
    pattern: "^/[^\\u0000]*$",
  });
/** Exact bounded input accepted by the public packet command. */
export const HarnessPacketInputSchema = Type.Union([
  strictObject({ ...HarnessPacketInputCommon, role: Type.Literal("worker") }),
  strictObject({
    ...HarnessPacketInputCommon,
    candidateDiffByteCount: Type.Integer({ minimum: 1, maximum: 65_536 }),
    candidateDiffHash: hash(),
    candidateDiffStat: candidateDiffStat(),
    headOid: oid(),
    role: Type.Literal("reviewer"),
    worktreePath: packetWorktreePath(),
  }),
]);
export type HarnessPacketInput = Static<typeof HarnessPacketInputSchema>;
const HarnessPacketCommon = {
  ...HarnessPacketInputCommon,
  schema: Type.Literal("sce.harness-packet"),
};
export const HarnessPacketSchema = Type.Union([
  strictObject({
    ...HarnessPacketCommon,
    role: Type.Literal("worker"),
    version: Type.Literal(1),
  }),
  strictObject({
    ...HarnessPacketCommon,
    candidateDiffByteCount: Type.Integer({ minimum: 1, maximum: 65_536 }),
    candidateDiffCommand: Type.Array(text(), {
      minItems: 2,
      maxItems: 32,
    }),
    candidateDiffHash: hash(),
    candidateDiffStat: candidateDiffStat(),
    headOid: oid(),
    role: Type.Literal("reviewer"),
    version: Type.Literal(2),
    worktreePath: packetWorktreePath(),
  }),
]);
export type HarnessPacket = Static<typeof HarnessPacketSchema>;
/** Canonical payload/hash pair persisted with every advertised launch. */
const harnessPacketBinding = (version: 1 | 2) =>
  strictObject({
    hash: hash(),
    payload: Type.String({
      minLength: 1,
      maxLength: HARNESS_PACKET_BYTES,
      maxUtf8Bytes: HARNESS_PACKET_BYTES,
    }),
    schema: Type.Literal("sce.harness-packet"),
    version: Type.Literal(version),
  });
export const HarnessPacketBindingSchema = Type.Union([
  harnessPacketBinding(1),
  harnessPacketBinding(2),
]);
export type HarnessPacketBinding = Static<typeof HarnessPacketBindingSchema>;

const canonicalSourcePath = () =>
  Type.String({
    minLength: 1,
    maxLength: LIMITS.materialisationPathBytes,
    maxUtf8Bytes: LIMITS.materialisationPathBytes,
    pattern:
      "^(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\*\\*)[A-Za-z0-9][A-Za-z0-9._*?-]*(?:/[A-Za-z0-9][A-Za-z0-9._*?-]*)*$",
  });
const canonicalResolvedPath = () =>
  Type.String({
    minLength: 1,
    maxLength: LIMITS.materialisationPathBytes,
    maxUtf8Bytes: LIMITS.materialisationPathBytes,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$",
  });
const canonicalSubpath = () => canonicalResolvedPath();
const plainBasename = () =>
  Type.String({
    minLength: 1,
    maxLength: 255,
    maxUtf8Bytes: 255,
    pattern: "^[A-Za-z0-9.][A-Za-z0-9._-]*$",
  });
const absolutePath = () =>
  Type.String({
    minLength: 2,
    maxLength: 4_096,
    maxUtf8Bytes: 4_096,
    pattern: "^/[^\\u0000\\r\\n]*$",
  });
const utcSecond = () =>
  Type.String({
    minLength: 20,
    maxLength: 20,
    pattern:
      "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
  });

export const MaterialisationTargetSchema = strictObject({
  destinationAlias: Type.String({
    minLength: 1,
    maxLength: 63,
    pattern: "^[a-z][a-z0-9-]{0,62}$",
  }),
  destinationSubpath: canonicalSubpath(),
  namingPolicy: Type.Union([
    Type.Literal("source-basename"),
    Type.Literal("iso-date-prefix"),
    Type.Literal("content-hash-suffix"),
  ]),
  sidecarRequired: Type.Literal(true),
  sourcePattern: canonicalSourcePath(),
});
export type MaterialisationTarget = Static<typeof MaterialisationTargetSchema>;

export const DriveAliasSchema = strictObject({
  alias: Type.String({
    minLength: 1,
    maxLength: 63,
    pattern: "^[a-z][a-z0-9-]{0,62}$",
  }),
  canonicalRoot: absolutePath(),
  markerFile: plainBasename(),
  mountPolicy: Type.Union([Type.Literal("required"), Type.Literal("optional")]),
  namespaceControl: Type.Literal("exclusive"),
});
export type DriveAlias = Static<typeof DriveAliasSchema>;

const commandArgument = () =>
  Type.String({
    minLength: 1,
    maxLength: 1_024,
    maxUtf8Bytes: 1_024,
    pattern:
      "^(?:[^\\u0000\\uD800-\\uDFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF])+$",
  });
const commandVector = () =>
  Type.Array(commandArgument(), { minItems: 1, maxItems: 32 });

export const KnowledgeContractSchema = strictObject({
  aliases: Type.Array(DriveAliasSchema, {
    maxItems: 64,
  }),
  /** Manifest audience label; every provenance record carries it. */
  audience: identifier(),
  combinedVerificationCommands: Type.Array(commandVector(), {
    minItems: 1,
    maxItems: 32,
  }),
  /** The access-domain identifier; records carry it as accessDomainId. */
  domainScope: identifier(),
  gateTargets: Type.Array(MaterialisationTargetSchema, { maxItems: 64 }),
  humanDriver: text(),
  /** Manifest project identifier; every provenance record carries it. */
  projectId: identifier(),
  provenance: strictObject({
    eventsDirectory: ownedPath(),
    /** Rollup output home; the generator receives it as `--output`. */
    generatedDirectory: ownedPath(),
    recordFormatVersion: Type.Literal(1),
    reproducibilityCommand: commandVector(),
    rollupGeneratorCommand: commandVector(),
  }),
  provenanceWorktreeRoot: Type.String({
    minLength: 2,
    maxLength: 3_840,
    maxUtf8Bytes: 3_840,
    pattern: "^/[^\\u0000\\r\\n]*$",
  }),
});
export type KnowledgeContract = Static<typeof KnowledgeContractSchema>;

export const MaterialisationSourceSchema = strictObject({
  blobOid: oid(),
  byteCount: Type.Integer({
    minimum: 0,
    maximum: LIMITS.materialisationBlobBytes,
  }),
  path: canonicalResolvedPath(),
  sha256: hash(),
});
export type MaterialisationSource = Static<typeof MaterialisationSourceSchema>;

export const MaterialisationSidecarSchema = strictObject({
  artifactName: plainBasename(),
  blobOid: oid(),
  byteCount: Type.Integer({
    minimum: 0,
    maximum: LIMITS.materialisationBlobBytes,
  }),
  destinationAlias: Type.String({
    minLength: 1,
    maxLength: 63,
    pattern: "^[a-z][a-z0-9-]{0,62}$",
  }),
  destinationSubpath: canonicalSubpath(),
  domainScope: identifier(),
  driver: text(),
  executorTool: identifier(),
  gateEntryId: identifier(),
  originUnitId: nullableIdentifier(),
  runId: identifier(),
  schema: Type.Literal("sce.materialisation-provenance"),
  sha256: hash(),
  sourceOid: oid(),
  sourcePath: canonicalResolvedPath(),
  targetId: identifier(),
  timestamp: utcSecond(),
  version: Type.Literal(1),
  waveId: identifier(),
});
export type MaterialisationSidecar = Static<
  typeof MaterialisationSidecarSchema
>;

const refusalSchema = <T extends TSchema>(code: T) =>
  strictObject({ code, detailHash: hash() });
export const MaterialisationResolveRefusalSchema = refusalSchema(
  Type.Union([
    Type.Literal("source_absent"),
    Type.Literal("zero_matches"),
    Type.Literal("too_many_matches"),
    Type.Literal("wave_item_limit"),
    Type.Literal("wave_byte_limit"),
    Type.Literal("unsafe_path"),
    Type.Literal("non_blob"),
    Type.Literal("blob_too_large"),
    Type.Literal("evidence_budget_exceeded"),
  ]),
);
export type MaterialisationResolveRefusal = Static<
  typeof MaterialisationResolveRefusalSchema
>;
export const DestinationProbeRefusalSchema = refusalSchema(
  Type.Union([
    Type.Literal("optional_alias_unmounted"),
    Type.Literal("required_alias_unmounted"),
    Type.Literal("invalid_destination"),
  ]),
);
export type DestinationProbeRefusal = Static<
  typeof DestinationProbeRefusalSchema
>;
export const MaterialiseRefusalSchema = refusalSchema(
  Type.Union([
    Type.Literal("source_absent"),
    Type.Literal("hard_links_unsupported"),
  ]),
);
export type MaterialiseRefusal = Static<typeof MaterialiseRefusalSchema>;
export const GateMaterialisationRefusalSchema = refusalSchema(
  Type.Union([
    Type.Literal("source_absent"),
    Type.Literal("hard_links_unsupported"),
  ]),
);
export const OutputNameCollisionRefusalSchema = strictObject({
  code: Type.Literal("output_name_collision"),
  conflictingGateEntryId: identifier(),
});
export const GateMaterialisationEntryRefusalSchema = Type.Union([
  GateMaterialisationRefusalSchema,
  OutputNameCollisionRefusalSchema,
]);
export type GateMaterialisationEntryRefusal = Static<
  typeof GateMaterialisationEntryRefusalSchema
>;
export const ProvenanceRefusalSchema = refusalSchema(
  Type.Union([
    Type.Literal("provenance_reproducibility_failed"),
    Type.Literal("provenance_base_advanced"),
    Type.Literal("provenance_worktree_refused"),
    Type.Literal("provenance_integration_refused"),
  ]),
);
export type ProvenanceRefusal = Static<typeof ProvenanceRefusalSchema>;
export const AggregateVerificationRefusalSchema = refusalSchema(
  Type.Literal("verification_failed"),
);
export type AggregateVerificationRefusal = Static<
  typeof AggregateVerificationRefusalSchema
>;
export const MaterialisationRefusalSchema = Type.Union([
  MaterialisationResolveRefusalSchema,
  DestinationProbeRefusalSchema,
  GateMaterialisationRefusalSchema,
  OutputNameCollisionRefusalSchema,
  ProvenanceRefusalSchema,
  AggregateVerificationRefusalSchema,
]);
export type MaterialisationRefusal = Static<
  typeof MaterialisationRefusalSchema
>;

const gateDisposition = () =>
  Type.Union([
    Type.Literal("unit_not_landed"),
    Type.Literal("handoff_boundary"),
    Type.Literal("optional_alias_unmounted"),
    Type.Literal("no_landed_units"),
    Type.Literal("deferred_by_controller"),
    Type.Literal("deferral_cascade"),
  ]);
const gateStatus = () =>
  Type.Union([
    Type.Literal("pending"),
    Type.Literal("observed"),
    Type.Literal("voided"),
  ]);
const GateTargetDefinitionSchema = strictObject({
  originUnitId: nullableIdentifier(),
  scope: Type.Union([Type.Literal("unit"), Type.Literal("gate")]),
  target: MaterialisationTargetSchema,
  targetId: identifier(),
  targetOrdinal: Type.Integer({ minimum: 0, maximum: 63 }),
});
export type GateTargetDefinition = Static<typeof GateTargetDefinitionSchema>;
const GateResolutionSchema = strictObject({
  capacities: Type.Optional(
    strictObject({
      remainingAggregateEnvelopeByteCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.envelopeBytes,
      }),
      remainingItemCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.materialisationOutputs,
      }),
      remainingProjectionSnapshotByteCapacity: Type.Integer({
        minimum: 0,
        maximum: 65_536,
      }),
      remainingSourceByteCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.materialisationWaveBytes,
      }),
    }),
  ),
  currentEffectId: Type.Optional(effectIdentifier()),
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  gateEntryId: identifier(),
  lastRefusal: Type.Optional(MaterialisationResolveRefusalSchema),
  sourceOid: oid(),
  sources: Type.Optional(
    Type.Array(MaterialisationSourceSchema, {
      minItems: 1,
      maxItems: LIMITS.materialisationMatches,
    }),
  ),
  status: gateStatus(),
  targetId: identifier(),
});
export type GateResolution = Static<typeof GateResolutionSchema>;
const MaterialisationObservationSchema = strictObject({
  artifactByteCount: Type.Integer({
    minimum: 0,
    maximum: LIMITS.materialisationBlobBytes,
  }),
  artifactSha256: hash(),
  artifactStatus: Type.Union([
    Type.Literal("published"),
    Type.Literal("already_present"),
  ]),
  sidecarByteCount: Type.Integer({
    minimum: 1,
    maximum: LIMITS.materialisationSidecarBytes,
  }),
  sidecarSha256: hash(),
  sidecarStatus: Type.Union([
    Type.Literal("published"),
    Type.Literal("already_present"),
  ]),
});
export const GateMaterialisationSchema = strictObject({
  artifactName: Type.Optional(plainBasename()),
  currentEffectId: Type.Optional(effectIdentifier()),
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  gateEntryId: identifier(),
  destinationProbeGateEntryId: identifier(),
  lastRefusal: Type.Optional(GateMaterialisationEntryRefusalSchema),
  observation: Type.Optional(MaterialisationObservationSchema),
  originUnitId: nullableIdentifier(),
  sidecarByteCount: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: LIMITS.materialisationSidecarBytes,
    }),
  ),
  sidecarName: Type.Optional(plainBasename()),
  sidecarSha256: Type.Optional(hash()),
  source: MaterialisationSourceSchema,
  sourceOid: oid(),
  status: gateStatus(),
  target: MaterialisationTargetSchema,
  targetId: identifier(),
  timestamp: Type.Optional(utcSecond()),
});
export type GateMaterialisation = Static<typeof GateMaterialisationSchema>;
const GateTargetStateSchema = strictObject({
  definition: GateTargetDefinitionSchema,
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  materialisations: Type.Array(GateMaterialisationSchema, {
    maxItems: LIMITS.materialisationMatches,
  }),
  resolution: Type.Optional(GateResolutionSchema),
  status: gateStatus(),
});
export type GateTargetState = Static<typeof GateTargetStateSchema>;
const GateTargetPromiseSchema = strictObject({
  definition: GateTargetDefinitionSchema,
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  status: Type.Union([Type.Literal("pending"), Type.Literal("voided")]),
});
export type GateTargetPromise = Static<typeof GateTargetPromiseSchema>;

export const MaterialisationDestinationIdentitySchema = strictObject({
  canonicalPath: absolutePath(),
  device: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,19})$" }),
  inode: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,19})$" }),
});
export type MaterialisationDestinationIdentity = Static<
  typeof MaterialisationDestinationIdentitySchema
>;
const GateDestinationProbeSchema = strictObject({
  currentEffectId: Type.Optional(effectIdentifier()),
  destinationAlias: Type.String({
    minLength: 1,
    maxLength: 63,
    pattern: "^[a-z][a-z0-9-]{0,62}$",
  }),
  destinationSubpath: canonicalSubpath(),
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  gateEntryId: identifier(),
  identity: Type.Optional(MaterialisationDestinationIdentitySchema),
  lastRefusal: Type.Optional(DestinationProbeRefusalSchema),
  stage: Type.Union([Type.Literal("unit"), Type.Literal("gate")]),
  status: gateStatus(),
});
export type GateDestinationProbe = Static<typeof GateDestinationProbeSchema>;

export const ProvenanceInputSchema = strictObject({
  closedUnitEvidence: Type.String({
    maxLength: LIMITS.envelopeBytes,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  }),
  closureEvidenceCommitment: hash(),
  destinationProbeEvidence: Type.Array(GateDestinationProbeSchema, {
    maxItems: 128,
  }),
  targetEvidence: Type.Array(GateTargetStateSchema, { maxItems: 192 }),
  unitIds: Type.Array(identifier(), { maxItems: LIMITS.units }),
});
export type ProvenanceInput = Static<typeof ProvenanceInputSchema>;
export const ProvenanceCarryClaimRecordSchema = strictObject({
  schema: Type.Literal("sce.provenance-carry-claim"),
  version: Type.Literal(1),
  exportId: identifier(),
  predecessorRootBeadId: identifier(),
  predecessorRunId: identifier(),
  predecessorWaveId: identifier(),
  snapshotCommitment: hash(),
  claimantRunId: identifier(),
  claimToken: idempotencyKey(),
  claimRevision: Type.Literal(1),
});
export type ProvenanceCarryClaimRecord = Static<
  typeof ProvenanceCarryClaimRecordSchema
>;
export const ProvenanceCarryRefusalReasonSchema = Type.Union([
  Type.Literal("not_found"),
  Type.Literal("projection_invalid"),
  Type.Literal("scope_mismatch"),
  Type.Literal("not_released"),
  Type.Literal("effects_unsettled"),
  Type.Literal("provenance_not_deferred"),
  Type.Literal("snapshot_invalid"),
  Type.Literal("lineage_invalid"),
  Type.Literal("lineage_limit_exceeded"),
]);
export const ProvenanceCarrySchema = strictObject({
  claimRecordDigest: hash(),
  claimRevision: Type.Literal(1),
  exportId: identifier(),
  integrationOid: oid(),
  lineageAncestorDigests: Type.Array(hash(), {
    maxItems: 128,
    uniqueItems: true,
  }),
  lineageCommitment: hash(),
  predecessorFinalRevision: revision(),
  predecessorJournalCheckpointCommitment: hash(),
  predecessorRootBeadId: identifier(),
  predecessorRootAggregateCommitment: hash(),
  predecessorRunId: identifier(),
  predecessorWaveId: identifier(),
  projectionInputSnapshot: ProvenanceInputSchema,
  snapshotCommitment: hash(),
});
export type ProvenanceCarry = Static<typeof ProvenanceCarrySchema>;
const ProvenanceCarryClaimStateSchema = strictObject({
  claimToken: idempotencyKey(),
  currentEffectId: effectIdentifier(),
  exportId: identifier(),
  predecessorFinalRevision: revision(),
  predecessorJournalCheckpointCommitment: hash(),
  predecessorRootBeadId: identifier(),
  predecessorRootAggregateCommitment: hash(),
  predecessorRunId: identifier(),
  predecessorWaveId: identifier(),
  snapshotCommitment: hash(),
});
const ProvenanceCarryRefusalSchema = Type.Union([
  strictObject({
    status: Type.Literal("already_claimed"),
    exportId: identifier(),
    claimantRunId: identifier(),
    claimRecordDigest: hash(),
    claimRevision: Type.Literal(1),
  }),
  strictObject({
    status: Type.Literal("predecessor_refused"),
    predecessorRootBeadId: identifier(),
    evidenceDigest: hash(),
    reason: ProvenanceCarryRefusalReasonSchema,
  }),
]);
const GateProvenanceSchema = strictObject({
  advancedBaseOid: Type.Optional(oid()),
  attemptIdempotencyKey: Type.Optional(idempotencyKey()),
  attemptedCommitOid: Type.Optional(oid()),
  attemptedTreeOid: Type.Optional(oid()),
  baseOid: Type.Optional(oid()),
  commitOid: Type.Optional(oid()),
  currentEffectId: Type.Optional(effectIdentifier()),
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  gateEntryId: identifier(),
  projectionInputSnapshot: ProvenanceInputSchema,
  lastRefusal: Type.Optional(ProvenanceRefusalSchema),
  observedHeadOid: Type.Optional(Type.Union([oid(), Type.Null()])),
  status: gateStatus(),
  timestamp: Type.Optional(utcSecond()),
  treeOid: Type.Optional(oid()),
  worktreeCondition: Type.Optional(
    Type.Union([
      Type.Literal("dirty_worktree"),
      Type.Literal("unexpected_head"),
    ]),
  ),
  expectedBaseOid: Type.Optional(oid()),
  worktreePath: Type.Optional(absolutePath()),
});
export type GateProvenance = Static<typeof GateProvenanceSchema>;
const GateAggregateVerifySchema = strictObject({
  currentEffectId: Type.Optional(effectIdentifier()),
  disposition: Type.Optional(gateDisposition()),
  followUpBeadId: Type.Optional(identifier()),
  gateEntryId: identifier(),
  lastRefusal: Type.Optional(AggregateVerificationRefusalSchema),
  provenanceGateEntryId: identifier(),
  status: gateStatus(),
});
export type GateAggregateVerify = Static<typeof GateAggregateVerifySchema>;
export const WaveGateSchema = strictObject({
  aggregateVerify: Type.Optional(GateAggregateVerifySchema),
  aggregateVerifyPromise: Type.Optional(
    strictObject({
      disposition: Type.Optional(gateDisposition()),
      followUpBeadId: Type.Optional(identifier()),
      status: Type.Union([Type.Literal("pending"), Type.Literal("voided")]),
    }),
  ),
  carriedProjectionInputSnapshot: Type.Optional(ProvenanceInputSchema),
  carriedSnapshotCommitment: Type.Optional(hash()),
  carriedProvenanceBaseOid: Type.Optional(oid()),
  currentIntegrationOid: Type.Optional(oid()),
  destinationProbes: Type.Array(GateDestinationProbeSchema, { maxItems: 128 }),
  lineageAncestorDigests: Type.Array(hash(), {
    maxItems: 128,
    uniqueItems: true,
  }),
  lineageCommitment: hash(),
  provenancePromise: Type.Optional(
    strictObject({
      disposition: Type.Optional(gateDisposition()),
      followUpBeadId: Type.Optional(identifier()),
      status: Type.Union([Type.Literal("pending"), Type.Literal("voided")]),
    }),
  ),
  provenance: Type.Optional(GateProvenanceSchema),
  provenanceUnitAccounting: Type.Array(
    Type.Union([
      strictObject({
        closureEvidenceCommitment: hash(),
        status: Type.Literal("uncommitted"),
        unitId: identifier(),
      }),
      strictObject({
        closureEvidenceCommitment: hash(),
        provenanceCommitOid: oid(),
        status: Type.Literal("committed"),
        unitId: identifier(),
      }),
    ]),
    { maxItems: 64 },
  ),
  targetPromises: Type.Array(GateTargetPromiseSchema, { maxItems: 256 }),
  targets: Type.Array(GateTargetStateSchema, { maxItems: 256 }),
  targetDefinitionCommitment: hash(),
  originalUnitIds: Type.Array(identifier(), { maxItems: 3, uniqueItems: true }),
  waveId: identifier(),
});
export type WaveGate = Static<typeof WaveGateSchema>;

/** Validated Beads task metadata supplied to the deterministic wave planner. */
export const WaveTaskMetadataSchema = strictObject({
  acceptanceIds: Type.Array(identifier(), {
    minItems: 1,
    maxItems: 64,
    uniqueItems: true,
  }),
  conflictDomains: Type.Array(identifier(), {
    maxItems: 64,
    uniqueItems: true,
  }),
  dependencies: Type.Array(identifier(), {
    maxItems: 64,
    uniqueItems: true,
  }),
  independence: Type.Union([Type.Literal("ambiguous"), Type.Literal("proven")]),
  mandatoryVerification: packetStrings(1, 32),
  materialisationTargets: Type.Optional(
    Type.Array(MaterialisationTargetSchema, { maxItems: 64 }),
  ),
  ownedPaths: Type.Array(ownedPath(), {
    minItems: 1,
    maxItems: 128,
    uniqueItems: true,
  }),
  priority: Type.Integer({ minimum: 0, maximum: 4 }),
  reservations: Type.Array(identifier(), {
    maxItems: 64,
    uniqueItems: true,
  }),
  risk: Type.Union([
    Type.Literal("critical"),
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
  ]),
  supersedes: Type.Optional(
    Type.Array(identifier(), { maxItems: 64, uniqueItems: true }),
  ),
  tombstones: Type.Optional(
    Type.Array(identifier(), { maxItems: 64, uniqueItems: true }),
  ),
  unitId: identifier(),
});
export type WaveTaskMetadata = Static<typeof WaveTaskMetadataSchema>;

export const UnitSchema = strictObject({
  id: identifier(),
  // Stable at planning time and never reassigned, even after a unit leaves
  // the live map at closure. Session lineage records bind this ordinal.
  ordinal: Type.Integer({ minimum: 0, maximum: 63 }),
  revision: revision(),
  state: UnitStateSchema,
  baseOid: oid(),
  /** Durable controller plan binding; absent only on a legacy v1 run. */
  taskMetadata: Type.Optional(WaveTaskMetadataSchema),
  branchRef: Type.Optional(identifier()),
  worktreePath: Type.Optional(text()),
  reservationIds: Type.Array(identifier(), {
    maxItems: LIMITS.reservations,
    uniqueItems: true,
  }),
  candidateHead: Type.Optional(oid()),
  candidateTree: Type.Optional(oid()),
  candidateDiffHash: Type.Optional(hash()),
  publishedHeadOid: Type.Optional(oid()),
  openPullRequest: Type.Optional(PullRequestObservationSchema),
  workerSessionId: Type.Optional(identifier()),
  workerRequestedModel: Type.Optional(text()),
  workerReturnedModel: Type.Optional(text()),
  workerPromptHash: Type.Optional(hash()),
  workerPacket: Type.Optional(HarnessPacketBindingSchema),
  reviewerSessionId: Type.Optional(identifier()),
  reviewerRequestedModel: Type.Optional(text()),
  reviewerReturnedModel: Type.Optional(text()),
  reviewPromptHash: Type.Optional(hash()),
  reviewerPacket: Type.Optional(HarnessPacketBindingSchema),
  verificationBaseOid: Type.Optional(oid()),
  verificationHeadOid: Type.Optional(oid()),
  verificationTree: Type.Optional(oid()),
  verificationEvidenceHash: Type.Optional(hash()),
  verificationCommands: Type.Optional(
    Type.Array(text(), { minItems: 1, maxItems: 32 }),
  ),
  reviewBaseOid: Type.Optional(oid()),
  reviewHeadOid: Type.Optional(oid()),
  reviewTree: Type.Optional(oid()),
  approvalResponseHash: Type.Optional(hash()),
  landedOid: Type.Optional(oid()),
  workerResult: Type.Optional(
    strictObject({
      status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_repair"),
        Type.Literal("failed"),
      ]),
      summary: text(),
      residualRisks: Type.Array(text(), { maxItems: 32 }),
      suggestedFollowUps: Type.Array(text(), { maxItems: 32 }),
    }),
  ),
  repairCount: Type.Integer({ minimum: 0, maximum: 16 }),
  repairContext: Type.Optional(RepairContextSchema),
});
export type Unit = Static<typeof UnitSchema>;

/**
 * Exact non-core facts retained after a unit closes. These are stored in the
 * aggregate's canonical compressed closed-unit ledger; unknown fields are
 * rejected before hydration can use the record.
 */
const ObservedJournalEntrySchema = strictObject({
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  kind: EffectKindSchema,
  intentRevision: revision(),
  intentCommitment: hash(),
  paramsHash: hash(),
  status: Type.Literal("observed"),
  observationHash: hash(),
  schemaVersion: Type.Literal(SCHEMA_VERSION),
});
const ClosureReservationSchema = strictObject({
  id: identifier(),
  namespace: identifier(),
  resource: identifier(),
  acquire: ObservedJournalEntrySchema,
  release: Type.Optional(
    strictObject({
      effectId: effectIdentifier(),
      unitId: nullableIdentifier(),
      idempotencyKey: idempotencyKey(),
      kind: Type.Literal("reservation_release"),
      intentRevision: revision(),
      intentCommitment: hash(),
      paramsHash: hash(),
      status: EffectStatusSchema,
      observationHash: Type.Optional(hash()),
      schemaVersion: Type.Literal(SCHEMA_VERSION),
    }),
  ),
});
const ClosureWorkerSchema = strictObject({
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash(),
});
const ClosureReviewerSchema = strictObject({
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash(),
});
const ClosureCandidateSchema = strictObject({ headOid: oid(), treeOid: oid() });
const ClosureVerificationSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  evidenceHash: hash(),
  commands: Type.Array(text(), { minItems: 1, maxItems: 32 }),
});
const ClosureReviewSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  responseHash: hash(),
});
const ClosureBaseSchema = {
  unitId: identifier(),
  unitOrdinal: Type.Integer({ minimum: 0, maximum: 63 }),
  baseOid: oid(),
  // Task-card facts a provenance record needs after the unit leaves the live
  // map. They are recorded only on a knowledge run, so software closure bytes
  // are unchanged.
  ownedPaths: Type.Optional(
    Type.Array(ownedPath(), { minItems: 1, maxItems: 128, uniqueItems: true }),
  ),
  acceptanceIds: Type.Optional(
    Type.Array(identifier(), { minItems: 1, maxItems: 64, uniqueItems: true }),
  ),
  supersedes: Type.Optional(
    Type.Array(identifier(), { maxItems: 64, uniqueItems: true }),
  ),
  tombstones: Type.Optional(
    Type.Array(identifier(), { maxItems: 64, uniqueItems: true }),
  ),
  // While the unit is live, its required field is authoritative. At closure
  // the unit leaves the map and this record becomes the sole owner.
  repairCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 16 })),
  branchRef: Type.Optional(identifier()),
  worktreePath: Type.Optional(text()),
  worker: Type.Optional(ClosureWorkerSchema),
  reviewer: Type.Optional(ClosureReviewerSchema),
  reservations: Type.Array(ClosureReservationSchema, {
    maxItems: LIMITS.reservations,
    uniqueItems: true,
  }),
  terminalEffect: ObservedJournalEntrySchema,
};
const ClosureSuccessSchema = {
  candidate: ClosureCandidateSchema,
  verification: ClosureVerificationSchema,
  review: ClosureReviewSchema,
};
const ClosureNegativeSchema = {
  workerResult: Type.Optional(
    strictObject({
      status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_repair"),
        Type.Literal("failed"),
      ]),
      summary: text(),
      residualRisks: Type.Array(text(), { maxItems: 32 }),
      suggestedFollowUps: Type.Array(text(), { maxItems: 32 }),
    }),
  ),
  repairContext: Type.Optional(RepairContextSchema),
  candidate: Type.Optional(ClosureCandidateSchema),
};
/** Strict typed terminal records persisted before reservation release begins. */
export const ClosureEvidenceSchema = Type.Union([
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("landed"),
    landedOid: oid(),
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("branch_handoff"),
    publishedHeadOid: oid(),
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("pr_handoff"),
    publishedHeadOid: oid(),
    pullRequest: PullRequestObservationSchema,
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("failed"),
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("timed_out"),
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("parked"),
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("cancelled"),
  }),
]);
export type ClosureEvidence = Static<typeof ClosureEvidenceSchema>;

export const AggregateStateSchema = Type.Union([
  Type.Literal("initializing"),
  Type.Literal("active"),
  Type.Literal("draining"),
  Type.Literal("release_intent"),
  Type.Literal("released"),
  Type.Literal("blocked"),
]);
export type AggregateState = Static<typeof AggregateStateSchema>;
export const AuthorityProfileSchema = Type.Union([
  Type.Literal("local-change-only"),
  Type.Literal("push-branch"),
  Type.Literal("open-pr"),
  Type.Literal("integrate"),
]);
export type AuthorityProfile = Static<typeof AuthorityProfileSchema>;
/** The successful stopping point requested for this run, independent of grant. */
export const CompletionBoundarySchema = Type.Union([
  Type.Literal("local-integration"),
  Type.Literal("branch-handoff"),
  Type.Literal("pr-handoff"),
  Type.Literal("remote-integration"),
]);
export type CompletionBoundary = Static<typeof CompletionBoundarySchema>;
export const IntegrationProfileSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("local-ff"),
  Type.Literal("remote-ff"),
]);
export type IntegrationProfile = Static<typeof IntegrationProfileSchema>;
export const GitObjectFormatSchema = Type.Union([
  Type.Literal("sha1"),
  Type.Literal("sha256"),
]);
export type GitObjectFormat = Static<typeof GitObjectFormatSchema>;
export const WaveSchema = strictObject({
  id: identifier(),
  unitIds: Type.Array(identifier(), {
    maxItems: 3,
    uniqueItems: true,
  }),
});
export type Wave = Static<typeof WaveSchema>;
export const JournalCheckpointSchema = strictObject({
  revision: revision(),
  compactedEffects: Type.Integer({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  compactedEvents: Type.Integer({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  compactedIdempotencyKeys: Type.Integer({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  commitment: hash(),
});
export const ControllerOwnershipSchema = strictObject({
  runId: identifier(),
  incarnationId: identifier(),
  holder: controllerHolder(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash(),
  state: Type.Union([
    Type.Literal("unacquired"),
    Type.Literal("acquire_intent"),
    Type.Literal("acquired"),
    Type.Literal("release_intent"),
    Type.Literal("released"),
  ]),
});
export type ControllerOwnership = Static<typeof ControllerOwnershipSchema>;
/** Explicit adapter family/mapping pin, absent from pre-harness v1 runs. */
export const HarnessConfigurationSchema = strictObject({
  adapterVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  family: identifier(),
  harnessVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  supportCommitment: hash(),
});
export type HarnessConfiguration = Static<typeof HarnessConfigurationSchema>;
export const RepositoryRunSchema = strictObject({
  revision: revision(),
  state: AggregateStateSchema,
  storeIdentity: identifier(),
  repositoryIdentity: identifier(),
  integrationBranch: identifier(),
  authorityProfile: AuthorityProfileSchema,
  completionBoundary: CompletionBoundarySchema,
  integrationProfile: IntegrationProfileSchema,
  gitObjectFormat: GitObjectFormatSchema,
  controllerFencingToken: identifier(),
  controller: ControllerOwnershipSchema,
  harness: Type.Optional(HarnessConfigurationSchema),
  /** Frozen by wave_planned; absent for ordinary software runs. */
  knowledgeContract: Type.Optional(KnowledgeContractSchema),
  /** Aggregate post-integration work; absent for ordinary software runs. */
  gate: Type.Optional(WaveGateSchema),
  /** Claimed predecessor evidence awaiting one knowledge wave. */
  pendingProvenanceCarry: Type.Optional(ProvenanceCarrySchema),
  provenanceCarryClaim: Type.Optional(ProvenanceCarryClaimStateSchema),
  lastProvenanceCarryRefusal: Type.Optional(ProvenanceCarryRefusalSchema),
  units: Type.Record(identifier(), UnitSchema, {
    maxProperties: LIMITS.units,
    additionalProperties: false,
  }),
  reservations: Type.Record(identifier(), ReservationSchema, {
    maxProperties: LIMITS.reservations,
    additionalProperties: false,
  }),
  activeModifyingUnitIds: Type.Array(identifier(), {
    maxItems: 3,
    uniqueItems: true,
  }),
  qualificationOwnerUnitId: Type.Optional(identifier()),
  integrationOwnerUnitId: Type.Optional(identifier()),
  currentReviewerUnitId: Type.Optional(identifier()),
  wave: WaveSchema,
  qualificationQueue: Type.Array(identifier(), {
    maxItems: LIMITS.units,
    uniqueItems: true,
  }),
  integrationQueue: Type.Array(identifier(), {
    maxItems: LIMITS.units,
    uniqueItems: true,
  }),
  effectJournal: Type.Array(EffectJournalEntrySchema, {
    maxItems: LIMITS.effectJournal,
  }),
  processedEventIds: Type.Array(identifier(), {
    maxItems: LIMITS.eventHistory,
    uniqueItems: true,
  }),
  processedIdempotencyKeys: Type.Array(idempotencyKey(), {
    maxItems: LIMITS.eventHistory,
    uniqueItems: true,
  }),
  // Canonical binary slots: an occupancy bitmap binds each full digest to a
  // stable `(unit ordinal, worker|reviewer, generation)` position.
  usedSessionCount: Type.Integer({
    minimum: 0,
    maximum: LIMITS.sessionHistory,
  }),
  sessionLineage: Type.String({
    maxLength:
      Math.ceil(
        (LIMITS.sessionHistory * LIMITS.sessionFingerprintBytes +
          Math.ceil(LIMITS.sessionHistory / 8)) /
          3,
      ) * 4,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  }),
  sessionLineageRoot: hash(),
  // Canonical deflate-raw JSON ledger of exact facts for closed units. The
  // live unit object stays compact after cleanup while exact OIDs/hashes are
  // retained for audit and hydration validation.
  closedUnitEvidence: Type.String({
    maxLength: LIMITS.envelopeBytes,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  }),
  // Commits the compact closed ledger itself. The ordered journal checkpoint
  // commits transitions; this converse catches mutation of its exact retained
  // audit copies after those transitions are compacted.
  closedUnitEvidenceCommitment: hash(),
  journalCheckpoint: JournalCheckpointSchema,
  journalCommitment: hash(),
});
export type RepositoryRun = Static<typeof RepositoryRunSchema>;

const eventBase = {
  eventId: identifier(),
  expectedRevision: revision(),
  unitId: identifier(),
};
const controllerEventBase = {
  eventId: identifier(),
  expectedRevision: revision(),
};
const effectIntent = { idempotencyKey: idempotencyKey() };
const observedEffect = {
  effectId: effectIdentifier(),
  effectKind: EffectKindSchema,
  observationHash: hash(),
};
const session = {
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash(),
};
export const WorkerResultSchema = strictObject({
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("needs_repair"),
    Type.Literal("failed"),
  ]),
  summary: text(),
  residualRisks: Type.Array(text(), { maxItems: 32 }),
  suggestedFollowUps: Type.Array(text(), { maxItems: 32 }),
});
export type WorkerResult = Static<typeof WorkerResultSchema>;
const FindingSchema = strictObject({
  id: identifier(),
  severity: Type.Union([
    Type.Literal("blocking"),
    Type.Literal("non_blocking"),
  ]),
  detail: text(),
});
const judgmentBase = {
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  aggregateRevision: revision(),
  promptHash: hash(),
  responseHash: hash(),
  rationale: text(),
};
const ControllerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("controller"),
  kind: Type.Union([
    Type.Literal("decomposition"),
    Type.Literal("conflict_classification"),
    Type.Literal("additional_tests"),
    Type.Literal("qualitative_acceptance"),
  ]),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Union([
    Type.Literal("accept"),
    Type.Literal("reject"),
    Type.Literal("repair"),
    Type.Literal("park"),
    Type.Literal("cancel"),
  ]),
});
const RepairDispositionJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("controller"),
  kind: Type.Literal("repair_disposition"),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Literal("repair"),
  // Binds the disposition to the evidence currently retained by the unit,
  // rather than to an earlier controller prompt.
  currentEvidenceHash: hash(),
  findingsContextHash: hash(),
});
const WorkerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("worker"),
  kind: Type.Union([
    Type.Literal("semantic_resolution"),
    Type.Literal("repair_disposition"),
  ]),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Union([
    Type.Literal("repair"),
    Type.Literal("park"),
    Type.Literal("cancel"),
  ]),
});
export const ReviewerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("reviewer"),
  kind: Type.Literal("review_verdict"),
  unitId: identifier(),
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  decision: Type.Union([
    Type.Literal("approve"),
    Type.Literal("request_changes"),
  ]),
  findings: Type.Array(FindingSchema, { maxItems: LIMITS.findings }),
});
export const JudgmentSchema = Type.Union([
  ControllerJudgmentSchema,
  RepairDispositionJudgmentSchema,
  WorkerJudgmentSchema,
  ReviewerJudgmentSchema,
]);
export type Judgment = Static<typeof JudgmentSchema>;
export type ReviewerJudgment = Static<typeof ReviewerJudgmentSchema>;

export const ProtocolEventSchema = Type.Union([
  strictObject({
    configuration: HarnessConfigurationSchema,
    eventId: identifier(),
    expectedRevision: revision(),
    type: Type.Literal("harness_configured"),
  }),
  strictObject({
    eventId: identifier(),
    expectedRevision: revision(),
    type: Type.Literal("wave_planned"),
    tasks: Type.Array(WaveTaskMetadataSchema, {
      minItems: 0,
      maxItems: LIMITS.units,
    }),
    carryOnly: Type.Optional(Type.Literal(true)),
    knowledgeContract: Type.Optional(KnowledgeContractSchema),
    waveId: identifier(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_acquire_intent"),
    ...effectIntent,
    slotTransition: Type.Optional(SlotTransitionIntentSchema),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_acquired"),
    ...observedEffect,
    holder: controllerHolder(),
    controllerFencingToken: identifier(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("provenance_carry_claim_intent"),
    ...effectIntent,
    claimToken: idempotencyKey(),
    exportId: identifier(),
    predecessorFinalRevision: revision(),
    predecessorJournalCheckpointCommitment: hash(),
    predecessorRootBeadId: identifier(),
    predecessorRootAggregateCommitment: hash(),
    predecessorRunId: identifier(),
    predecessorWaveId: identifier(),
    snapshotCommitment: hash(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("provenance_carry_claim_observed"),
    ...observedEffect,
    result: Type.Union([
      strictObject({
        status: Type.Literal("imported"),
        carry: ProvenanceCarrySchema,
      }),
      ProvenanceCarryRefusalSchema,
    ]),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_release_intent"),
    ...effectIntent,
    slotTransition: Type.Optional(SlotTransitionIntentSchema),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_released"),
    ...observedEffect,
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("materialisation_resolve_intent"),
    ...effectIntent,
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("materialisation_sources_observed"),
    ...observedEffect,
    gateEntryId: identifier(),
    result: Type.Union([
      strictObject({
        status: Type.Literal("observed"),
        sources: Type.Array(MaterialisationSourceSchema, {
          minItems: 1,
          maxItems: LIMITS.materialisationMatches,
        }),
      }),
      strictObject({
        status: Type.Literal("refused"),
        refusal: MaterialisationResolveRefusalSchema,
      }),
    ]),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("gate_clock_observed"),
    gateEntryId: identifier(),
    timestamp: utcSecond(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("destination_probe_intent"),
    ...effectIntent,
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("destination_probe_observed"),
    ...observedEffect,
    gateEntryId: identifier(),
    result: Type.Union([
      strictObject({
        status: Type.Literal("observed"),
        identity: MaterialisationDestinationIdentitySchema,
      }),
      strictObject({
        status: Type.Literal("refused"),
        refusal: DestinationProbeRefusalSchema,
      }),
    ]),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("materialise_intent"),
    ...effectIntent,
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("materialise_observed"),
    ...observedEffect,
    gateEntryId: identifier(),
    result: Type.Union([
      strictObject({
        status: Type.Literal("observed"),
        observation: MaterialisationObservationSchema,
      }),
      strictObject({
        status: Type.Literal("refused"),
        refusal: MaterialiseRefusalSchema,
      }),
    ]),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("provenance_commit_intent"),
    ...effectIntent,
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("provenance_commit_observed"),
    ...observedEffect,
    gateEntryId: identifier(),
    result: Type.Union([
      strictObject({
        status: Type.Literal("committed"),
        attemptedBaseOid: oid(),
        commitOid: oid(),
        treeOid: oid(),
      }),
      strictObject({
        status: Type.Literal("reproducibility_failed"),
        attemptedCommitOid: oid(),
        attemptedTreeOid: oid(),
        reasonDigest: hash(),
      }),
      strictObject({
        status: Type.Literal("base_advanced"),
        advancedBaseOid: oid(),
        attemptedCommitOid: oid(),
        attemptedTreeOid: oid(),
      }),
      strictObject({
        status: Type.Literal("worktree_refused"),
        condition: Type.Union([
          Type.Literal("dirty_worktree"),
          Type.Literal("unexpected_head"),
        ]),
        expectedBaseOid: oid(),
        observedHeadOid: Type.Union([oid(), Type.Null()]),
        reasonDigest: hash(),
      }),
      strictObject({
        status: Type.Literal("integration_refused"),
        attemptedCommitOid: oid(),
        attemptedTreeOid: oid(),
        reasonDigest: hash(),
      }),
    ]),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("gate_entry_deferred"),
    followUpBeadId: identifier(),
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("verification_intent"),
    ...effectIntent,
    commands: Type.Array(commandVector(), { minItems: 1, maxItems: 32 }),
    gateEntryId: identifier(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("verification_observed"),
    ...observedEffect,
    baseOid: oid(),
    gateEntryId: identifier(),
    headOid: oid(),
    treeOid: oid(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("verification_failed"),
    ...observedEffect,
    baseOid: oid(),
    gateEntryId: identifier(),
    headOid: oid(),
    treeOid: oid(),
    unitId: Type.Null(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_intent"),
    ...effectIntent,
    reservations: Type.Array(
      strictObject({
        id: identifier(),
        namespace: identifier(),
        resource: identifier(),
      }),
      { minItems: 1, maxItems: LIMITS.reservations, uniqueItems: true },
    ),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_observed"),
    ...observedEffect,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("branch_intent"),
    ...effectIntent,
    branchRef: identifier(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("branch_observed"),
    ...observedEffect,
    branchRef: identifier(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worktree_intent"),
    ...effectIntent,
    worktreePath: text(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worktree_observed"),
    ...observedEffect,
    worktreePath: text(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_intent"),
    ...effectIntent,
    packet: HarnessPacketBindingSchema,
    requestedModel: text(),
    promptHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_observed"),
    ...observedEffect,
    ...session,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("collect_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worker_collected"),
    ...observedEffect,
    ...session,
    workerResult: WorkerResultSchema,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("candidate_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("candidate_observed"),
    ...observedEffect,
    headOid: oid(),
    treeOid: oid(),
    candidateDiffHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_intent"),
    ...effectIntent,
    commands: Type.Array(text(), { minItems: 1, maxItems: 32 }),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_observed"),
    ...observedEffect,
    baseOid: oid(),
    headOid: oid(),
    treeOid: oid(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_failed"),
    ...observedEffect,
    baseOid: oid(),
    headOid: oid(),
    treeOid: oid(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_dispatch_intent"),
    ...effectIntent,
    packet: HarnessPacketBindingSchema,
    requestedModel: text(),
    promptHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_observed"),
    ...observedEffect,
    ...session,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("review_collect_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("review_collected"),
    ...observedEffect,
    judgment: ReviewerJudgmentSchema,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_observed"),
    ...observedEffect,
    publication: Type.Union([
      strictObject({
        kind: Type.Literal("push_branch"),
        remoteHeadOid: oid(),
      }),
      strictObject({
        kind: Type.Literal("open_pr"),
        pullRequest: PullRequestObservationSchema,
      }),
    ]),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_observed"),
    ...observedEffect,
    baseOid: oid(),
    headOid: oid(),
    treeOid: oid(),
    integrationOid: oid(),
    controllerFencingToken: identifier(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_release_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_released"),
    ...observedEffect,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("repair_intent"),
    ...effectIntent,
    judgment: RepairDispositionJudgmentSchema,
    packet: HarnessPacketBindingSchema,
    requestedModel: text(),
    promptHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("repair_observed"),
    ...observedEffect,
    ...session,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("failure_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("failure_observed"),
    ...observedEffect,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("timeout_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("timeout_observed"),
    ...observedEffect,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("park_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("park_observed"),
    ...observedEffect,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_observed"),
    ...observedEffect,
    role: Type.Literal("none"),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_observed"),
    ...observedEffect,
    ...session,
    role: Type.Literal("worker"),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_observed"),
    ...observedEffect,
    ...session,
    role: Type.Literal("reviewer"),
  }),
  strictObject({
    eventId: identifier(),
    expectedRevision: revision(),
    unitId: nullableIdentifier(),
    type: Type.Literal("effect_ambiguous"),
    effectId: effectIdentifier(),
    effectKind: EffectKindSchema,
    gateEntryId: Type.Optional(identifier()),
    observationHash: Type.Optional(hash()),
  }),
]);
export type ProtocolEvent = Static<typeof ProtocolEventSchema>;

const runtimeEffectBase = {
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  gateEntryId: Type.Optional(identifier()),
  // The reducer derives this domain-separated digest from the typed params
  // below; adapters execute the typed params, never the opaque digest.
  paramsHash: hash(),
  schemaVersion: Type.Literal(SCHEMA_VERSION),
};
const RuntimeReservationRequestSchema = strictObject({
  id: identifier(),
  namespace: identifier(),
  resource: identifier(),
});
const WorkerBindingSchema = strictObject({
  branchRef: identifier(),
  packet: HarnessPacketBindingSchema,
  worktreePath: text(),
  requestedModel: text(),
  promptHash: hash(),
});
const CandidateBindingSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
});

/**
 * Runtime effects are executable, discriminated inputs. Their parameter
 * fields are persisted through the intent transition and bound again by the
 * corresponding observation. paramsHash is reducer-derived audit evidence.
 */
export const RuntimeEffectSchema = Type.Union([
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("controller_acquire"),
    unitId: Type.Null(),
    params: strictObject({
      holder: controllerHolder(),
      controllerFencingToken: identifier(),
      requestedModel: text(),
      returnedModel: text(),
      promptHash: hash(),
      slotTransition: Type.Optional(SlotTransitionIntentSchema),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("reservation_acquire"),
    unitId: identifier(),
    params: strictObject({
      reservations: Type.Array(RuntimeReservationRequestSchema, {
        minItems: 1,
        maxItems: LIMITS.reservations,
        uniqueItems: true,
      }),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("branch_create"),
    unitId: identifier(),
    params: strictObject({ baseOid: oid(), branchRef: identifier() }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("worktree_create"),
    unitId: identifier(),
    params: strictObject({ branchRef: identifier(), worktreePath: text() }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("dispatch"),
    unitId: identifier(),
    params: WorkerBindingSchema,
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("worker_collect"),
    unitId: identifier(),
    params: strictObject({ sessionId: identifier() }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("candidate_collect"),
    unitId: identifier(),
    params: strictObject({ branchRef: identifier(), worktreePath: text() }),
  }),
  strictObject({
    ...runtimeEffectBase,
    gateEntryId: identifier(),
    kind: Type.Literal("materialisation_resolve"),
    unitId: Type.Null(),
    params: strictObject({
      destinationProbeGateEntryId: identifier(),
      domainScope: text(),
      driver: text(),
      executorTool: identifier(),
      gateEntryId: identifier(),
      remainingAggregateEnvelopeByteCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.envelopeBytes,
      }),
      remainingProjectionSnapshotByteCapacity: Type.Integer({
        minimum: 0,
        maximum: 65_536,
      }),
      remainingSourceByteCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.materialisationWaveBytes,
      }),
      remainingItemCapacity: Type.Integer({
        minimum: 0,
        maximum: LIMITS.materialisationOutputs,
      }),
      originUnitId: nullableIdentifier(),
      repositoryIdentity: identifier(),
      runId: identifier(),
      sourceOid: oid(),
      sourcePattern: canonicalSourcePath(),
      stage: Type.Union([Type.Literal("unit"), Type.Literal("gate")]),
      target: MaterialisationTargetSchema,
      targetId: identifier(),
      targetOrdinal: Type.Integer({ minimum: 0, maximum: 63 }),
      waveId: identifier(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    gateEntryId: identifier(),
    kind: Type.Literal("destination_probe"),
    unitId: Type.Null(),
    params: strictObject({
      destination: DriveAliasSchema,
      destinationSubpath: canonicalSubpath(),
      expectedPriorIdentity: Type.Optional(
        MaterialisationDestinationIdentitySchema,
      ),
      gateEntryId: identifier(),
      repositoryIdentity: identifier(),
      stage: Type.Union([Type.Literal("unit"), Type.Literal("gate")]),
      waveId: identifier(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    gateEntryId: identifier(),
    kind: Type.Literal("materialise"),
    unitId: Type.Null(),
    params: strictObject({
      artifactName: plainBasename(),
      destination: DriveAliasSchema,
      destinationIdentity: MaterialisationDestinationIdentitySchema,
      destinationProbeGateEntryId: identifier(),
      destinationSubpath: canonicalSubpath(),
      domainScope: identifier(),
      driver: text(),
      executorTool: identifier(),
      gateEntryId: identifier(),
      namespaceControl: Type.Literal("exclusive"),
      originUnitId: nullableIdentifier(),
      repositoryIdentity: identifier(),
      runId: identifier(),
      sidecarByteCount: Type.Integer({
        minimum: 1,
        maximum: LIMITS.materialisationSidecarBytes,
      }),
      sidecarBytes: Type.String({
        minLength: 1,
        maxLength: LIMITS.materialisationSidecarBytes,
        maxUtf8Bytes: LIMITS.materialisationSidecarBytes,
      }),
      sidecarName: plainBasename(),
      sidecarSha256: hash(),
      source: MaterialisationSourceSchema,
      sourceOid: oid(),
      targetId: identifier(),
      timestamp: utcSecond(),
      waveId: identifier(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    gateEntryId: identifier(),
    kind: Type.Literal("provenance_commit"),
    unitId: Type.Null(),
    params: strictObject({
      baseOid: oid(),
      gateEntryId: identifier(),
      projectionInputSnapshot: ProvenanceInputSchema,
      knowledgeContract: KnowledgeContractSchema,
      runId: identifier(),
      timestamp: utcSecond(),
      waveId: identifier(),
      worktreePath: absolutePath(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    gateEntryId: identifier(),
    kind: Type.Literal("verify"),
    unitId: Type.Null(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      commands: Type.Array(commandVector(), { minItems: 1, maxItems: 32 }),
      gateEntryId: identifier(),
      provenanceOid: oid(),
      worktreePath: absolutePath(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("verify"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      commands: Type.Array(text(), { minItems: 1, maxItems: 32 }),
      worktreePath: text(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("review_dispatch"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      packet: HarnessPacketBindingSchema,
      requestedModel: text(),
      promptHash: hash(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("review_collect"),
    unitId: identifier(),
    params: strictObject({
      sessionId: identifier(),
      candidate: CandidateBindingSchema,
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("publish"),
    unitId: identifier(),
    params: strictObject({
      branchRef: identifier(),
      candidate: CandidateBindingSchema,
      authorityProfile: AuthorityProfileSchema,
      completionBoundary: CompletionBoundarySchema,
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("integrate"),
    unitId: identifier(),
    params: strictObject({
      integrationBranch: identifier(),
      integrationProfile: IntegrationProfileSchema,
      completionBoundary: CompletionBoundarySchema,
      controllerFencingToken: identifier(),
      candidate: CandidateBindingSchema,
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("reservation_release"),
    unitId: identifier(),
    params: strictObject({
      reservationIds: Type.Array(identifier(), {
        maxItems: LIMITS.reservations,
        uniqueItems: true,
      }),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("repair"),
    unitId: identifier(),
    params: strictObject({
      ...WorkerBindingSchema.properties,
      repairBaseOid: oid(),
      repairHeadOid: Type.Optional(oid()),
      repairTreeOid: Type.Optional(oid()),
    }),
  }),
  ...(["failure", "timeout", "park", "cancel"] as const).map((kind) =>
    strictObject({
      ...runtimeEffectBase,
      kind: Type.Literal(kind),
      unitId: identifier(),
      params: Type.Union([
        strictObject({ role: Type.Literal("none") }),
        strictObject({ role: Type.Literal("worker"), sessionId: identifier() }),
        strictObject({
          role: Type.Literal("reviewer"),
          sessionId: identifier(),
        }),
      ]),
    }),
  ),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("provenance_carry_claim"),
    unitId: Type.Null(),
    params: strictObject({
      claimToken: idempotencyKey(),
      currentRunId: identifier(),
      exportId: identifier(),
      integrationBranch: identifier(),
      predecessorFinalRevision: revision(),
      predecessorJournalCheckpointCommitment: hash(),
      predecessorRootBeadId: identifier(),
      predecessorRootAggregateCommitment: hash(),
      predecessorRunId: identifier(),
      predecessorWaveId: identifier(),
      repositoryIdentity: identifier(),
      snapshotCommitment: hash(),
      storeIdentity: identifier(),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("controller_release"),
    unitId: Type.Null(),
    params: strictObject({
      holder: controllerHolder(),
      controllerFencingToken: identifier(),
      slotTransition: Type.Optional(SlotTransitionIntentSchema),
    }),
  }),
]);
export type RuntimeEffect = Static<typeof RuntimeEffectSchema>;
export const RepositoryRunEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.repository-run"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: RepositoryRunSchema,
});
export type RepositoryRunEnvelope = Static<typeof RepositoryRunEnvelopeSchema>;
export const ProtocolEventEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.protocol-event"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: ProtocolEventSchema,
});
export type ProtocolEventEnvelope = Static<typeof ProtocolEventEnvelopeSchema>;
export const JudgmentEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.judgment"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: JudgmentSchema,
});
export type JudgmentEnvelope = Static<typeof JudgmentEnvelopeSchema>;

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
});
ajv.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit: number, value: string) =>
    utf8.encode(value).byteLength <= limit,
  errors: false,
});
export interface ValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly errors: readonly string[];
}
export function validate<T>(
  schema: TSchema,
  input: unknown,
): ValidationResult<T> {
  const validator = ajv.compile(schema) as ValidateFunction<T>;
  if (validator(input)) return { ok: true, value: input, errors: [] };
  return { ok: false, errors: (validator.errors ?? []).map(formatError) };
}
export function parseEnvelope<T>(
  schema: TSchema,
  source: string,
): ValidationResult<T> {
  if (utf8.encode(source).byteLength > LIMITS.envelopeBytes)
    return { ok: false, errors: ["envelope exceeds byte limit"] };
  try {
    return validate<T>(schema, JSON.parse(source) as unknown);
  } catch {
    return { ok: false, errors: ["envelope is not valid JSON"] };
  }
}
function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}
