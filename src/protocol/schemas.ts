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
  eventHistory: 512,
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
const oid = () =>
  Type.String({ minLength: 7, maxLength: 128, pattern: "^[0-9a-f]+$" });
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
  effectId: identifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: identifier(),
  kind: EffectKindSchema,
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
  acquireEffectId: Type.Optional(identifier()),
  releaseEffectId: Type.Optional(identifier()),
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
export const UnitSchema = strictObject({
  id: identifier(),
  revision: Type.Integer({ minimum: 0 }),
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
  reviewBaseOid: Type.Optional(oid()),
  reviewHeadOid: Type.Optional(oid()),
  reviewTree: Type.Optional(oid()),
  approvalResponseHash: Type.Optional(hash()),
  landedOid: Type.Optional(oid()),
  repairCount: Type.Integer({ minimum: 0, maximum: 16 }),
});
export type Unit = Static<typeof UnitSchema>;

export const AggregateStateSchema = Type.Union([
  Type.Literal("initializing"),
  Type.Literal("active"),
  Type.Literal("draining"),
  Type.Literal("release_intent"),
  Type.Literal("released"),
  Type.Literal("blocked"),
]);
export type AggregateState = Static<typeof AggregateStateSchema>;
export const ControllerOwnershipSchema = strictObject({
  holder: identifier(),
  state: Type.Union([
    Type.Literal("unacquired"),
    Type.Literal("acquired"),
    Type.Literal("release_intent"),
    Type.Literal("released"),
  ]),
});
export type ControllerOwnership = Static<typeof ControllerOwnershipSchema>;
export const RepositoryRunSchema = strictObject({
  revision: Type.Integer({ minimum: 0 }),
  state: AggregateStateSchema,
  storeIdentity: identifier(),
  repositoryIdentity: identifier(),
  integrationBranch: identifier(),
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
  effectJournal: Type.Array(EffectJournalEntrySchema, {
    maxItems: LIMITS.effectJournal,
  }),
  processedEventIds: Type.Array(identifier(), {
    maxItems: LIMITS.eventHistory,
    uniqueItems: true,
  }),
});
export type RepositoryRun = Static<typeof RepositoryRunSchema>;

const eventBase = {
  eventId: identifier(),
  expectedRevision: Type.Integer({ minimum: 0 }),
  unitId: identifier(),
};
const controllerEventBase = {
  eventId: identifier(),
  expectedRevision: Type.Integer({ minimum: 0 }),
};
const effectIntent = { idempotencyKey: identifier(), paramsHash: hash() };
const observedEffect = {
  effectId: identifier(),
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
  aggregateRevision: Type.Integer({ minimum: 0 }),
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
    Type.Literal("repair_disposition"),
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
    remoteHeadOid: oid(),
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
    judgment: Type.Optional(JudgmentSchema),
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
    ...eventBase,
    type: Type.Literal("effect_ambiguous"),
    effectId: identifier(),
    effectKind: EffectKindSchema,
    observationHash: Type.Optional(hash()),
  }),
]);
export type ProtocolEvent = Static<typeof ProtocolEventSchema>;

const runtimeKinds = [
  "controller_acquire",
  "reservation_acquire",
  "branch_create",
  "worktree_create",
  "dispatch",
  "worker_collect",
  "candidate_collect",
  "verify",
  "review_dispatch",
  "review_collect",
  "publish",
  "integrate",
  "reservation_release",
  "repair",
  "failure",
  "timeout",
  "park",
  "cancel",
  "controller_release",
] as const;
export const RuntimeEffectSchema = Type.Union(
  runtimeKinds.map((kind) =>
    strictObject({
      kind: Type.Literal(kind),
      effectId: identifier(),
      unitId: nullableIdentifier(),
      idempotencyKey: identifier(),
      paramsHash: hash(),
      schemaVersion: Type.Literal(SCHEMA_VERSION),
    }),
  ),
);
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
