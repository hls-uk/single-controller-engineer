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
  text: 8_192,
  evidence: 128,
} as const;

const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
const oid = () =>
  Type.String({ minLength: 7, maxLength: 128, pattern: "^[0-9a-f]+$" });
const shortText = () => Type.String({ minLength: 1, maxLength: LIMITS.text });
const hash = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });

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
export const EffectKindSchema = Type.Union([
  Type.Literal("dispatch"),
  Type.Literal("verify"),
  Type.Literal("review_dispatch"),
  Type.Literal("publish"),
  Type.Literal("integrate"),
]);

export const EffectJournalEntrySchema = strictObject({
  effectId: identifier(),
  unitId: identifier(),
  idempotencyKey: identifier(),
  kind: EffectKindSchema,
  paramsHash: hash(),
  status: EffectStatusSchema,
  observationHash: Type.Optional(hash()),
  schemaVersion: Type.Literal(SCHEMA_VERSION),
});
export type EffectJournalEntry = Static<typeof EffectJournalEntrySchema>;

export const UnitStateSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("dispatch_intent"),
  Type.Literal("dispatched"),
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
  Type.Literal("blocked"),
  Type.Literal("failed"),
  Type.Literal("timed_out"),
  Type.Literal("parked"),
  Type.Literal("cancelled"),
  Type.Literal("closed"),
]);
export type UnitState = Static<typeof UnitStateSchema>;

export const UnitSchema = strictObject({
  id: identifier(),
  revision: Type.Integer({ minimum: 0 }),
  state: UnitStateSchema,
  baseOid: oid(),
  candidateHead: Type.Optional(oid()),
  workerSessionId: Type.Optional(identifier()),
  reviewerSessionId: Type.Optional(identifier()),
  reviewBaseOid: Type.Optional(oid()),
  reviewHeadOid: Type.Optional(oid()),
  approvalHash: Type.Optional(hash()),
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

export const RepositoryRunSchema = strictObject({
  revision: Type.Integer({ minimum: 0 }),
  state: AggregateStateSchema,
  storeIdentity: identifier(),
  repositoryIdentity: identifier(),
  integrationBranch: identifier(),
  controllerFencingToken: identifier(),
  units: Type.Record(identifier(), UnitSchema, {
    maxProperties: LIMITS.units,
    additionalProperties: false,
  }),
  activeModifyingUnitIds: Type.Array(identifier(), {
    maxItems: 3,
    uniqueItems: true,
  }),
  qualificationOwnerUnitId: Type.Optional(identifier()),
  integrationOwnerUnitId: Type.Optional(identifier()),
  effectJournal: Type.Array(EffectJournalEntrySchema, {
    maxItems: LIMITS.effectJournal,
    uniqueItems: true,
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
const effectIntent = {
  idempotencyKey: identifier(),
  paramsHash: hash(),
};
export const ProtocolEventSchema = Type.Union([
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_observed"),
    effectId: identifier(),
    sessionId: identifier(),
    observationHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("candidate_observed"),
    headOid: oid(),
    observationHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_observed"),
    effectId: identifier(),
    baseOid: oid(),
    observationHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_dispatch_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_observed"),
    effectId: identifier(),
    sessionId: identifier(),
    observationHash: hash(),
  }),
  strictObject({ ...eventBase, type: Type.Literal("review_collect_intent") }),
  strictObject({
    ...eventBase,
    type: Type.Literal("review_approved"),
    baseOid: oid(),
    headOid: oid(),
    judgmentHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_observed"),
    effectId: identifier(),
    remoteHeadOid: oid(),
    observationHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_intent"),
    ...effectIntent,
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_observed"),
    effectId: identifier(),
    integrationOid: oid(),
    observationHash: hash(),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("effect_ambiguous"),
    effectId: identifier(),
    observationHash: Type.Optional(hash()),
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("block"),
    reason: shortText(),
  }),
]);
export type ProtocolEvent = Static<typeof ProtocolEventSchema>;

export const JudgmentSchema = strictObject({
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  kind: Type.Union([
    Type.Literal("decomposition"),
    Type.Literal("conflict_classification"),
    Type.Literal("additional_tests"),
    Type.Literal("semantic_resolution"),
    Type.Literal("qualitative_acceptance"),
    Type.Literal("repair_disposition"),
    Type.Literal("review_verdict"),
  ]),
  role: Type.Union([
    Type.Literal("controller"),
    Type.Literal("worker"),
    Type.Literal("reviewer"),
  ]),
  sessionId: identifier(),
  requestedModel: shortText(),
  returnedModel: shortText(),
  aggregateRevision: Type.Integer({ minimum: 0 }),
  promptHash: hash(),
  responseHash: hash(),
  factOid: Type.Optional(oid()),
  decision: Type.Union([
    Type.Literal("approve"),
    Type.Literal("request_changes"),
    Type.Literal("accept"),
    Type.Literal("reject"),
  ]),
  rationale: shortText(),
});
export type Judgment = Static<typeof JudgmentSchema>;

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
  if (new TextEncoder().encode(source).byteLength > LIMITS.envelopeBytes) {
    return { ok: false, errors: ["envelope exceeds byte limit"] };
  }
  try {
    return validate<T>(schema, JSON.parse(source) as unknown);
  } catch {
    return { ok: false, errors: ["envelope is not valid JSON"] };
  }
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}
