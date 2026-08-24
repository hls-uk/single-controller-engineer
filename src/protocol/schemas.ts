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
} as const;
const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
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
  Type.String({ minLength, maxLength: LIMITS.text });
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
]);
export type EffectKind = Static<typeof EffectKindSchema>;
export const EffectJournalEntrySchema = strictObject({
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  kind: EffectKindSchema,
  intentRevision: revision(),
  intentCommitment: hash(),
  paramsHash: hash(),
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
export const UnitSchema = strictObject({
  id: identifier(),
  // Stable at planning time and never reassigned, even after a unit leaves
  // the live map at closure. Session lineage records bind this ordinal.
  ordinal: Type.Integer({ minimum: 0, maximum: 63 }),
  revision: revision(),
  state: UnitStateSchema,
  baseOid: oid(),
  branchRef: Type.Optional(identifier()),
  worktreePath: Type.Optional(text()),
  reservationIds: Type.Array(identifier(), {
    maxItems: LIMITS.reservations,
    uniqueItems: true,
  }),
  candidateHead: Type.Optional(oid()),
  candidateTree: Type.Optional(oid()),
  publishedHeadOid: Type.Optional(oid()),
  openPullRequest: Type.Optional(PullRequestObservationSchema),
  workerSessionId: Type.Optional(identifier()),
  workerRequestedModel: Type.Optional(text()),
  workerReturnedModel: Type.Optional(text()),
  workerPromptHash: Type.Optional(hash()),
  reviewerSessionId: Type.Optional(identifier()),
  reviewerRequestedModel: Type.Optional(text()),
  reviewerReturnedModel: Type.Optional(text()),
  reviewPromptHash: Type.Optional(hash()),
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
  Type.Literal("github-merge-group"),
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
  compactedEffects: Type.Integer({ minimum: 0 }),
  compactedEvents: Type.Integer({ minimum: 0 }),
  compactedIdempotencyKeys: Type.Integer({ minimum: 0 }),
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
const WorkerResultSchema = strictObject({
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
const ReviewerJudgmentSchema = strictObject({
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
    ...controllerEventBase,
    type: Type.Literal("controller_acquire_intent"),
    ...effectIntent,
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
    type: Type.Literal("controller_release_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_released"),
    ...observedEffect,
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
    type: Type.Literal("reviewer_dispatch_intent"),
    ...effectIntent,
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
  }),
  strictObject({
    eventId: identifier(),
    expectedRevision: revision(),
    unitId: nullableIdentifier(),
    type: Type.Literal("effect_ambiguous"),
    effectId: effectIdentifier(),
    effectKind: EffectKindSchema,
    observationHash: Type.Optional(hash()),
  }),
]);
export type ProtocolEvent = Static<typeof ProtocolEventSchema>;

const runtimeEffectBase = {
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
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
    kind: Type.Literal("verify"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      commands: Type.Array(text(), { minItems: 1, maxItems: 32 }),
    }),
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("review_dispatch"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
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
    kind: Type.Literal("controller_release"),
    unitId: Type.Null(),
    params: strictObject({
      holder: controllerHolder(),
      controllerFencingToken: identifier(),
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
  if (new TextEncoder().encode(source).byteLength > LIMITS.envelopeBytes)
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
